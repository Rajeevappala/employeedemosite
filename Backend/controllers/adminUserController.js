const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');

/**
 * Controller for Administrative User Management
 */

/**
 * GET /api/admin/users
 * Returns list of user accounts (filterable by ?role=ADMIN or ?role=ALL)
 * Restricted to ADMIN and SUPER_ADMIN roles.
 * Never exposes passwords, OTPs, or session secrets.
 */
const getUsers = async (req, res, next) => {
  try {
    const { role, search } = req.query;

    let query = `
      SELECT u.id, u.employee_id, u.email, u.role, u.status,
             COALESCE(e.first_name, u.first_name) AS first_name,
             COALESCE(e.last_name, u.last_name) AS last_name,
             COALESCE(e.phone, u.phone) AS phone,
             u.created_at, u.updated_at
      FROM public.users u
      LEFT JOIN public.employees e ON u.employee_id = e.employee_id
      WHERE 1=1
    `;
    const params = [];

    if (role && role !== 'ALL') {
      params.push(role.toUpperCase());
      query += ` AND u.role = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(u.email) LIKE $${params.length} OR
        LOWER(COALESCE(e.first_name, u.first_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(e.last_name, u.last_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(u.employee_id, '')) LIKE $${params.length}
      )`;
    }

    query += ` ORDER BY u.created_at ASC`;

    const result = await pool.query(query, params);

    const safeUsers = result.rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id || null,
      email: row.email,
      role: row.role,
      status: row.status,
      firstName: row.first_name || null,
      lastName: row.last_name || null,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || (row.role === 'ADMIN' ? 'Administrator' : 'User'),
      phone: row.phone || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return res.status(200).json({
      success: true,
      count: safeUsers.length,
      data: safeUsers,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/users
 * Creates an administrative account or standard user.
 * Role Security:
 * - SUPER_ADMIN: Can create EMPLOYEE or ADMIN.
 * - ADMIN: Can create EMPLOYEE. Cannot create ADMIN (returns 403).
 * - EMPLOYEE: Cannot create any user (returns 403).
 * - SUPER_ADMIN cannot be created via standard creation (returns 400).
 */
const createUser = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const rawRole = req.body.role || req.body.userType;
    if (!rawRole) {
      return res.status(400).json({
        success: false,
        message: 'User type is required. Allowed values: Employee, Admin.',
      });
    }

    const requestedRole = rawRole.toUpperCase();

    // 1. Explicitly disallow SUPER_ADMIN creation
    if (requestedRole === 'SUPER_ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'SUPER_ADMIN accounts cannot be created through this form.',
      });
    }

    // 2. Validate allowed roles
    if (!['ADMIN', 'EMPLOYEE'].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type. Allowed values: Employee, Admin.',
      });
    }

    // 3. Role authorization checks
    const callerRole = req.user.role;
    if (callerRole === 'EMPLOYEE') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Employees cannot create users.',
      });
    }

    if (requestedRole === 'ADMIN' && callerRole !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only SUPER_ADMIN can create ADMIN accounts.',
      });
    }

    // 4. Handle ADMIN creation
    if (requestedRole === 'ADMIN') {
      const { firstName, first_name, lastName, last_name, email, phone } = req.body;

      const rawFirstName = firstName !== undefined ? firstName : first_name;
      const rawLastName = lastName !== undefined ? lastName : last_name;

      if (!rawFirstName || typeof rawFirstName !== 'string' || !rawFirstName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'First name is required.',
        });
      }
      const sanitizedFirstName = rawFirstName.trim();
      if (sanitizedFirstName.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'First name must not exceed 50 characters.',
        });
      }

      if (!rawLastName || typeof rawLastName !== 'string' || !rawLastName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Last name is required.',
        });
      }
      const sanitizedLastName = rawLastName.trim();
      if (sanitizedLastName.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Last name must not exceed 50 characters.',
        });
      }

      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Email address is required.',
        });
      }
      const normalizedEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email address format.',
        });
      }

      let sanitizedPhone = null;
      if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
        sanitizedPhone = String(phone).trim();
        if (!/^[0-9+()\- ]{7,20}$/.test(sanitizedPhone)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid phone number format.',
          });
        }
      }

      // Check duplicate email
      const userEmailCheck = await client.query(
        'SELECT id FROM public.users WHERE LOWER(email) = $1',
        [normalizedEmail]
      );
      if (userEmailCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `An account with email '${normalizedEmail}' already exists.`,
        });
      }

      const empEmailCheck = await client.query(
        'SELECT employee_id FROM public.employees WHERE LOWER(email) = $1',
        [normalizedEmail]
      );
      if (empEmailCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `An employee record with email '${normalizedEmail}' already exists.`,
        });
      }

      // Insert Admin user into public.users
      const insertUserRes = await client.query(
        `INSERT INTO public.users (email, role, status, first_name, last_name, phone)
         VALUES ($1, 'ADMIN', 'ACTIVE', $2, $3, $4)
         RETURNING id, email, role, status, first_name, last_name, phone, created_at`,
        [normalizedEmail, sanitizedFirstName, sanitizedLastName, sanitizedPhone]
      );

      const createdAdmin = insertUserRes.rows[0];

      // Audit log
      recordAuditLog({
        userId: req.user.id,
        action: 'ADMIN_USER_CREATED',
        entityType: 'USER',
        entityId: createdAdmin.id,
        metadata: {
          email: createdAdmin.email,
          role: createdAdmin.role,
          name: `${sanitizedFirstName} ${sanitizedLastName}`,
        },
        req,
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        message: 'Administrator account created successfully.',
        data: {
          id: createdAdmin.id,
          email: createdAdmin.email,
          role: createdAdmin.role,
          status: createdAdmin.status,
          firstName: createdAdmin.first_name,
          lastName: createdAdmin.last_name,
          phone: createdAdmin.phone,
          createdAt: createdAdmin.created_at,
        },
      });
    }

    // 5. Handle EMPLOYEE creation
    // If client called this endpoint for employee creation without full onboarding payload:
    return res.status(400).json({
      success: false,
      message: 'Please use the Employee Onboarding Wizard to create employee accounts with complete profile data.',
    });
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/admin/users/:userId/status
 * Updates status of an administrator/user account (ACTIVE, INACTIVE, SUSPENDED).
 * Restricted to SUPER_ADMIN.
 * Prevents self-modification and prevents role changes.
 */
const updateUserStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only SUPER_ADMIN can manage administrator status.',
      });
    }

    const { userId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required.',
      });
    }

    const sanitizedStatus = status.toUpperCase();
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(sanitizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Allowed values: ACTIVE, INACTIVE, SUSPENDED.',
      });
    }

    // Prevent modifying own status
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Administrators cannot modify their own status.',
      });
    }

    // Fetch target user
    const userCheck = await pool.query(
      'SELECT id, email, role, status FROM public.users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    const targetUser = userCheck.rows[0];

    // Update status (role remains strictly unchanged)
    const updateResult = await pool.query(
      `UPDATE public.users
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, role, status, first_name, last_name, updated_at`,
      [sanitizedStatus, userId]
    );

    const updatedUser = updateResult.rows[0];

    // Audit log
    recordAuditLog({
      userId: req.user.id,
      action: 'USER_STATUS_UPDATED',
      entityType: 'USER',
      entityId: userId,
      metadata: {
        previousStatus: targetUser.status,
        newStatus: sanitizedStatus,
        email: targetUser.email,
        role: targetUser.role,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `User status updated to ${sanitizedStatus}.`,
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        status: updatedUser.status,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        updatedAt: updatedUser.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  createUser,
  updateUserStatus,
};
