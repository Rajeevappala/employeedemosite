const express = require('express');
const router = express.Router();

const employeeAnnouncementController = require('../controllers/employeeAnnouncementController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// All employee announcement routes require authentication and EMPLOYEE role
router.use(authenticateToken, requireRole('EMPLOYEE'));

// GET /api/employee/announcements/unread-count
router.get('/unread-count', employeeAnnouncementController.getEmployeeUnreadCount);

// GET /api/employee/announcements
router.get('/', employeeAnnouncementController.getEmployeeAnnouncements);

// GET /api/employee/announcements/:announcementId
router.get('/:announcementId', employeeAnnouncementController.getEmployeeAnnouncementById);

// PATCH / POST /api/employee/announcements/:announcementId/read
router.patch('/:announcementId/read', employeeAnnouncementController.markAnnouncementAsRead);
router.post('/:announcementId/read', employeeAnnouncementController.markAnnouncementAsRead);

module.exports = router;
