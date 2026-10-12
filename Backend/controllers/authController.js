const otpService = require('../services/otpService');
const { recordAuditLog } = require('../services/auditService');

const maskEmail = (em) => {
  if (!em || typeof em !== 'string') return '';
  const trimmed = em.trim();
  const [local, dom] = trimmed.split('@');
  if (!dom) return '***';
  const maskedLocal = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1];
  return `${maskedLocal}@${dom}`;
};

/**
 * Handles POST /api/auth/request-otp
 */
const requestOtp = async (req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  const timestamp = new Date().toISOString();
  try {
    const { email } = req.body;

    if (!email) {
      console.warn(`[OTP_DEBUG_BACKEND] [${timestamp}] OTP request rejected: Email address missing. Final HTTP status: 400`);
      return res.status(400).json({
        success: false,
        message: 'Email address is required.',
      });
    }

    const logEmail = isProd ? maskEmail(email) : String(email).trim();
    console.log(`[OTP_DEBUG_BACKEND] [${timestamp}] OTP request received for: ${logEmail}`);

    // Determine if request originates from an automated test suite.
    // STRICT SECURITY REQUIREMENT: NEVER activate test mode if process.env.NODE_ENV === 'production'.
    const isTestMode =
      process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && req?.headers?.['x-test-suite'] === 'true');

    const response = await otpService.requestOtp(email, { isTestMode });

    // Audit log OTP request (email safely logged without token/hash)
    recordAuditLog({
      action: 'AUTH_OTP_REQUEST',
      entityType: 'AUTH',
      metadata: { email: String(email).trim().toLowerCase() },
      req,
    }).catch(() => {});

    console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] OTP request handled successfully. Final HTTP status: 200`);
    return res.status(200).json(response);
  } catch (error) {
    const statusCode = error.statusCode || error.status || 500;
    console.error(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] OTP request failed. Final HTTP status: ${statusCode}. Sanitized reason: ${error.message}`);
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
