import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';
import './Dashboard.css';

// Quick access navigation items
const QUICK_ACCESS_LINKS = [
  {
    title: 'My Profile',
    description: 'Personal & employment records',
    path: '/employee/profile',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    title: 'My Documents',
    description: 'Letters, payslips & policies',
    path: '/employee/documents',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: 'My Payslips',
    description: 'Monthly payroll & salary slips',
    path: '/employee/payslips',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
        <circle cx="7" cy="15" r="1.5" />
        <line x1="12" y1="15" x2="17" y2="15" />
      </svg>
    ),
  },
  {
    title: 'My Attendance',
    description: 'Monthly logs & daily check-in',
    path: '/employee/attendance',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: 'My Leaves',
    description: 'Leave balance & request history',
    path: '/employee/leaves',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    title: 'PF Details',
    description: 'Provident fund & contributions',
    path: '/employee/pf',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
        <line x1="7" y1="15" x2="7.01" y2="15" />
        <line x1="11" y1="15" x2="13" y2="15" />
      </svg>
    ),
  },
];

// Helper to determine greeting based on hour and first name
function getGreeting(hour, firstName) {
  let greet = 'Good morning';
  if (hour >= 12 && hour < 17) {
    greet = 'Good afternoon';
  } else if (hour >= 17) {
    greet = 'Good evening';
  }
  return firstName ? `${greet}, ${firstName}` : greet;
}

// Helper to format currency in Indian format
function formatCurrency(amount) {
  if (amount === undefined || amount === null || amount === '') return '—';
  const num = Number(amount);
  if (isNaN(num)) return '—';
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Helper to format calendar date (YYYY-MM-DD)
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const parts = String(dateStr).split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Helper for attendance badge class
function getAttendanceBadgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'present') return 'att-badge-present';
  if (s === 'absent') return 'att-badge-absent';
  if (s === 'half day') return 'att-badge-half-day';
  if (s === 'leave' || s === 'paid leave') return 'att-badge-leave';
  if (s === 'work from home') return 'att-badge-wfh';
  if (s === 'holiday') return 'att-badge-holiday';
  return 'att-badge-default';
}

// Helper for leave badge class
function getLeaveBadgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'approved') return 'leave-badge-approved';
  if (s === 'pending') return 'leave-badge-pending';
  if (s === 'rejected') return 'leave-badge-rejected';
  if (s === 'cancelled') return 'leave-badge-cancelled';
  return 'leave-badge-default';
}

