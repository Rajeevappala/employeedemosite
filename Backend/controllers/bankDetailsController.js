const pool = require('../config/database');
const {
  encryptAccountNumber,
  decryptAccountNumber,
  maskAccountNumber,
  isValidIFSC,
  isValidAccountNumber,
} = require('../services/bankEncryptionService');
const { recordAuditLog } = require('../services/auditService');

const APPROVED_BANKS = ['IDFC Bank'];
const DEFAULT_BANK = 'IDFC Bank';
const VALID_ACCOUNT_TYPES = ['Savings', 'Current', 'Salary'];
const VALID_VERIFICATION_STATUSES = ['Pending', 'Verified', 'Rejected'];

/**
 * Controller to fetch the authenticated employee's bank details.
 * Security: Identity derived strictly from req.user.employee_id.
 * Account number is strictly masked.
 */
const getEmployeeBankDetails = async (req, res, next) => {
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
        id,
        employee_id,
        account_holder_name,
        bank_name,
        account_number_last4,
        ifsc_code,
        branch_name,
        branch_city,
        branch_state,
        account_type,
        verification_status,
        admin_remarks,
        created_at,
        updated_at
      FROM public.employee_bank_details
      WHERE employee_id = $1
    `;

    const result = await pool.query(query, [employeeId]);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        employee_id: row.employee_id,
        account_holder_name: row.account_holder_name,
        bank_name: row.bank_name,
        account_number: maskAccountNumber(row.account_number_last4),
        account_number_last4: row.account_number_last4,
        ifsc_code: row.ifsc_code,
        branch_name: row.branch_name,
        branch_city: row.branch_city,
        branch_state: row.branch_state,
        account_type: row.account_type,
        verification_status: row.verification_status,
        admin_remarks: row.admin_remarks,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to submit or update the authenticated employee's bank details.
 * Security:
 * - Identity derived strictly from req.user.employee_id.
 * - Confirms matching account numbers if confirmation is provided.
 * - Encrypts account number at rest with AES-256-GCM.
 * - Never logs plaintext account numbers or returns them in response.
 */
const saveEmployeeBankDetails = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;

    if (!employeeId) {
      return res.status(403).json({
        success: false,
        message: 'No employee profile is associated with this authenticated account.',
      });
    }

    const {
      account_holder_name,
      bank_name,
      account_number,
      confirm_account_number,
      ifsc_code,
      branch_name,
      branch_city,
      branch_state,
      account_type,
    } = req.body || {};

    // Check if an existing bank record already exists
    const existingResult = await pool.query(
      `SELECT * FROM public.employee_bank_details WHERE employee_id = $1`,
      [employeeId]
    );
    const existing = existingResult.rows[0] || null;

    // 1. Validate Account Holder Name
    let sanitizedHolderName = existing ? existing.account_holder_name : '';
    if (account_holder_name !== undefined) {
      if (!account_holder_name || typeof account_holder_name !== 'string' || account_holder_name.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Account Holder Name is required.',
        });
      }
      sanitizedHolderName = account_holder_name.trim().substring(0, 255);
    } else if (!existing) {
      return res.status(400).json({
        success: false,
        message: 'Account Holder Name is required.',
      });
    }

    // 2. Validate Bank Name (dropdown)
    // For new records without a bank provided: defaults to IDFC Bank.
    // For existing records: preserves existing bank unless explicitly provided.
    let sanitizedBankName = existing ? existing.bank_name : DEFAULT_BANK;
    if (bank_name !== undefined && String(bank_name).trim() !== '') {
      sanitizedBankName = String(bank_name).trim().substring(0, 100);
    } else if (!existing) {
      sanitizedBankName = DEFAULT_BANK;
    }

    // 3. Validate Account Number & Confirmation
    let sanitizedEncryptedAccount = existing ? existing.account_number_encrypted : null;
    let sanitizedLast4 = existing ? existing.account_number_last4 : null;
    let accountUpdated = false;

    if (account_number !== undefined && String(account_number).trim() !== '') {
      const rawAccount = String(account_number).trim();

      // Check if user re-submitted the masked value; if so, keep existing
      if (rawAccount.startsWith('••••') || rawAccount.includes('•')) {
        if (!existing) {
          return res.status(400).json({
            success: false,
            message: 'A valid full account number is required.',
          });
        }
        // Retain existing encryption
      } else {
        if (!isValidAccountNumber(rawAccount)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid account number. Account number must contain 9 to 18 digits.',
          });
        }

        const rawConfirm = confirm_account_number !== undefined ? String(confirm_account_number).trim() : '';
        if (!rawConfirm) {
          return res.status(400).json({
            success: false,
            message: 'Please confirm the account number.',
          });
        }
        if (rawAccount !== rawConfirm) {
          return res.status(400).json({
            success: false,
            message: 'Account numbers do not match. Please verify and re-enter.',
          });
        }

        sanitizedEncryptedAccount = encryptAccountNumber(rawAccount);
        sanitizedLast4 = rawAccount.slice(-4);
        accountUpdated = true;
      }
    } else if (!existing) {
      return res.status(400).json({
        success: false,
        message: 'Account number is required.',
      });
    }

    // 4. Validate IFSC Code
    let sanitizedIFSC = existing ? existing.ifsc_code : '';
    if (ifsc_code !== undefined && String(ifsc_code).trim() !== '') {
      const rawIFSC = String(ifsc_code).trim().toUpperCase();
      if (!isValidIFSC(rawIFSC)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid IFSC code format. IFSC must be 11 characters (e.g., IDFB0040101).',
        });
      }
      sanitizedIFSC = rawIFSC;
    } else if (!existing) {
      return res.status(400).json({
        success: false,
        message: 'IFSC Code is required.',
      });
    }

    // 5. Validate Account Type
    let sanitizedAccountType = existing ? existing.account_type : 'Savings';
    if (account_type !== undefined && String(account_type).trim() !== '') {
      const trimmedType = String(account_type).trim();
      if (!VALID_ACCOUNT_TYPES.includes(trimmedType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid account type. Allowed types are: ${VALID_ACCOUNT_TYPES.join(', ')}.`,
        });
      }
      sanitizedAccountType = trimmedType;
    }

    // Optional fields: branch_name, branch_city, branch_state
    let sanitizedBranchName = existing ? existing.branch_name : null;
    if (branch_name !== undefined) {
      sanitizedBranchName = branch_name ? String(branch_name).trim().substring(0, 150) : null;
    }

    let sanitizedBranchCity = existing ? existing.branch_city : null;
    if (branch_city !== undefined) {
      sanitizedBranchCity = branch_city ? String(branch_city).trim().substring(0, 100) : null;
    }

    let sanitizedBranchState = existing ? existing.branch_state : null;
    if (branch_state !== undefined) {
      sanitizedBranchState = branch_state ? String(branch_state).trim().substring(0, 100) : null;
    }

    // When employee submits or modifies bank details, set verification status to 'Pending'
    const newVerificationStatus = 'Pending';
    const isNew = !existing;

    let savedRow;
    if (isNew) {
      const insertQuery = `
        INSERT INTO public.employee_bank_details (
          employee_id,
          account_holder_name,
          bank_name,
          account_number_encrypted,
          account_number_last4,
          ifsc_code,
          branch_name,
          branch_city,
          branch_state,
          account_type,
          verification_status,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
        RETURNING *;
      `;

      const insertResult = await pool.query(insertQuery, [
        employeeId,
        sanitizedHolderName,
        sanitizedBankName,
        sanitizedEncryptedAccount,
        sanitizedLast4,
        sanitizedIFSC,
        sanitizedBranchName,
        sanitizedBranchCity,
        sanitizedBranchState,
        sanitizedAccountType,
        newVerificationStatus,
        req.user.id || null,
      ]);
      savedRow = insertResult.rows[0];

      await recordAuditLog({
        userId: req.user.id,
        action: 'BANK_DETAILS_SUBMITTED',
        entityType: 'BANK_DETAILS',
        entityId: savedRow.id,
        metadata: {
          employee_id: employeeId,
          bank_name: sanitizedBankName,
          verification_status: newVerificationStatus,
        },
        req,
      });
    } else {
      const updateQuery = `
        UPDATE public.employee_bank_details
        SET
          account_holder_name = $1,
          bank_name = $2,
          account_number_encrypted = $3,
          account_number_last4 = $4,
          ifsc_code = $5,
          branch_name = $6,
          branch_city = $7,
          branch_state = $8,
          account_type = $9,
          verification_status = $10,
          updated_at = NOW(),
          updated_by = $11
        WHERE employee_id = $12
        RETURNING *;
      `;

      const updateResult = await pool.query(updateQuery, [
        sanitizedHolderName,
        sanitizedBankName,
        sanitizedEncryptedAccount,
        sanitizedLast4,
        sanitizedIFSC,
        sanitizedBranchName,
        sanitizedBranchCity,
        sanitizedBranchState,
        sanitizedAccountType,
        newVerificationStatus,
        req.user.id || null,
        employeeId,
      ]);
      savedRow = updateResult.rows[0];

      await recordAuditLog({
        userId: req.user.id,
        action: 'BANK_DETAILS_UPDATED',
        entityType: 'BANK_DETAILS',
        entityId: savedRow.id,
        metadata: {
          employee_id: employeeId,
          bank_name: sanitizedBankName,
          account_updated: accountUpdated,
          verification_status: newVerificationStatus,
        },
        req,
      });
    }

    return res.status(isNew ? 201 : 200).json({
      success: true,
      message: isNew
        ? 'Bank details submitted successfully and queued for verification.'
        : 'Bank details updated successfully and queued for re-verification.',
      data: {
        id: savedRow.id,
        employee_id: savedRow.employee_id,
        account_holder_name: savedRow.account_holder_name,
        bank_name: savedRow.bank_name,
        account_number: maskAccountNumber(savedRow.account_number_last4),
        account_number_last4: savedRow.account_number_last4,
        ifsc_code: savedRow.ifsc_code,
        branch_name: savedRow.branch_name,
        branch_city: savedRow.branch_city,
        branch_state: savedRow.branch_state,
        account_type: savedRow.account_type,
        verification_status: savedRow.verification_status,
        admin_remarks: savedRow.admin_remarks,
        created_at: savedRow.created_at,
        updated_at: savedRow.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for Admin to view an employee's bank details.
 * Security: Restricted to ADMIN role.
 * Account number is strictly masked.
 */
const getAdminEmployeeBankDetails = async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    // RBAC: strictly verify user role
    if (!req.user || req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Administrator privileges required.',
      });
    }

    if (!employeeId || typeof employeeId !== 'string' || employeeId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing employee ID parameter.',
      });
    }

    const sanitizedEmployeeId = employeeId.trim();

    // Verify employee exists
    const empCheck = await pool.query(
      `SELECT employee_id, first_name, last_name FROM public.employees WHERE employee_id = $1`,
      [sanitizedEmployeeId]
    );

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found.',
      });
    }

    const query = `
      SELECT 
        b.id,
        b.employee_id,
        b.account_holder_name,
        b.bank_name,
        b.account_number_encrypted,
        b.account_number_last4,
        b.ifsc_code,
        b.branch_name,
        b.branch_city,
        b.branch_state,
        b.account_type,
        b.verification_status,
        b.admin_remarks,
        b.created_at,
        b.updated_at,
        u.email AS updated_by_email
      FROM public.employee_bank_details b
      LEFT JOIN public.users u ON b.updated_by = u.id
      WHERE b.employee_id = $1
    `;

    const result = await pool.query(query, [sanitizedEmployeeId]);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    const row = result.rows[0];

    // Decrypt complete account number for authorized administrator review
    let decryptedAccountNumber = null;
    let decryptionFailed = false;
    if (row.account_number_encrypted) {
      try {
        decryptedAccountNumber = decryptAccountNumber(row.account_number_encrypted);
      } catch (decErr) {
        decryptionFailed = true;
      }
    } else {
      decryptionFailed = true;
    }

    if (decryptionFailed || !decryptedAccountNumber) {
      return res.status(200).json({
        success: true,
        data: {
          id: row.id,
          employee_id: row.employee_id,
          account_holder_name: row.account_holder_name,
          bank_name: row.bank_name,
          account_number: null,
          account_number_error: 'Unable to load the full account number. Please retry.',
          account_number_last4: row.account_number_last4,
          ifsc_code: row.ifsc_code,
          branch_name: row.branch_name,
          branch_city: row.branch_city,
          branch_state: row.branch_state,
          account_type: row.account_type,
          verification_status: row.verification_status,
          admin_remarks: row.admin_remarks,
          created_at: row.created_at,
          updated_at: row.updated_at,
          updated_by_email: row.updated_by_email,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        employee_id: row.employee_id,
        account_holder_name: row.account_holder_name,
        bank_name: row.bank_name,
        account_number: decryptedAccountNumber,
        account_number_last4: row.account_number_last4,
        ifsc_code: row.ifsc_code,
        branch_name: row.branch_name,
        branch_city: row.branch_city,
        branch_state: row.branch_state,
        account_type: row.account_type,
        verification_status: row.verification_status,
        admin_remarks: row.admin_remarks,
        created_at: row.created_at,
        updated_at: row.updated_at,
        updated_by_email: row.updated_by_email,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller for Admin to review and verify/reject employee bank details.
 * Security: Restricted to ADMIN role.
 */
const verifyAdminEmployeeBankDetails = async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId || typeof employeeId !== 'string' || employeeId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing employee ID parameter.',
      });
    }

    const sanitizedEmployeeId = employeeId.trim();
    const { verification_status, admin_remarks } = req.body || {};

    if (!verification_status || !VALID_VERIFICATION_STATUSES.includes(verification_status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid verification status. Allowed statuses are: ${VALID_VERIFICATION_STATUSES.join(', ')}.`,
      });
    }

    const existingCheck = await pool.query(
      `SELECT id, bank_name, verification_status FROM public.employee_bank_details WHERE employee_id = $1`,
      [sanitizedEmployeeId]
    );

    if (existingCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No bank details found for this employee to review.',
      });
    }

    const sanitizedRemarks = admin_remarks ? String(admin_remarks).trim().substring(0, 500) : null;

    const updateQuery = `
      UPDATE public.employee_bank_details
      SET 
        verification_status = $1,
        admin_remarks = $2,
        updated_at = NOW(),
        updated_by = $3
      WHERE employee_id = $4
      RETURNING *;
    `;

    const updateResult = await pool.query(updateQuery, [
      verification_status,
      sanitizedRemarks,
      req.user.id || null,
      sanitizedEmployeeId,
    ]);

    const updatedRow = updateResult.rows[0];

    // Record audit log
    await recordAuditLog({
      userId: req.user.id,
      action: 'BANK_DETAILS_VERIFIED',
      entityType: 'BANK_DETAILS',
      entityId: updatedRow.id,
      metadata: {
        employee_id: sanitizedEmployeeId,
        previous_status: existingCheck.rows[0].verification_status,
        new_status: verification_status,
        admin_remarks: sanitizedRemarks,
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Bank details marked as ${verification_status}.`,
      data: {
        id: updatedRow.id,
        employee_id: updatedRow.employee_id,
        account_holder_name: updatedRow.account_holder_name,
        bank_name: updatedRow.bank_name,
        account_number: maskAccountNumber(updatedRow.account_number_last4),
        account_number_last4: updatedRow.account_number_last4,
        ifsc_code: updatedRow.ifsc_code,
        branch_name: updatedRow.branch_name,
        branch_city: updatedRow.branch_city,
        branch_state: updatedRow.branch_state,
        account_type: updatedRow.account_type,
        verification_status: updatedRow.verification_status,
        admin_remarks: updatedRow.admin_remarks,
        created_at: updatedRow.created_at,
        updated_at: updatedRow.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEmployeeBankDetails,
  saveEmployeeBankDetails,
  getAdminEmployeeBankDetails,
  verifyAdminEmployeeBankDetails,
  APPROVED_BANKS,
  DEFAULT_BANK,
};
