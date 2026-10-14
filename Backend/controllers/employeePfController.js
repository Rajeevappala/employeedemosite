const pool = require('../config/database');

/**
 * Controller to fetch PF details for the currently authenticated employee.
 * Security:
 * - Employee identity is derived strictly from req.user.employee_id.
 * - Client-supplied URL parameters, query parameters, or request body IDs are completely ignored.
 * - Sourced strictly from PostgreSQL tables: employees and pf_details.
 * - Returns HTTP 200 with complete PF and employment details.
 */
const getEmployeePfDetails = async (req, res, next) => {
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
        pd.id,
        e.employee_id,
        TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
        e.department,
        e.designation,
        e.status AS employment_status,
        TO_CHAR(e.created_at, 'YYYY-MM-DD') AS date_of_joining,
        pd.uan_number,
        pd.pf_number,
        pd.pension_number,
        pd.employee_contribution,
        pd.employer_contribution,
        CASE
          WHEN pd.uan_number IS NOT NULL AND pd.uan_number != '' AND pd.pf_number IS NOT NULL AND pd.pf_number != '' THEN 'Active'
          WHEN (pd.uan_number IS NOT NULL AND pd.uan_number != '') OR (pd.pf_number IS NOT NULL AND pd.pf_number != '') THEN 'Pending'
          ELSE 'Not Available'
        END AS pf_status,
        pd.created_at,
        pd.updated_at
      FROM public.employees e
      LEFT JOIN public.pf_details pd ON pd.employee_id = e.employee_id
      WHERE e.employee_id = $1
    `;

    const result = await pool.query(query, [employeeId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee record not found.',
      });
    }

    const row = result.rows[0];

    // If no PF row exists in pf_details table, return data: null with employment context
    if (!row.id && !row.uan_number && !row.pf_number) {
      return res.status(200).json({
        success: true,
        data: null,
        employment: {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          department: row.department,
          designation: row.designation,
          employment_status: row.employment_status,
          date_of_joining: row.date_of_joining,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: row,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEmployeePfDetails,
};
