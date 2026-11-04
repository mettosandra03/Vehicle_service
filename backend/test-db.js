require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  try {
    const db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    const [rows] = await db.query('SHOW TABLES');
    console.log('Connected! Tables:', rows);
    await db.end();
  } catch (err) {
    console.error('Connection failed:', err.message);
  }
})();