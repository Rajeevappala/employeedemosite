const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  otpRequestLimiter,
  otpVerifyLimiter,
  authGeneralLimiter,
} = require('../middleware/rateLimitMiddleware');

// Public authentication routes (with IP-level rate limiting protection)
router.post('/request-otp', otpRequestLimiter, authController.requestOtp);
router.post('/verify-otp', otpVerifyLimiter, authController.verifyOtp);

// Authenticated session route
router.get('/me', authGeneralLimiter, authenticateToken, authController.getMe);

module.exports = router;
