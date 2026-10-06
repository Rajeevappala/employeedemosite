const pool = require('../config/database');

/**
 * Controller to fetch PF details for the currently authenticated employee.
 * Security:
 * - Employee identity is derived strictly from req.user.employee_id.
 * - Client-supplied URL parameters, query parameters, or request body IDs are completely ignored.
 * - Only queries actual existing columns in the pf_details table.
 * - Returns HTTP 200 with data: null if no PF record exists for the employee.
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
        id,
        employee_id,
        uan_number,
        pf_number,
        pension_number,
        created_at,
        updated_at
      FROM pf_details
      WHERE employee_id = $1
    `;

    const result = await pool.query(query, [employeeId]);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: null,
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

module.exports = {
  getEmployeePfDetails,
};
