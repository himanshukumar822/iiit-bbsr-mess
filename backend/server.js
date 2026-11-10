const path = require('path');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const MySQLSessionStore = require('./utils/sessionStore');
const { ensureWalletSchema } = require('./utils/wallet');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable proxy trust for reverse proxies (Vercel / Nginx)
app.set('trust proxy', 1);

// Middleware: CORS (allow credentials for session cookies)
app.use(cors({
  origin: true,
  credentials: true
}));

// Middleware: Body parsing (JSON + URL-encoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware: Static file serving from frontend/ and uploads/
app.use(express.static(path.join(__dirname, '../frontend')));
if (!process.env.VERCEL) {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}

// Persistent MySQL-backed Session Store (works locally & across Vercel serverless functions)
const sessionStore = new MySQLSessionStore({
  ttlMs: 24 * 60 * 60 * 1000
});

// Middleware: Express Session (24 hour maxAge, httpOnly, sameSite, proxy-aware)
app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'iiit_bbsr_mess_secret_key_change_in_production',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Ensure schema migrations run once per cold start in serverless environments
let schemaInitPromise = null;
app.use('/api', async (req, res, next) => {
  if (!schemaInitPromise) {
    schemaInitPromise = ensureWalletSchema().catch(() => {});
  }
  await schemaInitPromise;
  next();
});

// Multer upload middleware
const upload = require('./middleware/upload');
app.set('upload', upload);

// Mount Route Files
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const superadminRoutes = require('./routes/superadmin');

app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superadminRoutes);

// Login redirect
app.get('/login', (req, res) => {
  res.redirect('/index.html');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'IIIT Bhubaneswar Mess Management API is running',
    timestamp: new Date()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum size allowed is 4-5MB.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  } else if (err) {
    return res.status(400).json({ success: false, message: err.message || 'An error occurred' });
  }
  next();
});

// Start server if run directly (local/VM)
if (require.main === module) {
  ensureWalletSchema().finally(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  });
}

module.exports = { app, upload };
