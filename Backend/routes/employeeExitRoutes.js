const express = require('express');
const router = express.Router();
const employeeExitController = require('../controllers/employeeExitController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

router.use(authenticateToken, requireRole('EMPLOYEE'));

// POST /api/employee/exit/apply
router.post('/apply', employeeExitController.applyResignation);

// GET /api/employee/exit/status
router.get('/status', employeeExitController.getExitStatus);

// PATCH /api/employee/exit/withdraw
router.patch('/withdraw', employeeExitController.withdrawResignation);

// Document downloads (legacy endpoints)
router.get('/relieving-letter', employeeExitController.downloadRelievingLetter);
router.get('/experience-certificate', employeeExitController.downloadExperienceCertificate);
router.get('/fnf-statement', employeeExitController.downloadFnfStatement);

// Document download/view by document ID
router.get('/documents/:documentId/download', employeeExitController.downloadExitDocumentById);
router.get('/documents/:documentId/view', employeeExitController.viewExitDocumentById);

module.exports = router;
