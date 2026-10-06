const pool = require('../config/database');

/**
 * Strips sensitive keys (passwords, OTPs, tokens, secrets, storage keys) from audit metadata.
 */
const sanitizeAuditMetadata = (data) => {
  if (!data || typeof data !== 'object') return {};
  const sanitized = {};
  const SENSITIVE_KEYS = [
    'password',
    'pass',
    'otp',
    'otp_hash',
    'token',
    'jwt',
    'secret',
    'storage_key',
    'private_storage_path',
    'auth',
    'authorization',
  ];

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

/**
 * Records an immutable audit log entry in PostgreSQL.
 * Fails safely without halting business logic if the logging insert fails.
 *
 * @param {Object} entry
 * @param {string} [entry.userId] - User ID initiating the action
 * @param {string} entry.action - Descriptive action code (e.g. AUTH_LOGIN, DOCUMENT_UPLOAD)
 * @param {string} [entry.entityType] - Type of entity acted on (e.g. DOCUMENT, LEAVE, PAYROLL)
 * @param {string} [entry.entityId] - Identifier of the entity
 * @param {Object} [entry.metadata] - Non-sensitive context metadata
 * @param {Object} [entry.req] - Express request object to extract IP and User-Agent
 */
const recordAuditLog = async ({
  userId = null,
  action,
  entityType = null,
  entityId = null,
  metadata = {},
  req = null,
}) => {
  try {
    let ipAddress = null;
    let userAgent = null;

    if (req) {
      // Parse IP safely (supports proxies if configured)
      const rawIp = req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress;
      if (rawIp) {
        // If comma-separated in x-forwarded-for, take the first client IP
        const clientIp = String(rawIp).split(',')[0].trim();
        // Basic IPv4 / IPv6 validation for PostgreSQL INET type
        if (/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(clientIp)) {
          ipAddress = clientIp;
        }
      }
      userAgent = req.headers['user-agent'] || null;

      if (!userId && req.user?.id) {
        userId = req.user.id;
      }
    }

    const safeMeta = sanitizeAuditMetadata(metadata);

    await pool.query(
      `INSERT INTO public.audit_logs (
         user_id, action, entity_type, entity_id, metadata, ip_address, user_agent
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId || null,
        String(action).toUpperCase(),
        entityType ? String(entityType).toUpperCase() : null,
        entityId ? String(entityId) : null,
        JSON.stringify(safeMeta),
        ipAddress,
        userAgent,
      ]
    );
  } catch (error) {
    // Non-fatal: do not block core transaction
    console.error('Audit logging failed (non-fatal):', error.message);
  }
};

module.exports = {
  recordAuditLog,
  sanitizeAuditMetadata,
};
