const express = require('express');
const router = express.Router();
const adminExitController = require('../controllers/adminExitController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

router.use(authenticateToken, requireRole('ADMIN', 'SUPER_ADMIN'));

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

// Document downloads (admin inspection)
router.get('/:id/relieving-letter', adminExitController.adminDownloadRelievingLetter);
router.get('/:id/experience-certificate', adminExitController.adminDownloadExperienceCertificate);
router.get('/:id/fnf-statement', adminExitController.adminDownloadFnfStatement);

module.exports = router;
