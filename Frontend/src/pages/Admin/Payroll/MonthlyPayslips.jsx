import { useState, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import './MonthlyPayslips.css';

const MONTHS = [
  { value: 1, name: 'January' },
  { value: 2, name: 'February' },
  { value: 3, name: 'March' },
  { value: 4, name: 'April' },
  { value: 5, name: 'May' },
  { value: 6, name: 'June' },
  { value: 7, name: 'July' },
  { value: 8, name: 'August' },
  { value: 9, name: 'September' },
  { value: 10, name: 'October' },
  { value: 11, name: 'November' },
  { value: 12, name: 'December' },
];

const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

export default function MonthlyPayslips() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const [employees, setEmployees] = useState([]);
  const [summary, setSummary] = useState({ total_employees: 0, uploaded: 0, pending: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Upload & Replace modal states
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [modalError, setModalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 4000);
  };

  // Fetch monthly payslips list
  const fetchPayslips = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await api.admin.getMonthlyPayslips({
        month: selectedMonth,
        year: selectedYear,
      });

      if (res && res.success && res.data) {
        setEmployees(res.data.employees || []);
        setSummary(res.data.summary || { total_employees: 0, uploaded: 0, pending: 0 });
      } else {
        setErrorMessage(res?.message || 'Failed to load monthly payslip data.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'An error occurred while loading payslip data.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPayslips();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPayslips]);

  // Open Upload modal
  const handleOpenUpload = (emp) => {
    setSelectedEmployee(emp);
    setSelectedFile(null);
    setModalError('');
    setIsUploadModalOpen(true);
  };

  // Open Replace modal
  const handleOpenReplace = (emp) => {
    setSelectedEmployee(emp);
    setSelectedFile(null);
    setModalError('');
    setIsReplaceModalOpen(true);
  };

  const closeModals = () => {
    setIsUploadModalOpen(false);
    setIsReplaceModalOpen(false);
    setSelectedEmployee(null);
    setSelectedFile(null);
    setModalError('');
    setIsSubmitting(false);
  };

  // Handle PDF file selection
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setModalError('');
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setModalError('Invalid file type. Only PDF documents (.pdf) are allowed.');
      setSelectedFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setModalError('File size exceeds the maximum limit of 10 MB.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  // Submit Upload
  const handleSubmitUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setModalError('Please select a PDF payslip file to upload.');
      return;
    }

    setIsSubmitting(true);
    setModalError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('employee_id', selectedEmployee.employee_id);
      formData.append('month', selectedMonth);
      formData.append('year', selectedYear);

      const res = await api.admin.uploadMonthlyPayslip(formData);
      if (res && res.success) {
        showToast('✓ Payslip uploaded successfully');
        closeModals();
        fetchPayslips();
      } else {
        setModalError(res?.message || 'Failed to upload payslip.');
      }
    } catch (err) {
      setModalError(err.message || 'An error occurred during upload.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Replace
  const handleSubmitReplace = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setModalError('Please select a replacement PDF payslip file.');
      return;
    }

    setIsSubmitting(true);
    setModalError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('employee_id', selectedEmployee.employee_id);
      formData.append('month', selectedMonth);
      formData.append('year', selectedYear);

      const res = await api.admin.replaceMonthlyPayslip(formData);
      if (res && res.success) {
        showToast('✓ Payslip replaced successfully');
        closeModals();
        fetchPayslips();
      } else {
        setModalError(res?.message || 'Failed to replace payslip.');
      }
    } catch (err) {
      setModalError(err.message || 'An error occurred during replacement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // View Payslip Inline
  const handleViewPayslip = async (documentId) => {
    try {
      const blob = await api.admin.downloadDocument(documentId, true);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      showToast(`Failed to open payslip preview: ${err.message}`);
    }
  };

  // Download Payslip
  const handleDownloadPayslip = async (documentId, fileName) => {
    try {
      const blob = await api.admin.downloadDocument(documentId, false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'Payslip.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(`Failed to download payslip: ${err.message}`);
    }
  };

  const selectedMonthObj = MONTHS.find((m) => m.value === Number(selectedMonth));
  const monthName = selectedMonthObj ? selectedMonthObj.name : '';

  return (
    <div className="monthly-payslips-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="monthly-payslips-toast" role="alert">
          {toastMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="monthly-payslips-header">
        <div className="monthly-payslips-title-area">
          <h1 className="monthly-payslips-title">Monthly Payslips</h1>
          <p className="monthly-payslips-subtitle">
            Upload and manage monthly payslips for all employees.
          </p>
        </div>

        {/* Month & Year Selectors */}
        <div className="monthly-payslips-period-controls">
          <div className="monthly-payslips-select-group">
            <label htmlFor="month-select" className="monthly-payslips-select-label">Month</label>
            <select
              id="month-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="monthly-payslips-select"
              disabled={isLoading}
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="monthly-payslips-select-group">
            <label htmlFor="year-select" className="monthly-payslips-select-label">Year</label>
            <select
              id="year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="monthly-payslips-select"
              disabled={isLoading}
            >
              {YEARS.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="monthly-payslips-summary-row">
        <div className="monthly-payslips-counter-card">
          <span className="counter-label">Total Employees</span>
          <span className="counter-val total">{summary.total_employees}</span>
        </div>
        <div className="monthly-payslips-counter-card">
          <span className="counter-label">Uploaded</span>
          <span className="counter-val uploaded">{summary.uploaded}</span>
        </div>
        <div className="monthly-payslips-counter-card">
          <span className="counter-label">Pending</span>
          <span className="counter-val pending">{summary.pending}</span>
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="monthly-payslips-error-banner" role="alert">
          {errorMessage}
        </div>
      )}

      {/* Employee Payslip List Table */}
      <div className="monthly-payslips-table-card">
        <div className="monthly-payslips-table-container">
          <table className="monthly-payslips-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Employee Name</th>
                <th>Department</th>
                <th>Payslip Status</th>
                <th className="actions-header">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="loading-state">
                    Loading monthly payslip records...
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No active employees found.
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.employee_id}>
                    <td className="emp-id-col">{emp.employee_id}</td>
                    <td className="emp-name-col">{emp.name}</td>
                    <td>{emp.department}</td>
                    <td>
                      {emp.status === 'Uploaded' ? (
                        <span className="badge-uploaded">✓ Uploaded</span>
                      ) : (
                        <span className="badge-pending">Pending</span>
                      )}
                    </td>
                    <td className="actions-col">
                      {emp.status === 'Uploaded' ? (
                        <div className="btn-group">
                          <button
                            type="button"
                            className="btn-action btn-view"
                            onClick={() => handleViewPayslip(emp.document_id)}
                            title="Preview Payslip"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn-action btn-download"
                            onClick={() => handleDownloadPayslip(emp.document_id, emp.file_name)}
                            title="Download PDF"
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            className="btn-action btn-replace"
                            onClick={() => handleOpenReplace(emp)}
                            title="Replace existing payslip with new PDF"
                          >
                            Replace
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-action btn-upload"
                          onClick={() => handleOpenUpload(emp)}
                        >
                          Upload
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Payslip Modal */}
      {isUploadModalOpen && selectedEmployee && (
        <div className="payslip-modal-backdrop" onClick={closeModals}>
          <div className="payslip-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="payslip-modal-header">
              <h2>Upload Payslip</h2>
              <button
                type="button"
                className="payslip-modal-close-btn"
                onClick={closeModals}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmitUpload} className="payslip-modal-form">
              <div className="payslip-modal-info">
                <div className="info-row">
                  <span className="info-label">Employee:</span>
                  <span className="info-value">
                    {selectedEmployee.employee_id} - {selectedEmployee.name}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Period:</span>
                  <span className="info-value">
                    {monthName} {selectedYear}
                  </span>
                </div>
              </div>

              <div className="payslip-file-input-group">
                <label className="file-input-label">Select PDF:</label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleFileChange}
                  className="payslip-file-input"
                  required
                />
                <span className="file-hint">Only authentic PDF documents up to 10 MB are allowed.</span>
              </div>

              {selectedFile && (
                <div className="file-selected-indicator">
                  ✓ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
              )}

              {modalError && (
                <div className="payslip-modal-error" role="alert">
                  {modalError}
                </div>
              )}

              <div className="payslip-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={closeModals}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={isSubmitting || !selectedFile}
                >
                  {isSubmitting ? 'Uploading...' : 'Upload Payslip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Replace Payslip Modal */}
      {isReplaceModalOpen && selectedEmployee && (
        <div className="payslip-modal-backdrop" onClick={closeModals}>
          <div className="payslip-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="payslip-modal-header warning">
              <h2>Replace Payslip?</h2>
              <button
                type="button"
                className="payslip-modal-close-btn"
                onClick={closeModals}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmitReplace} className="payslip-modal-form">
              <div className="payslip-modal-warning-box">
                <strong>Notice:</strong> An existing payslip already exists for this period. Uploading a new PDF will safely replace the existing file.
              </div>

              <div className="payslip-modal-info">
                <div className="info-row">
                  <span className="info-label">Employee:</span>
                  <span className="info-value">
                    {selectedEmployee.employee_id} - {selectedEmployee.name}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Period:</span>
                  <span className="info-value">
                    {monthName} {selectedYear}
                  </span>
                </div>
              </div>

              <div className="payslip-file-input-group">
                <label className="file-input-label">Select Replacement PDF:</label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleFileChange}
                  className="payslip-file-input"
                  required
                />
                <span className="file-hint">Only authentic PDF documents up to 10 MB are allowed.</span>
              </div>

              {selectedFile && (
                <div className="file-selected-indicator">
                  ✓ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
              )}

              {modalError && (
                <div className="payslip-modal-error" role="alert">
                  {modalError}
                </div>
              )}

              <div className="payslip-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={closeModals}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-replace"
                  disabled={isSubmitting || !selectedFile}
                >
                  {isSubmitting ? 'Replacing...' : 'Replace Payslip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
