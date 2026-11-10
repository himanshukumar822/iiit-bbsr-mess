const session = require('express-session');
const db = require('../config/db');

/**
 * Lightweight MySQL-backed session store for express-session.
 * Persists sessions across Vercel serverless invocations using the shared mysql2/promise pool.
 */
class MySQLSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.defaultTTL = options.ttlMs || 24 * 60 * 60 * 1000;
    this.tableReadyPromise = null;
  }

  async ensureTable() {
    if (!this.tableReadyPromise) {
      this.tableReadyPromise = db
        .query(
          `CREATE TABLE IF NOT EXISTS sessions (
            session_id VARCHAR(128) NOT NULL PRIMARY KEY,
            expires BIGINT UNSIGNED NOT NULL,
            data MEDIUMTEXT NULL,
            INDEX idx_sessions_expires (expires)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        )
        .catch(err => {
          this.tableReadyPromise = null;
          throw err;
        });
    }
    return this.tableReadyPromise;
  }

  computeExpires(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      const exp = new Date(sess.cookie.expires).getTime();
      if (!Number.isNaN(exp)) return exp;
    }
    const maxAge = sess && sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : this.defaultTTL;
    return Date.now() + maxAge;
  }

  async get(sid, callback) {
    try {
      await this.ensureTable();
      const [rows] = await db.query(
        'SELECT data, expires FROM sessions WHERE session_id = ?',
        [sid]
      );
      if (rows.length === 0) {
        return callback(null, null);
      }
      const row = rows[0];
      if (Date.now() > Number(row.expires)) {
        await db.query('DELETE FROM sessions WHERE session_id = ?', [sid]);
        return callback(null, null);
      }
      const parsed = row.data ? JSON.parse(row.data) : null;
      return callback(null, parsed);
    } catch (err) {
      return callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      await this.ensureTable();
      const expires = this.computeExpires(sess);
      const serialized = JSON.stringify(sess);
      await db.query(
        `INSERT INTO sessions (session_id, expires, data)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
        [sid, expires, serialized]
      );
      return callback && callback(null);
    } catch (err) {
      return callback && callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.ensureTable();
      await db.query('DELETE FROM sessions WHERE session_id = ?', [sid]);
      return callback && callback(null);
    } catch (err) {
      return callback && callback(err);
    }
  }

  async touch(sid, sess, callback) {
    try {
      await this.ensureTable();
      const expires = this.computeExpires(sess);
      await db.query('UPDATE sessions SET expires = ? WHERE session_id = ?', [expires, sid]);
      return callback && callback(null);
    } catch (err) {
      return callback && callback(err);
    }
  }
}

module.exports = MySQLSessionStore;
