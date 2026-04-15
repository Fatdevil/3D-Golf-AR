const net = require('net');
const WebSocket = require('ws');

const TCP_PORT = 921; // GSPro Open API Default Port
const WS_PORT = 8081; // Frontend Broadcast Port

// WebSocket Server
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
    console.log(`[🚀 Frontend] WebSocket Broadcaster igång på ws://localhost:${WS_PORT}`);
});

function broadcastToClients(type, data) {
    const payload = JSON.stringify({ type, data });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// TCP Server f\u00f6r Launch Monitor (SkyTrak / GSPro emulatorer)
let lastShotNumber = -1;

const server = net.createServer((socket) => {
    console.log(`[🔗 Backend] Launch Monitor ansluten från ${socket.remoteAddress}`);
    broadcastToClients('status', { message: 'Launch Monitor Ansluten', color: '#4ade80' });

    let buffer = '';

    socket.on('data', (data) => {
        buffer += data.toString();
        
        // GSPro JSON är typiskt separerad med radbrytningar eller skickas i klump.
        // Vi försöker parsa alla kompletta JSON-objekt i bufferten.
        let tryParse = true;
        while(tryParse) {
            try {
                // Hitta första '{' och ev matchande '}' - ofta skickar Launch Monitors ett objekt per sändning
                const startIndex = buffer.indexOf('{');
                const endIndex = buffer.lastIndexOf('}');
                
                if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                    const jsonString = buffer.substring(startIndex, endIndex + 1);
                    const parsedData = JSON.parse(jsonString);
                    
                    // Rensa bufferten
                    buffer = buffer.substring(endIndex + 1);
                    
                    handleIncomingData(parsedData, socket);
                } else {
                    tryParse = false;
                }
            } catch (err) {
                // Incomplete JSON or malformed, wait for more data
                tryParse = false;
            }
        }
    });

    socket.on('error', (err) => {
        console.error('[❌ Backend] Socket Error:', err.message);
    });

    socket.on('close', () => {
        console.log('[🔴 Backend] Launch Monitor frånkopplad');
        broadcastToClients('status', { message: 'Launch Monitor Frånkopplad', color: '#ef4444' });
    });
});

server.listen(TCP_PORT, '127.0.0.1', () => {
    console.log(`[📡 Backend] Lyssnar på GSPro TCP anslutningar på 127.0.0.1:${TCP_PORT}`);
});

function handleIncomingData(data, socket) {
    // 1. Raw Sniffer Log (Loggar allt som kommer in för felsökning)
    console.log('\n--- Nytt Paket från Launch Monitor ---');
    // console.log(JSON.stringify(data, null, 2));

    // 2. Kolla ifall detta är ett Slag (Innehåller BallData)
    if (data.BallData) {
        // 3. Duplicate Protection
        if (data.ShotNumber !== undefined && data.ShotNumber === lastShotNumber) {
            console.log(`[⚠️ Varning] Blockerade duplicerat slag (#${data.ShotNumber})`);
            return;
        }
        
        if (data.ShotNumber !== undefined) {
            lastShotNumber = data.ShotNumber;
        }

        console.log(`[🏌️‍♂️ SLAG!] ShotNumber: ${data.ShotNumber}`);
        
        // 4. Normalisera till Frontendens "Big 5"-format
        const ball = data.BallData;
        const normalizedShot = {
            ballSpeedMph: typeof ball.Speed === 'number' ? ball.Speed : 0,
            launchAngleDeg: typeof ball.VLA === 'number' ? ball.VLA : 0,
            totalSpinRpm: typeof ball.TotalSpin === 'number' ? ball.TotalSpin : (typeof ball.Spin === 'number' ? ball.Spin : 0),
            spinAxisDeg: typeof ball.SpinAxis === 'number' ? ball.SpinAxis : 0,
            azimDeg: typeof ball.HLA === 'number' ? ball.HLA : 0
        };

        console.log(`📡 Skickar normalized shot till webbläsaren:`, normalizedShot);

        // 5. Broadcast!
        broadcastToClients('shot', normalizedShot);

    } else {
        // Förmodligen ett Heartbeat, Device status, etc.
        console.log(`[❤️ Heartbeat]`);
    }

    // GSPro API kräver ALLTID ett kvitto på att meddelandet mottogs, annars stänger de socketen
    const response = {
        Code: 200,
        Message: "OK"
    };
    socket.write(JSON.stringify(response) + '\n');
    
    // Tredjeparts-launch-monitors (t.ex ST1 för SkyTrak) kräver Ofta att "GSPro" även skickar "Code 201: Player Information"
    // så de vet vilken klubba och hand-orientering de ska displaya på sin skärm.
    const playerInfo = {
        Code: 201,
        Message: "GSPro Player Information",
        Player: {
            Handed: "RH",
            Club: "IRON"
        }
    };
    socket.write(JSON.stringify(playerInfo) + '\n');
}
