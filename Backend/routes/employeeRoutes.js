const express = require('express');
const router = express.Router();

const employeeController = require('../controllers/employeeController');
const employeeDashboardController = require('../controllers/employeeDashboardController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { uploadSingleProfilePhoto } = require('../middleware/uploadMiddleware');
const { fileUploadLimiter } = require('../middleware/rateLimitMiddleware');

// All employee routes require valid JWT session and role EMPLOYEE
router.use(authenticateToken, requireRole('EMPLOYEE'));

// GET /api/employee/dashboard
router.get('/dashboard', employeeDashboardController.getEmployeeDashboard);

// =============================================================================
// Employee Profile Management
// =============================================================================

// GET /api/employee/profile - View own employee profile
router.get('/profile', employeeController.getProfile);

// PUT /api/employee/profile - Update permitted personal profile fields
router.put('/profile', employeeController.updateProfile);

// PATCH /api/employee/profile - Update permitted personal profile fields (alias)
router.patch('/profile', employeeController.updateProfile);

// GET /api/employee/profile/photo - View own private profile photo
router.get('/profile/photo', employeeController.getProfilePhoto);

// POST /api/employee/profile/photo - Upload or replace profile photo
router.post(
  '/profile/photo',
  fileUploadLimiter,
  uploadSingleProfilePhoto,
  employeeController.uploadProfilePhoto
);

// PUT /api/employee/profile/photo - Upload or replace profile photo (RESTful alias)
router.put(
  '/profile/photo',
  fileUploadLimiter,
  uploadSingleProfilePhoto,
  employeeController.uploadProfilePhoto
);

// DELETE /api/employee/profile/photo - Remove profile photo
router.delete('/profile/photo', employeeController.deleteProfilePhoto);

module.exports = router;
