/**
 * Centralized Application Error Handling Middleware
 *
 * Ensures:
 * 1. Safe JSON error structure { success: false, message: string }
 * 2. No stack traces or SQL details leaked in production responses
 * 3. Proper HTTP status mapping for payload size (413), syntax errors (400), and storage errors
 * 4. Redaction of any credential strings in error messages
 */
const errorMiddleware = (err, req, res, next) => {
  // Determine appropriate HTTP status code
  let statusCode = err.statusCode || err.status || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);

  // Handle express.json / body-parser payload limit exceeded
  if (err.type === 'entity.too.large' || statusCode === 413) {
    statusCode = 413;
    return res.status(413).json({
      success: false,
      message: 'Request payload exceeds the maximum allowed limit.',
    });
  }

  // Handle malformed JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Malformed JSON payload in request body.',
    });
  }

  // Handle PostgreSQL invalid syntax / UUID format error (22P02)
  if (err.code === '22P02') {
    return res.status(400).json({
      success: false,
      message: 'Invalid parameter or identifier format.',
    });
  }

  // Handle PostgreSQL unique constraint violation (23505)
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'A record with the specified unique values already exists.',
    });
  }

  // Sanitize message: redact any connection strings or passwords
  let rawMessage = err.message || 'Internal Server Error';
  if (typeof rawMessage === 'string') {
    rawMessage = rawMessage
      .replace(/:\/\/[^@]+@/, '://***:***@')
      .replace(/(password|secret|pass)\s*[:=]\s*[^\s,]+/gi, '$1=***');
  }

  // In production, sanitize 500 internal server errors completely
  const isProduction = process.env.NODE_ENV === 'production';
  let clientMessage = rawMessage;
  if (statusCode === 500 && isProduction) {
    clientMessage = 'An unexpected internal server error occurred.';
  }

  // Log server-side for diagnostics (with credential redaction)
  if (statusCode === 500) {
    console.error(`[Server Error 500] ${req.method} ${req.originalUrl}:`, rawMessage);
  }

  res.status(statusCode).json({
    success: false,
    message: clientMessage,
    ...(!isProduction && err.stack ? { stack: err.stack } : {}),
  });
};

module.exports = errorMiddleware;
