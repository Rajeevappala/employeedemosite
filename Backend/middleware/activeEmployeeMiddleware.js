const pool = require('../config/database');
const { verifyToken } = require('../utils/tokenUtils');

/**
 * Middleware to verify that an authenticated EMPLOYEE is currently in ACTIVE status.
 * Deactivated / separated employees (INACTIVE) are blocked from accessing general
 * employee portal APIs (profile, attendance, leaves, payslips, pf, documents, dashboard)
 * with a 403 Forbidden response.
 *
 * If no Authorization header is present or the token is invalid, this middleware delegates
 * to next() so that downstream authenticateToken middleware handles 401 Unauthorized.
 */
const requireActiveEmployee = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyToken(token);
    if (payload && payload.role === 'EMPLOYEE') {
      const empId = payload.employeeId || payload.employee_id;
      const userId = payload.userId || payload.id;

      const checkRes = await pool.query(
        `SELECT u.status AS user_status, e.status AS emp_status
         FROM public.users u
         LEFT JOIN public.employees e ON e.employee_id = u.employee_id
         WHERE u.id = $1 OR e.employee_id = $2`,
        [userId, empId]
      );

      const statusRow = checkRes.rows[0];
      if (
        statusRow &&
        (statusRow.user_status === 'INACTIVE' || statusRow.emp_status === 'INACTIVE' ||
         statusRow.user_status === 'SUSPENDED' || statusRow.emp_status === 'SUSPENDED')
      ) {
        return res.status(403).json({
          success: false,
          message: 'Account is deactivated or suspended. Access to employee services is denied.',
        });
      }
    }
  } catch {
    // Invalid or expired token: delegate to downstream authenticateToken for standard 401
    return next();
  }

  next();
};

module.exports = {
  requireActiveEmployee,
};
