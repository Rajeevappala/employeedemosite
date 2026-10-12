const express = require('express');
const router = express.Router();

const bankDetailsController = require('../controllers/bankDetailsController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// All employee bank details routes require valid JWT session and role EMPLOYEE
router.use(authenticateToken, requireRole('EMPLOYEE'));

// GET /api/employee/bank-details - Retrieve own bank details summary
router.get('/', bankDetailsController.getEmployeeBankDetails);

// POST /api/employee/bank-details - Submit initial bank details
router.post('/', bankDetailsController.saveEmployeeBankDetails);

// PUT /api/employee/bank-details - Update bank details
router.put('/', bankDetailsController.saveEmployeeBankDetails);

module.exports = router;
