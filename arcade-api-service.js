// ================================================================
//  ARCADE API SERVICE — Centralized HTTP API layer
//  All Railway backend communication goes through these functions.
//
//  Extracted from arcade.html — Compatibility contract:
//  - window.ArcadeAPI namespace
//  - Each method returns a Promise with parsed JSON
//  - Error handling: callers still catch errors themselves
//  - Auth: includes x-user-id header via GolfAuth when available
// ================================================================
window.ArcadeAPI = {

    /**
     * Get auth-aware headers for requests.
     */
    _headers(extra) {
        const h = { 'Content-Type': 'application/json' };
        if (window.GolfAuth && window.GolfAuth.userId) {
            h['x-user-id'] = window.GolfAuth.userId;
        }
        return Object.assign(h, extra || {});
    },

    /**
     * Fetch all cloud assets from the backend.
     * Used by: fetchCloudAssets()
     */
    async getAssets() {
        const res = await fetch('/api/assets');
        return res.json();
    },

    /**
     * Fetch available biomes from the backend.
     * Used by: fetchBiomes()
     */
    async getBiomes() {
        const res = await fetch('/api/biomes');
        return res.json();
    },

    /**
     * Download a specific asset model by cloud ID.
     * Returns: { url, blob } or throws
     */
    async downloadAsset(cloudId) {
        const res = await fetch('/api/assets/' + cloudId + '/download');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        return { url, blob };
    },

    /**
     * Save or update a course to the backend.
     * @param {Object} payload — full course payload
     * @returns {Object} — { success, share_code, error }
     */
    async saveCourse(payload) {
        const res = await fetch('/api/courses', {
            method: 'POST',
            headers: this._headers(),
            body: JSON.stringify(payload)
        });
        return res.json();
    },

    /**
     * Load a course by share code or edit code.
     * @param {string} code — share_code or edit_code
     * @returns {Object} — course data or { error }
     */
    async loadCourse(code) {
        const res = await fetch('/api/courses/' + code, {
            headers: this._headers()
        });
        return res.json();
    },

    /**
     * Submit round result for leaderboard.
     * @param {string} courseCode
     * @param {Object} result — { total_score, score_vs_par, hole_scores, input_mode, lm_device, stats, player_name }
     * @param {Object} [opts] — { keepalive: true } lets the request finish after the page has moved on
     */
    async submitResult(courseCode, result, opts) {
        const res = await fetch('/api/courses/' + courseCode + '/results', {
            method: 'POST',
            headers: this._headers(),
            body: JSON.stringify(result),
            keepalive: !!(opts && opts.keepalive)
        });
        return res.json();
    },

    /**
     * Get leaderboard for a course.
     * @param {string} courseCode
     * @param {string} mode — 'LAUNCH_MONITOR' | 'SWING_METER' | null
     * @param {string} period — 'month' | 'all' | null
     */
    async getLeaderboard(courseCode, mode, period) {
        let params = new URLSearchParams();
        if (mode) params.set('mode', mode);
        if (period) params.set('period', period);
        const res = await fetch('/api/courses/' + courseCode + '/leaderboard?' + params.toString(), {
            headers: this._headers()
        });
        return res.json();
    },

    /**
     * Get a course collection by ID.
     * @param {string} collectionId
     * @returns {Object} — collection data or { error }
     */
    async getCollection(collectionId) {
        const res = await fetch('/api/collections/' + collectionId, {
            headers: this._headers()
        });
        return res.json();
    },

    // --- ASSET PRESETS ---

    /**
     * Get all asset presets for the authenticated user.
     * @returns {Array} — [{ id, name, assets, created_at, updated_at }]
     */
    async getAssetPresets() {
        const res = await fetch('/api/asset-presets', {
            headers: this._headers()
        });
        return res.json();
    },

    /**
     * Create or update an asset preset.
     * @param {Object} preset — { id (null=new), name, assets: [{key, source, ...}] }
     * @returns {Object} — { success, id }
     */
    async saveAssetPreset(preset) {
        const res = await fetch('/api/asset-presets', {
            method: 'POST',
            headers: this._headers(),
            body: JSON.stringify(preset)
        });
        return res.json();
    },

    /**
     * Delete an asset preset.
     * @param {string} id — preset ID
     * @returns {Object} — { success, deleted }
     */
    async deleteAssetPreset(id) {
        const res = await fetch('/api/asset-presets/' + id, {
            method: 'DELETE',
            headers: this._headers()
        });
        return res.json();
    }
};
