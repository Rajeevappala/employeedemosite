import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import './Dashboard.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Formats a currency amount into standard Indian Rupee notation (₹XX,XXX.XX)
 */
function formatCurrency(amount) {
  if (amount == null || amount === '') return '₹0.00';
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return '₹0.00';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Formats ISO date to friendly display (e.g. 01 Oct 2026)
 */
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Formats header date (e.g. Thursday, 1 October 2026)
 */
function formatHeaderDate(dateStr) {
  try {
    const d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) return new Date().toDateString();
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function Dashboard() {
  const navigate = useNavigate();

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Available year choices around selected year
  const availableYears = [selectedYear + 1, selectedYear, selectedYear - 1, selectedYear - 2];

  // Fetch dashboard data
  useEffect(() => {
    let ignore = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.admin.getDashboard({
          month: selectedMonth,
          year: selectedYear,
        });
        if (!ignore && response?.success) {
          setDashboardData(response.data);
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Unable to load dashboard data.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      ignore = true;
    };
  }, [selectedMonth, selectedYear]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    api.admin
      .getDashboard({ month: selectedMonth, year: selectedYear })
      .then((res) => {
        if (res?.success) setDashboardData(res.data);
      })
      .catch((err) => {
        setError(err?.message || 'Unable to load dashboard data.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const selectedMonthName = MONTH_NAMES[selectedMonth - 1] || `Month ${selectedMonth}`;

  if (loading && !dashboardData) {
    return (
      <div className="admin-dashboard-page">
        <div className="admin-state-loading-box">
          <svg className="admin-state-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
          </svg>
          <h2 className="admin-stat-label" style={{ fontSize: '1rem', color: '#1e293b' }}>
            Loading dashboard data...
          </h2>
          <p className="admin-stat-footer">Connecting to PostgreSQL and aggregating organization metrics.</p>
        </div>
      </div>
    );
  }

  if (error && !dashboardData) {
    return (
      <div className="admin-dashboard-page">
        <div className="admin-state-error-box">
          <div className="admin-stat-icon-wrapper stat-rose" style={{ width: '48px', height: '48px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="admin-stat-label" style={{ fontSize: '1.125rem', color: '#dc2626' }}>
            Unable to load dashboard data
          </h2>
          <p className="admin-stat-footer" style={{ maxWidth: '400px' }}>
            {error}
          </p>
          <button type="button" className="admin-retry-btn" onClick={handleRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const {
    date,
    employees,
    attendance,
    leaves,
    payroll,
    documents,
    departments,
    recent_leaves,
    recent_payroll,
  } = dashboardData || {};

  const activePercent = employees?.total > 0
    ? Math.round((employees.active / employees.total) * 1000) / 10
    : 0;

  return (
    <div className="admin-dashboard-page">
      {/* 1. Page Header */}
      <header className="admin-page-header">
        <div className="admin-page-title-group">
          <h1 className="admin-page-title">Admin Dashboard</h1>
          <p className="admin-page-subtitle">
            Overview of employee activity and organization status.
          </p>
        </div>

        <div className="admin-header-actions">
          {/* Payroll Period Selector */}
          <div className="admin-period-selector" title="Select Payroll Period">
            <span className="admin-period-label">Period:</span>
            <select
              className="admin-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
              aria-label="Payroll Month"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="admin-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              aria-label="Payroll Year"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          {/* Current Date Badge */}
          <div className="admin-date-badge" title="Current organization date">
            <svg
              className="admin-badge-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{formatHeaderDate(date)}</span>
          </div>
        </div>
      </header>

      {/* 2. Employee Summary Cards */}
      <section className="admin-summary-grid" aria-label="Workforce Summary">
        {/* Card 1: Total Employees */}
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Total Employees</span>
            <div className="admin-stat-icon-wrapper stat-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{employees?.total ?? 0}</div>
          <div className="admin-stat-footer">Across {departments?.length || 0} departments</div>
        </div>

        {/* Card 2: Active Employees */}
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Active Employees</span>
            <div className="admin-stat-icon-wrapper stat-green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <polyline points="17 11 19 13 23 9" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{employees?.active ?? 0}</div>
          <div className="admin-stat-footer">{activePercent}% active workforce</div>
        </div>

        {/* Card 3: Inactive Employees */}
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Inactive Employees</span>
            <div className="admin-stat-icon-wrapper stat-amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="18" y1="8" x2="23" y2="13" />
                <line x1="23" y1="8" x2="18" y2="13" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{employees?.inactive ?? 0}</div>
          <div className="admin-stat-footer">Inactive or pending profiles</div>
        </div>

        {/* Card 4: Pending Leaves */}
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Pending Leaves</span>
            <div className="admin-stat-icon-wrapper stat-purple">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{leaves?.pending ?? 0}</div>
          <div className="admin-stat-footer">Requires HR review & action</div>
        </div>
      </section>

      {/* 3. Today's Attendance Section */}
      <section className="admin-card" aria-label="Today's Attendance">
        <div className="admin-card-header">
          <div className="admin-card-header-left">
            <h2 className="admin-card-title">Today&apos;s Attendance</h2>
            <p className="admin-card-subtitle">
              Live attendance records for {formatDate(attendance?.date || date)} across active employees
            </p>
          </div>
          <button
            type="button"
            className="admin-card-action-link"
            onClick={() => navigate('/admin/attendance')}
          >
            Manage Attendance &rarr;
          </button>
        </div>

        <div className="admin-metrics-6col">
          <div className="admin-metric-box admin-metric-box-success">
            <span className="admin-metric-label">Present</span>
            <span className="admin-metric-value">{attendance?.present ?? 0}</span>
            <span className="admin-metric-subtext">Checked in today</span>
          </div>

          <div className="admin-metric-box">
            <span className="admin-metric-label">Absent</span>
            <span className="admin-metric-value" style={{ color: '#dc2626' }}>
              {attendance?.absent ?? 0}
            </span>
            <span className="admin-metric-subtext">Marked absent</span>
          </div>

          <div className="admin-metric-box">
            <span className="admin-metric-label">Half Day</span>
            <span className="admin-metric-value">{attendance?.half_day ?? 0}</span>
            <span className="admin-metric-subtext">Partial day</span>
          </div>

          <div className="admin-metric-box">
            <span className="admin-metric-label">On Leave</span>
            <span className="admin-metric-value">{attendance?.leave ?? 0}</span>
            <span className="admin-metric-subtext">Approved leaves</span>
          </div>

          <div className="admin-metric-box">
            <span className="admin-metric-label">Work From Home</span>
            <span className="admin-metric-value">{attendance?.work_from_home ?? 0}</span>
            <span className="admin-metric-subtext">Remote status</span>
          </div>

          <div className="admin-metric-box admin-metric-box-highlight">
            <span className="admin-metric-label">Not Marked</span>
            <span className="admin-metric-value">{attendance?.not_marked ?? 0}</span>
            <span className="admin-metric-subtext">Pending check-in</span>
          </div>
        </div>
      </section>

      {/* 4. Leave Overview & Document Summary Section */}
      <section className="admin-middle-grid">
        {/* Leave Summary */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-header-left">
              <h2 className="admin-card-title">Leave Overview</h2>
              <p className="admin-card-subtitle">Overview of employee leave submissions</p>
            </div>
            <button
              type="button"
              className="admin-card-action-link"
              onClick={() => navigate('/admin/leaves')}
            >
              Manage Leaves &rarr;
            </button>
          </div>

          <div className="admin-metrics-4col">
            <div className="admin-metric-box admin-metric-box-highlight">
              <span className="admin-metric-label">Pending</span>
              <span className="admin-metric-value">{leaves?.pending ?? 0}</span>
              <span className="admin-metric-subtext">Needs approval</span>
            </div>

            <div className="admin-metric-box admin-metric-box-success">
              <span className="admin-metric-label">Approved</span>
              <span className="admin-metric-value">{leaves?.approved ?? 0}</span>
              <span className="admin-metric-subtext">Authorized</span>
            </div>

            <div className="admin-metric-box">
              <span className="admin-metric-label">Rejected</span>
              <span className="admin-metric-value" style={{ color: '#dc2626' }}>
                {leaves?.rejected ?? 0}
              </span>
              <span className="admin-metric-subtext">Declined</span>
            </div>

            <div className="admin-metric-box">
              <span className="admin-metric-label">Cancelled</span>
              <span className="admin-metric-value">{leaves?.cancelled ?? 0}</span>
              <span className="admin-metric-subtext">Withdrawn</span>
            </div>
          </div>
        </div>

        {/* Document Summary */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-header-left">
              <h2 className="admin-card-title">Document Summary</h2>
              <p className="admin-card-subtitle">Employee records and verified files</p>
            </div>
            <button
              type="button"
              className="admin-card-action-link"
              onClick={() => navigate('/admin/documents')}
            >
              Manage Documents &rarr;
            </button>
          </div>

          <div className="admin-metrics-4col">
            <div className="admin-metric-box">
              <span className="admin-metric-label">Total Files</span>
              <span className="admin-metric-value">{documents?.total ?? 0}</span>
              <span className="admin-metric-subtext">All repositories</span>
            </div>

            <div className="admin-metric-box">
              <span className="admin-metric-label">Payslips</span>
              <span className="admin-metric-value" style={{ color: '#2563eb' }}>
                {documents?.payslips ?? 0}
              </span>
              <span className="admin-metric-subtext">PDF generated</span>
            </div>

            <div className="admin-metric-box">
              <span className="admin-metric-label">Offer Letters</span>
              <span className="admin-metric-value">{documents?.offer_letters ?? 0}</span>
              <span className="admin-metric-subtext">Employment</span>
            </div>

            <div className="admin-metric-box">
              <span className="admin-metric-label">Other Docs</span>
              <span className="admin-metric-value">{documents?.other ?? 0}</span>
              <span className="admin-metric-subtext">General files</span>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Payroll Summary Section */}
      <section className="admin-card" aria-label="Payroll Summary">
        <div className="admin-card-header">
          <div className="admin-card-header-left">
            <h2 className="admin-card-title">
              Payroll Overview &mdash; {selectedMonthName} {selectedYear}
            </h2>
            <p className="admin-card-subtitle">
              Processed salaries and payout status for the selected period
            </p>
          </div>
          <button
            type="button"
            className="admin-card-action-link"
            onClick={() => navigate('/admin/payroll')}
          >
            Manage Payroll &rarr;
          </button>
        </div>

        {payroll?.total_records === 0 ? (
          <div className="admin-empty-state-box">
            <div className="admin-empty-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
                <line x1="7" y1="15" x2="7.01" y2="15" />
                <line x1="11" y1="15" x2="13" y2="15" />
              </svg>
            </div>
            <h3 className="admin-empty-state-title">No payroll processed for this period.</h3>
            <p className="admin-empty-state-desc">
              No salary records exist for {selectedMonthName} {selectedYear}. Navigate to the Payroll section to calculate and process wages.
            </p>
          </div>
        ) : (
          <>
            <div className="admin-metrics-3col">
              <div className="admin-metric-box">
                <span className="admin-metric-label">Processed</span>
                <span className="admin-metric-value" style={{ color: '#2563eb' }}>
                  {payroll?.processed ?? 0}
                </span>
                <span className="admin-metric-subtext">Records processed</span>
              </div>

              <div className="admin-metric-box admin-metric-box-success">
                <span className="admin-metric-label">Paid</span>
                <span className="admin-metric-value">{payroll?.paid ?? 0}</span>
                <span className="admin-metric-subtext">Disbursed salaries</span>
              </div>

              <div className="admin-metric-box">
                <span className="admin-metric-label">Pending</span>
                <span className="admin-metric-value" style={{ color: '#b45309' }}>
                  {payroll?.pending ?? 0}
                </span>
                <span className="admin-metric-subtext">Unfinalized</span>
              </div>
            </div>

            <div className="admin-financial-grid">
              <div className="admin-financial-card">
                <span className="admin-financial-lbl">Total Gross Salary</span>
                <span className="admin-financial-val">{formatCurrency(payroll?.gross_salary)}</span>
              </div>

              <div className="admin-financial-card">
                <span className="admin-financial-lbl">Total Deductions</span>
                <span className="admin-financial-val" style={{ color: '#dc2626' }}>
                  {formatCurrency(payroll?.total_deductions)}
                </span>
              </div>

              <div className="admin-financial-card net-salary-card">
                <span className="admin-financial-lbl">Total Net Salary</span>
                <span className="admin-financial-val">{formatCurrency(payroll?.net_salary)}</span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* 6. Department Overview & Quick Actions */}
      <section className="admin-middle-grid">
        {/* Department Overview */}
        <div className="admin-card admin-overview-card">
          <div className="admin-card-header">
            <div className="admin-card-header-left">
              <h2 className="admin-card-title">Department Overview</h2>
              <p className="admin-card-subtitle">Distribution by organizational department</p>
            </div>
            <span className="admin-badge admin-badge-neutral">{employees?.total ?? 0} Total</span>
          </div>

          {departments?.length === 0 ? (
            <div className="admin-empty-state-box">
              <h3 className="admin-empty-state-title">No department data available.</h3>
            </div>
          ) : (
            <div className="admin-department-breakdown">
              {departments?.map((dept) => (
                <div key={dept.name} className="admin-dept-row">
                  <div className="admin-dept-info">
                    <div className="admin-dept-name-group">
                      <span
                        className="admin-dept-dot"
                        style={{ backgroundColor: dept.color }}
                        aria-hidden="true"
                      ></span>
                      <span className="admin-dept-name">{dept.name}</span>
                    </div>
                    <div className="admin-dept-counts">
                      <span className="admin-dept-count">
                        {dept.count} {dept.count === 1 ? 'employee' : 'employees'}
                      </span>
                      <span className="admin-dept-percentage">({dept.percentage}%)</span>
                    </div>
                  </div>
                  <div className="admin-progress-track">
                    <div
                      className="admin-progress-fill"
                      style={{
                        width: `${dept.percentage}%`,
                        backgroundColor: dept.color,
                      }}
                      role="progressbar"
                      aria-valuenow={dept.percentage}
                      aria-valuemin="0"
                      aria-valuemax="100"
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="admin-card admin-quick-actions-card">
          <div className="admin-card-header">
            <div>
              <h2 className="admin-card-title">Quick Actions</h2>
              <p className="admin-card-subtitle">Direct shortcuts to management functions</p>
            </div>
          </div>

          <div className="admin-quick-actions-list">
            <button
              type="button"
              className="admin-action-item"
              onClick={() => navigate('/admin/employees')}
            >
              <div className="admin-action-icon action-blue">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
              </div>
              <div className="admin-action-content">
                <span className="admin-action-title">Add / View Employees</span>
                <span className="admin-action-desc">Register or manage workforce staff</span>
              </div>
              <svg className="admin-action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              type="button"
              className="admin-action-item"
              onClick={() => navigate('/admin/attendance')}
            >
              <div className="admin-action-icon action-green">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <path d="m9 16 2 2 4-4" />
                </svg>
              </div>
              <div className="admin-action-content">
                <span className="admin-action-title">Manage Attendance</span>
                <span className="admin-action-desc">Review and record employee daily logs</span>
              </div>
              <svg className="admin-action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              type="button"
              className="admin-action-item"
              onClick={() => navigate('/admin/leaves')}
            >
              <div className="admin-action-icon action-purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="admin-action-content">
                <span className="admin-action-title">Manage Leaves</span>
                <span className="admin-action-desc">Review requests & approve allocations</span>
              </div>
              <svg className="admin-action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              type="button"
              className="admin-action-item"
              onClick={() => navigate('/admin/payroll')}
            >
              <div className="admin-action-icon action-amber">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                  <line x1="7" y1="15" x2="7.01" y2="15" />
                  <line x1="11" y1="15" x2="13" y2="15" />
                </svg>
              </div>
              <div className="admin-action-content">
                <span className="admin-action-title">Process Payroll</span>
                <span className="admin-action-desc">Compute monthly wages & generate payslips</span>
              </div>
              <svg className="admin-action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* 7. Recent Leave Requests */}
      <section className="admin-card" aria-label="Recent Leave Requests">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">Recent Leave Requests</h2>
            <p className="admin-card-subtitle">Pending and recent employee leave submissions</p>
          </div>
          <button
            type="button"
            className="admin-card-action-link"
            onClick={() => navigate('/admin/leaves')}
          >
            Manage All Leaves &rarr;
          </button>
        </div>

        {recent_leaves?.length === 0 ? (
          <div className="admin-empty-state-box">
            <h3 className="admin-empty-state-title">No recent leave requests.</h3>
            <p className="admin-empty-state-desc">Employee submitted leave applications will appear here.</p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">ID</th>
                  <th scope="col">Department</th>
                  <th scope="col">Leave Type</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Days</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {recent_leaves?.map((leave) => {
                  const statusClass = (leave.status || 'pending').toLowerCase();
                  return (
                    <tr key={leave.id}>
                      <td>
                        <span className="admin-user-name-strong">{leave.employee_name}</span>
                      </td>
                      <td>
                        <span className="admin-id-badge">{leave.employee_id}</span>
                      </td>
                      <td>
                        <span className="admin-dept-tag">{leave.department || 'General'}</span>
                      </td>
                      <td>
                        <span className="admin-leave-type-pill">{leave.leave_type}</span>
                      </td>
                      <td className="text-muted">
                        {formatDate(leave.start_date)} - {formatDate(leave.end_date)}
                      </td>
                      <td>
                        <span className="admin-days-pill">
                          {parseFloat(leave.days) || 1} {parseFloat(leave.days) === 1 ? 'Day' : 'Days'}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-status-badge status-${statusClass}`}>
                          <span className="status-dot" aria-hidden="true"></span>
                          {leave.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="admin-btn-action-view"
                          onClick={() => navigate('/admin/leaves')}
                          aria-label={`View leave request for ${leave.employee_name}`}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 8. Recent Payroll Activity */}
      <section className="admin-card" aria-label="Recent Payroll Activity">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">Recent Payroll Activity</h2>
            <p className="admin-card-subtitle">Latest processed and finalized payroll records</p>
          </div>
          <button
            type="button"
            className="admin-card-action-link"
            onClick={() => navigate('/admin/payroll')}
          >
            View All Payroll &rarr;
          </button>
        </div>

        {recent_payroll?.length === 0 ? (
          <div className="admin-empty-state-box">
            <h3 className="admin-empty-state-title">No recent payroll activity.</h3>
            <p className="admin-empty-state-desc">Processed monthly payroll activity will appear here.</p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Employee Name</th>
                  <th scope="col">Employee ID</th>
                  <th scope="col">Period</th>
                  <th scope="col">Net Salary</th>
                  <th scope="col">Status</th>
                  <th scope="col">Processed Date</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {recent_payroll?.map((pay) => {
                  const payMonthName = MONTH_NAMES[pay.month - 1] || `Month ${pay.month}`;
                  const statusClass = (pay.status || 'processed').toLowerCase();
                  return (
                    <tr key={pay.id}>
                      <td>
                        <span className="admin-user-name-strong">{pay.employee_name}</span>
                      </td>
                      <td>
                        <span className="admin-id-badge">{pay.employee_id}</span>
                      </td>
                      <td className="text-muted">
                        {payMonthName} {pay.year}
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: '#15803d' }}>
                          {formatCurrency(pay.net_salary)}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-status-badge status-${statusClass === 'paid' ? 'active' : 'pending'}`}>
                          <span className="status-dot" aria-hidden="true"></span>
                          {pay.status}
                        </span>
                      </td>
                      <td className="text-muted">
                        {formatDate(pay.processed_date)}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="admin-btn-action-view"
                          onClick={() => navigate('/admin/payroll')}
                          aria-label={`View payroll for ${pay.employee_name}`}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default Dashboard;
