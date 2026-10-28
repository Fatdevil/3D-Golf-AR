// ================================================================
//  LM BRIDGE — WebSocket connection to Launch Monitor hardware
//  Connects to ws://localhost:8081 (SkyTrak/GSPro bridge).
//  Auto-reconnects every 5s on disconnect.
//
//  Extracted from arcade.html — Compatibility contract:
//  - Calls window.triggerRealShot(data) on shot received
//  - Updates DOM: #lm-status-dot (color), #lm-status-text (text)
//  - Self-boots on load (initLaunchMonitorBridge called at bottom)
// ================================================================
(function() {
    var retryDelay = 5000;
    var maxRetryDelay = 60000;
    var retryTimer = null;

    function initLaunchMonitorBridge() {
        if (window._disableLMBridge) return;
        var ws;
        try {
            ws = new WebSocket('ws://localhost:8081');
        } catch(e) {
            scheduleRetry();
            return;
        }

        var dot = document.getElementById('lm-status-dot');
        var txt = document.getElementById('lm-status-text');

        ws.onopen = function() {
            retryDelay = 5000;
            if(txt) txt.textContent = "LM Brygga Redo";
            if(dot) dot.style.background = "#eab308";
            window.lmConnected = true;
            if (window.SwingEngine && window.SwingEngine.setBridgeConnected) window.SwingEngine.setBridgeConnected(true);
        };
        ws.onmessage = function(event) {
            try {
                var msg = JSON.parse(event.data);
                if (msg.type === 'status') {
                    if(txt) txt.textContent = msg.data.message;
                    if(dot) dot.style.background = msg.data.color;
                } else if (msg.type === 'shot') {
                    if(dot) {
                        dot.style.background = "#38bdf8";
                        setTimeout(() => dot.style.background = "#4ade80", 500);
                    }
                    msg.data.isLiveData = true;
                    // only while the launch monitor is the chosen input (see SwingEngine.acceptsBridgeShots)
                    if (window.SwingEngine && window.SwingEngine.acceptsBridgeShots && !window.SwingEngine.acceptsBridgeShots()) {
                        // say so, or the player thinks the shot got lost
                        if (typeof window.showBuildToast === 'function') {
                            var sv = window.getGolfLanguage && window.getGolfLanguage() === 'sv';
                            window.showBuildToast(sv ? '📡 Slag från launch monitorn ignorerat: välj LM som inmatning för att spela det' : '📡 Launch monitor shot ignored: pick LM as the input to play it', '#f59e0b');
                        }
                        return;
                    }
                    if (typeof window.triggerRealShot === 'function') {
                        window.triggerRealShot(msg.data);
                    }
                }
            } catch(e) {}
        };
        ws.onerror = function() {
            // Handled cleanly
        };
        ws.onclose = function() {
            if(txt) txt.textContent = "LM Brygga Nere";
            if(dot) dot.style.background = "#ef4444";
            window.lmConnected = false;
            if (window.SwingEngine && window.SwingEngine.setBridgeConnected) window.SwingEngine.setBridgeConnected(false);
            scheduleRetry();
        };

        function scheduleRetry() {
            if (window._disableLMBridge) return;
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(initLaunchMonitorBridge, retryDelay);
            retryDelay = Math.min(maxRetryDelay, Math.round(retryDelay * 1.5));
        }
    }

    // Boot:
    initLaunchMonitorBridge();
})();
