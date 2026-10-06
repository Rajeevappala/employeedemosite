const path = require('path');
const crypto = require('crypto');
const pool = require('../config/database');
const storageService = require('../services/storageService');
const { recordAuditLog } = require('../services/auditService');

/**
 * Controller to fetch the profile of the currently authenticated employee.
 * Security: Employee identity is strictly derived from req.user.employee_id,
 * never from client-supplied URL parameters, query strings, or request bodies.
 */
const getProfile = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const query = `
      SELECT 
        e.employee_id,
        e.first_name,
        e.last_name,
        e.email,
        e.personal_email,
        e.phone,
        TO_CHAR(e.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
        e.gender,
        e.designation,
        e.department,
        TO_CHAR(e.date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
        e.work_location,
        e.status,
        e.status AS employment_status,
        COALESCE(e.working_days_per_week, 5)::int AS working_days_per_week,
        e.reporting_manager,
        e.employment_type,
        e.address,
        e.city,
        e.state,
        e.postal_code,
        e.postal_code AS pincode,
        e.emergency_contact_name,
        e.emergency_contact_phone,
        e.emergency_contact_phone AS emergency_contact_number,
        e.emergency_contact_relationship,
        (e.profile_photo_url IS NOT NULL AND e.profile_photo_url != '') AS has_profile_photo,
        e.created_at,
        e.updated_at
      FROM public.employees e
      WHERE e.employee_id = $1
    `;

    const result = await pool.query(query, [employeeId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const emp = result.rows[0];

    // Return sanitized response with photo endpoint instead of internal storage_key
    return res.status(200).json({
      success: true,
      data: {
        ...emp,
        photo_url: emp.has_profile_photo ? '/api/employee/profile/photo' : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to update permitted personal details for the currently authenticated employee.
 * Security & RBAC:
 * - Employee identity is strictly derived from req.user.employee_id.
 * - Whitelist approach: Only permitted personal fields can be modified.
 * - Official fields (employee_id, email, first_name, last_name, department, designation,
 *   date_of_joining, work_location, status, working_days_per_week, salary, PF, role)
 *   are strictly ignored and cannot be modified by the employee.
 */
const updateProfile = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    // Verify employee exists and get current record
    const empCheck = await pool.query(
      `SELECT employee_id, user_id, phone, address, city, state, postal_code,
              personal_email, emergency_contact_name, emergency_contact_phone,
              emergency_contact_relationship
       FROM public.employees
       WHERE employee_id = $1`,
      [employeeId]
    );

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const current = empCheck.rows[0];

    // Whitelist extraction (aliases supported for API convenience)
    const {
      personal_email,
      personalEmail,
      phone,
      address,
      city,
      state,
      postal_code,
      postalCode,
      pincode,
      emergency_contact_name,
      emergencyContactName,
      emergency_contact_phone,
      emergencyContactPhone,
      emergency_contact_number,
      emergencyContactNumber,
      emergency_contact_relationship,
      emergencyContactRelationship,
    } = req.body || {};

    const rawPersonalEmail = personal_email !== undefined ? personal_email : personalEmail;
    const rawPhone = phone !== undefined ? phone : undefined;
    const rawAddress = address !== undefined ? address : undefined;
    const rawCity = city !== undefined ? city : undefined;
    const rawState = state !== undefined ? state : undefined;
    const rawPincode = postal_code !== undefined ? postal_code : (postalCode !== undefined ? postalCode : pincode);
    const rawEmergencyName = emergency_contact_name !== undefined ? emergency_contact_name : emergencyContactName;
    const rawEmergencyPhone = emergency_contact_phone !== undefined
      ? emergency_contact_phone
      : (emergencyContactPhone !== undefined
        ? emergencyContactPhone
        : (emergency_contact_number !== undefined
          ? emergency_contact_number
          : emergencyContactNumber));
    const rawEmergencyRelationship = emergency_contact_relationship !== undefined
      ? emergency_contact_relationship
      : emergencyContactRelationship;

    const updatedFieldsList = [];

    // 1. Validate personal_email
    let sanitizedPersonalEmail = current.personal_email;
    if (rawPersonalEmail !== undefined) {
      if (rawPersonalEmail === null || String(rawPersonalEmail).trim() === '') {
        sanitizedPersonalEmail = null;
      } else {
        const trimmed = String(rawPersonalEmail).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid personal email format.',
          });
        }
        if (trimmed.length > 255) {
          return res.status(400).json({
            success: false,
            message: 'Personal email address is too long (maximum 255 characters).',
          });
        }
        sanitizedPersonalEmail = trimmed;
      }
      updatedFieldsList.push('personal_email');
    }

    // 2. Validate phone
    let sanitizedPhone = current.phone;
    if (rawPhone !== undefined) {
      if (rawPhone === null || String(rawPhone).trim() === '') {
        sanitizedPhone = null;
      } else {
        const trimmed = String(rawPhone).trim().replace(/[\s-]/g, '');
        if (!/^\d{10}$/.test(trimmed)) {
          return res.status(400).json({
            success: false,
            message: 'Phone number must be a valid 10-digit number.',
          });
        }
        sanitizedPhone = trimmed;
      }
      updatedFieldsList.push('phone');
    }

    // 3. Validate postal_code / pincode
    let sanitizedPincode = current.postal_code;
    if (rawPincode !== undefined) {
      if (rawPincode === null || String(rawPincode).trim() === '') {
        sanitizedPincode = null;
      } else {
        const trimmed = String(rawPincode).trim().replace(/\s/g, '');
        if (!/^\d{6}$/.test(trimmed)) {
          return res.status(400).json({
            success: false,
            message: 'Pincode must be exactly 6 numeric digits.',
          });
        }
        sanitizedPincode = trimmed;
      }
      updatedFieldsList.push('postal_code');
    }

    // 4. Validate emergency_contact_phone / number
    let sanitizedEmergencyPhone = current.emergency_contact_phone;
    if (rawEmergencyPhone !== undefined) {
      if (rawEmergencyPhone === null || String(rawEmergencyPhone).trim() === '') {
        sanitizedEmergencyPhone = null;
      } else {
        const trimmed = String(rawEmergencyPhone).trim().replace(/[\s-]/g, '');
        if (!/^\d{10}$/.test(trimmed)) {
          return res.status(400).json({
            success: false,
            message: 'Emergency contact phone number must be a valid 10-digit number.',
          });
        }
        sanitizedEmergencyPhone = trimmed;
      }
      updatedFieldsList.push('emergency_contact_phone');
    }

    // 5. Validate text fields: address, city, state, emergency_contact_name, emergency_contact_relationship
    let sanitizedAddress = current.address;
    if (rawAddress !== undefined) {
      sanitizedAddress = rawAddress && String(rawAddress).trim() ? String(rawAddress).trim().substring(0, 500) : null;
      updatedFieldsList.push('address');
    }

    let sanitizedCity = current.city;
    if (rawCity !== undefined) {
      sanitizedCity = rawCity && String(rawCity).trim() ? String(rawCity).trim().substring(0, 100) : null;
      updatedFieldsList.push('city');
    }

    let sanitizedState = current.state;
    if (rawState !== undefined) {
      sanitizedState = rawState && String(rawState).trim() ? String(rawState).trim().substring(0, 100) : null;
      updatedFieldsList.push('state');
    }

    let sanitizedEmergencyName = current.emergency_contact_name;
    if (rawEmergencyName !== undefined) {
      sanitizedEmergencyName = rawEmergencyName && String(rawEmergencyName).trim() ? String(rawEmergencyName).trim().substring(0, 100) : null;
      updatedFieldsList.push('emergency_contact_name');
    }

    let sanitizedEmergencyRelationship = current.emergency_contact_relationship;
    if (rawEmergencyRelationship !== undefined) {
      sanitizedEmergencyRelationship = rawEmergencyRelationship && String(rawEmergencyRelationship).trim() ? String(rawEmergencyRelationship).trim().substring(0, 50) : null;
      updatedFieldsList.push('emergency_contact_relationship');
    }

    // Execute atomic update
    const updateQuery = `
      UPDATE public.employees
      SET 
        personal_email = $1,
        phone = $2,
        address = $3,
        city = $4,
        state = $5,
        postal_code = $6,
        emergency_contact_name = $7,
        emergency_contact_phone = $8,
        emergency_contact_relationship = $9,
        updated_at = NOW()
      WHERE employee_id = $10
      RETURNING 
        employee_id, first_name, last_name, email, personal_email, phone,
        TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
        gender, designation, department,
        TO_CHAR(date_of_joining, 'YYYY-MM-DD') AS date_of_joining,
        work_location, status, status AS employment_status,
        COALESCE(working_days_per_week, 5)::int AS working_days_per_week,
        reporting_manager, employment_type,
        address, city, state, postal_code, postal_code AS pincode,
        emergency_contact_name, emergency_contact_phone,
        emergency_contact_phone AS emergency_contact_number,
        emergency_contact_relationship,
        (profile_photo_url IS NOT NULL AND profile_photo_url != '') AS has_profile_photo,
        updated_at;
    `;

    const updateResult = await pool.query(updateQuery, [
      sanitizedPersonalEmail,
      sanitizedPhone,
      sanitizedAddress,
      sanitizedCity,
      sanitizedState,
      sanitizedPincode,
      sanitizedEmergencyName,
      sanitizedEmergencyPhone,
      sanitizedEmergencyRelationship,
      employeeId,
    ]);

    const updatedEmp = updateResult.rows[0];

    // Synchronize phone with users table if linked
    if (rawPhone !== undefined && current.user_id) {
      await pool.query(
        'UPDATE public.users SET phone = $1, updated_at = NOW() WHERE id = $2',
        [sanitizedPhone, current.user_id]
      ).catch((err) => {
        console.error('Non-critical: Failed to synchronize user phone:', err.message);
      });
    }

    // Record audit log
    await recordAuditLog({
      userId: req.user.id,
      action: 'EMPLOYEE_PROFILE_UPDATED',
      entityType: 'EMPLOYEE',
      entityId: employeeId,
      metadata: {
        employee_id: employeeId,
        updated_fields: updatedFieldsList,
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        ...updatedEmp,
        photo_url: updatedEmp.has_profile_photo ? '/api/employee/profile/photo' : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to fetch the authenticated employee's private profile photo.
 * Security: Serves strictly the authenticated employee's own photo from private storage.
 */
const getProfilePhoto = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const empRes = await pool.query(
      'SELECT profile_photo_url FROM public.employees WHERE employee_id = $1',
      [employeeId]
    );

    if (empRes.rows.length === 0 || !empRes.rows[0].profile_photo_url) {
      return res.status(404).json({
        success: false,
        message: 'Profile photo not found.',
      });
    }

    const storageKey = empRes.rows[0].profile_photo_url;

    const filePath = await storageService.getSafeFilePath(storageKey);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png'
      ? 'image/png'
      : (ext === '.webp' ? 'image/webp' : 'image/jpeg');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    return res.sendFile(filePath);
  } catch (error) {
    if (error.name === 'FileNotFoundError' || error.code === 'FILE_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: 'Profile photo not found in storage.',
      });
    }
    next(error);
  }
};

/**
 * Controller to upload or replace the authenticated employee's profile photo.
 * Security & Safe replacement sequence:
 * 1. Validate new image file via uploadSingleProfilePhoto middleware.
 * 2. Save new image using a new unique storage key in private storage.
 * 3. Update database profile_photo_url reference.
 * 4. Only after DB commit succeeds, delete old physical file.
 * 5. If DB update fails, delete newly uploaded file and keep existing photo intact.
 */
const uploadProfilePhoto = async (req, res, next) => {
  let newFileSaved = false;
  let newStorageKey = null;

  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. A valid image file (JPEG, PNG, or WebP) is required.',
      });
    }

    // Fetch existing photo key
    const empRes = await pool.query(
      'SELECT profile_photo_url FROM public.employees WHERE employee_id = $1',
      [employeeId]
    );

    if (empRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const oldStorageKey = empRes.rows[0].profile_photo_url;

    // Generate new unique storage key under documents/GP####N/profile/
    const cleanEmpId = employeeId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const uuid = crypto.randomUUID();
    newStorageKey = `documents/${cleanEmpId}/profile/${uuid}${ext}`;

    // 1. Save new file buffer to private storage
    await storageService.saveFile(req.file.buffer, newStorageKey);
    newFileSaved = true;

    // 2. Update database reference
    try {
      await pool.query(
        'UPDATE public.employees SET profile_photo_url = $1, updated_at = NOW() WHERE employee_id = $2',
        [newStorageKey, cleanEmpId]
      );

      // 3. Delete old physical file now that DB update succeeded
      if (oldStorageKey && oldStorageKey !== newStorageKey) {
        await storageService.deleteFile(oldStorageKey).catch((delErr) => {
          console.error('Non-critical: Failed to remove old profile photo file:', delErr.message);
        });
      }

      // 4. Record audit log
      await recordAuditLog({
        userId: req.user.id,
        action: 'PROFILE_PHOTO_UPDATED',
        entityType: 'EMPLOYEE',
        entityId: cleanEmpId,
        metadata: {
          employee_id: cleanEmpId,
          filename: req.file.originalname,
          size: req.file.size,
        },
        req,
      });

      return res.status(200).json({
        success: true,
        message: 'Profile photo updated successfully.',
        data: {
          has_profile_photo: true,
          photo_url: `/api/employee/profile/photo?t=${Date.now()}`,
        },
      });
    } catch (dbErr) {
      // Rollback: if DB update failed, delete the newly written file
      if (newFileSaved && newStorageKey) {
        await storageService.deleteFile(newStorageKey).catch(() => {});
      }
      return next(dbErr);
    }
  } catch (error) {
    if (newFileSaved && newStorageKey) {
      await storageService.deleteFile(newStorageKey).catch(() => {});
    }
    next(error);
  }
};

/**
 * Controller to remove the authenticated employee's profile photo.
 */
const deleteProfilePhoto = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const empRes = await pool.query(
      'SELECT profile_photo_url FROM public.employees WHERE employee_id = $1',
      [employeeId]
    );

    if (empRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const oldStorageKey = empRes.rows[0].profile_photo_url;

    if (!oldStorageKey) {
      return res.status(200).json({
        success: true,
        message: 'No profile photo to remove.',
        data: { has_profile_photo: false, photo_url: null },
      });
    }

    await pool.query(
      'UPDATE public.employees SET profile_photo_url = NULL, updated_at = NOW() WHERE employee_id = $1',
      [employeeId]
    );

    await storageService.deleteFile(oldStorageKey).catch(() => {});

    await recordAuditLog({
      userId: req.user.id,
      action: 'PROFILE_PHOTO_REMOVED',
      entityType: 'EMPLOYEE',
      entityId: employeeId,
      metadata: { employee_id: employeeId },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Profile photo removed successfully.',
      data: {
        has_profile_photo: false,
        photo_url: null,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getProfilePhoto,
  uploadProfilePhoto,
  deleteProfilePhoto,
};
