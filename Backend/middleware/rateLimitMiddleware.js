const rateLimit = require('express-rate-limit');

/**
 * Standard JSON response handler for rate limited requests.
 */
const createRateLimitResponse = (message) => {
  return (req, res) => {
    const timestamp = new Date().toISOString();
    console.warn(`[OTP_DEBUG_BACKEND] [${timestamp}] Rate-limit rejection (IP level): ${req.method} ${req.originalUrl}. HTTP 429`);
    res.status(429).json({
      success: false,
      message,
    });
  };
};

/**
 * Skip rate limiting during automated test suite execution to prevent test flapping.
 */
const shouldSkipInTest = (req) => {
  return (
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && req?.headers?.['x-test-suite'] === 'true')
  );
};

/**
 * Rate limiter for requesting OTPs.
 * Protects against mass email dispatch spam and infrastructure exhaustion.
 * Window: 15 minutes, Max: 5 requests per IP by default.
 */
const otpRequestLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_OTP_MAX, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipInTest,
  handler: createRateLimitResponse('Too many OTP requests. Please wait a few minutes before trying again.'),
});

/**
 * Rate limiter for verifying OTPs.
 * Protects against brute-force attacks across varying email targets from a single IP.
 * Window: 15 minutes, Max: 10 attempts per IP by default.
 */
const otpVerifyLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_VERIFY_MAX, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipInTest,
  handler: createRateLimitResponse('Too many verification attempts. Please wait before trying again.'),
});

/**
 * Rate limiter for general authentication queries (e.g. /api/auth/me).
 */
const authGeneralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipInTest,
  handler: createRateLimitResponse('Too many authentication requests. Please try again later.'),
});

/**
 * Rate limiter for file uploads.
 * Window: 15 minutes, Max: 30 uploads per IP.
 */
const fileUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX, 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipInTest,
  handler: createRateLimitResponse('Upload limit reached. Please wait a few minutes before uploading again.'),
});

/**
 * Rate limiter for sensitive administrative mutation endpoints.
 * Window: 15 minutes, Max: 120 mutations per IP.
 */
const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipInTest,
  handler: createRateLimitResponse('Administrative action limit exceeded. Please wait a moment.'),
});

/**
 * Rate limiter for Excel payroll import operations (preview and confirm).
 * Window: 15 minutes, Max: 30 requests per IP.
 */
const excelImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipInTest,
  handler: createRateLimitResponse('Payroll import request limit reached. Please wait a few minutes before trying again.'),
});

module.exports = {
  otpRequestLimiter,
  otpVerifyLimiter,
  authGeneralLimiter,
  fileUploadLimiter,
  adminMutationLimiter,
  excelImportLimiter,
};
