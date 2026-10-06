const express = require('express');
const router = express.Router();

const adminAnnouncementController = require('../controllers/adminAnnouncementController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// All admin announcement routes require authentication and ADMIN or SUPER_ADMIN role
router.use(authenticateToken, requireRole('ADMIN', 'SUPER_ADMIN'));

// GET /api/admin/announcements
router.get('/', adminAnnouncementController.getAdminAnnouncements);

// POST /api/admin/announcements
router.post('/', adminAnnouncementController.createAdminAnnouncement);

// GET /api/admin/announcements/:announcementId
router.get('/:announcementId', adminAnnouncementController.getAdminAnnouncementById);

// PUT /api/admin/announcements/:announcementId
router.put('/:announcementId', adminAnnouncementController.updateAdminAnnouncement);

// PATCH /api/admin/announcements/:announcementId/publish
router.patch('/:announcementId/publish', adminAnnouncementController.publishAdminAnnouncement);

// PATCH /api/admin/announcements/:announcementId/archive
router.patch('/:announcementId/archive', adminAnnouncementController.archiveAdminAnnouncement);

// DELETE /api/admin/announcements/:announcementId
router.delete('/:announcementId', adminAnnouncementController.deleteAdminAnnouncement);

module.exports = router;
