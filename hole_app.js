/* ============================================
   GreenRead AR — Hole Guide Engine (GolfLogix-style)
   Drivs av Canvas2D satellitvy + JSON courseData
   ============================================ */

let courseData = null;
let currentCourse = null;
let currentHoleIndex = 0;
let currentTee = 'gul'; // default tee

const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');

// Satellite tile imagery via Google Static Maps
const GOOGLE_API_KEY = "AIzaSyAX0hFTbQ5utdLQIM4gyXnqZElEMJTM3DU";
let satImage = null;
let satLoaded = false;

// View state
let mapCenterLat = 63.6624;
let mapCenterLon = 20.1292;
let mapZoom = 16.5;
let mapRotation = 0; // degrees, 0 = north up
let canvasW = 0, canvasH = 0;

// Touch/drag state
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragStartLat = 0, dragStartLon = 0;

// ============================================
// INITIALIZATION
// ============================================
async function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Load course data
    try {
        const res = await fetch('data/courses.json');
        courseData = await res.json();
        currentCourse = courseData.courses[0]; // Norrmjöle
        loadHole(0);
    } catch (e) {
        console.error('Kunde inte ladda bandata:', e);
        drawFallbackMap();
    }

    // UI Event Listeners
    setupEventListeners();

    // Start render loop
    requestAnimationFrame(renderLoop);
}

