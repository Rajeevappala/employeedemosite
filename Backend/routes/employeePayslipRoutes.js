const express = require('express');
const router = express.Router();

const employeePayslipController = require('../controllers/employeePayslipController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// All employee payslip routes require valid JWT session and EMPLOYEE role.
router.use(authenticateToken, requireRole('EMPLOYEE'));

// GET /api/employee/payslips - List employee payslips with optional year/month filters & pagination
router.get('/', employeePayslipController.getEmployeePayslips);

// GET /api/employee/payslips/:documentId/view - Securely stream PDF for inline preview
router.get('/:documentId/view', employeePayslipController.viewEmployeePayslip);

// GET /api/employee/payslips/:documentId/download - Securely stream PDF for download
router.get('/:documentId/download', employeePayslipController.downloadEmployeePayslip);

module.exports = router;
