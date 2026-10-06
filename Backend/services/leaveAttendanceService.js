const pool = require('../config/database');

/**
 * Synchronizes an approved leave request into the attendance table.
 * Business rules:
 * - Generates each calendar date between start_date and end_date (inclusive).
 * - Never overwrites existing attendance records (Present, Absent, Half Day, WFH, Holiday).
 * - Uses ON CONFLICT (employee_id, attendance_date) DO NOTHING.
 * - Supports being called with an active transaction client or defaults to pool.
 *
 * @param {Object} leaveRequest - Object containing { employee_id, start_date, end_date, reviewed_by, approved_by }
 * @param {Object} [dbClient=pool] - Optional pg client or pool
 * @returns {Promise<number>} Number of attendance records newly created
 */
async function syncApprovedLeaveToAttendance(leaveRequest, dbClient = pool) {
  if (!leaveRequest) {
    throw new Error('Leave request object is required for attendance synchronization.');
  }

  const { employee_id, start_date, end_date } = leaveRequest;
  const markedBy = leaveRequest.approved_by || leaveRequest.reviewed_by || null;

  if (!employee_id || !start_date || !end_date) {
    throw new Error('Leave request missing required fields: employee_id, start_date, end_date.');
  }

  const query = `
    INSERT INTO public.attendance (
      employee_id,
      attendance_date,
      status,
      remarks,
      marked_by,
      marked_at,
      updated_at
    )
    SELECT
      $1,
      d::date,
      'Leave',
      'Approved leave',
      $2,
      NOW(),
      NOW()
    FROM generate_series($3::date, $4::date, '1 day'::interval) d
    ON CONFLICT (employee_id, attendance_date) DO NOTHING
    RETURNING id;
  `;

  const result = await dbClient.query(query, [
    employee_id,
    markedBy,
    start_date,
    end_date,
  ]);

  return result.rowCount || 0;
}

/**
 * Reusable function to synchronize all existing approved leave requests in the system.
 * Useful for retroactively syncing approved leaves if needed.
 *
 * @param {Object} [dbClient=pool] - Optional pg client or pool
 * @returns {Promise<{ total_leaves_processed: number, total_attendance_synced: number }>}
 */
async function syncAllApprovedLeaves(dbClient = pool) {
  const leavesQuery = `
    SELECT 
      id,
      employee_id,
      TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
      reviewed_by AS approved_by
    FROM public.leave_requests
    WHERE status = 'Approved'
    ORDER BY created_at ASC;
  `;
  const leavesResult = await dbClient.query(leavesQuery);

  let totalSynced = 0;
  for (const leave of leavesResult.rows) {
    const synced = await syncApprovedLeaveToAttendance(leave, dbClient);
    totalSynced += synced;
  }

  return {
    total_leaves_processed: leavesResult.rows.length,
    total_attendance_synced: totalSynced,
  };
}

module.exports = {
  syncApprovedLeaveToAttendance,
  syncAllApprovedLeaves,
};
