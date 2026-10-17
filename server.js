require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const collectionsCore = require('./collections-core');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // För att tillåta stora base64-höjdkartor/bilder

// --- DATABAS ANSLUTNING ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway') 
       ? { rejectUnauthorized: false } 
       : false
});

// --- SCHEMA INITIALIZERING (Kan köras en gång) ---
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id SERIAL PRIMARY KEY,
                share_code VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                author VARCHAR(255) DEFAULT 'Anonymous',
                holes JSONB NOT NULL,
                targets JSONB DEFAULT '[]',
                trees JSONB DEFAULT '[]',
                terrain_heightmap TEXT,
                terrain_biomemap TEXT,
                theme_data JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Uppdatera existerande tabell om den saknar kolumnen
        try {
            await pool.query(`ALTER TABLE courses ADD COLUMN theme_data JSONB DEFAULT '{}';`);
            console.log("Database Migration: Added theme_data to courses");
        } catch (e) {
            // Kolumnen finns troligen redan
        }
        
        // Tabell för anpassade 3D-modeller (Assets)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS custom_assets (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                category VARCHAR(50) NOT NULL,
                subcategory VARCHAR(50) NOT NULL,
                icon VARCHAR(10),
                file_data TEXT NOT NULL,
                config JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tabell för dynamiska miljöinställningar (Biomes)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS biomes (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                config JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tabell för officiella startplattor (Starter Plates / Plattformar)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS starter_plates (
                id VARCHAR(50) PRIMARY KEY,
                world VARCHAR(20) NOT NULL,
                name VARCHAR(255) NOT NULL,
                name_sv VARCHAR(255),
                description TEXT,
                description_sv TEXT,
                badge VARCHAR(50),
                badge_class VARCHAR(50) DEFAULT 'badge-green',
                features TEXT,
                features_sv TEXT,
                preview_image TEXT,
                course_data JSONB NOT NULL,
                sort_order INT DEFAULT 0,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_starter_plates_world ON starter_plates(world);`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_image TEXT;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_range BOOLEAN DEFAULT false;`);
        } catch(e) {}

        // --- Platform v2: Users & Ownership ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(50) PRIMARY KEY,
                display_name VARCHAR(255) DEFAULT 'Golfer',
                email VARCHAR(255),
                auth_provider VARCHAR(20) DEFAULT 'device',
                is_premium BOOLEAN DEFAULT false,
                premium_plan VARCHAR(20),
                premium_until TIMESTAMP,
                builder_score INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        try {
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS owner_id VARCHAR(50);`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS play_count INT DEFAULT 0;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS hole_count INT;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_par INT;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;`);
        } catch(e) {}

        // Leaderboard table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS course_records (
                id SERIAL PRIMARY KEY,
                course_code VARCHAR(20) NOT NULL,
                course_version INT DEFAULT 1,
                player_id VARCHAR(50),
                player_name VARCHAR(255),
                input_mode VARCHAR(20) NOT NULL DEFAULT 'SWING_METER',
                lm_device VARCHAR(50),
                total_score INT,
                score_vs_par INT,
                hole_scores JSONB,
                stats JSONB,
                flagged BOOLEAN DEFAULT false,
                tournament_id VARCHAR(20),
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // one record per player, course and round id: the database settles two requests of the same round that arrive together
        // (the client retries after 20 s while the first request may still be running)
        try {
            await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS course_records_round_uniq
                ON course_records (course_code, player_id, (stats->>'round_id')) WHERE stats->>'round_id' IS NOT NULL`);
        } catch (e) { console.warn('⚠️ Could not create the round id index:', e.message); }

        // Tournaments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tournaments (
                id VARCHAR(20) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                course_code VARCHAR(20) NOT NULL,
                created_by VARCHAR(50),
                input_mode VARCHAR(20) DEFAULT 'ANY',
                starts_at TIMESTAMP NOT NULL,
                ends_at TIMESTAMP NOT NULL,
                max_players INT DEFAULT 0,
                is_public BOOLEAN DEFAULT true,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Course Collections table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS course_collections (
                id VARCHAR(20) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                author VARCHAR(255) DEFAULT 'Anonymous',
                type VARCHAR(2) NOT NULL,
                plates JSONB NOT NULL DEFAULT '[]',
                total_par INT,
                cover_image TEXT,
                owner_id VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // A collection has the stroke index and rating of all its holes together (worked out from its plates, kept up to date when one is published again)
        try {
            await pool.query(`ALTER TABLE course_collections ADD COLUMN IF NOT EXISTS stroke_index JSONB;`);
            await pool.query(`ALTER TABLE course_collections ADD COLUMN IF NOT EXISTS course_rating DECIMAL(4,1);`);
            await pool.query(`ALTER TABLE course_collections ADD COLUMN IF NOT EXISTS slope_rating INT;`);
        } catch(e) {}

        // Migration for existing course_records without tournament_id
        try {
            await pool.query(`ALTER TABLE course_records ADD COLUMN IF NOT EXISTS tournament_id VARCHAR(20);`);
        } catch(e) {}

        // Asset Presets (user favorite lists of 3D figures)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS asset_presets (
                id VARCHAR(20) PRIMARY KEY,
                user_id VARCHAR(50) NOT NULL,
                name VARCHAR(255) NOT NULL,
                assets JSONB NOT NULL DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        try {
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_presets_user ON asset_presets(user_id);`);
        } catch(e) {}

        // --- HCP System migrations ---
        try {
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS handicap_index DECIMAL(4,1);`);
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS handicap_rounds INT DEFAULT 0;`);
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS handicap_history JSONB DEFAULT '[]';`);
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS handicap_updated TIMESTAMP;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_rating DECIMAL(4,1);`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS slope_rating INT DEFAULT 113;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS stroke_index JSONB;`);
            // the builder's own definitions (greens, fairways, bunkers, tee boxes ...): lets the owner open a published course in the builder again
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS builder_holes JSONB;`);
            await pool.query(`ALTER TABLE course_records ADD COLUMN IF NOT EXISTS handicap_at_play DECIMAL(4,1);`);
            await pool.query(`ALTER TABLE course_records ADD COLUMN IF NOT EXISTS score_differential DECIMAL(5,1);`);
            await pool.query(`ALTER TABLE course_records ADD COLUMN IF NOT EXISTS net_score INT;`);
            await pool.query(`ALTER TABLE course_records ADD COLUMN IF NOT EXISTS stableford_points INT;`);
        } catch(e) { console.log('HCP migration note:', e.message); }

        console.log("✅ Database schema ready (v3 — HCP system)");
    } catch(err) {
        console.error("❌ Database schema error:", err);
    }
}

// Kör initDB om DATABASE_URL finns
if(process.env.DATABASE_URL) {
    initDB();
}

// --- HEALTH & DB CHECK ---
let DB_AVAILABLE = false;

// Check DB connectivity once at startup
if (process.env.DATABASE_URL) {
    pool.query('SELECT 1').then(() => {
        DB_AVAILABLE = true;
        console.log('✅ Database connection confirmed');
    }).catch(err => {
        DB_AVAILABLE = false;
        console.warn('⚠️ Database not reachable, running in local dev mode (empty API responses)');
    });
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', db_connected: DB_AVAILABLE });
});

// Middleware: If no database, return graceful empty responses
function requireDB(req, res, next) {
    if (!DB_AVAILABLE) {
        // Return empty arrays for GET, error for POST
        if (req.method === 'GET') return res.json([]);
        return res.status(503).json({ error: 'No database configured (local dev mode)' });
    }
    next();
}

// --- ADMIN AUTH & TOKENS ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'golfadmin123';
const activeAdminTokens = new Map(); // token -> { expiresAt: number }

function generateAdminToken() {
    const rand = crypto.randomBytes(24).toString('hex');
    const token = `adm_${Date.now()}_${rand}`;
    activeAdminTokens.set(token, { expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return token;
}

function isValidAdminToken(token) {
    if (!token) return false;
    const session = activeAdminTokens.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        activeAdminTokens.delete(token);
        return false;
    }
    return true;
}

function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.admin_token || (req.body && req.body.admin_token);
    if (isValidAdminToken(token)) {
        return next();
    }
    // Backwards compatibility for direct password verification
    const pw = (req.body && (req.body.password || req.body.adminPassword)) || req.headers['x-admin-password'];
    if (pw && pw === ADMIN_PASSWORD) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required' });
}

