const mysql = require('mysql2/promise');
require('dotenv').config();

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'iiit_mess',
  waitForConnections: true,
  connectionLimit: process.env.VERCEL ? 3 : 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: ['DATE']
};

// Enable SSL when connecting to cloud MySQL providers (e.g. Aiven, TiDB Cloud, PlanetScale, Railway)
if (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1') {
  poolConfig.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
  };
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;
