require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const pool = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const documentRoutes = require('./routes/documentRoutes');
const employeePayslipRoutes = require('./routes/employeePayslipRoutes');
const employeePfRoutes = require('./routes/employeePfRoutes');
const leaveRoutes = require('./routes/leaveRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const employeeDashboardRoutes = require('./routes/employeeDashboardRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const adminEmployeeRoutes = require('./routes/adminEmployeeRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminAttendanceRoutes = require('./routes/adminAttendanceRoutes');
const adminLeaveRoutes = require('./routes/adminLeaveRoutes');
const adminDocumentRoutes = require('./routes/adminDocumentRoutes');
const adminPfRoutes = require('./routes/adminPfRoutes');
const adminPayrollRoutes = require('./routes/adminPayrollRoutes');
const adminExitRoutes = require('./routes/adminExitRoutes');
const adminSettingsRoutes = require('./routes/adminSettingsRoutes');
const employeeExitRoutes = require('./routes/employeeExitRoutes');
const employeeBankDetailsRoutes = require('./routes/employeeBankDetailsRoutes');
const notFoundMiddleware = require('./middleware/notFoundMiddleware');
const errorMiddleware = require('./middleware/errorMiddleware');
const { requireActiveEmployee } = require('./middleware/activeEmployeeMiddleware');
const { validateEnvironment } = require('./config/envValidator');

// Validate critical environment configurations at server boot
validateEnvironment();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (e.g. Nginx, Cloudflare) for secure client IP detection and protocol
app.set('trust proxy', 1);

// Security Headers: Helmet customized for safe PDF blob viewing and API isolation
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'self'", 'blob:'],
        frameAncestors: ["'self'"],
      },
    },
    hsts:
      process.env.NODE_ENV === 'production'
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    frameguard: { action: 'sameorigin' },
  })
);

// CORS: Strict environment-controlled allowlist
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : (isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']);

const corsOptions = {
  origin: (origin, callback) => {
    // Permit requests with no origin (e.g., node test scripts, mobile apps, curl)
    if (!origin) {
      return callback(null, true);
    }
    if (
      allowedOrigins.includes(origin) ||
      (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:'))
    ) {
      return callback(null, true);
    }
    const err = new Error('CORS policy: Access from specified origin is not permitted.');
    err.statusCode = 403;
    callback(err);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Disposition'],
};

app.use(cors(corsOptions));

// Explicit request body size limits to prevent Denial of Service (DoS)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Logging: Redact or skip trivial health checks
app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    skip: (req) => req.url === '/api/health',
  })
);

// Health check endpoint (safe, non-sensitive)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Employee Portal API is running',
  });
});

// Authentication routes
app.use('/api/auth', authRoutes);

// Employee Exit & Offboarding routes
app.use('/api/employee/exit', employeeExitRoutes);

// Employee document routes
app.use('/api/employee/documents', requireActiveEmployee, documentRoutes);

// Employee payslip routes
app.use('/api/employee/payslips', requireActiveEmployee, employeePayslipRoutes);

// Employee PF routes
app.use('/api/employee/pf', requireActiveEmployee, employeePfRoutes);

// Employee Bank Details routes
app.use('/api/employee/bank-details', requireActiveEmployee, employeeBankDetailsRoutes);

// Employee leave routes
app.use('/api/employee/leaves', requireActiveEmployee, leaveRoutes);

// Employee attendance routes
app.use('/api/employee/attendance', requireActiveEmployee, attendanceRoutes);

// Employee dashboard routes
app.use('/api/employee/dashboard', requireActiveEmployee, employeeDashboardRoutes);


// Employee business routes
app.use('/api/employee', requireActiveEmployee, employeeRoutes);

// Admin dashboard routes
app.use('/api/admin/dashboard', adminDashboardRoutes);

// Admin employee routes
app.use('/api/admin/employees', adminEmployeeRoutes);

// Admin user management routes
app.use('/api/admin/users', adminUserRoutes);

// Admin attendance routes
app.use('/api/admin/attendance', adminAttendanceRoutes);

// Admin leave routes
app.use('/api/admin/leaves', adminLeaveRoutes);

// Admin document routes
app.use('/api/admin/documents', adminDocumentRoutes);

// Admin PF routes
app.use('/api/admin/pf', adminPfRoutes);

// Admin Payroll routes
app.use('/api/admin/payroll', adminPayrollRoutes);


// Admin Exit & Offboarding routes
app.use('/api/admin/exit', adminExitRoutes);

// Admin Settings routes
app.use('/api/admin/settings', adminSettingsRoutes);

// 404 Not Found Handler
app.use(notFoundMiddleware);

// Centralized Error Handler
app.use(errorMiddleware);

// Test PostgreSQL connection
const testDatabaseConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('PostgreSQL connected successfully');
    client.release();
  } catch (error) {
    const sanitizedMessage = (error && error.message)
      ? error.message.replace(/:\/\/[^@]+@/, '://***:***@')
      : 'Unknown error';
    console.error('PostgreSQL connection failed:', sanitizedMessage);
  }
};

let server;

// Start server
const startServer = async () => {
  await testDatabaseConnection();

  server = app.listen(PORT, () => {
    console.log(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
};

const handleGracefulShutdown = (signal) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  // Force exit after 10s timeout to prevent hanging connections
  const forceTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out after 10s. Forcing exit.');
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  if (server) {
    server.close(async (err) => {
      if (err) {
        console.error('Error closing HTTP server:', err.message);
      } else {
        console.log('HTTP server closed. Stopped accepting new connections.');
      }

      try {
        await pool.end();
        console.log('PostgreSQL connection pool closed successfully.');
        clearTimeout(forceTimer);
        process.exit(0);
      } catch (poolErr) {
        console.error('Error closing PostgreSQL pool:', poolErr.message);
        clearTimeout(forceTimer);
        process.exit(1);
      }
    });
  } else {
    pool.end().then(() => {
      console.log('PostgreSQL connection pool closed.');
      clearTimeout(forceTimer);
      process.exit(0);
    }).catch((poolErr) => {
      console.error('Error closing PostgreSQL pool:', poolErr.message);
      clearTimeout(forceTimer);
      process.exit(1);
    });
  }
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

startServer();

module.exports = app;
