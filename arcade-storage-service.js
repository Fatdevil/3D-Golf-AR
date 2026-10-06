// ================================================================
//  ARCADE STORAGE SERVICE — Centralized localStorage layer
//  All localStorage reads/writes go through these functions.
//
//  Extracted from arcade.html — Compatibility contract:
//  - window.ArcadeStorage namespace
//  - Handles JSON parse/stringify internally
//  - Pako decompression for compressed course data
// ================================================================
window.ArcadeStorage = {

    // ----- KEYS -----
    KEYS: {
        PRO_MODE:       'arcade_pro_mode',
        HUD_PREFS:      'golf_os_hud_prefs',
        CUSTOM_LEVEL:   'arcade_custom_level',
        CUSTOM_LEVEL_Z: 'arcade_custom_level_z',
        MY_DRAFTS:      'golf_os_my_drafts',
    },

    // ----- PRO MODE -----
    getProMode() {
        return localStorage.getItem(this.KEYS.PRO_MODE) === '1';
    },
    setProMode(enabled) {
        localStorage.setItem(this.KEYS.PRO_MODE, enabled ? '1' : '0');
    },

    // ----- HUD PREFERENCES -----
    getHudPrefs() {
        const raw = localStorage.getItem(this.KEYS.HUD_PREFS);
        return JSON.parse(raw || '["TOTAL_LENGTH", "CARRY", "BALL_SPEED", "CLUB_SPEED"]');
    },
    setHudPrefs(prefs) {
        localStorage.setItem(this.KEYS.HUD_PREFS, JSON.stringify(prefs));
    },

    // ----- CUSTOM LEVEL (targets + holes snapshot) -----
    saveCustomLevel(data) {
        localStorage.setItem(this.KEYS.CUSTOM_LEVEL, JSON.stringify(data));
    },
    loadCustomLevel() {
        const raw = localStorage.getItem(this.KEYS.CUSTOM_LEVEL);
        return raw ? JSON.parse(raw) : null;
    },
    removeCustomLevel() {
        localStorage.removeItem(this.KEYS.CUSTOM_LEVEL);
    },

    // ----- COMPRESSED LEVEL (pako) -----
    loadCompressedLevel() {
        const lsZ = localStorage.getItem(this.KEYS.CUSTOM_LEVEL_Z);
        if (!lsZ || typeof pako === 'undefined') return null;
        try {
            const binaryStr = atob(lsZ);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            const jsonStr = pako.inflate(bytes, { to: 'string' });
            const parsed = JSON.parse(jsonStr);
            console.log('✅ Loaded COMPRESSED course (' + (lsZ.length / 1024).toFixed(1) + 'KB)');
            return parsed;
        } catch (e) {
            console.error('Decompression failed:', e);
            return null;
        }
    },

    // ----- DRAFTS -----
    getDrafts() {
        return JSON.parse(localStorage.getItem(this.KEYS.MY_DRAFTS) || '[]');
    },
    saveDrafts(drafts) {
        localStorage.setItem(this.KEYS.MY_DRAFTS, JSON.stringify(drafts));
    },
    addOrUpdateDraft(code, name) {
        const drafts = this.getDrafts();
        const existing = drafts.find(d => d.code === code);
        if (existing) {
            existing.name = name;
            existing.date = new Date().toISOString();
        } else {
            drafts.push({ code, name, date: new Date().toISOString() });
        }
        this.saveDrafts(drafts);
    },

    removeDraft(code) {
        this.saveDrafts(this.getDrafts().filter(d => d.code !== code));
    },

    // ----- INDEXEDDB: FULL COURSE PERSISTENCE (Heightmap + Textures + Holes + Trees) -----
    _db: null,
    _openDB() {
        if (this._db) return Promise.resolve(this._db);
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                return reject(new Error('IndexedDB not supported'));
            }
            const req = indexedDB.open('GolfOS_Storage', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('course_drafts')) {
                    db.createObjectStore('course_drafts');
                }
            };
            req.onsuccess = (e) => {
                this._db = e.target.result;
                resolve(this._db);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async saveFullDraft(key = 'quick_draft', data) {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('course_drafts', 'readwrite');
                const store = tx.objectStore('course_drafts');
                const payload = Object.assign({}, data, {
                    _fullSave: true,
                    savedAt: Date.now()
                });
                const req = store.put(payload, key);
                req.onsuccess = () => {
                    // Also save light metadata snapshot to localStorage for synchronous checks
                    try {
                        const meta = {
                            hasFullDraft: true,
                            savedAt: payload.savedAt,
                            name: data.name || 'Quick Draft',
                            holeCount: (data.holes && data.holes.length) || 1,
                            totalPar: data.total_par || 4
                        };
                        localStorage.setItem(this.KEYS.CUSTOM_LEVEL, JSON.stringify(meta));
                    } catch(err) {}
                    resolve(true);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        } catch(e) {
            console.warn('[STORAGE] IndexedDB save fallback:', e);
            this.saveCustomLevel(data);
            return false;
        }
    },

    async loadFullDraft(key = 'quick_draft') {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('course_drafts', 'readonly');
                const store = tx.objectStore('course_drafts');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch(e) {
            console.warn('[STORAGE] IndexedDB load fallback:', e);
            return null;
        }
    },

    async deleteFullDraft(key = 'quick_draft') {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('course_drafts', 'readwrite');
                const store = tx.objectStore('course_drafts');
                const req = store.delete(key);
                req.onsuccess = () => {
                    this.removeCustomLevel();
                    resolve(true);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        } catch(e) {
            this.removeCustomLevel();
            return false;
        }
    }
};
