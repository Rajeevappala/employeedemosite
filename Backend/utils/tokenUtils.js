const crypto = require('crypto');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be configured in production environment.');
    }
    return 'dev_secret_employee_portal_session_key_2026';
  }
  return secret;
};

const DEFAULT_EXPIRATION_SECONDS = parseInt(process.env.JWT_EXPIRES_IN, 10) || 24 * 60 * 60; // 24 hours

/**
 * Encodes a string or object into Base64URL format.
 */
const base64UrlEncode = (input) => {
  const str = typeof input === 'object' ? JSON.stringify(input) : String(input);
  return Buffer.from(str).toString('base64url');
};

/**
 * Decodes a Base64URL string into UTF-8.
 */
const base64UrlDecode = (str) => {
  return Buffer.from(str, 'base64url').toString('utf8');
};

/**
 * Signs a payload and returns a compact, cryptographically secure JWT string (HS256).
 *
 * @param {Object} payload - User identification and role data.
 * @param {number} expiresInSeconds - Token validity in seconds (default: 24h).
 * @returns {string} Signed token in format header.payload.signature
 */
const generateToken = (payload, expiresInSeconds = DEFAULT_EXPIRATION_SECONDS) => {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(fullPayload);

  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

/**
 * Verifies a token signature and checks expiration.
 *
 * @param {string} token - Signed token.
 * @returns {Object} Decoded payload if valid.
 * @throws {Error} If token is missing, invalid structure, bad signature, or expired.
 */
const verifyToken = (token) => {
  if (!token || typeof token !== 'string') {
    const error = new Error('Token is required');
    error.statusCode = 401;
    throw error;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    const error = new Error('Invalid token structure');
    error.statusCode = 401;
    throw error;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Recompute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const sigBuffer = Buffer.from(signatureB64);
  const expectedSigBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedSigBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)
  ) {
    const error = new Error('Invalid token signature');
    error.statusCode = 401;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    const error = new Error('Malformed token payload');
    error.statusCode = 401;
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    const error = new Error('Session has expired. Please log in again.');
    error.statusCode = 401;
    throw error;
  }

  return payload;
};

module.exports = {
  generateToken,
  verifyToken,
};
