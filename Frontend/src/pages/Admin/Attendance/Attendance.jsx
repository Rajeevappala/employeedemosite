import { useState, useMemo, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import './Attendance.css';

const ATTENDANCE_STATUSES = [
  'All',
  'Present',
  'Absent',
  'Half Day',
  'Leave',
  'Holiday',
  'Work From Home',
  'Week Off',
  'Unmarked',
];

const MODAL_STATUS_OPTIONS = [
  'Present',
  'Absent',
  'Half Day',
  'Leave',
  'Holiday',
  'Work From Home',
  'Week Off',
];

// Helper to format date string "2026-09-30" -> "30 Sep 2026"
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const day = parts[2];
    const month = months[parseInt(parts[1], 10) - 1] || parts[1];
    const year = parts[0];
    return `${day} ${month} ${year}`;
  }
  return dateStr;
}

// Helper to get current runtime date formatted as YYYY-MM-DD
function getTodayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Helper to check if a date string is Saturday or Sunday
function isDateWeekend(dateStr) {
  if (!dateStr) return false;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return false;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const day = d.getDay();
  return day === 0 || day === 6;
}

// Helper to format date for header display "Wednesday, 30 September 2026"
function formatHeaderDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${days[d.getDay()]}, ${parts[2]} ${months[d.getMonth()]} ${parts[0]}`;
  }
  return dateStr;
}

function Attendance() {
  // Selected date (Default: runtime current date)
  const [selectedDate, setSelectedDate] = useState(getTodayIso);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All Departments');
  const [selectedStatus, setSelectedStatus] = useState('All');

  // Backend data states
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [dailySummary, setDailySummary] = useState({
    totalEmployees: 0,
    present: 0,
    absent: 0,
    leave: 0,
    workFromHome: 0,
    halfDay: 0,
    weekOff: 0,
  });
  const [unmarkedCount, setUnmarkedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modals state
  const [editModalEmployee, setEditModalEmployee] = useState(null);
  const [modalStatus, setModalStatus] = useState('Present');
  const [modalRemarks, setModalRemarks] = useState('');
  const [isMarkAllModalOpen, setIsMarkAllModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Lock background body scroll when any modal is open
  useEffect(() => {
    const isAnyModalOpen = Boolean(editModalEmployee || isMarkAllModalOpen);
    if (isAnyModalOpen) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = orig;
      };
    }
  }, [editModalEmployee, isMarkAllModalOpen]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3500);
  };

  // Quick date change helpers
  const handlePrevDay = () => {
    const parts = selectedDate.split('-');
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setSelectedDate(`${y}-${m}-${day}`);
  };

  const handleToday = () => {
    setSelectedDate(getTodayIso());
  };

  const handleNextDay = () => {
    const parts = selectedDate.split('-');
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setSelectedDate(`${y}-${m}-${day}`);
  };

  // Fetch attendance from backend API
  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        date: selectedDate,
      };

      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }

      if (selectedStatus !== 'All') {
        params.status = selectedStatus;
      }

      const res = await api.admin.getAttendance(params);
      if (res && res.success) {
        const rows = (res.data || []).map((item) => {
          const firstName = item.first_name || '';
          const lastName = item.last_name || '';
          const name = [firstName, lastName].filter(Boolean).join(' ') || item.employee_id;
          const avatarInitial = ((firstName[0] || '') + (lastName[0] || '')).toUpperCase() || 'E';
          const status = item.attendance_status || 'Unmarked';
          return {
            id: item.employee_id,
            name,
            email: item.email || '',
            department: item.department || '',
            designation: item.designation || '',
            avatarInitial,
            attendance_id: item.attendance_id || null,
            status,
            remarks: item.remarks || '',
            markedBy: item.marked_by ? 'Admin' : '',
            record: item.attendance_id ? {
              id: item.attendance_id,
              status: item.attendance_status,
              remarks: item.remarks,
            } : null,
          };
        });

        setAttendanceRows(rows);

        const s = res.summary || {};
        setDailySummary({
          totalEmployees: s.total_employees !== undefined ? s.total_employees : rows.length,
          present: s.present || 0,
          absent: s.absent || 0,
          leave: s.leave || 0,
          workFromHome: s.work_from_home || 0,
          halfDay: s.half_day || 0,
          weekOff: s.week_off || 0,
        });

        const unmarkCount = s.not_marked !== undefined ? s.not_marked : rows.filter((r) => r.status === 'Unmarked').length;
        setUnmarkedCount(unmarkCount);
      } else {
        setAttendanceRows([]);
      }
    } catch (err) {
      console.error('Failed to fetch attendance:', err);
      setError(err.message || 'Unable to load attendance records');
      setAttendanceRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, searchQuery, selectedStatus]);

  // Debounced load on filter changes
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAttendance();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchAttendance]);

  // Distinct departments dynamically collected from real rows
  const departmentOptions = useMemo(() => {
    const depts = new Set(attendanceRows.map((r) => r.department).filter(Boolean));
    return ['All Departments', ...Array.from(depts)];
  }, [attendanceRows]);

  // Client-side department filtering
  const filteredRows = useMemo(() => {
    if (selectedDept === 'All Departments') {
      return attendanceRows;
    }
    return attendanceRows.filter((row) => row.department === selectedDept);
  }, [attendanceRows, selectedDept]);

  // Open Edit / Mark Modal for a specific employee
  const handleOpenEditModal = (row) => {
    setEditModalEmployee(row);
    setModalStatus(row.record ? row.record.status : (row.status !== 'Unmarked' ? row.status : 'Present'));
    setModalRemarks(row.record ? row.record.remarks : '');
  };

  const handleCloseEditModal = () => {
    setEditModalEmployee(null);
    setModalStatus('Present');
    setModalRemarks('');
  };

  // Save single attendance (Mark or Update)
  const handleSaveAttendance = async (e) => {
    e.preventDefault();
    if (!editModalEmployee) return;

    setSubmitting(true);
    try {
      if (editModalEmployee.attendance_id) {
        // Update existing attendance
        await api.admin.updateAttendance(editModalEmployee.attendance_id, {
          status: modalStatus,
          remarks: modalRemarks,
        });
        showToast(`Attendance updated for ${editModalEmployee.name} (${modalStatus})`);
      } else {
        // Mark new attendance
        await api.admin.markAttendance({
          employee_id: editModalEmployee.id,
          attendance_date: selectedDate,
          status: modalStatus,
          remarks: modalRemarks,
        });
        showToast(`Attendance marked for ${editModalEmployee.name} (${modalStatus})`);
      }

      handleCloseEditModal();
      fetchAttendance();
    } catch (err) {
      console.error('Save attendance error:', err);
      showToast(err.message || 'Failed to save attendance');
    } finally {
      setSubmitting(false);
    }
  };

  // Confirm Mark All Present
  const handleConfirmMarkAllPresent = async () => {
    setSubmitting(true);
    try {
      const isWeekend = isDateWeekend(selectedDate);
      const payload = { attendance_date: selectedDate };
      if (isWeekend) {
        payload.confirm_weekend = true;
      }
      const res = await api.admin.markAllPresent(payload);
      setIsMarkAllModalOpen(false);
      const count = res?.data?.marked_count || 0;
      if (count > 0) {
        showToast(`Successfully marked ${count} unmarked employee${count === 1 ? '' : 's'} as Present!`);
      } else {
        showToast('All employees are already marked or on approved leave.');
      }
      fetchAttendance();
    } catch (err) {
      console.error('Mark all present error:', err);
      showToast(err.message || 'Failed to mark all present');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Present':
        return 'admin-att-status-present';
      case 'Absent':
        return 'admin-att-status-absent';
      case 'Leave':
        return 'admin-att-status-leave';
      case 'Work From Home':
        return 'admin-att-status-wfh';
      case 'Half Day':
        return 'admin-att-status-halfday';
      case 'Holiday':
        return 'admin-att-status-holiday';
      case 'Week Off':
        return 'admin-att-status-weekoff';
      default:
        return 'admin-att-status-unmarked';
    }
  };

  return (
    <div className="admin-attendance-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-attendance-toast" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ====================================================================
          PAGE HEADER & DATE SELECTOR
          ==================================================================== */}
      <div className="admin-att-header-card">
        <div className="admin-att-header-top">
          <div className="admin-att-title-group">
            <h1 className="admin-att-title">Attendance Management</h1>
            <p className="admin-att-subtitle">
              Mark and manage daily employee attendance.
            </p>
          </div>

          <div className="admin-att-header-actions">
            {/* Mark All Present Button */}
            <button
              type="button"
              className="admin-btn-primary admin-btn-mark-all"
              onClick={() => setIsMarkAllModalOpen(true)}
              title="Mark all unmarked employees as Present for selected date"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Mark All Present</span>
            </button>
          </div>
        </div>

        {/* Date Selector Row */}
        <div className="admin-att-date-bar">
          <div className="admin-att-date-picker-wrap">
            <label htmlFor="adminAttDateInput" className="admin-att-date-lbl">
              Select Date:
            </label>
            <div className="admin-att-date-controls">
              <button
                type="button"
                className="admin-att-day-nav-btn"
                onClick={handlePrevDay}
                aria-label="Previous day"
                title="Previous Day"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              <button
                type="button"
                className="admin-att-day-today-btn"
                onClick={handleToday}
                title="Jump to Today"
              >
                Today
              </button>

              <input
                id="adminAttDateInput"
                type="date"
                className="admin-att-date-input"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDate(e.target.value);
                  }
                }}
              />

              <button
                type="button"
                className="admin-att-day-nav-btn"
                onClick={handleNextDay}
                aria-label="Next day"
                title="Next Day"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>

          <div className="admin-att-formatted-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{formatHeaderDate(selectedDate)}</span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          DAILY ATTENDANCE SUMMARY CARDS (Calculated for selected date)
          ==================================================================== */}
      <section className="admin-att-summary-section" aria-label="Daily Attendance Summary">
        <div className="admin-att-summary-grid">
          {/* Total Employees */}
          <div className="admin-att-stat-card border-top-slate">
            <span className="stat-label">Total Employees</span>
            <div className="stat-value-group">
              <span className="stat-number">{dailySummary.totalEmployees}</span>
              <span className="stat-unit">Employees</span>
            </div>
            <span className="stat-subtext">Active Workforce</span>
          </div>

          {/* Present */}
          <div className="admin-att-stat-card border-top-green">
            <span className="stat-label">Present</span>
            <div className="stat-value-group">
              <span className="stat-number text-green">{dailySummary.present}</span>
              <span className="stat-unit">Present</span>
            </div>
            <span className="stat-subtext">Checked in</span>
          </div>

          {/* Absent */}
          <div className="admin-att-stat-card border-top-red">
            <span className="stat-label">Absent</span>
            <div className="stat-value-group">
              <span className="stat-number text-red">{dailySummary.absent}</span>
              <span className="stat-unit">Absent</span>
            </div>
            <span className="stat-subtext">Not reported</span>
          </div>

          {/* On Leave */}
          <div className="admin-att-stat-card border-top-amber">
            <span className="stat-label">On Leave</span>
            <div className="stat-value-group">
              <span className="stat-number text-amber">{dailySummary.leave}</span>
              <span className="stat-unit">On Leave</span>
            </div>
            <span className="stat-subtext">Approved leaves</span>
          </div>

          {/* Work From Home */}
          <div className="admin-att-stat-card border-top-blue">
            <span className="stat-label">Work From Home</span>
            <div className="stat-value-group">
              <span className="stat-number text-blue">{dailySummary.workFromHome}</span>
              <span className="stat-unit">WFH</span>
            </div>
            <span className="stat-subtext">Remote status</span>
          </div>

          {/* Half Day */}
          <div className="admin-att-stat-card border-top-yellow">
            <span className="stat-label">Half Day</span>
            <div className="stat-value-group">
              <span className="stat-number text-yellow">{dailySummary.halfDay}</span>
              <span className="stat-unit">Half Day</span>
            </div>
            <span className="stat-subtext">Partial day</span>
          </div>

          {/* Week Off */}
          <div className="admin-att-stat-card border-top-purple">
            <span className="stat-label">Week Off</span>
            <div className="stat-value-group">
              <span className="stat-number text-purple">{dailySummary.weekOff || 0}</span>
              <span className="stat-unit">Week Off</span>
            </div>
            <span className="stat-subtext">Weekend / Rest day</span>
          </div>
        </div>
      </section>

      {/* ====================================================================
          SEARCH AND FILTERS BAR
          ==================================================================== */}
      <div className="admin-att-filter-card">
        <div className="admin-att-filter-grid">
          {/* Search Employee */}
          <div className="admin-att-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="admin-att-search-input"
              placeholder="Search by name, ID, or designation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="admin-att-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
          </div>

          {/* Filter by Department */}
          <div className="admin-att-select-wrap">
            <select
              className="admin-att-select"
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              aria-label="Filter by department"
            >
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* Filter by Attendance Status */}
          <div className="admin-att-select-wrap">
            <select
              className="admin-att-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label="Filter by status"
            >
              {ATTENDANCE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status === 'All' ? 'All Statuses' : status}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ====================================================================
          ADMIN ATTENDANCE TABLE
          ==================================================================== */}
      <div className="admin-att-card admin-att-table-card">
        <div className="admin-att-card-header">
          <div className="card-title-group">
            <h2 className="admin-att-card-title">Employee Attendance List</h2>
            <span className="admin-att-card-desc">
              Showing attendance records for {formatDate(selectedDate)}
            </span>
          </div>

          <div className="admin-att-meta-badges">
            <span className="admin-att-badge-pill">
              {filteredRows.length} of {attendanceRows.length} Employees
            </span>
            {unmarkedCount > 0 && (
              <span className="admin-att-unmarked-pill">
                {unmarkedCount} Unmarked
              </span>
            )}
          </div>
        </div>

        <div className="admin-att-table-container">
          <table className="admin-att-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Date</th>
                <th>Attendance Status</th>
                <th>Remarks</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="admin-att-empty-state">
                    Loading attendance records...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="8" className="admin-att-empty-state" style={{ color: '#ef4444' }}>
                    {error}.{' '}
                    <button
                      type="button"
                      onClick={fetchAttendance}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: 0,
                        font: 'inherit',
                      }}
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan="8" className="admin-att-empty-state">
                    No employee records match the selected filters for {formatDate(selectedDate)}.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id}>
                    {/* Employee ID */}
                    <td>
                      <span className="admin-att-id-badge font-mono font-semibold">
                        {row.id}
                      </span>
                    </td>

                    {/* Employee Avatar & Name */}
                    <td>
                      <div className="admin-att-emp-cell">
                        <div className="admin-att-avatar" aria-hidden="true">
                          {row.avatarInitial}
                        </div>
                        <div className="admin-att-emp-text">
                          <span className="admin-att-emp-name font-semibold">
                            {row.name}
                          </span>
                          <span className="admin-att-emp-email text-xs text-muted">
                            {row.email}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Department */}
                    <td className="text-secondary font-medium">
                      {row.department}
                    </td>

                    {/* Designation */}
                    <td className="text-secondary font-medium">
                      {row.designation}
                    </td>

                    {/* Date */}
                    <td className="text-secondary whitespace-nowrap">
                      {formatDate(selectedDate)}
                    </td>

                    {/* Attendance Status */}
                    <td>
                      <span className={`admin-att-status-badge ${getStatusBadgeClass(row.status)}`}>
                        <span className="status-dot" aria-hidden="true" />
                        {row.status}
                      </span>
                    </td>

                    {/* Remarks */}
                    <td className="text-secondary text-sm max-w-xs">
                      {row.remarks || '-'}
                    </td>

                    {/* Action Button */}
                    <td className="text-right whitespace-nowrap">
                      <button
                        type="button"
                        className={`admin-att-action-btn ${
                          row.status === 'Unmarked' ? 'btn-mark' : 'btn-edit'
                        }`}
                        onClick={() => handleOpenEditModal(row)}
                      >
                        {row.status === 'Unmarked' ? 'Mark Attendance' : 'Edit'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ====================================================================
          MARK / EDIT ATTENDANCE MODAL
          ==================================================================== */}
      {editModalEmployee && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-confirm-modal" style={{ maxWidth: '500px' }}>
            <div className="admin-modal-header">
              <div>
                <h2 className="admin-modal-title">
                  {editModalEmployee.status === 'Unmarked' ? 'Mark Attendance' : 'Edit Attendance'}
                </h2>
                <span className="admin-att-modal-subtitle">
                  {editModalEmployee.name} ({editModalEmployee.id})
                </span>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={handleCloseEditModal}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveAttendance} className="admin-att-modal-form">
              <div className="admin-confirm-body" style={{ alignItems: 'stretch', textAlign: 'left', padding: '1.25rem 1.5rem' }}>
                {/* Employee Info Box (Read-only) */}
                <div className="admin-att-read-box">
                  <div className="admin-att-detail-row">
                    <span className="att-lbl">Employee:</span>
                    <span className="att-val font-semibold">
                      {editModalEmployee.name} ({editModalEmployee.id})
                    </span>
                  </div>
                  <div className="admin-att-detail-row">
                    <span className="att-lbl">Department:</span>
                    <span className="att-val">{editModalEmployee.department}</span>
                  </div>
                  <div className="admin-att-detail-row">
                    <span className="att-lbl">Designation:</span>
                    <span className="att-val">{editModalEmployee.designation}</span>
                  </div>
                  <div className="admin-att-detail-row">
                    <span className="att-lbl">Date:</span>
                    <span className="att-val font-semibold text-primary">
                      {formatDate(selectedDate)} ({formatHeaderDate(selectedDate).split(',')[0]})
                    </span>
                  </div>
                </div>

                {/* Status Selection */}
                <div className="admin-form-field" style={{ marginTop: '0.875rem' }}>
                  <label htmlFor="modalAttStatus" className="admin-field-label">
                    Attendance Status <span className="text-required">*</span>
                  </label>
                  <select
                    id="modalAttStatus"
                    className="admin-field-select"
                    value={modalStatus}
                    onChange={(e) => setModalStatus(e.target.value)}
                    required
                  >
                    {MODAL_STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Remarks Field */}
                <div className="admin-form-field" style={{ marginTop: '0.875rem' }}>
                  <label htmlFor="modalAttRemarks" className="admin-field-label">
                    Remarks / Notes
                  </label>
                  <textarea
                    id="modalAttRemarks"
                    rows="3"
                    className="admin-field-textarea"
                    placeholder="e.g. Approved WFH, client meeting, late check-in..."
                    value={modalRemarks}
                    onChange={(e) => setModalRemarks(e.target.value)}
                  ></textarea>
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  disabled={submitting}
                  onClick={handleCloseEditModal}
                >
                  Cancel
                </button>
                <button type="submit" className="admin-btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save Attendance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          CONFIRM MARK ALL PRESENT MODAL
          ==================================================================== */}
      {isMarkAllModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-confirm-modal" style={{ maxWidth: '480px' }}>
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Mark All Present</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsMarkAllModalOpen(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body" style={{ padding: '1.5rem 1.5rem 1rem' }}>
              <div className="admin-confirm-icon-wrap icon-green" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              <p className="admin-confirm-message">
                Mark all unmarked employees as Present?
              </p>

              <div className="admin-att-read-box" style={{ width: '100%', marginTop: '0.5rem', textAlign: 'left' }}>
                <div className="admin-att-detail-row">
                  <span className="att-lbl">Date:</span>
                  <span className="att-val font-semibold">{formatDate(selectedDate)}</span>
                </div>
                <div className="admin-att-detail-row">
                  <span className="att-lbl">Unmarked Employees:</span>
                  <span className="att-val font-semibold text-primary">{unmarkedCount}</span>
                </div>
                <div className="admin-att-detail-row">
                  <span className="att-lbl">Preserved Records:</span>
                  <span className="att-val text-muted text-xs">
                    Existing Leave, Holiday, Absent, Half Day, and WFH records will NOT be overwritten.
                  </span>
                </div>
                {isDateWeekend(selectedDate) && (
                  <div className="admin-att-weekend-warning" style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '6px', padding: '10px', marginTop: '10px', color: '#92400e', fontSize: '0.85rem' }}>
                    <strong>Weekend Warning:</strong> The selected date is a weekend (Saturday/Sunday). Confirmation is required to mark all employees as Present on a rest day.
                  </div>
                )}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={submitting}
                onClick={() => setIsMarkAllModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn-primary admin-btn-success"
                disabled={submitting}
                onClick={handleConfirmMarkAllPresent}
              >
                {submitting ? 'Marking...' : 'Confirm & Mark Present'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Attendance;
