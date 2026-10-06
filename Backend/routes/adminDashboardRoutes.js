const express = require('express');
const router = express.Router();

const adminDashboardController = require('../controllers/adminDashboardController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// All admin dashboard routes require valid JWT session and role ADMIN or SUPER_ADMIN.
router.use(authenticateToken, requireRole('ADMIN', 'SUPER_ADMIN'));

// GET /api/admin/dashboard - Aggregated metrics across workforce, attendance, leaves, payroll, documents
router.get('/', adminDashboardController.getAdminDashboard);

module.exports = router;
