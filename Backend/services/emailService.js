const nodemailer = require('nodemailer');

let cachedTransporter = null;

/**
 * Creates and configures the Nodemailer SMTP transporter with connection pooling.
 * Values are retrieved strictly from environment variables.
 */
const createTransporter = () => {
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT, 10) || 465;
  const secure = process.env.EMAIL_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD;

  const connectionTimeout = parseInt(process.env.SMTP_CONNECTION_TIMEOUT, 10) || 10000;
  const greetingTimeout = parseInt(process.env.SMTP_GREETING_TIMEOUT, 10) || 10000;
  const socketTimeout = parseInt(process.env.SMTP_SOCKET_TIMEOUT, 10) || 15000;

  // If credentials are not configured, warn on server (without exposing secrets)
  if (!user || !pass) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        'Warning: SMTP_USER/EMAIL_USER or SMTP_PASS/EMAIL_PASSWORD is not configured. Email dispatch will be unavailable.'
      );
    }
  }

  return nodemailer.createTransport({
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
  });
};

/**
 * Returns a cached singleton transporter instance to reuse established SMTP connections.
 */
const getTransporter = () => {
  if (!cachedTransporter) {
    cachedTransporter = createTransporter();
  }
  return cachedTransporter;
};

/**
 * Resets the cached transporter on connection/socket failures so subsequent requests
 * can re-establish a healthy pool cleanly.
 */
const resetTransporter = () => {
  if (cachedTransporter && typeof cachedTransporter.close === 'function') {
    try {
      cachedTransporter.close();
    } catch (_) {}
  }
  cachedTransporter = null;
};

/**
 * Verifies SMTP connectivity at server startup or during health checks.
 * Avoid running this on individual OTP requests to prevent unnecessary latency.
 */
const verifySmtpConnection = async () => {
  if (process.env.NODE_ENV === 'test') {
    return { verified: true, isTestMode: true };
  }
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD;
  if (!user || !pass) {
    console.warn('[SMTP_STARTUP] SMTP credentials not fully configured; email dispatch may be unavailable.');
    return { verified: false, reason: 'missing_credentials' };
  }
  try {
    const transporter = getTransporter();
    await transporter.verify();
    console.log('[SMTP_STARTUP] SMTP connection verified successfully.');
    return { verified: true };
  } catch (err) {
    const sanitizedMsg = sanitizeEmailError(err?.message);
    console.warn(`[SMTP_STARTUP] SMTP connection verification warning: ${sanitizedMsg}`);
    return { verified: false, error: sanitizedMsg };
  }
};

/**
 * Masks email address for secure logging in production environments.
 */
const maskEmail = (em) => {
  if (!em || typeof em !== 'string') return '';
  const trimmed = em.trim();
  const [local, dom] = trimmed.split('@');
  if (!dom) return '***';
  const maskedLocal = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1];
  return `${maskedLocal}@${dom}`;
};

/**
 * Sanitizes error messages to ensure SMTP credentials or passwords are never logged.
 */
const sanitizeEmailError = (message) => {
  if (!message || typeof message !== 'string') return 'Unknown email delivery error';
  return message
    .replace(/:\/\/[^@]+@/, '://***:***@')
    .replace(/(password|pass|secret)\s*[:=]\s*[^\s,]+/gi, '$1=***');
};

/**
 * In-memory buffer of recent emails recorded in test mode.
 * STRICT SECURITY GUARANTEE: Never populated or accessible in NODE_ENV === 'production'.
 */
let testDispatchedEmails = [];

const recordTestEmail = (emailData) => {
  if (process.env.NODE_ENV === 'production') return;
  testDispatchedEmails.push(emailData);
  if (testDispatchedEmails.length > 100) {
    testDispatchedEmails.shift();
  }
};

const getTestDispatchedEmails = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Test email inspection is strictly forbidden in production.');
  }
  return [...testDispatchedEmails];
};

const getLastTestEmailFor = (email) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Test email inspection is strictly forbidden in production.');
  }
  const filtered = testDispatchedEmails.filter(
    (e) => e.to.toLowerCase() === email.trim().toLowerCase()
  );
  return filtered[filtered.length - 1] || null;
};

const clearTestEmails = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Test email clearing is strictly forbidden in production.');
  }
  testDispatchedEmails = [];
};

/**
 * Sends a professional OTP email to the user.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address.
 * @param {string} options.otp - 6-digit numeric OTP.
 * @param {boolean} [options.isTestMode=false] - Non-production test flag.
 * @returns {Promise<{ success: boolean, messageId: string, isTestMock?: boolean }>}
 */
