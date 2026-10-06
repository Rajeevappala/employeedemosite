const crypto = require('crypto');
const pool = require('../config/database');
const { generateToken } = require('../utils/tokenUtils');
const { sendOtpEmail } = require('./emailService');

const getOtpSecret = () => {
  const secret = process.env.OTP_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('OTP_SECRET (or SESSION_SECRET) must be configured in production environment.');
    }
    return 'dev_otp_pepper_employee_portal_2026';
  }
  return secret;
};

const OTP_EXPIRATION_MINUTES = 5;
const MAX_VERIFICATION_ATTEMPTS = 5;
const RATE_LIMIT_COOLDOWN_SECONDS = 60;
const RATE_LIMIT_MAX_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MINUTES = 15;

/**
 * Standard email format validator.
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 */
const generateSecureOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hashes an OTP with SHA-256 and a secret salt.
 */
const hashOtp = (otp) => {
  return crypto
    .createHash('sha256')
    .update(`${otp}:${getOtpSecret()}`)
    .digest('hex');
};

/**
 * Compares candidate OTP with stored hash using constant-time comparison.
 */
const verifyOtpHash = (candidateOtp, storedHash) => {
  const candidateHash = hashOtp(candidateOtp);
  const candBuf = Buffer.from(candidateHash, 'hex');
  const storeBuf = Buffer.from(storedHash, 'hex');

  if (candBuf.length !== storeBuf.length) return false;
  return crypto.timingSafeEqual(candBuf, storeBuf);
};

/**
 * Handles requesting an OTP for user authentication.
 * Follows generic response patterns to prevent account enumeration.
 *
 * @param {string} rawEmail - Email address submitted by user.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const requestOtp = async (rawEmail) => {
  if (!isValidEmail(rawEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    throw error;
  }

  const email = rawEmail.trim().toLowerCase();

  // 1. Rate Limiting: Check cooldown (60 seconds)
  const cooldownCheck = await pool.query(
    `SELECT created_at FROM otp_verifications 
     WHERE email = $1 AND created_at > NOW() - ($2 || ' seconds')::INTERVAL 
     LIMIT 1`,
    [email, RATE_LIMIT_COOLDOWN_SECONDS]
  );

  if (cooldownCheck.rows.length > 0) {
    const error = new Error(
      `Please wait at least ${RATE_LIMIT_COOLDOWN_SECONDS} seconds before requesting another OTP.`
    );
    error.statusCode = 429;
    throw error;
  }

  // 2. Rate Limiting: Check window limit (max 5 requests per 15 minutes)
  const windowCheck = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count FROM otp_verifications 
     WHERE email = $1 AND created_at > NOW() - ($2 || ' minutes')::INTERVAL`,
    [email, RATE_LIMIT_WINDOW_MINUTES]
  );

  if (windowCheck.rows[0]?.count >= RATE_LIMIT_MAX_PER_WINDOW) {
    const error = new Error(
      'Too many OTP requests. Please wait a few minutes before trying again.'
    );
    error.statusCode = 429;
    throw error;
  }

  // 3. Find user by email
  const userResult = await pool.query(
    `SELECT id, email, role, status FROM users WHERE LOWER(email) = $1`,
    [email]
  );

  const user = userResult.rows[0];

  // Anti-enumeration: If user does not exist or is not ACTIVE, return generic success
  // without inserting an OTP or revealing account state.
  if (!user || user.status !== 'ACTIVE') {
    return {
      success: true,
      message: 'If the account is eligible, an OTP has been sent.',
    };
  }

  // 4. Invalidate previous active unverified OTPs for this user
  await pool.query(
    `UPDATE otp_verifications 
     SET expires_at = NOW() 
     WHERE user_id = $1 AND verified_at IS NULL AND expires_at > NOW()`,
    [user.id]
  );

  // 5. Generate secure OTP and hash it
  const otp = generateSecureOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60 * 1000);

  // 6. Store hashed OTP in database
  const insertResult = await pool.query(
    `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at, attempts)
     VALUES ($1, $2, $3, $4, 0)
     RETURNING id`,
    [user.id, email, otpHash, expiresAt]
  );
  const otpRecordId = insertResult.rows[0]?.id;

  // 7. Dispatch OTP via email delivery provider
  try {
    await sendOtpEmail({ to: email, otp });
  } catch (deliveryError) {
    // If delivery fails, remove the undelivered OTP record to prevent leaving an orphaned active OTP
    if (otpRecordId) {
      await pool.query('DELETE FROM otp_verifications WHERE id = $1', [otpRecordId]).catch(() => {});
    }
    throw deliveryError;
  }

  return {
    success: true,
    message: 'If the account is eligible, an OTP has been sent.',
  };
};

/**
 * Handles verifying an OTP and generating an authenticated session.
 *
 * @param {string} rawEmail - Email address.
 * @param {string} rawOtp - 6-digit candidate OTP.
 * @returns {Promise<Object>} Verification result with session token and user profile.
 */
