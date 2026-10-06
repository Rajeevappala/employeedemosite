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
  const [downloading, setDownloading] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [exitData, setExitData] = useState({
    exitRequest: null,
    clearances: [],
    settlement: null,
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
        setSuccess('Resignation request submitted successfully.');
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

  const handleDownload = async (docType, apiFunc) => {
    try {
      setDownloading((prev) => ({ ...prev, [docType]: true }));
      setError('');
      const blob = await apiFunc();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docType.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || `Failed to download ${docType}.`);
    } finally {
      setDownloading((prev) => ({ ...prev, [docType]: false }));
    }
  };

  const exitRequest = exitData.exitRequest;
  const clearances = exitData.clearances || [];
  const settlement = exitData.settlement;
  const status = exitRequest?.status;

  const minDate = getMinDate();

  return (
    <div className="exit-page-container">
      <div className="exit-header">
        <div>
          <h1 className="exit-title">Exit & Relieving</h1>
          <p className="exit-subtitle">Manage your resignation, track department clearances, and download official relieving letters.</p>
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
              Please enter your proposed last working day and the reason for leaving. Submitting this form initiates standard notice period tracking and departmental clearance workflows.
            </p>

            {status === 'REJECTED' && (
              <div className="exit-alert exit-alert-warning">
                Your previous resignation submitted on {formatDate(exitRequest.resignation_date)} was rejected.
                {exitRequest.admin_remarks && ` Remarks: "${exitRequest.admin_remarks}"`}
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
                <strong>Notice Period:</strong> Ensure your requested date aligns with company terms. Admin will confirm the final relieving date.
              </li>
              <li>
                <strong>Clearance Handover:</strong> Handover company hardware (IT), settle corporate dues (Finance), and complete knowledge transfer (Department Head).
              </li>
              <li>
                <strong>Leave Encashment:</strong> Eligible accrued Paid Leave (PL) balance will be calculated in your Full & Final (F&F) settlement.
              </li>
              <li>
                <strong>Official Documents:</strong> Relieving Letter, Experience Certificate, and F&F Settlement Statement become downloadable immediately upon finalization.
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
                <div className="step-label">Approved</div>
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
                <span className={`exit-status-badge badge-${status.toLowerCase()}`}>{status.replace('_', ' ')}</span>
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
                <span className="detail-label">Submission Date</span>
                <span className="detail-value">{formatDate(exitRequest.resignation_date)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Requested Relieving Date</span>
                <span className="detail-value">{formatDate(exitRequest.requested_relieving_date)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Approved Relieving Date</span>
                <span className="detail-value font-semibold">
                  {exitRequest.approved_relieving_date ? formatDate(exitRequest.approved_relieving_date) : 'Pending Review'}
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

          {/* Completed Exit Documents */}
          {status === 'COMPLETED' && (
            <div className="exit-card exit-documents-card">
              <h2 className="exit-card-title">Official Exit Documents</h2>
              <p className="exit-card-desc">
                Your offboarding and Full & Final settlement have been completed. You can download your official, verified separation documents below:
              </p>

              {settlement && (
                <div className="settlement-summary-box">
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
              )}

              <div className="exit-download-grid">
                <div className="download-tile">
                  <div className="download-tile-info">
                    <h3>Relieving Letter</h3>
                    <p>Official release confirming resignation acceptance and service dates.</p>
                  </div>
                  <button
                    type="button"
                    disabled={downloading['Relieving Letter']}
                    onClick={() => handleDownload('Relieving Letter', api.employee.exit.downloadRelievingLetter)}
                    className="exit-btn exit-btn-outline"
                  >
                    {downloading['Relieving Letter'] ? 'Downloading...' : 'Download PDF'}
                  </button>
                </div>

                <div className="download-tile">
                  <div className="download-tile-info">
                    <h3>Experience Certificate</h3>
                    <p>Formal certificate detailing employment period, role, and conduct.</p>
                  </div>
                  <button
                    type="button"
                    disabled={downloading['Experience Certificate']}
                    onClick={() => handleDownload('Experience Certificate', api.employee.exit.downloadExperienceCertificate)}
                    className="exit-btn exit-btn-outline"
                  >
                    {downloading['Experience Certificate'] ? 'Downloading...' : 'Download PDF'}
                  </button>
                </div>

                <div className="download-tile">
                  <div className="download-tile-info">
                    <h3>F&F Settlement Statement</h3>
                    <p>Itemized breakdown of prorated salary, leave encashment, and deductions.</p>
                  </div>
                  <button
                    type="button"
                    disabled={downloading['FnF Statement']}
                    onClick={() => handleDownload('FnF Statement', api.employee.exit.downloadFnfStatement)}
                    className="exit-btn exit-btn-outline"
                  >
                    {downloading['FnF Statement'] ? 'Downloading...' : 'Download PDF'}
                  </button>
                </div>
              </div>
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
