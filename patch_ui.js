const fs = require('fs');

let c = fs.readFileSync('c:/Antigravety projekt/3D-Golf-AR/arcade.html', 'utf8');

// Hide pal-tee
c = c.replace('<div id="pal-tee" class="palette-btn" style="background:#7cb54c; color:#fff; position:relative;" onclick="setPaletteColor(\'tee\', this)">Tee Box', '<div id="pal-tee" class="palette-btn" style="display:none; background:#7cb54c; color:#fff; position:relative;" onclick="setPaletteColor(\'tee\', this)">Tee Box');

// Hide pal-green
c = c.replace('<div id="pal-green" class="palette-btn" style="background:#98ce68; color:#000;" onclick="setPaletteColor(\'green\', this)">Green</div>', '<div id="pal-green" class="palette-btn" style="display:none; background:#98ce68; color:#000;" onclick="setPaletteColor(\'green\', this)">Green</div>');

// Hide pal-foregreen
c = c.replace('<div id="pal-foregreen" class="palette-btn" style="background:#8bc45d; color:#fff;" onclick="setPaletteColor(\'foregreen\', this)">Foregreen</div>', '<div id="pal-foregreen" class="palette-btn" style="display:none; background:#8bc45d; color:#fff;" onclick="setPaletteColor(\'foregreen\', this)">Foregreen</div>');

// Hide object buttons
c = c.replace('<button id="btn-flag" onclick="setHoleAction(\'FLAG\')"><span style="font-size:16px;">⛳</span> Flag</button>', '<button id="btn-flag" onclick="setHoleAction(\'FLAG\')" style="display:none;"><span style="font-size:16px;">⛳</span> Flag</button>');
c = c.replace('<button id="btn-red-tee" onclick="setHoleAction(\'TEE_RED\')">🔴 Red Tee</button>', '<button id="btn-red-tee" onclick="setHoleAction(\'TEE_RED\')" style="display:none;">🔴 Red Tee</button>');
c = c.replace('<button id="btn-yellow-tee" onclick="setHoleAction(\'TEE_YELLOW\')">🟡 Yellow Tee</button>', '<button id="btn-yellow-tee" onclick="setHoleAction(\'TEE_YELLOW\')" style="display:none;">🟡 Yellow Tee</button>');
c = c.replace('<button id="btn-white-tee" onclick="setHoleAction(\'TEE_WHITE\')">⚪ White Tee</button>', '<button id="btn-white-tee" onclick="setHoleAction(\'TEE_WHITE\')" style="display:none;">⚪ White Tee</button>');
c = c.replace('<button id="btn-black-tee" onclick="setHoleAction(\'TEE_BLACK\')">⚫ Black Tee</button>', '<button id="btn-black-tee" onclick="setHoleAction(\'TEE_BLACK\')" style="display:none;">⚫ Black Tee</button>');
c = c.replace('<button id="btn-range-tee" onclick="setHoleAction(\'TEE_RANGE\')">🟦 Range Tee</button>', '<button id="btn-range-tee" onclick="setHoleAction(\'TEE_RANGE\')" style="display:none;">🟦 Range Tee</button>');

// Auto place flag in executeSmartGreen
const smartGreenTarget = `        // Update the physics/biome map immediately so game knows it's green
        window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;`;

const smartGreenReplacement = `        // Update the physics/biome map immediately so game knows it's green
        window.terrainBiomeData = pCtx.getImageData(0, 0, 4096, 4096).data;
        
        // Auto-place Flag at centroid
        let hole = courseHoles[currentHoleIndex];
        if (hole.flagMesh) scene.remove(hole.flagMesh);
        hole.flag = { x: centroidX, y: centroidY, z: centroidZ };
        hole.flagMesh = createFlagObject(centroidX, centroidY, centroidZ);
        if(!hole.pins) hole.pins = {};
        hole.pins.medium = { x: centroidX, y: centroidY, z: centroidZ };`;

c = c.replace(smartGreenTarget, smartGreenReplacement);

fs.writeFileSync('c:/Antigravety projekt/3D-Golf-AR/arcade.html', c);
console.log('UI Patched!');
