import { useState, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import './Exit.css';

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatINR(val) {
  const num = typeof val === 'number' ? val : parseFloat(val) || 0;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AdminExit() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters & Pagination
  const [statusFilter, setStatusFilter] = useState('All');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  // Detail Modal / Drawer State
  const [selectedReq, setSelectedReq] = useState(null);
  const [modalTab, setModalTab] = useState('details'); // 'details' | 'clearance' | 'fnf'

  // Review Form
  const [reviewAction, setReviewAction] = useState('APPROVE');
  const [approvedDate, setApprovedDate] = useState('');
  const [adminRemarks, setAdminRemarks] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Clearance Edit State
  const [updatingClearanceId, setUpdatingClearanceId] = useState(null);
  const [clearanceStatusInput, setClearanceStatusInput] = useState({});
  const [clearanceRemarksInput, setClearanceRemarksInput] = useState({});

  // F&F Form & Preview State
  const [calculatingFnf, setCalculatingFnf] = useState(false);
  const [fnfInputs, setFnfInputs] = useState({
    salary_divisor: 30,
    payable_days: 0,
    encashed_leave_days: 0,
    gratuity_amount: 0,
    bonus_or_incentive: 0,
    notice_recovery: 0,
    other_deductions: 0,
  });
  const [fnfBreakdown, setFnfBreakdown] = useState(null);

  // Finalization Confirmation
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [downloadingDoc, setDownloadingDoc] = useState(null);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await api.admin.exit.getRequests({
        status: statusFilter,
        department: departmentFilter,
        search,
        page,
        limit: 10,
      });
      if (res && res.success) {
        setRequests(res.data);
        setPagination(res.pagination);
      }
    } catch (err) {
      setError(err?.message || 'Failed to fetch offboarding requests.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, departmentFilter, search, page]);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      try {
        const res = await api.admin.exit.getRequests({
          status: statusFilter,
          department: departmentFilter,
          search,
          page,
          limit: 10,
        });
        if (!ignore && res && res.success) {
          setRequests(res.data);
          setPagination(res.pagination);
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Failed to fetch offboarding requests.');
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
  }, [statusFilter, departmentFilter, search, page]);

  const openDetailModal = async (req) => {
    setSelectedReq(req);
    setModalTab('details');
    setError('');
    setSuccess('');
    setReviewAction(req.status === 'SUBMITTED' ? 'UNDER_REVIEW' : 'APPROVE');
    setApprovedDate(
      req.approved_relieving_date
        ? new Date(req.approved_relieving_date).toISOString().split('T')[0]
        : req.requested_relieving_date
        ? new Date(req.requested_relieving_date).toISOString().split('T')[0]
        : ''
    );
    setAdminRemarks(req.admin_remarks || '');

    // Initialize clearances input
    const clrStatus = {};
    const clrRemarks = {};
    (req.clearances || []).forEach((c) => {
      clrStatus[c.id] = c.status;
      clrRemarks[c.id] = c.remarks || '';
    });
    setClearanceStatusInput(clrStatus);
    setClearanceRemarksInput(clrRemarks);

    // Initial F&F calculate preview
    try {
      setCalculatingFnf(true);
      const fnfRes = await api.admin.exit.calculateFnf({
        exit_request_id: req.id,
        salary_divisor: 30,
      });
      if (fnfRes && fnfRes.success) {
        setFnfBreakdown(fnfRes.data);
        setFnfInputs({
          salary_divisor: fnfRes.data.working_days || 30,
          payable_days: fnfRes.data.payable_days || 0,
          encashed_leave_days: fnfRes.data.leave_encashment?.encashed_leave_days || 0,
          gratuity_amount: fnfRes.data.gratuity?.gratuity_amount || 0,
          bonus_or_incentive: fnfRes.data.bonus_or_incentive || 0,
          notice_recovery: fnfRes.data.notice_period_recovery || 0,
          other_deductions: fnfRes.data.other_deductions || 0,
        });
      }
    } catch {
      // Non-fatal if calculation fails during opening
    } finally {
      setCalculatingFnf(false);
    }
  };

  const closeDetailModal = () => {
    setSelectedReq(null);
    setFnfBreakdown(null);
    setShowFinalizeModal(false);
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!selectedReq) return;
    try {
      setSubmittingReview(true);
      setError('');
      setSuccess('');
      const res = await api.admin.exit.reviewRequest(selectedReq.id, {
        action: reviewAction,
        approved_relieving_date: reviewAction === 'APPROVE' ? approvedDate : undefined,
        admin_remarks: adminRemarks,
      });
      if (res && res.success) {
        setSuccess(`Exit request status updated.`);
        await fetchRequests();
        // Refresh selected req in modal
        setSelectedReq((prev) => ({ ...prev, ...res.data }));
      }
    } catch (err) {
      setError(err?.message || 'Failed to review exit request.');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleClearanceUpdate = async (clearanceId) => {
    try {
      setUpdatingClearanceId(clearanceId);
      const statusVal = clearanceStatusInput[clearanceId];
      const remarksVal = clearanceRemarksInput[clearanceId];

      if (statusVal === 'REJECTED' && (!remarksVal || remarksVal.trim().length < 5)) {
        setError('Detailed remarks (at least 5 characters) are required when rejecting a clearance.');
        return;
      }

      const res = await api.admin.exit.updateClearance(clearanceId, {
        status: statusVal,
        remarks: remarksVal,
      });

      if (res && res.success) {
        setSuccess(`Clearance updated successfully.`);
        // Update local state in selectedReq
        setSelectedReq((prev) => {
          const updatedClrs = (prev.clearances || []).map((c) =>
            c.id === clearanceId ? { ...c, ...res.data } : c
          );
          return { ...prev, clearances: updatedClrs };
        });
        await fetchRequests();
      }
    } catch (err) {
      setError(err?.message || 'Failed to update clearance.');
    } finally {
      setUpdatingClearanceId(null);
    }
  };

  const handleRecalculateFnf = async (e) => {
    e.preventDefault();
    if (!selectedReq) return;
    try {
      setCalculatingFnf(true);
      setError('');
      const res = await api.admin.exit.calculateFnf({
        exit_request_id: selectedReq.id,
        salary_divisor: fnfInputs.salary_divisor,
        payable_days: fnfInputs.payable_days,
        encashed_leave_days: fnfInputs.encashed_leave_days,
        gratuity_amount: fnfInputs.gratuity_amount,
        bonus_or_incentive: fnfInputs.bonus_or_incentive,
        notice_recovery: fnfInputs.notice_recovery,
        other_deductions: fnfInputs.other_deductions,
      });
      if (res && res.success) {
        setFnfBreakdown(res.data);
      }
    } catch (err) {
      setError(err?.message || 'Failed to calculate F&F preview.');
    } finally {
      setCalculatingFnf(false);
    }
  };

  const handleFinalize = async () => {
    if (!selectedReq) return;
    try {
      setFinalizing(true);
      setError('');
      setSuccess('');
      const res = await api.admin.exit.finalizeFnf({
        exit_request_id: selectedReq.id,
        salary_divisor: fnfInputs.salary_divisor,
        payable_days: fnfInputs.payable_days,
        encashed_leave_days: fnfInputs.encashed_leave_days,
        gratuity_amount: fnfInputs.gratuity_amount,
        bonus_or_incentive: fnfInputs.bonus_or_incentive,
        notice_recovery: fnfInputs.notice_recovery,
        other_deductions: fnfInputs.other_deductions,
      });
      if (res && res.success) {
        setSuccess(`Offboarding finalized successfully. Employee account deactivated.`);
        setShowFinalizeModal(false);
        setSelectedReq((prev) => ({ ...prev, status: 'COMPLETED' }));
        await fetchRequests();
      }
    } catch (err) {
      setError(err?.message || 'Failed to finalize offboarding.');
    } finally {
      setFinalizing(false);
    }
  };

  const handleAdminDownload = async (docType, apiFunc) => {
    if (!selectedReq) return;
    try {
      setDownloadingDoc(docType);
      setError('');
      const blob = await apiFunc(selectedReq.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedReq.employee_id}_${docType.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || `Failed to download ${docType}.`);
    } finally {
      setDownloadingDoc(null);
    }
  };

  // Calculate clearance completion
  const clearances = selectedReq?.clearances || [];
  const clearedCount = clearances.filter((c) => c.status === 'CLEARED' || c.status === 'WAIVED').length;
  const allClearancesDone = clearances.length > 0 && clearedCount === clearances.length;

  return (
    <div className="admin-exit-container">
      <div className="admin-exit-header">
        <div>
          <h1 className="admin-exit-title">Employee Offboarding & Exit Management</h1>
          <p className="admin-exit-subtitle">
            Review resignations, coordinate departmental clearances, compute F&F settlements, and issue official relieving letters.
          </p>
        </div>
      </div>

      {error && <div className="admin-alert admin-alert-danger">{error}</div>}
      {success && <div className="admin-alert admin-alert-success">{success}</div>}

      {/* Filters Bar */}
      <div className="admin-exit-filters">
        <div className="filter-group">
          <label htmlFor="filter-search" className="filter-label">Search</label>
          <input
            id="filter-search"
            type="text"
            className="filter-input"
            placeholder="Search by name, ID, or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="filter-status" className="filter-label">Status</label>
          <select
            id="filter-status"
            className="filter-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="All">All Statuses</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="APPROVED">Approved</option>
            <option value="COMPLETED">Completed</option>
            <option value="REJECTED">Rejected</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-department" className="filter-label">Department</label>
          <select
            id="filter-department"
            className="filter-select"
            value={departmentFilter}
            onChange={(e) => {
              setDepartmentFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="All">All Departments</option>
            <option value="Technology">Technology</option>
            <option value="HR">HR</option>
            <option value="Finance">Finance</option>
            <option value="Operations">Operations</option>
            <option value="Sales">Sales</option>
            <option value="Marketing">Marketing</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="admin-exit-table-card">
        {loading ? (
          <div className="admin-loading-state">
            <div className="admin-spinner" />
            <p>Loading exit requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="admin-empty-state">
            <p>No offboarding requests match your current filters.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-exit-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Resignation Date</th>
                  <th>Relieving Date</th>
                  <th>Clearances</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const clrs = r.clearances || [];
                  const done = clrs.filter((c) => c.status === 'CLEARED' || c.status === 'WAIVED').length;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="emp-cell">
                          <span className="emp-name">{r.employee_name || 'N/A'}</span>
                          <span className="emp-id">{r.employee_id}</span>
                        </div>
                      </td>
                      <td>
                        <div className="dept-cell">
                          <span>{r.department || 'N/A'}</span>
                          <span className="desig-sub">{r.designation}</span>
                        </div>
                      </td>
                      <td>{formatDate(r.resignation_date)}</td>
                      <td>
                        <div className="relieving-cell">
                          <span>{r.approved_relieving_date ? formatDate(r.approved_relieving_date) : formatDate(r.requested_relieving_date)}</span>
                          <span className="relieving-tag">{r.approved_relieving_date ? 'Approved' : 'Requested'}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`clearance-pill ${done === clrs.length && clrs.length > 0 ? 'pill-done' : 'pill-pending'}`}>
                          {done} / {clrs.length} Done
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge badge-${r.status.toLowerCase()}`}>
                          {r.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => openDetailModal(r)}
                          className="admin-btn admin-btn-sm admin-btn-primary"
                        >
                          Manage Exit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="admin-pagination">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="admin-btn admin-btn-sm admin-btn-secondary"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                className="admin-btn admin-btn-sm admin-btn-secondary"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail / Manage Drawer Modal */}
      {selectedReq && (
        <div className="admin-modal-backdrop">
          <div className="admin-drawer">
            <div className="drawer-header">
              <div>
                <span className={`status-badge badge-${selectedReq.status.toLowerCase()}`}>
                  {selectedReq.status.replace('_', ' ')}
                </span>
                <h2 className="drawer-title">{selectedReq.employee_name} ({selectedReq.employee_id})</h2>
                <p className="drawer-meta">{selectedReq.department} &bull; {selectedReq.designation}</p>
              </div>
              <button type="button" onClick={closeDetailModal} className="drawer-close-btn">&times;</button>
            </div>

            {/* Navigation Tabs */}
            <div className="drawer-tabs">
              <button
                type="button"
                className={`drawer-tab ${modalTab === 'details' ? 'active-tab' : ''}`}
                onClick={() => setModalTab('details')}
              >
                1. Review & Dates
              </button>
              <button
                type="button"
                className={`drawer-tab ${modalTab === 'clearance' ? 'active-tab' : ''}`}
                onClick={() => setModalTab('clearance')}
              >
                2. Clearances ({clearedCount}/{clearances.length})
              </button>
              <button
                type="button"
                className={`drawer-tab ${modalTab === 'fnf' ? 'active-tab' : ''}`}
                onClick={() => setModalTab('fnf')}
              >
                3. F&F Settlement
              </button>
            </div>

            <div className="drawer-body">
              {/* TAB 1: Review & Dates */}
              {modalTab === 'details' && (
                <div className="tab-pane">
                  <div className="info-block">
                    <h3 className="section-title">Resignation Submission</h3>
                    <div className="grid-2col">
                      <div>
                        <span className="lbl">Submission Date</span>
                        <p className="val">{formatDate(selectedReq.resignation_date)}</p>
                      </div>
                      <div>
                        <span className="lbl">Requested Relieving Date</span>
                        <p className="val">{formatDate(selectedReq.requested_relieving_date)}</p>
                      </div>
                      <div className="span-2">
                        <span className="lbl">Reason for Separation</span>
                        <p className="val reason-text">{selectedReq.reason}</p>
                      </div>
                    </div>
                  </div>

                  {selectedReq.status !== 'COMPLETED' && selectedReq.status !== 'WITHDRAWN' && (
                    <div className="info-block">
                      <h3 className="section-title">Review Actions</h3>
                      <form onSubmit={handleReviewSubmit} className="review-form">
                        <div className="form-row">
                          <div className="form-col">
                            <label htmlFor="review_action" className="lbl">Select Action</label>
                            <select
                              id="review_action"
                              className="filter-select"
                              value={reviewAction}
                              onChange={(e) => setReviewAction(e.target.value)}
                            >
                              {selectedReq.status === 'SUBMITTED' && (
                                <option value="UNDER_REVIEW">Mark Under Review</option>
                              )}
                              <option value="APPROVE">Approve Resignation</option>
                              <option value="REJECT">Reject Resignation</option>
                            </select>
                          </div>

                          {reviewAction === 'APPROVE' && (
                            <div className="form-col">
                              <label htmlFor="approved_relieving_date" className="lbl">Approved Relieving Date</label>
                              <input
                                id="approved_relieving_date"
                                type="date"
                                className="filter-input"
                                value={approvedDate}
                                onChange={(e) => setApprovedDate(e.target.value)}
                                required
                              />
                            </div>
                          )}
                        </div>

                        <div className="form-row">
                          <div className="form-col span-2">
                            <label htmlFor="review_remarks" className="lbl">
                              Admin Remarks {reviewAction === 'REJECT' && <span className="text-danger">*</span>}
                            </label>
                            <textarea
                              id="review_remarks"
                              rows={2}
                              className="filter-input"
                              placeholder="Enter approval conditions or rejection reasons..."
                              value={adminRemarks}
                              onChange={(e) => setAdminRemarks(e.target.value)}
                              required={reviewAction === 'REJECT'}
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={submittingReview}
                          className="admin-btn admin-btn-primary"
                        >
                          {submittingReview ? 'Updating...' : 'Save Review Action'}
                        </button>
                      </form>
                    </div>
                  )}

                  {selectedReq.status === 'COMPLETED' && (
                    <div className="completion-banner">
                      <h4>Offboarding Completed</h4>
                      <p>This employee separation was finalized on {formatDate(selectedReq.completed_at)}. Account access is inactive.</p>
                      <div className="doc-btn-group">
                        <button
                          type="button"
                          disabled={downloadingDoc === 'Relieving Letter'}
                          onClick={() => handleAdminDownload('Relieving Letter', api.admin.exit.downloadRelievingLetter)}
                          className="admin-btn admin-btn-sm admin-btn-outline"
                        >
                          {downloadingDoc === 'Relieving Letter' ? 'Downloading...' : 'Download Relieving Letter'}
                        </button>
                        <button
                          type="button"
                          disabled={downloadingDoc === 'Experience Certificate'}
                          onClick={() => handleAdminDownload('Experience Certificate', api.admin.exit.downloadExperienceCertificate)}
                          className="admin-btn admin-btn-sm admin-btn-outline"
                        >
                          {downloadingDoc === 'Experience Certificate' ? 'Downloading...' : 'Download Experience Certificate'}
                        </button>
                        <button
                          type="button"
                          disabled={downloadingDoc === 'FnF Statement'}
                          onClick={() => handleAdminDownload('FnF Statement', api.admin.exit.downloadFnfStatement)}
                          className="admin-btn admin-btn-sm admin-btn-outline"
                        >
                          {downloadingDoc === 'FnF Statement' ? 'Downloading...' : 'Download F&F Statement'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Clearance Matrix */}
              {modalTab === 'clearance' && (
                <div className="tab-pane">
                  <h3 className="section-title">Department Clearance Verification</h3>
                  <p className="tab-desc">
                    Update clearance status for IT, Finance, HR, and Department Handover. All clearances must be CLEARED or WAIVED prior to F&F finalization.
                  </p>

                  <div className="clearance-cards-list">
                    {clearances.map((c) => (
                      <div key={c.id} className="clearance-edit-row">
                        <div className="clr-info">
                          <h4 className="clr-dept">{c.department.replace('_', ' ')}</h4>
                          <span className={`status-badge badge-${c.status.toLowerCase()}`}>{c.status}</span>
                          {c.cleared_at && <span className="clr-date">Updated: {formatDate(c.cleared_at)}</span>}
                        </div>

                        {selectedReq.status !== 'COMPLETED' && (
                          <div className="clr-actions">
                            <select
                              value={clearanceStatusInput[c.id] || c.status}
                              onChange={(e) =>
                                setClearanceStatusInput((prev) => ({ ...prev, [c.id]: e.target.value }))
                              }
                              className="filter-select clr-select"
                            >
                              <option value="PENDING">Pending</option>
                              <option value="CLEARED">Cleared</option>
                              <option value="WAIVED">Waived</option>
                              <option value="REJECTED">Rejected</option>
                            </select>

                            <input
                              type="text"
                              placeholder="Optional remarks..."
                              value={clearanceRemarksInput[c.id] !== undefined ? clearanceRemarksInput[c.id] : c.remarks || ''}
                              onChange={(e) =>
                                setClearanceRemarksInput((prev) => ({ ...prev, [c.id]: e.target.value }))
                              }
                              className="filter-input clr-remarks-input"
                            />

                            <button
                              type="button"
                              disabled={updatingClearanceId === c.id}
                              onClick={() => handleClearanceUpdate(c.id)}
                              className="admin-btn admin-btn-sm admin-btn-secondary"
                            >
                              {updatingClearanceId === c.id ? 'Saving...' : 'Update'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: F&F Settlement */}
              {modalTab === 'fnf' && (
                <div className="tab-pane">
                  <h3 className="section-title">Full & Final (F&F) Settlement Computation</h3>
                  <p className="tab-desc">
                    Review and calibrate final salary calculations. Values are dynamically computed on the backend server.
                  </p>

                  <form onSubmit={handleRecalculateFnf} className="fnf-form">
                    <div className="fnf-grid">
                      <div className="fnf-col">
                        <label htmlFor="fnf_divisor" className="lbl">Salary Divisor (Days)</label>
                        <input
                          id="fnf_divisor"
                          type="number"
                          step="1"
                          min="1"
                          max="31"
                          className="filter-input"
                          value={fnfInputs.salary_divisor}
                          onChange={(e) => setFnfInputs((p) => ({ ...p, salary_divisor: e.target.value }))}
                        />
                        <span className="help-text">Default 30 days standard month.</span>
                      </div>

                      <div className="fnf-col">
                        <label htmlFor="fnf_payable_days" className="lbl">Payable Days (Final Month)</label>
                        <input
                          id="fnf_payable_days"
                          type="number"
                          step="0.5"
                          min="0"
                          className="filter-input"
                          value={fnfInputs.payable_days}
                          onChange={(e) => setFnfInputs((p) => ({ ...p, payable_days: e.target.value }))}
                        />
                        <span className="help-text">Worked days + Paid Leave + Holidays</span>
                      </div>

                      <div className="fnf-col">
                        <label htmlFor="fnf_encashed_days" className="lbl">Encashed PL Days</label>
                        <input
                          id="fnf_encashed_days"
                          type="number"
                          step="0.5"
                          min="0"
                          className="filter-input"
                          value={fnfInputs.encashed_leave_days}
                          onChange={(e) => setFnfInputs((p) => ({ ...p, encashed_leave_days: e.target.value }))}
                        />
                        <span className="help-text">
                          Available PL: {fnfBreakdown?.leave_encashment?.available_pl_days ?? '...'}
                        </span>
                      </div>

                      <div className="fnf-col">
                        <label htmlFor="fnf_gratuity" className="lbl">Gratuity Payout (₹)</label>
                        <input
                          id="fnf_gratuity"
                          type="number"
                          step="0.01"
                          min="0"
                          className="filter-input"
                          value={fnfInputs.gratuity_amount}
                          onChange={(e) => setFnfInputs((p) => ({ ...p, gratuity_amount: e.target.value }))}
                        />
                        <span className="help-text">
                          Tenure: {fnfBreakdown?.tenure?.formatted ?? '...'}
                        </span>
                      </div>

                      <div className="fnf-col">
                        <label htmlFor="fnf_bonus" className="lbl">Bonus / Incentives (₹)</label>
                        <input
                          id="fnf_bonus"
                          type="number"
                          step="0.01"
                          min="0"
                          className="filter-input"
                          value={fnfInputs.bonus_or_incentive}
                          onChange={(e) => setFnfInputs((p) => ({ ...p, bonus_or_incentive: e.target.value }))}
                        />
                      </div>

                      <div className="fnf-col">
                        <label htmlFor="fnf_notice_recovery" className="lbl">Notice Shortfall Recovery (₹)</label>
                        <input
                          id="fnf_notice_recovery"
                          type="number"
                          step="0.01"
                          min="0"
                          className="filter-input"
                          value={fnfInputs.notice_recovery}
                          onChange={(e) => setFnfInputs((p) => ({ ...p, notice_recovery: e.target.value }))}
                        />
                      </div>

                      <div className="fnf-col">
                        <label htmlFor="fnf_other_deductions" className="lbl">Other Deductions / Dues (₹)</label>
                        <input
                          id="fnf_other_deductions"
                          type="number"
                          step="0.01"
                          min="0"
                          className="filter-input"
                          value={fnfInputs.other_deductions}
                          onChange={(e) => setFnfInputs((p) => ({ ...p, other_deductions: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="fnf-action-bar">
                      <button
                        type="submit"
                        disabled={calculatingFnf}
                        className="admin-btn admin-btn-secondary"
                      >
                        {calculatingFnf ? 'Recalculating...' : 'Recalculate Preview'}
                      </button>
                    </div>
                  </form>

                  {/* Settlement Breakdown Card */}
                  {fnfBreakdown && (
                    <div className="breakdown-card">
                      <div className="breakdown-columns">
                        <div className="col-box">
                          <h4 className="box-title">Earnings / Credits</h4>
                          <div className="line-item">
                            <span>Prorated Salary ({fnfBreakdown.payable_days} days):</span>
                            <strong>{formatINR(fnfBreakdown.prorated_salary)}</strong>
                          </div>
                          <div className="line-item">
                            <span>Leave Encashment ({fnfBreakdown.leave_encashment?.encashed_leave_days} PL days):</span>
                            <strong>{formatINR(fnfBreakdown.leave_encashment?.leave_encashment_amount)}</strong>
                          </div>
                          <div className="line-item">
                            <span>Gratuity:</span>
                            <strong>{formatINR(fnfBreakdown.gratuity?.gratuity_amount)}</strong>
                          </div>
                          <div className="line-item">
                            <span>Bonus / Incentive:</span>
                            <strong>{formatINR(fnfBreakdown.bonus_or_incentive)}</strong>
                          </div>
                          <div className="line-total">
                            <span>Total Earnings (A):</span>
                            <strong>{formatINR(fnfBreakdown.total_earnings)}</strong>
                          </div>
                        </div>

                        <div className="col-box">
                          <h4 className="box-title">Deductions / Debits</h4>
                          <div className="line-item">
                            <span>Notice Period Shortfall:</span>
                            <strong>{formatINR(fnfBreakdown.notice_period_recovery)}</strong>
                          </div>
                          <div className="line-item">
                            <span>Other Clearance Deductions:</span>
                            <strong>{formatINR(fnfBreakdown.other_deductions)}</strong>
                          </div>
                          <div className="line-total">
                            <span>Total Deductions (B):</span>
                            <strong>{formatINR(fnfBreakdown.total_deductions)}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="net-payable-box">
                        <span>Net Settlement Payable (A - B):</span>
                        <span className="net-amount">{formatINR(fnfBreakdown.net_payable_amount)}</span>
                      </div>

                      {/* Finalize Button Section */}
                      {selectedReq.status === 'APPROVED' && (
                        <div className="finalize-section">
                          {!allClearancesDone ? (
                            <div className="admin-alert admin-alert-warning">
                              Cannot finalize offboarding: All 4 departmental clearances must be marked CLEARED or WAIVED. Current: {clearedCount}/4.
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setShowFinalizeModal(true)}
                              className="admin-btn admin-btn-danger admin-btn-lg"
                            >
                              Finalize Offboarding & Deactivate Account
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Critical Confirmation Modal for Finalization */}
      {showFinalizeModal && (
        <div className="admin-modal-backdrop-alert">
          <div className="admin-confirm-dialog">
            <h3 className="confirm-title">Confirm Final Offboarding</h3>
            <p className="confirm-warning">
              Finalizing this exit will permanently complete the employee separation process and deactivate the employee and user account.
            </p>
            <ul className="confirm-checklist">
              <li>Atomic commit of Full & Final (F&F) settlement amount: <strong>{formatINR(fnfBreakdown?.net_payable_amount)}</strong></li>
              <li>Official PDF Relieving Letter, Experience Certificate, and F&F Statement will be generated into private storage.</li>
              <li>Employee and User statuses will permanently transition to <strong>INACTIVE</strong>.</li>
              <li>All active OTPs will be invalidated and future portal login blocked.</li>
            </ul>
            <div className="confirm-actions">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={finalizing}
                onClick={() => setShowFinalizeModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                disabled={finalizing}
                onClick={handleFinalize}
              >
                {finalizing ? 'Finalizing...' : 'Yes, Complete Separation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
