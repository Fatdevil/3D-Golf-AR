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
    }
};
