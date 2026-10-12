const express = require('express');
const router = express.Router();
const adminExitController = require('../controllers/adminExitController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

const { uploadSingleExitDocumentPdf } = require('../middleware/uploadMiddleware');

router.use(authenticateToken, requireRole('ADMIN'));

// GET /api/admin/exit/requests
router.get('/requests', adminExitController.getExitRequests);

// PATCH /api/admin/exit/requests/:id/review
router.patch('/requests/:id/review', adminExitController.reviewExitRequest);

// PUT /api/admin/exit/clearance/:id
router.put('/clearance/:id', adminExitController.updateClearance);

// POST /api/admin/exit/fnf/calculate
router.post('/fnf/calculate', adminExitController.calculateFnfPreview);

// POST /api/admin/exit/fnf/finalize
router.post('/fnf/finalize', adminExitController.finalizeExit);

// Exit Document Management
router.get('/:id/documents', adminExitController.getExitDocuments);
router.post('/:id/documents', uploadSingleExitDocumentPdf, adminExitController.uploadExitDocument);
router.patch('/documents/:documentId/release-date', adminExitController.updateDocumentReleaseDate);
router.get('/documents/:documentId/download', adminExitController.adminDownloadExitDocument);
router.get('/documents/:documentId/view', adminExitController.adminViewExitDocument);

// Document downloads (admin inspection by exit request ID)
router.get('/:id/relieving-letter', adminExitController.adminDownloadRelievingLetter);
router.get('/:id/experience-certificate', adminExitController.adminDownloadExperienceCertificate);
router.get('/:id/fnf-statement', adminExitController.adminDownloadFnfStatement);

module.exports = router;
