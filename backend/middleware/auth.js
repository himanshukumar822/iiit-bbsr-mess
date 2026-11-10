/**
 * Authentication and Authorization Middleware
 */

// 1. isAuthenticated — checks req.session.user exists, else redirect to login
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  if (
    req.xhr ||
    (req.originalUrl && req.originalUrl.startsWith('/api')) ||
    (req.headers?.accept && req.headers.accept.includes('application/json'))
  ) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
  }
  return res.redirect('/login');
};

// 2. hasRole(...roles) — checks if logged-in user's role is in the allowed roles array, else 403
const hasRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      if (
        req.xhr ||
        (req.originalUrl && req.originalUrl.startsWith('/api')) ||
        (req.headers?.accept && req.headers.accept.includes('application/json'))
      ) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
      }
      return res.redirect('/login');
    }

    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to access this resource.'
      });
    }

    return next();
  };
};

module.exports = {
  isAuthenticated,
  hasRole
};
