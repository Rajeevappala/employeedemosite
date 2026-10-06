import { useState, useMemo, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import './Attendance.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Format date string "2026-09-29" -> "29 Sep 2026"
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parts[2];
    const monthIndex = parseInt(parts[1], 10) - 1;
    const month = MONTH_NAMES[monthIndex]?.slice(0, 3) || parts[1];
    const year = parts[0];
    return `${day} ${month} ${year}`;
  }
  return dateStr;
}

// Get day of week name from date string
function getDayOfWeek(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return fullDays[d.getDay()] || '-';
}

// Maps backend attendance record to frontend representation
function mapAttendanceRecord(rec) {
  return {
    id: rec.id,
    date: rec.date || rec.attendance_date,
    status: rec.status,
    remarks: rec.remarks || '',
    markedBy: rec.marked_by ? 'Admin' : 'System',
  };
}

function Attendance() {
  // Selected year and month (Defaults to current portal date: September 2026)
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear() || 2026);
  const [selectedMonth, setSelectedMonth] = useState(() => (new Date().getMonth() + 1) || 9);

  const [monthlyRecords, setMonthlyRecords] = useState([]);
  const [backendSummary, setBackendSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const yearMonthStr = useMemo(() => {
    const m = selectedMonth < 10 ? `0${selectedMonth}` : `${selectedMonth}`;
    return `${selectedYear}-${m}`;
  }, [selectedYear, selectedMonth]);

  // Load attendance records and summary for the selected month
  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.employee.getAttendance(yearMonthStr);
      if (response && response.success) {
        setMonthlyRecords((response.data || []).map(mapAttendanceRecord));
        setBackendSummary(response.summary || null);
      } else {
        setMonthlyRecords([]);
        setBackendSummary(null);
      }
    } catch (err) {
      setError(err?.message || 'Unable to load attendance records. Please try again.');
      setMonthlyRecords([]);
      setBackendSummary(null);
    } finally {
      setLoading(false);
    }
  }, [yearMonthStr]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const response = await api.employee.getAttendance(yearMonthStr);
        if (!ignore) {
          if (response && response.success) {
            setMonthlyRecords((response.data || []).map(mapAttendanceRecord));
            setBackendSummary(response.summary || null);
            setError(null);
          } else {
            setMonthlyRecords([]);
            setBackendSummary(null);
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Unable to load attendance records. Please try again.');
          setMonthlyRecords([]);
          setBackendSummary(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, [yearMonthStr]);

  // Monthly summary mapped directly from backend response
  const monthlySummary = useMemo(() => {
    if (backendSummary) {
      return {
        workingDays: backendSummary.working_days ?? 0,
        present: backendSummary.present ?? 0,
        absent: backendSummary.absent ?? 0,
        paidLeave: backendSummary.paid_leave ?? 0,
        workFromHome: backendSummary.work_from_home ?? 0,
        halfDay: backendSummary.half_day ?? 0,
        holiday: backendSummary.holidays ?? 0,
        weekOff: backendSummary.week_off ?? 0,
      };
    }
    return {
      workingDays: 0,
      present: 0,
      absent: 0,
      paidLeave: 0,
      workFromHome: 0,
      halfDay: 0,
      holiday: 0,
      weekOff: 0,
    };
  }, [backendSummary]);

  // Navigate to previous month
  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear((prev) => prev - 1);
      setSelectedMonth(12);
    } else {
      setSelectedMonth((prev) => prev - 1);
    }
  };

  // Navigate to next month
  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear((prev) => prev + 1);
      setSelectedMonth(1);
    } else {
      setSelectedMonth((prev) => prev + 1);
    }
  };

  // Build calendar matrix for selected month
  const calendarDays = useMemo(() => {
    // Number of days in the month
    const totalDays = new Date(selectedYear, selectedMonth, 0).getDate();
    // First day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const firstDayIndex = new Date(selectedYear, selectedMonth - 1, 1).getDay();
    // Convert to Monday-start (0 = Mon, 1 = Tue, ..., 6 = Sun)
    const offset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    const days = [];
    // Filler days for preceding month
    for (let i = 0; i < offset; i++) {
      days.push({ dayNumber: null, isCurrentMonth: false });
    }

    // Days in current month
    for (let day = 1; day <= totalDays; day++) {
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      const dateStr = `${yearMonthStr}-${dayStr}`;
      const record = monthlyRecords.find((r) => r.date === dateStr);

      days.push({
        dayNumber: day,
        dateStr,
        isCurrentMonth: true,
        record: record || null,
      });
    }

    return days;
  }, [selectedYear, selectedMonth, yearMonthStr, monthlyRecords]);

  // Status badge styling helper
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Present':
        return 'att-status-present';
      case 'Absent':
        return 'att-status-absent';
      case 'Leave':
        return 'att-status-leave';
      case 'Work From Home':
        return 'att-status-wfh';
      case 'Half Day':
        return 'att-status-halfday';
      case 'Holiday':
        return 'att-status-holiday';
      case 'Week Off':
        return 'att-status-weekoff';
      default:
        return 'att-status-unmarked';
    }
  };

  const getStatusShortCode = (status) => {
    switch (status) {
      case 'Present':
        return 'P';
      case 'Absent':
        return 'A';
      case 'Leave':
        return 'L';
      case 'Work From Home':
        return 'WFH';
      case 'Half Day':
        return 'HD';
      case 'Holiday':
        return 'H';
      case 'Week Off':
        return 'WO';
      default:
        return '-';
    }
  };

  return (
    <div className="emp-attendance-page">
      {/* ====================================================================
          PAGE HEADER & MONTH SELECTOR
          ==================================================================== */}
      <div className="emp-att-header-card">
        <div className="emp-att-header-info">
          <div className="emp-att-title-group">
            <h1 className="emp-att-title">My Attendance</h1>
            <p className="emp-att-subtitle">
              View your attendance history and monthly attendance summary.
            </p>
          </div>

          {/* Month Selector Controls */}
          <div className="emp-att-month-controls" aria-label="Month Selector">
            <button
              type="button"
              className="emp-att-nav-btn"
              onClick={handlePrevMonth}
              aria-label="Previous month"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="emp-att-current-month">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>
                {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
              </span>
            </div>

            <button
              type="button"
              className="emp-att-nav-btn"
              onClick={handleNextMonth}
              aria-label="Next month"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Quick Month Jump Chips */}
        <div className="emp-att-month-chips">
          {[
            { label: `August ${selectedYear}`, y: selectedYear, m: 8 },
            { label: `September ${selectedYear}`, y: selectedYear, m: 9 },
            { label: `October ${selectedYear}`, y: selectedYear, m: 10 },
          ].map((chip) => (
            <button
              key={`${chip.y}-${chip.m}`}
              type="button"
              className={`emp-att-chip ${
                selectedYear === chip.y && selectedMonth === chip.m ? 'active' : ''
              }`}
              onClick={() => {
                setSelectedYear(chip.y);
                setSelectedMonth(chip.m);
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error Banner with Retry */}
      {error && !loading && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '0.75rem',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            fontSize: '0.875rem',
          }}
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchAttendance}
            style={{
              padding: '0.375rem 0.875rem',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.8125rem',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ====================================================================
          MONTHLY SUMMARY CARDS (Sourced directly from real backend summary)
          ==================================================================== */}
      <section className="emp-att-summary-section" aria-label="Monthly Attendance Summary">
        <div className="emp-att-summary-grid">
          {/* Working Days */}
          <div className="emp-att-stat-card stat-border-primary">
            <span className="stat-label">Working Days</span>
            <div className="stat-value-group">
              <span className="stat-number">{monthlySummary.workingDays}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">Total Workable Days</span>
          </div>

          {/* Present */}
          <div className="emp-att-stat-card stat-border-green">
            <span className="stat-label">Present</span>
            <div className="stat-value-group">
              <span className="stat-number text-green">{monthlySummary.present}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">On-duty days</span>
          </div>

          {/* Absent */}
          <div className="emp-att-stat-card stat-border-red">
            <span className="stat-label">Absent</span>
            <div className="stat-value-group">
              <span className="stat-number text-red">{monthlySummary.absent}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">Unplanned leave</span>
          </div>

          {/* Paid Leave */}
          <div className="emp-att-stat-card stat-border-amber">
            <span className="stat-label">Paid Leave</span>
            <div className="stat-value-group">
              <span className="stat-number text-amber">{monthlySummary.paidLeave}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">Approved leave</span>
          </div>

          {/* Work From Home */}
          <div className="emp-att-stat-card stat-border-blue">
            <span className="stat-label">Work From Home</span>
            <div className="stat-value-group">
              <span className="stat-number text-blue">{monthlySummary.workFromHome}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">Remote work</span>
          </div>

          {/* Half Day */}
          <div className="emp-att-stat-card stat-border-yellow">
            <span className="stat-label">Half Day</span>
            <div className="stat-value-group">
              <span className="stat-number text-yellow">{monthlySummary.halfDay}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">Partial shift</span>
          </div>

          {/* Holidays */}
          <div className="emp-att-stat-card stat-border-purple">
            <span className="stat-label">Holidays</span>
            <div className="stat-value-group">
              <span className="stat-number text-purple">{monthlySummary.holiday}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">Company holidays</span>
          </div>

          {/* Week Off */}
          <div className="emp-att-stat-card stat-border-indigo">
            <span className="stat-label">Week Off</span>
            <div className="stat-value-group">
              <span className="stat-number text-indigo">{monthlySummary.weekOff}</span>
              <span className="stat-unit">Days</span>
            </div>
            <span className="stat-subtext">Weekly rest days</span>
          </div>
        </div>
      </section>

      {/* ====================================================================
          ATTENDANCE CALENDAR (Monthly View with Legend)
          ==================================================================== */}
      <div className="emp-att-card emp-att-calendar-card">
        <div className="emp-att-card-header">
          <div className="card-title-group">
            <h2 className="emp-att-card-title">Monthly Attendance Calendar</h2>
            <span className="emp-att-card-desc">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear} schedule and daily status
            </span>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="emp-calendar-container">
          {/* Day of Week Headers */}
          <div className="emp-calendar-header-row">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className={`emp-calendar-col-header ${day === 'Sun' ? 'is-sunday' : ''}`}>
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Day Grid */}
          <div className="emp-calendar-days-grid">
            {calendarDays.map((cell, idx) => {
              if (!cell.isCurrentMonth) {
                return <div key={`empty-${idx}`} className="emp-calendar-day-cell is-empty" />;
              }

              const status = cell.record?.status || 'Unmarked';
              const badgeClass = getStatusBadgeClass(status);
              const shortCode = getStatusShortCode(status);

              return (
                <div key={cell.dateStr} className={`emp-calendar-day-cell ${badgeClass}-cell`}>
                  <div className="cal-day-top">
                    <span className="cal-day-number">{cell.dayNumber}</span>
                  </div>

                  <div className="cal-day-bottom">
                    <span className={`cal-status-pill ${badgeClass}`} title={cell.record?.remarks || status}>
                      <span className="cal-status-code">{shortCode}</span>
                      <span className="cal-status-full">{status}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="emp-att-legend-bar" aria-label="Calendar status legend">
          <span className="legend-title">Legend:</span>
          <div className="legend-items">
            <div className="legend-item">
              <span className="legend-dot dot-present"></span>
              <span className="legend-label">P = Present</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot dot-absent"></span>
              <span className="legend-label">A = Absent</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot dot-leave"></span>
              <span className="legend-label">L = Paid Leave</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot dot-wfh"></span>
              <span className="legend-label">WFH = Work From Home</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot dot-halfday"></span>
              <span className="legend-label">HD = Half Day</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot dot-holiday"></span>
              <span className="legend-label">H = Holiday</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot dot-weekoff"></span>
              <span className="legend-label">WO = Week Off</span>
            </div>
          </div>
        </div>
      </div>

      {/* ====================================================================
          DAILY ATTENDANCE HISTORY TABLE
          ==================================================================== */}
      <div className="emp-att-card emp-att-history-card">
        <div className="emp-att-card-header">
          <div className="card-title-group">
            <h2 className="emp-att-card-title">Daily Attendance History</h2>
            <span className="emp-att-card-desc">
              Detailed breakdown of daily check-ins for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </span>
          </div>

          <span className="emp-att-count-badge">
            {monthlyRecords.length} Records
          </span>
        </div>

        <div className="emp-att-table-container">
          <table className="emp-att-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Status</th>
                <th>Remarks</th>
                <th>Marked By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" className="emp-att-empty-state">
                    Loading attendance records...
                  </td>
                </tr>
              ) : monthlyRecords.length === 0 ? (
                <tr>
                  <td colSpan="5" className="emp-att-empty-state">
                    No attendance records found for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}.
                  </td>
                </tr>
              ) : (
                monthlyRecords
                  .slice()
                  .reverse()
                  .map((rec) => (
                    <tr key={rec.id || rec.date}>
                      <td className="font-semibold text-dark">
                        {formatDate(rec.date)}
                      </td>
                      <td className="text-secondary font-medium">
                        {getDayOfWeek(rec.date)}
                      </td>
                      <td>
                        <span className={`emp-status-badge ${getStatusBadgeClass(rec.status)}`}>
                          <span className="badge-dot" aria-hidden="true" />
                          {rec.status}
                        </span>
                      </td>
                      <td className="text-secondary text-sm">
                        {rec.remarks || '-'}
                      </td>
                      <td>
                        <span className="emp-marked-by-pill">
                          {rec.markedBy || 'Admin'}
                        </span>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Attendance;
