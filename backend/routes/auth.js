const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../config/db');

// Rate limiters applied ONLY to login and registration (not /me or /logout)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 failed login attempts per 15 minutes
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed login attempts. Please try again after 15 minutes.'
  }
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many registration attempts. Please try again after 15 minutes.'
  }
});

// Validation regular expressions
const ROLL_NO_REGEX = /^[A-Za-z0-9_-]{4,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register — student self-registration (role always 'student')
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { roll_no, name, email, password, hostel, room_no } = req.body;

    if (!roll_no || !name || !email || !password || !hostel) {
      return res.status(400).json({
        success: false,
        message: 'roll_no, name, email, password, and hostel are required fields'
      });
    }

    const trimmedRoll = roll_no.trim();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedHostel = hostel.trim();
    const trimmedRoom = room_no ? room_no.trim() : null;

    // Validate Roll Number format
    if (!ROLL_NO_REGEX.test(trimmedRoll)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid roll number format. Must be 4-20 alphanumeric characters (e.g. B121045)'
      });
    }

    // Validate Email format
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address format'
      });
    }

    // Validate Password length
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Validate Name length
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Name must be between 2 and 100 characters'
      });
    }

    // Check if roll_no or email already exists
    const [existingUsers] = await db.query(
      'SELECT id, roll_no, email FROM users WHERE LOWER(roll_no) = LOWER(?) OR LOWER(email) = LOWER(?)',
      [trimmedRoll, trimmedEmail]
    );

    if (existingUsers.length > 0) {
      const matchRoll = existingUsers.some(u => u.roll_no.toLowerCase() === trimmedRoll.toLowerCase());
      const matchEmail = existingUsers.some(u => u.email.toLowerCase() === trimmedEmail.toLowerCase());
      const conflictField = matchRoll && matchEmail ? 'Roll number and Email' : matchRoll ? 'Roll number' : 'Email';
      return res.status(409).json({
        success: false,
        message: `${conflictField} is already registered`
      });
    }

    // Hash password with salt rounds 10
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Role is strictly 'student' for registration
    const role = 'student';

    const [result] = await db.query(
      `INSERT INTO users (roll_no, name, email, password_hash, hostel, room_no, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [trimmedRoll, trimmedName, trimmedEmail, password_hash, trimmedHostel, trimmedRoom, role]
    );

    return res.status(201).json({
      success: true,
      message: 'Student registered successfully',
      user: {
        id: result.insertId,
        roll_no: trimmedRoll,
        name: trimmedName,
        email: trimmedEmail,
        hostel: trimmedHostel,
        room_no: trimmedRoom,
        role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message
    });
  }
});

// POST /api/auth/login — email/roll_no + password, set session
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { identifier, email, roll_no, password } = req.body;
    const loginIdentifier = identifier || email || roll_no;

    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Identifier (email or roll number) and password are required'
      });
    }

    const trimmedIdentifier = loginIdentifier.trim();

    const [users] = await db.query(
      `SELECT id, roll_no, name, email, password_hash, hostel, room_no, role, is_active
       FROM users
       WHERE (LOWER(email) = LOWER(?) OR LOWER(roll_no) = LOWER(?))`,
      [trimmedIdentifier, trimmedIdentifier]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact the mess administration.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Set session user and explicitly persist before responding
    req.session.user = {
      id: user.id,
      roll_no: user.roll_no,
      name: user.name,
      email: user.email,
      hostel: user.hostel,
      room_no: user.room_no,
      role: user.role
    };

    return req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({
          success: false,
          message: 'Server error saving session'
        });
      }
      return res.json({
        success: true,
        message: 'Logged in successfully',
        user: req.session.user
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message
    });
  }
});

// POST /api/auth/logout — destroy session
router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({
          success: false,
          message: 'Could not log out, please try again'
        });
      }
      res.clearCookie('connect.sid');
      return res.json({
        success: true,
        message: 'Logged out successfully'
      });
    });
  } else {
    return res.json({
      success: true,
      message: 'Already logged out'
    });
  }
});

// GET /api/auth/me — return current user info
router.get('/me', async (req, res) => {
  try {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }

    const [users] = await db.query(
      `SELECT id, roll_no, name, email, hostel, room_no, role, COALESCE(wallet_balance, 0) AS wallet_balance, is_active, created_at
       FROM users
       WHERE id = ?`,
      [req.session.user.id]
    );

    if (users.length === 0 || !users[0].is_active) {
      req.session.destroy();
      return res.status(401).json({
        success: false,
        message: 'User no longer exists or has been deactivated'
      });
    }

    return res.json({
      success: true,
      user: users[0]
    });
  } catch (error) {
    console.error('Fetch /me error:', error);
    if (req.session && req.session.user) {
      return res.json({
        success: true,
        user: req.session.user
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error fetching user information',
      error: error.message
    });
  }
});

module.exports = router;
