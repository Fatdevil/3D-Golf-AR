
        function toggleMenu() {
            let m = document.getElementById('dropdown-menu');
            m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
        }
        window.useMeters = false;
        window.formatDistStr = function(meters, dec=1) { return window.useMeters ? (meters).toFixed(dec) + ' m' : (meters * 1.09361).toFixed(dec) + ' yds'; };
        window.formatDistRaw = function(meters, dec=0) { return window.useMeters ? (meters).toFixed(dec) : (meters * 1.09361).toFixed(dec); };
        
        window.toggleProMode = function() {
            let tb = document.getElementById('left-toolbar');
            let btn = document.getElementById('btn-pro-toggle');
            let isPro = tb.classList.toggle('pro-mode');
            btn.textContent = isPro ? '⚡ PRO MODE' : '🔧 BASIC MODE';
            ArcadeStorage.setProMode(isPro);
            // If switching to BASIC and current tool is a pro-tool, fallback to INSPECT
            if (!isPro && typeof currentTool !== 'undefined') {
                let proTools = ['FLATTEN','RAMP','NOISE','WATER','SPLINE','SMART_BUILDER','RIDGE','FOREST','ERASER','COLORIZE'];
                if (proTools.includes(currentTool)) {
                    if (typeof setTool === 'function') setTool('INSPECT');
                }
            }
        };
        // Restore PRO mode from localStorage on boot
        document.addEventListener('DOMContentLoaded', function() {
            if (ArcadeStorage.getProMode()) {
                let tb = document.getElementById('left-toolbar');
                let btn = document.getElementById('btn-pro-toggle');
                if (tb) { tb.classList.add('pro-mode'); }
                if (btn) { btn.textContent = '⚡ PRO MODE'; }
            }
        });
    