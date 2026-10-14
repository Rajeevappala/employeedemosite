const crypto = require('crypto');
const pool = require('../config/database');
const { generateToken } = require('../utils/tokenUtils');
const { sendOtpEmail } = require('./emailService');

const getOtpSecret = () => {
  const secret = process.env.OTP_SECRET || process.env.SESSION_SECRET;
  if (!secret || !secret.trim()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('OTP_SECRET (or SESSION_SECRET) must be configured in production environment.');
    }
    return 'dev_otp_pepper_employee_portal_2026';
  }
  if (process.env.NODE_ENV === 'production' && secret.trim().length < 16) {
    throw new Error('OTP_SECRET must be at least 16 characters in production environment.');
  }
  return secret.trim();
};

const OTP_EXPIRATION_SECONDS = 120; // 2 minutes (120 seconds)
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
 * @param {Object} [options={}] - Optional request options.
 * @param {boolean} [options.isTestMode=false] - Non-production test isolation flag.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const maskEmail = (em) => {
  if (!em || typeof em !== 'string') return '';
  const trimmed = em.trim();
  const [local, dom] = trimmed.split('@');
  if (!dom) return '***';
  const maskedLocal = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1];
  return `${maskedLocal}@${dom}`;
};

const requestOtp = async (rawEmail, options = {}) => {
  if (!isValidEmail(rawEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    throw error;
  }

  const email = rawEmail.trim().toLowerCase();
  const isProd = process.env.NODE_ENV === 'production';
  const displayEmail = isProd ? maskEmail(email) : email;

  const tStart = performance.now();

  // 1 & 2 & 3. Parallelize Cooldown check, Window limit check, and Account lookup
  const [cooldownCheck, windowCheck, userResult] = await Promise.all([
    pool.query(
      `SELECT created_at FROM otp_verifications 
       WHERE email = $1 AND created_at > NOW() - ($2 || ' seconds')::INTERVAL 
       LIMIT 1`,
      [email, RATE_LIMIT_COOLDOWN_SECONDS]
    ),
    pool.query(
      `SELECT COUNT(*)::INTEGER AS count FROM otp_verifications 
       WHERE email = $1 AND created_at > NOW() - ($2 || ' minutes')::INTERVAL`,
      [email, RATE_LIMIT_WINDOW_MINUTES]
    ),
    pool.query(
      `SELECT id, email, role, status FROM users WHERE LOWER(email) = $1`,
      [email]
    ),
  ]);
  const tAfterChecks = performance.now();
  const checksDuration = (tAfterChecks - tStart).toFixed(2);

  // Rate Limiting Enforcement
  if (cooldownCheck.rows.length > 0) {
    console.warn(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] Rate-limit rejection: 60-second cooldown active for ${displayEmail}`);
    const error = new Error(
      `Please wait at least ${RATE_LIMIT_COOLDOWN_SECONDS} seconds before requesting another OTP.`
    );
    error.statusCode = 429;
    throw error;
  }

  if (windowCheck.rows[0]?.count >= RATE_LIMIT_MAX_PER_WINDOW) {
    console.warn(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] Rate-limit rejection: 15-minute window limit exceeded for ${displayEmail}`);
    const error = new Error(
      'Too many OTP requests. Please wait a few minutes before trying again.'
    );
    error.statusCode = 429;
    throw error;
  }

  const user = userResult.rows[0];

  // Anti-enumeration: If user does not exist or is not ACTIVE, return generic success
  // without inserting an OTP or revealing account state.
  if (!user) {
    console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] Account lookup: NOT FOUND for ${displayEmail}. Returning anti-enumeration response (Checks: ${checksDuration}ms).`);
    return {
      success: true,
      message: 'If the account is eligible, an OTP has been sent.',
    };
  }

  if (user.status !== 'ACTIVE') {
    console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] Account lookup: FOUND but INACTIVE (status: ${user.status}) for ${displayEmail}. Returning anti-enumeration response (Checks: ${checksDuration}ms).`);
    return {
      success: true,
      message: 'If the account is eligible, an OTP has been sent.',
    };
  }

  console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] Account lookup: FOUND and ACTIVE (Role: ${user.role}) for ${displayEmail}`);

  // 4. Invalidate previous active unverified OTPs for this user
  const tDbStart = performance.now();
  await pool.query(
    `UPDATE otp_verifications 
     SET expires_at = NOW() 
     WHERE user_id = $1 AND verified_at IS NULL AND expires_at > NOW()`,
    [user.id]
  );

  // 5. Generate secure OTP and hash it
  const tGenStart = performance.now();
  const otp = generateSecureOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRATION_SECONDS * 1000);
  const tGenEnd = performance.now();
  const genDuration = (tGenEnd - tGenStart).toFixed(2);

  // 6. Store hashed OTP in database
  console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] OTP generation completed. Persisting hashed token to database...`);
  let otpRecordId;
  try {
    const insertResult = await pool.query(
      `INSERT INTO otp_verifications (user_id, email, otp_hash, expires_at, attempts)
       VALUES ($1, $2, $3, $4, 0)
       RETURNING id`,
      [user.id, email, otpHash, expiresAt]
    );
    otpRecordId = insertResult.rows[0]?.id;
    console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] OTP persistence SUCCESS (Record ID: ${otpRecordId}). Raw OTP and hash withheld.`);
  } catch (dbErr) {
    console.error(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] OTP persistence FAILURE for ${displayEmail}. Reason: ${dbErr.message}`);
    throw dbErr;
  }
  const tDbEnd = performance.now();
  const dbDuration = (tDbEnd - tDbStart).toFixed(2);

  // 7. Dispatch OTP via email delivery provider
  console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] Email dispatch started for ${displayEmail} (TestMode: ${Boolean(options.isTestMode)})`);
  const tEmailStart = performance.now();
  try {
    await sendOtpEmail({
      to: email,
      otp,
      isTestMode: Boolean(options.isTestMode),
    });
    const tEmailEnd = performance.now();
    const emailDuration = (tEmailEnd - tEmailStart).toFixed(2);
    const totalDuration = (tEmailEnd - tStart).toFixed(2);

    console.log(
      `[OTP_PERF] [${new Date().toISOString()}] Timing breakdown for ${displayEmail} - Checks: ${checksDuration}ms, Gen: ${genDuration}ms, DB: ${dbDuration}ms, Email: ${emailDuration}ms, Total: ${totalDuration}ms`
    );
  } catch (deliveryError) {
    const tEmailEnd = performance.now();
    const emailDuration = (tEmailEnd - tEmailStart).toFixed(2);
    const totalDuration = (tEmailEnd - tStart).toFixed(2);

    console.error(
      `[OTP_PERF] [${new Date().toISOString()}] Email dispatch failed after ${emailDuration}ms (Total: ${totalDuration}ms) for ${displayEmail}. Reason: ${deliveryError.message}`
    );

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
    `SELECT u.id, u.admin_id, u.email, u.role, u.status, u.employee_id,
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
      adminId: user.admin_id || null,
      admin_id: user.admin_id || null,
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
