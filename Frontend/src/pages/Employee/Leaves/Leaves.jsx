import { useState, useMemo, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import './Leaves.css';

// Helper to render accessible status badge
function LeaveStatusBadge({ status }) {
  const statusKey = (status || '').toLowerCase();
  let badgeClass = 'status-badge-approved';

  if (statusKey === 'pending') {
    badgeClass = 'status-badge-pending';
  } else if (statusKey === 'rejected' || statusKey === 'cancelled') {
    badgeClass = 'status-badge-rejected';
  }

  return (
    <span className={`leave-status-badge ${badgeClass}`}>
      <span className="status-indicator-dot" aria-hidden="true"></span>
      {status}
    </span>
  );
}

// Reusable Leave Summary / Balance Card (derived accurately from real employee records)
function LeaveBalanceCard({ item }) {
  const usagePercentage =
    item.totalDays > 0 ? Math.round((item.approvedDays / item.totalDays) * 100) : 0;

  return (
    <div className={`leave-balance-card leave-balance-${item.id}`}>
      <div className="balance-card-header">
        <div className="balance-code-badge" aria-hidden="true">
          {item.code}
        </div>
        <div className="balance-header-text">
          <h3 className="balance-type-name">{item.name}</h3>
          <span className="balance-allocated-text">
            {item.totalRequests} {item.totalRequests === 1 ? 'request' : 'requests'} logged
          </span>
        </div>
      </div>

      <div className="balance-main-metric">
        <div className="remaining-stat-group">
          <span className="remaining-number">{item.approvedDays}</span>
          <span className="remaining-label">Days Approved</span>
        </div>
        <div className="used-stat-group">
          <span className="used-number">{item.pendingDays}</span>
          <span className="used-label">Days Pending</span>
        </div>
      </div>

      <div className="balance-progress-track" aria-hidden="true">
        <div
          className="balance-progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, usagePercentage))}%` }}
        />
      </div>
    </div>
  );
}

// Helper to safely calculate calendar days between two YYYY-MM-DD dates without timezone shift
function calculateDays(startDate, endDate) {
  if (!startDate || !endDate) return 1;
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 1;
  const startUtc = Date.UTC(y1, m1 - 1, d1);
  const endUtc = Date.UTC(y2, m2 - 1, d2);
  if (endUtc < startUtc) return 1;
  const diffDays = Math.round((endUtc - startUtc) / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

// Helper to get local date in YYYY-MM-DD format
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Normalizes date fields from backend (handling both ISO strings and YYYY-MM-DD calendar dates)
function normalizeCalendarDate(val) {
  if (!val) return '—';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Maps backend leave records to frontend display model
function mapBackendLeave(record) {
  return {
    id: record.id,
    employeeId: record.employee_id,
    leaveType: record.leave_type,
    startDate: normalizeCalendarDate(record.start_date),
    endDate: normalizeCalendarDate(record.end_date),
    days: Number(record.days || record.number_of_days || 1),
    reason: record.reason || '—',
    status: record.status || 'Pending',
    adminComment: record.admin_comment || record.admin_remarks || '',
    reviewedBy: record.reviewed_by,
    requestedAt: record.requested_at || record.created_at,
    reviewedAt: record.reviewed_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function Leaves() {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeType, setNoticeType] = useState('success');
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [formError, setFormError] = useState(null);

  // Form state for new leave request
  const [applyForm, setApplyForm] = useState({
    leaveType: 'PL',
    startDate: getTodayDateString(),
    endDate: getTodayDateString(),
    reason: '',
  });

  // Calculate days for current form inputs
  const calculatedDays = useMemo(() => {
    return calculateDays(applyForm.startDate, applyForm.endDate);
  }, [applyForm.startDate, applyForm.endDate]);

  // Fetch leave history from real backend API
  const fetchLeaves = useCallback(async () => {
    try {
      const response = await api.employee.getLeaves();
      if (response && response.success && Array.isArray(response.data)) {
        setLeaves(response.data.map(mapBackendLeave));
        setError(null);
      } else {
        setLeaves([]);
      }
    } catch (err) {
      setError(err?.message || 'Unable to load leave history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const response = await api.employee.getLeaves();
        if (!ignore) {
          if (response && response.success && Array.isArray(response.data)) {
            setLeaves(response.data.map(mapBackendLeave));
            setError(null);
          } else {
            setLeaves([]);
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Unable to load leave history. Please try again.');
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
  }, []);

  // Summary counts calculated safely from the real employee leave history
  const employeeBalances = useMemo(() => {
    const categories = [
      { id: 'pl', code: 'PL', name: 'Paid Leave' },
      { id: 'upl', code: 'UPL', name: 'Unpaid Leave' },
      { id: 'sick', code: 'SL', name: 'Sick Leave' },
    ];

    return categories.map((cat) => {
      const matchType = (lt) => {
        if (!lt) return false;
        const lower = lt.trim().toLowerCase();
        if (cat.id === 'pl') return lower === 'pl' || lower === 'paid leave';
        if (cat.id === 'upl') return lower === 'upl' || lower === 'unpaid leave';
        if (cat.id === 'sick') return lower === 'sick leave' || lower === 'sl';
        return false;
      };

      const matchedLeaves = leaves.filter((l) => matchType(l.leaveType));
      const approvedDays = matchedLeaves
        .filter((l) => l.status === 'Approved')
        .reduce((sum, l) => sum + (Number(l.days) || 0), 0);
      const pendingDays = matchedLeaves
        .filter((l) => l.status === 'Pending')
        .reduce((sum, l) => sum + (Number(l.days) || 0), 0);
      const totalRequests = matchedLeaves.length;
      const totalDays = approvedDays + pendingDays;

      return {
        id: cat.id,
        code: cat.code,
        name: cat.name,
        approvedDays,
        pendingDays,
        totalRequests,
        totalDays,
      };
    });
  }, [leaves]);

  const handleApplyClick = () => {
    const today = getTodayDateString();
    setApplyForm({
      leaveType: 'PL',
      startDate: today,
      endDate: today,
      reason: '',
    });
    setFormError(null);
    setIsApplyModalOpen(true);
  };

  const handleCloseNotice = () => {
    setNoticeMessage('');
  };

  // Submit Leave Request to Backend API
  const handleSubmitLeave = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!applyForm.startDate || !applyForm.endDate) {
      setFormError('Please select valid start and end dates.');
      return;
    }

    if (applyForm.startDate > applyForm.endDate) {
      setFormError('Start date cannot be after end date.');
      return;
    }

    if (!applyForm.reason.trim()) {
      setFormError('Please provide a reason for your leave request.');
      return;
    }

    try {
      setIsSubmitting(true);
      await api.employee.createLeave({
        leave_type: applyForm.leaveType,
        start_date: applyForm.startDate,
        end_date: applyForm.endDate,
        reason: applyForm.reason.trim(),
      });

      setIsApplyModalOpen(false);
      setNoticeType('success');
      setNoticeMessage('Leave request submitted successfully.');
      await fetchLeaves();
    } catch (err) {
      setFormError(err?.message || 'Failed to submit leave request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel Pending Leave Request via Backend API
  const handleCancelLeave = async (leaveId) => {
    if (!window.confirm('Are you sure you want to cancel this leave request?')) {
      return;
    }

    try {
      setCancellingId(leaveId);
      await api.employee.cancelLeave(leaveId);
      setNoticeType('success');
      setNoticeMessage('Leave request cancelled successfully.');
      await fetchLeaves();
    } catch (err) {
      setNoticeType('error');
      setNoticeMessage(err?.message || 'Failed to cancel leave request.');
    } finally {
      setCancellingId(null);
    }
  };

  // Filtered leave history using search and filter dropdowns
  const filteredHistory = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return leaves.filter((item) => {
      const matchesType =
        typeFilter === 'All' ||
        item.leaveType === typeFilter ||
        (typeFilter === 'PL' && item.leaveType === 'PL') ||
        (typeFilter === 'UPL' && item.leaveType === 'UPL') ||
        (typeFilter === 'Sick Leave' && item.leaveType === 'Sick Leave');

      const matchesStatus =
        statusFilter === 'All' ||
        item.status?.toLowerCase() === statusFilter.toLowerCase();

      const matchesQuery =
        !query ||
        item.id.toLowerCase().includes(query) ||
        item.leaveType.toLowerCase().includes(query) ||
        item.reason.toLowerCase().includes(query) ||
        item.status.toLowerCase().includes(query) ||
        item.startDate.toLowerCase().includes(query) ||
        item.endDate.toLowerCase().includes(query);

      return matchesType && matchesStatus && matchesQuery;
    });
  }, [leaves, searchTerm, typeFilter, statusFilter]);

  const hasActiveFilters =
    searchTerm !== '' || typeFilter !== 'All' || statusFilter !== 'All';

  const handleResetFilters = () => {
    setSearchTerm('');
    setTypeFilter('All');
    setStatusFilter('All');
  };

  return (
    <div className="employee-leaves-page">
      {/* Page Header */}
      <header className="leaves-page-header">
        <div className="leaves-header-titles">
          <h1 className="leaves-page-title">My Leaves</h1>
          <p className="leaves-page-subtitle">
            View your leave balance and leave history.
          </p>
        </div>

        {/* Apply for Leave Button */}
        <button
          type="button"
          className="leaves-apply-button"
          onClick={handleApplyClick}
          aria-label="Apply for Leave"
        >
          <svg
            className="leaves-btn-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Apply for Leave
        </button>
      </header>

      {/* Temporary Feedback Notification */}
      {noticeMessage && (
        <div
          className="leaves-notice-banner"
          role="status"
          aria-live="polite"
          style={
            noticeType === 'error'
              ? { backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }
              : undefined
          }
        >
          <div className="leaves-notice-content">
            <svg
              className="leaves-notice-icon"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              style={noticeType === 'error' ? { color: '#dc2626' } : undefined}
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
            <span>{noticeMessage}</span>
          </div>
          <button
            type="button"
            className="leaves-notice-dismiss"
            onClick={handleCloseNotice}
            aria-label="Dismiss notice"
            style={noticeType === 'error' ? { color: '#991b1b' } : undefined}
          >
            &times;
          </button>
        </div>
      )}

      {/* Section 1: Leave Balance / Summary */}
      <section className="leave-balance-section" aria-labelledby="leave-balance-heading">
        <div className="section-title-row">
          <h2 id="leave-balance-heading" className="leaves-section-title">
            Leave Balance
          </h2>
          <span className="leaves-section-meta">Overview from leave history</span>
        </div>

        <div className="leave-balance-grid">
          {employeeBalances.map((item) => (
            <LeaveBalanceCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      {/* Section 2: Leave History */}
      <section className="leave-history-section" aria-labelledby="leave-history-heading">
        <div className="section-title-row">
          <h2 id="leave-history-heading" className="leaves-section-title">
            Leave History
          </h2>
          <span className="leaves-section-count">
            {filteredHistory.length} {filteredHistory.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="leaves-controls-card">
          <div className="leaves-search-box">
            <label htmlFor="leave-search-input" className="visually-hidden">
              Search leave history
            </label>
            <div className="leaves-input-wrapper">
              <svg
                className="search-input-svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                id="leave-search-input"
                type="text"
                placeholder="Search leave history..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="leaves-search-input"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="leaves-clear-btn"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear search input"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          <div className="leaves-filter-group">
            {/* Filter by Leave Type */}
            <div className="filter-select-wrapper">
              <label htmlFor="leave-type-filter" className="filter-select-label">
                Type:
              </label>
              <select
                id="leave-type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="leaves-select"
              >
                <option value="All">All Types</option>
                <option value="PL">Paid Leave (PL)</option>
                <option value="UPL">Unpaid Leave (UPL)</option>
                <option value="Sick Leave">Sick Leave</option>
              </select>
            </div>

            {/* Filter by Status */}
            <div className="filter-select-wrapper">
              <label htmlFor="leave-status-filter" className="filter-select-label">
                Status:
              </label>
              <select
                id="leave-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="leaves-select"
              >
                <option value="All">All Statuses</option>
                <option value="Approved">Approved</option>
                <option value="Pending">Pending</option>
                <option value="Rejected">Rejected</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="leaves-reset-filters-btn"
                onClick={handleResetFilters}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div
            className="leaves-loading-state"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3.5rem 1.5rem',
              backgroundColor: '#ffffff',
              borderRadius: '0.75rem',
              border: '1px solid #e5e7eb',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                border: '3px solid #e5e7eb',
                borderTopColor: '#2563eb',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{ marginTop: '0.875rem', color: '#6b7280', fontSize: '0.875rem' }}>
              Loading leave history...
            </p>
          </div>
        ) : error ? (
          /* Error State */
          <div
            style={{
              padding: '2rem 1.5rem',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '0.75rem',
              textAlign: 'center',
              color: '#991b1b',
            }}
          >
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{error}</p>
            <button
              type="button"
              className="empty-state-reset-btn"
              onClick={fetchLeaves}
              style={{ marginTop: '0.5rem' }}
            >
              Retry
            </button>
          </div>
        ) : filteredHistory.length > 0 ? (
          /* Leave History Table / Card List */
          <div className="leave-table-card">
            {/* Desktop / Tablet Table View */}
            <div className="leave-table-container">
              <table className="leave-table" aria-label="Leave History Table">
                <thead>
                  <tr>
                    <th scope="col">Leave ID</th>
                    <th scope="col">Leave Type</th>
                    <th scope="col">Start Date</th>
                    <th scope="col">End Date</th>
                    <th scope="col" className="text-center">Days</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((item) => (
                    <tr key={item.id}>
                      <td
                        className="cell-leave-id"
                        title={item.id}
                        style={{
                          maxWidth: '120px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.id}
                      </td>
                      <td className="cell-leave-type">
                        <span className="type-badge">{item.leaveType}</span>
                      </td>
                      <td>{item.startDate}</td>
                      <td>{item.endDate}</td>
                      <td className="text-center cell-days">
                        {item.days} {item.days === 1 ? 'day' : 'days'}
                      </td>
                      <td className="cell-reason">{item.reason}</td>
                      <td>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <LeaveStatusBadge status={item.status} />
                          {item.status === 'Pending' && (
                            <button
                              type="button"
                              className="leave-cancel-btn"
                              disabled={cancellingId === item.id}
                              onClick={() => handleCancelLeave(item.id)}
                              aria-label={`Cancel leave request ${item.id}`}
                              style={{
                                padding: '0.25rem 0.5rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: '#dc2626',
                                backgroundColor: '#fef2f2',
                                border: '1px solid #fecaca',
                                borderRadius: '0.375rem',
                                cursor: cancellingId === item.id ? 'not-allowed' : 'pointer',
                                opacity: cancellingId === item.id ? 0.6 : 1,
                                transition: 'all 0.15s ease',
                                fontFamily: 'inherit',
                              }}
                            >
                              {cancellingId === item.id ? 'Cancelling...' : 'Cancel'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View (Visible on screens < 768px) */}
            <div className="leave-mobile-cards" aria-label="Leave History Cards">
              {filteredHistory.map((item) => (
                <article key={item.id} className="leave-mobile-card">
                  <div className="mobile-card-top">
                    <span
                      className="mobile-leave-id"
                      title={item.id}
                      style={{
                        maxWidth: '120px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.id}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <LeaveStatusBadge status={item.status} />
                      {item.status === 'Pending' && (
                        <button
                          type="button"
                          className="leave-cancel-btn"
                          disabled={cancellingId === item.id}
                          onClick={() => handleCancelLeave(item.id)}
                          aria-label={`Cancel leave request ${item.id}`}
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#dc2626',
                            backgroundColor: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '0.375rem',
                            cursor: cancellingId === item.id ? 'not-allowed' : 'pointer',
                            opacity: cancellingId === item.id ? 0.6 : 1,
                            transition: 'all 0.15s ease',
                            fontFamily: 'inherit',
                          }}
                        >
                          {cancellingId === item.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Type:</span>
                    <span className="mobile-card-value font-semibold">
                      {item.leaveType}
                    </span>
                  </div>

                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Duration:</span>
                    <span className="mobile-card-value">
                      {item.startDate} {item.startDate !== item.endDate ? `to ${item.endDate}` : ''} ({item.days} {item.days === 1 ? 'day' : 'days'})
                    </span>
                  </div>

                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Reason:</span>
                    <span className="mobile-card-value">{item.reason}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          /* Empty State */
          <div className="leaves-empty-state" aria-label="No leave records found">
            <div className="empty-state-icon-box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <h3 className="empty-state-heading">No leave records found</h3>
            <p className="empty-state-text">
              {hasActiveFilters
                ? 'Try changing your search or filters.'
                : "You haven't submitted any leave requests yet."}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                className="empty-state-reset-btn"
                onClick={handleResetFilters}
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </section>

      {/* ====================================================================
          RAISE LEAVE REQUEST MODAL (Employee Portal)
          ==================================================================== */}
      {isApplyModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container" style={{ maxWidth: '520px' }}>
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Raise Leave Request</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsApplyModalOpen(false)}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmitLeave} className="admin-modal-form">
              {formError && (
                <div
                  style={{
                    padding: '0.625rem 0.875rem',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '0.375rem',
                    color: '#991b1b',
                    fontSize: '0.8125rem',
                    marginBottom: '1rem',
                  }}
                >
                  {formError}
                </div>
              )}

              {/* Leave Type */}
              <div className="admin-form-field">
                <label htmlFor="applyLeaveType" className="admin-field-label">
                  Leave Type <span className="text-required">*</span>
                </label>
                <select
                  id="applyLeaveType"
                  className="admin-field-select"
                  value={applyForm.leaveType}
                  onChange={(e) =>
                    setApplyForm((prev) => ({ ...prev, leaveType: e.target.value }))
                  }
                >
                  <option value="PL">Paid Leave (PL)</option>
                  <option value="Sick Leave">Sick Leave</option>
                  <option value="UPL">Unpaid Leave (UPL)</option>
                </select>
              </div>

              {/* Date Range Fields */}
              <div className="admin-form-grid" style={{ marginTop: '1rem' }}>
                <div className="admin-form-field">
                  <label htmlFor="applyStartDate" className="admin-field-label">
                    Start Date <span className="text-required">*</span>
                  </label>
                  <input
                    id="applyStartDate"
                    type="date"
                    required
                    className="admin-field-input"
                    value={applyForm.startDate}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setApplyForm((prev) => ({
                        ...prev,
                        startDate: newStart,
                        endDate: prev.endDate < newStart ? newStart : prev.endDate,
                      }));
                    }}
                  />
                </div>

                <div className="admin-form-field">
                  <label htmlFor="applyEndDate" className="admin-field-label">
                    End Date <span className="text-required">*</span>
                  </label>
                  <input
                    id="applyEndDate"
                    type="date"
                    required
                    className="admin-field-input"
                    value={applyForm.endDate}
                    onChange={(e) =>
                      setApplyForm((prev) => ({ ...prev, endDate: e.target.value }))
                    }
                  />
                </div>
              </div>

              {/* Calculated Days Display */}
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.625rem 0.875rem',
                  backgroundColor: '#eff6ff',
                  borderRadius: '0.375rem',
                  border: '1px solid #bfdbfe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: '0.8125rem', color: '#1e40af', fontWeight: 600 }}>
                  Total Duration:
                </span>
                <span style={{ fontSize: '0.875rem', color: '#1d4ed8', fontWeight: 700 }}>
                  {calculatedDays} {calculatedDays === 1 ? 'Day' : 'Days'}
                </span>
              </div>

              {/* Reason */}
              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label htmlFor="applyReason" className="admin-field-label">
                  Reason for Leave <span className="text-required">*</span>
                </label>
                <textarea
                  id="applyReason"
                  rows="3"
                  required
                  placeholder="e.g. Personal work, family event, medical rest..."
                  className="admin-field-textarea"
                  value={applyForm.reason}
                  onChange={(e) =>
                    setApplyForm((prev) => ({ ...prev, reason: e.target.value }))
                  }
                ></textarea>
              </div>

              {/* Modal Actions */}
              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setIsApplyModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn-primary"
                  disabled={isSubmitting}
                  style={{
                    opacity: isSubmitting ? 0.7 : 1,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Leave Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Leaves;
