const express = require('express');
const router = express.Router();

const employeePfController = require('../controllers/employeePfController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// GET /api/employee/pf
// Strictly protected: requires valid JWT session and EMPLOYEE role
router.get(
  '/',
  authenticateToken,
  requireRole('EMPLOYEE'),
  employeePfController.getEmployeePfDetails
);

module.exports = router;
