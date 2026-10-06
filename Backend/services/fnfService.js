const pool = require('../config/database');

/**
 * Service handling Full & Final (F&F) settlement calculations and attendance summaries.
 * Does NOT mutate existing payroll or attendance records.
 */

/**
 * Helper to round numeric values to 2 decimal places.
 */
function round2(val) {
  const num = parseFloat(val) || 0;
  return Math.round(num * 100) / 100;
}

/**
 * Calculates tenure in years and days between two dates.
 */
function calculateTenure(joiningDateStr, relievingDateStr) {
  if (!joiningDateStr || !relievingDateStr) return { years: 0, days: 0, totalDays: 0, formatted: '0 years' };
  
  const start = new Date(joiningDateStr);
  const end = new Date(relievingDateStr);
  const diffTime = Math.max(0, end - start);
  const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthLastDay = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    days += prevMonthLastDay;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const formatted = `${years} year(s), ${months} month(s), ${days} day(s)`;
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days), totalDays, formatted };
}

/**
 * Gathers attendance data for the exit month up through the relieving date.
 */
async function getFinalMonthAttendanceSummary(employeeId, relievingDateStr) {
  const relievingDate = new Date(relievingDateStr);
  const year = relievingDate.getFullYear();
  const month = relievingDate.getMonth() + 1; // 1-12
  const relievingDay = relievingDate.getDate();

  const query = `
    SELECT
      COUNT(CASE WHEN a.status = 'Present' THEN 1 END)::int AS present_count,
      COUNT(CASE WHEN a.status = 'Work From Home' THEN 1 END)::int AS wfh_count,
      COUNT(CASE WHEN a.status = 'Half Day' THEN 1 END)::int AS half_day_count,
      COUNT(CASE WHEN a.status = 'Leave' THEN 1 END)::int AS leave_count,
      COUNT(CASE WHEN a.status = 'Absent' THEN 1 END)::int AS absent_count,
      COUNT(CASE WHEN a.status = 'Holiday' THEN 1 END)::int AS holiday_count
    FROM public.attendance a
    WHERE a.employee_id = $1
      AND EXTRACT(YEAR FROM a.attendance_date) = $2
      AND EXTRACT(MONTH FROM a.attendance_date) = $3
      AND a.attendance_date <= $4::date
  `;

  const result = await pool.query(query, [employeeId, year, month, relievingDateStr]);
  const row = result.rows[0] || {};

  const present = parseInt(row.present_count, 10) || 0;
  const wfh = parseInt(row.wfh_count, 10) || 0;
  const halfDays = parseInt(row.half_day_count, 10) || 0;
  const leave = parseInt(row.leave_count, 10) || 0;
  const absent = parseInt(row.absent_count, 10) || 0;
  const holiday = parseInt(row.holiday_count, 10) || 0;

  const workedDays = present + wfh + halfDays * 0.5;
  const absentDays = absent + halfDays * 0.5;
  const payableDays = workedDays + leave + holiday;

  return {
    year,
    month,
    relievingDay,
    workedDays,
    leaveDays: leave,
    absentDays,
    holidayDays: holiday,
    payableDays: Math.min(payableDays, relievingDay),
  };
}

/**
 * Fetches available Paid Leave (PL) balance strictly excluding Sick and UPL.
 */
async function getAvailablePaidLeaveBalance(employeeId, relievingDate = null) {
  const query = `
    SELECT 
      COALESCE(lb.paid_leave_balance, 0)::numeric AS pl_total,
      COALESCE(SUM(
        CASE 
          WHEN lr.status = 'Approved' 
           AND (lr.leave_type = 'PL' OR lr.leave_type ILIKE 'paid%')
           AND ($2::date IS NULL OR lr.start_date <= $2::date)
          THEN lr.days 
          ELSE 0 
        END
      ), 0)::numeric AS pl_used
    FROM public.employees e
    LEFT JOIN public.leave_balances lb ON lb.employee_id = e.employee_id
    LEFT JOIN public.leave_requests lr ON lr.employee_id = e.employee_id
    WHERE e.employee_id = $1
    GROUP BY lb.paid_leave_balance;
  `;

  const result = await pool.query(query, [employeeId, relievingDate]);
  const row = result.rows[0];

  if (!row) return 0;
  const plTotal = parseFloat(row.pl_total) || 0;
  const plUsed = parseFloat(row.pl_used) || 0;
  return Math.max(0, round2(plTotal - plUsed));
}

/**
 * Calculates Full & Final settlement metrics.
 * 
 * @param {Object} params
 * @param {string} params.employeeId
 * @param {string} params.relievingDate - YYYY-MM-DD
 * @param {number} [params.salaryDivisor=30]
 * @param {number} [params.payableDays]
 * @param {number} [params.encashedLeaveDays]
 * @param {number} [params.gratuityAmount=0]
 * @param {number} [params.bonusOrIncentive=0]
 * @param {number} [params.noticePeriodRecovery=0]
 * @param {number} [params.otherDeductions=0]
 */
