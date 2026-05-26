const fs = require('fs');

let c = fs.readFileSync('c:/Antigravety projekt/3D-Golf-AR/arcade.html', 'utf8');

c = c.replace(/if\(window\.elevationHeatmapActive\) window\.updateElevationHeatmap\(\);\r?\n\s*\}/g, "if(window.elevationHeatmapActive) window.updateElevationHeatmap();\n            } else {\n                if(typeof pCtx !== 'undefined') window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;\n            }");

fs.writeFileSync('c:/Antigravety projekt/3D-Golf-AR/arcade.html', c);
console.log('Fixed');
