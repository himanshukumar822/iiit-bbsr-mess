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

// Enable proxy trust for reverse proxies (Render / Vercel / Nginx)
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
if (!process.env.VERCEL && !process.env.RENDER) {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}

// Persistent MySQL-backed Session Store (works locally, on Render, and on Vercel)
const sessionStore = new MySQLSessionStore({
  ttlMs: 24 * 60 * 60 * 1000
});

const isSecureCookie =
  process.env.NODE_ENV === 'production' ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.VERCEL);

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
      secure: isSecureCookie,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Health check endpoint (responds immediately before DB schema check for Render health probes)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'IIIT Bhubaneswar Mess Management API is running',
    timestamp: new Date()
  });
});

// Ensure schema migrations run once on startup / cold start
let schemaInitPromise = null;
function ensureInitialized() {
  if (!schemaInitPromise) {
    schemaInitPromise = ensureWalletSchema().catch(() => {});
  }
  return schemaInitPromise;
}

app.use('/api', async (req, res, next) => {
  await ensureInitialized();
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

// Start server immediately if run directly (Render / local / VM) so platform port checks succeed fast
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    ensureInitialized();
  });
}

module.exports = { app, upload };
