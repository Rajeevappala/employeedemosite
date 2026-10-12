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

const getMinDate = () => new Date().toISOString().split('T')[0];

export default function EmployeeExit() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState(null);
  const [viewingDocId, setViewingDocId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [exitData, setExitData] = useState({
    exitRequest: null,
    clearances: [],
    settlement: null,
    exitDocuments: [],
  });

  // Form State
  const [requestedRelievingDate, setRequestedRelievingDate] = useState('');
  const [reason, setReason] = useState('');
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  const fetchExitStatus = useCallback(async () => {
    try {
      const res = await api.employee.exit.getStatus();
      if (res && res.success) {
        setExitData(res.data);
      }
    } catch (err) {
      setError(err?.message || 'Failed to fetch offboarding status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      try {
        const res = await api.employee.exit.getStatus();
        if (!ignore && res && res.success) {
          setExitData(res.data);
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Failed to fetch offboarding status.');
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

  const handleApply = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!requestedRelievingDate) {
      setError('Please select a requested relieving date.');
      return;
    }

    if (!reason || reason.trim().length < 10) {
      setError('Please provide a detailed reason of at least 10 characters.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.employee.exit.apply({
        requested_relieving_date: requestedRelievingDate,
        reason: reason.trim(),
      });
      if (res && res.success) {
        setSuccess('Resignation request submitted successfully. Status: Pending Admin Review.');
        setRequestedRelievingDate('');
        setReason('');
        await fetchExitStatus();
      }
    } catch (err) {
      setError(err?.message || 'Failed to submit resignation request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    try {
      setSubmitting(true);
      setError('');
      const res = await api.employee.exit.withdraw();
      if (res && res.success) {
        setSuccess('Resignation request withdrawn successfully.');
        setShowWithdrawModal(false);
        await fetchExitStatus();
      }
    } catch (err) {
      setError(err?.message || 'Failed to withdraw resignation.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewExitDoc = async (doc) => {
    try {
      setViewingDocId(doc.id);
      setError('');
      const blob = await api.employee.exit.viewDocument(doc.id);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      setError(err?.message || `Failed to view ${doc.document_type}.`);
    } finally {
      setViewingDocId(null);
    }
  };

  const handleDownloadExitDoc = async (doc) => {
    try {
      setDownloadingDocId(doc.id);
      setError('');
      const blob = await api.employee.exit.downloadDocument(doc.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.document_name || `${doc.document_type.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || `Failed to download ${doc.document_type}.`);
    } finally {
      setDownloadingDocId(null);
    }
  };

  const exitRequest = exitData.exitRequest;
  const clearances = exitData.clearances || [];
  const settlement = exitData.settlement;
  const exitDocuments = exitData.exitDocuments || [];
  const status = exitRequest?.status;

  const minDate = getMinDate();

  return (
    <div className="exit-page-container">
      <div className="exit-header">
        <div>
          <h1 className="exit-title">Exit & Relieving</h1>
          <p className="exit-subtitle">
            Manage your resignation request, monitor department clearances, view settlement details, and access official exit documents.
          </p>
        </div>
      </div>

      {error && <div className="exit-alert exit-alert-danger">{error}</div>}
      {success && <div className="exit-alert exit-alert-success">{success}</div>}

      {loading ? (
        <div className="exit-loading-card">
          <div className="exit-spinner" />
          <p>Loading offboarding records...</p>
        </div>
      ) : !exitRequest || status === 'WITHDRAWN' || status === 'REJECTED' ? (
        <div className="exit-card-grid">
          {/* Resignation Application Card */}
          <div className="exit-card">
            <h2 className="exit-card-title">Submit Resignation</h2>
            <p className="exit-card-desc">
              Please enter your proposed last working day and the reason for leaving. Once submitted, your request will be reviewed and decided by Admin.
            </p>

            {status === 'REJECTED' && (
              <div className="exit-alert exit-alert-warning">
                <strong>Resignation Status: Declined</strong>
                <p style={{ margin: '0.25rem 0 0 0' }}>
                  Your previous resignation submitted on {formatDate(exitRequest.resignation_date)} was declined by Admin.
                  {exitRequest.admin_remarks && ` Reason: "${exitRequest.admin_remarks}"`}
                </p>
              </div>
            )}

            {status === 'WITHDRAWN' && (
              <div className="exit-alert exit-alert-info">
                Your previous resignation was withdrawn. You may submit a new request if needed.
              </div>
            )}

            <form onSubmit={handleApply} className="exit-form">
              <div className="exit-form-group">
                <label className="exit-form-label" htmlFor="requested_relieving_date">
                  Requested Last Working Day <span className="exit-required">*</span>
                </label>
                <input
                  id="requested_relieving_date"
                  type="date"
                  min={minDate}
                  className="exit-form-input"
                  value={requestedRelievingDate}
                  onChange={(e) => setRequestedRelievingDate(e.target.value)}
                  required
                />
                <span className="exit-form-help">Must be today or a future date adhering to your standard notice period.</span>
              </div>

              <div className="exit-form-group">
                <label className="exit-form-label" htmlFor="exit_reason">
                  Reason for Resignation <span className="exit-required">*</span>
                </label>
                <textarea
                  id="exit_reason"
                  rows={4}
                  className="exit-form-textarea"
                  placeholder="Please describe your reason for resignation (minimum 10 characters)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="exit-btn exit-btn-primary"
              >
                {submitting ? 'Submitting...' : 'Submit Resignation'}
              </button>
            </form>
          </div>

          {/* Separation Policy Overview Card */}
          <div className="exit-card exit-info-card">
            <h3 className="exit-info-title">Offboarding Guidelines</h3>
            <ul className="exit-policy-list">
              <li>
                <strong>Admin Decision:</strong> Resignation requests are reviewed by Admin/HR. Admin will confirm the company-approved Last Working Day.
              </li>
              <li>
                <strong>Clearance Handover:</strong> Handover company hardware (IT), settle corporate dues (Finance), and complete knowledge transfer (Department Head).
              </li>
              <li>
                <strong>Leave Encashment:</strong> Eligible accrued Paid Leave (PL) balance will be calculated in your Full & Final (F&F) settlement.
              </li>
              <li>
                <strong>Exit Documents:</strong> Official exit documents (Relieving Letter, Experience Certificate, F&F Statement) are uploaded by Admin and become available on their designated release dates.
              </li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="exit-active-view">
          {/* Lifecycle Stepper */}
          <div className="exit-card exit-stepper-card">
            <div className="exit-stepper">
              <div className={`step-item ${['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'COMPLETED'].includes(status) ? 'step-active' : ''}`}>
                <div className="step-circle">1</div>
                <div className="step-label">Submitted</div>
              </div>
              <div className="step-line" />
              <div className={`step-item ${['UNDER_REVIEW', 'APPROVED', 'COMPLETED'].includes(status) ? 'step-active' : ''}`}>
                <div className="step-circle">2</div>
                <div className="step-label">Under Review</div>
              </div>
              <div className="step-line" />
              <div className={`step-item ${['APPROVED', 'COMPLETED'].includes(status) ? 'step-active' : ''}`}>
                <div className="step-circle">3</div>
                <div className="step-label">Accepted</div>
              </div>
              <div className="step-line" />
              <div className={`step-item ${status === 'COMPLETED' ? 'step-active' : ''}`}>
                <div className="step-circle">4</div>
                <div className="step-label">Completed</div>
              </div>
            </div>
          </div>

          {/* Request Status Banner */}
          <div className="exit-card exit-summary-card">
            <div className="exit-summary-header">
              <div>
                <span className={`exit-status-badge badge-${status.toLowerCase()}`}>
                  {status === 'APPROVED' ? 'Accepted' : status === 'SUBMITTED' ? 'Pending Admin Review' : status.replace('_', ' ')}
                </span>
                <h2 className="exit-summary-title">Resignation Request Overview</h2>
              </div>
              {(status === 'SUBMITTED' || status === 'UNDER_REVIEW') && (
                <button
                  type="button"
                  onClick={() => setShowWithdrawModal(true)}
                  className="exit-btn exit-btn-danger"
                >
                  Withdraw Resignation
                </button>
              )}
            </div>

            <div className="exit-details-grid">
              <div className="detail-item">
                <span className="detail-label">Resignation Status</span>
                <span className="detail-value font-semibold">
                  {status === 'APPROVED' ? 'Accepted' : status === 'SUBMITTED' ? 'Pending Admin Review' : status === 'UNDER_REVIEW' ? 'Under Review' : status}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Resignation Date</span>
                <span className="detail-value">{formatDate(exitRequest.resignation_date)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">
                  {status === 'APPROVED' || status === 'COMPLETED' ? 'Approved Last Working Day' : 'Requested Last Working Day'}
                </span>
                <span className="detail-value font-semibold">
                  {status === 'APPROVED' || status === 'COMPLETED'
                    ? (exitRequest.approved_relieving_date ? formatDate(exitRequest.approved_relieving_date) : formatDate(exitRequest.requested_relieving_date))
                    : formatDate(exitRequest.requested_relieving_date)}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Reason</span>
                <span className="detail-value">{exitRequest.reason}</span>
              </div>
            </div>

            {exitRequest.admin_remarks && (
              <div className="exit-admin-remarks">
                <strong>Admin Remarks:</strong> {exitRequest.admin_remarks}
              </div>
            )}
          </div>

          {/* Department Clearance Matrix */}
          <div className="exit-card">
            <h2 className="exit-card-title">Department Clearance Status</h2>
            <p className="exit-card-desc">All departments must verify asset returns, expense settlements, and handovers before your exit can be finalized.</p>

            <div className="clearance-grid">
              {clearances.map((c) => (
                <div key={c.id || c.department} className={`clearance-box clearance-${c.status.toLowerCase()}`}>
                  <div className="clearance-box-header">
                    <span className="clearance-dept-name">{c.department.replace('_', ' ')}</span>
                    <span className={`clearance-badge status-${c.status.toLowerCase()}`}>{c.status}</span>
                  </div>
                  {c.remarks ? (
                    <p className="clearance-remarks">{c.remarks}</p>
                  ) : (
                    <p className="clearance-pending-note">
                      {c.status === 'CLEARED' ? 'No outstanding dues.' : 'Awaiting departmental review.'}
                    </p>
                  )}
                  {c.cleared_at && (
                    <span className="clearance-timestamp">Cleared on {formatDate(c.cleared_at)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Full & Final Settlement (If completed) */}
          {settlement && (
            <div className="exit-card">
              <h2 className="exit-card-title">Full & Final Settlement</h2>
              <div className="settlement-summary-box">
                <div className="settlement-stat">
                  <span>Status</span>
                  <strong className="text-emerald">Completed</strong>
                </div>
                <div className="settlement-stat">
                  <span>Payable Days</span>
                  <strong>{settlement.payable_days} days</strong>
                </div>
                <div className="settlement-stat">
                  <span>Encashed PL</span>
                  <strong>{settlement.encashed_leave_days} days</strong>
                </div>
                <div className="settlement-stat">
                  <span>Net Settlement</span>
                  <strong className="text-emerald">{formatINR(settlement.net_payable_amount)}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Official Exit Documents (Available after Resignation Acceptance) */}
          {(status === 'APPROVED' || status === 'COMPLETED') && (
            <div className="exit-card exit-documents-card">
              <h2 className="exit-card-title">Official Exit Documents</h2>
              <p className="exit-card-desc">
                Official separation documents prepared by the company. Each document becomes available for viewing and downloading on its designated release date.
              </p>

              {exitDocuments.length > 0 ? (
                <div className="exit-download-grid">
                  {exitDocuments.map((doc) => {
                    const isAvailable = doc.is_available || doc.status === 'AVAILABLE';

                    return (
                      <div key={doc.id} className={`download-tile ${isAvailable ? 'tile-available' : 'tile-scheduled'}`}>
                        <div className="download-tile-info">
                          <div className="tile-badge-row">
                            <span className={`exit-doc-status-pill ${isAvailable ? 'pill-available' : 'pill-scheduled'}`}>
                              {isAvailable ? 'Available' : `Available from ${formatDate(doc.release_date)}`}
                            </span>
                          </div>
                          <h3>{doc.document_type}</h3>
                          <p className="doc-tile-desc">
                            {isAvailable
                              ? `Released on ${formatDate(doc.release_date)}. Official verified exit document.`
                              : `Scheduled for release on ${formatDate(doc.release_date)}. This document will unlock on the release date.`}
                          </p>
                          {doc.remarks && <p className="doc-remarks-small">Note: {doc.remarks}</p>}
                        </div>

                        <div className="download-tile-actions">
                          {isAvailable ? (
                            <div className="doc-btn-group">
                              <button
                                type="button"
                                disabled={viewingDocId === doc.id}
                                onClick={() => handleViewExitDoc(doc)}
                                className="exit-btn exit-btn-sm exit-btn-secondary"
                              >
                                {viewingDocId === doc.id ? 'Opening...' : 'View PDF'}
                              </button>
                              <button
                                type="button"
                                disabled={downloadingDocId === doc.id}
                                onClick={() => handleDownloadExitDoc(doc)}
                                className="exit-btn exit-btn-sm exit-btn-primary"
                              >
                                {downloadingDocId === doc.id ? 'Downloading...' : 'Download'}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="exit-btn exit-btn-locked"
                              title={`This document unlocks on ${formatDate(doc.release_date)}`}
                            >
                              🔒 Available on {formatDate(doc.release_date)}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="exit-empty-docs-box">
                  <div className="empty-docs-icon">📄</div>
                  <h4>Exit Documents in Preparation</h4>
                  <p>
                    Your exit documents (such as Relieving Letter, Experience Certificate, and F&F Settlement Statement) are prepared by HR/Management and uploaded with scheduled release dates. Once scheduled, they will appear here.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Withdrawal */}
      {showWithdrawModal && (
        <div className="exit-modal-backdrop">
          <div className="exit-modal">
            <h3 className="exit-modal-title">Withdraw Resignation</h3>
            <p className="exit-modal-text">
              Are you sure you want to withdraw your resignation request? This action will cancel the ongoing offboarding process and maintain your active employment status.
            </p>
            <div className="exit-modal-actions">
              <button
                type="button"
                className="exit-btn exit-btn-secondary"
                onClick={() => setShowWithdrawModal(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="exit-btn exit-btn-danger"
                onClick={handleWithdraw}
                disabled={submitting}
              >
                {submitting ? 'Withdrawing...' : 'Confirm Withdrawal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
