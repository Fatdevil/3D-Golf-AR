const fs = require('fs');
const text = fs.readFileSync('animate.js', 'utf8');
let depth = 0;
let inString = false;
let strChar = '';
let inSingleComment = false;
let inMultiComment = false;
let line = 1;
let unclosed = [];
for (let i = 0; i < text.length; i++) {
    let c = text[i];
    let next = text[i+1] || '';
    if (c === '\n') {
        line++;
        inSingleComment = false;
        if (inString && strChar !== '\`') { inString = false; }
        continue;
    }
    if (inSingleComment) continue;
    if (inMultiComment) {
        if (c === '*' && next === '/') { inMultiComment = false; i++; }
        continue;
    }
    if (inString) {
        if (c === '\\') i++;
        else if (c === strChar) inString = false;
        continue;
    }
    if (c === '/' && next === '/') { inSingleComment = true; i++; continue; }
    if (c === '/' && next === '*') { inMultiComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = true; strChar = c; continue; }
    
    if (c === '{') {
        depth++;
        unclosed.push(line);
    } else if (c === '}') {
        depth--;
        unclosed.pop();
    }
}
console.log('Final depth:', depth);
console.log('Unclosed braces opened at lines:', unclosed);