// --- LOCAL STARTER PLATES FALLBACK FILE ---
const STARTER_PLATES_FILE = path.join(__dirname, 'data', 'starter_plates.json');

function loadLocalStarterPlates() {
    try {
        if (!fs.existsSync(STARTER_PLATES_FILE)) {
            const dataDir = path.dirname(STARTER_PLATES_FILE);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(STARTER_PLATES_FILE, JSON.stringify([]));
            return [];
        }
        const raw = fs.readFileSync(STARTER_PLATES_FILE, 'utf8');
        return JSON.parse(raw);
    } catch(e) {
        console.error('Error loading local starter plates:', e);
        return [];
    }
}

function saveLocalStarterPlates(plates) {
    try {
        const dataDir = path.dirname(STARTER_PLATES_FILE);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(STARTER_PLATES_FILE, JSON.stringify(plates, null, 2), 'utf8');
        return true;
    } catch(e) {
        console.error('Error saving local starter plates:', e);
        return false;
    }
}

// --- ADMIN AUTH ENDPOINTS ---
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Incorrect admin password' });
    }
    const token = generateAdminToken();
    const session = activeAdminTokens.get(token);
    res.json({ success: true, token, expiresAt: session.expiresAt });
});

app.post('/api/admin/logout', (req, res) => {
    const token = req.headers['x-admin-token'] || (req.body && req.body.admin_token);
    if (token) {
        activeAdminTokens.delete(token);
    }
    res.json({ success: true });
});

app.get('/api/admin/verify', (req, res) => {
    const token = req.headers['x-admin-token'] || req.query.admin_token;
    res.json({ isAdmin: isValidAdminToken(token) });
});

