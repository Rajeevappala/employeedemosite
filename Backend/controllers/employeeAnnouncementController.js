const pool = require('../config/database');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Helper to fetch employee department and verify active status.
 */
async function getEmployeeInfo(employeeId) {
  const result = await pool.query(
    'SELECT employee_id, department, status FROM public.employees WHERE employee_id = $1',
    [employeeId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * GET /api/employee/announcements
 * Returns visible announcements for the authenticated employee with read/unread tracking.
 */
const getEmployeeAnnouncements = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const empInfo = await getEmployeeInfo(employeeId);
    if (!empInfo) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const department = empInfo.department || '';

    const { page = 1, limit = 10, unread_only } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const isUnreadOnly = unread_only === 'true' || unread_only === true;

    // Visibility condition for PostgreSQL:
    // 1. status = 'PUBLISHED'
    // 2. publish_at IS NULL OR publish_at <= NOW()
    // 3. expires_at IS NULL OR expires_at >= NOW()
    // 4. target_type = 'ALL' OR (DEPARTMENT AND matching department) OR (EMPLOYEE AND matching employee_id)
    const baseConditions = [
      `a.status = 'PUBLISHED'`,
      `(a.publish_at IS NULL OR a.publish_at <= NOW())`,
      `(a.expires_at IS NULL OR a.expires_at >= NOW())`,
      `(
        a.target_type = 'ALL' 
        OR (a.target_type = 'DEPARTMENT' AND LOWER(a.target_department) = LOWER($2))
        OR (a.target_type = 'EMPLOYEE' AND a.target_employee_id = $1)
      )`,
    ];

    const whereConditions = [...baseConditions];
    if (isUnreadOnly) {
      whereConditions.push('ar.id IS NULL');
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Total count query
    const countSql = `
      SELECT COUNT(*) AS total
      FROM public.announcements a
      LEFT JOIN public.announcement_reads ar 
        ON ar.announcement_id = a.id AND ar.employee_id = $1
      ${whereClause}
    `;
    const countResult = await pool.query(countSql, [employeeId, department]);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    // Unread count across ALL visible announcements
    const unreadCountSql = `
      SELECT COUNT(*) AS unread_total
      FROM public.announcements a
      LEFT JOIN public.announcement_reads ar 
        ON ar.announcement_id = a.id AND ar.employee_id = $1
      WHERE ${baseConditions.join(' AND ')}
        AND ar.id IS NULL
    `;
    const unreadResult = await pool.query(unreadCountSql, [employeeId, department]);
    const unreadCount = parseInt(unreadResult.rows[0]?.unread_total || 0, 10);

    // Data query
    const dataSql = `
      SELECT 
        a.id,
        a.title,
        a.content,
        a.priority,
        a.target_type,
        a.publish_at,
        a.expires_at,
        a.created_at,
        (ar.id IS NOT NULL) AS is_read,
        ar.read_at
      FROM public.announcements a
      LEFT JOIN public.announcement_reads ar 
        ON ar.announcement_id = a.id AND ar.employee_id = $1
      ${whereClause}
      ORDER BY 
        CASE a.priority 
          WHEN 'Urgent' THEN 1 
          WHEN 'High' THEN 2 
          ELSE 3 
        END ASC,
        COALESCE(a.publish_at, a.created_at) DESC
      LIMIT $3 OFFSET $4
    `;

    const dataResult = await pool.query(dataSql, [employeeId, department, limitNum, offset]);

    return res.status(200).json({
      success: true,
      data: {
        announcements: dataResult.rows,
        unread_count: unreadCount,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          total_pages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/employee/announcements/unread-count
 * Returns the unread announcement count for the authenticated employee.
 */
const getEmployeeUnreadCount = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const empInfo = await getEmployeeInfo(employeeId);
    if (!empInfo) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const department = empInfo.department || '';

    const sql = `
      SELECT COUNT(*) AS unread_total
      FROM public.announcements a
      LEFT JOIN public.announcement_reads ar 
        ON ar.announcement_id = a.id AND ar.employee_id = $1
      WHERE a.status = 'PUBLISHED'
        AND (a.publish_at IS NULL OR a.publish_at <= NOW())
        AND (a.expires_at IS NULL OR a.expires_at >= NOW())
        AND (
          a.target_type = 'ALL' 
          OR (a.target_type = 'DEPARTMENT' AND LOWER(a.target_department) = LOWER($2))
          OR (a.target_type = 'EMPLOYEE' AND a.target_employee_id = $1)
        )
        AND ar.id IS NULL
    `;

    const result = await pool.query(sql, [employeeId, department]);
    const unreadCount = parseInt(result.rows[0]?.unread_total || 0, 10);

    return res.status(200).json({
      success: true,
      unread_count: unreadCount,
      data: {
        unread_count: unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/employee/announcements/:announcementId
 * Fetches an authorized announcement detail for the employee.
 * Returns 404 (never 403) if unauthorized or not visible to protect existence.
 */
const getEmployeeAnnouncementById = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { announcementId } = req.params;
    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID format. Expected UUID.',
      });
    }

    const empInfo = await getEmployeeInfo(employeeId);
    if (!empInfo) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const department = empInfo.department || '';

    const query = `
      SELECT 
        a.id,
        a.title,
        a.content,
        a.priority,
        a.target_type,
        a.publish_at,
        a.expires_at,
        a.created_at,
        (ar.id IS NOT NULL) AS is_read,
        ar.read_at
      FROM public.announcements a
      LEFT JOIN public.announcement_reads ar 
        ON ar.announcement_id = a.id AND ar.employee_id = $1
      WHERE a.id = $3
        AND a.status = 'PUBLISHED'
        AND (a.publish_at IS NULL OR a.publish_at <= NOW())
        AND (a.expires_at IS NULL OR a.expires_at >= NOW())
        AND (
          a.target_type = 'ALL' 
          OR (a.target_type = 'DEPARTMENT' AND LOWER(a.target_department) = LOWER($2))
          OR (a.target_type = 'EMPLOYEE' AND a.target_employee_id = $1)
        )
    `;

    const result = await pool.query(query, [employeeId, department, announcementId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/employee/announcements/:announcementId/read
 * Marks an authorized announcement as read.
 * Idempotent: ON CONFLICT DO NOTHING prevents duplicate rows.
 */
const markAnnouncementAsRead = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const { announcementId } = req.params;
    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID format. Expected UUID.',
      });
    }

    const empInfo = await getEmployeeInfo(employeeId);
    if (!empInfo) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const department = empInfo.department || '';

    // Verify employee has permission to view this announcement
    const verifySql = `
      SELECT a.id
      FROM public.announcements a
      WHERE a.id = $1
        AND a.status = 'PUBLISHED'
        AND (a.publish_at IS NULL OR a.publish_at <= NOW())
        AND (a.expires_at IS NULL OR a.expires_at >= NOW())
        AND (
          a.target_type = 'ALL' 
          OR (a.target_type = 'DEPARTMENT' AND LOWER(a.target_department) = LOWER($3))
          OR (a.target_type = 'EMPLOYEE' AND a.target_employee_id = $2)
        )
    `;

    const verifyResult = await pool.query(verifySql, [announcementId, employeeId, department]);

    if (verifyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found.',
      });
    }

    // Insert read record safely (idempotent)
    const insertSql = `
      INSERT INTO public.announcement_reads (announcement_id, employee_id, read_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (announcement_id, employee_id) DO NOTHING
      RETURNING read_at
    `;

    await pool.query(insertSql, [announcementId, employeeId]);

    return res.status(200).json({
      success: true,
      read: true,
      is_read: true,
      message: 'Announcement marked as read.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEmployeeAnnouncements,
  getEmployeeUnreadCount,
  getEmployeeAnnouncementById,
  markAnnouncementAsRead,
};
