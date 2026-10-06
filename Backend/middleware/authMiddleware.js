const { verifyToken } = require('../utils/tokenUtils');

/**
 * Middleware to authenticate requests via Bearer token.
 * Extracts authenticated identity and attaches req.user.
 * Note: employee_id is derived strictly from verified credentials, never frontend input.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyToken(token);

    req.user = {
      id: payload.userId || payload.id,
      email: payload.email,
      role: payload.role,
      employee_id: payload.employeeId || payload.employee_id || null,
    };

    next();
  } catch (error) {
    return res.status(error.statusCode || 401).json({
      success: false,
      message: error.message || 'Invalid or expired session token.',
    });
  }
};

/**
 * Middleware to restrict endpoints to specific roles.
 * @param  {...string} allowedRoles - e.g. 'ADMIN', 'SUPER_ADMIN', 'EMPLOYEE'
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole,
};