const verifyOtp = async (rawEmail, rawOtp) => {
  if (!isValidEmail(rawEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    throw error;
  }

  const email = rawEmail.trim().toLowerCase();
  const otp = String(rawOtp || '').trim();

  // Validate OTP format: exactly 6 digits
  if (!/^\d{6}$/.test(otp)) {
    const error = new Error('OTP must be exactly 6 digits.');
    error.statusCode = 400;
    throw error;
  }

  // 1. Fetch latest unverified OTP record for this email
  const otpRecordResult = await pool.query(
    `SELECT id, user_id, email, otp_hash, expires_at, attempts, verified_at, created_at
     FROM otp_verifications
     WHERE email = $1 AND verified_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  );

  const otpRecord = otpRecordResult.rows[0];

  if (!otpRecord) {
    const error = new Error('Invalid or expired OTP.');
    error.statusCode = 400;
    throw error;
  }

  // 2. Check maximum verification attempts (5 attempts)
  if (otpRecord.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    const error = new Error('Maximum verification attempts exceeded. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  // 3. Check expiration (5 minutes)
  const now = new Date();
  if (now > new Date(otpRecord.expires_at)) {
    const error = new Error('OTP has expired. Please request a new one.');
    error.statusCode = 400;
    throw error;
  }

  // 4. Compare OTP securely using timing-safe comparison
  const isMatch = verifyOtpHash(otp, otpRecord.otp_hash);

  if (!isMatch) {
    // Increment failed attempts
    await pool.query(
      `UPDATE otp_verifications 
       SET attempts = attempts + 1 
       WHERE id = $1`,
      [otpRecord.id]
    );

    const remainingAttempts = Math.max(0, MAX_VERIFICATION_ATTEMPTS - (otpRecord.attempts + 1));
    const error = new Error(
      remainingAttempts > 0
        ? `Invalid OTP. ${remainingAttempts} attempt(s) remaining.`
        : 'Maximum verification attempts exceeded. Please request a new OTP.'
    );
    error.statusCode = 400;
    throw error;
  }

  // 5. Successful match: mark verified and prevent reuse
  await pool.query(
    `UPDATE otp_verifications 
     SET verified_at = NOW() 
     WHERE id = $1`,
    [otpRecord.id]
  );

  // Invalidate any other unverified OTP records for this user
  await pool.query(
    `UPDATE otp_verifications 
     SET expires_at = NOW() 
     WHERE user_id = $1 AND id != $2 AND verified_at IS NULL`,
    [otpRecord.user_id, otpRecord.id]
  );

  // 6. Fetch authoritative user profile and employee linkage
  const userResult = await pool.query(
    `SELECT u.id, u.email, u.role, u.status, u.employee_id,
            COALESCE(e.first_name, u.first_name) AS first_name,
            COALESCE(e.last_name, u.last_name) AS last_name,
            e.department, e.designation
     FROM users u
     LEFT JOIN employees e ON u.employee_id = e.employee_id
     WHERE u.id = $1`,
    [otpRecord.user_id]
  );

  const user = userResult.rows[0];

  if (!user || user.status !== 'ACTIVE') {
    const error = new Error('Account is inactive or suspended.');
    error.statusCode = 403;
    throw error;
  }

  // 7. Generate authenticated session token
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employee_id || null,
  });

  return {
    success: true,
    message: 'Authentication successful.',
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      employee_id: user.employee_id || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      department: user.department || null,
      designation: user.designation || null,
    },
  };
};

module.exports = {
  requestOtp,
  verifyOtp,
  // Exported for internal / testing utilities if needed
  isValidEmail,
  generateSecureOtp,
  hashOtp,
  verifyOtpHash,
};
