const pool = require('../config/database');
const { recordAuditLog } = require('../services/auditService');

/**
 * Helper to validate website URL format.
 * Accepts full URLs with protocol or bare domains (e.g., https://example.com or example.com).
 */
const isValidUrl = (urlStr) => {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const trimmed = urlStr.trim();
  if (!trimmed) return false;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    return Boolean(
      parsed.hostname &&
      parsed.hostname.includes('.') &&
      !parsed.hostname.startsWith('.') &&
      !parsed.hostname.endsWith('.')
    );
  } catch {
    return false;
  }
};

/**
 * Helper to validate phone format.
 * Accepts international / local phone numbers: 7-20 characters, allowing digits, spaces, hyphens, +, ().
 */
const isValidPhone = (phoneStr) => {
  if (!phoneStr || typeof phoneStr !== 'string') return false;
  const trimmed = phoneStr.trim();
  if (!trimmed) return false;
  // Require at least 7 digits and standard delimiters
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return false;
  return /^[+]?[\d\s\-()]{7,20}$/.test(trimmed);
};

/**
 * Helper to validate email format.
 */
const isValidEmail = (emailStr) => {
  if (!emailStr || typeof emailStr !== 'string') return false;
  const trimmed = emailStr.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

/**
 * Helper to validate Indian postal code format.
 * Indian PIN code: 6 digits, optionally separated by a space (e.g. 500081 or 500 081).
 */
const isValidIndianPostalCode = (codeStr) => {
  if (!codeStr || typeof codeStr !== 'string') return false;
  const trimmed = codeStr.trim();
  if (!trimmed) return false;
  return /^[1-9][0-9]{2}\s?[0-9]{3}$/.test(trimmed);
};

/**
 * GET /api/admin/settings/organization
 * Returns the current organization settings singleton record.
 */
const getOrganizationSettings = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        organization_name,
        legal_name,
        address_line_1,
        address_line_2,
        city,
        state,
        postal_code,
        country,
        phone,
        email,
        website,
        logo_path,
        created_at,
        updated_at,
        updated_by
      FROM public.organization_settings
      WHERE is_singleton = TRUE
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      // Default fallback if table was ever unseeded
      return res.status(200).json({
        success: true,
        data: {
          id: null,
          organization_name: 'GaintPro Software Technologies',
          legal_name: '',
          address_line_1: '',
          address_line_2: '',
          city: '',
          state: '',
          postal_code: '',
          country: 'India',
          phone: '',
          email: '',
          website: '',
          logo_path: null,
        },
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        organization_name: row.organization_name || 'GaintPro Software Technologies',
        legal_name: row.legal_name || '',
        address_line_1: row.address_line_1 || '',
        address_line_2: row.address_line_2 || '',
        city: row.city || '',
        state: row.state || '',
        postal_code: row.postal_code || '',
        country: row.country || 'India',
        phone: row.phone || '',
        email: row.email || '',
        website: row.website || '',
        logo_path: row.logo_path || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/settings/organization
 * Updates the organization settings singleton record with comprehensive validation and audit logging.
 */
const updateOrganizationSettings = async (req, res, next) => {
  try {
    const {
      organization_name,
      legal_name,
      address_line_1,
      address_line_2,
      city,
      state,
      postal_code,
      country,
      phone,
      email,
      website,
      logo_path,
    } = req.body || {};

    // 1. Organization Name Validation (Required)
    const trimmedOrgName = typeof organization_name === 'string' ? organization_name.trim() : '';
    if (!trimmedOrgName) {
      return res.status(400).json({
        success: false,
        message: 'Organization name is required.',
      });
    }
    if (trimmedOrgName.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Organization name cannot exceed 200 characters.',
      });
    }

    // 2. Country Validation (Required, default India)
    const trimmedCountry = typeof country === 'string' ? country.trim() : 'India';
    if (!trimmedCountry) {
      return res.status(400).json({
        success: false,
        message: 'Country is required.',
      });
    }
    if (trimmedCountry.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Country cannot exceed 100 characters.',
      });
    }

    // 3. Legal Name (Optional)
    const trimmedLegalName = typeof legal_name === 'string' ? legal_name.trim() : null;
    if (trimmedLegalName && trimmedLegalName.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Legal name cannot exceed 200 characters.',
      });
    }

    // 4. Address Fields (Optional)
    const trimmedAddr1 = typeof address_line_1 === 'string' ? address_line_1.trim() : null;
    const trimmedAddr2 = typeof address_line_2 === 'string' ? address_line_2.trim() : null;
    const trimmedCity = typeof city === 'string' ? city.trim() : null;
    const trimmedState = typeof state === 'string' ? state.trim() : null;

    if (trimmedAddr1 && trimmedAddr1.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Address Line 1 cannot exceed 500 characters.',
      });
    }
    if (trimmedAddr2 && trimmedAddr2.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Address Line 2 cannot exceed 500 characters.',
      });
    }
    if (trimmedCity && trimmedCity.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'City cannot exceed 100 characters.',
      });
    }
    if (trimmedState && trimmedState.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'State cannot exceed 100 characters.',
      });
    }

    // 5. Postal Code Validation (Optional, Indian PIN validation when Country is India)
    const trimmedPostal = typeof postal_code === 'string' ? postal_code.trim() : null;
    if (trimmedPostal) {
      if (trimmedPostal.length > 20) {
        return res.status(400).json({
          success: false,
          message: 'Postal code cannot exceed 20 characters.',
        });
      }
      const isIndia = ['india', 'in'].includes(trimmedCountry.toLowerCase());
      if (isIndia && !isValidIndianPostalCode(trimmedPostal)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid 6-digit Indian postal code (e.g. 500081).',
        });
      }
    }

    // 6. Phone Validation (Optional)
    const trimmedPhone = typeof phone === 'string' ? phone.trim() : null;
    if (trimmedPhone) {
      if (!isValidPhone(trimmedPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid phone number (7 to 15 digits).',
        });
      }
    }

    // 7. Email Validation (Optional)
    const trimmedEmail = typeof email === 'string' ? email.trim() : null;
    if (trimmedEmail) {
      if (!isValidEmail(trimmedEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address.',
        });
      }
      if (trimmedEmail.length > 255) {
        return res.status(400).json({
          success: false,
          message: 'Email cannot exceed 255 characters.',
        });
      }
    }

    // 8. Website Validation (Optional)
    const trimmedWebsite = typeof website === 'string' ? website.trim() : null;
    if (trimmedWebsite) {
      if (!isValidUrl(trimmedWebsite)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid website URL (e.g. https://gaintpro.com).',
        });
      }
      if (trimmedWebsite.length > 255) {
        return res.status(400).json({
          success: false,
          message: 'Website URL cannot exceed 255 characters.',
        });
      }
    }

    // Fetch existing settings before update to identify changed fields for audit log
    const prevResult = await pool.query(`
      SELECT * FROM public.organization_settings WHERE is_singleton = TRUE LIMIT 1
    `);
    const prevRow = prevResult.rows[0] || {};

    const cleanLogoPath = typeof logo_path === 'string' && logo_path.trim() ? logo_path.trim() : null;

    // Perform idempotent singleton upsert
    const upsertResult = await pool.query(`
      INSERT INTO public.organization_settings (
        organization_name,
        legal_name,
        address_line_1,
        address_line_2,
        city,
        state,
        postal_code,
        country,
        phone,
        email,
        website,
        logo_path,
        is_singleton,
        updated_at,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, NOW(), $13)
      ON CONFLICT (is_singleton) DO UPDATE SET
        organization_name = EXCLUDED.organization_name,
        legal_name = EXCLUDED.legal_name,
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        postal_code = EXCLUDED.postal_code,
        country = EXCLUDED.country,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        website = EXCLUDED.website,
        logo_path = COALESCE(EXCLUDED.logo_path, public.organization_settings.logo_path),
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING *;
    `, [
      trimmedOrgName,
      trimmedLegalName || null,
      trimmedAddr1 || null,
      trimmedAddr2 || null,
      trimmedCity || null,
      trimmedState || null,
      trimmedPostal || null,
      trimmedCountry,
      trimmedPhone || null,
      trimmedEmail || null,
      trimmedWebsite || null,
      cleanLogoPath,
      req.user?.id || null,
    ]);

    const updatedRow = upsertResult.rows[0];

    // Compute changed fields
    const compareKeys = [
      'organization_name',
      'legal_name',
      'address_line_1',
      'address_line_2',
      'city',
      'state',
      'postal_code',
      'country',
      'phone',
      'email',
      'website',
    ];
    const changedFields = [];
    for (const key of compareKeys) {
      const oldVal = (prevRow[key] || '').trim();
      const newVal = (updatedRow[key] || '').trim();
      if (oldVal !== newVal) {
        changedFields.push(key);
      }
    }

    // Record immutable audit log
    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'ORGANIZATION_SETTINGS_UPDATED',
      entityType: 'ORGANIZATION_SETTINGS',
      entityId: String(updatedRow.id),
      metadata: {
        admin_email: req.user?.email || 'unknown',
        updated_at: new Date().toISOString(),
        fields_changed: changedFields.length > 0 ? changedFields : ['no_changes_detected'],
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Organization settings updated successfully.',
      data: {
        id: updatedRow.id,
        organization_name: updatedRow.organization_name,
        legal_name: updatedRow.legal_name || '',
        address_line_1: updatedRow.address_line_1 || '',
        address_line_2: updatedRow.address_line_2 || '',
        city: updatedRow.city || '',
        state: updatedRow.state || '',
        postal_code: updatedRow.postal_code || '',
        country: updatedRow.country || 'India',
        phone: updatedRow.phone || '',
        email: updatedRow.email || '',
        website: updatedRow.website || '',
        logo_path: updatedRow.logo_path || null,
        updated_at: updatedRow.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

const VALID_DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/**
 * Normalizes time string to HH:MM:SS format
 */
const normalizeTime = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(trimmed)) return null;
  const parts = trimmed.split(':');
  const hh = parts[0].padStart(2, '0');
  const mm = parts[1].padStart(2, '0');
  const ss = parts[2] ? parts[2].padStart(2, '0') : '00';
  return `${hh}:${mm}:${ss}`;
};