async function calculateFnf(params) {
  const {
    employeeId,
    relievingDate,
    salaryDivisor: customDivisor,
    payableDays: customPayableDays,
    encashedLeaveDays: customEncashedDays,
    gratuityAmount = 0,
    bonusOrIncentive = 0,
    noticePeriodRecovery = 0,
    otherDeductions = 0,
  } = params;

  // 1. Fetch Employee Profile
  const empRes = await pool.query(
    `SELECT employee_id, first_name, last_name, department, designation, date_of_joining, email, status
     FROM public.employees WHERE employee_id = $1`,
    [employeeId]
  );
  const employee = empRes.rows[0];
  if (!employee) {
    const error = new Error(`Employee with ID ${employeeId} not found.`);
    error.statusCode = 404;
    throw error;
  }

  // 2. Fetch Payroll Profile
  const payRes = await pool.query(
    `SELECT basic_salary, hra, allowances, pf_employee, professional_tax, other_deductions
     FROM public.payroll_profiles WHERE employee_id = $1`,
    [employeeId]
  );
  const profile = payRes.rows[0] || {
    basic_salary: 0,
    hra: 0,
    allowances: 0,
    pf_employee: 0,
    professional_tax: 0,
    other_deductions: 0,
  };

  const basicSalary = parseFloat(profile.basic_salary) || 0;
  const hra = parseFloat(profile.hra) || 0;
  const allowances = parseFloat(profile.allowances) || 0;
  const monthlyGross = round2(basicSalary + hra + allowances);

  // 3. Divisor and Working Days
  const salaryDivisor = Math.max(1, parseFloat(customDivisor) || 30);

  // 4. Attendance Summary for Final Month
  const attSummary = await getFinalMonthAttendanceSummary(employeeId, relievingDate);
  const payableDays = customPayableDays !== undefined && customPayableDays !== null
    ? Math.max(0, Math.min(salaryDivisor, parseFloat(customPayableDays) || 0))
    : attSummary.payableDays;

  // 5. Prorated Final Month Salary
  const proratedSalary = round2((monthlyGross * payableDays) / salaryDivisor);

  // 6. Leave Encashment (Only Paid Leave is encashable)
  const availablePlBalance = await getAvailablePaidLeaveBalance(employeeId, relievingDate);
  const encashedLeaveDays = customEncashedDays !== undefined && customEncashedDays !== null
    ? Math.max(0, Math.min(availablePlBalance, parseFloat(customEncashedDays) || 0))
    : availablePlBalance; // default to all available PL

  const dailyBasic = round2(basicSalary / salaryDivisor);
  const leaveEncashmentAmount = round2(dailyBasic * encashedLeaveDays);

  // 7. Tenure Calculation (Informational display only)
  const tenure = calculateTenure(employee.date_of_joining, relievingDate);
  const gratuity = Math.max(0, parseFloat(gratuityAmount) || 0);
  const bonus = Math.max(0, parseFloat(bonusOrIncentive) || 0);

  // 8. Deductions
  const noticeRecovery = Math.max(0, parseFloat(noticePeriodRecovery) || 0);
  const otherDeds = Math.max(0, parseFloat(otherDeductions) || 0);

  // 9. Totals
  const totalEarnings = round2(proratedSalary + leaveEncashmentAmount + gratuity + bonus);
  const totalDeductions = round2(noticeRecovery + otherDeds);
  const netPayableAmount = round2(totalEarnings - totalDeductions);

  return {
    employee: {
      employee_id: employee.employee_id,
      name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      department: employee.department,
      designation: employee.designation,
      date_of_joining: employee.date_of_joining,
      status: employee.status,
    },
    relieving_date: relievingDate,
    tenure,
    salary_structure: {
      basic_salary: basicSalary,
      hra,
      allowances,
      monthly_gross: monthlyGross,
      daily_basic: dailyBasic,
    },
    working_days: salaryDivisor,
    payable_days: payableDays,
    attendance_summary: attSummary,
    prorated_salary: proratedSalary,
    leave_encashment: {
      available_pl_days: availablePlBalance,
      encashed_leave_days: encashedLeaveDays,
      daily_basic: dailyBasic,
      leave_encashment_amount: leaveEncashmentAmount,
    },
    gratuity: {
      gratuity_amount: gratuity,
      tenure_years: tenure.years,
    },
    bonus_or_incentive: bonus,
    notice_period_recovery: noticeRecovery,
    other_deductions: otherDeds,
    total_earnings: totalEarnings,
    total_deductions: totalDeductions,
    net_payable_amount: netPayableAmount,
  };
}

module.exports = {
  calculateFnf,
  getFinalMonthAttendanceSummary,
  getAvailablePaidLeaveBalance,
  calculateTenure,
  round2,
};
