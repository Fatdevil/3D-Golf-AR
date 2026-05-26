const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        const res = await pool.query("SELECT id, category, subcategory FROM custom_assets WHERE id = 'COMPRESSED'");
        console.log(res.rows);
    } catch(err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
run();
