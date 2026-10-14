const pool = require('../config/database');

/**
 * Service to fetch birthdays of active employees for the current calendar month.
 *
 * Requirements:
 * - Sourced strictly from PostgreSQL database (public.employees).
 * - Matches CURRENT_DATE's month dynamically; no hardcoded month, day, or year.
 * - Only includes status = 'ACTIVE' employees (excludes INACTIVE and SUSPENDED).
 * - Sorts by day of month ascending, then employee name ascending as secondary sort.
 * - Dynamically computes is_today flag.
 * - Sanitizes all sensitive data (never returns birth year, age, salary, PF, phone, address).
 * - Admin view includes employee_id and department.
 * - Employee view exposes only employee_name, designation, birthday_day, birthday_month, birthday_label, is_today.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forAdmin=false] - Whether to include Admin-specific fields.
 * @param {Object} [options.client=null] - Optional pg client for transaction support.
 * @returns {Promise<{ birthdays: Array, current_month_name: string, current_month_number: number }>}
 */
async function getCurrentMonthBirthdays({ forAdmin = false, client = null } = {}) {
  const db = client || pool;

  const query = `
    SELECT 
      employee_id,
      first_name,
      last_name,
      department,
      designation,
      EXTRACT(DAY FROM date_of_birth)::INTEGER AS birthday_day,
      EXTRACT(MONTH FROM date_of_birth)::INTEGER AS birthday_month,
      TO_CHAR(date_of_birth, 'DD FMMonth') AS birthday_label,
      (
        EXTRACT(DAY FROM date_of_birth) = EXTRACT(DAY FROM CURRENT_DATE) 
        AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
      ) AS is_today
    FROM public.employees
    WHERE status = 'ACTIVE'
      AND date_of_birth IS NOT NULL
      AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
    ORDER BY 
      EXTRACT(DAY FROM date_of_birth) ASC,
      first_name ASC,
      last_name ASC;
  `;

  const result = await db.query(query);

  const monthInfoQuery = `
    SELECT 
      TO_CHAR(CURRENT_DATE, 'FMMonth') AS current_month_name,
      EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER AS current_month_number
  `;
  const monthInfoRes = await db.query(monthInfoQuery);
  const currentMonthName = monthInfoRes.rows[0]?.current_month_name || '';
  const currentMonthNumber = monthInfoRes.rows[0]?.current_month_number || (new Date().getMonth() + 1);

  const birthdays = result.rows.map((row) => {
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Employee';
    const base = {
      employee_name: fullName,
      designation: row.designation || '—',
      birthday_day: row.birthday_day,
      birthday_month: row.birthday_month,
      birthday_label: row.birthday_label,
      is_today: Boolean(row.is_today),
    };

    if (forAdmin) {
      return {
        employee_id: row.employee_id,
        ...base,
        department: row.department || '—',
      };
    }

    return base;
  });

  return {
    birthdays,
    current_month_name: currentMonthName,
    current_month_number: currentMonthNumber,
  };
}

module.exports = {
  getCurrentMonthBirthdays,
};
