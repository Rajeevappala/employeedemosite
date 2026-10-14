const pool = require('../config/database');

/**
 * Controller to list employee PF records with server-side search, status filter,
 * department filter, and pagination.
 *
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Sourced strictly from public.employees and public.pf_details.
 * - Sourced from real database columns without fabricating data.
 */
const getAdminPfList = async (req, res, next) => {
  try {
    const { search, status, department } = req.query;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const conditions = ["e.status = 'ACTIVE'"];
    const queryParams = [];

    // Filter: search (matches employee name, employee ID, UAN, or PF number)
    if (search !== undefined && search !== null && String(search).trim() !== '') {
      const trimmedSearch = String(search).trim();
      queryParams.push(`%${trimmedSearch}%`);
      const pIdx = queryParams.length;
      conditions.push(`(
        e.first_name ILIKE $${pIdx} OR
        e.last_name ILIKE $${pIdx} OR
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) ILIKE $${pIdx} OR
        e.employee_id ILIKE $${pIdx} OR
        pd.uan_number ILIKE $${pIdx} OR
        pd.pf_number ILIKE $${pIdx}
      )`);
    }

    // Filter: status ('Active', 'Pending', 'Not Available', or 'All')
    if (status !== undefined && status !== null && String(status).trim() !== '' && String(status).trim() !== 'All') {
      const trimmedStatus = String(status).trim();
      if (trimmedStatus === 'Active') {
        conditions.push(`(pd.uan_number IS NOT NULL AND pd.uan_number != '' AND pd.pf_number IS NOT NULL AND pd.pf_number != '')`);
      } else if (trimmedStatus === 'Pending') {
        conditions.push(`(
          (pd.uan_number IS NOT NULL AND pd.uan_number != '' AND (pd.pf_number IS NULL OR pd.pf_number = '')) OR
          (pd.pf_number IS NOT NULL AND pd.pf_number != '' AND (pd.uan_number IS NULL OR pd.uan_number = ''))
        )`);
      } else if (trimmedStatus === 'Not Available') {
        conditions.push(`(pd.id IS NULL OR (
          (pd.uan_number IS NULL OR pd.uan_number = '') AND
          (pd.pf_number IS NULL OR pd.pf_number = '')
        ))`);
      }
    }

    // Filter: department
    if (department !== undefined && department !== null && String(department).trim() !== '' && String(department).trim() !== 'All' && String(department).trim() !== 'All Departments') {
      queryParams.push(String(department).trim());
      const pIdx = queryParams.length;
      conditions.push(`e.department ILIKE $${pIdx}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countQuery = `
      SELECT COUNT(e.employee_id) AS total
      FROM public.employees e
      LEFT JOIN public.pf_details pd ON pd.employee_id = e.employee_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;

    // Data query
    const dataQueryParams = [...queryParams, limit, offset];
    const limitIdx = dataQueryParams.length - 1;
    const offsetIdx = dataQueryParams.length;

    const dataQuery = `
      SELECT
        e.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.email,
        e.department,
        e.designation,
        e.status AS employee_status,
        TO_CHAR(e.created_at, 'YYYY-MM-DD') AS date_of_joining,
        pd.id AS pf_id,
        pd.uan_number,
        pd.pf_number,
        pd.pension_number,
        pd.employee_contribution,
        pd.employer_contribution,
        TO_CHAR(pd.created_at, 'DD Month YYYY') AS pf_created_formatted,
        TO_CHAR(pd.updated_at, 'DD Month YYYY') AS pf_updated_formatted,
        pd.created_at AS pf_created_at,
        pd.updated_at AS pf_updated_at,
        CASE
          WHEN pd.uan_number IS NOT NULL AND pd.uan_number != '' AND pd.pf_number IS NOT NULL AND pd.pf_number != '' THEN 'Active'
          WHEN (pd.uan_number IS NOT NULL AND pd.uan_number != '') OR (pd.pf_number IS NOT NULL AND pd.pf_number != '') THEN 'Pending'
          ELSE 'Not Available'
        END AS pf_status
      FROM public.employees e
      LEFT JOIN public.pf_details pd ON pd.employee_id = e.employee_id
      ${whereClause}
      ORDER BY e.employee_id ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const dataResult = await pool.query(dataQuery, dataQueryParams);
    const totalPages = Math.ceil(total / limit) || 1;

    // Summary metrics across all active employees in the organization
    const summaryQuery = `
      SELECT
        COUNT(e.employee_id) AS total_employees,
        COUNT(e.employee_id) FILTER (WHERE pd.uan_number IS NOT NULL AND pd.uan_number != '' AND pd.pf_number IS NOT NULL AND pd.pf_number != '') AS pf_active,
        COUNT(e.employee_id) FILTER (WHERE (
          (pd.uan_number IS NOT NULL AND pd.uan_number != '' AND (pd.pf_number IS NULL OR pd.pf_number = '')) OR
          (pd.pf_number IS NOT NULL AND pd.pf_number != '' AND (pd.uan_number IS NULL OR pd.uan_number = ''))
        )) AS pf_pending,
        COUNT(e.employee_id) FILTER (WHERE pd.id IS NULL OR (
          (pd.uan_number IS NULL OR pd.uan_number = '') AND
          (pd.pf_number IS NULL OR pd.pf_number = '')
        )) AS pf_not_available,
        COALESCE(SUM(pd.employee_contribution), 0)::NUMERIC(12,2) AS total_employee_contribution,
        COALESCE(SUM(pd.employer_contribution), 0)::NUMERIC(12,2) AS total_employer_contribution,
        COALESCE(SUM(COALESCE(pd.employee_contribution, 0) + COALESCE(pd.employer_contribution, 0)), 0)::NUMERIC(12,2) AS total_monthly_contribution,
        COUNT(pd.id) FILTER (WHERE pd.employee_contribution IS NOT NULL OR pd.employer_contribution IS NOT NULL) AS configured_contribution_count
      FROM public.employees e
      LEFT JOIN public.pf_details pd ON pd.employee_id = e.employee_id
      WHERE e.status = 'ACTIVE';
    `;
    const summaryResult = await pool.query(summaryQuery);
    const summaryRow = summaryResult.rows[0] || {};
    const summary = {
      total_employees: parseInt(summaryRow.total_employees, 10) || 0,
      pf_active: parseInt(summaryRow.pf_active, 10) || 0,
      pf_pending: parseInt(summaryRow.pf_pending, 10) || 0,
      pf_not_available: parseInt(summaryRow.pf_not_available, 10) || 0,
      total_employee_contribution: parseFloat(summaryRow.total_employee_contribution || 0),
      total_employer_contribution: parseFloat(summaryRow.total_employer_contribution || 0),
      total_monthly_contribution: parseFloat(summaryRow.total_monthly_contribution || 0),
      configured_contribution_count: parseInt(summaryRow.configured_contribution_count, 10) || 0,
    };

    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
      summary,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to fetch PF details for a specific employee.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 */
const getAdminPfByEmployeeId = async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid employee ID',
      });
    }

    const trimmedEmpId = employeeId.trim();

    const query = `
      SELECT
        e.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.email,
        e.department,
        e.designation,
        e.status AS employee_status,
        TO_CHAR(e.created_at, 'YYYY-MM-DD') AS date_of_joining,
        pd.id AS pf_id,
        pd.uan_number,
        pd.pf_number,
        pd.pension_number,
        pd.employee_contribution,
        pd.employer_contribution,
        TO_CHAR(pd.created_at, 'DD Month YYYY') AS pf_created_formatted,
        TO_CHAR(pd.updated_at, 'DD Month YYYY') AS pf_updated_formatted,
        pd.created_at AS pf_created_at,
        pd.updated_at AS pf_updated_at,
        CASE
          WHEN pd.uan_number IS NOT NULL AND pd.uan_number != '' AND pd.pf_number IS NOT NULL AND pd.pf_number != '' THEN 'Active'
          WHEN (pd.uan_number IS NOT NULL AND pd.uan_number != '') OR (pd.pf_number IS NOT NULL AND pd.pf_number != '') THEN 'Pending'
          ELSE 'Not Available'
        END AS pf_status
      FROM public.employees e
      LEFT JOIN public.pf_details pd ON pd.employee_id = e.employee_id
      WHERE e.employee_id = $1
    `;

    const result = await pool.query(query, [trimmedEmpId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
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
 * Controller to create or update PF details for an employee.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 * - Enforces employee existence in public.employees.
 * - Uses UPSERT with ON CONFLICT (employee_id) DO UPDATE.
 */
const updateAdminPf = async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid employee ID',
      });
    }

    const trimmedEmpId = employeeId.trim();

    // Verify employee exists in public.employees
    const empCheck = await pool.query(
      'SELECT employee_id, first_name, last_name, status FROM public.employees WHERE employee_id = $1',
      [trimmedEmpId]
    );

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const {
      uan,
      uan_number,
      pfNumber,
      pf_number,
      pensionNumber,
      pension_number,
      employeeContribution,
      employee_contribution,
      employerContribution,
      employer_contribution,
    } = req.body;

    const uanInput = uan !== undefined ? uan : uan_number;
    const pfInput = pfNumber !== undefined ? pfNumber : pf_number;
    const pensionInput = pensionNumber !== undefined ? pensionNumber : pension_number;

    // Sanitize values: empty string or '-' becomes null
    const sanitizedUan =
      uanInput !== undefined && uanInput !== null && String(uanInput).trim() !== '' && String(uanInput).trim() !== '-'
        ? String(uanInput).trim()
        : null;

    const sanitizedPf =
      pfInput !== undefined && pfInput !== null && String(pfInput).trim() !== '' && String(pfInput).trim() !== '-'
        ? String(pfInput).trim()
        : null;

    const sanitizedPension =
      pensionInput !== undefined && pensionInput !== null && String(pensionInput).trim() !== '' && String(pensionInput).trim() !== '-'
        ? String(pensionInput).trim()
        : null;

    // Validate string lengths
    if (sanitizedUan && sanitizedUan.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'UAN number cannot exceed 50 characters.',
      });
    }

    if (sanitizedPf && sanitizedPf.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'PF number cannot exceed 50 characters.',
      });
    }

    if (sanitizedPension && sanitizedPension.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Pension number cannot exceed 50 characters.',
      });
    }

    // Sanitize & validate contribution amounts (supports non-negative decimals)
    const rawEmpContrib = employeeContribution !== undefined ? employeeContribution : employee_contribution;
    let sanitizedEmpContrib = null;
    if (rawEmpContrib !== undefined && rawEmpContrib !== null && String(rawEmpContrib).trim() !== '' && String(rawEmpContrib).trim() !== '—') {
      const parsed = parseFloat(rawEmpContrib);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({
          success: false,
          message: 'Employee contribution must be a valid non-negative number.',
        });
      }
      sanitizedEmpContrib = Math.round(parsed * 100) / 100;
    }

    const rawEmprContrib = employerContribution !== undefined ? employerContribution : employer_contribution;
    let sanitizedEmprContrib = null;
    if (rawEmprContrib !== undefined && rawEmprContrib !== null && String(rawEmprContrib).trim() !== '' && String(rawEmprContrib).trim() !== '—') {
      const parsed = parseFloat(rawEmprContrib);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({
          success: false,
          message: 'Employer contribution must be a valid non-negative number.',
        });
      }
      sanitizedEmprContrib = Math.round(parsed * 100) / 100;
    }

    const upsertQuery = `
      INSERT INTO public.pf_details (
        employee_id,
        uan_number,
        pf_number,
        pension_number,
        employee_contribution,
        employer_contribution,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (employee_id)
      DO UPDATE SET
        uan_number = EXCLUDED.uan_number,
        pf_number = EXCLUDED.pf_number,
        pension_number = EXCLUDED.pension_number,
        employee_contribution = EXCLUDED.employee_contribution,
        employer_contribution = EXCLUDED.employer_contribution,
        updated_at = NOW()
      RETURNING
        id,
        employee_id,
        uan_number,
        pf_number,
        pension_number,
        employee_contribution,
        employer_contribution,
        created_at,
        updated_at;
    `;

    const result = await pool.query(upsertQuery, [
      trimmedEmpId,
      sanitizedUan,
      sanitizedPf,
      sanitizedPension,
      sanitizedEmpContrib,
      sanitizedEmprContrib,
    ]);

    return res.status(200).json({
      success: true,
      message: 'PF details updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to remove/delete PF details for an employee.
 * Security:
 * - Restricted to ADMIN and SUPER_ADMIN roles.
 */
const deleteAdminPf = async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid employee ID',
      });
    }

    const trimmedEmpId = employeeId.trim();

    // Verify employee exists in public.employees
    const empCheck = await pool.query(
      'SELECT employee_id FROM public.employees WHERE employee_id = $1',
      [trimmedEmpId]
    );

    if (empCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const deleteQuery = `
      DELETE FROM public.pf_details
      WHERE employee_id = $1
      RETURNING id;
    `;
    const result = await pool.query(deleteQuery, [trimmedEmpId]);

    return res.status(200).json({
      success: true,
      message: result.rows.length > 0 ? 'PF details removed successfully' : 'No PF record existed for this employee',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminPfList,
  getAdminPfByEmployeeId,
  updateAdminPf,
  deleteAdminPf,
};
