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

function toDateInputValue(val) {
  if (!val) return '';
  if (typeof val === 'string' && val.includes('T')) {
    return val.split('T')[0];
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
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
  const [modalTab, setModalTab] = useState('details'); // 'details' | 'clearance' | 'fnf' | 'documents'

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

  // Exit Documents State (Part 8-15, 19-21)
  const [documentsData, setDocumentsData] = useState({
    active_documents: [],
    standard_slots: [],
    replaced_history: [],
  });
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docsError, setDocsError] = useState('');
  const [docsSuccess, setDocsSuccess] = useState('');

  // Upload / Replace Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadMode, setUploadMode] = useState('CREATE'); // 'CREATE' | 'REPLACE'
  const [uploadDocType, setUploadDocType] = useState('Relieving Letter');
  const [uploadCustomType, setUploadCustomType] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadReleaseDate, setUploadReleaseDate] = useState('');
  const [uploadRemarks, setUploadRemarks] = useState('');
  const [uploadModalError, setUploadModalError] = useState('');
  const [submittingDoc, setSubmittingDoc] = useState(false);

  // Change Release Date Modal
  const [showChangeDateModal, setShowChangeDateModal] = useState(false);
  const [changeDateDoc, setChangeDateDoc] = useState(null);
  const [newReleaseDate, setNewReleaseDate] = useState('');
  const [changeDateError, setChangeDateError] = useState('');
  const [updatingDate, setUpdatingDate] = useState(false);

  // Document action progress states
  const [viewingDocId, setViewingDocId] = useState(null);
  const [downloadingDocId, setDownloadingDocId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

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

  const fetchDocuments = useCallback(async (reqId) => {
    if (!reqId) return;
    try {
      setLoadingDocs(true);
      setDocsError('');
      const res = await api.admin.exit.getDocuments(reqId);
      if (res && res.success) {
        setDocumentsData(res.data);
      }
    } catch (err) {
      setDocsError(err?.message || 'Failed to load exit documents.');
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const openDetailModal = async (req) => {
    setSelectedReq(req);
    setModalTab('details');
    setError('');
    setSuccess('');
    setDocsError('');
    setDocsSuccess('');
    setReviewAction(
      req.status === 'SUBMITTED' || req.status === 'UNDER_REVIEW'
        ? 'APPROVE'
        : req.status === 'APPROVED'
        ? 'APPROVE'
        : 'REJECT'
    );
    setApprovedDate(
      toDateInputValue(req.approved_relieving_date || req.requested_relieving_date)
    );
    setAdminRemarks(req.admin_remarks || '');

    // Fetch documents if approved or completed
    if (req.status === 'APPROVED' || req.status === 'COMPLETED') {
      fetchDocuments(req.id);
    }

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
    setShowUploadModal(false);
    setShowChangeDateModal(false);
    setDocumentsData({ active_documents: [], standard_slots: [], replaced_history: [] });
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!selectedReq) return;
    try {
      setSubmittingReview(true);
      setError('');
      setSuccess('');

      if (reviewAction === 'REJECT' && (!adminRemarks || adminRemarks.trim().length < 5)) {
        setError('A reason (at least 5 characters) is required when declining a resignation.');
        return;
      }

      const res = await api.admin.exit.reviewRequest(selectedReq.id, {
        action: reviewAction,
        approved_relieving_date: reviewAction === 'APPROVE' ? approvedDate : undefined,
        admin_remarks: adminRemarks,
      });
      if (res && res.success) {
        setSuccess(
          reviewAction === 'APPROVE'
            ? 'Resignation accepted. Approved Last Working Day recorded.'
            : 'Resignation declined. Clearance and exit processing halted.'
        );
        await fetchRequests();
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
        setSuccess(`Offboarding finalized successfully. Employee account deactivated. Exit documents can be managed in the Exit Documents tab.`);
        setShowFinalizeModal(false);
        setSelectedReq((prev) => ({ ...prev, status: 'COMPLETED' }));
        await fetchRequests();
        await fetchDocuments(selectedReq.id);
      }
    } catch (err) {
      setError(err?.message || 'Failed to finalize offboarding.');
    } finally {
      setFinalizing(false);
    }
  };

  // Exit Document Action Handlers
  const openUploadModal = (docType = 'Relieving Letter') => {
    setUploadMode('CREATE');
    setUploadDocType(docType);
    setUploadCustomType('');
    setUploadFile(null);
    const minD = toDateInputValue(selectedReq?.approved_relieving_date || selectedReq?.requested_relieving_date);
    setUploadReleaseDate(minD || getTodayDateString());
    setUploadRemarks('');
    setUploadModalError('');
    setShowUploadModal(true);
  };

  const openReplaceModal = (doc) => {
    setUploadMode('REPLACE');
    setUploadDocType(doc.document_type);
    setUploadCustomType('');
    setUploadFile(null);
    setUploadReleaseDate(toDateInputValue(doc.release_date));
    setUploadRemarks(doc.remarks || '');
    setUploadModalError('');
    setShowUploadModal(true);
  };

  const openChangeDateModal = (doc) => {
    setChangeDateDoc(doc);
    setNewReleaseDate(toDateInputValue(doc.release_date));
    setChangeDateError('');
    setShowChangeDateModal(true);
  };

  const handleViewExitDoc = async (doc) => {
    try {
      setViewingDocId(doc.id);
      setDocsError('');
      const blob = await api.admin.exit.viewDocument(doc.id);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      setDocsError(err?.message || 'Failed to view document.');
    } finally {
      setViewingDocId(null);
    }
  };

  const handleDownloadExitDoc = async (doc) => {
    try {
      setDownloadingDocId(doc.id);
      setDocsError('');
      const blob = await api.admin.exit.downloadDocument(doc.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.document_name || `${doc.document_type.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setDocsError(err?.message || 'Failed to download document.');
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleUploadDocumentSubmit = async (e) => {
    e.preventDefault();
    if (!selectedReq) return;
    setUploadModalError('');

    const resolvedType = uploadDocType === 'Custom' ? uploadCustomType.trim() : uploadDocType;
    if (!resolvedType) {
      setUploadModalError('Please specify the document type.');
      return;
    }

    if (!uploadFile) {
      setUploadModalError('Please select a PDF file to upload.');
      return;
    }

    if (!uploadFile.name.toLowerCase().endsWith('.pdf') || uploadFile.type !== 'application/pdf') {
      setUploadModalError('Only valid PDF files (.pdf) are accepted.');
      return;
    }

    if (uploadFile.size > 10 * 1024 * 1024) {
      setUploadModalError('File size exceeds the 10MB limit.');
      return;
    }

    if (!uploadReleaseDate) {
      setUploadModalError('Please select a release date for this document.');
      return;
    }

    const lwd = toDateInputValue(selectedReq.approved_relieving_date || selectedReq.requested_relieving_date);
    if (lwd && uploadReleaseDate < lwd) {
      setUploadModalError(`Release date (${uploadReleaseDate}) cannot be earlier than Last Working Day (${lwd}).`);
      return;
    }

    try {
      setSubmittingDoc(true);
      const formData = new FormData();
      formData.append('document', uploadFile);
      formData.append('document_type', resolvedType);
      formData.append('release_date', uploadReleaseDate);
      if (uploadRemarks) {
        formData.append('remarks', uploadRemarks.trim());
      }

      const res = await api.admin.exit.uploadDocument(selectedReq.id, formData);
      if (res && res.success) {
        setDocsSuccess(`"${resolvedType}" uploaded successfully. Scheduled for release on ${formatDate(uploadReleaseDate)}.`);
        setShowUploadModal(false);
        await fetchDocuments(selectedReq.id);
      }
    } catch (err) {
      setUploadModalError(err?.message || 'Failed to upload exit document.');
    } finally {
      setSubmittingDoc(false);
    }
  };

  const handleUpdateReleaseDateSubmit = async (e) => {
    e.preventDefault();
    if (!changeDateDoc || !selectedReq) return;
    setChangeDateError('');

    if (!newReleaseDate) {
      setChangeDateError('Please choose a valid release date.');
      return;
    }

    const lwd = toDateInputValue(selectedReq.approved_relieving_date || selectedReq.requested_relieving_date);
    if (lwd && newReleaseDate < lwd) {
      setChangeDateError(`Release date (${newReleaseDate}) cannot be earlier than Last Working Day (${lwd}).`);
      return;
    }

    try {
      setUpdatingDate(true);
      const res = await api.admin.exit.updateReleaseDate(changeDateDoc.id, newReleaseDate);
      if (res && res.success) {
        setDocsSuccess(`Release date updated for "${changeDateDoc.document_type}" to ${formatDate(newReleaseDate)}.`);
        setShowChangeDateModal(false);
        await fetchDocuments(selectedReq.id);
      }
    } catch (err) {
      setChangeDateError(err?.message || 'Failed to update release date.');
    } finally {
      setUpdatingDate(false);
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
            Review resignations, coordinate departmental clearances, compute F&F settlements, and manage scheduled exit documents.
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
                  <th>Last Working Day</th>
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
                          {r.status === 'APPROVED' ? 'Accepted' : r.status === 'REJECTED' ? 'Declined' : r.status === 'SUBMITTED' ? 'Pending Review' : r.status.replace('_', ' ')}
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
                  {selectedReq.status === 'APPROVED' ? 'Accepted' : selectedReq.status === 'REJECTED' ? 'Declined' : selectedReq.status === 'SUBMITTED' ? 'Pending Review' : selectedReq.status.replace('_', ' ')}
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
              <button
                type="button"
                className={`drawer-tab ${modalTab === 'documents' ? 'active-tab' : ''}`}
                onClick={() => {
                  setModalTab('documents');
                  fetchDocuments(selectedReq.id);
                }}
              >
                4. Exit Documents
              </button>
            </div>

            <div className="drawer-body">
              {/* TAB 1: Review & Dates */}
              {modalTab === 'details' && (
                <div className="tab-pane">
                  <div className="info-block">
                    <h3 className="section-title">Resignation Request Details</h3>
                    <div className="grid-2col">
                      <div>
                        <span className="lbl">Employee</span>
                        <p className="val">{selectedReq.employee_name || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="lbl">Employee ID</span>
                        <p className="val">{selectedReq.employee_id}</p>
                      </div>
                      <div>
                        <span className="lbl">Resignation Date</span>
                        <p className="val">{formatDate(selectedReq.resignation_date)}</p>
                      </div>
                      <div>
                        <span className="lbl">Requested Last Working Day</span>
                        <p className="val">{formatDate(selectedReq.requested_relieving_date)}</p>
                      </div>
                      <div>
                        <span className="lbl">Approved Last Working Day</span>
                        <p className="val font-semibold">
                          {selectedReq.approved_relieving_date ? formatDate(selectedReq.approved_relieving_date) : 'Pending Admin Decision'}
                        </p>
                      </div>
                      <div>
                        <span className="lbl">Resignation Status</span>
                        <p className="val">
                          <span className={`status-badge badge-${selectedReq.status.toLowerCase()}`}>
                            {selectedReq.status === 'APPROVED' ? 'Accepted' : selectedReq.status === 'REJECTED' ? 'Declined' : selectedReq.status === 'SUBMITTED' ? 'Pending Admin Review' : selectedReq.status.replace('_', ' ')}
                          </span>
                        </p>
                      </div>
                      <div className="span-2">
                        <span className="lbl">Reason for Resignation</span>
                        <p className="val reason-text">{selectedReq.reason}</p>
                      </div>
                      {selectedReq.admin_remarks && (
                        <div className="span-2">
                          <span className="lbl">Admin Remarks / Reason</span>
                          <p className="val remarks-text">{selectedReq.admin_remarks}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {(selectedReq.status === 'SUBMITTED' || selectedReq.status === 'UNDER_REVIEW') && (
                    <div className="info-block review-block">
                      <h3 className="section-title">Review Actions</h3>
                      <p className="tab-desc">
                        Accept or decline this resignation request. Accepting saves the confirmed Last Working Day and opens clearance and settlement workflows.
                      </p>

                      <div className="review-action-toggle-row">
                        <button
                          type="button"
                          className={`action-btn-toggle ${reviewAction === 'APPROVE' ? 'toggle-accept-active' : ''}`}
                          onClick={() => setReviewAction('APPROVE')}
                        >
                          ✓ Accept Resignation
                        </button>
                        <button
                          type="button"
                          className={`action-btn-toggle ${reviewAction === 'REJECT' ? 'toggle-decline-active' : ''}`}
                          onClick={() => setReviewAction('REJECT')}
                        >
                          ✕ Decline Resignation
                        </button>
                      </div>

                      <form onSubmit={handleReviewSubmit} className="review-form">
                        {reviewAction === 'APPROVE' ? (
                          <>
                            <div className="form-row">
                              <div className="form-col">
                                <label htmlFor="approved_relieving_date" className="lbl">
                                  Approved Last Working Day <span className="text-danger">*</span>
                                </label>
                                <input
                                  id="approved_relieving_date"
                                  type="date"
                                  className="filter-input"
                                  value={approvedDate}
                                  onChange={(e) => setApprovedDate(e.target.value)}
                                  required
                                />
                                <span className="help-text">Company-approved last working day for this employee.</span>
                              </div>
                              <div className="form-col">
                                <label htmlFor="review_remarks_accept" className="lbl">Admin Remarks (Optional)</label>
                                <input
                                  id="review_remarks_accept"
                                  type="text"
                                  className="filter-input"
                                  placeholder="Approval notes or conditions..."
                                  value={adminRemarks}
                                  onChange={(e) => setAdminRemarks(e.target.value)}
                                />
                              </div>
                            </div>

                            <div className="form-actions-right">
                              <button
                                type="submit"
                                disabled={submittingReview}
                                className="admin-btn admin-btn-success"
                              >
                                {submittingReview ? 'Accepting...' : 'Confirm & Accept Resignation'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="form-row">
                              <div className="form-col span-2">
                                <label htmlFor="review_remarks_decline" className="lbl">
                                  Reason for Declining <span className="text-danger">*</span>
                                </label>
                                <textarea
                                  id="review_remarks_decline"
                                  rows={3}
                                  className="filter-input"
                                  placeholder="Provide a detailed reason explaining why this resignation is declined (required)..."
                                  value={adminRemarks}
                                  onChange={(e) => setAdminRemarks(e.target.value)}
                                  required
                                />
                                <span className="help-text">This reason will be visible to the employee on their portal.</span>
                              </div>
                            </div>

                            <div className="form-actions-right">
                              <button
                                type="submit"
                                disabled={submittingReview}
                                className="admin-btn admin-btn-danger"
                              >
                                {submittingReview ? 'Declining...' : 'Confirm & Decline Resignation'}
                              </button>
                            </div>
                          </>
                        )}
                      </form>
                    </div>
                  )}

                  {selectedReq.status === 'REJECTED' && (
                    <div className="admin-alert admin-alert-danger" style={{ marginTop: '1rem' }}>
                      <strong>Resignation Declined:</strong> This request was declined. Clearance, F&F settlement, and exit document processing are halted.
                    </div>
                  )}

                  {selectedReq.status === 'COMPLETED' && (
                    <div className="completion-banner">
                      <h4>Offboarding Completed</h4>
                      <p>This employee separation was finalized on {formatDate(selectedReq.completed_at)}. Account access is inactive.</p>
                      <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem' }}>
                        Official exit documents are managed and released to the employee under the <strong>Exit Documents</strong> tab.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setModalTab('documents');
                          fetchDocuments(selectedReq.id);
                        }}
                        className="admin-btn admin-btn-sm admin-btn-primary"
                      >
                        Manage Exit Documents →
                      </button>
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

                  {selectedReq.status === 'REJECTED' ? (
                    <div className="admin-alert admin-alert-warning">
                      This resignation was declined. Department clearances are not applicable.
                    </div>
                  ) : (
                    <div className="clearance-cards-list">
                      {clearances.map((c) => (
                        <div key={c.id} className="clearance-edit-row">
                          <div className="clr-info">
                            <h4 className="clr-dept">{c.department.replace('_', ' ')}</h4>
                            <span className={`status-badge badge-${c.status.toLowerCase()}`}>{c.status}</span>
                            {c.cleared_at && <span className="clr-date">Updated: {formatDate(c.cleared_at)}</span>}
                          </div>

                          {selectedReq.status !== 'COMPLETED' && selectedReq.status !== 'WITHDRAWN' && (
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
                  )}
                </div>
              )}

              {/* TAB 3: F&F Settlement */}
              {modalTab === 'fnf' && (
                <div className="tab-pane">
                  <h3 className="section-title">Full & Final (F&F) Settlement Computation</h3>
                  <p className="tab-desc">
                    Review and calibrate final salary calculations. Values are dynamically computed on the backend server.
                  </p>

                  {selectedReq.status === 'REJECTED' ? (
                    <div className="admin-alert admin-alert-warning">
                      This resignation was declined. Full & Final settlement is not applicable.
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              )}

              {/* TAB 4: Exit Documents */}
              {modalTab === 'documents' && (
                <div className="tab-pane">
                  <div className="tab-header-flex">
                    <div>
                      <h3 className="section-title">Official Exit Documents Management</h3>
                      <p className="tab-desc">
                        Manually upload externally prepared PDF exit documents and configure independent release dates. Documents remain locked until their specified release date.
                      </p>
                    </div>
                    {['APPROVED', 'COMPLETED'].includes(selectedReq.status) && (
                      <button
                        type="button"
                        onClick={() => openUploadModal('Other Exit Document')}
                        className="admin-btn admin-btn-sm admin-btn-secondary"
                      >
                        + Upload Custom Document
                      </button>
                    )}
                  </div>

                  {docsError && <div className="admin-alert admin-alert-danger">{docsError}</div>}
                  {docsSuccess && <div className="admin-alert admin-alert-success">{docsSuccess}</div>}

                  {selectedReq.status === 'REJECTED' || selectedReq.status === 'WITHDRAWN' ? (
                    <div className="admin-alert admin-alert-warning">
                      This exit request was {selectedReq.status === 'REJECTED' ? 'declined' : 'withdrawn'}. Exit documents cannot be scheduled or issued.
                    </div>
                  ) : selectedReq.status === 'SUBMITTED' || selectedReq.status === 'UNDER_REVIEW' ? (
                    <div className="admin-alert admin-alert-warning">
                      Please review and accept this resignation before uploading official exit documents.
                    </div>
                  ) : loadingDocs ? (
                    <div className="admin-loading-state">
                      <div className="admin-spinner" />
                      <p>Loading exit documents...</p>
                    </div>
                  ) : (
                    <>
                      {/* Document Slots Table */}
                      <div className="exit-docs-table-card">
                        <table className="exit-docs-table">
                          <thead>
                            <tr>
                              <th>Document Type</th>
                              <th>Status</th>
                              <th>Release Date</th>
                              <th>Uploaded On</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {documentsData.standard_slots?.map((slot) => {
                              const doc = slot.document;
                              const isUploaded = !!doc;
                              const status = slot.status; // 'NOT_UPLOADED' | 'SCHEDULED' | 'AVAILABLE'

                              return (
                                <tr key={slot.document_type}>
                                  <td>
                                    <div className="doc-type-info">
                                      <strong className="doc-main-name">{slot.document_type}</strong>
                                      {doc && (
                                        <span className="doc-filename">
                                          {doc.document_name} &bull; {formatFileSize(doc.file_size)}
                                        </span>
                                      )}
                                      {doc?.remarks && <span className="doc-remarks-note">Note: {doc.remarks}</span>}
                                    </div>
                                  </td>
                                  <td>
                                    <span className={`doc-status-badge badge-${status.toLowerCase()}`}>
                                      {status === 'NOT_UPLOADED' ? 'Not Uploaded' : status === 'SCHEDULED' ? 'Scheduled' : 'Available'}
                                    </span>
                                  </td>
                                  <td>
                                    {isUploaded ? (
                                      <div className="doc-date-cell">
                                        <span className="doc-release-date">{formatDate(doc.release_date)}</span>
                                        <span className={`doc-release-hint ${doc.is_available ? 'released-hint' : 'locked-hint'}`}>
                                          {doc.is_available ? 'Available to employee' : 'Locked for employee'}
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-muted">—</span>
                                    )}
                                  </td>
                                  <td>
                                    {isUploaded ? (
                                      <span className="doc-upload-time">{formatDate(doc.created_at)}</span>
                                    ) : (
                                      <span className="text-muted">—</span>
                                    )}
                                  </td>
                                  <td>
                                    <div className="doc-action-btns">
                                      {isUploaded ? (
                                        <>
                                          <button
                                            type="button"
                                            disabled={viewingDocId === doc.id}
                                            onClick={() => handleViewExitDoc(doc)}
                                            className="admin-btn admin-btn-xs admin-btn-secondary"
                                            title="Preview PDF"
                                          >
                                            {viewingDocId === doc.id ? 'Opening...' : 'View'}
                                          </button>
                                          <button
                                            type="button"
                                            disabled={downloadingDocId === doc.id}
                                            onClick={() => handleDownloadExitDoc(doc)}
                                            className="admin-btn admin-btn-xs admin-btn-secondary"
                                            title="Download PDF"
                                          >
                                            {downloadingDocId === doc.id ? '...' : 'Download'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openReplaceModal(doc)}
                                            className="admin-btn admin-btn-xs admin-btn-primary"
                                            title="Replace with updated PDF"
                                          >
                                            Replace
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openChangeDateModal(doc)}
                                            className="admin-btn admin-btn-xs admin-btn-outline"
                                            title="Change employee availability date"
                                          >
                                            Change Date
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => openUploadModal(slot.document_type)}
                                          className="admin-btn admin-btn-xs admin-btn-primary"
                                        >
                                          Upload Document
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Replaced Version History (Collapsible) */}
                      {documentsData.replaced_history && documentsData.replaced_history.length > 0 && (
                        <div className="doc-history-section">
                          <button
                            type="button"
                            className="history-toggle-btn"
                            onClick={() => setShowHistory(!showHistory)}
                          >
                            {showHistory ? '▼' : '►'} Replaced Documents History ({documentsData.replaced_history.length})
                          </button>
                          {showHistory && (
                            <div className="history-table-wrapper">
                              <table className="exit-docs-table history-table">
                                <thead>
                                  <tr>
                                    <th>Document Type</th>
                                    <th>Previous File</th>
                                    <th>Original Release Date</th>
                                    <th>Replaced Date</th>
                                    <th>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {documentsData.replaced_history.map((h) => (
                                    <tr key={h.id}>
                                      <td><strong>{h.document_type}</strong></td>
                                      <td>{h.document_name} &bull; {formatFileSize(h.file_size)}</td>
                                      <td>{formatDate(h.release_date)}</td>
                                      <td>{formatDate(h.created_at)}</td>
                                      <td>
                                        <button
                                          type="button"
                                          disabled={downloadingDocId === h.id}
                                          onClick={() => handleDownloadExitDoc(h)}
                                          className="admin-btn admin-btn-xs admin-btn-secondary"
                                        >
                                          Download
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload / Replace Document Modal */}
      {showUploadModal && (
        <div className="admin-modal-backdrop-alert">
          <div className="admin-confirm-dialog modal-md">
            <div className="modal-header-simple">
              <h3 className="confirm-title" style={{ color: '#0f172a' }}>
                {uploadMode === 'REPLACE' ? `Replace Document: ${uploadDocType}` : 'Upload Exit Document'}
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="drawer-close-btn"
                disabled={submittingDoc}
              >
                &times;
              </button>
            </div>

            <p className="tab-desc" style={{ marginBottom: '1rem' }}>
              {uploadMode === 'REPLACE'
                ? 'Uploading a new PDF will archive the previous version and immediately activate this new version for the employee according to the release date.'
                : 'Upload an externally prepared PDF document and choose the date when it should become visible and downloadable to the employee.'}
            </p>

            {uploadModalError && (
              <div className="admin-alert admin-alert-danger" style={{ marginBottom: '1rem' }}>
                {uploadModalError}
              </div>
            )}

            <form onSubmit={handleUploadDocumentSubmit}>
              {uploadMode === 'CREATE' && (
                <div className="form-group-spaced">
                  <label className="lbl">Document Type <span className="text-danger">*</span></label>
                  <select
                    className="filter-select"
                    value={uploadDocType}
                    onChange={(e) => setUploadDocType(e.target.value)}
                    disabled={submittingDoc}
                  >
                    <option value="Relieving Letter">Relieving Letter</option>
                    <option value="Experience Certificate">Experience Certificate</option>
                    <option value="FnF Statement">Full & Final Settlement Statement</option>
                    <option value="Other Exit Document">Other Exit Document</option>
                    <option value="Custom">Custom Document Type...</option>
                  </select>
                </div>
              )}

              {uploadDocType === 'Custom' && uploadMode === 'CREATE' && (
                <div className="form-group-spaced">
                  <label className="lbl">Custom Document Name <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    className="filter-input"
                    placeholder="e.g. Non-Disclosure Undertaking"
                    value={uploadCustomType}
                    onChange={(e) => setUploadCustomType(e.target.value)}
                    required
                    disabled={submittingDoc}
                  />
                </div>
              )}

              <div className="form-group-spaced">
                <label className="lbl">Select PDF File <span className="text-danger">*</span></label>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="filter-input"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  required
                  disabled={submittingDoc}
                />
                <span className="help-text">Only PDF files up to 10MB are permitted.</span>
              </div>

              <div className="form-group-spaced">
                <label className="lbl">Employee Release Date <span className="text-danger">*</span></label>
                <input
                  type="date"
                  className="filter-input"
                  min={toDateInputValue(selectedReq?.approved_relieving_date || selectedReq?.requested_relieving_date)}
                  value={uploadReleaseDate}
                  onChange={(e) => setUploadReleaseDate(e.target.value)}
                  required
                  disabled={submittingDoc}
                />
                <span className="help-text">
                  Document is locked from employee view/download until this date. Must be on or after Last Working Day ({formatDate(selectedReq?.approved_relieving_date || selectedReq?.requested_relieving_date)}).
                </span>
              </div>

              <div className="form-group-spaced">
                <label className="lbl">Admin Remarks (Optional)</label>
                <textarea
                  rows={2}
                  className="filter-input"
                  placeholder="Add internal notes or version notes..."
                  value={uploadRemarks}
                  onChange={(e) => setUploadRemarks(e.target.value)}
                  disabled={submittingDoc}
                />
              </div>

              <div className="confirm-actions" style={{ marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setShowUploadModal(false)}
                  disabled={submittingDoc}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={submittingDoc}
                >
                  {submittingDoc
                    ? (uploadMode === 'REPLACE' ? 'Replacing...' : 'Uploading...')
                    : (uploadMode === 'REPLACE' ? 'Replace Document' : 'Upload & Schedule')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Release Date Modal */}
      {showChangeDateModal && changeDateDoc && (
        <div className="admin-modal-backdrop-alert">
          <div className="admin-confirm-dialog modal-sm">
            <div className="modal-header-simple">
              <h3 className="confirm-title" style={{ color: '#0f172a' }}>
                Change Release Date
              </h3>
              <button
                type="button"
                onClick={() => setShowChangeDateModal(false)}
                className="drawer-close-btn"
                disabled={updatingDate}
              >
                &times;
              </button>
            </div>

            <p className="tab-desc" style={{ marginBottom: '1rem' }}>
              Update release date for <strong>{changeDateDoc.document_type}</strong>. Current: {formatDate(changeDateDoc.release_date)}.
            </p>

            {changeDateError && (
              <div className="admin-alert admin-alert-danger" style={{ marginBottom: '1rem' }}>
                {changeDateError}
              </div>
            )}

            <form onSubmit={handleUpdateReleaseDateSubmit}>
              <div className="form-group-spaced">
                <label className="lbl">New Release Date <span className="text-danger">*</span></label>
                <input
                  type="date"
                  className="filter-input"
                  min={toDateInputValue(selectedReq?.approved_relieving_date || selectedReq?.requested_relieving_date)}
                  value={newReleaseDate}
                  onChange={(e) => setNewReleaseDate(e.target.value)}
                  required
                  disabled={updatingDate}
                />
                <span className="help-text">
                  Must be on or after Last Working Day ({formatDate(selectedReq?.approved_relieving_date || selectedReq?.requested_relieving_date)}).
                </span>
              </div>

              <div className="confirm-actions" style={{ marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setShowChangeDateModal(false)}
                  disabled={updatingDate}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={updatingDate}
                >
                  {updatingDate ? 'Updating...' : 'Save New Release Date'}
                </button>
              </div>
            </form>
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
              <li>Employee and User statuses will permanently transition to <strong>INACTIVE</strong>.</li>
              <li>All active OTPs will be invalidated and future portal login blocked.</li>
              <li>Official exit documents (Relieving Letter, Experience Certificate, F&F Statement) are uploaded manually with independent release dates in the <strong>Exit Documents</strong> tab.</li>
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
