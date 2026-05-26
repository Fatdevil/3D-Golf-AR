const fs = require('fs');
const content = fs.readFileSync('c:/Antigravety projekt/3D-Golf-AR/arcade.html', 'utf8');
console.log('Smart Green in file:', content.includes('window.executeSplineSmartGreen = function'));
console.log('Tee Palette hidden:', content.includes('id="pal-tee" class="palette-btn" style="display:none;'));
console.log('Flag Button hidden:', content.includes('id="btn-flag" onclick="setHoleAction(\\\'FLAG\\\')" style="display:none;"'));
console.log('Red Tee hidden:', content.includes('id="btn-red-tee" onclick="setHoleAction(\\\'TEE_RED\\\')" style="display:none;"'));
