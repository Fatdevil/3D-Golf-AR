// ================================================================
//  PRACTICE RANGE — a ready range to hit to at once (window.RangeTemplate)
//  A Range Tee with its mat at one end, and three real greens (built by the green builder, with their flags) down the range, a little to
//  either side: approach practice can play to any of them from any distance, so three are plenty (a course holds three holes).
//  Two ways in, both from the hub: play it straight away (nothing is saved on this device, so a draft of the player's own is left alone),
//  or start a range of one's own from it in the builder (then it is an ordinary new range, to change and publish).
//  layout() and outline() are plain maths, tested in tests/test_range_template.js; build() makes it in the open page.
// ================================================================
(function (root) {
    // Where things go: the tee near one end looking down the range (-Z), the greens at 60, 100 and 140 m from it, the near one a little
    // left, the far one a little right, each a little larger the further it is (a longer shot needs a bigger target)
    function layout() {
        const tee = { x: 0, z: 150, rot: Math.PI };
        const greens = [
            { dist: 60, side: -12, rx: 9, rz: 8 },
            { dist: 100, side: 10, rx: 11, rz: 9.5 },
            { dist: 140, side: -6, rx: 13, rz: 11 }
        ].map(function (g) {
            // down the range is (sin rot, cos rot); its right is (-cos rot, sin rot)
            const dx = Math.sin(tee.rot), dz = Math.cos(tee.rot), rx = -Math.cos(tee.rot), rz = Math.sin(tee.rot);
            return { x: tee.x + dx * g.dist + rx * g.side, z: tee.z + dz * g.dist + rz * g.side, rx: g.rx, rz: g.rz, dist: g.dist };
        });
        return { tee: tee, greens: greens };
    }
    // A green's outline: n points round an ellipse, each pushed in or out a little so it does not look stamped
    function outline(cx, cz, rx, rz, n) {
        const pts = [];
        for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2, wobble = 1 + 0.07 * Math.sin(a * 3 + 0.8) + 0.04 * Math.cos(a * 5);
            pts.push({ x: cx + Math.cos(a) * rx * wobble, z: cz + Math.sin(a) * rz * wobble });
        }
        return pts;
    }
    const api = { layout: layout, outline: outline };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document === 'undefined') { root.RangeTemplate = api; return; }

    function groundY(x, z) {
        const s = root.localGetTerrainAt ? root.localGetTerrainAt(x, -z) : null;
        return s && typeof s.z === 'number' ? s.z : 0;
    }

    // Builds it on the open (empty) range: the tee on the first hole, a green on each hole. Needs the builder's pieces (the page's own)
    api.build = function () {
        const THREE = root.THREE, holes = root.courseHoles;
        if (!THREE || !holes || !root.applyGreenPipeline || !root.captureGreenSnapshot || !root.createRangeTeeObject) return false;
        const L = layout(), first = holes[0];
        // the tee and its mat
        const ty = groundY(L.tee.x, L.tee.z);
        if (first.teeMeshes.range && root._arcadeScene) root._arcadeScene.remove(first.teeMeshes.range);
        first.tees.range = { x: L.tee.x, y: ty, z: L.tee.z, rot: L.tee.rot };
        first.teeMeshes.range = root.createRangeTeeObject(L.tee.x, ty, L.tee.z, L.tee.rot);
        // a green on each hole, as the green builder makes one (painted, shaped, its flag placed)
        L.greens.forEach(function (g, i) {
            const hole = holes[i];
            if (!hole) return;
            if (root.changeHoleTo) root.changeHoleTo(i);
            const pts = outline(g.x, g.z, g.rx, g.rz, 14).map(function (p) { return new THREE.Vector3(p.x, groundY(p.x, p.z), p.z); });
            const snap = root.captureGreenSnapshot(hole, pts, 25);
            hole.greenData = {
                points: pts.map(function (p) { return { x: p.x, y: p.y, z: p.z }; }),
                baseElevation: snap.baseElevation, bbox: snap.bbox, origHeights: snap.origHeights, origCanvasPixels: snap.origCanvasPixels,
                difficulty: 'EASY', elevationOffset: 0.4, blendDistance: 8, tiltPct: 0.015, tiltAim: true, tiltToFlag: true,
                stimp: 10, firmness: 'NORMAL', tension: 0.5, showContours: false, showBallPath: true, mowPattern: 'STRIPES',
                foregreenWidth: 1.5, edgeSharpness: 100, seedOffsetX: 37 * (i + 1), seedOffsetZ: -23 * (i + 1)
            };
            root.applyGreenPipeline(hole, true);
        });
        if (root.changeHoleTo) root.changeHoleTo(0);
        if (typeof root.rebuildRangeMarkers === 'function') root.rebuildRangeMarkers();
        if (root.RangePractice && root.RangePractice.refresh) root.RangePractice.refresh();
        return true;
    };

    root.RangeTemplate = api;
})(typeof window !== 'undefined' ? window : globalThis);