/**
 * GET /api/admin/settings/work-attendance
 * Returns the current organization work schedule and attendance rules.
 */
const getWorkAttendanceSettings = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        default_work_week,
        default_work_start_time,
        default_work_end_time,
        default_break_duration_minutes,
        default_weekly_off_days,
        allow_half_day,
        allow_work_from_home,
        created_at,
        updated_at,
        updated_by
      FROM public.organization_work_settings
      WHERE is_singleton = TRUE
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          id: null,
          default_work_week: '5-Day Work Week',
          default_work_start_time: '09:30:00',
          default_work_end_time: '18:30:00',
          default_break_duration_minutes: 60,
          default_weekly_off_days: ['Saturday', 'Sunday'],
          allow_half_day: true,
          allow_work_from_home: true,
        },
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        default_work_week: row.default_work_week || '5-Day Work Week',
        default_work_start_time: row.default_work_start_time || '09:30:00',
        default_work_end_time: row.default_work_end_time || '18:30:00',
        default_break_duration_minutes: Number(row.default_break_duration_minutes ?? 60),
        default_weekly_off_days: Array.isArray(row.default_weekly_off_days)
          ? row.default_weekly_off_days
          : ['Saturday', 'Sunday'],
        allow_half_day: Boolean(row.allow_half_day),
        allow_work_from_home: Boolean(row.allow_work_from_home),
        created_at: row.created_at,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/settings/work-attendance
 * Updates the organization work schedule and attendance rules.
 */
