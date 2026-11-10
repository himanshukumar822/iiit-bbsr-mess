const db = require('../config/db');

/**
 * Ensures wallet_balance, wallet_used, and wallet_transactions exist in MySQL
 * (safe idempotent migration for existing databases).
 */
async function ensureWalletSchema() {
  try {
    const [userCols] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME = 'wallet_balance'`
    );
    if (userCols.length === 0) {
      await db.query(
        `ALTER TABLE users ADD COLUMN wallet_balance DECIMAL(10,2) DEFAULT 0.00 AFTER role`
      );
      console.log('Migration: Added users.wallet_balance column');
    }

    const [orderCols] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'coupon_orders'
         AND COLUMN_NAME = 'wallet_used'`
    );
    if (orderCols.length === 0) {
      await db.query(
        `ALTER TABLE coupon_orders ADD COLUMN wallet_used DECIMAL(10,2) DEFAULT 0.00 AFTER includes_sunday`
      );
      console.log('Migration: Added coupon_orders.wallet_used column');
    }

    await db.query(
      `CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        type ENUM('credit', 'debit') NOT NULL,
        reason VARCHAR(255) NOT NULL,
        reference_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wallet_student_created (student_id, created_at),
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    const [payCols] = await db.query(
      `SELECT DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'payments'
         AND COLUMN_NAME = 'screenshot_path'`
    );
    if (payCols.length > 0 && String(payCols[0].DATA_TYPE).toLowerCase() === 'varchar') {
      await db.query(`ALTER TABLE payments MODIFY COLUMN screenshot_path MEDIUMTEXT NULL`);
      console.log('Migration: Expanded payments.screenshot_path to MEDIUMTEXT');
    }
  } catch (err) {
    console.error('Wallet schema check skipped/failed:', err.message || err.code);
  }
}

/**
 * Fetches current meal prices from mess_settings
 */
async function getMealPrices(conn = db) {
  const [settingsRows] = await conn.query(
    `SELECT setting_key, setting_value FROM mess_settings WHERE setting_key LIKE '%_price'`
  );
  const prices = { breakfast: 30, lunch: 50, snacks: 15, dinner: 50 };
  settingsRows.forEach(setting => {
    if (setting.setting_key === 'breakfast_price') prices.breakfast = parseFloat(setting.setting_value) || 30;
    if (setting.setting_key === 'lunch_price') prices.lunch = parseFloat(setting.setting_value) || 50;
    if (setting.setting_key === 'snacks_price') prices.snacks = parseFloat(setting.setting_value) || 15;
    if (setting.setting_key === 'dinner_price') prices.dinner = parseFloat(setting.setting_value) || 50;
  });
  return prices;
}

module.exports = {
  ensureWalletSchema,
  getMealPrices
};