const sendOtpEmail = async ({ to, otp, isTestMode = false }) => {
  if (!to) {
    const error = new Error('Recipient email is required.');
    error.statusCode = 400;
    throw error;
  }

  if (!otp) {
    const error = new Error('OTP is required for delivery.');
    error.statusCode = 400;
    throw error;
  }

  // =========================================================================
  // TEST ENVIRONMENT EMAIL ISOLATION
  // When NODE_ENV === 'test' or non-production test suite flag is set:
  // - Do NOT connect to smtp.gmail.com.
  // - Do NOT send real emails.
  // - Do NOT require real SMTP credentials.
  // - Preserve OTP generation, hashing, database storage, and expiry.
  // STRICT SECURITY REQUIREMENT: NEVER allow NODE_ENV === 'production' to bypass real email.
  // =========================================================================
  const isProduction = process.env.NODE_ENV === 'production';
  const shouldMockEmail = !isProduction && (process.env.NODE_ENV === 'test' || isTestMode === true);

  if (shouldMockEmail) {
    const mockMessageId = `<test-mock-${Date.now()}-${Math.random().toString(36).substring(2, 9)}@test.local>`;
    recordTestEmail({
      to,
      otp,
      messageId: mockMessageId,
      dispatchedAt: new Date().toISOString(),
    });

    console.log('[MOCK_EMAIL_DISPATCH] Test mode active — OTP email simulated in memory (no SMTP network call):', {
      to,
      messageId: mockMessageId,
    });

    return {
      success: true,
      messageId: mockMessageId,
      isTestMock: true,
    };
  }

  const rawFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@gaintpro.com';
  const from = rawFrom.includes('<') ? rawFrom : `"GaintPro HRM Portal" <${rawFrom}>`;
  const subject = 'Your GaintPro Employee Portal Login OTP';

  const textContent = `Hello,

Your OTP for signing in to the GaintPro Employee Portal is:

${otp}

This OTP is valid for 5 minutes.
Do not share this OTP with anyone.

If you did not request this OTP, you can safely ignore this email.

Regards,
GaintPro Employee Portal`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 24px; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <tr>
      <td style="padding: 24px 32px; background-color: #0f172a; text-align: center;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #ffffff; letter-spacing: 0.5px;">GaintPro Employee Portal</h1>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5; color: #334155;">Hello,</p>
        <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.5; color: #334155;">Your one-time password (OTP) for signing in to the <strong>GaintPro Employee Portal</strong> is:</p>
        
        <div style="background-color: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 18px; text-align: center; margin: 0 0 24px;">
          <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0f172a;">${otp}</span>
        </div>

        <p style="margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: #475569;">
          <strong>Security Notice:</strong>
        </p>
        <ul style="margin: 0 0 24px; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #64748b;">
          <li>This OTP is valid for <strong>5 minutes</strong>.</li>
          <li><strong>Do not share this OTP</strong> with anyone. GaintPro staff will never ask for your OTP.</li>
          <li>If you did not request this OTP, you can safely ignore this email.</li>
        </ul>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />

        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #94a3b8;">
          Regards,<br />
          <strong style="color: #64748b;">GaintPro Employee Portal Team</strong>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const displayEmail = isProduction ? maskEmail(to) : to;
  console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] Email dispatch started via SMTP transport. Recipient: ${displayEmail}`);

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    });

    console.log(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] SMTP accepted message: messageId=${info.messageId || 'N/A'}, response='${info.response || 'N/A'}'`);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    // Reset transporter on connection failure to discard stale pool sockets
    resetTransporter();

    const sanitizedErrorMsg = sanitizeEmailError(error?.message);
    const errCode = error?.code || error?.responseCode || 'UNKNOWN';
    console.error(`[OTP_DEBUG_BACKEND] [${new Date().toISOString()}] SMTP rejected message: code=${errCode}, responseCode=${error?.responseCode || 'N/A'}, command=${error?.command || 'N/A'}, error=${sanitizedErrorMsg}`);

    const deliveryError = new Error('Failed to deliver verification code. Please try again later.');
    deliveryError.statusCode = 502;
    throw deliveryError;
  }
};

module.exports = {
  sendOtpEmail,
  getTransporter,
  createTransporter,
  resetTransporter,
  verifySmtpConnection,
  sanitizeEmailError,
  // Test-only utilities (guarded against production usage)
  getTestDispatchedEmails,
  getLastTestEmailFor,
  clearTestEmails,
};
