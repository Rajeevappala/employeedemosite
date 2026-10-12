const express = require('express');
const router = express.Router();

const adminPayrollController = require('../controllers/adminPayrollController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { uploadSingleExcel, uploadSinglePayslipPdf } = require('../middleware/uploadMiddleware');
const { excelImportLimiter, fileUploadLimiter } = require('../middleware/rateLimitMiddleware');

// All admin payroll routes require valid JWT session and role ADMIN.
router.use(authenticateToken, requireRole('ADMIN'));

// =============================================================================
// Monthly Payslips Management
// =============================================================================
// GET /api/admin/payroll/monthly-payslips - List employees and their payslip status for period
router.get('/monthly-payslips', adminPayrollController.getMonthlyPayslips);

// POST /api/admin/payroll/monthly-payslips/upload - Upload a monthly payslip PDF
router.post(
  '/monthly-payslips/upload',
  fileUploadLimiter,
  uploadSinglePayslipPdf,
  adminPayrollController.uploadMonthlyPayslip
);

// POST /api/admin/payroll/monthly-payslips/replace - Replace an existing monthly payslip PDF
router.post(
  '/monthly-payslips/replace',
  fileUploadLimiter,
  uploadSinglePayslipPdf,
  adminPayrollController.replaceMonthlyPayslip
);

// PUT /api/admin/payroll/monthly-payslips/replace - Replace an existing monthly payslip PDF (body contains employee_id)
router.put(
  '/monthly-payslips/replace',
  fileUploadLimiter,
  uploadSinglePayslipPdf,
  adminPayrollController.replaceMonthlyPayslip
);

// PUT /api/admin/payroll/monthly-payslips/:employeeId/replace - Replace an existing monthly payslip PDF
router.put(
  '/monthly-payslips/:employeeId/replace',
  fileUploadLimiter,
  uploadSinglePayslipPdf,
  adminPayrollController.replaceMonthlyPayslip
);

// GET /api/admin/payroll/template - Download official Excel payroll template
router.get('/template', adminPayrollController.downloadPayrollTemplate);

// POST /api/admin/payroll/import/preview - Upload and validate Excel workbook (read-only)
router.post(
  '/import/preview',
  excelImportLimiter,
  uploadSingleExcel,
  adminPayrollController.previewPayrollImport
);

// POST /api/admin/payroll/import/confirm - Commit validated payroll batch and generate payslips
router.post(
  '/import/confirm',
  excelImportLimiter,
  adminPayrollController.confirmPayrollImport
);

// GET /api/admin/payroll/history - Distinct historical payroll periods
router.get('/history', adminPayrollController.getAdminPayrollHistory);

// GET /api/admin/payroll/attendance-summary - Monthly attendance metrics for payroll
router.get('/attendance-summary', adminPayrollController.getAdminAttendanceSummary);

// POST /api/admin/payroll/process - Process monthly payroll records
router.post('/process', adminPayrollController.processAdminPayroll);

// POST /api/admin/payroll/generate-payslips - Batch generate payslips for all processed employees in period
router.post('/generate-payslips', adminPayrollController.generateAllAdminPayslips);

// POST /api/admin/payroll/:employeeId/:year/:month/generate-payslip - Generate PDF payslip for single employee
router.post('/:employeeId/:year/:month/generate-payslip', adminPayrollController.generateAdminPayslip);

// POST /api/admin/payroll/:employeeId/generate-payslip - Generate PDF payslip for single employee with body params
router.post('/:employeeId/generate-payslip', adminPayrollController.generateAdminPayslip);

// GET /api/admin/payroll - List monthly payroll records with search/filters
router.get('/', adminPayrollController.getAdminPayrollRecords);

// GET /api/admin/payroll/:employeeId/profile - Salary profile for single employee
router.get('/:employeeId/profile', adminPayrollController.getAdminPayrollProfile);

// PUT /api/admin/payroll/:employeeId/profile - Update salary profile for single employee
router.put('/:employeeId/profile', adminPayrollController.updateAdminPayrollProfile);

// GET /api/admin/payroll/:employeeId - Payroll record or profile for single employee
router.get('/:employeeId', adminPayrollController.getAdminEmployeePayroll);

module.exports = router;
