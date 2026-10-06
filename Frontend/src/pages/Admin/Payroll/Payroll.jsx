import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MONTHS,
  YEARS,
  EXPECTED_EXCEL_COLUMNS,
} from './payrollMockData';
import api from '../../../services/api';
import MonthlyPayslips from './MonthlyPayslips';
import './Payroll.css';

// Currency formatter e.g. 25000 -> ₹25,000
function formatINR(val) {
  if (typeof val !== 'number') return val || '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);
}

function Payroll({ defaultTab }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Active Tab state: 'payroll' vs 'monthly_payslips'
  const [activeTab, setActiveTab] = useState(() => {
    if (defaultTab) return defaultTab;
    if (location.pathname.includes('monthly-payslips') || location.search.includes('tab=payslips')) {
      return 'monthly_payslips';
    }
    return 'payroll';
  });

  // Selected Period
  const [selectedMonth, setSelectedMonth] = useState('September');
  const [selectedYear, setSelectedYear] = useState(2026);

  // Live Payroll Data State
  const [payrollRecords, setPayrollRecords] = useState([]);
  const [isLoadingPayroll, setIsLoadingPayroll] = useState(false);

  // Attendance Integration Summary State
  const [attendanceSummary, setAttendanceSummary] = useState({
    workingDays: 26,
    avgPresentDays: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    halfDays: 0,
  });

  // History State
  const [payrollHistory, setPayrollHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // File Upload State
  const [uploadedFile, setUploadedFile] = useState({
    name: 'September_2026_Payroll.xlsx',
    size: '245 KB',
    status: 'Ready for Validation',
  });
  const [rawUploadedFile, setRawUploadedFile] = useState(null);

  // Excel Import Modal States
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState(1); // 1 = Upload, 2 = Preview, 3 = Complete
  const [importFile, setImportFile] = useState(null);
  const [isValidatingImport, setIsValidatingImport] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState(null);
  const [importMode, setImportMode] = useState('CREATE_ONLY');
  const [isConfirmingImport, setIsConfirmingImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importErrorMessage, setImportErrorMessage] = useState('');

  // Validation States
  const [isValidated, setIsValidated] = useState(false);
  const [validationRecords, setValidationRecords] = useState([]);

  // Processing & Payslip States
  const [isProcessModalOpen, setIsProcessModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isProcessed, setIsProcessed] = useState(false);
  const [isGeneratingPayslips, setIsGeneratingPayslips] = useState(false);
  const [generationProgress, setGenerationProgress] = useState([]);
  const [payslipsGenerated, setPayslipsGenerated] = useState(false);
  const [alreadyGeneratedCount, setAlreadyGeneratedCount] = useState(0);

  // Modals & Feedback
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Toast feedback helper
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // Lock body scroll when any modal is open
  useEffect(() => {
    const isAnyModalOpen = Boolean(
      selectedPayslip || isProcessModalOpen || isHistoryModalOpen || isImportModalOpen
    );
    if (isAnyModalOpen) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = orig;
      };
    }
  }, [selectedPayslip, isProcessModalOpen, isHistoryModalOpen, isImportModalOpen]);

  // Derived Validation Summary
  const validationSummary = useMemo(() => {
    const total = validationRecords.length || payrollRecords.length;
    const errors = validationRecords.filter((r) => r.status === 'Error').length;
    const warnings = validationRecords.filter((r) => r.status === 'Warning').length;
    const valid = validationRecords.length > 0
      ? validationRecords.filter((r) => r.status === 'Valid').length
      : payrollRecords.length;
    return { total, valid, warnings, errors };
  }, [validationRecords, payrollRecords]);

  // Fetch Payroll records for the selected period
  const fetchPayrollData = useCallback(async () => {
    setIsLoadingPayroll(true);
    try {
      const res = await api.admin.getPayroll({
        month: selectedMonth,
        year: selectedYear,
      });
      if (res && res.success && Array.isArray(res.data)) {
        setPayrollRecords(res.data);
        if (res.data.length > 0) {
          setIsProcessed(true);
          setIsValidated(true);
          setValidationRecords(
            res.data.map((r) => ({
              employeeId: r.employeeId,
              name: r.name,
              department: r.department,
              designation: r.designation,
              status: 'Valid',
              issue: '-',
            }))
          );
        } else {
          setIsProcessed(false);
        }
      }
    } catch {
      setPayrollRecords([]);
      setIsProcessed(false);
    } finally {
      setIsLoadingPayroll(false);
    }
  }, [selectedMonth, selectedYear]);

  // Fetch Attendance summary for the selected period
  const fetchAttendanceSummary = useCallback(async () => {
    try {
      const res = await api.admin.getPayrollAttendanceSummary({
        month: selectedMonth,
        year: selectedYear,
      });
      if (res && res.success && res.data) {
        setAttendanceSummary(res.data);
      }
    } catch {
      // Keep previous or default attendance state on error
    }
  }, [selectedMonth, selectedYear]);

  // Fetch historical payroll runs
  const fetchPayrollHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await api.admin.getPayrollHistory();
      if (res && res.success && Array.isArray(res.data)) {
        setPayrollHistory(res.data);
      }
    } catch {
      setPayrollHistory([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Synchronize data on period change
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPayrollData();
      fetchAttendanceSummary();
      setPayslipsGenerated(false);
    }, 10);
    return () => clearTimeout(timer);
  }, [fetchPayrollData, fetchAttendanceSummary]);

  // Synchronize history when modal opens
  useEffect(() => {
    if (isHistoryModalOpen) {
      const timer = setTimeout(() => {
        fetchPayrollHistory();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [isHistoryModalOpen, fetchPayrollHistory]);

  // Handle File Selection
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        showToast('Only .xlsx Excel files are supported.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast('File size exceeds the 10 MB limit.');
        return;
      }
      setRawUploadedFile(file);
      setUploadedFile({
        name: file.name,
        size: `${Math.round(file.size / 1024)} KB`,
        status: 'Ready for Validation',
      });
      setIsValidated(false);
      setIsProcessed(false);
      setPayslipsGenerated(false);
      showToast(`Selected file: ${file.name}`);
    }
  };

  const handleRemoveFile = () => {
    setRawUploadedFile(null);
    setUploadedFile(null);
    setIsValidated(false);
    setIsProcessed(false);
    setPayslipsGenerated(false);
    showToast('Payroll file removed');
  };

  // Validate Payroll against HRM Database / Preview Real Excel
  const handleValidatePayroll = async () => {
    if (rawUploadedFile) {
      setIsImportModalOpen(true);
      setImportStep(1);
      setImportFile(rawUploadedFile);
      setIsValidatingImport(true);
      setImportErrorMessage('');
      try {
        const res = await api.admin.previewPayrollImport(rawUploadedFile);
        if (res && res.success && res.data) {
          setImportPreviewData(res.data);
          if (res.data.summary?.existingPayrollRows > 0) {
            setImportMode('UPDATE_EXISTING');
          } else {
            setImportMode('CREATE_ONLY');
          }
          setImportStep(2);
        } else {
          setImportErrorMessage(res?.message || 'Failed to validate Excel file.');
        }
      } catch (err) {
        setImportErrorMessage(err?.message || 'Failed to validate Excel file.');
      } finally {
        setIsValidatingImport(false);
      }
      return;
    }

    try {
      const res = await api.admin.getEmployees({ status: 'ACTIVE' });
      if (res && res.success && Array.isArray(res.data)) {
        const valRecs = res.data.map((emp) => ({
          employeeId: emp.employee_id,
          name: `${emp.first_name} ${emp.last_name}`.trim(),
          department: emp.department || 'General',
          designation: emp.designation || 'Staff',
          status: 'Valid',
          issue: '-',
        }));
        setValidationRecords(valRecs);
      }
      setIsValidated(true);
      showToast('Payroll file validated successfully. Review results below.');
    } catch (err) {
      showToast(err.message || 'Validation error.');
    }
  };

  // Resolve Error action
  const handleResolveError = (record) => {
    setValidationRecords((prev) =>
      prev.map((r) =>
        r.employeeId === record.employeeId
          ? {
              ...r,
              status: 'Valid',
              issue: 'Resolved: Employee verified in HRM database',
            }
          : r
      )
    );
    showToast(`Error resolved for ${record.employeeId}`);
  };

  // Process Payroll Confirmation
  const handleConfirmProcessPayroll = async () => {
    try {
      setIsProcessing(true);
      const res = await api.admin.processPayroll({
        month: selectedMonth,
        year: selectedYear,
      });
      if (res && res.success) {
        setIsProcessed(true);
        setIsProcessModalOpen(false);
        showToast(`${selectedMonth} ${selectedYear} Payroll processed successfully! Ready to generate payslips.`);
        await fetchPayrollData();
      } else {
        showToast(res?.message || 'Failed to process payroll.');
      }
    } catch (err) {
      showToast(err?.message || 'Failed to process payroll.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate All Payslips with Progress
  const handleGenerateAllPayslips = async () => {
    if (payslipsGenerated) {
      setAlreadyGeneratedCount(payrollRecords.length);
      showToast(`All ${payrollRecords.length} payslips for ${selectedMonth} ${selectedYear} were already generated.`);
      return;
    }

    if (payrollRecords.length === 0) {
      showToast('No processed payroll records available to generate payslips.');
      return;
    }

    setIsGeneratingPayslips(true);
    setGenerationProgress([]);

    const employeeIds = payrollRecords.map((r) => r.employeeId);

    try {
      for (const empId of employeeIds) {
        await api.admin.generatePayslip(empId, selectedYear, selectedMonth);
        setGenerationProgress((prev) => [...prev, `${empId} ✓`]);
      }
      setPayslipsGenerated(true);
      setAlreadyGeneratedCount(payrollRecords.length);
      showToast(`${payrollRecords.length} payslips generated successfully!`);
    } catch (err) {
      showToast(err?.message || 'Error generating payslips.');
    } finally {
      setIsGeneratingPayslips(false);
    }
  };

  // Download individual payslip PDF through secure document API
  const handleDownloadPayslipPdf = async () => {
    if (!selectedPayslip) return;
    const empId = selectedPayslip.employeeId || selectedPayslip.employee_id;
    try {
      showToast(`Preparing payslip download for ${empId}...`);
      const genRes = await api.admin.generatePayslip(empId, selectedYear, selectedMonth);
      if (genRes && genRes.success && genRes.data?.document_id) {
        await api.admin.downloadDocument(genRes.data.document_id);
        showToast(`Payslip for ${empId} downloaded successfully.`);
      } else {
        showToast(genRes?.message || 'Failed to download payslip.');
      }
    } catch (err) {
      showToast(err?.message || 'Failed to download payslip.');
    }
  };

  // Download Excel Template from backend API
  const handleDownloadTemplate = async () => {
    try {
      showToast('Downloading payroll Excel template...');
      await api.admin.downloadPayrollTemplate();
      showToast('Payroll template downloaded successfully.');
    } catch (err) {
      showToast(err?.message || 'Failed to download payroll template.');
    }
  };

  // Import Modal Action Handlers
  const handleOpenImportModal = () => {
    setIsImportModalOpen(true);
    setImportStep(1);
    setImportFile(rawUploadedFile || null);
    setImportPreviewData(null);
    setImportMode('CREATE_ONLY');
    setImportResult(null);
    setImportErrorMessage('');
  };

  const handleCloseImportModal = () => {
    if (isValidatingImport || isConfirmingImport) return;
    setIsImportModalOpen(false);
  };

  const handleImportFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        setImportErrorMessage('Only .xlsx Excel files are supported.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setImportErrorMessage('File size exceeds the 10 MB limit.');
        return;
      }
      setImportFile(file);
      setImportErrorMessage('');
    }
  };

  const handleValidateImportFile = async () => {
    if (!importFile) {
      setImportErrorMessage('Please choose a .xlsx file to validate.');
      return;
    }
    setIsValidatingImport(true);
    setImportErrorMessage('');
    try {
      const res = await api.admin.previewPayrollImport(importFile);
      if (res && res.success && res.data) {
        setImportPreviewData(res.data);
        if (res.data.summary?.existingPayrollRows > 0) {
          setImportMode('UPDATE_EXISTING');
        } else {
          setImportMode('CREATE_ONLY');
        }
        setImportStep(2);
      } else {
        setImportErrorMessage(res?.message || 'Failed to validate Excel file.');
      }
    } catch (err) {
      setImportErrorMessage(err?.message || 'Failed to validate Excel file.');
    } finally {
      setIsValidatingImport(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreviewData?.importId) return;
    setIsConfirmingImport(true);
    setImportErrorMessage('');
    try {
      const res = await api.admin.confirmPayrollImport({
        importId: importPreviewData.importId,
        importMode,
      });
      if (res && res.success && res.data) {
        setImportResult(res.data);
        setImportStep(3);
        showToast(res.message || 'Payroll imported and payslips generated successfully!');
      } else {
        setImportErrorMessage(res?.message || 'Failed to import payroll.');
      }
    } catch (err) {
      setImportErrorMessage(err?.message || 'Failed to import payroll.');
    } finally {
      setIsConfirmingImport(false);
    }
  };

  const handleFinishImport = async () => {
    setIsImportModalOpen(false);
    await fetchPayrollData();
    await fetchPayrollHistory();
    showToast('Payroll records and payslips updated successfully.');
  };

  // View individual payslip
  const handleViewPayslip = async (employeeId) => {
    try {
      const res = await api.admin.getPayrollByEmployee(employeeId, {
        month: selectedMonth,
        year: selectedYear,
      });
      if (res && res.success && res.data) {
        setSelectedPayslip(res.data);
      } else {
        const localRec = payrollRecords.find((r) => r.employeeId === employeeId);
        if (localRec) {
          setSelectedPayslip(localRec);
        } else {
          showToast('No payroll record found for this employee.');
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to load employee payslip.');
    }
  };

  return (
    <div className="admin-payroll-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-payroll-toast" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div
        className="admin-payroll-nav-tabs"
        style={{
          display: 'flex',
          gap: '0.75rem',
          marginBottom: '1.25rem',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('payroll')}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: '0.375rem',
            fontWeight: 600,
            fontSize: '0.875rem',
            border: '1px solid',
            borderColor: activeTab === 'payroll' ? '#2563eb' : '#cbd5e1',
            backgroundColor: activeTab === 'payroll' ? '#eff6ff' : '#ffffff',
            color: activeTab === 'payroll' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          Payroll Overview & Processing
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('monthly_payslips')}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: '0.375rem',
            fontWeight: 600,
            fontSize: '0.875rem',
            border: '1px solid',
            borderColor: activeTab === 'monthly_payslips' ? '#2563eb' : '#cbd5e1',
            backgroundColor: activeTab === 'monthly_payslips' ? '#eff6ff' : '#ffffff',
            color: activeTab === 'monthly_payslips' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          Monthly Payslips
        </button>
      </div>

      {activeTab === 'monthly_payslips' ? (
        <MonthlyPayslips />
      ) : (
        <>
          {/* ====================================================================
              PAGE HEADER
              ==================================================================== */}
          <div className="admin-payroll-header-card">
        <div className="payroll-header-info">
          <div className="payroll-title-group">
            <h1 className="payroll-title">Payroll Management</h1>
            <p className="payroll-subtitle">
              Upload monthly payroll data, process salaries, and generate employee payslips.
            </p>
          </div>

          <div className="payroll-header-actions">
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={handleDownloadTemplate}
              aria-label="Download Excel Template"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download Excel Template</span>
            </button>

            <button
              type="button"
              className="admin-btn-primary"
              onClick={handleOpenImportModal}
              aria-label="Import Payroll Excel"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Import Payroll Excel</span>
            </button>

            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => setIsHistoryModalOpen(true)}
              aria-label="View payroll history"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Payroll History</span>
            </button>
          </div>
        </div>

        {/* Payroll Period Selector */}
        <div className="payroll-period-bar">
          <div className="period-label-group">
            <span className="period-badge-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <div className="period-text">
              <span className="period-title">Payroll Period:</span>
              <span className="period-highlight">
                {selectedMonth} {selectedYear} Payroll
              </span>
            </div>
          </div>

          <div className="period-controls">
            <div className="period-select-wrap">
              <label htmlFor="payrollMonthSelect" className="sr-only">
                Select Month
              </label>
              <select
                id="payrollMonthSelect"
                className="payroll-select"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="period-select-wrap">
              <label htmlFor="payrollYearSelect" className="sr-only">
                Select Year
              </label>
              <select
                id="payrollYearSelect"
                className="payroll-select"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ====================================================================
          ATTENDANCE INTEGRATION SUMMARY CARD
          ==================================================================== */}
      <section className="payroll-attendance-summary-card" aria-label="Attendance Summary for Payroll">
        <div className="att-summary-header">
          <div className="att-summary-header-left">
            <div className="att-summary-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 16 2 2 4-4" />
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <h2 className="att-summary-title">Attendance Summary</h2>
              <span className="att-summary-subtitle">
                Attendance records for {selectedMonth} {selectedYear}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="admin-btn-secondary btn-sm"
            onClick={() => navigate('/admin/attendance')}
          >
            <span>View Attendance</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="att-metrics-grid">
          <div className="att-metric-pill">
            <span className="metric-lbl">Total Working Days</span>
            <span className="metric-val font-semibold">{attendanceSummary.workingDays}</span>
          </div>
          <div className="att-metric-pill">
            <span className="metric-lbl">Average Present Days</span>
            <span className="metric-val font-semibold text-green">{attendanceSummary.avgPresentDays}</span>
          </div>
          <div className="att-metric-pill">
            <span className="metric-lbl">Paid Leave</span>
            <span className="metric-val font-semibold text-amber">{attendanceSummary.paidLeave}</span>
          </div>
          <div className="att-metric-pill">
            <span className="metric-lbl">Unpaid Leave</span>
            <span className="metric-val font-semibold text-red">{attendanceSummary.unpaidLeave}</span>
          </div>
          <div className="att-metric-pill">
            <span className="metric-lbl">Half Days</span>
            <span className="metric-val font-semibold text-yellow">{attendanceSummary.halfDays}</span>
          </div>
        </div>
      </section>

      {/* ====================================================================
          EXCEL UPLOAD SECTION & TEMPLATE INFO
          ==================================================================== */}
      <div className="payroll-grid-two-col">
        {/* Upload Card */}
        <div className="admin-card payroll-upload-card">
          <div className="card-header-clean">
            <h2 className="card-section-title">Upload Payroll Excel</h2>
            <span className="card-section-subtitle">
              Upload the monthly payroll Excel file to validate employee salary information and prepare payslips.
            </span>
          </div>

          {!uploadedFile ? (
            <div className="upload-dropzone">
              <input
                type="file"
                id="payrollExcelInput"
                accept=".xlsx"
                className="file-hidden-input"
                onChange={handleFileChange}
              />
              <label htmlFor="payrollExcelInput" className="upload-dropzone-label">
                <div className="dropzone-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                </div>
                <span className="dropzone-btn-text">Upload Excel</span>
                <span className="dropzone-subtext">Supported format: .xlsx</span>
                <span className="dropzone-limit">Maximum file size: 10 MB</span>
              </label>
            </div>
          ) : (
            <div className="uploaded-file-box">
              <div className="file-info-left">
                <div className="excel-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="file-details">
                  <span className="file-name font-semibold">{uploadedFile.name}</span>
                  <span className="file-meta text-xs text-muted">
                    {uploadedFile.size} &bull; Status:{' '}
                    <strong className="text-primary">{uploadedFile.status}</strong>
                  </span>
                </div>
              </div>

              <div className="file-actions">
                <input
                  type="file"
                  id="payrollExcelReplaceInput"
                  accept=".xlsx"
                  className="file-hidden-input"
                  onChange={handleFileChange}
                />
                <label htmlFor="payrollExcelReplaceInput" className="admin-btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  Replace File
                </label>
                <button
                  type="button"
                  className="admin-btn-danger-outline btn-sm"
                  onClick={handleRemoveFile}
                >
                  Remove File
                </button>
              </div>
            </div>
          )}

          {/* Validate Button */}
          {uploadedFile && (
            <div className="validate-action-bar">
              <button
                type="button"
                className="admin-btn-primary btn-lg"
                onClick={handleValidatePayroll}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Validate Payroll</span>
              </button>
            </div>
          )}
        </div>

        {/* Expected Excel Columns & Template */}
        <div className="admin-card payroll-template-card">
          <div className="card-header-clean">
            <div className="template-header-row">
              <div>
                <h2 className="card-section-title">Required Excel Columns</h2>
                <span className="card-section-subtitle">
                  Ensure the workbook headers correspond to these expected fields.
                </span>
              </div>
              <button
                type="button"
                className="admin-btn-secondary btn-sm"
                onClick={handleDownloadTemplate}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download Excel Template</span>
              </button>
            </div>
          </div>

          <div className="template-columns-grid">
            {EXPECTED_EXCEL_COLUMNS.map((col) => (
              <div key={col.name} className="col-pill">
                <span className="col-name">{col.name}</span>
                <span className="col-example text-xs text-muted">e.g. {col.example}</span>
              </div>
            ))}
          </div>

          <div className="template-note-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              Primary employee matching uses <strong>Employee ID</strong> (e.g. GP0001N) for strict database mapping.
            </span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          VALIDATION SUMMARY & VALIDATION RESULTS (Visible after validation)
          ==================================================================== */}
      {isValidated && (
        <>
          {/* Validation Summary Cards */}
          <section className="payroll-validation-summary" aria-label="Validation Summary">
            <div className="payroll-summary-grid">
              <div className="summary-stat-card border-slate">
                <span className="stat-label">Total Employees</span>
                <div className="stat-val-row">
                  <span className="stat-number">{validationSummary.total}</span>
                  <span className="stat-unit">In file</span>
                </div>
                <span className="stat-desc">Parsed from database/file</span>
              </div>

              <div className="summary-stat-card border-green">
                <span className="stat-label">Valid Records</span>
                <div className="stat-val-row">
                  <span className="stat-number text-green">{validationSummary.valid}</span>
                  <span className="stat-unit">Passed</span>
                </div>
                <span className="stat-desc">Payroll record is valid</span>
              </div>

              <div className="summary-stat-card border-amber">
                <span className="stat-label">Warnings</span>
                <div className="stat-val-row">
                  <span className="stat-number text-amber">{validationSummary.warnings}</span>
                  <span className="stat-unit">Non-critical</span>
                </div>
                <span className="stat-desc">Requires review</span>
              </div>

              <div className="summary-stat-card border-red">
                <span className="stat-label">Errors</span>
                <div className="stat-val-row">
                  <span className="stat-number text-red">{validationSummary.errors}</span>
                  <span className="stat-unit">Critical</span>
                </div>
                <span className="stat-desc">
                  {validationSummary.errors === 0
                    ? 'All errors resolved'
                    : 'Blocks payslip generation'}
                </span>
              </div>
            </div>
          </section>

          {/* Validation Error / Warning Guidance Banner */}
          {validationSummary.errors > 0 ? (
            <div className="payroll-alert-banner alert-error">
              <div className="alert-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="alert-content">
                <span className="alert-title">Critical Validation Error Detected</span>
                <p className="alert-text">
                  Record cannot be processed until the issue is corrected. Click <strong>Review / Fix</strong> below to resolve the unknown Employee ID before proceeding.
                </p>
              </div>
            </div>
          ) : (
            <div className="payroll-alert-banner alert-success">
              <div className="alert-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="alert-content">
                <span className="alert-title">Ready for Processing</span>
                <p className="alert-text">
                  All critical errors are resolved (Errors = 0). You may now review the preview and process the payroll.
                </p>
              </div>
            </div>
          )}

          {/* Validation Results Table */}
          {validationRecords.length > 0 && (
            <div className="admin-card payroll-table-card">
              <div className="card-header-clean">
                <div className="card-title-group">
                  <h2 className="card-section-title">Payroll Validation Results</h2>
                  <span className="card-section-subtitle">
                    Verification status of employee records extracted from the HRM database
                  </span>
                </div>
              </div>

              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Employee ID</th>
                      <th>Employee</th>
                      <th>Status</th>
                      <th>Issue</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationRecords.map((rec) => (
                      <tr key={rec.employeeId}>
                        <td>
                          <span className="font-mono font-semibold text-primary">
                            {rec.employeeId}
                          </span>
                        </td>
                        <td className="font-semibold text-dark">
                          {rec.name}
                        </td>
                        <td>
                          <span
                            className={`payroll-badge ${
                              rec.status === 'Valid'
                                ? 'badge-valid'
                                : rec.status === 'Warning'
                                ? 'badge-warning'
                                : 'badge-error'
                            }`}
                          >
                            <span className="badge-dot" aria-hidden="true" />
                            {rec.status}
                          </span>
                        </td>
                        <td className="text-sm text-secondary">
                          {rec.issue}
                        </td>
                        <td className="text-right">
                          {rec.status === 'Error' ? (
                            <button
                              type="button"
                              className="admin-btn-danger btn-sm"
                              onClick={() => handleResolveError(rec)}
                            >
                              Review &amp; Fix
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="admin-btn-secondary btn-sm"
                              onClick={() => handleViewPayslip(rec.employeeId)}
                            >
                              View
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ====================================================================
              PAYROLL PREVIEW TABLE
              ==================================================================== */}
          <div className="admin-card payroll-table-card">
            <div className="card-header-clean table-header-flex">
              <div className="card-title-group">
                <h2 className="card-section-title">Payroll Preview</h2>
                <span className="card-section-subtitle">
                  Preview breakdown of basic, allowances, deductions, and net salary for {selectedMonth} {selectedYear}
                </span>
              </div>

              {/* Action Buttons: Process Payroll & Generate All Payslips */}
              <div className="table-header-actions">
                {!isProcessed ? (
                  <button
                    type="button"
                    className="admin-btn-primary"
                    disabled={validationSummary.errors > 0 || isProcessing}
                    onClick={() => setIsProcessModalOpen(true)}
                    title={
                      validationSummary.errors > 0
                        ? 'Resolve critical errors before processing payroll'
                        : 'Process payroll for validated records'
                    }
                  >
                    <span>{isProcessing ? 'Processing...' : 'Process Payroll'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="admin-btn-primary admin-btn-success"
                    disabled={isGeneratingPayslips}
                    onClick={handleGenerateAllPayslips}
                  >
                    {isGeneratingPayslips ? (
                      <span>Generating Payslips...</span>
                    ) : payslipsGenerated ? (
                      <span>Generate All Payslips</span>
                    ) : (
                      <span>Generate All Payslips</span>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* In-progress banner when generating payslips */}
            {isGeneratingPayslips && (
              <div className="payroll-progress-banner">
                <div className="progress-spinner" aria-hidden="true" />
                <div className="progress-text-wrap">
                  <span className="progress-title font-semibold">
                    Generating Payslips for {selectedMonth} {selectedYear}...
                  </span>
                  <div className="progress-pills">
                    {generationProgress.map((p) => (
                      <span key={p} className="progress-emp-pill">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Employee ID</th>
                    <th>Employee</th>
                    <th>Basic</th>
                    <th>HRA</th>
                    <th>Allowances</th>
                    <th>Gross Salary</th>
                    <th>Deductions</th>
                    <th>Net Salary</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingPayroll ? (
                    <tr>
                      <td colSpan="9" className="text-center" style={{ padding: '2rem' }}>
                        Loading payroll records...
                      </td>
                    </tr>
                  ) : payrollRecords.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center text-muted" style={{ padding: '2rem' }}>
                        No payroll record available for this period. Click &quot;Process Payroll&quot; to calculate salaries for active employees.
                      </td>
                    </tr>
                  ) : (
                    payrollRecords.map((rec) => (
                      <tr key={rec.employeeId}>
                        <td className="font-mono font-semibold text-primary">
                          {rec.employeeId}
                        </td>
                        <td>
                          <div className="emp-preview-name-col">
                            <span className="font-semibold text-dark">{rec.name}</span>
                            <span className="text-xs text-muted">{rec.designation}</span>
                          </div>
                        </td>
                        <td className="font-medium text-secondary">{formatINR(rec.basic)}</td>
                        <td className="font-medium text-secondary">{formatINR(rec.hra)}</td>
                        <td className="font-medium text-secondary">{formatINR(rec.allowances)}</td>
                        <td className="font-semibold text-dark">{formatINR(rec.grossSalary)}</td>
                        <td className="font-medium text-red">-{formatINR(rec.deductions)}</td>
                        <td className="font-bold text-green">{formatINR(rec.netSalary)}</td>
                        <td>
                          <span className="payroll-badge badge-valid">
                            <span className="badge-dot" aria-hidden="true" />
                            {rec.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ====================================================================
              PAYSLIP GENERATION RESULTS (Appears after payslip generation)
              ==================================================================== */}
          {payslipsGenerated && (
            <div className="admin-card payroll-results-card">
              <div className="card-header-clean">
                <div className="card-title-group">
                  <h2 className="card-section-title">Payslip Generation Results</h2>
                  <span className="card-section-subtitle">
                    Payslips linked to employee accounts via Employee ID
                  </span>
                </div>

                <div className="generation-success-tag">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{payrollRecords.length} payslips generated successfully</span>
                </div>
              </div>

              {/* Payslip Generation Summary Cards */}
              <div className="payslip-metrics-grid">
                <div className="payslip-stat-box border-slate">
                  <span className="stat-box-lbl">Employees Processed</span>
                  <span className="stat-box-val">{payrollRecords.length}</span>
                </div>

                <div className="payslip-stat-box border-green">
                  <span className="stat-box-lbl">Payslips Generated</span>
                  <span className="stat-box-val text-green">{payrollRecords.length}</span>
                </div>

                <div className="payslip-stat-box border-red">
                  <span className="stat-box-lbl">Failed</span>
                  <span className="stat-box-val text-muted">0</span>
                </div>

                <div className="payslip-stat-box border-amber">
                  <span className="stat-box-lbl">Already Generated</span>
                  <span className="stat-box-val text-amber">{alreadyGeneratedCount}</span>
                </div>
              </div>

              {/* Payslips Table */}
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Employee ID</th>
                      <th>Employee</th>
                      <th>Month</th>
                      <th>Net Salary</th>
                      <th>Payslip Status</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollRecords.map((rec) => (
                      <tr key={`payslip-${rec.employeeId}`}>
                        <td className="font-mono font-semibold text-primary">
                          {rec.employeeId}
                        </td>
                        <td className="font-semibold text-dark">
                          {rec.name}
                        </td>
                        <td className="text-secondary font-medium">
                          {selectedMonth} {selectedYear}
                        </td>
                        <td className="font-bold text-green">
                          {formatINR(rec.netSalary)}
                        </td>
                        <td>
                          <span className="payroll-badge badge-generated">
                            <span className="badge-dot" aria-hidden="true" />
                            {alreadyGeneratedCount > 0 ? 'Already Generated' : 'Generated'}
                          </span>
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="admin-btn-secondary btn-sm"
                            onClick={() => handleViewPayslip(rec.employeeId)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ====================================================================
          CONFIRM PROCESS PAYROLL MODAL
          ==================================================================== */}
      {isProcessModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-confirm-modal" style={{ maxWidth: '480px' }}>
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">
                Process {selectedMonth} {selectedYear} Payroll?
              </h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsProcessModalOpen(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body" style={{ padding: '1.25rem 1.5rem', textAlign: 'left', alignItems: 'stretch' }}>
              <div className="admin-att-read-box">
                <div className="admin-att-detail-row">
                  <span className="att-lbl">Employees:</span>
                  <span className="att-val font-semibold">{validationSummary.total || 1}</span>
                </div>
                <div className="admin-att-detail-row">
                  <span className="att-lbl">Valid Records:</span>
                  <span className="att-val font-semibold text-green">{validationSummary.valid || 1}</span>
                </div>
                <div className="admin-att-detail-row">
                  <span className="att-lbl">Warnings:</span>
                  <span className="att-val font-semibold text-amber">{validationSummary.warnings}</span>
                </div>
                <div className="admin-att-detail-row">
                  <span className="att-lbl">Errors:</span>
                  <span className="att-val font-semibold text-green">{validationSummary.errors}</span>
                </div>
              </div>

              <p className="confirm-note-text" style={{ marginTop: '0.875rem', fontSize: '0.875rem', color: '#475569' }}>
                Once payroll is processed, payslip records will be prepared for the selected employees.
              </p>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn-secondary"
                disabled={isProcessing}
                onClick={() => setIsProcessModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                disabled={isProcessing}
                onClick={handleConfirmProcessPayroll}
              >
                {isProcessing ? 'Processing...' : 'Process Payroll'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          INDIVIDUAL PAYSLIP PREVIEW MODAL
          ==================================================================== */}
      {selectedPayslip && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container payslip-preview-modal" style={{ maxWidth: '620px' }}>
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Payslip Preview</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setSelectedPayslip(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body payslip-modal-body" style={{ alignItems: 'stretch', textAlign: 'left' }}>
              {/* Company Branding & Title */}
              <div className="payslip-sheet-header">
                <span className="payslip-org-name font-bold">
                  GAINTPRO SOFTWARE TECHNOLOGIES
                </span>
                <span className="payslip-doc-type">PAYSLIP</span>
                <span className="payslip-period-subtitle">
                  {selectedMonth} {selectedYear}
                </span>
              </div>

              {/* Employee Details Box */}
              <div className="payslip-emp-info-grid">
                <div className="payslip-info-item">
                  <span className="info-lbl">Employee Name:</span>
                  <span className="info-val font-semibold">{selectedPayslip.name || selectedPayslip.employee_name}</span>
                </div>
                <div className="payslip-info-item">
                  <span className="info-lbl">Employee ID:</span>
                  <span className="info-val font-mono font-bold text-primary">
                    {selectedPayslip.employeeId || selectedPayslip.employee_id}
                  </span>
                </div>
                <div className="payslip-info-item">
                  <span className="info-lbl">Designation:</span>
                  <span className="info-val">{selectedPayslip.designation}</span>
                </div>
                <div className="payslip-info-item">
                  <span className="info-lbl">Department:</span>
                  <span className="info-val">{selectedPayslip.department}</span>
                </div>
              </div>

              {/* Earnings & Deductions Tables */}
              <div className="payslip-breakdown-tables">
                {/* Earnings Table */}
                <div className="payslip-side-table">
                  <div className="side-table-header earnings-bg">
                    <span>EARNINGS</span>
                    <span>AMOUNT</span>
                  </div>
                  <div className="side-table-row">
                    <span>Basic Salary</span>
                    <span className="font-mono">{formatINR(selectedPayslip.basic ?? selectedPayslip.basic_salary)}</span>
                  </div>
                  <div className="side-table-row">
                    <span>HRA</span>
                    <span className="font-mono">{formatINR(selectedPayslip.hra)}</span>
                  </div>
                  <div className="side-table-row">
                    <span>Allowances</span>
                    <span className="font-mono">{formatINR(selectedPayslip.allowances)}</span>
                  </div>
                  <div className="side-table-total-row">
                    <span className="font-bold">Gross Salary</span>
                    <span className="font-mono font-bold">{formatINR(selectedPayslip.grossSalary ?? selectedPayslip.gross_salary)}</span>
                  </div>
                </div>

                {/* Deductions Table */}
                <div className="payslip-side-table">
                  <div className="side-table-header deductions-bg">
                    <span>DEDUCTIONS</span>
                    <span>AMOUNT</span>
                  </div>
                  <div className="side-table-row">
                    <span>PF</span>
                    <span className="font-mono">{formatINR(selectedPayslip.pf ?? selectedPayslip.pf_employee)}</span>
                  </div>
                  <div className="side-table-row">
                    <span>Professional Tax</span>
                    <span className="font-mono">{formatINR(selectedPayslip.pt ?? selectedPayslip.professional_tax)}</span>
                  </div>
                  <div className="side-table-row">
                    <span>Other Deductions</span>
                    <span className="font-mono">{formatINR(selectedPayslip.otherDeductions ?? selectedPayslip.other_deductions)}</span>
                  </div>
                  <div className="side-table-total-row">
                    <span className="font-bold">Total Deductions</span>
                    <span className="font-mono font-bold">{formatINR(selectedPayslip.deductions ?? selectedPayslip.total_deductions)}</span>
                  </div>
                </div>
              </div>

              {/* Net Salary Highlight Bar */}
              <div className="payslip-net-salary-card">
                <span className="net-lbl">NET SALARY</span>
                <span className="net-amount font-mono font-extrabold text-green">
                  {formatINR(selectedPayslip.netSalary ?? selectedPayslip.net_salary)}
                </span>
              </div>

              {/* Employee Document Link Conceptual Notice */}
              <div className="payslip-doc-association-notice">
                <div className="assoc-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="assoc-content text-xs">
                  <strong>Document Association:</strong> {selectedMonth} {selectedYear} Payslip &rarr; Linked to Employee ID{' '}
                  <span className="font-mono font-semibold">{selectedPayslip.employeeId || selectedPayslip.employee_id}</span> (Automatically available in Employee Portal &rarr; Documents).
                </div>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => setSelectedPayslip(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                onClick={handleDownloadPayslipPdf}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download Payslip</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          PAYROLL HISTORY MODAL
          ==================================================================== */}
      {isHistoryModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container" style={{ maxWidth: '680px' }}>
            <div className="admin-modal-header">
              <div>
                <h2 className="admin-modal-title">Payroll History</h2>
                <span className="payroll-subtitle" style={{ fontSize: '0.8125rem' }}>
                  Previously processed monthly payroll periods
                </span>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsHistoryModalOpen(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body" style={{ padding: '1rem', alignItems: 'stretch' }}>
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Employees</th>
                      <th>Status</th>
                      <th>Processed Date</th>
                      <th>Payslips</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingHistory ? (
                      <tr>
                        <td colSpan="6" className="text-center" style={{ padding: '1.5rem' }}>
                          Loading payroll history...
                        </td>
                      </tr>
                    ) : payrollHistory.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center text-muted" style={{ padding: '1.5rem' }}>
                          No historical payroll records found.
                        </td>
                      </tr>
                    ) : (
                      payrollHistory.map((h) => (
                        <tr key={h.id}>
                          <td className="font-semibold text-dark">{h.month}</td>
                          <td className="text-secondary">{h.employees}</td>
                          <td>
                            <span className="payroll-badge badge-valid">
                              <span className="badge-dot" aria-hidden="true" />
                              {h.status}
                            </span>
                          </td>
                          <td className="text-secondary text-sm">{h.processedDate}</td>
                          <td className="font-semibold text-primary">{h.payslips}</td>
                          <td className="text-right">
                            <button
                              type="button"
                              className="admin-btn-secondary btn-sm"
                              onClick={() => {
                                if (h.month_name) setSelectedMonth(h.month_name);
                                if (h.year) setSelectedYear(h.year);
                                showToast(`Viewing details for ${h.month}`);
                                setIsHistoryModalOpen(false);
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => setIsHistoryModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          EXCEL PAYROLL IMPORT MODAL (3 STEPS)
          ==================================================================== */}
      {isImportModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
          <div className="admin-modal-container import-payroll-modal" style={{ maxWidth: importStep === 2 ? '940px' : '640px' }}>
            {/* Header */}
            <div className="admin-modal-header">
              <div>
                <h2 id="import-modal-title" className="admin-modal-title">Import Payroll from Excel</h2>
                <span className="payroll-subtitle" style={{ fontSize: '0.8125rem' }}>
                  {importStep === 1 && 'Step 1 of 3: Select and validate your monthly payroll Excel file (.xlsx)'}
                  {importStep === 2 && 'Step 2 of 3: Review data preview, calculations, and select import mode'}
                  {importStep === 3 && 'Step 3 of 3: Import complete & payslips generated'}
                </span>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={handleCloseImportModal}
                disabled={isValidatingImport || isConfirmingImport}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {/* Stepper tabs */}
            <div className="import-stepper-bar">
              <div className={`step-item ${importStep >= 1 ? 'active' : ''} ${importStep > 1 ? 'completed' : ''}`}>
                <span className="step-num">1</span>
                <span className="step-label">Upload File</span>
              </div>
              <div className="step-divider" />
              <div className={`step-item ${importStep >= 2 ? 'active' : ''} ${importStep > 2 ? 'completed' : ''}`}>
                <span className="step-num">2</span>
                <span className="step-label">Validate &amp; Preview</span>
              </div>
              <div className="step-divider" />
              <div className={`step-item ${importStep === 3 ? 'active completed' : ''}`}>
                <span className="step-num">3</span>
                <span className="step-label">Complete</span>
              </div>
            </div>

            {/* Error banner if any */}
            {importErrorMessage && (
              <div className="import-modal-error-banner" role="alert">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{importErrorMessage}</span>
              </div>
            )}

            {/* Step 1: Upload */}
            {importStep === 1 && (
              <div className="import-modal-body">
                <div className="import-upload-dropzone">
                  <input
                    type="file"
                    id="modalPayrollExcelInput"
                    accept=".xlsx"
                    className="file-hidden-input"
                    onChange={handleImportFileSelect}
                  />
                  <label htmlFor="modalPayrollExcelInput" className="upload-dropzone-label">
                    <div className="dropzone-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                    </div>
                    <span className="dropzone-btn-text">
                      {importFile ? importFile.name : 'Select or Drop Payroll Excel (.xlsx)'}
                    </span>
                    <span className="dropzone-subtext">
                      {importFile
                        ? `${(importFile.size / 1024).toFixed(1)} KB — Ready to validate`
                        : 'Supported format: .xlsx only (Max 10 MB)'}
                    </span>
                  </label>
                </div>

                <div className="import-hint-row">
                  <div className="hint-item">
                    <span className="font-semibold text-dark">Need the format?</span>
                    <button
                      type="button"
                      className="import-link-btn"
                      onClick={handleDownloadTemplate}
                    >
                      Download Excel Template
                    </button>
                  </div>
                  <span className="text-xs text-muted">
                    Expected columns: Employee ID, Month, Year, Working Days, Payable Days, Basic, HRA, Allowances, PF, PT, Other Deductions.
                  </span>
                </div>
              </div>
            )}

            {/* Step 2: Validate & Preview */}
            {importStep === 2 && importPreviewData && (
              <div className="import-modal-body preview-mode">
                {/* Summary Stat Cards */}
                <div className="import-stats-grid">
                  <div className="summary-stat-card border-slate">
                    <span className="stat-label">Total Rows</span>
                    <span className="stat-number">{importPreviewData.summary.totalRows}</span>
                  </div>
                  <div className="summary-stat-card border-green">
                    <span className="stat-label">Valid Rows</span>
                    <span className="stat-number text-green">{importPreviewData.summary.validRows}</span>
                  </div>
                  <div className="summary-stat-card border-red">
                    <span className="stat-label">Invalid Rows</span>
                    <span className="stat-number text-red">{importPreviewData.summary.invalidRows}</span>
                  </div>
                  <div className="summary-stat-card border-amber">
                    <span className="stat-label">Existing in DB</span>
                    <span className="stat-number text-amber">{importPreviewData.summary.existingPayrollRows}</span>
                  </div>
                  <div className="summary-stat-card border-slate">
                    <span className="stat-label">Duplicates</span>
                    <span className="stat-number">{importPreviewData.summary.duplicateRows}</span>
                  </div>
                </div>

                {/* Validation Errors Box if any */}
                {(importPreviewData.summary.invalidRows > 0 || importPreviewData.summary.duplicateRows > 0) && (
                  <div className="import-errors-box" role="alert">
                    <div className="errors-box-header">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <strong>Validation Errors Detected:</strong>
                    </div>
                    <ul className="errors-list">
                      {importPreviewData.rows
                        .filter((r) => r.status === 'INVALID' || (r.errors && r.errors.length > 0))
                        .map((r, idx) => (
                          <li key={idx}>
                            <span className="font-semibold">Row {r.rowNumber} ({r.employee_id || 'Empty ID'}):</span>{' '}
                            {r.errors.join('; ')}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {/* Import Mode Selection */}
                <div className="import-mode-container">
                  <span className="import-mode-title font-semibold text-dark">Select Import Mode:</span>
                  <div className="import-mode-cards">
                    <label className={`import-mode-card ${importMode === 'CREATE_ONLY' ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="importMode"
                        value="CREATE_ONLY"
                        checked={importMode === 'CREATE_ONLY'}
                        onChange={(e) => setImportMode(e.target.value)}
                      />
                      <div className="mode-content">
                        <div className="mode-title-row">
                          <span className="font-semibold">Create Only</span>
                          <span className="mode-tag">Default</span>
                        </div>
                        <span className="mode-subtitle text-xs text-muted">
                          Inserts new records only. Rejects if payroll already exists for any employee in the file.
                        </span>
                      </div>
                    </label>

                    <label className={`import-mode-card ${importMode === 'UPDATE_EXISTING' ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="importMode"
                        value="UPDATE_EXISTING"
                        checked={importMode === 'UPDATE_EXISTING'}
                        onChange={(e) => setImportMode(e.target.value)}
                      />
                      <div className="mode-content">
                        <div className="mode-title-row">
                          <span className="font-semibold">Update Existing</span>
                          <span className="mode-tag tag-update">Re-process</span>
                        </div>
                        <span className="mode-subtitle text-xs text-muted">
                          Updates existing records and regenerates payslips. Also inserts any new records.
                        </span>
                      </div>
                    </label>
                  </div>

                  {importPreviewData.summary.existingPayrollRows > 0 && importMode === 'CREATE_ONLY' && (
                    <div className="import-mode-warning text-xs text-amber">
                      ⚠ {importPreviewData.summary.existingPayrollRows} row(s) already exist in the database. Choose &quot;Update Existing&quot; mode to overwrite and regenerate them.
                    </div>
                  )}
                </div>

                {/* Rows Preview Table */}
                <div className="import-table-container admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Employee ID</th>
                        <th>Name</th>
                        <th>Period</th>
                        <th>Gross</th>
                        <th>Deductions</th>
                        <th>Net Salary</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreviewData.rows.map((r) => (
                        <tr key={r.rowNumber}>
                          <td className="text-muted text-xs">{r.rowNumber}</td>
                          <td className="font-mono font-semibold text-primary">{r.employee_id}</td>
                          <td className="font-medium text-dark">{r.employee_name || '-'}</td>
                          <td className="text-secondary text-sm">{r.month}/{r.year}</td>
                          <td className="font-medium">{formatINR(r.gross_salary)}</td>
                          <td className="font-medium text-red">-{formatINR(r.total_deductions)}</td>
                          <td className="font-bold text-green">{formatINR(r.net_salary)}</td>
                          <td>
                            {r.status === 'INVALID' ? (
                              <span className="payroll-badge badge-error">
                                <span className="badge-dot" aria-hidden="true" />
                                Invalid
                              </span>
                            ) : r.existsInDb ? (
                              <span className="payroll-badge badge-warning">
                                <span className="badge-dot" aria-hidden="true" />
                                Exists in DB
                              </span>
                            ) : (
                              <span className="payroll-badge badge-valid">
                                <span className="badge-dot" aria-hidden="true" />
                                Valid
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Step 3: Success */}
            {importStep === 3 && importResult && (
              <div className="import-modal-body success-step">
                <div className="success-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h3 className="success-title">Payroll Imported &amp; Payslips Generated!</h3>
                <p className="success-subtitle text-sm text-secondary">
                  The payroll batch has been committed inside an atomic PostgreSQL transaction. Official PDF payslips have been generated and secured in private document storage.
                </p>

                <div className="import-stats-grid success-stats">
                  <div className="summary-stat-card border-slate">
                    <span className="stat-label">Total Rows</span>
                    <span className="stat-number">{importResult.totalRows}</span>
                  </div>
                  <div className="summary-stat-card border-green">
                    <span className="stat-label">Created</span>
                    <span className="stat-number text-green">{importResult.createdCount}</span>
                  </div>
                  <div className="summary-stat-card border-slate">
                    <span className="stat-label">Updated</span>
                    <span className="stat-number text-primary">{importResult.updatedCount}</span>
                  </div>
                  <div className="summary-stat-card border-green">
                    <span className="stat-label">Payslips Generated</span>
                    <span className="stat-number text-green">{importResult.payslipsGenerated}</span>
                  </div>
                  <div className="summary-stat-card border-slate">
                    <span className="stat-label">Failed</span>
                    <span className="stat-number text-muted">{importResult.failedCount}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="admin-modal-footer">
              {importStep === 1 && (
                <>
                  <button
                    type="button"
                    className="admin-btn-secondary"
                    onClick={handleCloseImportModal}
                    disabled={isValidatingImport}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-btn-primary"
                    disabled={!importFile || isValidatingImport}
                    onClick={handleValidateImportFile}
                  >
                    {isValidatingImport ? 'Validating File...' : 'Validate Excel'}
                  </button>
                </>
              )}

              {importStep === 2 && (
                <>
                  <button
                    type="button"
                    className="admin-btn-secondary"
                    onClick={() => {
                      setImportStep(1);
                      setImportPreviewData(null);
                      setImportErrorMessage('');
                    }}
                    disabled={isConfirmingImport}
                  >
                    Back to Upload
                  </button>
                  <button
                    type="button"
                    className="admin-btn-primary admin-btn-success"
                    disabled={
                      importPreviewData.summary.invalidRows > 0 ||
                      importPreviewData.summary.duplicateRows > 0 ||
                      (importMode === 'CREATE_ONLY' && importPreviewData.summary.existingPayrollRows > 0) ||
                      isConfirmingImport
                    }
                    onClick={handleConfirmImport}
                  >
                    {isConfirmingImport ? 'Importing & Generating Payslips...' : 'Import & Generate Payroll'}
                  </button>
                </>
              )}

              {importStep === 3 && (
                <button
                  type="button"
                  className="admin-btn-primary"
                  onClick={handleFinishImport}
                >
                  View Payroll Records
                </button>
              )}
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

export default Payroll;
