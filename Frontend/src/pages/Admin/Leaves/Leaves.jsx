import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import './Leaves.css';

// Helper to format date string e.g. "2026-09-29" -> "29 Sep 2026"
function formatDate(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const day = parts[2].substring(0, 2);
    const month = months[parseInt(parts[1], 10) - 1] || parts[1];
    const year = parts[0];
    return `${day} ${month} ${year}`;
  }
  return dateStr;
}

// Normalizes backend leave rows to frontend model
function mapLeaveRow(r) {
  return {
    id: r.id,
    employeeId: r.employee_id || r.employeeId || '',
    employeeName: r.employee_name || r.employeeName || 'Unknown Employee',
    email: r.email || '',
    department: r.department || '-',
    leaveType: r.leave_type || r.leaveType || '-',
    startDate: r.start_date || r.startDate || '-',
    endDate: r.end_date || r.endDate || '-',
    days: Number(r.days || 1),
    reason: r.reason || '-',
    status: r.status || 'Pending',
    adminComment: r.admin_comment || r.adminComment || '',
    reviewedBy: r.reviewed_by || r.reviewedBy || null,
    reviewedOn: r.reviewed_at || r.reviewedOn || null,
    requestedOn: r.requested_on || r.requestedOn || (r.created_at ? String(r.created_at).substring(0, 10) : '-'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Normalizes backend balance rows to frontend model
function mapBalanceRow(b) {
  return {
    employeeId: b.employee_id || b.employeeId || '',
    employeeName: b.employee_name || b.employeeName || 'Unknown Employee',
    department: b.department || '-',
    plTotal: Number(b.pl_total ?? b.plTotal ?? 0),
    plUsed: Number(b.pl_used ?? b.plUsed ?? 0),
    plRemaining: Number(b.pl_remaining ?? b.plRemaining ?? 0),
    sickTotal: Number(b.sick_total ?? b.sickTotal ?? 0),
    sickUsed: Number(b.sick_used ?? b.sickUsed ?? 0),
    sickRemaining: Number(b.sick_remaining ?? b.sickRemaining ?? 0),
    uplUsed: Number(b.upl_used ?? b.uplUsed ?? 0),
  };
}

function Leaves() {
  const navigate = useNavigate();

  // Leaves & Balances state from real backend
  const [leaves, setLeaves] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedType, setSelectedType] = useState('All');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedDateFilter, setSelectedDateFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Summary statistics from backend
  const [summaryStats, setSummaryStats] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  });

  // Modal states
  const [viewRequest, setViewRequest] = useState(null);
  const [approveRequest, setApproveRequest] = useState(null);
  const [approveRemarks, setApproveRemarks] = useState('');
  const [rejectRequest, setRejectRequest] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Prevent background scrolling when any modal is open
  useEffect(() => {
    const isAnyModalOpen = Boolean(approveRequest || rejectRequest || viewRequest);
    if (isAnyModalOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [approveRequest, rejectRequest, viewRequest]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3500);
  };

  // Helper to resolve month query parameter
  const getMonthParam = (dateFilter) => {
    if (dateFilter === 'This Month') {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    if (dateFilter === 'Last Month') {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    }
    return undefined;
  };

  // Fetch leave requests from backend API
  const fetchLeaves = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page: currentPage,
        limit: 10,
      };
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (selectedStatus !== 'All') {
        params.status = selectedStatus;
      }
      if (selectedType !== 'All') {
        params.leave_type = selectedType;
      }
      if (selectedDept !== 'All') {
        params.department = selectedDept;
      }
      const month = getMonthParam(selectedDateFilter);
      if (month) {
        params.month = month;
      }

      const response = await api.admin.getLeaves(params);
      if (response && response.success) {
        setLeaves((response.data || []).map(mapLeaveRow));
        if (response.pagination) {
          setTotalPages(response.pagination.total_pages || 1);
          setTotalCount(response.pagination.total || 0);
        }
        if (response.summary) {
          setSummaryStats(response.summary);
        }
      } else {
        setLeaves([]);
      }
    } catch (err) {
      if (err.status === 403) {
        setError('Access denied. Administrator privileges required.');
      } else {
        setError(err.message || 'Failed to load leave requests.');
      }
      setLeaves([]);
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, selectedStatus, selectedType, selectedDept, selectedDateFilter]);

  // Fetch employee leave balances from backend API
  const refetchBalances = useCallback(async () => {
    try {
      const response = await api.admin.getLeaveBalances();
      if (response && response.success && Array.isArray(response.data)) {
        setLeaveBalances(response.data.map(mapBalanceRow));
      }
    } catch (err) {
      console.error('Failed to load leave balances:', err);
    }
  }, []);

  // Debounced effect for search, filters, and page
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLeaves();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchLeaves]);

  // Fetch leave balances on component mount
  useEffect(() => {
    let isMounted = true;
    const loadBalances = async () => {
      try {
        const response = await api.admin.getLeaveBalances();
        if (isMounted && response && response.success && Array.isArray(response.data)) {
          setLeaveBalances(response.data.map(mapBalanceRow));
        }
      } catch (err) {
        console.error('Failed to load leave balances:', err);
      } finally {
        if (isMounted) {
          setBalancesLoading(false);
        }
      }
    };
    loadBalances();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter change handlers that reset page to 1
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusChange = (e) => {
    setSelectedStatus(e.target.value);
    setCurrentPage(1);
  };

  const handleTypeChange = (e) => {
    setSelectedType(e.target.value);
    setCurrentPage(1);
  };

  const handleDeptChange = (e) => {
    setSelectedDept(e.target.value);
    setCurrentPage(1);
  };

  const handleDateFilterChange = (e) => {
    setSelectedDateFilter(e.target.value);
    setCurrentPage(1);
  };

  const hasActiveFilters =
    searchQuery !== '' ||
    selectedStatus !== 'All' ||
    selectedType !== 'All' ||
    selectedDept !== 'All' ||
    selectedDateFilter !== 'All';

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedStatus('All');
    setSelectedType('All');
    setSelectedDept('All');
    setSelectedDateFilter('All');
    setCurrentPage(1);
  };

  // Handle Approve Confirmation
  const handleConfirmApprove = async () => {
    if (!approveRequest) return;
    setActionLoading(true);
    setActionError('');
    try {
      await api.admin.approveLeave(
        approveRequest.id,
        approveRemarks.trim() || undefined
      );
      showToast(`Leave request ${approveRequest.id} for ${approveRequest.employeeName} approved.`);
      setApproveRequest(null);
      setApproveRemarks('');
      await Promise.all([fetchLeaves(), refetchBalances()]);
    } catch (err) {
      setActionError(err.message || 'Failed to approve leave request.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Reject Confirmation
  const handleConfirmReject = async () => {
    if (!rejectRequest) return;
    const reasonText = rejectionReason.trim();
    if (!reasonText) {
      setActionError('Please specify a rejection reason.');
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      await api.admin.rejectLeave(rejectRequest.id, reasonText);
      showToast(`Leave request ${rejectRequest.id} for ${rejectRequest.employeeName} rejected.`);
      setRejectRequest(null);
      setRejectionReason('');
      await Promise.all([fetchLeaves(), refetchBalances()]);
    } catch (err) {
      setActionError(err.message || 'Failed to reject leave request.');
    } finally {
      setActionLoading(false);
    }
  };

  // Export report as Excel (.xlsx) download
  const handleExportReport = async () => {
    if (isExporting) return;
    if (leaves.length === 0 && totalCount === 0) {
      showToast('No leave records found for the selected filters.');
      return;
    }
    setIsExporting(true);
    showToast('Exporting leave report...');
    try {
      const params = {};
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (selectedStatus !== 'All') {
        params.status = selectedStatus;
      }
      if (selectedType !== 'All') {
        params.leave_type = selectedType;
      }
      if (selectedDept !== 'All') {
        params.department = selectedDept;
      }
      const month = getMonthParam(selectedDateFilter);
      if (month) {
        params.month = month;
      }

      const blob = await api.admin.exportLeaves(params);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const todayStr = new Date().toISOString().substring(0, 10);
      link.download = `leave_report_${todayStr}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showToast('Leave report exported successfully.');
    } catch (err) {
      console.error('Failed to export leave report:', err);
      showToast('Unable to export leave report. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="admin-leaves-page">
      {/* ====================================================================
          PAGE HEADER
          ==================================================================== */}
      <header className="admin-leaves-header">
        <div className="admin-leaves-title-group">
          <h1 className="admin-leaves-title">Leave Management</h1>
          <p className="admin-leaves-subtitle">
            Review employee leave requests and manage leave balances.
          </p>
        </div>

        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={handleExportReport}
            disabled={isExporting}
            aria-label="Export Leave Report"
          >
            <svg
              className="admin-btn-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{isExporting ? 'Exporting...' : 'Export Leave Report'}</span>
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-leaves-toast" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ====================================================================
          SUMMARY CARDS (Calculated from Real Database Records)
          ==================================================================== */}
      <section className="admin-leaves-summary-grid" aria-label="Leave Metrics Overview">
        {/* Card 1: Pending Requests */}
        <div className="admin-leaves-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Pending Requests</span>
            <div className="admin-stat-icon-wrapper stat-amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.pending}</div>
          <div className="admin-stat-footer">Requires administrator review</div>
        </div>

        {/* Card 2: Approved Requests */}
        <div className="admin-leaves-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Approved</span>
            <div className="admin-stat-icon-wrapper stat-green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.approved}</div>
          <div className="admin-stat-footer">Granted across departments</div>
        </div>

        {/* Card 3: Rejected Requests */}
        <div className="admin-leaves-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Rejected</span>
            <div className="admin-stat-icon-wrapper stat-red">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.rejected}</div>
          <div className="admin-stat-footer">Disapproved or conflicts</div>
        </div>

        {/* Card 4: Total Requests */}
        <div className="admin-leaves-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Total Requests</span>
            <div className="admin-stat-icon-wrapper stat-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.total}</div>
          <div className="admin-stat-footer">Current organization cycle</div>
        </div>
      </section>

      {/* ====================================================================
          FILTERS & SEARCH
          ==================================================================== */}
      <section className="admin-filters-card admin-leaves-filters-card" aria-label="Search and Filter Leave Requests">
        <div className="admin-leaves-filters-grid">
          {/* Employee ID / Search Filter */}
          <div className="admin-filter-group admin-filter-group-employee">
            <label htmlFor="leaveEmployeeSearch" className="admin-filter-label">Employee ID</label>
            <div className="admin-search-wrapper">
              <svg
                className="admin-search-icon"
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
                id="leaveEmployeeSearch"
                type="text"
                className="admin-search-input"
                placeholder="Search ID, name..."
                value={searchQuery}
                onChange={handleSearchChange}
                aria-label="Search employee ID or name"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="admin-search-clear-btn"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  aria-label="Clear search query"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Status Filter */}
          <div className="admin-filter-group">
            <label htmlFor="leaveStatusFilter" className="admin-filter-label">Status</label>
            <select
              id="leaveStatusFilter"
              className="admin-filter-select"
              value={selectedStatus}
              onChange={handleStatusChange}
            >
              <option value="All">All</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          {/* Leave Type Filter */}
          <div className="admin-filter-group">
            <label htmlFor="leaveTypeFilter" className="admin-filter-label">Type</label>
            <select
              id="leaveTypeFilter"
              className="admin-filter-select"
              value={selectedType}
              onChange={handleTypeChange}
            >
              <option value="All">All</option>
              <option value="PL">PL</option>
              <option value="UPL">UPL</option>
              <option value="Sick Leave">Sick Leave</option>
            </select>
          </div>

          {/* Department Filter */}
          <div className="admin-filter-group">
            <label htmlFor="leaveDeptFilter" className="admin-filter-label">Department</label>
            <select
              id="leaveDeptFilter"
              className="admin-filter-select"
              value={selectedDept}
              onChange={handleDeptChange}
            >
              <option value="All">All Departments</option>
              <option value="IT">IT</option>
              <option value="Non-IT">Non-IT</option>
            </select>
          </div>

          {/* Date Filter */}
          <div className="admin-filter-group">
            <label htmlFor="leaveDateFilter" className="admin-filter-label">Date</label>
            <select
              id="leaveDateFilter"
              className="admin-filter-select"
              value={selectedDateFilter}
              onChange={handleDateFilterChange}
            >
              <option value="All">All Dates</option>
              <option value="This Month">This Month</option>
              <option value="Last Month">Last Month</option>
            </select>
          </div>
        </div>
      </section>

      {/* ====================================================================
          LEAVE REQUEST TABLE
          ==================================================================== */}
      <section className="admin-card admin-leaves-table-card">
        <div className="admin-table-header-meta">
          <span className="admin-results-count">
            Showing <strong>{leaves.length}</strong> of {totalCount} leave requests
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              className="admin-reset-filters-btn"
              onClick={handleResetFilters}
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="leave-table-wrapper admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Employee ID</th>
                <th scope="col">Leave Type</th>
                <th scope="col">Start Date</th>
                <th scope="col">End Date</th>
                <th scope="col" className="text-center">Days</th>
                <th scope="col">Requested On</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title">Loading leave requests...</p>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="9" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title" style={{ color: '#dc2626' }}>
                        {error}
                      </p>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        onClick={fetchLeaves}
                        style={{ marginTop: '0.5rem' }}
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : leaves.length > 0 ? (
                leaves.map((req) => {
                  const isPending = req.status === 'Pending';
                  const isApproved = req.status === 'Approved';
                  const isRejected = req.status === 'Rejected';

                  return (
                    <tr key={req.id}>

                      {/* Employee Name (Clickable link) */}
                      <td>
                        <button
                          type="button"
                          className="admin-emp-link-btn"
                          onClick={() => navigate(`/admin/employees/${req.employeeId}`)}
                          title={`View ${req.employeeName}'s profile`}
                        >
                          {req.employeeName}
                        </button>
                      </td>

                      {/* Employee ID (Clickable badge) */}
                      <td>
                        <button
                          type="button"
                          className="admin-id-badge admin-id-badge-interactive"
                          onClick={() => navigate(`/admin/employees/${req.employeeId}`)}
                          title={`Navigate to ${req.employeeId}`}
                        >
                          {req.employeeId}
                        </button>
                      </td>

                      {/* Leave Type */}
                      <td>
                        <span className="admin-leave-type-pill">{req.leaveType}</span>
                      </td>

                      {/* Start Date */}
                      <td className="text-muted">{formatDate(req.startDate)}</td>

                      {/* End Date */}
                      <td className="text-muted">{formatDate(req.endDate)}</td>

                      {/* Days */}
                      <td className="text-center">
                        <span className="admin-days-pill">
                          {req.days} {req.days === 1 ? 'day' : 'days'}
                        </span>
                      </td>

                      {/* Requested On */}
                      <td className="text-muted">{formatDate(req.requestedOn)}</td>

                      {/* Status Badge */}
                      <td>
                        <span
                          className={`admin-status-badge ${
                            isApproved
                              ? 'status-approved'
                              : isPending
                              ? 'status-pending'
                              : isRejected
                              ? 'status-rejected'
                              : 'status-neutral'
                          }`}
                        >
                          <span className="status-dot" aria-hidden="true"></span>
                          {req.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="text-right">
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-action-btn-pill admin-action-view"
                            onClick={() => setViewRequest(req)}
                            aria-label={`View request ${req.id}`}
                          >
                            View
                          </button>

                          {isPending && (
                            <>
                              <button
                                type="button"
                                className="admin-action-btn-pill admin-action-approve"
                                onClick={() => {
                                  setApproveRequest(req);
                                  setApproveRemarks('');
                                  setActionError('');
                                }}
                                aria-label={`Approve request ${req.id}`}
                              >
                                Approve
                              </button>

                              <button
                                type="button"
                                className="admin-action-btn-pill admin-action-reject"
                                onClick={() => {
                                  setRejectRequest(req);
                                  setRejectionReason('');
                                  setActionError('');
                                }}
                                aria-label={`Reject request ${req.id}`}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="10" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <p className="admin-empty-title">No leave requests found</p>
                      <p className="admin-empty-desc">
                        No requests match your current filters or search term.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination UI */}
        <div className="admin-pagination-wrapper">
          <div className="admin-pagination-info">
            Showing page {currentPage} of {Math.max(1, totalPages)}
          </div>

          <div className="admin-pagination-controls">
            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={currentPage <= 1 || loading}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              &larr; Previous
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                className={`admin-page-btn ${currentPage === page ? 'admin-page-active' : ''}`}
                onClick={() => setCurrentPage(page)}
                disabled={loading}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={currentPage >= totalPages || loading}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </section>

      {/* ====================================================================
          LEAVE BALANCE SECTION
          ==================================================================== */}
      <section className="admin-card admin-balances-card" aria-label="Employee Leave Balances">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">Employee Leave Balances</h2>
            <p className="admin-card-subtitle">
              Current annual leave entitlements, approved leaves used, and available quotas.
            </p>
          </div>
          <span className="admin-badge admin-badge-neutral">Annual Quota 2026</span>
        </div>

        <div className="leave-table-wrapper admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Employee ID</th>
                <th scope="col" className="text-center">PL Total</th>
                <th scope="col" className="text-center">PL Used</th>
                <th scope="col" className="text-center text-success">PL Remaining</th>
                <th scope="col" className="text-center">Sick Total</th>
                <th scope="col" className="text-center">Sick Used</th>
                <th scope="col" className="text-center text-success">Sick Remaining</th>
                <th scope="col" className="text-center text-amber">UPL Used</th>
              </tr>
            </thead>
            <tbody>
              {balancesLoading ? (
                <tr>
                  <td colSpan="9" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title">Loading leave balances...</p>
                    </div>
                  </td>
                </tr>
              ) : leaveBalances.length > 0 ? (
                leaveBalances.map((bal) => (
                  <tr key={bal.employeeId}>
                    <td>
                      <button
                        type="button"
                        className="admin-emp-link-btn font-semibold"
                        onClick={() => navigate(`/admin/employees/${bal.employeeId}`)}
                      >
                        {bal.employeeName}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="admin-id-badge admin-id-badge-interactive"
                        onClick={() => navigate(`/admin/employees/${bal.employeeId}`)}
                      >
                        {bal.employeeId}
                      </button>
                    </td>
                    <td className="text-center">{bal.plTotal}</td>
                    <td className="text-center">{bal.plUsed}</td>
                    <td className="text-center text-success font-semibold">{bal.plRemaining}</td>
                    <td className="text-center">{bal.sickTotal}</td>
                    <td className="text-center">{bal.sickUsed}</td>
                    <td className="text-center text-success font-semibold">{bal.sickRemaining}</td>
                    <td className="text-center text-amber font-semibold">{bal.uplUsed}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="9" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title">No employee leave balance records found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ====================================================================
          APPROVE CONFIRMATION MODAL
          ==================================================================== */}
      {approveRequest && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-confirm-modal">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Approve Leave Request?</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => {
                  setApproveRequest(null);
                  setApproveRemarks('');
                  setActionError('');
                }}
                disabled={actionLoading}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body">
              <div className="admin-confirm-icon-wrap icon-green" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>

              <p className="admin-confirm-message">
                Are you sure you want to approve this leave request?
              </p>

              <div className="admin-approve-details-box">
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Employee:</span>
                  <span className="detail-inline-val font-semibold">
                    {approveRequest.employeeName} ({approveRequest.employeeId})
                  </span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Leave Type:</span>
                  <span className="detail-inline-val font-semibold">{approveRequest.leaveType}</span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Dates:</span>
                  <span className="detail-inline-val">
                    {formatDate(approveRequest.startDate)} &bull; {formatDate(approveRequest.endDate)}
                  </span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Number of Days:</span>
                  <span className="detail-inline-val font-semibold text-primary">
                    {approveRequest.days} {approveRequest.days === 1 ? 'Day' : 'Days'}
                  </span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Reason:</span>
                  <span className="detail-inline-val">{approveRequest.reason}</span>
                </div>
              </div>

              <div className="admin-form-field" style={{ width: '100%', marginTop: '0.75rem', textAlign: 'left' }}>
                <label htmlFor="approveRemarksInput" className="admin-field-label">
                  Admin Remarks (Optional)
                </label>
                <textarea
                  id="approveRemarksInput"
                  rows="2"
                  className="admin-field-textarea"
                  placeholder="Optional note or approval remark..."
                  value={approveRemarks}
                  onChange={(e) => setApproveRemarks(e.target.value)}
                  disabled={actionLoading}
                ></textarea>
              </div>

              {actionError && (
                <div style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.5rem', textAlign: 'left' }}>
                  {actionError}
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => {
                  setApproveRequest(null);
                  setApproveRemarks('');
                  setActionError('');
                }}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn-primary admin-btn-success"
                onClick={handleConfirmApprove}
                disabled={actionLoading}
              >
                {actionLoading ? 'Approving...' : 'Approve Leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          REJECT REQUEST MODAL
          ==================================================================== */}
      {rejectRequest && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-confirm-modal">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Reject Leave Request</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => {
                  setRejectRequest(null);
                  setRejectionReason('');
                  setActionError('');
                }}
                disabled={actionLoading}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body">
              <div className="admin-confirm-icon-wrap" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>

              <p className="admin-confirm-message">
                Specify rejection reason for this request:
              </p>

              <div className="admin-approve-details-box">
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Employee:</span>
                  <span className="detail-inline-val font-semibold">
                    {rejectRequest.employeeName} ({rejectRequest.employeeId})
                  </span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Leave Type:</span>
                  <span className="detail-inline-val font-semibold">{rejectRequest.leaveType}</span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Dates:</span>
                  <span className="detail-inline-val">
                    {formatDate(rejectRequest.startDate)} &bull; {formatDate(rejectRequest.endDate)}
                  </span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Days:</span>
                  <span className="detail-inline-val font-semibold">
                    {rejectRequest.days} {rejectRequest.days === 1 ? 'Day' : 'Days'}
                  </span>
                </div>
                <div className="admin-detail-row-inline">
                  <span className="detail-inline-lbl">Reason:</span>
                  <span className="detail-inline-val">{rejectRequest.reason}</span>
                </div>
              </div>

              <div className="admin-form-field" style={{ width: '100%', marginTop: '0.75rem', textAlign: 'left' }}>
                <label htmlFor="rejectionReasonInput" className="admin-field-label">
                  Reason for Rejection <span className="text-required">*</span>
                </label>
                <textarea
                  id="rejectionReasonInput"
                  rows="3"
                  className="admin-field-textarea"
                  placeholder="e.g. Sprint milestone release, team coverage required..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  disabled={actionLoading}
                ></textarea>
              </div>

              {actionError && (
                <div style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.5rem', textAlign: 'left' }}>
                  {actionError}
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => {
                  setRejectRequest(null);
                  setRejectionReason('');
                  setActionError('');
                }}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn-danger"
                onClick={handleConfirmReject}
                disabled={actionLoading}
              >
                {actionLoading ? 'Rejecting...' : 'Reject Leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          VIEW REQUEST MODAL
          ==================================================================== */}
      {viewRequest && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container" style={{ maxWidth: '600px' }}>
            <div className="admin-modal-header">
              <div className="admin-pf-modal-header-info">
                <div className="admin-doc-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <div>
                  <h2 className="admin-modal-title">Leave Request Details</h2>
                  <span className="admin-doc-modal-subtitle">
                    {viewRequest.employeeName} &bull; {viewRequest.employeeId}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setViewRequest(null)}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>

            <div className="admin-modal-body admin-pf-modal-body">
              <div className="admin-doc-metadata-grid">
                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Employee</span>
                  <button
                    type="button"
                    className="doc-meta-emp-link font-semibold"
                    onClick={() => {
                      setViewRequest(null);
                      navigate(`/admin/employees/${viewRequest.employeeId}`);
                    }}
                  >
                    {viewRequest.employeeName}
                  </button>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Employee ID</span>
                  <span className="doc-meta-val font-semibold">{viewRequest.employeeId}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Department</span>
                  <span className="doc-meta-val">{viewRequest.department}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Leave Type</span>
                  <span className="doc-meta-val font-semibold">{viewRequest.leaveType}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Start Date</span>
                  <span className="doc-meta-val">{formatDate(viewRequest.startDate)}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">End Date</span>
                  <span className="doc-meta-val">{formatDate(viewRequest.endDate)}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Number of Days</span>
                  <span className="doc-meta-val text-primary font-semibold">
                    {viewRequest.days} {viewRequest.days === 1 ? 'Day' : 'Days'}
                  </span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Requested On</span>
                  <span className="doc-meta-val">{formatDate(viewRequest.requestedOn)}</span>
                </div>

                <div className="admin-doc-meta-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="doc-meta-lbl">Reason</span>
                  <span className="doc-meta-val">{viewRequest.reason}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Status</span>
                  <span className="doc-meta-val">
                    <span
                      className={`admin-status-badge ${
                        viewRequest.status === 'Approved'
                          ? 'status-approved'
                          : viewRequest.status === 'Pending'
                          ? 'status-pending'
                          : viewRequest.status === 'Rejected'
                          ? 'status-rejected'
                          : 'status-neutral'
                      }`}
                    >
                      <span className="status-dot" aria-hidden="true"></span>
                      {viewRequest.status}
                    </span>
                  </span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Reviewed By</span>
                  <span className="doc-meta-val">{viewRequest.reviewedBy || '-'}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Reviewed On</span>
                  <span className="doc-meta-val">{formatDate(viewRequest.reviewedOn)}</span>
                </div>

                <div className="admin-doc-meta-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="doc-meta-lbl">Admin Comment</span>
                  <span className="doc-meta-val text-muted">
                    {viewRequest.adminComment || '-'}
                  </span>
                </div>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setViewRequest(null)}
              >
                Close
              </button>

              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => {
                  setViewRequest(null);
                  navigate(`/admin/employees/${viewRequest.employeeId}`);
                }}
              >
                View Employee
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Leaves;
