const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isAuthenticated, hasRole } = require('../middleware/auth');

// All routes require authenticated superadmin
router.use(isAuthenticated, hasRole('superadmin'));

// Validation regexes
const ROLL_NO_REGEX = /^[A-Za-z0-9_-]{4,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 1. GET /admins — list all admin users
router.get('/admins', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, roll_no, name, email, hostel, room_no, role, is_active, created_at
       FROM users
       WHERE role IN ('admin', 'superadmin')
       ORDER BY FIELD(role, 'superadmin', 'admin'), name ASC`
    );

    return res.json({ success: true, admins: rows });
  } catch (error) {
    console.error('Error fetching admins:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching admins', error: error.message });
  }
});

// 2. POST /admins — create a new admin
router.post('/admins', async (req, res) => {
  try {
    const { roll_no, name, email, password, hostel, room_no } = req.body;

    if (!roll_no || !name || !email || !password || !hostel) {
      return res.status(400).json({
        success: false,
        message: 'roll_no, name, email, password, and hostel are required'
      });
    }

    const trimmedRoll = roll_no.trim();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedHostel = hostel.trim();
    const trimmedRoom = room_no ? room_no.trim() : null;

    if (!ROLL_NO_REGEX.test(trimmedRoll)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Admin ID / Roll No format. Must be 4-20 alphanumeric characters'
      });
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address format'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if roll_no or email already in use
    const [existing] = await db.query(
      'SELECT id, roll_no, email FROM users WHERE LOWER(roll_no) = LOWER(?) OR LOWER(email) = LOWER(?)',
      [trimmedRoll, trimmedEmail]
    );

    if (existing.length > 0) {
      const matchRoll = existing.some(u => u.roll_no.toLowerCase() === roll_no.trim().toLowerCase());
      const matchEmail = existing.some(u => u.email.toLowerCase() === email.trim().toLowerCase());
      const conflictField = matchRoll && matchEmail ? 'Roll number and Email' : matchRoll ? 'Roll number' : 'Email';
      return res.status(409).json({
        success: false,
        message: `${conflictField} is already registered`
      });
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const [result] = await db.query(
      `INSERT INTO users (roll_no, name, email, password_hash, hostel, room_no, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', TRUE)`,
      [roll_no.trim(), name.trim(), email.trim().toLowerCase(), password_hash, hostel.trim(), room_no ? room_no.trim() : null]
    );

    return res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      admin: {
        id: result.insertId,
        roll_no: roll_no.trim(),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        hostel: hostel.trim(),
        room_no: room_no ? room_no.trim() : null,
        role: 'admin'
      }
    });
  } catch (error) {
    console.error('Error creating admin:', error);
    return res.status(500).json({ success: false, message: 'Server error creating admin', error: error.message });
  }
});

// 3. DELETE /admins/:id — deactivate an admin
router.delete('/admins/:id', async (req, res) => {
  try {
    const admin_id = req.params.id;

    const [admins] = await db.query(
      'SELECT id, name, role, is_active FROM users WHERE id = ?',
      [admin_id]
    );

    if (admins.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const admin = admins[0];

    // Prevent self-deactivation
    if (admin.id === req.session.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account'
      });
    }

    await db.query(
      'UPDATE users SET is_active = FALSE WHERE id = ?',
      [admin_id]
    );

    return res.json({
      success: true,
      message: `Admin '${admin.name}' has been deactivated successfully`
    });
  } catch (error) {
    console.error('Error deactivating admin:', error);
    return res.status(500).json({ success: false, message: 'Server error deactivating admin', error: error.message });
  }
});

// 4. GET /settings — return all mess_settings
router.get('/settings', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, setting_key, setting_value, updated_at FROM mess_settings ORDER BY setting_key ASC'
    );

    return res.json({ success: true, settings: rows });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching settings', error: error.message });
  }
});

// 5. PUT /settings — update settings { key, value }
router.put('/settings', async (req, res) => {
  try {
    const key = req.body.key || req.body.setting_key;
    const value = req.body.value !== undefined ? req.body.value : req.body.setting_value;

    if (!key || value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Setting key and value are required'
      });
    }

    const strValue = String(value).trim();

    await db.query(
      `INSERT INTO mess_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key.trim(), strValue]
    );

    return res.json({
      success: true,
      message: `Setting '${key}' updated successfully`,
      setting: {
        key: key.trim(),
        value: strValue
      }
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    return res.status(500).json({ success: false, message: 'Server error updating setting', error: error.message });
  }
});

// 6. GET /reports — list all daily reports, newest first
router.get('/reports', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM daily_reports ORDER BY report_date DESC'
    );

    return res.json({ success: true, reports: rows });
  } catch (error) {
    console.error('Error fetching daily reports:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching daily reports', error: error.message });
  }
});

// 7. GET /reports/:date — get specific daily report
router.get('/reports/:date', async (req, res) => {
  try {
    const date = req.params.date;

    const [rows] = await db.query(
      'SELECT * FROM daily_reports WHERE report_date = ?',
      [date]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No daily report found for date ${date}`
      });
    }

    return res.json({ success: true, report: rows[0] });
  } catch (error) {
    console.error('Error fetching daily report for date:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching daily report', error: error.message });
  }
});

// 8. GET /stats/overview — system-wide stats
router.get('/stats/overview', async (req, res) => {
  try {
    // 1. Total active students
    const [students] = await db.query(
      'SELECT COUNT(*) AS total_students FROM users WHERE role = "student" AND is_active = TRUE'
    );

    // 2. Total revenue this month
    const [revenue] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_revenue
       FROM payments
       WHERE status = 'verified'
         AND DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(CURRENT_DATE, '%Y-%m')`
    );

    // 3. Total coupons sold / created
    const [coupons] = await db.query(
      'SELECT COUNT(*) AS total_coupons FROM coupons'
    );

    // 4. Average daily attendance (count of used coupons per active day)
    const [attendance] = await db.query(
      `SELECT COALESCE(AVG(daily_count), 0) AS avg_attendance
       FROM (
         SELECT meal_date, COUNT(*) AS daily_count
         FROM coupons
         WHERE status = 'used'
         GROUP BY meal_date
       ) AS daily_stats`
    );

    return res.json({
      success: true,
      stats: {
        total_students: students[0].total_students,
        total_revenue_this_month: parseFloat(revenue[0].total_revenue) || 0,
        total_coupons_sold: coupons[0].total_coupons,
        average_daily_attendance: Math.round(parseFloat(attendance[0].avg_attendance) || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching system overview stats:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching overview stats', error: error.message });
  }
});

module.exports = router;