// Document & Payslip Preview Modal Subcomponent
function DocumentPreviewModal({ doc, onClose, onDownload, isDownloading }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    let createdUrl = null;

    async function loadStream() {
      try {
        const isPayslip = doc.isPayslip || String(doc.document_type).toLowerCase() === 'payslip';
        const blob = isPayslip
          ? await api.employee.viewPayslip(doc.id)
          : await api.employee.viewDocument(doc.id);

        if (!isCancelled) {
          createdUrl = window.URL.createObjectURL(blob);
          setBlobUrl(createdUrl);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err?.message || 'Failed to securely preview file.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadStream();

    return () => {
      isCancelled = true;
      if (createdUrl) {
        window.URL.revokeObjectURL(createdUrl);
      }
    };
  }, [doc]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!doc) return null;

  return (
    <div
      className="dashboard-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
    >
      <div
        className="dashboard-modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dashboard-modal-header">
          <div className="dashboard-modal-header-titles">
            <h3 id="preview-modal-title" className="dashboard-modal-title">
              {doc.document_type || doc.file_name || 'Document Preview'}
            </h3>
            <span className="dashboard-modal-file">{doc.file_name}</span>
          </div>
          <button
            type="button"
            className="dashboard-modal-close"
            onClick={onClose}
            aria-label="Close document preview"
          >
            &times;
          </button>
        </div>

        <div className="dashboard-modal-body">
          {loading ? (
            <div className="modal-state-center">
              <div className="modal-spinner" aria-hidden="true"></div>
              <p className="modal-state-text">Retrieving file securely from private storage...</p>
            </div>
          ) : error ? (
            <div className="modal-state-center">
              <div className="modal-error-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h4 className="modal-error-title">Unable to preview document</h4>
              <p className="modal-error-desc">{error}</p>
            </div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              title={doc.file_name || 'Document Preview'}
              className="dashboard-preview-iframe"
            />
          ) : null}
        </div>

        <div className="dashboard-modal-footer">
          <button
            type="button"
            className="dashboard-modal-download-btn"
            disabled={isDownloading}
            onClick={() => onDownload(doc)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {isDownloading ? 'Downloading...' : 'Download File'}
          </button>
          <button
            type="button"
            className="dashboard-modal-btn"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Document / Payslip preview modal state
  const [previewDoc, setPreviewDoc] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);


  // Derive date string and hour once on mount to preserve purity
  const [currentDateInfo] = useState(() => {
    const now = new Date();
    return {
      hour: now.getHours(),
      formatted: now.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    };
  });

  // Fetch dashboard data on mount
  useEffect(() => {
    let ignore = false;

    async function loadData() {
      try {
        const res = await api.employee.getDashboard();
        if (!ignore) {
          if (res && res.success && res.data) {
            setDashboardData(res.data);
            setError(null);
          } else {
            setError(res?.message || 'Unable to retrieve dashboard metrics.');
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Failed to load employee dashboard. Please try again.');
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
  }, []);

  // Handle retry
  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.employee.getDashboard();
      if (res && res.success && res.data) {
        setDashboardData(res.data);
      } else {
        setError(res?.message || 'Unable to retrieve dashboard metrics.');
      }
    } catch (err) {
      setError(err?.message || 'Failed to load employee dashboard. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle direct file download
  const handleDownload = async (doc, isPayslip = false) => {
    if (!doc || !doc.id) return;
    try {
      setDownloadingId(doc.id);
      const isSlip = isPayslip || doc.isPayslip || String(doc.document_type).toLowerCase() === 'payslip';
      const blob = isSlip
        ? await api.employee.downloadPayslip(doc.id)
        : await api.employee.downloadDocument(doc.id);

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', doc.file_name || (isSlip ? 'payslip.pdf' : 'document.pdf'));
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Download failed: ${err?.message || 'Could not download file.'}`);
    } finally {
      setDownloadingId(null);
    }
  };

  // Render Skeleton Loader while initial data is being fetched
  if (loading) {
    return (
      <div className="employee-dashboard-page" aria-busy="true" aria-label="Loading Employee Dashboard">
        <header className="dashboard-welcome-header">
          <div className="skeleton skeleton-title" style={{ width: '280px', height: '32px' }} />
          <div className="skeleton skeleton-subtitle" style={{ width: '380px', height: '18px', marginTop: '8px' }} />
        </header>

        <section className="dashboard-summary-cards">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="summary-stat-card skeleton-card">
              <div className="skeleton skeleton-text" style={{ width: '40%', height: '14px' }} />
              <div className="skeleton skeleton-val" style={{ width: '60%', height: '28px', marginTop: '12px' }} />
              <div className="skeleton skeleton-sub" style={{ width: '80%', height: '12px', marginTop: '8px' }} />
            </div>
          ))}
        </section>

        <section className="dashboard-section-card skeleton-card">
          <div className="skeleton skeleton-title" style={{ width: '200px', height: '22px' }} />
          <div className="overview-data-grid" style={{ marginTop: '16px' }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="overview-data-field">
                <div className="skeleton skeleton-text" style={{ width: '50%', height: '12px' }} />
                <div className="skeleton skeleton-val" style={{ width: '80%', height: '18px', marginTop: '6px' }} />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  // Render Error state if data fetch fails
  if (error || !dashboardData) {
    return (
      <div className="employee-dashboard-page">
        <div className="dashboard-error-banner" role="alert">
          <div className="dashboard-error-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="dashboard-error-content">
            <h2 className="dashboard-error-title">Unable to Load Dashboard</h2>
            <p className="dashboard-error-desc">{error || 'An unexpected error occurred while connecting to the server.'}</p>
            <button type="button" className="dashboard-retry-btn" onClick={handleRetry}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const {
    profile = {},
    counts = {},
    today_attendance = {},
    attendance_summary = {},
    recent_attendance = [],
    leave_summary = {},
    recent_leaves = [],
    latest_payslip: latestPayslip = null,
    recent_documents = [],
    pf_summary = null,
    birthday_employees: birthdayEmployees = [],
    birthday_month_name: birthdayMonthName = '',
  } = dashboardData;

  const todayBirthdays = birthdayEmployees.filter((b) => b.is_today);

  const greeting = getGreeting(currentDateInfo.hour, profile.first_name);

  // Overview fields
  const overviewFields = [
    { label: 'Employee ID', value: profile.employee_id || '—' },
    { label: 'Department', value: profile.department || '—' },
    { label: 'Designation', value: profile.designation || '—' },
    { label: 'Date of Joining', value: formatDate(profile.date_of_joining) },
    { label: 'Employment Type', value: profile.employment_type || 'Full Time' },
    { label: 'Work Location', value: profile.work_location || 'Hyderabad' },
    { label: 'Email', value: profile.email || '—' },
    { label: 'Employment Status', value: profile.employment_status || 'Active', isStatus: true },
  ];

  return (
    <div className="employee-dashboard-page">
      {/* Dashboard Header */}
      <header className="dashboard-welcome-header">
        <div className="dashboard-welcome-titles">
          <h1 className="dashboard-welcome-title">
            {greeting} <span aria-hidden="true">👋</span>
          </h1>
          <p className="dashboard-welcome-subtitle">
            Welcome to your employee portal. Here is a live overview of your profile and records.
          </p>
        </div>
        <div className="dashboard-header-badge" aria-label="Today's Date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{currentDateInfo.formatted}</span>
        </div>
      </header>

      {/* Top Summary Cards */}
      <section className="dashboard-summary-cards" aria-label="Key Performance Indicators">
        {/* Card 1: Employee Identity */}
        <div className="summary-stat-card">
          <div className="summary-card-header">
            <span className="summary-card-title">Employee</span>
            <div className="summary-card-icon-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          </div>
          <div className="summary-card-content">
            <span className="summary-main-val">{profile.employee_id}</span>
            <span className="summary-sub-val">{profile.designation || '—'}</span>
          </div>
        </div>

        {/* Card 2: Today's Attendance */}
        <div className="summary-stat-card">
          <div className="summary-card-header">
            <span className="summary-card-title">Today's Attendance</span>
            <div className="summary-card-icon-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          </div>
          <div className="summary-card-content">
            <div className="summary-today-row">
              <span className={`att-badge ${getAttendanceBadgeClass(today_attendance.status)}`}>
                <span className="att-badge-dot" aria-hidden="true"></span>
                {today_attendance.status || 'Not Marked'}
              </span>
            </div>
            <span className="summary-sub-val">
              {today_attendance.marked ? 'Attendance recorded for today' : 'No check-in recorded today'}
            </span>
          </div>
        </div>

        {/* Card 3: Leave Summary */}
        <div className="summary-stat-card">
          <div className="summary-card-header">
            <span className="summary-card-title">Leaves Approved</span>
            <div className="summary-card-icon-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          <div className="summary-card-content">
            <span className="summary-main-val">
              {leave_summary.approved_days || 0} <span className="val-unit">Days</span>
            </span>
            <span className="summary-sub-val">
              {leave_summary.pending_count > 0
                ? `${leave_summary.pending_count} pending request(s)`
                : 'No pending leave requests'}
            </span>
          </div>
        </div>

        {/* Card 4: Documents Count */}
        <div className="summary-stat-card">
          <div className="summary-card-header">
            <span className="summary-card-title">Documents</span>
            <div className="summary-card-icon-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
          </div>
          <div className="summary-card-content">
            <span className="summary-main-val">{counts.document_count || 0}</span>
            <span className="summary-sub-val">Documents on record</span>
          </div>
        </div>
      </section>

      {/* Employee Overview Section */}
      <section className="dashboard-section-card" aria-labelledby="employee-overview-heading">
        <div className="dashboard-card-header">
          <div className="card-header-titles">
            <h2 id="employee-overview-heading" className="dashboard-card-title">
              Employee Overview
            </h2>
            <p className="dashboard-card-subtitle">Key organizational assignments and employment details</p>
          </div>
          <Link to="/employee/profile" className="view-all-link">
            View full profile &rarr;
          </Link>
        </div>

        <div className="overview-data-grid">
          {overviewFields.map((field) => (
            <div key={field.label} className="overview-data-field">
              <span className="overview-field-label">{field.label}</span>
              {field.isStatus ? (
                <span className="status-badge status-badge-active">
                  <span className="status-badge-dot" aria-hidden="true"></span>
                  {field.value}
                </span>
              ) : (
                <span className="overview-field-value">{field.value}</span>
              )}
            </div>
          ))}
        </div>
      </section>


      {/* Two-Column Grid: Latest Payslip & PF Summary */}
      <div className="dashboard-columns-grid">
        {/* Latest Payslip Section */}
        <section className="dashboard-section-card" aria-labelledby="latest-payslip-heading">
          <div className="dashboard-card-header">
            <div className="card-header-titles">
              <h2 id="latest-payslip-heading" className="dashboard-card-title">
                Latest Payslip
              </h2>
              <p className="dashboard-card-subtitle">
                {latestPayslip ? `${latestPayslip.month_name || ''} ${latestPayslip.year || ''} Payroll` : 'Recent salary breakdown'}
              </p>
            </div>
            <Link to="/employee/payslips" className="view-all-link">
              View all payslips &rarr;
            </Link>
          </div>

          {latestPayslip ? (
            <div className="latest-payslip-container">
              <div className="payslip-highlight-banner">
                <div className="payslip-highlight-left">
                  <span className="payslip-period-label">
                    {latestPayslip.month_name ? `${latestPayslip.month_name} ${latestPayslip.year}` : latestPayslip.file_name}
                  </span>
                  <div className="payslip-net-amount">
                    {formatCurrency(latestPayslip.net_salary)}
                  </div>
                  <span className="payslip-net-sublabel">Net Salary Disbursed</span>
                </div>
                <div className="payslip-status-pill">
                  <span className="status-badge-dot" aria-hidden="true"></span>
                  {latestPayslip.status}
                </div>
              </div>

              <div className="payslip-stats-row">
                <div className="payslip-stat-box">
                  <span className="payslip-stat-label">Gross Salary</span>
                  <span className="payslip-stat-val">{formatCurrency(latestPayslip.gross_salary)}</span>
                </div>
                <div className="payslip-stat-box">
                  <span className="payslip-stat-label">Total Deductions</span>
                  <span className="payslip-stat-val payslip-val-deduction">
                    {formatCurrency(latestPayslip.total_deductions)}
                  </span>
                </div>
                <div className="payslip-stat-box">
                  <span className="payslip-stat-label">Payable Days</span>
                  <span className="payslip-stat-val">
                    {latestPayslip.payable_days ? `${latestPayslip.payable_days} Days` : '—'}
                  </span>
                </div>
              </div>

              <div className="payslip-action-buttons">
                <button
                  type="button"
                  className="payslip-btn-action payslip-btn-view"
                  onClick={() => setPreviewDoc({ ...latestPayslip, isPayslip: true })}
                  aria-label="Preview payslip PDF"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  Preview Payslip
                </button>
                <button
                  type="button"
                  className="payslip-btn-action payslip-btn-download"
                  disabled={downloadingId === latestPayslip.id}
                  onClick={() => handleDownload(latestPayslip, true)}
                  aria-label="Download payslip PDF"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {downloadingId === latestPayslip.id ? 'Downloading...' : 'Download PDF'}
                </button>
              </div>
            </div>
          ) : (
            <div className="dashboard-empty-card">
              <div className="dashboard-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <h3 className="dashboard-empty-title">No Payslips Generated Yet</h3>
              <p className="dashboard-empty-desc">
                Your monthly salary slips will appear here once payroll processing is finalized.
              </p>
            </div>
          )}
        </section>

        {/* PF Details Section */}
        <section className="dashboard-section-card" aria-labelledby="pf-details-heading">
          <div className="dashboard-card-header">
            <div className="card-header-titles">
              <h2 id="pf-details-heading" className="dashboard-card-title">
                PF & Pension Summary
              </h2>
              <p className="dashboard-card-subtitle">Provident fund registration records</p>
            </div>
            <Link to="/employee/pf" className="view-all-link">
              View details &rarr;
            </Link>
          </div>

          {pf_summary ? (
            <div className="pf-summary-grid">
              <div className="pf-summary-field">
                <span className="pf-summary-label">UAN Number</span>
                <span className="pf-summary-value">{pf_summary.uan_number || '—'}</span>
              </div>
              <div className="pf-summary-field">
                <span className="pf-summary-label">PF Number</span>
                <span className="pf-summary-value">{pf_summary.pf_number || '—'}</span>
              </div>
              <div className="pf-summary-field">
                <span className="pf-summary-label">Pension Number</span>
                <span className="pf-summary-value">{pf_summary.pension_number || '—'}</span>
              </div>
            </div>
          ) : (
            <div className="dashboard-empty-card">
              <div className="dashboard-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <h3 className="dashboard-empty-title">PF Details Not Registered</h3>
              <p className="dashboard-empty-desc">
                Your Provident Fund account information has not been enrolled yet. Please reach out to HR for assistance.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Two-Column Grid: Attendance Summary & Recent Leaves */}
      <div className="dashboard-columns-grid">
        {/* Attendance Summary Section */}
        <section className="dashboard-section-card" aria-labelledby="attendance-heading">
          <div className="dashboard-card-header">
            <div className="card-header-titles">
              <h2 id="attendance-heading" className="dashboard-card-title">
                Monthly Attendance
              </h2>
              <p className="dashboard-card-subtitle">
                {attendance_summary.month_name ? `${attendance_summary.month_name} ${attendance_summary.year}` : 'Current Month'} breakdown
              </p>
            </div>
            <Link to="/employee/attendance" className="view-all-link">
              Full calendar &rarr;
            </Link>
          </div>

          <div className="att-metrics-grid">
            <div className="att-metric-pill att-metric-present">
              <span className="att-metric-num">{attendance_summary.present || 0}</span>
              <span className="att-metric-lbl">Present</span>
            </div>
            <div className="att-metric-pill att-metric-absent">
              <span className="att-metric-num">{attendance_summary.absent || 0}</span>
              <span className="att-metric-lbl">Absent</span>
            </div>
            <div className="att-metric-pill att-metric-half">
              <span className="att-metric-num">{attendance_summary.half_day || 0}</span>
              <span className="att-metric-lbl">Half Day</span>
            </div>
            <div className="att-metric-pill att-metric-leave">
              <span className="att-metric-num">{attendance_summary.leave || 0}</span>
              <span className="att-metric-lbl">Leave</span>
            </div>
            <div className="att-metric-pill att-metric-wfh">
              <span className="att-metric-num">{attendance_summary.work_from_home || 0}</span>
              <span className="att-metric-lbl">WFH</span>
            </div>
            <div className="att-metric-pill att-metric-holiday">
              <span className="att-metric-num">{attendance_summary.holiday || 0}</span>
              <span className="att-metric-lbl">Holidays</span>
            </div>
          </div>

          <div className="recent-list-container">
            <h3 className="recent-list-heading">Recent Attendance Logs</h3>
            {recent_attendance && recent_attendance.length > 0 ? (
              <div className="recent-att-list">
                {recent_attendance.map((log) => (
                  <div key={log.id} className="recent-att-row">
                    <div className="recent-att-date">
                      <span className="recent-att-cal-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </span>
                      <span>{formatDate(log.date)}</span>
                    </div>
                    <span className={`att-badge ${getAttendanceBadgeClass(log.status)}`}>
                      <span className="att-badge-dot" aria-hidden="true"></span>
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="recent-list-empty">No recent attendance records recorded.</p>
            )}
          </div>
        </section>

        {/* Leave Requests Section */}
        <section className="dashboard-section-card" aria-labelledby="leaves-heading">
          <div className="dashboard-card-header">
            <div className="card-header-titles">
              <h2 id="leaves-heading" className="dashboard-card-title">
                Leave Requests
              </h2>
              <p className="dashboard-card-subtitle">Recent leave requests & approval status</p>
            </div>
            <Link to="/employee/leaves" className="view-all-link">
              Apply leave &rarr;
            </Link>
          </div>

          <div className="leave-summary-strip">
            <div className="leave-strip-item">
              <span className="leave-strip-num">{leave_summary.approved_count || 0}</span>
              <span className="leave-strip-lbl">Approved</span>
            </div>
            <div className="leave-strip-item">
              <span className="leave-strip-num">{leave_summary.pending_count || 0}</span>
              <span className="leave-strip-lbl">Pending</span>
            </div>
            <div className="leave-strip-item">
              <span className="leave-strip-num">{leave_summary.rejected_count || 0}</span>
              <span className="leave-strip-lbl">Rejected</span>
            </div>
            <div className="leave-strip-item">
              <span className="leave-strip-num">{leave_summary.approved_days || 0}</span>
              <span className="leave-strip-lbl">Approved Days</span>
            </div>
          </div>

          <div className="recent-list-container">
            <h3 className="recent-list-heading">Recent Leave Requests</h3>
            {recent_leaves && recent_leaves.length > 0 ? (
              <div className="recent-leave-list">
                {recent_leaves.map((leave) => (
                  <div key={leave.id} className="recent-leave-row">
                    <div className="recent-leave-info">
                      <div className="recent-leave-top">
                        <span className="leave-type-pill">{leave.leave_type}</span>
                        <span className="leave-dates-text">
                          {formatDate(leave.start_date)}
                          {leave.start_date !== leave.end_date && ` - ${formatDate(leave.end_date)}`}
                          <span className="leave-days-count"> ({parseFloat(leave.days)} {parseFloat(leave.days) === 1 ? 'day' : 'days'})</span>
                        </span>
                      </div>
                      {leave.reason && (
                        <p className="recent-leave-reason" title={leave.reason}>
                          {leave.reason}
                        </p>
                      )}
                    </div>
                    <span className={`leave-status-badge ${getLeaveBadgeClass(leave.status)}`}>
                      <span className="status-indicator-dot" aria-hidden="true"></span>
                      {leave.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="recent-list-empty">No leave requests have been logged yet.</p>
            )}
          </div>
        </section>
      </div>

      {/* Employee Birthdays Section */}
      <section className="dashboard-section-card birthday-section-card" aria-labelledby="birthday-section-heading">
        <div className="dashboard-card-header">
          <div className="card-header-titles">
            <h2 id="birthday-section-heading" className="dashboard-card-title">
              🎂 Birthdays This Month {birthdayMonthName ? `· ${birthdayMonthName}` : ''}
            </h2>
            <p className="dashboard-card-subtitle">
              Celebrating team members born in {birthdayMonthName || 'this month'}
            </p>
          </div>
        </div>

        {todayBirthdays.length > 0 && (
          <div className="birthday-today-highlight-banner" role="status" aria-label="Today's Birthday">
            <div className="birthday-today-sparkle" aria-hidden="true">🎉</div>
            <div className="birthday-today-info">
              {todayBirthdays.map((b, idx) => (
                <div key={idx} className="birthday-today-item">
                  <h3 className="birthday-today-greeting">
                    Happy Birthday, {b.employee_name}!
                  </h3>
                  <p className="birthday-today-sub">
                    Today · {b.designation || 'Team Member'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {birthdayEmployees.length === 0 ? (
          <div className="birthday-empty-state">
            <div className="birthday-empty-icon" aria-hidden="true">
              🎂
            </div>
            <h3 className="birthday-empty-title">No employee birthdays this month.</h3>
            <p className="birthday-empty-desc">
              There are no team birthdays scheduled for {birthdayMonthName || 'this month'}.
            </p>
          </div>
        ) : (
          <div className="birthday-cards-grid">
            {birthdayEmployees.map((b, idx) => (
              <div
                key={idx}
                className={`birthday-card ${b.is_today ? 'birthday-card-active-today' : ''}`}
              >
                <div className="birthday-card-badge" aria-label={`Birthday: ${b.birthday_label}`}>
                  <span className="birthday-card-day">{String(b.birthday_day).padStart(2, '0')}</span>
                  <span className="birthday-card-month">{birthdayMonthName ? birthdayMonthName.slice(0, 3).toUpperCase() : 'BDAY'}</span>
                </div>
                <div className="birthday-card-details">
                  <div className="birthday-card-name-row">
                    <h3 className="birthday-card-name">{b.employee_name}</h3>
                    {b.is_today && (
                      <span className="birthday-badge-today">🎉 Today!</span>
                    )}
                  </div>
                  <p className="birthday-card-designation">{b.designation || 'Team Member'}</p>
                  <span className="birthday-card-label-full">{b.birthday_label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Two-Column Grid: Recent Documents & Quick Access */}
      <div className="dashboard-columns-grid">
        {/* Recent Documents Section */}
        <section className="dashboard-section-card" aria-labelledby="recent-documents-heading">
          <div className="dashboard-card-header">
            <div className="card-header-titles">
              <h2 id="recent-documents-heading" className="dashboard-card-title">
                Recent Documents
              </h2>
              <p className="dashboard-card-subtitle">Official letters and employment files</p>
            </div>
            <Link to="/employee/documents" className="view-all-link">
              View all documents &rarr;
            </Link>
          </div>

          {recent_documents && recent_documents.length > 0 ? (
            <div className="recent-documents-list">
              {recent_documents.map((doc) => (
                <div key={doc.id} className="recent-doc-row">
                  <div className="recent-doc-info">
                    <div className="recent-doc-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="recent-doc-text">
                      <span className="recent-doc-name">{doc.document_type || 'Document'}</span>
                      <span className="recent-doc-file">{doc.file_name}</span>
                    </div>
                  </div>

                  <div className="recent-doc-actions">
                    <button
                      type="button"
                      className="recent-doc-view-btn"
                      onClick={() => setPreviewDoc(doc)}
                      aria-label={`View ${doc.file_name}`}
                    >
                      <svg className="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      View
                    </button>
                    <button
                      type="button"
                      className="recent-doc-download-btn"
                      disabled={downloadingId === doc.id}
                      onClick={() => handleDownload(doc)}
                      aria-label={`Download ${doc.file_name}`}
                    >
                      <svg className="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty-card">
              <div className="dashboard-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                </svg>
              </div>
              <h3 className="dashboard-empty-title">No Documents Available</h3>
              <p className="dashboard-empty-desc">
                Your uploaded documents and company issued files will be listed here.
              </p>
            </div>
          )}
        </section>

        {/* Quick Access Section */}
        <section className="dashboard-section-card" aria-labelledby="quick-access-heading">
          <div className="dashboard-card-header">
            <div className="card-header-titles">
              <h2 id="quick-access-heading" className="dashboard-card-title">
                Quick Access
              </h2>
              <p className="dashboard-card-subtitle">Shortcuts to key employee sections</p>
            </div>
          </div>

          <div className="quick-access-grid">
            {QUICK_ACCESS_LINKS.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="quick-access-card"
                aria-label={`Navigate to ${link.title}`}
              >
                <div className="quick-access-icon-box" aria-hidden="true">
                  {link.icon}
                </div>
                <div className="quick-access-content">
                  <span className="quick-access-title">{link.title}</span>
                  <span className="quick-access-desc">{link.description}</span>
                </div>
                <svg
                  className="quick-access-chevron"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Document / Payslip Preview Modal */}
      {previewDoc && (
        <DocumentPreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onDownload={handleDownload}
          isDownloading={downloadingId === previewDoc.id}
        />
      )}

    </div>
  );
}

export default Dashboard;
