const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');

/**
 * Controller for Administrative User Management
 * Strictly two system roles: ADMIN and EMPLOYEE.
 * All administrators possess identical, equal permissions.
 */

/**
 * GET /api/admin/users
 * Returns list of user accounts (filterable by ?role=ADMIN or ?role=ALL)
 * Restricted to ADMIN role.
 * Never exposes passwords, OTPs, or session secrets.
 */
const getUsers = async (req, res, next) => {
  try {
    const { role, search } = req.query;

    let query = `
      SELECT u.id, u.admin_id, u.employee_id, u.email, u.role, u.status,
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
        LOWER(COALESCE(u.admin_id, '')) LIKE $${params.length} OR
        LOWER(COALESCE(e.first_name, u.first_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(e.last_name, u.last_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(u.employee_id, '')) LIKE $${params.length}
      )`;
    }

    query += ` ORDER BY u.created_at ASC`;

    const result = await pool.query(query, params);

    const safeUsers = result.rows.map((row) => ({
      id: row.id,
      adminId: row.admin_id || null,
      admin_id: row.admin_id || null,
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
 * Creates an administrative account.
 * Role Security:
 * - Any ADMIN can create new ADMIN accounts without hierarchy or approval.
 * - EMPLOYEE cannot create any user (returns 403).
 * - SUPER_ADMIN does not exist (returns 400).
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

    // 1. Explicitly disallow obsolete SUPER_ADMIN role
    if (requestedRole === 'SUPER_ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'SUPER_ADMIN role does not exist. Allowed roles: Admin, Employee.',
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
    if (callerRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Administrator privileges required.',
      });
    }

    // 4. Handle ADMIN creation
    if (requestedRole === 'ADMIN') {
      const {
        adminId,
        admin_id,
        adminIdNumber,
        firstName,
        first_name,
        lastName,
        last_name,
        email,
        phone,
      } = req.body;

      // 4a. Validate Admin ID Number (MANDATORY)
      const rawAdminId = adminId !== undefined ? adminId : (admin_id !== undefined ? admin_id : adminIdNumber);
      if (!rawAdminId || typeof rawAdminId !== 'string' || !rawAdminId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Admin ID Number is required.',
        });
      }

      const sanitizedAdminId = rawAdminId.trim().toUpperCase();
      if (sanitizedAdminId.length < 2 || sanitizedAdminId.length > 30) {
        return res.status(400).json({
          success: false,
          message: 'Admin ID Number must be between 2 and 30 characters.',
        });
      }

      if (!/^[A-Z0-9\-_/]+$/.test(sanitizedAdminId)) {
        return res.status(400).json({
          success: false,
          message: 'Admin ID Number may only contain letters, numbers, hyphens, slashes, and underscores.',
        });
      }

      // Check Admin ID uniqueness in users table
      const duplicateAdminIdCheck = await client.query(
        'SELECT id, email FROM public.users WHERE UPPER(admin_id) = $1',
        [sanitizedAdminId]
      );
      if (duplicateAdminIdCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Admin ID '${sanitizedAdminId}' already exists. Every Admin must have a unique ID number.`,
        });
      }

      // Ensure Admin ID and Employee ID cannot conflict
      const conflictEmpIdCheck = await client.query(
        'SELECT employee_id FROM public.employees WHERE UPPER(employee_id) = $1',
        [sanitizedAdminId]
      );
      if (conflictEmpIdCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Admin ID '${sanitizedAdminId}' conflicts with an existing Employee ID. Admin and Employee IDs must be distinct.`,
        });
      }

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

      // Insert Admin user into public.users with admin_id
      const insertUserRes = await client.query(
        `INSERT INTO public.users (email, role, status, first_name, last_name, phone, admin_id)
         VALUES ($1, 'ADMIN', 'ACTIVE', $2, $3, $4, $5)
         RETURNING id, admin_id, email, role, status, first_name, last_name, phone, created_at`,
        [normalizedEmail, sanitizedFirstName, sanitizedLastName, sanitizedPhone, sanitizedAdminId]
      );

      const createdAdmin = insertUserRes.rows[0];

      // Audit log
      recordAuditLog({
        userId: req.user.id,
        action: 'ADMIN_USER_CREATED',
        entityType: 'USER',
        entityId: createdAdmin.id,
        metadata: {
          admin_id: createdAdmin.admin_id,
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
          adminId: createdAdmin.admin_id,
          admin_id: createdAdmin.admin_id,
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

    // 5. Handle EMPLOYEE creation via standard user endpoint
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
 * Updates status of an administrator account (ACTIVE, INACTIVE, SUSPENDED).
 * Restricted to ADMIN role.
 * Prevents self-modification and prevents deactivating the last active Admin.
 */
const updateUserStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Administrator privileges required.',
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

    // Prevent deactivating or suspending the last active administrator
    if (targetUser.role === 'ADMIN' && sanitizedStatus !== 'ACTIVE') {
      const activeAdminCountRes = await pool.query(
        "SELECT COUNT(*)::int AS count FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id != $1",
        [userId]
      );
      if (activeAdminCountRes.rows[0].count === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate or suspend the last active administrator.',
        });
      }
    }

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

/**
 * DELETE /api/admin/users/:userId
 * Permanently deletes an administrator account.
 * Safeguards:
 * 1. Restricted to role ADMIN.
 * 2. Cannot delete own account (prevents accidental lockout).
 * 3. Cannot delete the last active administrator.
 * 4. Requires explicit confirmation: confirmationEmail matching target admin's email and confirmed === true.
 * 5. Reassigns announcements created by the deleted admin to the deleting admin (prevents RESTRICT FK violation).
 * 6. Revokes active OTP sessions.
 * 7. Permanently removes the account from public.users.
 * 8. Records deletion action in audit log.
 */
const deleteAdminPermanently = async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Administrator privileges required.',
      });
    }

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Target user ID is required.',
      });
    }

    // 1. Prevent self-deletion
    if (String(userId) === String(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Administrators cannot delete their own account.',
      });
    }

    // 2. Fetch target user
    const targetRes = await client.query(
      'SELECT id, email, role, status, employee_id FROM public.users WHERE id = $1',
      [userId]
    );

    if (targetRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    const targetUser = targetRes.rows[0];

    if (targetUser.role !== 'ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'Target user is not an administrator. Use the employee deletion endpoint for employee records.',
      });
    }

    // 1b. Prevent self-deletion by email or ID
    if (
      String(userId) === String(req.user.id) ||
      (req.user.email && targetUser.email && req.user.email.trim().toLowerCase() === targetUser.email.trim().toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: 'Administrators cannot delete their own account.',
      });
    }

    // 3. Prevent deleting the last active admin
    if (targetUser.status === 'ACTIVE') {
      const activeCountRes = await client.query(
        "SELECT COUNT(*)::int AS count FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id != $1",
        [userId]
      );
      if (activeCountRes.rows[0].count === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the last active administrator account.',
        });
      }
    } else {
      const totalActiveCountRes = await client.query(
        "SELECT COUNT(*)::int AS count FROM public.users WHERE role = 'ADMIN' AND status = 'ACTIVE'"
      );
      if (totalActiveCountRes.rows[0].count === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete administrator account as no active administrators exist.',
        });
      }
    }

    // 4. Validate confirmation payload
    const { confirmationEmail, confirmEmail, confirmCheckbox, confirmed } = req.body || {};
    const providedEmail = (confirmationEmail || confirmEmail || '').trim().toLowerCase();
    const isConfirmed = confirmed === true || confirmCheckbox === true || confirmed === 'true' || confirmCheckbox === 'true';

    if (providedEmail !== targetUser.email.trim().toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: 'Confirmation email does not match the target administrator email.',
      });
    }

    if (!isConfirmed) {
      return res.status(400).json({
        success: false,
        message: 'Confirmation authorization must be confirmed.',
      });
    }

    await client.query('BEGIN');

    // 5. Reassign announcements created by this admin to deleting admin to prevent RESTRICT FK failure
    await client.query(
      'UPDATE public.announcements SET created_by = $1 WHERE created_by = $2',
      [req.user.id, userId]
    );

    // 6. Delete OTP verifications / active session state
    await client.query(
      'DELETE FROM public.otp_verifications WHERE user_id = $1',
      [userId]
    );

    // 7. Delete the administrator user record permanently
    await client.query(
      'DELETE FROM public.users WHERE id = $1',
      [userId]
    );

    await client.query('COMMIT');

    // 8. Record audit log
    recordAuditLog({
      userId: req.user.id,
      action: 'ADMIN_PERMANENTLY_DELETED',
      entityType: 'USER',
      entityId: userId,
      metadata: {
        deletedAdminEmail: targetUser.email,
        reassignedAnnouncementsTo: req.user.id,
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Administrator account ${targetUser.email} has been permanently deleted.`,
      data: {
        userId,
        email: targetUser.email,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/admin/users/:userId
 * Retrieves detailed profile for a specific administrative user.
 * Restricted to role ADMIN.
 */
const getUserById = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const query = `
      SELECT u.id, u.admin_id, u.employee_id, u.email, u.role, u.status,
             COALESCE(e.first_name, u.first_name) AS first_name,
             COALESCE(e.last_name, u.last_name) AS last_name,
             COALESCE(e.phone, u.phone) AS phone,
             u.created_at, u.updated_at
      FROM public.users u
      LEFT JOIN public.employees e ON u.employee_id = e.employee_id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Administrator account not found.',
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        adminId: row.admin_id || null,
        admin_id: row.admin_id || null,
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
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/users/:userId
 * Updates administrator details (admin_id, first_name, last_name, phone).
 * Restricted to role ADMIN.
 * Ensures:
 * - Admin ID uniqueness across users.
 * - Admin ID distinct from employee IDs.
 * - Cannot change role (role escalation/de-escalation prevented).
 * - Existing Admin ID remains untouched if omitted.
 */
const updateUser = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const {
      adminId,
      admin_id,
      adminIdNumber,
      firstName,
      first_name,
      lastName,
      last_name,
      phone,
    } = req.body;

    const userCheck = await client.query(
      'SELECT id, email, role, status, admin_id, first_name, last_name, phone FROM public.users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Administrator account not found.',
      });
    }

    const targetUser = userCheck.rows[0];
    if (targetUser.role !== 'ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'Target user is not an administrator. Use employee endpoints to edit employee details.',
      });
    }

    let finalAdminId = targetUser.admin_id;
    const rawAdminId = adminId !== undefined ? adminId : (admin_id !== undefined ? admin_id : adminIdNumber);

    if (rawAdminId !== undefined && rawAdminId !== null) {
      if (typeof rawAdminId !== 'string' || !rawAdminId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Admin ID Number cannot be empty.',
        });
      }

      const sanitizedAdminId = rawAdminId.trim().toUpperCase();
      if (sanitizedAdminId.length < 2 || sanitizedAdminId.length > 30) {
        return res.status(400).json({
          success: false,
          message: 'Admin ID Number must be between 2 and 30 characters.',
        });
      }

      if (!/^[A-Z0-9\-_/]+$/.test(sanitizedAdminId)) {
        return res.status(400).json({
          success: false,
          message: 'Admin ID Number may only contain letters, numbers, hyphens, slashes, and underscores.',
        });
      }

      // Check uniqueness against other users
      const dupCheck = await client.query(
        'SELECT id, email FROM public.users WHERE UPPER(admin_id) = $1 AND id != $2',
        [sanitizedAdminId, userId]
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Admin ID '${sanitizedAdminId}' is already assigned to another administrator.`,
        });
      }

      // Check conflict with employee IDs
      const empConflictCheck = await client.query(
        'SELECT employee_id FROM public.employees WHERE UPPER(employee_id) = $1',
        [sanitizedAdminId]
      );
      if (empConflictCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Admin ID '${sanitizedAdminId}' conflicts with an existing Employee ID. Admin and Employee IDs must be distinct.`,
        });
      }

      finalAdminId = sanitizedAdminId;
    }

    const rawFirstName = firstName !== undefined ? firstName : first_name;
    let finalFirstName = targetUser.first_name;
    if (rawFirstName !== undefined && rawFirstName !== null) {
      if (typeof rawFirstName !== 'string' || !rawFirstName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'First name cannot be empty.',
        });
      }
      finalFirstName = rawFirstName.trim();
      if (finalFirstName.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'First name must not exceed 50 characters.',
        });
      }
    }

    const rawLastName = lastName !== undefined ? lastName : last_name;
    let finalLastName = targetUser.last_name;
    if (rawLastName !== undefined && rawLastName !== null) {
      if (typeof rawLastName !== 'string' || !rawLastName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Last name cannot be empty.',
        });
      }
      finalLastName = rawLastName.trim();
      if (finalLastName.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Last name must not exceed 50 characters.',
        });
      }
    }

    let finalPhone = targetUser.phone;
    if (phone !== undefined) {
      if (phone === null || String(phone).trim() === '') {
        finalPhone = null;
      } else {
        const trimmedPhone = String(phone).trim();
        if (!/^[0-9+()\- ]{7,20}$/.test(trimmedPhone)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid phone number format.',
          });
        }
        finalPhone = trimmedPhone;
      }
    }

    const updateRes = await client.query(
      `UPDATE public.users
       SET admin_id = $1, first_name = $2, last_name = $3, phone = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, admin_id, email, role, status, first_name, last_name, phone, updated_at`,
      [finalAdminId, finalFirstName, finalLastName, finalPhone, userId]
    );

    const updatedAdmin = updateRes.rows[0];

    recordAuditLog({
      userId: req.user.id,
      action: 'ADMIN_USER_UPDATED',
      entityType: 'USER',
      entityId: userId,
      metadata: {
        admin_id: updatedAdmin.admin_id,
        email: updatedAdmin.email,
        name: `${updatedAdmin.first_name || ''} ${updatedAdmin.last_name || ''}`.trim(),
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Administrator details updated successfully.',
      data: {
        id: updatedAdmin.id,
        adminId: updatedAdmin.admin_id,
        admin_id: updatedAdmin.admin_id,
        email: updatedAdmin.email,
        role: updatedAdmin.role,
        status: updatedAdmin.status,
        firstName: updatedAdmin.first_name,
        lastName: updatedAdmin.last_name,
        name: [updatedAdmin.first_name, updatedAdmin.last_name].filter(Boolean).join(' ') || 'Administrator',
        phone: updatedAdmin.phone,
        updatedAt: updatedAdmin.updated_at,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  deleteAdminPermanently,
};
