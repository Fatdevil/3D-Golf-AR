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

// TODO: Endpoint för att Spara en bana (POST /api/courses)
// TODO: Endpoint för att Ladda en bana (GET /api/courses/:share_code)

// --- SERVING STATIC FILES (För Railway Deploy) ---
// Gör så att hela public/ eller roten serveras som en hemsida
app.use(express.static(__dirname));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'hub.html'));
});

// --- START SERVER ---
app.listen(port, () => {
    console.log(`🚀 Golf Backend running on port ${port}`);
});
