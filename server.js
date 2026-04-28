require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

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

        try {
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0;`);
            await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false;`);
        } catch(e) {}
        console.log("✅ Database schema ready");
    } catch(err) {
        console.error("❌ Database schema error:", err);
    }
}

// Kör initDB om DATABASE_URL finns
if(process.env.DATABASE_URL) {
    initDB();
}

// --- API ENDPOINTS ---

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', db_connected: !!process.env.DATABASE_URL });
});

app.get('/api/courses', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT share_code, name, author, likes, created_at 
            FROM courses 
            WHERE is_draft = false OR is_draft IS NULL
            ORDER BY created_at DESC 
            LIMIT 50
        `);
        res.json(result.rows);
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/courses/:share_code/like', async (req, res) => {
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

// Generera en slumpmässig share_code
function generateShareCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.post('/api/courses', async (req, res) => {
    try {
        const { name, author, holes, targets, trees, terrain_heightmap, terrain_biomemap, is_draft, edit_code, theme_data } = req.body;
        
        // Validering
        if (!holes) return res.status(400).json({ error: 'Missing holes data' });

        const draftStatus = is_draft === true;
        const c_name = name || 'My Golf Course';
        const c_author = author || 'Anonymous';
        const c_theme_data = theme_data || {};

        if (edit_code) {
            // Överskriv en existerande bana om koden matchar!
            const updateResult = await pool.query(
                `UPDATE courses 
                 SET name=$1, author=$2, holes=$3, targets=$4, trees=$5, terrain_heightmap=$6, terrain_biomemap=$7, is_draft=$8, theme_data=$10
                 WHERE share_code=$9 
                 RETURNING share_code`,
                [
                    c_name, c_author, 
                    JSON.stringify(holes), JSON.stringify(targets || []), JSON.stringify(trees || []), 
                    terrain_heightmap, terrain_biomemap, draftStatus, 
                    edit_code.toUpperCase(), JSON.stringify(c_theme_data)
                ]
            );
            
            if (updateResult.rows.length > 0) {
                return res.json({ success: true, share_code: updateResult.rows[0].share_code });
            }
            // Finns den inte? Fallback till INSERT!
        }

        const share_code = generateShareCode();

        const result = await pool.query(
            `INSERT INTO courses 
            (share_code, name, author, holes, targets, trees, terrain_heightmap, terrain_biomemap, is_draft, theme_data) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING share_code`,
            [
                share_code, c_name, c_author, 
                JSON.stringify(holes), JSON.stringify(targets || []), JSON.stringify(trees || []), 
                terrain_heightmap, terrain_biomemap, draftStatus, JSON.stringify(c_theme_data)
            ]
        );

        res.json({ success: true, share_code: result.rows[0].share_code });
    } catch(err) {
        console.error("Error saving course:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/courses/:share_code', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM courses WHERE share_code = $1", [req.params.share_code.toUpperCase()]);
        if(result.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }
        res.json(result.rows[0]);
    } catch(err) {
        console.error("Error fetching course:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- ASSET MANAGER API ---

// Hämta alla custom assets (Mindre payload, exkluderar den tunga file_data vid lista)
app.get('/api/assets', async (req, res) => {
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
app.get('/api/assets/:id/download', async (req, res) => {
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

// Spara/Uppdatera en custom asset
app.post('/api/assets', async (req, res) => {
    try {
        const { id, name, category, subcategory, icon, file_data, config, password } = req.body;
        
        // Enkelt lösenordsskydd för admin-verktyget
        if (password !== 'golfadmin123') {
            return res.status(401).json({ error: 'Unauthorized' });
        }

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

// Ta bort en custom asset (kräver lösenord)
app.delete('/api/assets/:id', async (req, res) => {
    try {
        const { password } = req.body;
        if (password !== 'golfadmin123') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
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
app.get('/api/biomes', async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, config FROM biomes");
        res.json(result.rows);
    } catch(err) {
        console.error("GET /api/biomes Error:", err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/biomes', async (req, res) => {
    try {
        const { adminPassword, id, name, config } = req.body;
        if(adminPassword !== 'golfadmin123') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
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


// --- SERVING STATIC FILES (För Railway Deploy) ---
// Gör så att hela public/ eller roten serveras som en hemsida
app.use(express.static(__dirname));

// Fallback för allt annat (Catch-all)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'hub.html'));
});

// --- START SERVER ---
app.listen(port, () => {
    console.log(`🚀 Golf Backend running on port ${port}`);
});