// Hämta kurser för admin (inklusive drafts) för att kunna främja till platta
app.get('/api/admin/courses', requireAdmin, async (req, res) => {
    try {
        if (DB_AVAILABLE) {
            const result = await pool.query(`
                SELECT share_code, name, author, is_draft, cover_image, hole_count, total_par, created_at 
                FROM courses 
                ORDER BY created_at DESC 
                LIMIT 100
            `);
            res.json(result.rows);
        } else {
            res.json([]);
        }
    } catch(err) {
        console.error('GET /api/admin/courses error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Auth middleware: extract user ID from header
function authMiddleware(req, res, next) {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'Missing x-user-id header' });
    }
    req.userId = userId;
    next();
}

// Optional auth: sets req.userId if present but doesn't block
function optionalAuth(req, res, next) {
    req.userId = req.headers['x-user-id'] || null;
    next();
}

// --- AUTH ENDPOINTS ---

// Register or fetch user by device ID
app.post('/api/auth/register', requireDB, async (req, res) => {
    try {
        const { device_id, display_name } = req.body;
        if (!device_id) return res.status(400).json({ error: 'Missing device_id' });

        // Try to find existing user
        let result = await pool.query('SELECT * FROM users WHERE id = $1', [device_id]);
        
        if (result.rows.length > 0) {
            // Existing user — return profile
            return res.json(result.rows[0]);
        }

        // New user — create
        result = await pool.query(
            `INSERT INTO users (id, display_name, auth_provider) VALUES ($1, $2, 'device') RETURNING *`,
            [device_id, display_name || 'Golfer']
        );
        console.log('👤 New user registered:', device_id.substring(0, 8) + '...');
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Auth register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user profile
app.get('/api/users/:id', requireDB, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, display_name, is_premium, builder_score, created_at FROM users WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Update display name
app.put('/api/users/:id', requireDB, authMiddleware, async (req, res) => {
    try {
        if (req.userId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
        const { display_name } = req.body;
        if (!display_name) return res.status(400).json({ error: 'Missing display_name' });
        
        const name = display_name.trim().substring(0, 30);
        await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [name, req.params.id]);
        res.json({ success: true, display_name: name });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// --- HCP API ---
app.get('/api/users/:id/handicap', requireDB, async (req, res) => {
    try {
        const user = await pool.query('SELECT handicap_index, handicap_rounds, handicap_updated FROM users WHERE id = $1', [req.params.id]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const rounds = await pool.query(
            `SELECT score_differential, total_score, score_vs_par, course_code, played_at FROM course_records WHERE player_id = $1 AND flagged = false AND score_differential IS NOT NULL ORDER BY played_at DESC LIMIT 20`,
            [req.params.id]
        );
        res.json({ handicap_index: user.rows[0].handicap_index, rounds_counted: user.rows[0].handicap_rounds, last_updated: user.rows[0].handicap_updated, recent_rounds: rounds.rows });
    } catch(err) { console.error('HCP fetch error:', err); res.status(500).json({ error: 'Server error' }); }
});

// The signed-in builder's own courses, drafts and published, newest first (the public list above only holds the newest 50 of everybody)
app.get('/api/my/courses', requireDB, authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT share_code, name, author, likes, hole_count, total_par, play_count, owner_id, version,
                   COALESCE(is_draft, false) AS is_draft, COALESCE(is_range, false) AS is_range, created_at, updated_at
            FROM courses
            WHERE owner_id = $1
              AND COALESCE(theme_data->>'_playCopy', '') <> 'true'
            ORDER BY COALESCE(updated_at, created_at) DESC
        `, [req.userId]); // no cap: the rows are small (no holes, no images) and the client treats this as the whole list
        res.json(result.rows);
    } catch(err) {
        console.error('GET /api/my/courses error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/courses', requireDB, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT share_code, name, author, likes, hole_count, total_par, play_count, owner_id, version, created_at 
            FROM courses 
            WHERE (is_draft = false OR is_draft IS NULL) 
              AND (is_range = false OR is_range IS NULL)
              AND (is_hidden = false OR is_hidden IS NULL)
            ORDER BY COALESCE(updated_at, created_at) DESC 
            LIMIT 50
        `);
        res.json(result.rows);
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/courses/:share_code/like', requireDB, async (req, res) => {
    try {
        const code = req.params.share_code.toUpperCase();
        const result = await pool.query(`
            UPDATE courses 
            SET likes = COALESCE(likes, 0) + 1 
            WHERE share_code = $1 
            RETURNING likes
        `, [code]);
        res.json({ success: true, likes: result.rows[0] ? result.rows[0].likes : 0 });
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// --- LEADERBOARD API ---

// Submit round result
app.post('/api/courses/:code/results', requireDB, optionalAuth, async (req, res) => {
    try {
        const code = req.params.code.toUpperCase();
        const { total_score, score_vs_par, hole_scores, input_mode, lm_device, stats, player_name } = req.body;
        
        if (!total_score && total_score !== 0) return res.status(400).json({ error: 'Missing total_score' });
        
        // Get current course version + hole_count for sanity check
        const courseResult = await pool.query(
            'SELECT version, hole_count, owner_id, is_draft FROM courses WHERE share_code = $1', [code]
        );
        if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
        // an unpublished draft is a builder preview: its rounds never reach the leaderboard, handicap or play counts
        if (courseResult.rows[0].is_draft === true) return res.json({ success: true, skipped: 'draft' });
        
        const course = courseResult.rows[0];
        const courseVersion = course.version || 1;
        const holeCount = course.hole_count || 3;

        // A retry of a round that was already filed (the answer got lost on the way back) must not file it twice: the client names
        // the round in stats.round_id, and the same player's record with that id is answered again, without touching play count or handicap.
        const roundId = stats && typeof stats.round_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(stats.round_id) ? stats.round_id : null;
        const keyed = !!(roundId && req.userId && req.userId !== 'anonymous');
        // the answer for a round that is already filed: its record again, nothing counted twice
        const answerDuplicate = async () => {
            const dup = await pool.query(
                `SELECT id, total_score, flagged FROM course_records
                 WHERE course_code = $1 AND player_id = $2 AND stats->>'round_id' = $3 LIMIT 1`,
                [code, req.userId, roundId]
            );
            if (dup.rows.length === 0) return false;
            const d = dup.rows[0];
            const posDup = await pool.query(
                `SELECT COUNT(*) + 1 as position FROM course_records
                 WHERE course_code = $1 AND course_version = $2 AND total_score < $3 AND flagged = false`,
                [code, courseVersion, d.total_score]
            );
            // the handicap is derived from the records: redo it, in case the first request stopped before it
            const hcpDup = d.flagged === true ? null : await updateHandicapIndex(req.userId, pool);
            res.json({ success: true, duplicate: true, record_id: d.id, position: parseInt(posDup.rows[0].position), flagged: d.flagged === true, handicap: { new: hcpDup } });
            return true;
        };
        if (keyed && await answerDuplicate()) return;
        
        // Sanity check: flag suspicious scores
        let flagged = false;
        if (total_score < holeCount) flagged = true;          // Under 1 per hole = suspicious
        if (total_score > holeCount * 10) flagged = true;     // Over 10 per hole = suspicious
        
        // A plate of a collection is not a round of its own for the handicap: the whole go counts once, on the collection's rating
        // (filed below, when the last plate has come in). The collection must exist and list this plate, or the record is an ordinary one.
        let coll = null;
        const collId = stats && typeof stats.collection_id === 'string' && /^[A-Za-z0-9]{1,20}$/.test(stats.collection_id) ? stats.collection_id.toUpperCase() : null;
        const collRoundId = stats && typeof stats.collection_round_id === 'string' && stats.collection_round_id.length <= 64 ? stats.collection_round_id : null;
        if (collId && collRoundId) {
            const cr = await pool.query('SELECT id, type, plates, course_rating, slope_rating FROM course_collections WHERE id = $1', [collId]);
            if (cr.rows.length > 0) {
                const cp = (typeof cr.rows[0].plates === 'string' ? JSON.parse(cr.rows[0].plates) : cr.rows[0].plates) || [];
                if (cp.map(collectionsCore.plateCode).indexOf(code) >= 0) coll = cr.rows[0];
            }
        }

        // === HCP: Calculate differential ===
        let scoreDifferential = null, playerHcpAtPlay = null, netScore = null;
        if (req.userId && req.userId !== 'anonymous') {
            const hcpRes = await pool.query('SELECT handicap_index FROM users WHERE id = $1', [req.userId]);
            if (hcpRes.rows.length > 0) playerHcpAtPlay = hcpRes.rows[0].handicap_index;
            const ratRes = coll ? { rows: [] } : await pool.query('SELECT course_rating, slope_rating FROM courses WHERE share_code = $1', [code]);
            if (ratRes.rows.length > 0 && ratRes.rows[0].course_rating) {
                const cr = parseFloat(ratRes.rows[0].course_rating), sr = parseInt(ratRes.rows[0].slope_rating) || 113;
                scoreDifferential = calculateScoreDifferential(total_score, cr, sr);
                if (playerHcpAtPlay !== null) netScore = total_score - Math.round(playerHcpAtPlay * (sr / 113));
            }
        }
        
        // Save result: the record and the counters that go with it are one unit, so a failure can never leave a filed round without its
        // play count (a retry of the same round would then be answered as a duplicate and the count would stay short).
        let result;
        const db = await pool.connect();
        try {
            await db.query('BEGIN');
            result = await db.query(
                `INSERT INTO course_records 
                (course_code, course_version, player_id, player_name, input_mode, lm_device, total_score, score_vs_par, hole_scores, stats, flagged, handicap_at_play, score_differential, net_score)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING id`,
                [
                    code, courseVersion,
                    req.userId || 'anonymous',
                    player_name || req.body.player_name || 'Anonymous',
                    input_mode || 'SWING_METER',
                    lm_device || null,
                    total_score,
                    score_vs_par || 0,
                    JSON.stringify(hole_scores || []),
                    JSON.stringify(stats || {}),
                    flagged,
                    playerHcpAtPlay, scoreDifferential, netScore
                ]
            );
            // Increment play_count on course
            await db.query('UPDATE courses SET play_count = COALESCE(play_count, 0) + 1 WHERE share_code = $1', [code]);
            // Increment builder_score for course owner
            if (course.owner_id) {
                await db.query('UPDATE users SET builder_score = builder_score + 1 WHERE id = $1', [course.owner_id]);
            }
            await db.query('COMMIT');
        } catch (e) {
            try { await db.query('ROLLBACK'); } catch (e2) { /* the connection is gone */ }
            // the same round arrived twice at once and the other request filed it first: answer with that record
            if (keyed && e.code === '23505' && await answerDuplicate()) return;
            throw e;
        } finally {
            db.release();
        }
        
        // The last plate of a collection round is in: the round's differential, on the collection's rating, goes on this record
        let collDifferential = null;
        if (coll && req.userId && req.userId !== 'anonymous' && !flagged && coll.course_rating) {
            // the whole collection: as many plates as its type has room for (a partly built collection can be played, but its go is no round for the handicap)
            const have = (typeof coll.plates === 'string' ? JSON.parse(coll.plates) : coll.plates).length;
            const need = Math.floor(parseInt(coll.type, 10) / collectionsCore.HOLES_PER_PLATE);
            const seat = String(stats.player_slot !== undefined && stats.player_slot !== null ? stats.player_slot : (player_name || req.body.player_name || 'Anonymous'));
            const keys = [collId, collRoundId, req.userId, seat];
            // the latest record per plate of this player in this go, on the plates as they are now
            const done = await pool.query(
                `SELECT DISTINCT ON (r.course_code) r.id, r.total_score
                 FROM course_records r JOIN courses c ON c.share_code = r.course_code AND r.course_version = COALESCE(c.version, 1)
                 WHERE r.stats->>'collection_id' = $1 AND r.stats->>'collection_round_id' = $2 AND r.player_id = $3
                   AND COALESCE(r.stats->>'player_slot', r.player_name) = $4 AND r.flagged = false
                 ORDER BY r.course_code, r.played_at DESC, r.id DESC`, keys
            );
            if (have === need && done.rows.length === need) {
                const total = done.rows.reduce((sum, r) => sum + r.total_score, 0);
                collDifferential = calculateScoreDifferential(total, parseFloat(coll.course_rating), parseInt(coll.slope_rating) || 113);
                // one differential per go: it sits on the record that completed it, and on no other record of the go
                await pool.query(
                    `UPDATE course_records SET score_differential = CASE WHEN id = $5 THEN $6::numeric ELSE NULL END
                     WHERE stats->>'collection_id' = $1 AND stats->>'collection_round_id' = $2 AND player_id = $3
                       AND COALESCE(stats->>'player_slot', player_name) = $4`, keys.concat([result.rows[0].id, collDifferential])
                );
            }
        }

        // Update HCP (derived from the records, recomputed on every round: it can be redone at any time)
        let newHcp = null;
        if (req.userId && req.userId !== 'anonymous' && !flagged) {
            newHcp = await updateHandicapIndex(req.userId, pool);
        }
        
        // Return leaderboard position
        const posResult = await pool.query(
            `SELECT COUNT(*) + 1 as position FROM course_records 
             WHERE course_code = $1 AND course_version = $2 AND total_score < $3 AND flagged = false`,
            [code, courseVersion, total_score]
        );
        
        res.json({ 
            success: true, 
            record_id: result.rows[0].id,
            position: parseInt(posResult.rows[0].position),
            flagged: flagged,
            handicap: { previous: playerHcpAtPlay, new: newHcp, differential: coll ? collDifferential : scoreDifferential }
        });
    } catch(err) {
        console.error('Error saving result:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get leaderboard for a course
app.get('/api/courses/:code/leaderboard', requireDB, async (req, res) => {
    try {
        const code = req.params.code.toUpperCase();
        const mode = req.query.mode;      // 'LAUNCH_MONITOR' | 'SWING_METER' | undefined (all)
        const period = req.query.period;  // 'month' | 'all' | undefined (all)
        
        let filters = ['course_code = $1', 'flagged = false'];
        let params = [code];
        let paramIdx = 2;
        
        // Filter by current version
        const vResult = await pool.query('SELECT version FROM courses WHERE share_code = $1', [code]);
        if (vResult.rows.length > 0) {
            filters.push(`course_version = $${paramIdx}`);
            params.push(vResult.rows[0].version || 1);
            paramIdx++;
        }
        
        // Filter by input mode
        if (mode && (mode === 'LAUNCH_MONITOR' || mode === 'SWING_METER')) {
            filters.push(`input_mode = $${paramIdx}`);
            params.push(mode);
            paramIdx++;
        }
        
        // Filter by time period
        if (period === 'month') {
            filters.push(`played_at > NOW() - INTERVAL '30 days'`);
        }
        
        const result = await pool.query(`
            SELECT player_name, total_score, score_vs_par, input_mode, lm_device, 
                   hole_scores, played_at, player_id
            FROM course_records 
            WHERE ${filters.join(' AND ')}
            ORDER BY total_score ASC
            LIMIT 50
        `, params);
        
        // Get total count of rounds played
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM course_records WHERE course_code = $1 AND flagged = false', [code]
        );
        
        res.json({
            leaderboard: result.rows,
            total_rounds: parseInt(countResult.rows[0].total)
        });
    } catch(err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Generera en slumpmässig share_code
function generateShareCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// === HCP SYSTEM: Helper Functions ===

function calculateCourseRating(holes, totalPar) {
    let totalLength = 0;
    let playableHoles = 0;
    const holesArr = typeof holes === 'string' ? JSON.parse(holes) : holes;
    holesArr.forEach(h => {
        if (h.flag && h.tees) {
            let tee = h.tees.yellow || h.tees.white || h.tees.red || h.tees.black;
            if (tee) {
                totalLength += Math.hypot(h.flag.x - tee.x, h.flag.z - tee.z);
                playableHoles++;
            }
        }
    });
    if (playableHoles === 0) return totalPar || 36;
    let expectedLength = playableHoles * 300;
    let lengthDiff = (totalLength - expectedLength) / 400;
    let cr = (totalPar || playableHoles * 4) + Math.max(-2, Math.min(4, lengthDiff));
    return Math.round(cr * 10) / 10;
}

function calculateSlopeRating(holes) {
    const holesArr = typeof holes === 'string' ? JSON.parse(holes) : holes;
    let totalLength = 0;
    let par5Count = 0;
    let playable = 0;
    holesArr.forEach(h => {
        if (h.flag && h.tees) {
            let tee = h.tees.yellow || h.tees.white || h.tees.red || h.tees.black;
            if (tee) {
                totalLength += Math.hypot(h.flag.x - tee.x, h.flag.z - tee.z);
                playable++;
                if (h.par >= 5) par5Count++;
            }
        }
    });
    if (playable === 0) return 113;
    let avgLength = totalLength / playable;
    let slope = 113 + Math.round((avgLength - 300) / 50 * 8) + (par5Count * 3);
    return Math.max(55, Math.min(155, slope));
}

function calculateStrokeIndex(holes) {
    const holesArr = typeof holes === 'string' ? JSON.parse(holes) : holes;
    let lengths = [];
    holesArr.forEach((h, i) => {
        let len = 0;
        if (h.flag && h.tees) {
            let tee = h.tees.yellow || h.tees.white || h.tees.red || h.tees.black;
            if (tee) len = Math.hypot(h.flag.x - tee.x, h.flag.z - tee.z);
        }
        lengths.push({ index: i, length: len });
    });
    lengths.sort((a, b) => b.length - a.length);
    let si = new Array(holesArr.length).fill(0);
    lengths.forEach((item, rank) => { si[item.index] = rank + 1; });
    return si;
}

// Stroke index and ratings of a collection: its plates' holes as one course (three per plate, in the order of the plates).
// `plateRows` are courses rows ({ holes, total_par, hole_count }) in plate order.
function collectionRatings(plateRows) {
    const holes = collectionsCore.combineHoles(plateRows.map(function (r) { return r.holes; }));
    const totalPar = plateRows.reduce(function (sum, r) { return sum + (r.total_par || (r.hole_count || collectionsCore.HOLES_PER_PLATE) * 4); }, 0);
    return {
        stroke_index: calculateStrokeIndex(holes),
        course_rating: calculateCourseRating(holes, totalPar),
        slope_rating: calculateSlopeRating(holes),
        total_par: totalPar
    };
}

// The plates of a collection, from the database, in the order the collection lists them (a plate that is gone is left out)
async function loadPlateRows(db, plateCodes) {
    if (!plateCodes.length) return [];
    const rows = await db.query('SELECT share_code, holes, total_par, hole_count FROM courses WHERE share_code = ANY($1)', [plateCodes]);
    const byCode = {};
    rows.rows.forEach(function (r) { byCode[r.share_code.toUpperCase()] = r; });
    return plateCodes.map(function (c) { return byCode[c]; }).filter(Boolean);
}

// A plate was saved again: the collections it is in get their stroke index and ratings from the plates as they are now
async function refreshCollectionsOf(db, plateCode) {
    // a plate is listed as { plate_code } (older rows: the bare code, in any case)
    const cols = await db.query(
        `SELECT id, plates FROM course_collections
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(plates) e
                       WHERE upper(CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' ELSE e->>'plate_code' END) = $1)`, [plateCode.toUpperCase()]);
    for (const c of cols.rows) {
        const plates = (typeof c.plates === 'string' ? JSON.parse(c.plates) : c.plates) || [];
        const rows = await loadPlateRows(db, plates.map(collectionsCore.plateCode));
        const r = collectionRatings(rows);
        await db.query('UPDATE course_collections SET stroke_index=$1, course_rating=$2, slope_rating=$3, total_par=$4 WHERE id=$5',
            [JSON.stringify(r.stroke_index), r.course_rating, r.slope_rating, r.total_par, c.id]);
    }
}

function calculateScoreDifferential(adjustedScore, courseRating, slopeRating) {
    if (!courseRating || !slopeRating || slopeRating === 0) return null;
    return Math.round(((113 / slopeRating) * (adjustedScore - courseRating)) * 10) / 10;
}

async function updateHandicapIndex(playerId, dbPool) {
    try {
        const result = await dbPool.query(
            `SELECT score_differential FROM course_records 
             WHERE player_id = $1 AND flagged = false AND score_differential IS NOT NULL
             ORDER BY played_at DESC LIMIT 20`,
            [playerId]
        );
        const rounds = result.rows.map(r => parseFloat(r.score_differential));
        if (rounds.length < 3) return null;
        
        let useCount;
        if (rounds.length <= 5) useCount = 1;
        else if (rounds.length <= 8) useCount = 2;
        else if (rounds.length <= 11) useCount = 3;
        else if (rounds.length <= 14) useCount = 5;
        else if (rounds.length <= 16) useCount = 6;
        else if (rounds.length <= 18) useCount = 7;
        else useCount = 8;
        
        rounds.sort((a, b) => a - b);
        const best = rounds.slice(0, useCount);
        const avg = best.reduce((s, v) => s + v, 0) / best.length;
        const handicapIndex = Math.round(avg * 0.96 * 10) / 10;
        const clampedHI = Math.max(0, Math.min(54.0, handicapIndex));
        
        await dbPool.query(
            `UPDATE users SET handicap_index = $1, handicap_rounds = $2, handicap_updated = NOW() WHERE id = $3`,
            [clampedHI, rounds.length, playerId]
        );
        return clampedHI;
    } catch(e) {
        console.error('HCP update error:', e.message);
        return null;
    }
}

app.post('/api/courses', requireDB, optionalAuth, async (req, res) => {
    try {
        const { name, author, holes, builder_holes, targets, trees, terrain_heightmap, terrain_biomemap, terrain_watermask, is_draft, is_range, edit_code, theme_data, hole_count, total_par, new_version, cover_image } = req.body;
        
        // Validering
        if (!holes) return res.status(400).json({ error: 'Missing holes data' });

        const draftStatus = is_draft === true;
        const rangeStatus = is_range === true;
        const c_name = name || 'My Golf Course';
        const c_author = author || 'Anonymous';
        const c_theme_data = theme_data || {};
        const c_hole_count = hole_count || null;
        const c_total_par = total_par || null;

        if (edit_code) {
            // Check ownership before allowing edit
            const ownerCheck = await pool.query('SELECT owner_id, is_draft FROM courses WHERE share_code = $1', [edit_code.toUpperCase()]);
            if (ownerCheck.rows.length > 0 && ownerCheck.rows[0].owner_id) {
                // Course has an owner — require matching auth
                if (!req.userId) {
                    return res.status(401).json({ error: 'Authentication required to edit this course' });
                }
                if (ownerCheck.rows[0].owner_id !== req.userId) {
                    return res.status(403).json({ error: 'You are not the owner of this course' });
                }
            }

            // Version bump only when a course that is already published is published again; publishing a draft for the first time is version 1
            let versionBump = '';
            const wasPublished = ownerCheck.rows.length > 0 && ownerCheck.rows[0].is_draft !== true; // older courses have no flag (NULL): published, as the lists treat them
            // a published course is never taken back to a draft by a save (a second tab or device may still think it is a draft)
            if (wasPublished && draftStatus) {
                return res.status(409).json({ error: 'This course is already published. Use Publish to update it.', code: 'already_published' });
            }
            if (!draftStatus) {
                // decided from the row as the UPDATE sees it, so two overlapping first publications make the second one version 2
                versionBump = `, version = CASE WHEN is_draft IS DISTINCT FROM true THEN COALESCE(version, 1) + 1 ELSE COALESCE(version, 1) END,
                     play_count = CASE WHEN is_draft IS DISTINCT FROM true THEN 0 ELSE play_count END`;
            }

            const updateResult = await pool.query(
                `UPDATE courses 
                 SET name=$1, author=$2, holes=$3, targets=$4, trees=$5, terrain_heightmap=$6, terrain_biomemap=$7, 
                     is_draft=$8, theme_data=$10, is_range=$11, hole_count=$12, total_par=$13, cover_image=$14,
                     builder_holes=$15, owner_id=COALESCE(owner_id, $16),
                     course_rating=$17, slope_rating=$18, stroke_index=$19,
                     updated_at=CURRENT_TIMESTAMP ${versionBump}
                 WHERE share_code=$9 
                   AND ($8 = false OR is_draft = true) -- decided in the same statement: a request that overlaps a publish cannot take the course back to a draft
                 RETURNING share_code, version`,
                [
                    c_name, c_author, 
                    JSON.stringify(holes), JSON.stringify(targets || []), JSON.stringify(trees || []), 
                    terrain_heightmap, terrain_biomemap, draftStatus, 
                    edit_code.toUpperCase(), JSON.stringify(c_theme_data), rangeStatus,
                    c_hole_count, c_total_par, cover_image || null,
                    builder_holes ? JSON.stringify(builder_holes) : null, req.userId || null,
                    // the ratings follow the holes as they are now (a draft saved early has none worth keeping once the holes are built)
                    calculateCourseRating(holes, c_total_par), calculateSlopeRating(holes), JSON.stringify(calculateStrokeIndex(holes))
                ]
            );
            
            if (updateResult.rows.length === 0 && draftStatus && ownerCheck.rows.length > 0) {
                // the course exists but was published between the check above and the update
                return res.status(409).json({ error: 'This course is already published. Use Publish to update it.', code: 'already_published' });
            }
            if (updateResult.rows.length > 0) {
                try { await refreshCollectionsOf(pool, updateResult.rows[0].share_code); } catch (e) { console.error('Collection refresh error:', e.message); }
                return res.json({ success: true, share_code: updateResult.rows[0].share_code, version: updateResult.rows[0].version });
            }
        }

        const share_code = generateShareCode();

        const result = await pool.query(
            `INSERT INTO courses 
            (share_code, name, author, holes, targets, trees, terrain_heightmap, terrain_biomemap, is_draft, theme_data, is_range, owner_id, hole_count, total_par, course_rating, slope_rating, stroke_index, cover_image, builder_holes, updated_at) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP) RETURNING share_code`,
            [
                share_code, c_name, c_author, 
                JSON.stringify(holes), JSON.stringify(targets || []), JSON.stringify(trees || []), 
                terrain_heightmap, terrain_biomemap, draftStatus, JSON.stringify(c_theme_data), rangeStatus,
                req.userId || null, c_hole_count, c_total_par,
                calculateCourseRating(holes, c_total_par), calculateSlopeRating(holes), JSON.stringify(calculateStrokeIndex(holes)), cover_image || null,
                builder_holes ? JSON.stringify(builder_holes) : null
            ]
        );

        res.json({ success: true, share_code: result.rows[0].share_code });
    } catch(err) {
        console.error("Error saving course:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
app.get('/api/courses/:share_code', requireDB, optionalAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM courses WHERE share_code = $1", [req.params.share_code.toUpperCase()]);
        if(result.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }
        const row = result.rows[0];
        // only the builder may open the course in the builder (saving is checked against the owner again by POST /api/courses)
        row.can_edit = !!row.owner_id && !!req.userId && req.userId === row.owner_id;
        if (!row.can_edit) delete row.builder_holes; // the builder's own definitions are for the builder only, players never download them
        res.json(row);
    } catch(err) {
        console.error("Error fetching course:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Delete a course (owner only)
app.delete('/api/courses/:code', requireDB, authMiddleware, async (req, res) => {
    try {
        const code = req.params.code.toUpperCase();
        
        // Check ownership
        const course = await pool.query('SELECT owner_id FROM courses WHERE share_code = $1', [code]);
        if (course.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }
        if (course.rows[0].owner_id && course.rows[0].owner_id !== req.userId) {
            return res.status(403).json({ error: 'You are not the owner of this course' });
        }
        
        // A published course that was play-tested has a hidden draft copy of its own (Save & play); it goes with the course
        const copies = (await pool.query("SELECT share_code FROM courses WHERE theme_data->>'_playCopyOf' = $1 AND owner_id IS NOT DISTINCT FROM $2", [code, course.rows[0].owner_id])).rows.map(r => r.share_code);
        const doomed = [code].concat(copies);

        // Delete leaderboard records first (foreign key integrity)
        await pool.query('DELETE FROM course_records WHERE course_code = ANY($1)', [doomed]);
        
        // Delete the course
        await pool.query('DELETE FROM courses WHERE share_code = ANY($1)', [doomed]);
        
        console.log('🗑️ Course deleted:', code, 'by user:', req.userId.substring(0, 8) + '...');
        res.json({ success: true, deleted: code });
    } catch(err) {
        console.error('Error deleting course:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- COLLECTIONS API ---
app.get('/api/collections', requireDB, async (req, res) => {
    try {
        const typeFilter = req.query.type; // '3','6','9','18' or undefined
        let query = `SELECT id, name, author, type, plates, total_par, cover_image, owner_id, created_at FROM course_collections`;
        let params = [];
        if (typeFilter) {
            query += ' WHERE type = $1';
            params.push(typeFilter);
        }
        query += ' ORDER BY created_at DESC LIMIT 50';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch(err) {
        console.error('Collections list error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/collections/:id', requireDB, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM course_collections WHERE id = $1', [req.params.id.toUpperCase()]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Collection not found' });
        res.json(result.rows[0]);
    } catch(err) {
        console.error('Collection fetch error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/collections', requireDB, optionalAuth, async (req, res) => {
    try {
        const { id, name, author, type, plates, cover_image } = req.body;
        if (!type || !collectionsCore.TYPES.includes(type)) {
            return res.status(400).json({ error: 'type must be 3, 6, 9, or 18' });
        }

        // the plates are checked here, not trusted from the page: how many fit, that none is used twice, that each is a published course
        const shape = collectionsCore.checkPlateList(type, plates);
        if (shape.error) return res.status(400).json({ error: shape.error });
        let cleanPlates = shape.plates, totalPar = null, ratings = { stroke_index: null, course_rating: null, slope_rating: null };
        if (cleanPlates.length > 0) {
            const found = await pool.query(
                `SELECT share_code, name, holes, total_par, hole_count, COALESCE(is_draft, false) AS is_draft, COALESCE(is_range, false) AS is_range
                 FROM courses WHERE share_code = ANY($1)`, [cleanPlates.map(p => p.plate_code)]
            );
            const exist = collectionsCore.checkPlatesExist(cleanPlates, found.rows);
            if (exist.error) return res.status(400).json({ error: exist.error });
            cleanPlates = exist.plates;
            totalPar = exist.totalPar; // worked out from the plates themselves, not from what the page says
            const byCode = {};
            found.rows.forEach(r => { byCode[r.share_code.toUpperCase()] = r; });
            ratings = collectionRatings(cleanPlates.map(p => byCode[p.plate_code]));   // the stroke index and ratings of all its holes together
        }

        if (id) {
            // Update existing
            const ownerCheck = await pool.query('SELECT owner_id FROM course_collections WHERE id = $1', [id.toUpperCase()]);
            if (ownerCheck.rows.length > 0 && ownerCheck.rows[0].owner_id && req.userId && ownerCheck.rows[0].owner_id !== req.userId) {
                return res.status(403).json({ error: 'Not the owner' });
            }
            const result = await pool.query(
                `UPDATE course_collections SET name=$1, author=$2, type=$3, plates=$4, total_par=$5, cover_image=$6, stroke_index=$8, course_rating=$9, slope_rating=$10 WHERE id=$7 RETURNING id`,
                [name || 'My Course', author || 'Anonymous', type, JSON.stringify(cleanPlates), totalPar, cover_image || null, id.toUpperCase(),
                 ratings.stroke_index ? JSON.stringify(ratings.stroke_index) : null, ratings.course_rating, ratings.slope_rating]
            );
            if (result.rows.length > 0) return res.json({ success: true, id: result.rows[0].id });
        }

        // Create new
        const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
        await pool.query(
            `INSERT INTO course_collections (id, name, author, type, plates, total_par, cover_image, owner_id, stroke_index, course_rating, slope_rating) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [newId, name || 'My Course', author || 'Anonymous', type, JSON.stringify(cleanPlates), totalPar, cover_image || null, req.userId || null,
             ratings.stroke_index ? JSON.stringify(ratings.stroke_index) : null, ratings.course_rating, ratings.slope_rating]
        );
        res.json({ success: true, id: newId });
    } catch(err) {
        console.error('Collection save error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// The leaderboard of a collection: a player's rounds on every plate of it, played in one go (stats.collection_round_id), added together.
// A round that stopped after two of three plates is not a result of the collection.
app.get('/api/collections/:id/leaderboard', requireDB, async (req, res) => {
    try {
        const col = await pool.query('SELECT id, type, plates FROM course_collections WHERE id = $1', [req.params.id.toUpperCase()]);
        if (col.rows.length === 0) return res.status(404).json({ error: 'Collection not found' });
        const plates = (typeof col.rows[0].plates === 'string' ? JSON.parse(col.rows[0].plates) : col.rows[0].plates) || [];
        const codes = plates.map(collectionsCore.plateCode);
        const need = Math.floor(parseInt(col.rows[0].type, 10) / collectionsCore.HOLES_PER_PLATE);
        // an unfinished collection (fewer plates than the type has room for) has no results yet
        if (codes.length === 0 || codes.length !== need) return res.json({ leaderboard: [], plates: codes.length, needed: need });
        // one record per plate and player in a round (a plate that was sent twice counts once: the latest). A player is the seat in the
        // roster (stats.player_slot), not the name: two players on one device may share both the name and the player id.
        const rows = await pool.query(
            `SELECT round_id, player_id, slot, MAX(player_name) AS player_name, MIN(input_mode) AS input_mode,
                    SUM(total_score)::int AS total_score, SUM(score_vs_par)::int AS score_vs_par, MAX(played_at) AS played_at
             FROM (
                 SELECT DISTINCT ON (r.stats->>'collection_round_id', r.player_id, COALESCE(r.stats->>'player_slot', r.player_name), r.course_code)
                        r.stats->>'collection_round_id' AS round_id, r.player_id, COALESCE(r.stats->>'player_slot', r.player_name) AS slot, r.player_name,
                        r.course_code, r.input_mode, r.total_score, r.score_vs_par, r.played_at
                 FROM course_records r
                 -- only rounds on the plate as it is now: a republished plate (a new version) starts its leaderboard over, as a course's own does
                 JOIN courses c ON c.share_code = r.course_code AND r.course_version = COALESCE(c.version, 1)
                 WHERE r.stats->>'collection_id' = $1 AND r.course_code = ANY($2) AND r.flagged = false AND r.stats->>'collection_round_id' IS NOT NULL
                 ORDER BY r.stats->>'collection_round_id', r.player_id, COALESCE(r.stats->>'player_slot', r.player_name), r.course_code, r.played_at DESC, r.id DESC
             ) per_plate
             GROUP BY round_id, player_id, slot
             HAVING COUNT(*) = $3
             ORDER BY SUM(total_score) ASC, MAX(played_at) ASC
             LIMIT 50`,
            [col.rows[0].id, codes, codes.length]
        );
        res.json({ leaderboard: rows.rows, plates: codes.length, needed: need });
    } catch(err) {
        console.error('Collection leaderboard error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/collections/:id', requireDB, authMiddleware, async (req, res) => {
    try {
        const id = req.params.id.toUpperCase();
        const check = await pool.query('SELECT owner_id FROM course_collections WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        if (check.rows[0].owner_id && check.rows[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not the owner' });
        await pool.query('DELETE FROM course_collections WHERE id = $1', [id]);
        res.json({ success: true, deleted: id });
    } catch(err) {
        console.error('Collection delete error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- RANGES API ---
app.get('/api/ranges', requireDB, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT share_code, name, author, likes, created_at 
            FROM courses 
            WHERE is_range = true AND (is_draft = false OR is_draft IS NULL)
            ORDER BY created_at DESC 
            LIMIT 50
        `);
        res.json(result.rows);
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// --- ASSET MANAGER API ---

// Hämta alla custom assets (Mindre payload, exkluderar den tunga file_data vid lista)
app.get('/api/assets', requireDB, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, category, subcategory, icon, config, created_at 
            FROM custom_assets 
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch(err) {
        console.error("Error fetching assets:", err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Hämta en specifik custom asset INKLUSIVE base64-filen
app.get('/api/assets/:id/download', requireDB, async (req, res) => {
    try {
        const result = await pool.query("SELECT file_data FROM custom_assets WHERE id = $1", [req.params.id]);
        if(result.rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        res.json({ file_data: result.rows[0].file_data });
    } catch(err) {
        console.error("Error downloading asset:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- STARTER PLATES API ---

// Hämta alla aktiva starter plates (lättviktig payload utan tung course_data för snabb gallerivisning)
app.get('/api/starter-plates', async (req, res) => {
    try {
        const { world, include_data } = req.query;
        const includeData = include_data === 'true';

        if (DB_AVAILABLE) {
            let sql = `
                SELECT id, world, name, name_sv, description, description_sv, 
                       badge, badge_class, features, features_sv, preview_image, 
                       sort_order, is_active, created_at, updated_at
                       ${includeData ? ', course_data' : ''}
                FROM starter_plates 
                WHERE is_active = true
            `;
            const params = [];
            if (world && world !== 'all') {
                params.push(world.toLowerCase());
                sql += ` AND LOWER(world) = $${params.length}`;
            }
            sql += ` ORDER BY sort_order ASC, created_at ASC`;

            const result = await pool.query(sql, params);
            return res.json(result.rows);
        } else {
            let plates = loadLocalStarterPlates();
            let filtered = plates.filter(p => p.is_active !== false);
            if (world && world !== 'all') {
                filtered = filtered.filter(p => (p.world || '').toLowerCase() === world.toLowerCase());
            }
            filtered.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            if (!includeData) {
                filtered = filtered.map(({ course_data, ...rest }) => rest);
            }
            return res.json(filtered);
        }
    } catch(err) {
        console.error('GET /api/starter-plates error:', err);
        res.status(500).json({ error: 'Failed to fetch starter plates' });
    }
});

// Hämta en specifik starter plate inklusive all 3D ban- och terrängdata
app.get('/api/starter-plates/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (DB_AVAILABLE) {
            const result = await pool.query('SELECT * FROM starter_plates WHERE id = $1', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Starter plate not found' });
            }
            return res.json(result.rows[0]);
        } else {
            const plates = loadLocalStarterPlates();
            const found = plates.find(p => p.id === id);
            if (!found) {
                return res.status(404).json({ error: 'Starter plate not found' });
            }
            return res.json(found);
        }
    } catch(err) {
        console.error('GET /api/starter-plates/:id error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Skapa eller uppdatera en officiell startplatta (skyddat med requireAdmin)
app.post('/api/starter-plates', requireAdmin, async (req, res) => {
    try {
        let { 
            id, world, name, name_sv, description, description_sv, 
            badge, badge_class, features, features_sv, 
            preview_image, course_data, sort_order, is_active, 
            from_course_code 
        } = req.body;

        // Om skapad från en befintlig bana i systemet
        if (from_course_code && (!course_data || !preview_image)) {
            let course = null;
            if (DB_AVAILABLE) {
                const cRes = await pool.query('SELECT * FROM courses WHERE share_code = $1', [from_course_code.toUpperCase()]);
                if (cRes.rows.length > 0) course = cRes.rows[0];
            }
            if (course) {
                if (!course_data) {
                    course_data = {
                        terrain_heightmap: course.terrain_heightmap,
                        terrain_biomemap: course.terrain_biomemap,
                        terrain_watermask: course.terrain_watermask,
                        trees: course.trees,
                        theme_data: course.theme_data,
                        holes: []
                    };
                }
                if (!preview_image && course.cover_image) {
                    preview_image = course.cover_image;
                }
                if (!name && course.name) name = course.name;
            }
        }

        if (!id) {
            id = (name || 'plate').toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 40) + '_' + Date.now().toString().slice(-4);
        }
        world = (world || 'grass').toLowerCase();
        name = name || 'Custom Plate';
        course_data = course_data || {};
        sort_order = parseInt(sort_order) || 0;
        is_active = is_active !== false;

        const plateRecord = {
            id,
            world,
            name,
            name_sv: name_sv || name,
            description: description || '',
            description_sv: description_sv || description || '',
            badge: badge || 'STARTER',
            badge_class: badge_class || 'badge-green',
            features: features || '',
            features_sv: features_sv || features || '',
            preview_image: preview_image || '',
            course_data,
            sort_order,
            is_active,
            updated_at: new Date().toISOString()
        };

        if (DB_AVAILABLE) {
            const result = await pool.query(`
                INSERT INTO starter_plates 
                (id, world, name, name_sv, description, description_sv, badge, badge_class, features, features_sv, preview_image, course_data, sort_order, is_active, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET
                    world = EXCLUDED.world,
                    name = EXCLUDED.name,
                    name_sv = EXCLUDED.name_sv,
                    description = EXCLUDED.description,
                    description_sv = EXCLUDED.description_sv,
                    badge = EXCLUDED.badge,
                    badge_class = EXCLUDED.badge_class,
                    features = EXCLUDED.features,
                    features_sv = EXCLUDED.features_sv,
                    preview_image = EXCLUDED.preview_image,
                    course_data = EXCLUDED.course_data,
                    sort_order = EXCLUDED.sort_order,
                    is_active = EXCLUDED.is_active,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `, [
                id, world, name, plateRecord.name_sv, plateRecord.description, plateRecord.description_sv,
                plateRecord.badge, plateRecord.badge_class, plateRecord.features, plateRecord.features_sv,
                plateRecord.preview_image, JSON.stringify(course_data), sort_order, is_active
            ]);
            return res.json({ success: true, plate: result.rows[0] });
        } else {
            let plates = loadLocalStarterPlates();
            const idx = plates.findIndex(p => p.id === id);
            if (idx >= 0) {
                plates[idx] = { ...plates[idx], ...plateRecord };
            } else {
                plateRecord.created_at = new Date().toISOString();
                plates.push(plateRecord);
            }
            saveLocalStarterPlates(plates);
            return res.json({ success: true, plate: plateRecord });
        }
    } catch(err) {
        console.error('POST /api/starter-plates error:', err);
        res.status(500).json({ error: 'Failed to save starter plate: ' + err.message });
    }
});

// Ta bort en officiell startplatta (skyddat med requireAdmin)
app.delete('/api/starter-plates/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        if (DB_AVAILABLE) {
            const result = await pool.query('DELETE FROM starter_plates WHERE id = $1 RETURNING id', [id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Starter plate not found' });
            return res.json({ success: true, deleted_id: result.rows[0].id });
        } else {
            let plates = loadLocalStarterPlates();
            const initLen = plates.length;
            plates = plates.filter(p => p.id !== id);
            if (plates.length === initLen) return res.status(404).json({ error: 'Starter plate not found' });
            saveLocalStarterPlates(plates);
            return res.json({ success: true, deleted_id: id });
        }
    } catch(err) {
        console.error('DELETE /api/starter-plates/:id error:', err);
        res.status(500).json({ error: 'Failed to delete starter plate' });
    }
});

// --- ASSET MANAGER API ---

// Hämta alla custom assets (Mindre payload, exkluderar den tunga file_data vid lista)
app.get('/api/assets', requireDB, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, category, subcategory, icon, config, created_at 
            FROM custom_assets 
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch(err) {
        console.error("Error fetching assets:", err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Hämta en specifik custom asset INKLUSIVE base64-filen
app.get('/api/assets/:id/download', requireDB, async (req, res) => {
    try {
        const result = await pool.query("SELECT file_data FROM custom_assets WHERE id = $1", [req.params.id]);
        if(result.rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        res.json({ file_data: result.rows[0].file_data });
    } catch(err) {
        console.error("Error downloading asset:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Spara/Uppdatera en custom asset (kräver admin)
app.post('/api/assets', requireDB, requireAdmin, async (req, res) => {
    try {
        const { id, name, category, subcategory, icon, file_data, config } = req.body;

        if (!id || !file_data) {
            return res.status(400).json({ error: 'Missing id or file_data' });
        }

        const result = await pool.query(
            `INSERT INTO custom_assets (id, name, category, subcategory, icon, file_data, config) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET 
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                subcategory = EXCLUDED.subcategory,
                icon = EXCLUDED.icon,
                file_data = EXCLUDED.file_data,
                config = EXCLUDED.config
             RETURNING id`,
            [id, name, category, subcategory, icon, file_data, config]
        );

        res.json({ success: true, id: result.rows[0].id });
    } catch(err) {
        console.error("Error saving asset:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Ta bort en custom asset (kräver admin)
app.delete('/api/assets/:id', requireDB, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query("DELETE FROM custom_assets WHERE id = $1 RETURNING id", [req.params.id]);
        if(result.rows.length === 0) {
            return res.status(404).json({ error: 'Asset not found' });
        }
        res.json({ success: true, deleted_id: result.rows[0].id });
    } catch(err) {
        console.error("Error deleting asset:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- BIOMES API ---
app.get('/api/biomes', requireDB, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, config FROM biomes");
        res.json(result.rows);
    } catch(err) {
        console.error("GET /api/biomes Error:", err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/biomes', requireDB, requireAdmin, async (req, res) => {
    try {
        const { id, name, config } = req.body;
        if(!id || !config) return res.status(400).json({ error: 'Missing required fields' });
        
        await pool.query(`
            INSERT INTO biomes (id, name, config) 
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET config = $3, name = $2, updated_at = CURRENT_TIMESTAMP
        `, [id, name || id, config]);
        
        res.json({ success: true, id: id });
    } catch(err) {
        console.error("POST /api/biomes Error:", err);
        res.status(500).json({ error: 'Database error' });
    }
});


// --- ASSET PRESETS API ---

// Get all presets for the authenticated user
app.get('/api/asset-presets', requireDB, authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, assets, created_at, updated_at FROM asset_presets WHERE user_id = $1 ORDER BY updated_at DESC',
            [req.userId]
        );
        res.json(result.rows);
    } catch(err) {
        console.error('GET /api/asset-presets error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create or update a preset
app.post('/api/asset-presets', requireDB, authMiddleware, async (req, res) => {
    try {
        const { id, name, assets } = req.body;
        if (!name) return res.status(400).json({ error: 'Missing preset name' });

        if (id) {
            // Update existing — verify ownership
            const check = await pool.query('SELECT user_id FROM asset_presets WHERE id = $1', [id]);
            if (check.rows.length === 0) return res.status(404).json({ error: 'Preset not found' });
            if (check.rows[0].user_id !== req.userId) return res.status(403).json({ error: 'Not the owner' });

            await pool.query(
                'UPDATE asset_presets SET name = $1, assets = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                [name, JSON.stringify(assets || []), id]
            );
            console.log('📋 Preset updated:', name, 'by user:', req.userId.substring(0, 8) + '...');
            return res.json({ success: true, id: id });
        }

        // Create new
        const newId = 'P' + Math.random().toString(36).substring(2, 8).toUpperCase();
        await pool.query(
            'INSERT INTO asset_presets (id, user_id, name, assets) VALUES ($1, $2, $3, $4)',
            [newId, req.userId, name, JSON.stringify(assets || [])]
        );
        console.log('📋 Preset created:', name, '(' + newId + ') by user:', req.userId.substring(0, 8) + '...');
        res.json({ success: true, id: newId });
    } catch(err) {
        console.error('POST /api/asset-presets error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete a preset
app.delete('/api/asset-presets/:id', requireDB, authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        const check = await pool.query('SELECT user_id FROM asset_presets WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Preset not found' });
        if (check.rows[0].user_id !== req.userId) return res.status(403).json({ error: 'Not the owner' });

        await pool.query('DELETE FROM asset_presets WHERE id = $1', [id]);
        console.log('🗑️ Preset deleted:', id, 'by user:', req.userId.substring(0, 8) + '...');
        res.json({ success: true, deleted: id });
    } catch(err) {
        console.error('DELETE /api/asset-presets error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// --- POLY.PIZZA API PROXY ---
// Skyddar API-nyckeln server-side, klienten ser aldrig den
const POLY_CACHE_PATH = process.env.POLY_CACHE_PATH || path.join(__dirname, 'poly-cache');

// Category name mapping for enriched responses
const POLY_CATEGORIES = {
    0: 'Food & Drink', 1: 'Clutter', 2: 'Weapons', 3: 'Transport',
    4: 'Furniture & Decor', 5: 'Objects', 6: 'Nature', 7: 'Animals',
    8: 'Buildings', 9: 'People & Characters', 10: 'Scenes & Levels', 11: 'Other'
};

// 1. Sök modeller (proxy till Poly.Pizza API)
//    GET /api/poly/search?q=tree&category=6&page=0
app.get('/api/poly/search', async (req, res) => {
    try {
        const apiKey = process.env.POLY_PIZZA_API_KEY;
        if (!apiKey) {
            return res.status(503).json({ error: 'Poly.Pizza API key not configured' });
        }

        const { q, category, page } = req.query;
        let baseUrl = 'https://api.poly.pizza/v1.1/search';
        if (q && q.trim()) {
            baseUrl += `/${encodeURIComponent(q.trim())}`;
        }

        let params = [];
        if (category !== undefined && category !== '' && category !== 'all') {
            params.push(`category=${category}`);
        } else if (!q || !q.trim()) {
            // API requires at least one of: Category, License, or Animated
            params.push('License=0');
        }
        params.push(`page=${page || 0}`);

        const url = `${baseUrl}?${params.join('&')}`;

        const response = await fetch(url, {
            headers: { 'x-auth-token': apiKey }
        });

        if (!response.ok) {
            console.error('Poly.Pizza API error:', response.status, response.statusText);
            return res.status(response.status).json({ error: 'Poly.Pizza API error' });
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Poly search proxy error:', err);
        res.status(500).json({ error: 'Proxy error' });
    }
});

// 2. Hämta enskild modell-metadata
//    GET /api/poly/model/:id
app.get('/api/poly/model/:id', async (req, res) => {
    try {
        const apiKey = process.env.POLY_PIZZA_API_KEY;
        if (!apiKey) {
            return res.status(503).json({ error: 'Poly.Pizza API key not configured' });
        }

        const response = await fetch(
            `https://api.poly.pizza/v1.1/model/${req.params.id}`,
            { headers: { 'x-auth-token': apiKey } }
        );

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Poly.Pizza API error' });
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Poly model proxy error:', err);
        res.status(500).json({ error: 'Proxy error' });
    }
});

// 3. Ladda ned + cacha GLB-fil
//    GET /api/poly/glb/:id
app.get('/api/poly/glb/:id', async (req, res) => {
    try {
        const modelId = req.params.id;
        const cachePath = path.join(POLY_CACHE_PATH, `${modelId}.glb`);

        // Returnera cachad fil om den finns
        if (fs.existsSync(cachePath)) {
            res.set('Content-Type', 'model/gltf-binary');
            res.set('Cache-Control', 'public, max-age=31536000');
            return res.sendFile(path.resolve(cachePath));
        }

        // Annars: hämta metadata → ladda ned GLB → cacha → returnera
        const apiKey = process.env.POLY_PIZZA_API_KEY;
        if (!apiKey) {
            console.error('❌ POLY_PIZZA_API_KEY not set');
            return res.status(503).json({ error: 'Poly.Pizza API key not configured' });
        }

        console.log(`🍕 Fetching metadata for model: ${modelId}`);
        const meta = await fetch(
            `https://api.poly.pizza/v1.1/model/${modelId}`,
            { headers: { 'x-auth-token': apiKey } }
        );

        if (!meta.ok) {
            console.error(`❌ Poly.Pizza metadata error: ${meta.status} ${meta.statusText}`);
            return res.status(meta.status).json({ error: 'Model not found on Poly.Pizza' });
        }

        const data = await meta.json();
        const glbUrl = data.Download;

        if (!glbUrl) {
            console.error(`❌ No Download URL in model data:`, JSON.stringify(data).substring(0, 200));
            return res.status(404).json({ error: 'No GLB download URL found' });
        }

        console.log(`🍕 Downloading GLB: ${data.Title || modelId} from ${glbUrl.substring(0, 80)}...`);

        const glbResponse = await fetch(glbUrl, {
            headers: {
                'x-auth-token': apiKey,
                'User-Agent': '3D-Golf-AR/1.0'
            }
        });
        if (!glbResponse.ok) {
            console.error(`❌ GLB CDN download failed: ${glbResponse.status} ${glbResponse.statusText}`);
            return res.status(502).json({ error: 'Failed to download GLB from Poly.Pizza CDN' });
        }

        const arrayBuffer = await glbResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Skapa cache-mapp om den inte finns
        try {
            fs.mkdirSync(POLY_CACHE_PATH, { recursive: true });
            fs.writeFileSync(cachePath, buffer);
            console.log(`✅ Cached: ${modelId}.glb (${(buffer.length / 1024).toFixed(1)} KB)`);
        } catch(cacheErr) {
            console.warn('⚠️ Cache write failed (non-fatal):', cacheErr.message);
        }

        res.set('Content-Type', 'model/gltf-binary');
        res.set('Cache-Control', 'public, max-age=31536000');
        res.send(buffer);
    } catch (err) {
        console.error('Poly GLB proxy error:', err.message, err.stack);
        res.status(500).json({ error: 'Proxy error: ' + err.message });
    }
});

// --- SERVING STATIC FILES (För Railway Deploy) ---
// Disable cache for HTML files during development
app.use((req, res, next) => {
    // the service worker and manifest must always be fetched fresh, or an update would never reach the phones
    if (req.path.endsWith('.html') || req.path === '/' || req.path === '/sw.js' || req.path === '/manifest.json' || req.path === '/pwa.js') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
    }
    next();
});
app.use(express.static(__dirname));

// Fallback för allt annat (Catch-all)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'hub.html'));
});

// --- START SERVER ---
app.listen(port, () => {
    console.log(`🚀 Golf Backend running on port ${port}`);
});
