const express = require('express');
const router = express.Router();
const adminSettingsController = require('../controllers/adminSettingsController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Enforce authentication and administrative role access across all settings subroutes
router.use(authenticateToken, requireRole('ADMIN'));

// GET /api/admin/settings/organization
router.get('/organization', adminSettingsController.getOrganizationSettings);

// PUT /api/admin/settings/organization
router.put('/organization', adminSettingsController.updateOrganizationSettings);

// GET /api/admin/settings/work-attendance
router.get('/work-attendance', adminSettingsController.getWorkAttendanceSettings);

// PUT /api/admin/settings/work-attendance
router.put('/work-attendance', adminSettingsController.updateWorkAttendanceSettings);

// GET /api/admin/settings/leave
router.get('/leave', adminSettingsController.getLeaveSettings);

// PUT /api/admin/settings/leave
router.put('/leave', adminSettingsController.updateLeaveSettings);

// GET /api/admin/settings/holidays
router.get('/holidays', adminSettingsController.getHolidays);

// POST /api/admin/settings/holidays
router.post('/holidays', adminSettingsController.createHoliday);

// PUT /api/admin/settings/holidays/:id
router.put('/holidays/:id', adminSettingsController.updateHoliday);

// DELETE /api/admin/settings/holidays/:id
router.delete('/holidays/:id', adminSettingsController.deleteHoliday);

// =============================================================================
// EMPLOYEE CONFIGURATION (PHASE 5) - MASTER DATA ROUTES
// =============================================================================
// GET /api/admin/settings/employees (Consolidated)
router.get('/employees', adminSettingsController.getEmployeeConfiguration);

// Departments
router.get('/employees/departments', adminSettingsController.getDepartments);
router.post('/employees/departments', adminSettingsController.createDepartment);
router.put('/employees/departments/:id', adminSettingsController.updateDepartment);
router.delete('/employees/departments/:id', adminSettingsController.deleteDepartment);

// Designations
router.get('/employees/designations', adminSettingsController.getDesignations);
router.post('/employees/designations', adminSettingsController.createDesignation);
router.put('/employees/designations/:id', adminSettingsController.updateDesignation);
router.delete('/employees/designations/:id', adminSettingsController.deleteDesignation);

// Employment Types
router.get('/employees/employment-types', adminSettingsController.getEmploymentTypes);
router.post('/employees/employment-types', adminSettingsController.createEmploymentType);
router.put('/employees/employment-types/:id', adminSettingsController.updateEmploymentType);
router.delete('/employees/employment-types/:id', adminSettingsController.deleteEmploymentType);

// Work Locations
router.get('/employees/locations', adminSettingsController.getWorkLocations);
router.post('/employees/locations', adminSettingsController.createWorkLocation);
router.put('/employees/locations/:id', adminSettingsController.updateWorkLocation);
router.delete('/employees/locations/:id', adminSettingsController.deleteWorkLocation);

module.exports = router;

