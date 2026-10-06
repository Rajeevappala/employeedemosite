const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_PRIORITIES = ['Normal', 'High', 'Urgent'];
const VALID_TARGET_TYPES = ['ALL', 'DEPARTMENT', 'EMPLOYEE'];
const VALID_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

/**
 * GET /api/admin/announcements
 * Lists announcements with search, status, priority, target_type filters and pagination.
 */
const getAdminAnnouncements = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      priority,
      target_type,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(a.title ILIKE $${params.length} OR a.content ILIKE $${params.length})`);
    }

    if (status && status.trim() && status !== 'All' && status !== 'ALL') {
      params.push(status.trim().toUpperCase());
      conditions.push(`a.status = $${params.length}`);
    }

    if (priority && priority.trim() && priority !== 'All' && priority !== 'ALL') {
      const matchP = VALID_PRIORITIES.find(
        (p) => p.toLowerCase() === priority.trim().toLowerCase()
      );
      if (matchP) {
        params.push(matchP);
        conditions.push(`a.priority = $${params.length}`);
      }
    }

    if (target_type && target_type.trim() && target_type !== 'All' && target_type !== 'ALL') {
      params.push(target_type.trim().toUpperCase());
      conditions.push(`a.target_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countSql = `SELECT COUNT(*) AS total FROM public.announcements a ${whereClause}`;
    const countResult = await pool.query(countSql, params);
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    // Data query with reads count and target employee info
    const dataParams = [...params, limitNum, offset];
    const dataSql = `
      SELECT 
        a.id,
        a.title,
        a.content,
        a.priority,
        a.target_type,
        a.target_department,
        a.target_employee_id,
        CONCAT(e.first_name, ' ', e.last_name) AS target_employee_name,
        a.status,
        a.publish_at,
        a.expires_at,
        a.created_by,
        u.email AS creator_email,
        a.created_at,
        a.updated_at,
        COUNT(ar.id)::int AS read_count
      FROM public.announcements a
      LEFT JOIN public.users u ON u.id = a.created_by
      LEFT JOIN public.employees e ON e.employee_id = a.target_employee_id
      LEFT JOIN public.announcement_reads ar ON ar.announcement_id = a.id
      ${whereClause}
      GROUP BY a.id, u.email, e.first_name, e.last_name
      ORDER BY a.created_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;

    const [dataResult, summaryResult] = await Promise.all([
      pool.query(dataSql, dataParams),
      pool.query(`
        SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'PUBLISHED')::int AS published,
          COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
          COUNT(*) FILTER (WHERE status = 'ARCHIVED')::int AS archived
        FROM public.announcements
      `),
    ]);

    const summary = summaryResult.rows[0] || { total: 0, published: 0, draft: 0, archived: 0 };

    return res.status(200).json({
      success: true,
      data: {
        announcements: dataResult.rows,
        summary,
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
 * GET /api/admin/announcements/:announcementId
 * Fetches single announcement details by ID.
 */
const getAdminAnnouncementById = async (req, res, next) => {
  try {
    const { announcementId } = req.params;

    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID format. Expected UUID.',
      });
    }

    const query = `
      SELECT 
        a.id,
        a.title,
        a.content,
        a.priority,
        a.target_type,
        a.target_department,
        a.target_employee_id,
        CONCAT(e.first_name, ' ', e.last_name) AS target_employee_name,
        a.status,
        a.publish_at,
        a.expires_at,
        a.created_by,
        u.email AS creator_email,
        a.created_at,
        a.updated_at,
        COUNT(ar.id)::int AS read_count
      FROM public.announcements a
      LEFT JOIN public.users u ON u.id = a.created_by
      LEFT JOIN public.employees e ON e.employee_id = a.target_employee_id
      LEFT JOIN public.announcement_reads ar ON ar.announcement_id = a.id
      WHERE a.id = $1
      GROUP BY a.id, u.email, e.first_name, e.last_name
    `;

    const result = await pool.query(query, [announcementId]);

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
 * POST /api/admin/announcements
 * Creates a new announcement.
 */
const createAdminAnnouncement = async (req, res, next) => {
  try {
    const {
      title,
      content,
      priority = 'Normal',
      target_type = 'ALL',
      target_department,
      target_employee_id,
      status = 'DRAFT',
      publish_at,
      expires_at,
    } = req.body;

    const createdBy = req.user?.id;
    if (!createdBy) {
      return res.status(401).json({
        success: false,
        message: 'Authenticated user session required.',
      });
    }

    // Validate title
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required.',
      });
    }
    if (title.trim().length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Title cannot exceed 200 characters.',
      });
    }

    // Validate content
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Content is required.',
      });
    }

    // Validate priority
    const matchedPriority = VALID_PRIORITIES.find(
      (p) => p.toLowerCase() === String(priority).trim().toLowerCase()
    );
    if (!matchedPriority) {
      return res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed values: ${VALID_PRIORITIES.join(', ')}.`,
      });
    }

    // Validate target_type
    const normalizedTargetType = String(target_type).trim().toUpperCase();
    if (!VALID_TARGET_TYPES.includes(normalizedTargetType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid target type. Allowed values: ${VALID_TARGET_TYPES.join(', ')}.`,
      });
    }

    // Validate department if target_type is DEPARTMENT
    let departmentVal = null;
    if (normalizedTargetType === 'DEPARTMENT') {
      if (!target_department || typeof target_department !== 'string' || !target_department.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Department is required when target type is DEPARTMENT.',
        });
      }
      departmentVal = target_department.trim();
    }

    // Validate employee if target_type is EMPLOYEE
    let employeeIdVal = null;
    if (normalizedTargetType === 'EMPLOYEE') {
      if (!target_employee_id || typeof target_employee_id !== 'string' || !target_employee_id.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Employee ID is required when target type is EMPLOYEE.',
        });
      }
      employeeIdVal = target_employee_id.trim();

      // Check employee exists
      const empCheck = await pool.query(
        'SELECT employee_id FROM public.employees WHERE employee_id = $1',
        [employeeIdVal]
      );
      if (empCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Employee with ID ${employeeIdVal} does not exist.`,
        });
      }
    }

    // Validate status
    const normalizedStatus = String(status).trim().toUpperCase();
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${VALID_STATUSES.join(', ')}.`,
      });
    }

    // Validate timestamps
    let parsedPublishAt = null;
    if (publish_at) {
      const pubDate = new Date(publish_at);
      if (isNaN(pubDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid publish_at timestamp format.',
        });
      }
      parsedPublishAt = pubDate.toISOString();
    }

    let parsedExpiresAt = null;
    if (expires_at) {
      const expDate = new Date(expires_at);
      if (isNaN(expDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expires_at timestamp format.',
        });
      }
      parsedExpiresAt = expDate.toISOString();

      if (parsedPublishAt && new Date(parsedExpiresAt) <= new Date(parsedPublishAt)) {
        return res.status(400).json({
          success: false,
          message: 'Expiry date must be after the publish date.',
        });
      }
    }

    // If status is PUBLISHED and no publish_at is given, set publish_at = now
    if (normalizedStatus === 'PUBLISHED' && !parsedPublishAt) {
      parsedPublishAt = new Date().toISOString();
    }

    const insertSql = `
      INSERT INTO public.announcements (
        title,
        content,
        priority,
        target_type,
        target_department,
        target_employee_id,
        status,
        publish_at,
        expires_at,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await pool.query(insertSql, [
      title.trim(),
      content.trim(),
      matchedPriority,
      normalizedTargetType,
      departmentVal,
      employeeIdVal,
      normalizedStatus,
      parsedPublishAt,
      parsedExpiresAt,
      createdBy,
    ]);

    const createdAnn = result.rows[0];

    recordAuditLog({
      action: 'ANNOUNCEMENT_CREATE',
      entityType: 'ANNOUNCEMENT',
      entityId: createdAnn?.id,
      metadata: {
        title: createdAnn?.title,
        priority: createdAnn?.priority,
        target_type: createdAnn?.target_type,
        status: createdAnn?.status,
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Announcement created successfully.',
      data: createdAnn,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/announcements/:announcementId
 * Updates an announcement.
 */
const updateAdminAnnouncement = async (req, res, next) => {
  try {
    const { announcementId } = req.params;

    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID format. Expected UUID.',
      });
    }

    // Check existing
    const existingResult = await pool.query(
      'SELECT * FROM public.announcements WHERE id = $1',
      [announcementId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found.',
      });
    }

    const current = existingResult.rows[0];

    const {
      title,
      content,
      priority,
      target_type,
      target_department,
      target_employee_id,
      status,
      publish_at,
      expires_at,
    } = req.body;

    // Validate title if provided
    let newTitle = current.title;
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Title cannot be empty.',
        });
      }
      if (title.trim().length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Title cannot exceed 200 characters.',
        });
      }
      newTitle = title.trim();
    }

    // Validate content if provided
    let newContent = current.content;
    if (content !== undefined) {
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Content cannot be empty.',
        });
      }
      newContent = content.trim();
    }

    // Validate priority if provided
    let newPriority = current.priority;
    if (priority !== undefined) {
      const matchP = VALID_PRIORITIES.find(
        (p) => p.toLowerCase() === String(priority).trim().toLowerCase()
      );
      if (!matchP) {
        return res.status(400).json({
          success: false,
          message: `Invalid priority. Allowed values: ${VALID_PRIORITIES.join(', ')}.`,
        });
      }
      newPriority = matchP;
    }

    // Validate target_type if provided
    let newTargetType = current.target_type;
    if (target_type !== undefined) {
      const upperTarget = String(target_type).trim().toUpperCase();
      if (!VALID_TARGET_TYPES.includes(upperTarget)) {
        return res.status(400).json({
          success: false,
          message: `Invalid target type. Allowed values: ${VALID_TARGET_TYPES.join(', ')}.`,
        });
      }
      newTargetType = upperTarget;
    }

    let newDepartment = current.target_department;
    let newEmployeeId = current.target_employee_id;

    if (newTargetType === 'ALL') {
      newDepartment = null;
      newEmployeeId = null;
    } else if (newTargetType === 'DEPARTMENT') {
      const dept = target_department !== undefined ? target_department : current.target_department;
      if (!dept || typeof dept !== 'string' || !dept.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Department is required when target type is DEPARTMENT.',
        });
      }
      newDepartment = dept.trim();
      newEmployeeId = null;
    } else if (newTargetType === 'EMPLOYEE') {
      const empId = target_employee_id !== undefined ? target_employee_id : current.target_employee_id;
      if (!empId || typeof empId !== 'string' || !empId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Employee ID is required when target type is EMPLOYEE.',
        });
      }
      const checkEmp = await pool.query(
        'SELECT employee_id FROM public.employees WHERE employee_id = $1',
        [empId.trim()]
      );
      if (checkEmp.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Employee with ID ${empId.trim()} does not exist.`,
        });
      }
      newEmployeeId = empId.trim();
      newDepartment = null;
    }

    // Validate status if provided
    let newStatus = current.status;
    if (status !== undefined) {
      const upperStatus = String(status).trim().toUpperCase();
      if (!VALID_STATUSES.includes(upperStatus)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${VALID_STATUSES.join(', ')}.`,
        });
      }
      newStatus = upperStatus;
    }

    // Validate publish_at / expires_at
    let newPublishAt = current.publish_at;
    if (publish_at !== undefined) {
      if (publish_at === null || publish_at === '') {
        newPublishAt = null;
      } else {
        const pubDate = new Date(publish_at);
        if (isNaN(pubDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid publish_at timestamp format.',
          });
        }
        newPublishAt = pubDate.toISOString();
      }
    }

    let newExpiresAt = current.expires_at;
    if (expires_at !== undefined) {
      if (expires_at === null || expires_at === '') {
        newExpiresAt = null;
      } else {
        const expDate = new Date(expires_at);
        if (isNaN(expDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid expires_at timestamp format.',
          });
        }
        newExpiresAt = expDate.toISOString();
      }
    }

    if (newExpiresAt && newPublishAt && new Date(newExpiresAt) <= new Date(newPublishAt)) {
      return res.status(400).json({
        success: false,
        message: 'Expiry date must be after the publish date.',
      });
    }

    const updateSql = `
      UPDATE public.announcements SET
        title = $1,
        content = $2,
        priority = $3,
        target_type = $4,
        target_department = $5,
        target_employee_id = $6,
        status = $7,
        publish_at = $8,
        expires_at = $9,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `;

    const updateResult = await pool.query(updateSql, [
      newTitle,
      newContent,
      newPriority,
      newTargetType,
      newDepartment,
      newEmployeeId,
      newStatus,
      newPublishAt,
      newExpiresAt,
      announcementId,
    ]);

    const updatedAnn = updateResult.rows[0];

    recordAuditLog({
      action: 'ANNOUNCEMENT_UPDATE',
      entityType: 'ANNOUNCEMENT',
      entityId: announcementId,
      metadata: {
        title: updatedAnn?.title,
        priority: updatedAnn?.priority,
        status: updatedAnn?.status,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Announcement updated successfully.',
      data: updatedAnn,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/announcements/:announcementId/publish
 * Publishes an announcement.
 */
const publishAdminAnnouncement = async (req, res, next) => {
  try {
    const { announcementId } = req.params;

    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID format. Expected UUID.',
      });
    }

    const check = await pool.query(
      'SELECT * FROM public.announcements WHERE id = $1',
      [announcementId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found.',
      });
    }

    const current = check.rows[0];

    // If DEPARTMENT, ensure target_department is set
    if (current.target_type === 'DEPARTMENT' && !current.target_department) {
      return res.status(400).json({
        success: false,
        message: 'Cannot publish department announcement without target department.',
      });
    }

    // If EMPLOYEE, ensure target_employee_id is set
    if (current.target_type === 'EMPLOYEE' && !current.target_employee_id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot publish employee announcement without target employee.',
      });
    }

    // Set status = PUBLISHED and publish_at = COALESCE(publish_at, NOW())
    const updateSql = `
      UPDATE public.announcements SET
        status = 'PUBLISHED',
        publish_at = COALESCE(publish_at, NOW()),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(updateSql, [announcementId]);

    recordAuditLog({
      action: 'ANNOUNCEMENT_PUBLISH',
      entityType: 'ANNOUNCEMENT',
      entityId: announcementId,
      metadata: { title: result.rows[0]?.title },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Announcement published successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/announcements/:announcementId/archive
 * Archives an announcement.
 */
const archiveAdminAnnouncement = async (req, res, next) => {
  try {
    const { announcementId } = req.params;

    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID format. Expected UUID.',
      });
    }

    const check = await pool.query(
      'SELECT id FROM public.announcements WHERE id = $1',
      [announcementId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found.',
      });
    }

    const updateSql = `
      UPDATE public.announcements SET
        status = 'ARCHIVED',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(updateSql, [announcementId]);

    recordAuditLog({
      action: 'ANNOUNCEMENT_ARCHIVE',
      entityType: 'ANNOUNCEMENT',
      entityId: announcementId,
      metadata: { title: result.rows[0]?.title },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Announcement archived successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/announcements/:announcementId
 * Permanently deletes an announcement and cascades read records.
 */
const deleteAdminAnnouncement = async (req, res, next) => {
  try {
    const { announcementId } = req.params;

    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID format. Expected UUID.',
      });
    }

    const result = await pool.query(
      'DELETE FROM public.announcements WHERE id = $1 RETURNING id',
      [announcementId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found.',
      });
    }

    recordAuditLog({
      action: 'ANNOUNCEMENT_DELETE',
      entityType: 'ANNOUNCEMENT',
      entityId: announcementId,
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Announcement deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminAnnouncements,
  getAdminAnnouncementById,
  createAdminAnnouncement,
  updateAdminAnnouncement,
  publishAdminAnnouncement,
  archiveAdminAnnouncement,
  deleteAdminAnnouncement,
};
