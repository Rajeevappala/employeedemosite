const otpService = require('../services/otpService');
const { recordAuditLog } = require('../services/auditService');

/**
 * Handles POST /api/auth/request-otp
 */
const requestOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required.',
      });
    }

    const response = await otpService.requestOtp(email);

    // Audit log OTP request (email safely logged without token/hash)
    recordAuditLog({
      action: 'AUTH_OTP_REQUEST',
      entityType: 'AUTH',
      metadata: { email: email.trim().toLowerCase() },
      req,
    }).catch(() => {});

    return res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Handles POST /api/auth/verify-otp
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and 6-digit OTP are required.',
      });
    }

    const response = await otpService.verifyOtp(email, otp);

    // Audit log successful authentication
    if (response && response.user) {
      recordAuditLog({
        userId: response.user.id,
        action: 'AUTH_LOGIN_SUCCESS',
        entityType: 'USER',
        entityId: response.user.id,
        metadata: {
          email: response.user.email,
          role: response.user.role,
          employee_id: response.user.employee_id,
        },
        req,
      }).catch(() => {});
    }

    return res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Handles GET /api/auth/me (Protected - returns current authenticated identity)
 */
const getMe = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requestOtp,
  verifyOtp,
  getMe,
};
