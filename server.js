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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
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

// Generera en slumpmässig share_code
function generateShareCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.post('/api/courses', async (req, res) => {
    try {
        const { name, author, holes, targets, trees, terrain_heightmap, terrain_biomemap } = req.body;
        
        // Validering
        if (!holes) return res.status(400).json({ error: 'Missing holes data' });

        const share_code = generateShareCode();
        const c_name = name || 'My Golf Course';
        const c_author = author || 'Anonymous';

        const result = await pool.query(
            `INSERT INTO courses 
            (share_code, name, author, holes, targets, trees, terrain_heightmap, terrain_biomemap) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING share_code`,
            [
                share_code, c_name, c_author, 
                JSON.stringify(holes), JSON.stringify(targets || []), JSON.stringify(trees || []), 
                terrain_heightmap, terrain_biomemap
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
