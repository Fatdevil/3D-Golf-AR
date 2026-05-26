
            window.useMeters = false;
            window.formatDistStr = function(meters, dec=1) { return window.useMeters ? (meters).toFixed(dec) + ' m' : (meters * 1.09361).toFixed(dec) + ' yds'; };
            window.formatDistRaw = function(meters, dec=0) { return window.useMeters ? (meters).toFixed(dec) : (meters * 1.09361).toFixed(dec); };
        