const updateWorkAttendanceSettings = async (req, res, next) => {
  try {
    const {
      default_work_week,
      default_work_start_time,
      default_work_end_time,
      default_break_duration_minutes,
      default_weekly_off_days,
      allow_half_day,
      allow_work_from_home,
    } = req.body || {};

    // 1. Validate Work Week (5-Day Work Week or 6-Day Work Week)
    let normalizedWorkWeek = default_work_week;
    if (typeof default_work_week === 'string') {
      const lower = default_work_week.trim().toLowerCase();
      if (lower === '5-day' || lower === '5-day work week' || lower === '5') {
        normalizedWorkWeek = '5-Day Work Week';
      } else if (lower === '6-day' || lower === '6-day work week' || lower === '6') {
        normalizedWorkWeek = '6-Day Work Week';
      }
    } else if (default_work_week === 5) {
      normalizedWorkWeek = '5-Day Work Week';
    } else if (default_work_week === 6) {
      normalizedWorkWeek = '6-Day Work Week';
    }

    if (!['5-Day Work Week', '6-Day Work Week'].includes(normalizedWorkWeek)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid work week. Allowed values: 5-Day Work Week or 6-Day Work Week.',
      });
    }

    // 2. Validate Work Start Time and End Time
    const normalizedStartTime = normalizeTime(default_work_start_time);
    const normalizedEndTime = normalizeTime(default_work_end_time);

    if (!normalizedStartTime || !normalizedEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Invalid time format for start/end time (expected HH:MM or HH:MM:SS).',
      });
    }

    if (normalizedStartTime === normalizedEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Work start time and end time cannot be identical.',
      });
    }

    // 3. Validate Break Duration
    if (
      default_break_duration_minutes === undefined ||
      default_break_duration_minutes === null ||
      !Number.isInteger(Number(default_break_duration_minutes)) ||
      Number(default_break_duration_minutes) < 0 ||
      Number(default_break_duration_minutes) > 480
    ) {
      return res.status(400).json({
        success: false,
        message: 'Break duration must be an integer between 0 and 480 minutes.',
      });
    }
    const breakDuration = Number(default_break_duration_minutes);

    // 4. Validate Weekly Off Days
    if (!Array.isArray(default_weekly_off_days) || default_weekly_off_days.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one weekly off day must be selected.',
      });
    }

    for (const day of default_weekly_off_days) {
      if (typeof day !== 'string' || !VALID_DAYS_OF_WEEK.includes(day)) {
        return res.status(400).json({
          success: false,
          message: `Invalid weekly off day: ${day}. Allowed days: ${VALID_DAYS_OF_WEEK.join(', ')}.`,
        });
      }
    }

    // Deduplicate weekly off days keeping order
    const uniqueWeeklyOff = Array.from(new Set(default_weekly_off_days));

    // 5. Validate Boolean Rule Toggles
    if (typeof allow_half_day !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'allow_half_day must be a boolean.',
      });
    }

    if (typeof allow_work_from_home !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'allow_work_from_home must be a boolean.',
      });
    }

    // Fetch existing settings before update to identify changed fields
    const prevResult = await pool.query(`
      SELECT * FROM public.organization_work_settings WHERE is_singleton = TRUE LIMIT 1
    `);
    const prevRow = prevResult.rows[0] || {};

    // Execute idempotent singleton upsert
    const upsertResult = await pool.query(`
      INSERT INTO public.organization_work_settings (
        default_work_week,
        default_work_start_time,
        default_work_end_time,
        default_break_duration_minutes,
        default_weekly_off_days,
        allow_half_day,
        allow_work_from_home,
        is_singleton,
        updated_at,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), $8)
      ON CONFLICT (is_singleton) DO UPDATE SET
        default_work_week = EXCLUDED.default_work_week,
        default_work_start_time = EXCLUDED.default_work_start_time,
        default_work_end_time = EXCLUDED.default_work_end_time,
        default_break_duration_minutes = EXCLUDED.default_break_duration_minutes,
        default_weekly_off_days = EXCLUDED.default_weekly_off_days,
        allow_half_day = EXCLUDED.allow_half_day,
        allow_work_from_home = EXCLUDED.allow_work_from_home,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING *;
    `, [
      normalizedWorkWeek,
      normalizedStartTime,
      normalizedEndTime,
      breakDuration,
      JSON.stringify(uniqueWeeklyOff),
      allow_half_day,
      allow_work_from_home,
      req.user?.id || null,
    ]);

    const updatedRow = upsertResult.rows[0];

    // Compute changed fields for audit log
    const changedFields = [];
    if (prevRow.default_work_week !== updatedRow.default_work_week) {
      changedFields.push('default_work_week');
    }
    if (prevRow.default_work_start_time !== updatedRow.default_work_start_time) {
      changedFields.push('default_work_start_time');
    }
    if (prevRow.default_work_end_time !== updatedRow.default_work_end_time) {
      changedFields.push('default_work_end_time');
    }
    if (Number(prevRow.default_break_duration_minutes) !== Number(updatedRow.default_break_duration_minutes)) {
      changedFields.push('default_break_duration_minutes');
    }
    const prevOff = JSON.stringify(prevRow.default_weekly_off_days || []);
    const newOff = JSON.stringify(updatedRow.default_weekly_off_days || []);
    if (prevOff !== newOff) {
      changedFields.push('default_weekly_off_days');
    }
    if (Boolean(prevRow.allow_half_day) !== Boolean(updatedRow.allow_half_day)) {
      changedFields.push('allow_half_day');
    }
    if (Boolean(prevRow.allow_work_from_home) !== Boolean(updatedRow.allow_work_from_home)) {
      changedFields.push('allow_work_from_home');
    }

    // Only create audit log if actual fields changed
    if (changedFields.length > 0) {
      await recordAuditLog({
        userId: req.user?.id || null,
        action: 'WORK_ATTENDANCE_SETTINGS_UPDATED',
        entityType: 'WORK_ATTENDANCE_SETTINGS',
        entityId: String(updatedRow.id),
        metadata: {
          admin_email: req.user?.email || 'unknown',
          updated_at: new Date().toISOString(),
          fields_changed: changedFields,
        },
        req,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Work & Attendance settings updated successfully.',
      data: {
        id: updatedRow.id,
        default_work_week: updatedRow.default_work_week,
        default_work_start_time: updatedRow.default_work_start_time,
        default_work_end_time: updatedRow.default_work_end_time,
        default_break_duration_minutes: updatedRow.default_break_duration_minutes,
        default_weekly_off_days: updatedRow.default_weekly_off_days,
        allow_half_day: updatedRow.allow_half_day,
        allow_work_from_home: updatedRow.allow_work_from_home,
        updated_at: updatedRow.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/settings/leave
 * Returns the current organization leave policy and allocation defaults.
 */
const getLeaveSettings = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        default_annual_paid_leave,
        default_annual_sick_leave,
        default_annual_unpaid_leave,
        allow_carry_forward,
        max_carry_forward_days,
        allow_negative_balance,
        require_admin_approval,
        minimum_leave_notice_days,
        maximum_continuous_leave_days,
        created_at,
        updated_at,
        updated_by
      FROM public.organization_leave_settings
      WHERE is_singleton = TRUE
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          id: null,
          default_annual_paid_leave: 18,
          default_annual_sick_leave: 10,
          default_annual_unpaid_leave: 0,
          allow_carry_forward: true,
          max_carry_forward_days: 5,
          allow_negative_balance: false,
          require_admin_approval: true,
          minimum_leave_notice_days: 1,
          maximum_continuous_leave_days: 14,
          leave_types: ['PL', 'Sick Leave', 'UPL'],
        },
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        default_annual_paid_leave: Number(row.default_annual_paid_leave),
        default_annual_sick_leave: Number(row.default_annual_sick_leave),
        default_annual_unpaid_leave: Number(row.default_annual_unpaid_leave),
        allow_carry_forward: Boolean(row.allow_carry_forward),
        max_carry_forward_days: Number(row.max_carry_forward_days),
        allow_negative_balance: Boolean(row.allow_negative_balance),
        require_admin_approval: Boolean(row.require_admin_approval),
        minimum_leave_notice_days: Number(row.minimum_leave_notice_days),
        maximum_continuous_leave_days: Number(row.maximum_continuous_leave_days),
        leave_types: ['PL', 'Sick Leave', 'UPL'],
        created_at: row.created_at,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/settings/leave
 * Updates organization leave policy and allocation defaults.
 */
const updateLeaveSettings = async (req, res, next) => {
  try {
    const {
      default_annual_paid_leave,
      default_annual_sick_leave,
      default_annual_unpaid_leave,
      allow_carry_forward,
      max_carry_forward_days,
      allow_negative_balance,
      require_admin_approval,
      minimum_leave_notice_days,
      maximum_continuous_leave_days,
    } = req.body || {};

    // 1. Validate Paid Leave Allocation (Integer >= 0)
    if (
      default_annual_paid_leave === undefined ||
      default_annual_paid_leave === null ||
      !Number.isInteger(Number(default_annual_paid_leave)) ||
      Number(default_annual_paid_leave) < 0 ||
      Number(default_annual_paid_leave) > 365
    ) {
      return res.status(400).json({
        success: false,
        message: 'Paid Leave annual allocation must be an integer between 0 and 365.',
      });
    }
    const paidLeaveAlloc = Number(default_annual_paid_leave);

    // 2. Validate Sick Leave Allocation (Integer >= 0)
    if (
      default_annual_sick_leave === undefined ||
      default_annual_sick_leave === null ||
      !Number.isInteger(Number(default_annual_sick_leave)) ||
      Number(default_annual_sick_leave) < 0 ||
      Number(default_annual_sick_leave) > 365
    ) {
      return res.status(400).json({
        success: false,
        message: 'Sick Leave annual allocation must be an integer between 0 and 365.',
      });
    }
    const sickLeaveAlloc = Number(default_annual_sick_leave);

    // 3. Validate Unpaid Leave Allocation (Integer >= 0)
    if (
      default_annual_unpaid_leave === undefined ||
      default_annual_unpaid_leave === null ||
      !Number.isInteger(Number(default_annual_unpaid_leave)) ||
      Number(default_annual_unpaid_leave) < 0 ||
      Number(default_annual_unpaid_leave) > 365
    ) {
      return res.status(400).json({
        success: false,
        message: 'Unpaid Leave annual allocation must be an integer between 0 and 365.',
      });
    }
    const unpaidLeaveAlloc = Number(default_annual_unpaid_leave);

    // 4. Validate Carry Forward Boolean
    if (typeof allow_carry_forward !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'allow_carry_forward must be a boolean.',
      });
    }

    // 5. Validate Maximum Carry Forward Days (Integer >= 0)
    if (
      max_carry_forward_days === undefined ||
      max_carry_forward_days === null ||
      !Number.isInteger(Number(max_carry_forward_days)) ||
      Number(max_carry_forward_days) < 0 ||
      Number(max_carry_forward_days) > 365
    ) {
      return res.status(400).json({
        success: false,
        message: 'Maximum carry forward days must be an integer between 0 and 365.',
      });
    }
    const maxCarryDays = Number(max_carry_forward_days);

    // 6. Validate Negative Balance Boolean
    if (typeof allow_negative_balance !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'allow_negative_balance must be a boolean.',
      });
    }

    // 7. Validate Require Admin Approval Boolean
    if (typeof require_admin_approval !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'require_admin_approval must be a boolean.',
      });
    }

    // 8. Validate Minimum Notice Days (Integer >= 0)
    if (
      minimum_leave_notice_days === undefined ||
      minimum_leave_notice_days === null ||
      !Number.isInteger(Number(minimum_leave_notice_days)) ||
      Number(minimum_leave_notice_days) < 0 ||
      Number(minimum_leave_notice_days) > 365
    ) {
      return res.status(400).json({
        success: false,
        message: 'Minimum leave notice must be an integer between 0 and 365 days.',
      });
    }
    const minNoticeDays = Number(minimum_leave_notice_days);

    // 9. Validate Maximum Continuous Leave Days (Integer > 0)
    if (
      maximum_continuous_leave_days === undefined ||
      maximum_continuous_leave_days === null ||
      !Number.isInteger(Number(maximum_continuous_leave_days)) ||
      Number(maximum_continuous_leave_days) <= 0 ||
      Number(maximum_continuous_leave_days) > 365
    ) {
      return res.status(400).json({
        success: false,
        message: 'Maximum continuous leave must be an integer between 1 and 365 days.',
      });
    }
    const maxContinuousDays = Number(maximum_continuous_leave_days);

    // Fetch existing settings before update to identify changed fields
    const prevResult = await pool.query(`
      SELECT * FROM public.organization_leave_settings WHERE is_singleton = TRUE LIMIT 1
    `);
    const prevRow = prevResult.rows[0] || {};

    // Execute idempotent singleton upsert
    const upsertResult = await pool.query(`
      INSERT INTO public.organization_leave_settings (
        default_annual_paid_leave,
        default_annual_sick_leave,
        default_annual_unpaid_leave,
        allow_carry_forward,
        max_carry_forward_days,
        allow_negative_balance,
        require_admin_approval,
        minimum_leave_notice_days,
        maximum_continuous_leave_days,
        is_singleton,
        updated_at,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW(), $10)
      ON CONFLICT (is_singleton) DO UPDATE SET
        default_annual_paid_leave = EXCLUDED.default_annual_paid_leave,
        default_annual_sick_leave = EXCLUDED.default_annual_sick_leave,
        default_annual_unpaid_leave = EXCLUDED.default_annual_unpaid_leave,
        allow_carry_forward = EXCLUDED.allow_carry_forward,
        max_carry_forward_days = EXCLUDED.max_carry_forward_days,
        allow_negative_balance = EXCLUDED.allow_negative_balance,
        require_admin_approval = EXCLUDED.require_admin_approval,
        minimum_leave_notice_days = EXCLUDED.minimum_leave_notice_days,
        maximum_continuous_leave_days = EXCLUDED.maximum_continuous_leave_days,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING *;
    `, [
      paidLeaveAlloc,
      sickLeaveAlloc,
      unpaidLeaveAlloc,
      allow_carry_forward,
      maxCarryDays,
      allow_negative_balance,
      require_admin_approval,
      minNoticeDays,
      maxContinuousDays,
      req.user?.id || null,
    ]);

    const updatedRow = upsertResult.rows[0];

    // Compute changed fields for audit log
    const changedFields = [];
    if (Number(prevRow.default_annual_paid_leave) !== Number(updatedRow.default_annual_paid_leave)) {
      changedFields.push('default_annual_paid_leave');
    }
    if (Number(prevRow.default_annual_sick_leave) !== Number(updatedRow.default_annual_sick_leave)) {
      changedFields.push('default_annual_sick_leave');
    }
    if (Number(prevRow.default_annual_unpaid_leave) !== Number(updatedRow.default_annual_unpaid_leave)) {
      changedFields.push('default_annual_unpaid_leave');
    }
    if (Boolean(prevRow.allow_carry_forward) !== Boolean(updatedRow.allow_carry_forward)) {
      changedFields.push('allow_carry_forward');
    }
    if (Number(prevRow.max_carry_forward_days) !== Number(updatedRow.max_carry_forward_days)) {
      changedFields.push('max_carry_forward_days');
    }
    if (Boolean(prevRow.allow_negative_balance) !== Boolean(updatedRow.allow_negative_balance)) {
      changedFields.push('allow_negative_balance');
    }
    if (Boolean(prevRow.require_admin_approval) !== Boolean(updatedRow.require_admin_approval)) {
      changedFields.push('require_admin_approval');
    }
    if (Number(prevRow.minimum_leave_notice_days) !== Number(updatedRow.minimum_leave_notice_days)) {
      changedFields.push('minimum_leave_notice_days');
    }
    if (Number(prevRow.maximum_continuous_leave_days) !== Number(updatedRow.maximum_continuous_leave_days)) {
      changedFields.push('maximum_continuous_leave_days');
    }

    // Only create audit log if actual fields changed
    if (changedFields.length > 0) {
      await recordAuditLog({
        userId: req.user?.id || null,
        action: 'LEAVE_SETTINGS_UPDATED',
        entityType: 'LEAVE_SETTINGS',
        entityId: String(updatedRow.id),
        metadata: {
          admin_email: req.user?.email || 'unknown',
          updated_at: new Date().toISOString(),
          fields_changed: changedFields,
        },
        req,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Leave management settings updated successfully.',
      data: {
        id: updatedRow.id,
        default_annual_paid_leave: Number(updatedRow.default_annual_paid_leave),
        default_annual_sick_leave: Number(updatedRow.default_annual_sick_leave),
        default_annual_unpaid_leave: Number(updatedRow.default_annual_unpaid_leave),
        allow_carry_forward: Boolean(updatedRow.allow_carry_forward),
        max_carry_forward_days: Number(updatedRow.max_carry_forward_days),
        allow_negative_balance: Boolean(updatedRow.allow_negative_balance),
        require_admin_approval: Boolean(updatedRow.require_admin_approval),
        minimum_leave_notice_days: Number(updatedRow.minimum_leave_notice_days),
        maximum_continuous_leave_days: Number(updatedRow.maximum_continuous_leave_days),
        leave_types: ['PL', 'Sick Leave', 'UPL'],
        updated_at: updatedRow.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (day < 1 || day > daysInMonth[month - 1]) return false;

  return true;
}

/**
 * GET /api/admin/settings/holidays
 * Returns list of organization holidays, optionally filtered by year or status.
 */
const getHolidays = async (req, res, next) => {
  try {
    const { year, status } = req.query;
    const conditions = [];
    const queryParams = [];

    if (year !== undefined && year !== null && String(year).trim() !== '' && String(year).trim().toLowerCase() !== 'all') {
      const parsedYear = parseInt(year, 10);
      if (!isNaN(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
        queryParams.push(parsedYear);
        conditions.push(`EXTRACT(YEAR FROM holiday_date) = $${queryParams.length}`);
      }
    }

    if (status === 'Upcoming') {
      conditions.push(`holiday_date >= CURRENT_DATE`);
    } else if (status === 'Past') {
      conditions.push(`holiday_date < CURRENT_DATE`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT 
        id,
        TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
        holiday_name,
        description,
        is_active,
        created_at,
        updated_at,
        created_by,
        updated_by
      FROM public.organization_holidays
      ${whereClause}
      ORDER BY holiday_date ASC
    `;

    const result = await pool.query(query, queryParams);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/settings/holidays
 * Creates a new organization holiday definition.
 */
const createHoliday = async (req, res, next) => {
  try {
    const { holiday_name, holiday_date, description } = req.body || {};

    // 1. Validate holiday_name
    if (!holiday_name || typeof holiday_name !== 'string' || holiday_name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Holiday name is required.',
      });
    }
    const trimmedName = holiday_name.trim();
    if (trimmedName.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Holiday name cannot exceed 200 characters.',
      });
    }

    // 2. Validate holiday_date
    if (!holiday_date || typeof holiday_date !== 'string' || !isValidDateString(holiday_date.trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid holiday date in YYYY-MM-DD format is required.',
      });
    }
    const trimmedDate = holiday_date.trim();

    // 3. Validate description (optional)
    let sanitizedDesc = null;
    if (description !== undefined && description !== null && String(description).trim() !== '') {
      if (typeof description !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Description must be a string.',
        });
      }
      const trimmedDesc = description.trim();
      if (trimmedDesc.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'Description cannot exceed 1000 characters.',
        });
      }
      sanitizedDesc = trimmedDesc;
    }

    // 4. Check for duplicate holiday date
    const dupCheck = await pool.query(
      'SELECT id FROM public.organization_holidays WHERE holiday_date = $1::date',
      [trimmedDate]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An organization holiday already exists for this date.',
      });
    }

    // 5. Insert new holiday
    const insertRes = await pool.query(
      `INSERT INTO public.organization_holidays (
         holiday_date,
         holiday_name,
         description,
         is_active,
         created_by,
         updated_by,
         created_at,
         updated_at
       ) VALUES ($1::date, $2, $3, TRUE, $4, $4, NOW(), NOW())
       RETURNING
         id,
         TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
         holiday_name,
         description,
         is_active,
         created_at,
         updated_at;`,
      [trimmedDate, trimmedName, sanitizedDesc, req.user?.id || null]
    );

    const createdRow = insertRes.rows[0];

    // 6. Record audit log
    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'HOLIDAY_CREATED',
      entityType: 'ORGANIZATION_HOLIDAY',
      entityId: String(createdRow.id),
      metadata: {
        holiday_id: createdRow.id,
        holiday_date: createdRow.holiday_date,
        holiday_name: createdRow.holiday_name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Organization holiday created successfully.',
      data: createdRow,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'An organization holiday already exists for this date.',
      });
    }
    next(error);
  }
};

/**
 * PUT /api/admin/settings/holidays/:id
 * Updates an existing organization holiday definition.
 */
const updateHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(404).json({
        success: false,
        message: 'Organization holiday not found.',
      });
    }

    const { holiday_name, holiday_date, description } = req.body || {};

    // 1. Validate holiday_name
    if (!holiday_name || typeof holiday_name !== 'string' || holiday_name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Holiday name is required.',
      });
    }
    const trimmedName = holiday_name.trim();
    if (trimmedName.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Holiday name cannot exceed 200 characters.',
      });
    }

    // 2. Validate holiday_date
    if (!holiday_date || typeof holiday_date !== 'string' || !isValidDateString(holiday_date.trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid holiday date in YYYY-MM-DD format is required.',
      });
    }
    const trimmedDate = holiday_date.trim();

    // 3. Validate description (optional)
    let sanitizedDesc = null;
    if (description !== undefined && description !== null && String(description).trim() !== '') {
      if (typeof description !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Description must be a string.',
        });
      }
      const trimmedDesc = description.trim();
      if (trimmedDesc.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'Description cannot exceed 1000 characters.',
        });
      }
      sanitizedDesc = trimmedDesc;
    }

    // 4. Check if holiday exists
    const existingCheck = await pool.query(
      'SELECT id, holiday_name, TO_CHAR(holiday_date, \'YYYY-MM-DD\') AS holiday_date FROM public.organization_holidays WHERE id = $1::uuid',
      [id]
    );
    if (existingCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Organization holiday not found.',
      });
    }

    // 5. Check date collision with other holidays
    const conflictCheck = await pool.query(
      'SELECT id FROM public.organization_holidays WHERE holiday_date = $1::date AND id != $2::uuid',
      [trimmedDate, id]
    );
    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An organization holiday already exists for this date.',
      });
    }

    // 6. Update holiday
    const updateRes = await pool.query(
      `UPDATE public.organization_holidays
       SET
         holiday_date = $1::date,
         holiday_name = $2,
         description = $3,
         updated_by = $4,
         updated_at = NOW()
       WHERE id = $5::uuid
       RETURNING
         id,
         TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
         holiday_name,
         description,
         is_active,
         created_at,
         updated_at;`,
      [trimmedDate, trimmedName, sanitizedDesc, req.user?.id || null, id]
    );

    const updatedRow = updateRes.rows[0];

    // 7. Record audit log
    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'HOLIDAY_UPDATED',
      entityType: 'ORGANIZATION_HOLIDAY',
      entityId: String(updatedRow.id),
      metadata: {
        holiday_id: updatedRow.id,
        holiday_date: updatedRow.holiday_date,
        holiday_name: updatedRow.holiday_name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Organization holiday updated successfully.',
      data: updatedRow,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'An organization holiday already exists for this date.',
      });
    }
    next(error);
  }
};

/**
 * DELETE /api/admin/settings/holidays/:id
 * Deletes an organization holiday definition.
 * IMPORTANT: Does NOT delete historical attendance records!
 */
const deleteHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(404).json({
        success: false,
        message: 'Organization holiday not found.',
      });
    }

    // 1. Check if holiday exists
    const existingCheck = await pool.query(
      'SELECT id, holiday_name, TO_CHAR(holiday_date, \'YYYY-MM-DD\') AS holiday_date FROM public.organization_holidays WHERE id = $1::uuid',
      [id]
    );

    if (existingCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Organization holiday not found.',
      });
    }

    const existingRow = existingCheck.rows[0];

    // 2. Delete the holiday definition (leave attendance untouched)
    await pool.query('DELETE FROM public.organization_holidays WHERE id = $1::uuid', [id]);

    // 3. Record audit log
    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'HOLIDAY_DELETED',
      entityType: 'ORGANIZATION_HOLIDAY',
      entityId: String(existingRow.id),
      metadata: {
        holiday_id: existingRow.id,
        holiday_date: existingRow.holiday_date,
        holiday_name: existingRow.holiday_name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Organization holiday deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// =============================================================================
// EMPLOYEE CONFIGURATION (PHASE 5) - MASTER DATA CONTROLLER METHODS
// =============================================================================

/**
 * GET /api/admin/settings/employees
 * Consolidated endpoint returning all 4 master data collections with usage counts.
 */
const getEmployeeConfiguration = async (req, res, next) => {
  try {
    const [deptsRes, desigsRes, empTypesRes, locsRes] = await Promise.all([
      pool.query(`
        SELECT d.id, d.name, d.description, d.is_active, d.created_at, d.updated_at,
          (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.department)) = LOWER(TRIM(d.name))) AS employee_count
        FROM public.organization_departments d
        ORDER BY d.is_active DESC, d.name ASC
      `),
      pool.query(`
        SELECT d.id, d.name, d.description, d.is_active, d.created_at, d.updated_at,
          (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.designation)) = LOWER(TRIM(d.name))) AS employee_count
        FROM public.organization_designations d
        ORDER BY d.name ASC
      `),
      pool.query(`
        SELECT et.id, et.name, et.description, et.is_active, et.created_at, et.updated_at,
          (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.employment_type)) = LOWER(TRIM(et.name))) AS employee_count
        FROM public.organization_employment_types et
        ORDER BY et.name ASC
      `),
      pool.query(`
        SELECT l.id, l.name, l.address, l.city, l.state, l.country, l.description, l.is_active, l.created_at, l.updated_at,
          (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.work_location)) = LOWER(TRIM(l.name))) AS employee_count
        FROM public.organization_work_locations l
        ORDER BY l.name ASC
      `),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        departments: deptsRes.rows,
        designations: desigsRes.rows,
        employmentTypes: empTypesRes.rows,
        locations: locsRes.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// 1. DEPARTMENTS
// -----------------------------------------------------------------------------
const getDepartments = async (req, res, next) => {
  try {
    const { active, search } = req.query;
    const conditions = [];
    const params = [];

    if (active === 'true') {
      conditions.push('d.is_active = TRUE');
    } else if (active === 'false') {
      conditions.push('d.is_active = FALSE');
    }

    if (search && typeof search === 'string' && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`LOWER(d.name) LIKE $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT d.id, d.name, d.description, d.is_active, d.created_at, d.updated_at,
        (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.department)) = LOWER(TRIM(d.name))) AS employee_count
      FROM public.organization_departments d
      ${whereClause}
      ORDER BY d.is_active DESC, d.name ASC
    `, params);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

const createDepartment = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Department name is required.',
      });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Department name cannot exceed 200 characters.',
      });
    }

    const trimmedDesc = description && typeof description === 'string' ? description.trim() : null;

    // Check duplicate
    const checkDup = await pool.query(
      'SELECT id FROM public.organization_departments WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [trimmedName]
    );
    if (checkDup.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A department with this name already exists.',
      });
    }

    const insertRes = await pool.query(`
      INSERT INTO public.organization_departments (name, description, created_by, updated_by)
      VALUES ($1, $2, $3, $3)
      RETURNING id, name, description, is_active, created_at, updated_at
    `, [trimmedName, trimmedDesc, req.user?.id || null]);

    const created = insertRes.rows[0];

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'DEPARTMENT_CREATED',
      entityType: 'ORGANIZATION_DEPARTMENT',
      entityId: String(created.id),
      metadata: {
        department_id: created.id,
        department_name: created.name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Department created successfully.',
      data: { ...created, employee_count: 0 },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A department with this name already exists.',
      });
    }
    next(error);
  }
};

const updateDepartment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name, description, is_active FROM public.organization_departments WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Department not found.',
      });
    }

    const existingRow = existingRes.rows[0];
    let newName = existingRow.name;
    let newDesc = existingRow.description;
    let newActive = existingRow.is_active;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Department name cannot be empty.',
        });
      }
      const trimmed = name.trim();
      if (trimmed.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Department name cannot exceed 200 characters.',
        });
      }
      // Check collision
      const checkDup = await pool.query(
        'SELECT id FROM public.organization_departments WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id != $2::uuid',
        [trimmed, id]
      );
      if (checkDup.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'A department with this name already exists.',
        });
      }
      newName = trimmed;
    }

    if (description !== undefined) {
      newDesc = description && typeof description === 'string' ? description.trim() : null;
    }

    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'is_active must be a boolean.',
        });
      }
      if (is_active === true) {
        const legacyNames = ['engineering', 'finance', 'human resources', 'marketing', 'operations', 'sales', 'technology'];
        if (legacyNames.includes(existingRow.name.trim().toLowerCase())) {
          return res.status(400).json({
            success: false,
            message: "Legacy departments cannot be reactivated. Organization policy strictly permits only 'IT' and 'Non-IT' as active department categories.",
          });
        }
      }
      newActive = is_active;
    }

    const updateRes = await pool.query(`
      UPDATE public.organization_departments
      SET name = $1, description = $2, is_active = $3, updated_at = NOW(), updated_by = $4
      WHERE id = $5::uuid
      RETURNING id, name, description, is_active, created_at, updated_at
    `, [newName, newDesc, newActive, req.user?.id || null, id]);

    const updated = updateRes.rows[0];

    // Determine audit action
    const auditAction = (existingRow.is_active === true && newActive === false)
      ? 'DEPARTMENT_DEACTIVATED'
      : 'DEPARTMENT_UPDATED';

    await recordAuditLog({
      userId: req.user?.id || null,
      action: auditAction,
      entityType: 'ORGANIZATION_DEPARTMENT',
      entityId: String(updated.id),
      metadata: {
        department_id: updated.id,
        department_name: updated.name,
        is_active: updated.is_active,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    // Get current usage count
    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(department)) = LOWER(TRIM($1))',
      [updated.name]
    );

    return res.status(200).json({
      success: true,
      message: 'Department updated successfully.',
      data: { ...updated, employee_count: countRes.rows[0].count },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A department with this name already exists.',
      });
    }
    next(error);
  }
};

const deleteDepartment = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name FROM public.organization_departments WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Department not found.',
      });
    }

    const dept = existingRes.rows[0];

    // Check usage in employees
    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(department)) = LOWER(TRIM($1))',
      [dept.name]
    );
    const count = countRes.rows[0].count;

    if (count > 0) {
      return res.status(409).json({
        success: false,
        message: `This department is currently assigned to ${count} employee(s) and cannot be deleted. Deactivate it instead.`,
        employee_count: count,
      });
    }

    await pool.query('DELETE FROM public.organization_departments WHERE id = $1::uuid', [id]);

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'DEPARTMENT_DELETED',
      entityType: 'ORGANIZATION_DEPARTMENT',
      entityId: String(dept.id),
      metadata: {
        department_id: dept.id,
        department_name: dept.name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Department deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// 2. DESIGNATIONS
// -----------------------------------------------------------------------------
const getDesignations = async (req, res, next) => {
  try {
    const { active, search } = req.query;
    const conditions = [];
    const params = [];

    if (active === 'true') {
      conditions.push('d.is_active = TRUE');
    } else if (active === 'false') {
      conditions.push('d.is_active = FALSE');
    }

    if (search && typeof search === 'string' && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`LOWER(d.name) LIKE $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT d.id, d.name, d.description, d.is_active, d.created_at, d.updated_at,
        (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.designation)) = LOWER(TRIM(d.name))) AS employee_count
      FROM public.organization_designations d
      ${whereClause}
      ORDER BY d.name ASC
    `, params);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

const createDesignation = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Designation name is required.',
      });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Designation name cannot exceed 200 characters.',
      });
    }

    const trimmedDesc = description && typeof description === 'string' ? description.trim() : null;

    const checkDup = await pool.query(
      'SELECT id FROM public.organization_designations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [trimmedName]
    );
    if (checkDup.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A designation with this name already exists.',
      });
    }

    const insertRes = await pool.query(`
      INSERT INTO public.organization_designations (name, description, created_by, updated_by)
      VALUES ($1, $2, $3, $3)
      RETURNING id, name, description, is_active, created_at, updated_at
    `, [trimmedName, trimmedDesc, req.user?.id || null]);

    const created = insertRes.rows[0];

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'DESIGNATION_CREATED',
      entityType: 'ORGANIZATION_DESIGNATION',
      entityId: String(created.id),
      metadata: {
        designation_id: created.id,
        designation_name: created.name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Designation created successfully.',
      data: { ...created, employee_count: 0 },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A designation with this name already exists.',
      });
    }
    next(error);
  }
};

const updateDesignation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid designation ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name, description, is_active FROM public.organization_designations WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Designation not found.',
      });
    }

    const existingRow = existingRes.rows[0];
    let newName = existingRow.name;
    let newDesc = existingRow.description;
    let newActive = existingRow.is_active;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Designation name cannot be empty.',
        });
      }
      const trimmed = name.trim();
      if (trimmed.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Designation name cannot exceed 200 characters.',
        });
      }
      const checkDup = await pool.query(
        'SELECT id FROM public.organization_designations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id != $2::uuid',
        [trimmed, id]
      );
      if (checkDup.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'A designation with this name already exists.',
        });
      }
      newName = trimmed;
    }

    if (description !== undefined) {
      newDesc = description && typeof description === 'string' ? description.trim() : null;
    }

    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'is_active must be a boolean.',
        });
      }
      newActive = is_active;
    }

    const updateRes = await pool.query(`
      UPDATE public.organization_designations
      SET name = $1, description = $2, is_active = $3, updated_at = NOW(), updated_by = $4
      WHERE id = $5::uuid
      RETURNING id, name, description, is_active, created_at, updated_at
    `, [newName, newDesc, newActive, req.user?.id || null, id]);

    const updated = updateRes.rows[0];

    const auditAction = (existingRow.is_active === true && newActive === false)
      ? 'DESIGNATION_DEACTIVATED'
      : 'DESIGNATION_UPDATED';

    await recordAuditLog({
      userId: req.user?.id || null,
      action: auditAction,
      entityType: 'ORGANIZATION_DESIGNATION',
      entityId: String(updated.id),
      metadata: {
        designation_id: updated.id,
        designation_name: updated.name,
        is_active: updated.is_active,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(designation)) = LOWER(TRIM($1))',
      [updated.name]
    );

    return res.status(200).json({
      success: true,
      message: 'Designation updated successfully.',
      data: { ...updated, employee_count: countRes.rows[0].count },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A designation with this name already exists.',
      });
    }
    next(error);
  }
};

const deleteDesignation = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid designation ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name FROM public.organization_designations WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Designation not found.',
      });
    }

    const desig = existingRes.rows[0];

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(designation)) = LOWER(TRIM($1))',
      [desig.name]
    );
    const count = countRes.rows[0].count;

    if (count > 0) {
      return res.status(409).json({
        success: false,
        message: `This designation is currently assigned to ${count} employee(s) and cannot be deleted. Deactivate it instead.`,
        employee_count: count,
      });
    }

    await pool.query('DELETE FROM public.organization_designations WHERE id = $1::uuid', [id]);

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'DESIGNATION_DELETED',
      entityType: 'ORGANIZATION_DESIGNATION',
      entityId: String(desig.id),
      metadata: {
        designation_id: desig.id,
        designation_name: desig.name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Designation deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// 3. EMPLOYMENT TYPES
// -----------------------------------------------------------------------------
const getEmploymentTypes = async (req, res, next) => {
  try {
    const { active, search } = req.query;
    const conditions = [];
    const params = [];

    if (active === 'true') {
      conditions.push('et.is_active = TRUE');
    } else if (active === 'false') {
      conditions.push('et.is_active = FALSE');
    }

    if (search && typeof search === 'string' && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`LOWER(et.name) LIKE $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT et.id, et.name, et.description, et.is_active, et.created_at, et.updated_at,
        (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.employment_type)) = LOWER(TRIM(et.name))) AS employee_count
      FROM public.organization_employment_types et
      ${whereClause}
      ORDER BY et.name ASC
    `, params);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

const createEmploymentType = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Employment type name is required.',
      });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Employment type name cannot exceed 100 characters.',
      });
    }

    const trimmedDesc = description && typeof description === 'string' ? description.trim() : null;

    const checkDup = await pool.query(
      'SELECT id FROM public.organization_employment_types WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [trimmedName]
    );
    if (checkDup.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An employment type with this name already exists.',
      });
    }

    const insertRes = await pool.query(`
      INSERT INTO public.organization_employment_types (name, description, created_by, updated_by)
      VALUES ($1, $2, $3, $3)
      RETURNING id, name, description, is_active, created_at, updated_at
    `, [trimmedName, trimmedDesc, req.user?.id || null]);

    const created = insertRes.rows[0];

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'EMPLOYMENT_TYPE_CREATED',
      entityType: 'ORGANIZATION_EMPLOYMENT_TYPE',
      entityId: String(created.id),
      metadata: {
        employment_type_id: created.id,
        employment_type_name: created.name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Employment type created successfully.',
      data: { ...created, employee_count: 0 },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'An employment type with this name already exists.',
      });
    }
    next(error);
  }
};

const updateEmploymentType = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid employment type ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name, description, is_active FROM public.organization_employment_types WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employment type not found.',
      });
    }

    const existingRow = existingRes.rows[0];
    let newName = existingRow.name;
    let newDesc = existingRow.description;
    let newActive = existingRow.is_active;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Employment type name cannot be empty.',
        });
      }
      const trimmed = name.trim();
      if (trimmed.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Employment type name cannot exceed 100 characters.',
        });
      }
      const checkDup = await pool.query(
        'SELECT id FROM public.organization_employment_types WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id != $2::uuid',
        [trimmed, id]
      );
      if (checkDup.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'An employment type with this name already exists.',
        });
      }
      newName = trimmed;
    }

    if (description !== undefined) {
      newDesc = description && typeof description === 'string' ? description.trim() : null;
    }

    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'is_active must be a boolean.',
        });
      }
      newActive = is_active;
    }

    const updateRes = await pool.query(`
      UPDATE public.organization_employment_types
      SET name = $1, description = $2, is_active = $3, updated_at = NOW(), updated_by = $4
      WHERE id = $5::uuid
      RETURNING id, name, description, is_active, created_at, updated_at
    `, [newName, newDesc, newActive, req.user?.id || null, id]);

    const updated = updateRes.rows[0];

    const auditAction = (existingRow.is_active === true && newActive === false)
      ? 'EMPLOYMENT_TYPE_DEACTIVATED'
      : 'EMPLOYMENT_TYPE_UPDATED';

    await recordAuditLog({
      userId: req.user?.id || null,
      action: auditAction,
      entityType: 'ORGANIZATION_EMPLOYMENT_TYPE',
      entityId: String(updated.id),
      metadata: {
        employment_type_id: updated.id,
        employment_type_name: updated.name,
        is_active: updated.is_active,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(employment_type)) = LOWER(TRIM($1))',
      [updated.name]
    );

    return res.status(200).json({
      success: true,
      message: 'Employment type updated successfully.',
      data: { ...updated, employee_count: countRes.rows[0].count },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'An employment type with this name already exists.',
      });
    }
    next(error);
  }
};

const deleteEmploymentType = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid employment type ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name FROM public.organization_employment_types WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employment type not found.',
      });
    }

    const et = existingRes.rows[0];

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(employment_type)) = LOWER(TRIM($1))',
      [et.name]
    );
    const count = countRes.rows[0].count;

    if (count > 0) {
      return res.status(409).json({
        success: false,
        message: `This employment type is currently assigned to ${count} employee(s) and cannot be deleted. Deactivate it instead.`,
        employee_count: count,
      });
    }

    await pool.query('DELETE FROM public.organization_employment_types WHERE id = $1::uuid', [id]);

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'EMPLOYMENT_TYPE_DELETED',
      entityType: 'ORGANIZATION_EMPLOYMENT_TYPE',
      entityId: String(et.id),
      metadata: {
        employment_type_id: et.id,
        employment_type_name: et.name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Employment type deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// 4. WORK LOCATIONS
// -----------------------------------------------------------------------------
const getWorkLocations = async (req, res, next) => {
  try {
    const { active, search } = req.query;
    const conditions = [];
    const params = [];

    if (active === 'true') {
      conditions.push('l.is_active = TRUE');
    } else if (active === 'false') {
      conditions.push('l.is_active = FALSE');
    }

    if (search && typeof search === 'string' && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`(LOWER(l.name) LIKE $${params.length} OR LOWER(COALESCE(l.city, '')) LIKE $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT l.id, l.name, l.address, l.city, l.state, l.country, l.description, l.is_active, l.created_at, l.updated_at,
        (SELECT COUNT(*)::int FROM public.employees e WHERE LOWER(TRIM(e.work_location)) = LOWER(TRIM(l.name))) AS employee_count
      FROM public.organization_work_locations l
      ${whereClause}
      ORDER BY l.name ASC
    `, params);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

const createWorkLocation = async (req, res, next) => {
  try {
    const { name, address, city, state, country, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Work location name is required.',
      });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Work location name cannot exceed 200 characters.',
      });
    }

    const trimmedAddress = address && typeof address === 'string' ? address.trim() : null;
    const trimmedCity = city && typeof city === 'string' ? city.trim() : null;
    const trimmedState = state && typeof state === 'string' ? state.trim() : null;
    const trimmedCountry = country && typeof country === 'string' ? country.trim() : 'India';
    const trimmedDesc = description && typeof description === 'string' ? description.trim() : null;

    const checkDup = await pool.query(
      'SELECT id FROM public.organization_work_locations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
      [trimmedName]
    );
    if (checkDup.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A work location with this name already exists.',
      });
    }

    const insertRes = await pool.query(`
      INSERT INTO public.organization_work_locations (name, address, city, state, country, description, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      RETURNING id, name, address, city, state, country, description, is_active, created_at, updated_at
    `, [trimmedName, trimmedAddress, trimmedCity, trimmedState, trimmedCountry, trimmedDesc, req.user?.id || null]);

    const created = insertRes.rows[0];

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'WORK_LOCATION_CREATED',
      entityType: 'ORGANIZATION_WORK_LOCATION',
      entityId: String(created.id),
      metadata: {
        location_id: created.id,
        location_name: created.name,
        city: created.city,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Work location created successfully.',
      data: { ...created, employee_count: 0 },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A work location with this name already exists.',
      });
    }
    next(error);
  }
};

const updateWorkLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, address, city, state, country, description, is_active } = req.body;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid work location ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name, address, city, state, country, description, is_active FROM public.organization_work_locations WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work location not found.',
      });
    }

    const existingRow = existingRes.rows[0];
    let newName = existingRow.name;
    let newAddr = existingRow.address;
    let newCity = existingRow.city;
    let newState = existingRow.state;
    let newCountry = existingRow.country;
    let newDesc = existingRow.description;
    let newActive = existingRow.is_active;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Work location name cannot be empty.',
        });
      }
      const trimmed = name.trim();
      if (trimmed.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Work location name cannot exceed 200 characters.',
        });
      }
      const checkDup = await pool.query(
        'SELECT id FROM public.organization_work_locations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id != $2::uuid',
        [trimmed, id]
      );
      if (checkDup.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'A work location with this name already exists.',
        });
      }
      newName = trimmed;
    }

    if (address !== undefined) newAddr = address && typeof address === 'string' ? address.trim() : null;
    if (city !== undefined) newCity = city && typeof city === 'string' ? city.trim() : null;
    if (state !== undefined) newState = state && typeof state === 'string' ? state.trim() : null;
    if (country !== undefined) newCountry = country && typeof country === 'string' ? country.trim() : 'India';
    if (description !== undefined) newDesc = description && typeof description === 'string' ? description.trim() : null;

    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'is_active must be a boolean.',
        });
      }
      newActive = is_active;
    }

    const updateRes = await pool.query(`
      UPDATE public.organization_work_locations
      SET name = $1, address = $2, city = $3, state = $4, country = $5, description = $6, is_active = $7, updated_at = NOW(), updated_by = $8
      WHERE id = $9::uuid
      RETURNING id, name, address, city, state, country, description, is_active, created_at, updated_at
    `, [newName, newAddr, newCity, newState, newCountry, newDesc, newActive, req.user?.id || null, id]);

    const updated = updateRes.rows[0];

    const auditAction = (existingRow.is_active === true && newActive === false)
      ? 'WORK_LOCATION_DEACTIVATED'
      : 'WORK_LOCATION_UPDATED';

    await recordAuditLog({
      userId: req.user?.id || null,
      action: auditAction,
      entityType: 'ORGANIZATION_WORK_LOCATION',
      entityId: String(updated.id),
      metadata: {
        location_id: updated.id,
        location_name: updated.name,
        is_active: updated.is_active,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(work_location)) = LOWER(TRIM($1))',
      [updated.name]
    );

    return res.status(200).json({
      success: true,
      message: 'Work location updated successfully.',
      data: { ...updated, employee_count: countRes.rows[0].count },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A work location with this name already exists.',
      });
    }
    next(error);
  }
};

const deleteWorkLocation = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid work location ID format. Must be a valid UUID.',
      });
    }

    const existingRes = await pool.query(
      'SELECT id, name FROM public.organization_work_locations WHERE id = $1::uuid',
      [id]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work location not found.',
      });
    }

    const loc = existingRes.rows[0];

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM public.employees WHERE LOWER(TRIM(work_location)) = LOWER(TRIM($1))',
      [loc.name]
    );
    const count = countRes.rows[0].count;

    if (count > 0) {
      return res.status(409).json({
        success: false,
        message: `This work location is currently assigned to ${count} employee(s) and cannot be deleted. Deactivate it instead.`,
        employee_count: count,
      });
    }

    await pool.query('DELETE FROM public.organization_work_locations WHERE id = $1::uuid', [id]);

    await recordAuditLog({
      userId: req.user?.id || null,
      action: 'WORK_LOCATION_DELETED',
      entityType: 'ORGANIZATION_WORK_LOCATION',
      entityId: String(loc.id),
      metadata: {
        location_id: loc.id,
        location_name: loc.name,
        admin_email: req.user?.email || 'unknown',
        timestamp: new Date().toISOString(),
      },
      req,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Work location deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOrganizationSettings,
  updateOrganizationSettings,
  getWorkAttendanceSettings,
  updateWorkAttendanceSettings,
  getLeaveSettings,
  updateLeaveSettings,
  getHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  getEmployeeConfiguration,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDesignations,
  createDesignation,
  updateDesignation,
  deleteDesignation,
  getEmploymentTypes,
  createEmploymentType,
  updateEmploymentType,
  deleteEmploymentType,
  getWorkLocations,
  createWorkLocation,
  updateWorkLocation,
  deleteWorkLocation,
};


