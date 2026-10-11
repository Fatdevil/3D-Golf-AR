const net = require('net');
const WebSocket = require('ws');
const { createFramer, normalizeShot, isShot, replies } = require('./protocol');

// Startar bron: en TCP-server som låtsas vara GSPro (launch monitorn ansluter hit) och en WebSocket som skickar slagen vidare till webbläsaren.
// Portar och logg kan anges så att bron går att testa; utan argument gäller GSPro:s standardport 921 och webbläsarporten 8081.
function startBridge(opts) {
    opts = opts || {};
    const TCP_PORT = opts.tcpPort !== undefined ? opts.tcpPort : 921;   // GSPro Open API Default Port
    const WS_PORT = opts.wsPort !== undefined ? opts.wsPort : 8081;     // Frontend Broadcast Port
    const HOST = opts.host || '127.0.0.1';
    const log = opts.log || console.log;
    const logError = opts.log || console.error;

    // WebSocket Server
    const wss = new WebSocket.Server({ port: WS_PORT }, () => {
        log(`[🚀 Frontend] WebSocket Broadcaster igång på ws://localhost:${wss.address().port}`);
    });

    function broadcastToClients(type, data) {
        const payload = JSON.stringify({ type, data });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }

    // TCP Server för Launch Monitor (SkyTrak / GSPro emulatorer)
    const server = net.createServer((socket) => {
        log(`[🔗 Backend] Launch Monitor ansluten från ${socket.remoteAddress}`);
        broadcastToClients('status', { message: 'Launch Monitor Ansluten', color: '#4ade80' });

        // Tillstånd per anslutning: en ny anslutning börjar om från slag 1, så dubblettskyddet får inte följa med.
        const framer = createFramer();
        let lastShotNumber = -1;

        socket.on('data', (data) => {
            // En TCP-ström kan innehålla flera meddelanden i ett paket (t.ex. heartbeat + slag) eller ett meddelande delat på flera.
            const framed = framer.feed(data.toString());
            if (framed.invalid) log(`[⚠️ Varning] ${framed.invalid} meddelande(n) var inte giltig JSON och hoppades över`);
            if (framed.overflow) log('[⚠️ Varning] Bufferten blev för stor utan ett komplett meddelande och rensades');
            framed.messages.forEach((msg) => {
                lastShotNumber = handleMessage(msg, socket, lastShotNumber);
            });
        });

        socket.on('error', (err) => {
            logError('[❌ Backend] Socket Error:', err.message);
        });

        socket.on('close', () => {
            log('[🔴 Backend] Launch Monitor frånkopplad');
            broadcastToClients('status', { message: 'Launch Monitor Frånkopplad', color: '#ef4444' });
        });
    });

    function handleMessage(data, socket, lastShotNumber) {
        log('\n--- Nytt Paket från Launch Monitor ---');

        if (isShot(data)) {
            // Duplicate Protection (per anslutning)
            if (data.ShotNumber !== undefined && data.ShotNumber === lastShotNumber) {
                log(`[⚠️ Varning] Blockerade duplicerat slag (#${data.ShotNumber})`);
            } else {
                if (data.ShotNumber !== undefined) lastShotNumber = data.ShotNumber;
                log(`[🏌️‍♂️ SLAG!] ShotNumber: ${data.ShotNumber}`);
                // Normalisera till frontendens format (fart i mph, vinklar i grader, spinn i rpm)
                const normalizedShot = normalizeShot(data);
                log('📡 Skickar normalized shot till webbläsaren:', normalizedShot);
                broadcastToClients('shot', normalizedShot);
            }
        } else {
            // Heartbeat, enhetsstatus, eller ett meddelande utan bolldata
            log('[❤️ Heartbeat]');
        }

        // GSPro API kräver ALLTID ett kvitto på att meddelandet mottogs, annars stänger de socketen
        replies().forEach((reply) => socket.write(JSON.stringify(reply) + '\n'));
        return lastShotNumber;
    }

    const ready = Promise.all([
        new Promise((resolve) => server.listen(TCP_PORT, HOST, () => {
            log(`[📡 Backend] Lyssnar på GSPro TCP anslutningar på ${HOST}:${server.address().port}`);
            resolve();
        })),
        new Promise((resolve) => wss.once('listening', resolve))
    ]);

    return {
        server, wss, ready,
        tcpPort: () => server.address().port,
        wsPort: () => wss.address().port,
        close: () => new Promise((resolve) => {
            wss.clients.forEach((c) => c.terminate());
            wss.close(() => server.close(() => resolve()));
        })
    };
}

if (require.main === module) {
    startBridge();
}

module.exports = { startBridge };
