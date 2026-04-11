/* ============================================
   GreenRead AR — 3D Flyover Engine (Fas 1)
   Drivs av CesiumJS + Google Photorealistic 3D Tiles
   ============================================ */

const GOOGLE_API_KEY = "AIzaSyAX0hFTbQ5utdLQIM4gyXnqZElEMJTM3DU";

// Vi bevarar vår 3D-motor i en global variabel så vi kan flytta kameran senare
let currentViewer = null;
let activeGreenLon = 0, activeGreenLat = 0, activeHeading = 0;

const btn = document.getElementById('btn-fly');

// Parse URL parameters (from hole guide)
const urlParams = new URLSearchParams(window.location.search);

if (urlParams.has('tee')) {
    const teeParts = urlParams.get('tee').split(',');
    document.getElementById('tee-input').value = `${teeParts[0].trim()}, ${teeParts[1].trim()}`;
}
if (urlParams.has('green')) {
    const greenParts = urlParams.get('green').split(',');
    document.getElementById('green-input').value = `${greenParts[0].trim()}, ${greenParts[1].trim()}`;
}
if (urlParams.has('hole')) {
    const hudName = document.getElementById('hud-hole-name');
    if (hudName) hudName.textContent = `Hål ${urlParams.get('hole')}`;
}
if (urlParams.has('course')) {
    const hudCourse = document.getElementById('hud-course-name');
    if (hudCourse) hudCourse.textContent = decodeURIComponent(urlParams.get('course'));
}
if (urlParams.has('par')) {
    const hudPar = document.getElementById('hud-par');
    if (hudPar) hudPar.textContent = `PAR ${urlParams.get('par')}`;
}
if (urlParams.has('dist')) {
    const hudDist = document.getElementById('hud-dist');
    if (hudDist) hudDist.textContent = `${urlParams.get('dist')}m`;
}

// Starta programmet när HTML är laddat
document.addEventListener("DOMContentLoaded", () => {
    btn.innerText = "Laddar 3D-motorn...";
    initCesium();
});

async function initCesium() {
    Cesium.Ion.defaultAccessToken = null; 
    Cesium.GoogleMaps.defaultApiKey = GOOGLE_API_KEY; 
    
    // Initiera 3D-vyn med rätt inställningar för Google Tiles
    currentViewer = new Cesium.Viewer('cesiumContainer', {
        globe: false, // Mycket viktigt: Stänger av Cesiums standardjord som annars krockar och blir svart
        baseLayerPicker: false,
        geocoder: false,
        animation: false,
        timeline: false,
        homeButton: false,
        fullscreenButton: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        infoBox: false,
        selectionIndicator: false
    });
    
    // Ställ in himlen (ta inte bort skyBox, då blir himlen helt svart!)
    currentViewer.scene.skyAtmosphere.hueShift = -0.1;
    currentViewer.scene.skyAtmosphere.saturationShift = 0.2; 

    // Ladda Googles 3D-Städer
    try {
        const tileset = await Cesium.createGooglePhotorealistic3DTileset();
        currentViewer.scene.primitives.add(tileset);
    } catch (e) {
        btn.innerText = "❌ Fel: Kunde inte ansluta till Google";
        btn.style.background = "#EF4444";
        console.error(e);
        return;
    }

    // -------------------------------------------------------------
    // Knyt UI-knapparna till koden
    // -------------------------------------------------------------
    
    // 1. Ladda initiala koordinater direkt från input-fälten
    updateCourseFromUI();

    // 2. Klick på "Ladda Ny Bana"
    document.getElementById('btn-update-course').addEventListener('click', updateCourseFromUI);
    
    // 3. Klick på drönar-knappen
    btn.addEventListener('click', startFlyover);
}

// ============================================
// HÄMTAR KOORDINATER FRÅN MENYN OCH LADDAR OMVÄRLDEN
// ============================================
function updateCourseFromUI() {
    if (!currentViewer) return;

    // Få ut strängarna från formuläret
    const teeString = document.getElementById('tee-input').value;
    const greenString = document.getElementById('green-input').value;

    const teeVals = teeString.split(',');
    const greenVals = greenString.split(',');

    const teeLat = parseFloat(teeVals[0].trim());
    const teeLon = parseFloat(teeVals[1].trim());

    activeGreenLat = parseFloat(greenVals[0].trim());
    activeGreenLon = parseFloat(greenVals[1].trim());

    // Beräkna kompassriktning mellan Tee och Green med lite trigonometri
    // (Så kameran *alltid* tittar rakt mot flaggan, oavsett vilka koordinater du slår in!)
    const y = activeGreenLat - teeLat;
    const x = Math.cos(Cesium.Math.toRadians(teeLat)) * (activeGreenLon - teeLon);
    activeHeading = Math.atan2(x, y); 
    
    let headingDegrees = Cesium.Math.toDegrees(activeHeading);
    if (headingDegrees < 0) headingDegrees += 360;

    // Flytta kameran till Tee Box (15m ovan mark — Norrmjöle är flack norrlandsterräng)
    const teePosition = Cesium.Cartesian3.fromDegrees(teeLon, teeLat, 15.0); 
    
    currentViewer.camera.setView({
        destination: teePosition,
        orientation: {
            heading: activeHeading, // Riktar in kompassen exakt mot ditt green-mål
            pitch: Cesium.Math.toRadians(-12.0), // Tittar svagt snett neråt mot fairwaysen
            roll: 0.0
        }
    });

    // Återställ startknappen
    btn.innerText = "🚁 Starta Drönarflygning";
    btn.style.background = "#22C55E";
}


// ============================================
// ANIMERING AV DRÖNAREN NER MOT GREENEN
// ============================================
function startFlyover() {
    if (!currentViewer) return;

    if (btn.innerText.includes("LiDAR")) {
        alert("Putt-motorn körs igång! Här bygger vi övergången från Google Tiles till din LiDAR-Green.");
        return;
    }

    btn.innerText = "Sveper över fairway...";
    
    // Vi lägger kameran precis kort om greenen så man ser hela ö-greenen framför sig
    // En liten offset bakåt på latitud/longitud beroende på heading skulle vara coolt, men vi dyker nära först
    currentViewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(activeGreenLon, activeGreenLat, 25), // Dyk ner mot 25 meter höjd över din Green-koordinat
        orientation: {
            heading: activeHeading, // Fortsätt titta rakt fram mot hålet under flygningen
            pitch: Cesium.Math.toRadians(-40.0), // Titta brantare ner i backen mot flaggan för att fånga ö-känslan
            roll: 0.0
        },
        duration: 10.0, // Sekunder flygningen tar
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
        complete: function() {
            // Animeringen är klar! Dags att ladda Transport-läget (2.5D).
            btn.innerHTML = `
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: -4px;">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>Gå till bollen (Fairway)</span>
            `;
            btn.style.background = "linear-gradient(135deg, #10B981 0%, #059669 100%)";
            btn.style.boxShadow = "0 8px 30px rgba(16, 185, 129, 0.4)";
            
            // Uppdatera event-lyssnaren så nästa klick leder till 2.5D-kartan
            btn.removeEventListener('click', startFlyover);
            btn.addEventListener('click', () => {
                // Snygg fade out-effekt
                document.body.style.transition = "opacity 0.5s ease";
                document.body.style.opacity = "0";
                setTimeout(() => {
                    window.location.href = "fairway.html";
                }, 500);
            });
            
            // En subtil pan-effekt för att titta runt greenen medan man väntar på klick
            currentViewer.camera.lookRight(Cesium.Math.toRadians(0.5));
        }
    });
}
