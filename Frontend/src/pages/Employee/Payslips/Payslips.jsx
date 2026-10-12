import { useState, useEffect } from 'react';
import api from '../../../services/api';
import './Payslips.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const AVAILABLE_YEARS = ['all', '2026', '2025', '2024'];

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
 * Returns human-readable month name for numeric month (1-12)
 */
function getMonthName(monthNum) {
  if (!monthNum) return '';
  const idx = parseInt(monthNum, 10) - 1;
  return MONTH_NAMES[idx] || `Month ${monthNum}`;
}

/**
 * Formats ISO date to friendly display (e.g. 01 Oct 2026)
 */
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

// ============================================================================
// Secure PDF Preview Modal
// ============================================================================
function PayslipPreviewModal({ slip, onClose, onDownload }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    let createdUrl = null;

    if (!slip || !slip.id) return;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      try {
        const blob = await api.employee.viewPayslip(slip.id);
        if (isCancelled) return;

        const url = window.URL.createObjectURL(blob);
        createdUrl = url;
        setObjectUrl(url);
      } catch (err) {
        if (!isCancelled) {
          setError(err?.message || 'Unable to load payslip preview.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadPdf();

    // Cleanup: revoke object URL on modal close or unmount to avoid memory leaks
    return () => {
      isCancelled = true;
      if (createdUrl) {
        window.URL.revokeObjectURL(createdUrl);
      }
    };
  }, [slip]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!slip) return null;

  const monthLabel = slip.month ? getMonthName(slip.month) : '';
  const title = monthLabel && slip.year
    ? `Payslip - ${monthLabel} ${slip.year}`
    : slip.file_name || 'Payslip Preview';

  return (
    <div
      className="payslip-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="payslip-modal-title"
    >
      <div
        className="payslip-modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payslip-modal-header">
          <div className="payslip-modal-headings">
            <h3 id="payslip-modal-title" className="payslip-modal-title">
              {title}
            </h3>
            <span className="payslip-modal-file">{slip.file_name}</span>
          </div>
          <button
            type="button"
            className="payslip-modal-close"
            onClick={onClose}
            aria-label="Close payslip preview"
          >
            &times;
          </button>
        </div>

        <div className="payslip-modal-content">
          {loading ? (
            <div className="payslips-state-card" style={{ border: 'none', background: '#ffffff', minHeight: '400px' }}>
              <div className="payslips-state-icon loading">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
              </div>
              <h4 className="payslips-state-title">Loading payslip preview...</h4>
              <p className="payslips-state-subtitle">Please wait while your document is securely retrieved.</p>
            </div>
          ) : error ? (
            <div className="payslips-state-card" style={{ border: 'none', background: '#ffffff', minHeight: '400px' }}>
              <div className="payslips-state-icon error">
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h4 className="payslips-state-title" style={{ color: '#dc2626' }}>
                Unable to preview payslip
              </h4>
              <p className="payslips-state-subtitle">{error}</p>
            </div>
          ) : objectUrl ? (
            <iframe
              src={objectUrl}
              title={slip.file_name || 'Payslip PDF Preview'}
              className="payslip-preview-frame"
            />
          ) : null}
        </div>

        <div className="payslip-modal-footer">
          {onDownload && (
            <button
              type="button"
              className="payslip-btn payslip-btn-download"
              onClick={() => onDownload(slip)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </button>
          )}
          <button
            type="button"
            className="doc-modal-close-btn"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Employee Payslips Component
// ============================================================================
function Payslips() {
  const [payslips, setPayslips] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  // UI state
  const [previewSlip, setPreviewSlip] = useState(null);
  const [downloadNotice, setDownloadNotice] = useState('');

  // Fetch payslips whenever filters or pagination changes
  useEffect(() => {
    let ignore = false;

    async function fetchPayslips() {
      setLoading(true);
      setError(null);
      try {
        const params = {
          page: currentPage,
          limit: 10,
        };
        if (selectedYear !== 'all') {
          params.year = selectedYear;
        }
        if (selectedMonth !== 'all') {
          params.month = selectedMonth;
        }

        const response = await api.employee.getPayslips(params);
        if (!ignore) {
          const items = response?.data?.items || [];
          const pag = response?.data?.pagination || {
            page: currentPage,
            limit: 10,
            total: items.length,
            totalPages: 1,
          };
          setPayslips(items);
          setPagination(pag);
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Unable to load payslips.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    fetchPayslips();

    return () => {
      ignore = true;
    };
  }, [selectedYear, selectedMonth, currentPage]);

  const handleRetry = () => {
    setCurrentPage(1);
    setSelectedYear('all');
    setSelectedMonth('all');
  };

  const handleYearChange = (e) => {
    setSelectedYear(e.target.value);
    setCurrentPage(1);
  };

  const handleMonthChange = (e) => {
    setSelectedMonth(e.target.value);
    setCurrentPage(1);
  };

  const handleView = (slip) => {
    setPreviewSlip(slip);
  };

  const handleDownload = async (slip) => {
    if (!slip || !slip.id) return;
    try {
      const monthName = slip.month ? getMonthName(slip.month) : '';
      const safeFilename = slip.file_name || `Payslip_${monthName}_${slip.year || ''}.pdf`;

      setDownloadNotice(`Downloading ${safeFilename}...`);
      const blob = await api.employee.downloadPayslip(slip.id);

      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = safeFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);

      setDownloadNotice(`Downloaded ${safeFilename} successfully.`);
    } catch (err) {
      setDownloadNotice(`Error: ${err?.message || 'Failed to download payslip.'}`);
    }
  };

  return (
    <div className="employee-payslips-page">
      {/* Page Header */}
      <header className="payslips-page-header">
        <span className="payslips-header-badge">PAYSLIPS</span>
        <h1 className="payslips-page-title">Your Salary History</h1>
        <p className="payslips-page-subtitle">View and download your monthly payslips.</p>
      </header>

      {/* Notice Banner */}
      {downloadNotice && (
        <div className="payslips-notice-banner" role="status" aria-live="polite">
          <div className="payslips-notice-content">
            <svg
              className="payslips-notice-icon"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <span>{downloadNotice}</span>
          </div>
          <button
            type="button"
            className="payslips-notice-dismiss"
            onClick={() => setDownloadNotice('')}
            aria-label="Dismiss notice"
          >
            &times;
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="payslips-controls-card">
        <div className="payslips-filters-group">
          {/* Year Filter */}
          <div className="payslips-filter-item">
            <label htmlFor="year-select" className="payslips-filter-label">
              Year:
            </label>
            <select
              id="year-select"
              className="payslips-select"
              value={selectedYear}
              onChange={handleYearChange}
            >
              <option value="all">All Years</option>
              {AVAILABLE_YEARS.filter((y) => y !== 'all').map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          {/* Month Filter */}
          <div className="payslips-filter-item">
            <label htmlFor="month-select" className="payslips-filter-label">
              Month:
            </label>
            <select
              id="month-select"
              className="payslips-select"
              value={selectedMonth}
              onChange={handleMonthChange}
            >
              <option value="all">All Months</option>
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={String(idx + 1)}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="payslips-count-badge">
          {!loading && !error && (
            <span>
              {pagination.total} {pagination.total === 1 ? 'payslip' : 'payslips'} found
            </span>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="payslips-state-card">
          <div className="payslips-state-icon loading">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
          </div>
          <h2 className="payslips-state-title">Loading payslips...</h2>
          <p className="payslips-state-subtitle">Please wait while your salary records are retrieved.</p>
        </div>
      ) : error ? (
        <div className="payslips-state-card">
          <div className="payslips-state-icon error">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h2 className="payslips-state-title">Unable to load payslips</h2>
          <p className="payslips-state-subtitle">{error}</p>
          <button type="button" className="payslips-retry-btn" onClick={handleRetry}>
            Retry
          </button>
        </div>
      ) : payslips.length === 0 ? (
        <div className="payslips-state-card">
          <div className="payslips-state-icon empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
              <line x1="7" y1="15" x2="7.01" y2="15" />
              <line x1="11" y1="15" x2="13" y2="15" />
            </svg>
          </div>
          <h2 className="payslips-state-title">No payslips available</h2>
          <p className="payslips-state-subtitle">Your generated payslips will appear here.</p>
        </div>
      ) : (
        <div className="payslips-grid">
          {payslips.map((slip) => {
            const monthLabel = slip.month ? getMonthName(slip.month) : '';
            const periodTitle = monthLabel && slip.year ? `${monthLabel} ${slip.year}` : slip.file_name || 'Payslip';
            const isAvailable = slip.is_available !== false && Boolean(slip.document_id || (slip.id && slip.availability_status === 'Available'));
            const availability = slip.availability_status || (isAvailable ? 'Available' : 'Processing');
            const statusClass = availability.toLowerCase();

            return (
              <article key={slip.id} className="payslip-card" aria-labelledby={`payslip-title-${slip.id}`}>
                {/* Header: Period & Status */}
                <div className="payslip-card-header">
                  <div className="payslip-period-info">
                    <div className="payslip-calendar-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </div>
                    <div className="payslip-period-headings">
                      <h2 id={`payslip-title-${slip.id}`} className="payslip-period-month">
                        {periodTitle}
                      </h2>
                      <span className="payslip-period-filename">{slip.file_name}</span>
                    </div>
                  </div>

                  <span className={`payslip-status-badge ${statusClass}`}>
                    {availability}
                  </span>
                </div>

                {/* Working Days & Payable Days */}
                {slip.payroll ? (
                  <>
                    <div className="payslip-metrics-grid">
                      <div className="payslip-metric-item">
                        <span className="payslip-metric-label">Working Days</span>
                        <span className="payslip-metric-value">{slip.payroll.working_days ?? '-'}</span>
                      </div>
                      <div className="payslip-metric-item">
                        <span className="payslip-metric-label">Payable Days</span>
                        <span className="payslip-metric-value">{slip.payroll.payable_days ?? '-'}</span>
                      </div>
                    </div>

                    {/* Salary Breakdown */}
                    <div className="payslip-salary-summary">
                      <div className="payslip-salary-row">
                        <span className="payslip-salary-label">Gross Salary</span>
                        <span className="payslip-salary-value">{formatCurrency(slip.payroll.gross_salary)}</span>
                      </div>
                      <div className="payslip-salary-row">
                        <span className="payslip-salary-label">Total Deductions</span>
                        <span className="payslip-salary-value">{formatCurrency(slip.payroll.total_deductions)}</span>
                      </div>
                      <div className="payslip-salary-row net-salary-row">
                        <span className="payslip-salary-label">Net Salary</span>
                        <span className="payslip-salary-value">{formatCurrency(slip.payroll.net_salary)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="payslip-meta-fallback">
                    <div><strong>Generated:</strong> {formatDate(slip.created_at)}</div>
                    <div>Payroll breakdown records will appear upon admin processing.</div>
                  </div>
                )}

                {/* Card Actions */}
                <div className="payslip-card-actions">
                  {isAvailable ? (
                    <>
                      <button
                        type="button"
                        className="payslip-btn payslip-btn-view"
                        onClick={() => handleView(slip)}
                        aria-label={`View ${periodTitle} payslip`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        View
                      </button>
                      <button
                        type="button"
                        className="payslip-btn payslip-btn-download"
                        onClick={() => handleDownload(slip)}
                        aria-label={`Download ${periodTitle} payslip`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download
                      </button>
                    </>
                  ) : (
                    <div className="payslip-unavailable-notice" style={{ fontSize: '0.8125rem', color: '#64748b', fontStyle: 'italic', padding: '0.25rem 0' }}>
                      Payslip PDF is not yet available for this period.
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <nav className="payslips-pagination" aria-label="Payslips pagination">
          <button
            type="button"
            className="payslips-page-btn"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((pageNum) => (
            <button
              key={pageNum}
              type="button"
              className={`payslips-page-btn ${pageNum === currentPage ? 'active' : ''}`}
              onClick={() => setCurrentPage(pageNum)}
            >
              {pageNum}
            </button>
          ))}
          <button
            type="button"
            className="payslips-page-btn"
            disabled={currentPage >= pagination.totalPages}
            onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
          >
            Next
          </button>
        </nav>
      )}

      {/* Secure PDF Modal Preview */}
      {previewSlip && (
        <PayslipPreviewModal
          slip={previewSlip}
          onClose={() => setPreviewSlip(null)}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
}

export default Payslips;
