/**
 * Startup Environment Validator
 * Enforces security requirements on environment configurations.
 * Fails safely during startup if critical production secrets are absent or weak.
 * NEVER prints secret values.
 */

function validateEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';
  const missing = [];
  const weak = [];

  // Required in all environments
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    missing.push('DATABASE_URL');
  }

  // Strict enforcement in production
  if (isProduction) {
    if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
      missing.push('JWT_SECRET');
    } else if (process.env.JWT_SECRET.trim().length < 32) {
      weak.push('JWT_SECRET (must be at least 32 characters in production)');
    }

    const otpSecret = process.env.OTP_SECRET || process.env.SESSION_SECRET;
    if (!otpSecret || !otpSecret.trim()) {
      missing.push('OTP_SECRET (or SESSION_SECRET)');
    } else if (otpSecret.trim().length < 16) {
      weak.push('OTP_SECRET (must be at least 16 characters in production)');
    }

    // Ensure JWT_SECRET and OTP_SECRET are independent and not identical
    if (
      process.env.JWT_SECRET &&
      otpSecret &&
      process.env.JWT_SECRET.trim() === otpSecret.trim()
    ) {
      weak.push('JWT_SECRET and OTP_SECRET must be independently generated and cannot be identical');
    }

    if (!process.env.CORS_ORIGIN || !process.env.CORS_ORIGIN.trim()) {
      missing.push('CORS_ORIGIN (explicit allowed origins required in production)');
    }
  } else {
    // Development guidance
    if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
      console.warn('⚠️  [SECURITY WARNING] JWT_SECRET is not configured in .env. A fallback development secret is being used. DO NOT USE IN PRODUCTION.');
    }
    if ((!process.env.OTP_SECRET || !process.env.OTP_SECRET.trim()) && (!process.env.SESSION_SECRET || !process.env.SESSION_SECRET.trim())) {
      console.warn('⚠️  [SECURITY WARNING] OTP_SECRET is not configured in .env. A fallback development salt is being used. DO NOT USE IN PRODUCTION.');
    }
    if (
      process.env.JWT_SECRET &&
      process.env.OTP_SECRET &&
      process.env.JWT_SECRET.trim() === process.env.OTP_SECRET.trim()
    ) {
      console.warn('⚠️  [SECURITY WARNING] JWT_SECRET and OTP_SECRET should be independently generated and distinct.');
    }
  }

  if (missing.length > 0 || weak.length > 0) {
    console.error('========================================================');
    console.error('❌  CRITICAL CONFIGURATION ERROR: ENVIRONMENT VALIDATION FAILED');
    console.error('========================================================');
    if (missing.length > 0) {
      console.error('Missing required environment variable(s):');
      missing.forEach((item) => console.error(`  - ${item}`));
    }
    if (weak.length > 0) {
      console.error('Insecure / weak secret configuration(s):');
      weak.forEach((item) => console.error(`  - ${item}`));
    }
    console.error('Please configure these variables in your production environment.');
    console.error('Never commit secret values to version control.');
    console.error('========================================================');

    if (isProduction) {
      process.exit(1);
    }
  }
}

module.exports = {
  validateEnvironment,
};