function resizeCanvas() {
    canvasW = window.innerWidth;
    canvasH = window.innerHeight;
    canvas.width = canvasW * window.devicePixelRatio;
    canvas.height = canvasH * window.devicePixelRatio;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

// ============================================
// HOLE LOADING
// ============================================
function loadHole(index) {
    if (!currentCourse) return;
    const holes = currentCourse.holeData;
    currentHoleIndex = ((index % holes.length) + holes.length) % holes.length;
    const hole = holes[currentHoleIndex];

    // Center map between tee and green
    if (hole.green && hole.green.center && hole.tee) {
        mapCenterLat = (hole.tee.lat + hole.green.center.lat) / 2;
        mapCenterLon = (hole.tee.lon + hole.green.center.lon) / 2;

        // Calculate heading and zoom
        const dy = hole.green.center.lat - hole.tee.lat;
        const dx = Math.cos(hole.tee.lat * Math.PI / 180) * (hole.green.center.lon - hole.tee.lon);
        mapRotation = -(Math.atan2(dx, dy) * 180 / Math.PI);

        // Zoom based on hole length — higher = more zoomed in
        const dist = hole.distances ? (hole.distances[currentTee] || 350) : 350;
        if (dist < 200) mapZoom = 19.0;
        else if (dist < 350) mapZoom = 18.2;
        else if (dist < 450) mapZoom = 17.8;
        else mapZoom = 17.4;
    }

    // Load satellite imagery
    loadSatelliteImage();

    // Update HUD
    updateHUD(hole);

    // Show strategy tip
    showStrategy(hole);
}

function loadSatelliteImage() {
    satLoaded = false;
    const zoom = Math.round(mapZoom + 1);
    const size = `${Math.min(640, canvasW)}x${Math.min(640, canvasH)}`;

    satImage = new Image();
    satImage.crossOrigin = 'anonymous';
    satImage.onload = () => { satLoaded = true; };
    satImage.onerror = () => {
        console.warn('Satellite image load failed, using fallback');
        satLoaded = false;
    };

    // Google Static Maps API
    satImage.src = `https://maps.googleapis.com/maps/api/staticmap?center=${mapCenterLat},${mapCenterLon}&zoom=${zoom}&size=640x640&maptype=satellite&key=${GOOGLE_API_KEY}&scale=2`;
}

// ============================================
// HUD UPDATE
// ============================================
function updateHUD(hole) {
    // Hole number
    document.getElementById('hole-number').textContent = String(hole.hole).padStart(2, '0');
    document.getElementById('hole-par').textContent = `PAR ${hole.par}`;
    document.getElementById('hole-hcp').textContent = `Handicap ${hole.hcp || hole.si || '—'}`;
    document.getElementById('course-name').textContent = currentCourse.shortName || currentCourse.name;

    // Distances
    const dist = hole.distances || {};
    const d = dist[currentTee] || dist.gul || 0;

    // Front/Middle/Back estimation (standard: front = -10m, back = +10m from center)
    const front = d > 0 ? d + 10 : '—';
    const middle = d > 0 ? d : '—';
    const back = d > 0 ? d - 10 : '—';

    document.getElementById('dist-front').textContent = front;
    document.getElementById('dist-middle').textContent = middle;
    document.getElementById('dist-back').textContent = back;

    // Elevation
    const elevEl = document.getElementById('dist-elev');
    if (hole.elevation && hole.elevation.drop_m !== undefined) {
        const drop = hole.elevation.drop_m;
        if (drop < 0) {
            elevEl.textContent = `↓ ${Math.abs(drop)}m`;
            elevEl.className = 'dist-elev down';
        } else if (drop > 0) {
            elevEl.textContent = `↑ ${drop}m`;
            elevEl.className = 'dist-elev up';
        } else {
            elevEl.textContent = '→ 0m';
            elevEl.className = 'dist-elev';
        }
    } else {
        elevEl.textContent = '';
    }
}

function showStrategy(hole) {
    const tip = document.getElementById('strategy-tip');
    const text = document.getElementById('strategy-text');
    if (hole.strategy || hole.description) {
        text.textContent = hole.strategy || hole.description;
        setTimeout(() => tip.classList.add('visible'), 500);
        // Auto-hide after 6s
        setTimeout(() => tip.classList.remove('visible'), 7000);
    } else {
        tip.classList.remove('visible');
    }
}

// ============================================
// RENDERING
// ============================================
function renderLoop() {
    draw();
    requestAnimationFrame(renderLoop);
}

function draw() {
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Draw satellite base
    if (satLoaded && satImage) {
        drawSatellite();
    } else {
        drawFallbackMap();
    }

    // Draw hole overlay
    if (currentCourse) {
        drawHoleOverlay();
    }
}

function drawSatellite() {
    ctx.save();

    // Apply rotation around center
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate(mapRotation * Math.PI / 180);

    // Scale to fill
    const scaleX = canvasW / satImage.naturalWidth * window.devicePixelRatio;
    const scaleY = canvasH / satImage.naturalHeight * window.devicePixelRatio;
    const scale = Math.max(scaleX, scaleY) * 1.3; // 30% overscale for rotation

    ctx.drawImage(
        satImage,
        -satImage.naturalWidth * scale / (2 * window.devicePixelRatio),
        -satImage.naturalHeight * scale / (2 * window.devicePixelRatio),
        satImage.naturalWidth * scale / window.devicePixelRatio,
        satImage.naturalHeight * scale / window.devicePixelRatio
    );

    ctx.restore();

    // Darken edges (vignette)
    const gradient = ctx.createRadialGradient(
        canvasW / 2, canvasH / 2, canvasH * 0.3,
        canvasW / 2, canvasH / 2, canvasH * 0.7
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasW, canvasH);
}

function drawFallbackMap() {
    // Stylized procedural golf hole map
    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate(mapRotation * Math.PI / 180);

    // Dark green background (forest)
    ctx.fillStyle = '#0d2818';
    ctx.fillRect(-canvasW, -canvasH, canvasW * 2, canvasH * 2);

    if (!currentCourse) { ctx.restore(); return; }
    const hole = currentCourse.holeData[currentHoleIndex];
    if (!hole || !hole.tee || !hole.green || !hole.green.center) { ctx.restore(); return; }

    const scale = getMapScale();

    // Tee position in local coords
    const teeX = lngToX(hole.tee.lon, scale);
    const teeY = latToY(hole.tee.lat, scale);
    const greenX = lngToX(hole.green.center.lon, scale);
    const greenY = latToY(hole.green.center.lat, scale);

    // Draw surrounding forest
    drawForest(scale);

    // Draw rough
    ctx.fillStyle = '#1a4028';
    ctx.beginPath();
    const roughWidth = 120;
    const dx = greenX - teeX;
    const dy = greenY - teeY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = -dy / len * roughWidth;
    const ny = dx / len * roughWidth;

    ctx.moveTo(teeX + nx * 0.6, teeY + ny * 0.6);
    ctx.quadraticCurveTo(teeX + dx * 0.3 + nx * 1.1, teeY + dy * 0.3 + ny * 1.1, teeX + dx * 0.55 + nx * 1.2, teeY + dy * 0.55 + ny * 1.2);
    ctx.quadraticCurveTo(greenX + nx * 1.3, greenY + ny * 1.3, greenX + nx * 0.9, greenY + ny * 0.9);
    ctx.lineTo(greenX - nx * 0.9, greenY - ny * 0.9);
    ctx.quadraticCurveTo(greenX - nx * 1.3, greenY - ny * 1.3, teeX + dx * 0.55 - nx * 1.2, teeY + dy * 0.55 - ny * 1.2);
    ctx.quadraticCurveTo(teeX + dx * 0.3 - nx * 1.1, teeY + dy * 0.3 - ny * 1.1, teeX - nx * 0.6, teeY - ny * 0.6);
    ctx.closePath();
    ctx.fill();

    // Draw fairway
    ctx.fillStyle = '#1f5c35';
    const fwWidth = 70;
    const fnx = -dy / len * fwWidth;
    const fny = dx / len * fwWidth;

    ctx.beginPath();
    ctx.moveTo(teeX + fnx * 0.3, teeY + fny * 0.3);

    // Landing zone (wider — organic shape)
    const lzT = 0.55;
    const lzX = teeX + dx * lzT;
    const lzY = teeY + dy * lzT;
    ctx.quadraticCurveTo(lzX + fnx * 1.15, lzY + fny * 1.15, greenX + fnx * 0.7, greenY + fny * 0.7);
    ctx.lineTo(greenX - fnx * 0.7, greenY - fny * 0.7);
    ctx.quadraticCurveTo(lzX - fnx * 1.15, lzY - fny * 1.15, teeX - fnx * 0.3, teeY - fny * 0.3);
    ctx.closePath();
    ctx.fill();

    // Fairway stripes (mowing pattern)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 3;
    for (let t = 0; t < 1; t += 0.025) {
        const sx = teeX + dx * t;
        const sy = teeY + dy * t;
        if (Math.floor(t / 0.05) % 2 === 0) {
            ctx.beginPath();
            ctx.moveTo(sx + fnx * 0.7, sy + fny * 0.7);
            ctx.lineTo(sx - fnx * 0.7, sy - fny * 0.7);
            ctx.stroke();
        }
    }

    // Draw Tee Box
    ctx.fillStyle = '#2d7a4a';
    ctx.save();
    ctx.translate(teeX, teeY);
    ctx.rotate(Math.atan2(dy, dx));
    roundRect(ctx, -8, -5, 16, 10, 2);
    ctx.fill();
    ctx.restore();

    // Draw Green (ellipse) — larger, proportional to real green
    ctx.fillStyle = '#3da864';
    ctx.beginPath();
    ctx.ellipse(greenX, greenY, 42, 32, Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.fill();

    // Green collar
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(greenX, greenY, 42, 32, Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.stroke();

    // Green contour rings
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(greenX, greenY, 34, 25, Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(greenX, greenY, 24, 18, Math.atan2(dy, dx) + 0.1, 0, Math.PI * 2);
    ctx.stroke();

    // Draw bunkers
    if (hole.hazards) {
        hole.hazards.forEach((h, idx) => {
            if (h.type === 'bunker' && h.position) {
                const bx = lngToX(h.position.lon, scale);
                const by = latToY(h.position.lat, scale);
                // Bunker shadow
                ctx.fillStyle = 'rgba(0,0,0,0.2)';
                ctx.beginPath();
                ctx.ellipse(bx + 2, by + 2, 20, 14, 0.3 + idx * 0.2, 0, Math.PI * 2);
                ctx.fill();
                // Bunker fill (sand)
                ctx.fillStyle = '#d4b96a';
                ctx.beginPath();
                ctx.ellipse(bx, by, 20, 14, 0.3 + idx * 0.2, 0, Math.PI * 2);
                ctx.fill();
                // Bunker lip
                ctx.strokeStyle = 'rgba(140, 110, 60, 0.6)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        });
    }

    // Draw flagstick
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(greenX, greenY);
    ctx.lineTo(greenX, greenY - 32);
    ctx.stroke();

    // Flag (larger)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(greenX, greenY - 32);
    ctx.lineTo(greenX + 16, greenY - 26);
    ctx.lineTo(greenX, greenY - 20);
    ctx.closePath();
    ctx.fill();

    // Flag glow
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw shot trace (dashed line tee → green)
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(teeX, teeY);
    if (hole.fairway && hole.fairway.landingZone) {
        const lzPx = lngToX(hole.fairway.landingZone.lon, scale);
        const lzPy = latToY(hole.fairway.landingZone.lat, scale);
        ctx.lineTo(lzPx, lzPy);
        ctx.lineTo(greenX, greenY);
    } else {
        ctx.lineTo(greenX, greenY);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Distance labels on the fairway
    if (hole.fairway && hole.fairway.landingZone) {
        const lzPx = lngToX(hole.fairway.landingZone.lon, scale);
        const lzPy = latToY(hole.fairway.landingZone.lat, scale);

        // Landing zone marker
        ctx.fillStyle = 'rgba(250, 204, 21, 0.8)';
        ctx.beginPath();
        ctx.arc(lzPx, lzPy, 5, 0, Math.PI * 2);
        ctx.fill();

        // Driver distance badge
        drawDistanceBadge(lzPx, lzPy - 22, 'DRIVER', hole.fairway.landingZone.distFromTee);
    }

    // Tee marker (player position indicator)
    // Glow
    ctx.shadowColor = '#60a5fa';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(teeX, teeY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Inner dot
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(teeX, teeY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Pulsing ring on tee
    const pulseTime = (Date.now() % 2000) / 2000;
    const pulseRadius = 10 + pulseTime * 35;
    const pulseAlpha = 1 - pulseTime;
    ctx.strokeStyle = `rgba(96, 165, 250, ${pulseAlpha * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(teeX, teeY, pulseRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Second pulse (offset)
    const pulseTime2 = ((Date.now() + 1000) % 2000) / 2000;
    const pulseRadius2 = 10 + pulseTime2 * 35;
    const pulseAlpha2 = 1 - pulseTime2;
    ctx.strokeStyle = `rgba(96, 165, 250, ${pulseAlpha2 * 0.3})`;
    ctx.beginPath();
    ctx.arc(teeX, teeY, pulseRadius2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
}

function drawForest(scale) {
    // Procedural forest dots around the hole
    const hole = currentCourse.holeData[currentHoleIndex];
    if (!hole) return;

    const seed = hole.hole * 137;
    const pseudoRandom = (i) => {
        const x = Math.sin(seed + i * 9301 + 49297) * 233280;
        return x - Math.floor(x);
    };

    for (let i = 0; i < 400; i++) {
        const r = pseudoRandom(i);
        const angle = pseudoRandom(i + 500) * Math.PI * 2;
        const dist = 120 + r * 600;
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist;
        const size = 6 + pseudoRandom(i + 1000) * 20;

        // Check if inside fairway corridor — skip
        const teeX = lngToX(hole.tee.lon, scale);
        const teeY = latToY(hole.tee.lat, scale);
        const greenX = lngToX(hole.green.center.lon, scale);
        const greenY = latToY(hole.green.center.lat, scale);

        const fDx = greenX - teeX;
        const fDy = greenY - teeY;
        const fLen = Math.sqrt(fDx * fDx + fDy * fDy);
        const projT = ((x - teeX) * fDx + (y - teeY) * fDy) / (fLen * fLen);
        const projX = teeX + projT * fDx;
        const projY = teeY + projT * fDy;
        const distToLine = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);

        if (projT > -0.1 && projT < 1.1 && distToLine < 55) continue;

        const shade = 0.06 + pseudoRandom(i + 2000) * 0.08;
        ctx.fillStyle = `rgba(20, ${60 + pseudoRandom(i + 3000) * 40}, 30, ${shade + 0.3})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawDistanceBadge(x, y, label, dist) {
    ctx.save();
    const text = `${dist}`;
    ctx.font = '700 13px Inter, sans-serif';
    const textW = ctx.measureText(text).width;
    const labelW = ctx.measureText(label).width;
    const totalW = Math.max(textW, labelW) + 16;

    // Badge background
    ctx.fillStyle = 'rgba(10, 20, 12, 0.85)';
    roundRect(ctx, x - totalW / 2, y - 18, totalW, 34, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5;
    roundRect(ctx, x - totalW / 2, y - 18, totalW, 34, 8);
    ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '700 8px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x, y - 14);

    // Distance
    ctx.fillStyle = 'white';
    ctx.font = '800 14px Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y - 2);

    ctx.restore();
}

function drawHoleOverlay() {
    // Additional overlay elements drawn on top of satellite
    // (Future: shot tracking, target marker, etc.)
}

// ============================================
// MAP MATH
// ============================================
function getMapScale() {
    // Pixels per degree at current zoom
    const metersPerDeg = 111320 * Math.cos(mapCenterLat * Math.PI / 180);
    const metersPerPixel = 156543.03392 * Math.cos(mapCenterLat * Math.PI / 180) / Math.pow(2, mapZoom);
    return metersPerDeg / metersPerPixel;
}

function latToY(lat, scale) {
    if (!scale) scale = getMapScale();
    return -(lat - mapCenterLat) * scale;
}

function lngToX(lng, scale) {
    if (!scale) scale = getMapScale();
    const metersPerDegLon = 111320 * Math.cos(mapCenterLat * Math.PI / 180);
    const metersPerDegLat = 111320;
    return (lng - mapCenterLon) * scale * (metersPerDegLon / metersPerDegLat);
}

// ============================================
// HELPERS
// ============================================
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
}

// ============================================
// EVENT HANDLING
// ============================================
function setupEventListeners() {
    // Hole navigation
    document.getElementById('btn-prev-hole').addEventListener('click', () => {
        loadHole(currentHoleIndex - 1);
    });
    document.getElementById('btn-next-hole').addEventListener('click', () => {
        loadHole(currentHoleIndex + 1);
    });

    // Hole selector
    document.getElementById('btn-hole-select').addEventListener('click', openHoleSelector);
    document.getElementById('hole-selector-close').addEventListener('click', closeHoleSelector);
    document.getElementById('hole-nav-center').addEventListener('click', openHoleSelector);

    // Flyover
    document.getElementById('btn-flyover').addEventListener('click', openFlyover);
    document.getElementById('flyover-close').addEventListener('click', closeFlyover);

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;

            if (tab === 'flyover') {
                openFlyover();
            } else if (tab === 'approach') {
                // Future: Switch to fairway.html view
                window.location.href = 'fairway.html';
            } else if (tab === 'putt') {
                // Future: Switch to green AR view
                window.location.href = 'index.html';
            }
        });
    });

    // Strategy tip close
    document.getElementById('strategy-close').addEventListener('click', () => {
        document.getElementById('strategy-tip').classList.remove('visible');
    });

    // 3D toggle (future)
    document.getElementById('btn-3d-toggle').addEventListener('click', () => {
        window.location.href = 'fairway.html';
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') loadHole(currentHoleIndex - 1);
        if (e.key === 'ArrowRight') loadHole(currentHoleIndex + 1);
        if (e.key === 'Escape') {
            closeFlyover();
            closeHoleSelector();
        }
    });

    // Swipe navigation
    let touchStartX = 0;
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 80) {
            if (diff > 0) loadHole(currentHoleIndex + 1);
            else loadHole(currentHoleIndex - 1);
        }
    }, { passive: true });
}

// ============================================
// HOLE SELECTOR
// ============================================
function openHoleSelector() {
    const overlay = document.getElementById('hole-selector');
    const grid = document.getElementById('hole-grid');
    grid.innerHTML = '';

    currentCourse.holeData.forEach((h, i) => {
        const btn = document.createElement('button');
        btn.className = 'hole-grid-btn';
        if (i === currentHoleIndex) btn.classList.add('active');
        if (i === 0) btn.classList.add('has-3d'); // Only hole 1 has full 3D

        btn.innerHTML = `
            <span>${h.hole}</span>
            <span class="hole-par">P${h.par}</span>
        `;

        btn.addEventListener('click', () => {
            loadHole(i);
            closeHoleSelector();
        });

        grid.appendChild(btn);
    });

    // Scorecard
    let outPar = 0, inPar = 0;
    currentCourse.holeData.forEach(h => {
        if (h.hole <= 9) outPar += h.par;
        else inPar += h.par;
    });
    document.getElementById('sc-out').textContent = outPar;
    document.getElementById('sc-in').textContent = inPar;
    document.getElementById('sc-total').textContent = outPar + inPar;

    overlay.classList.add('active');
}

function closeHoleSelector() {
    document.getElementById('hole-selector').classList.remove('active');
}

// ============================================
// FLYOVER
// ============================================
function openFlyover() {
    const hole = currentCourse.holeData[currentHoleIndex];
    const overlay = document.getElementById('flyover-overlay');
    const iframe = document.getElementById('flyover-iframe');

    // Pass coordinates to flyover via URL params
    const tee = hole.tee;
    const green = hole.green ? hole.green.center : null;

    if (tee && green) {
        iframe.src = `flyover3d.html?tee=${tee.lat},${tee.lon}&green=${green.lat},${green.lon}&hole=${hole.hole}&par=${hole.par}&course=${encodeURIComponent(currentCourse.shortName)}&dist=${hole.distances ? hole.distances[currentTee] : ''}`;
    } else {
        iframe.src = 'flyover.html';
    }

    overlay.classList.add('active');
}

function closeFlyover() {
    const overlay = document.getElementById('flyover-overlay');
    const iframe = document.getElementById('flyover-iframe');
    overlay.classList.remove('active');
    iframe.src = 'about:blank';

    // Reset tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="hole"]').classList.add('active');
}

// ============================================
// START
// ============================================
document.addEventListener('DOMContentLoaded', init);
