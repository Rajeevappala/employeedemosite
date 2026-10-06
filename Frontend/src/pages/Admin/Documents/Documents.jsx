import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import './Documents.css';

/**
 * Parses free-form month and year text (e.g. "September 2026", "09/2026", "2026-09")
 * into numeric month (1-12) and year (1900-2100).
 */
const parseMonthYear = (str) => {
  if (!str || !str.trim()) return { month: null, year: null };
  const text = str.trim().toLowerCase();
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  let month = null;
  for (let i = 0; i < months.length; i++) {
    if (text.includes(months[i]) || text.includes(shortMonths[i])) {
      month = i + 1;
      break;
    }
  }

  if (!month) {
    const numMatch = text.match(/\b(0?[1-9]|1[0-2])\b/);
    if (numMatch) {
      month = parseInt(numMatch[1], 10);
    }
  }

  const yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  return { month, year };
};

/**
 * Formats ISO date string to readable UK format (DD Mon YYYY).
 */
const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
};

function Documents() {
  const navigate = useNavigate();

  // Documents and employees state
  const [documents, setDocuments] = useState([]);
  const [employeesList, setEmployeesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocType, setSelectedDocType] = useState('All');
  const [selectedEmployee, setSelectedEmployee] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    total_pages: 1,
  });

  // UI state
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [replaceDocId, setReplaceDocId] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Upload modal form state
  const [uploadForm, setUploadForm] = useState({
    employeeId: '',
    documentType: 'Offer Letter',
    documentName: '',
    monthYear: '',
    description: '',
  });

  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdownId(null);
      }
    };
    if (openDropdownId) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [openDropdownId]);

  // Clean up preview Blob URL on unmount or URL replacement
  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3500);
  };

  // Fetch employees list once on mount
  useEffect(() => {
    let isMounted = true;
    const loadEmployees = async () => {
      try {
        const res = await api.admin.getEmployees({ limit: 100 });
        if (isMounted && res && res.success && Array.isArray(res.data)) {
          setEmployeesList(res.data);
          if (res.data.length > 0) {
            setUploadForm((p) => ({
              ...p,
              employeeId: p.employeeId || res.data[0].employee_id,
            }));
          }
        }
      } catch (err) {
        console.error('Failed to load employee directory:', err);
      }
    };
    loadEmployees();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch documents from backend API
  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page: currentPage,
        limit: 10,
      };
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (selectedDocType !== 'All') {
        params.document_type = selectedDocType;
      }
      if (selectedEmployee !== 'All') {
        params.employee_id = selectedEmployee;
      }

      const res = await api.admin.getDocuments(params);
      if (res && res.success) {
        setDocuments(res.data || []);
        if (res.pagination) {
          setPagination(res.pagination);
        }
      } else {
        setDocuments([]);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setError(err.message || 'Failed to fetch documents');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, selectedDocType, selectedEmployee]);

  // Debounced documents fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDocuments();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchDocuments]);

  // Status filtering (all DB documents are 'Available')
  const filteredDocuments = useMemo(() => {
    if (selectedStatus === 'Missing') {
      return [];
    }
    return documents;
  }, [documents, selectedStatus]);

  // Document download handler
  const handleDownload = async (doc) => {
    try {
      showToast(`Downloading "${doc.file_name || doc.document_type}"...`);
      const blob = await api.admin.downloadDocument(doc.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name || `${doc.document_type || 'document'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download failed:', err);
      showToast(err.message || 'Failed to download document');
    }
  };

  // Document preview open handler
  const handleOpenPreview = async (doc) => {
    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewError('');
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }

    try {
      const blob = await api.admin.viewDocument(doc.id);
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
    } catch (err) {
      console.error('Failed to stream preview:', err);
      setPreviewError(err.message || 'Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Close preview modal
  const handleClosePreview = () => {
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewDoc(null);
    setPreviewLoading(false);
    setPreviewError('');
  };

  // Open upload / replace modal
  const handleOpenUploadModal = (replaceId = null) => {
    setReplaceDocId(replaceId);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (replaceId) {
      const targetDoc = documents.find((d) => d.id === replaceId);
      if (targetDoc) {
        setUploadForm({
          employeeId: targetDoc.employee_id,
          documentType: targetDoc.document_type || 'Offer Letter',
          documentName: targetDoc.file_name || '',
          monthYear: targetDoc.month && targetDoc.year ? `${targetDoc.month}/${targetDoc.year}` : '',
          description: '',
        });
      }
    } else {
      setUploadForm({
        employeeId: employeesList.length > 0 ? employeesList[0].employee_id : '',
        documentType: 'Offer Letter',
        documentName: '',
        monthYear: '',
        description: '',
      });
    }
    setIsUploadModalOpen(true);
    setOpenDropdownId(null);
  };

  // Upload or replace submit handler
  const handleUploadSubmit = async (e) => {
    e.preventDefault();

    if (!selectedFile) {
      showToast('Please select a file to upload.');
      return;
    }

    if (!uploadForm.employeeId) {
      showToast('Please select an employee.');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('employee_id', uploadForm.employeeId);
      formData.append('document_type', uploadForm.documentType);

      if (uploadForm.documentType === 'Payslip' && uploadForm.monthYear) {
        const { month, year } = parseMonthYear(uploadForm.monthYear);
        if (month) formData.append('month', String(month));
        if (year) formData.append('year', String(year));
      }

      await api.admin.uploadDocument(formData);

      // If replacing an existing document, safely remove the old record
      if (replaceDocId) {
        try {
          await api.admin.deleteDocument(replaceDocId);
        } catch (delErr) {
          console.warn('Old document cleanup warning:', delErr.message);
        }
        showToast('Document replaced successfully.');
      } else {
        showToast('Document uploaded successfully.');
      }

      setIsUploadModalOpen(false);
      setReplaceDocId(null);
      setSelectedFile(null);
      fetchDocuments();
    } catch (err) {
      console.error('Upload failed:', err);
      showToast(err.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  // Safe delete document handler
  const handleDeleteDocument = async (docId) => {
    const targetDoc = documents.find((d) => d.id === docId);
    const confirmed = window.confirm(
      `Are you sure you want to delete "${targetDoc?.file_name || targetDoc?.document_type || 'this document'}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await api.admin.deleteDocument(docId);
      showToast('Document deleted successfully.');
      setOpenDropdownId(null);
      fetchDocuments();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast(err.message || 'Failed to delete document');
    }
  };

  // Document types breakdown for cards
  const offerLetterCount = useMemo(
    () => documents.filter((d) => d.document_type === 'Offer Letter').length,
    [documents]
  );
  const payslipCount = useMemo(
    () => documents.filter((d) => d.document_type === 'Payslip').length,
    [documents]
  );
  const otherCount = useMemo(
    () => documents.filter((d) => !['Offer Letter', 'Payslip'].includes(d.document_type)).length,
    [documents]
  );

  return (
    <div className="admin-documents-page">
      {/* ====================================================================
          PAGE HEADER
          ==================================================================== */}
      <header className="admin-docs-header">
        <div className="admin-docs-title-group">
          <h1 className="admin-docs-title">Documents</h1>
          <p className="admin-docs-subtitle">
            Manage employee documents, letters and payslips.
          </p>
        </div>

        <button
          type="button"
          className="admin-btn-primary admin-upload-trigger-btn"
          onClick={() => handleOpenUploadModal(null)}
        >
          <svg
            className="admin-btn-svg"
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
          <span> Upload Document</span>
        </button>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-docs-toast" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ====================================================================
          SUMMARY CARDS (4 cards)
          ==================================================================== */}
      <section className="admin-docs-summary-grid" aria-label="Document Statistics">
        {/* Card 1: Total Documents */}
        <div className="admin-doc-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Total Documents</span>
            <div className="admin-stat-icon-wrapper stat-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{pagination.total}</div>
          <div className="admin-stat-footer">Across {employeesList.length || 1} employees</div>
        </div>

        {/* Card 2: Offer Letters */}
        <div className="admin-doc-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Offer Letters</span>
            <div className="admin-stat-icon-wrapper stat-green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{offerLetterCount}</div>
          <div className="admin-stat-footer">Verified organization letters</div>
        </div>

        {/* Card 3: Payslips */}
        <div className="admin-doc-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Payslips</span>
            <div className="admin-stat-icon-wrapper stat-purple">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
                <line x1="7" y1="15" x2="7.01" y2="15" />
                <line x1="11" y1="15" x2="13" y2="15" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{payslipCount}</div>
          <div className="admin-stat-footer">Monthly payroll records</div>
        </div>

        {/* Card 4: Other Documents */}
        <div className="admin-doc-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Other Documents</span>
            <div className="admin-stat-icon-wrapper stat-amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{otherCount}</div>
          <div className="admin-stat-footer">Policies & statutory records</div>
        </div>
      </section>

      {/* ====================================================================
          SEARCH AND FILTERS
          ==================================================================== */}
      <section className="admin-filters-card" aria-label="Search and Filter Documents">
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
            type="text"
            className="admin-search-input"
            placeholder="Search by employee name, ID or document..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Search documents"
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

        <div className="admin-filter-controls">
          {/* Document Type Filter */}
          <div className="admin-filter-group">
            <label htmlFor="docTypeFilter" className="admin-filter-label">Document Type:</label>
            <select
              id="docTypeFilter"
              className="admin-filter-select"
              value={selectedDocType}
              onChange={(e) => {
                setSelectedDocType(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="All">All Documents</option>
              <option value="Offer Letter">Offer Letter</option>
              <option value="Payslip">Payslip</option>
              <option value="Experience Letter">Experience Letter</option>
              <option value="Relieving Letter">Relieving Letter</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Employee Filter */}
          <div className="admin-filter-group">
            <label htmlFor="empFilter" className="admin-filter-label">Employee:</label>
            <select
              id="empFilter"
              className="admin-filter-select"
              value={selectedEmployee}
              onChange={(e) => {
                setSelectedEmployee(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="All">All Employees</option>
              {employeesList.map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>
                  {emp.first_name} {emp.last_name} ({emp.employee_id})
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="admin-filter-group">
            <label htmlFor="statusFilter" className="admin-filter-label">Status:</label>
            <select
              id="statusFilter"
              className="admin-filter-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="All">All Status</option>
              <option value="Available">Available</option>
              <option value="Missing">Missing</option>
            </select>
          </div>
        </div>
      </section>

      {/* ====================================================================
          DOCUMENT TABLE
          ==================================================================== */}
      <section className="admin-card admin-docs-table-card">
        <div className="admin-table-header-meta">
          <span className="admin-results-count">
            Showing <strong>{filteredDocuments.length}</strong> of {pagination.total} document records
          </span>
          {(searchQuery || selectedDocType !== 'All' || selectedEmployee !== 'All' || selectedStatus !== 'All') && (
            <button
              type="button"
              className="admin-reset-filters-btn"
              onClick={() => {
                setSearchQuery('');
                setSelectedDocType('All');
                setSelectedEmployee('All');
                setSelectedStatus('All');
                setCurrentPage(1);
              }}
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Employee</th>
                <th scope="col">Employee ID</th>
                <th scope="col">Document Type</th>
                <th scope="col">Uploaded Date</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title">Loading documents...</p>
                      <p className="admin-empty-desc">Please wait while documents are fetched.</p>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="7" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title" style={{ color: '#ef4444' }}>Unable to load documents</p>
                      <p className="admin-empty-desc">{error}</p>
                    </div>
                  </td>
                </tr>
              ) : filteredDocuments.length > 0 ? (
                filteredDocuments.map((doc) => {
                  const docTitle = doc.file_name || doc.document_type || 'Document';
                  const empName = doc.employee_name || doc.employee_id;
                  const formattedUploadDate = formatDate(doc.created_at);

                  return (
                    <tr key={doc.id}>
                      {/* Document Name */}
                      <td>
                        <div className="admin-doc-name-cell">
                          <div className="admin-doc-mini-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </div>
                          <span className="admin-doc-title-text">{docTitle}</span>
                        </div>
                      </td>

                      {/* Employee Name (Clickable) */}
                      <td>
                        <button
                          type="button"
                          className="admin-emp-link-btn"
                          onClick={() => navigate(`/admin/employees/${doc.employee_id}`)}
                          title={`View ${empName}'s profile`}
                        >
                          {empName}
                        </button>
                      </td>

                      {/* Employee ID (Clickable) */}
                      <td>
                        <button
                          type="button"
                          className="admin-id-badge admin-id-badge-interactive"
                          onClick={() => navigate(`/admin/employees/${doc.employee_id}`)}
                          title={`Navigate to ${doc.employee_id}`}
                        >
                          {doc.employee_id}
                        </button>
                      </td>

                      {/* Document Type */}
                      <td>
                        <span className="admin-dept-tag">{doc.document_type}</span>
                      </td>

                      {/* Uploaded Date */}
                      <td className="text-muted">{formattedUploadDate}</td>

                      {/* Status */}
                      <td>
                        <span className="admin-status-badge status-active">
                          <span className="status-dot" aria-hidden="true"></span>
                          Available
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="text-right">
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-action-btn-pill admin-action-view"
                            onClick={() => handleOpenPreview(doc)}
                            aria-label={`View ${docTitle}`}
                          >
                            View
                          </button>

                          <button
                            type="button"
                            className="admin-action-btn-pill admin-action-download"
                            onClick={() => handleDownload(doc)}
                            aria-label={`Download ${docTitle}`}
                          >
                            Download
                          </button>

                          {/* More Dropdown */}
                          <div
                            className="admin-dropdown-wrapper"
                            ref={openDropdownId === doc.id ? dropdownRef : null}
                          >
                            <button
                              type="button"
                              className="admin-action-btn-more"
                              onClick={() =>
                                setOpenDropdownId(openDropdownId === doc.id ? null : doc.id)
                              }
                              aria-label={`More actions for ${docTitle}`}
                              aria-expanded={openDropdownId === doc.id}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="1" />
                                <circle cx="12" cy="5" r="1" />
                                <circle cx="12" cy="19" r="1" />
                              </svg>
                            </button>

                            {openDropdownId === doc.id && (
                              <div className="admin-action-dropdown-menu" role="menu">
                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item"
                                  onClick={() => {
                                    setOpenDropdownId(null);
                                    handleOpenPreview(doc);
                                  }}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  <span>View Document</span>
                                </button>

                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item"
                                  onClick={() => {
                                    setOpenDropdownId(null);
                                    handleDownload(doc);
                                  }}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  <span>Download</span>
                                </button>

                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item"
                                  onClick={() => handleOpenUploadModal(doc.id)}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="17 8 12 3 7 8" />
                                    <line x1="12" y1="3" x2="12" y2="15" />
                                  </svg>
                                  <span>Replace Document</span>
                                </button>

                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item text-danger"
                                  onClick={() => handleDeleteDocument(doc.id)}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                  <span>Delete Document</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <p className="admin-empty-title">No documents found</p>
                      <p className="admin-empty-desc">
                        Try adjusting your search criteria or filter options.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ====================================================================
            PAGINATION
            ==================================================================== */}
        <div className="admin-pagination-wrapper">
          <div className="admin-pagination-info">
            Showing page {pagination.page} of {pagination.total_pages || 1}
          </div>

          <div className="admin-pagination-controls">
            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={pagination.page <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              &larr; Previous
            </button>

            {Array.from({ length: pagination.total_pages || 1 }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                className={`admin-page-btn ${pagination.page === page ? 'admin-page-active' : ''}`}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={pagination.page >= (pagination.total_pages || 1)}
              onClick={() => setCurrentPage((p) => Math.min(pagination.total_pages, p + 1))}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </section>

      {/* ====================================================================
          DOCUMENT PREVIEW MODAL
          ==================================================================== */}
      {previewDoc && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-doc-preview-modal-shell">
            <div className="admin-modal-header">
              <div className="admin-doc-modal-header-info">
                <div className="admin-doc-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div>
                  <h2 className="admin-modal-title">Document Preview</h2>
                  <span className="admin-doc-modal-subtitle">
                    {previewDoc.file_name || previewDoc.document_type}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={handleClosePreview}
                aria-label="Close document preview"
              >
                &times;
              </button>
            </div>

            <div className="admin-modal-body admin-doc-modal-body">
              {/* Document Metadata Details Card */}
              <div className="admin-doc-metadata-grid">
                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Document Name</span>
                  <span className="doc-meta-val">{previewDoc.file_name || previewDoc.document_type}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Employee</span>
                  <button
                    type="button"
                    className="doc-meta-emp-link"
                    onClick={() => {
                      handleClosePreview();
                      navigate(`/admin/employees/${previewDoc.employee_id}`);
                    }}
                  >
                    {previewDoc.employee_name || previewDoc.employee_id} ({previewDoc.employee_id})
                  </button>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Document Type</span>
                  <span className="doc-meta-val">{previewDoc.document_type}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">File Name</span>
                  <span className="doc-meta-val font-mono">{previewDoc.file_name || '-'}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Uploaded Date</span>
                  <span className="doc-meta-val">{formatDate(previewDoc.created_at)}</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Uploaded By</span>
                  <span className="doc-meta-val">Administrator</span>
                </div>

                <div className="admin-doc-meta-item">
                  <span className="doc-meta-lbl">Status</span>
                  <span className="doc-meta-val">
                    <span className="admin-status-badge status-active">
                      <span className="status-dot" aria-hidden="true"></span>
                      Available
                    </span>
                  </span>
                </div>
              </div>

              {/* Secure Document Preview Viewer Container */}
              <div
                className="admin-preview-viewer-box"
                style={previewBlobUrl ? { padding: 0, border: '1px solid #cbd5e1', overflow: 'hidden' } : {}}
              >
                {previewLoading ? (
                  <div className="admin-preview-viewer-inner">
                    <div className="admin-preview-pdf-icon-wrap" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <h3 className="admin-preview-viewer-title">Loading Preview...</h3>
                    <p className="admin-preview-viewer-msg">Fetching secure document stream...</p>
                  </div>
                ) : previewError ? (
                  <div className="admin-preview-viewer-inner">
                    <h3 className="admin-preview-viewer-title" style={{ color: '#ef4444' }}>Unable to load preview</h3>
                    <p className="admin-preview-viewer-msg">{previewError}</p>
                    <span className="admin-preview-viewer-subnote">
                      Please use the Download button below to inspect this file.
                    </span>
                  </div>
                ) : previewBlobUrl && (previewDoc.file_name?.toLowerCase().endsWith('.pdf') || previewDoc.document_type?.toLowerCase().includes('pdf')) ? (
                  <iframe
                    src={previewBlobUrl}
                    title={previewDoc.file_name || previewDoc.document_type}
                    style={{ width: '100%', height: '550px', border: 'none', display: 'block' }}
                  />
                ) : previewBlobUrl && /\.(png|jpe?g)$/i.test(previewDoc.file_name || '') ? (
                  <div style={{ width: '100%', maxHeight: '550px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <img
                      src={previewBlobUrl}
                      alt={previewDoc.file_name || previewDoc.document_type}
                      style={{ maxWidth: '100%', maxHeight: '500px', objectFit: 'contain' }}
                    />
                  </div>
                ) : previewBlobUrl ? (
                  <iframe
                    src={previewBlobUrl}
                    title={previewDoc.file_name || previewDoc.document_type}
                    style={{ width: '100%', height: '550px', border: 'none', display: 'block' }}
                  />
                ) : (
                  <div className="admin-preview-viewer-inner">
                    <div className="admin-preview-pdf-icon-wrap" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <h3 className="admin-preview-viewer-title">Document Preview</h3>
                    <p className="admin-preview-viewer-msg">No preview content loaded.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={handleClosePreview}
              >
                Close
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => handleDownload(previewDoc)}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          UPLOAD DOCUMENT MODAL
          ==================================================================== */}
      {isUploadModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">
                {replaceDocId ? 'Replace Employee Document' : 'Upload Employee Document'}
              </h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setReplaceDocId(null);
                  setSelectedFile(null);
                }}
                aria-label="Close upload modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="admin-modal-form">
              <div className="admin-form-field">
                <label htmlFor="uploadEmpSelect" className="admin-field-label">
                  Employee <span className="text-required">*</span>
                </label>
                <select
                  id="uploadEmpSelect"
                  className="admin-field-select"
                  value={uploadForm.employeeId}
                  onChange={(e) =>
                    setUploadForm((p) => ({ ...p, employeeId: e.target.value }))
                  }
                  required
                >
                  <option value="">Select Employee</option>
                  {employeesList.map((emp) => (
                    <option key={emp.employee_id} value={emp.employee_id}>
                      {emp.first_name} {emp.last_name} ({emp.employee_id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label htmlFor="uploadDocType" className="admin-field-label">
                  Document Type <span className="text-required">*</span>
                </label>
                <select
                  id="uploadDocType"
                  className="admin-field-select"
                  value={uploadForm.documentType}
                  onChange={(e) =>
                    setUploadForm((p) => ({ ...p, documentType: e.target.value }))
                  }
                  required
                >
                  <option value="Offer Letter">Offer Letter</option>
                  <option value="Payslip">Payslip</option>
                  <option value="Experience Letter">Experience Letter</option>
                  <option value="Relieving Letter">Relieving Letter</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label htmlFor="uploadDocName" className="admin-field-label">
                  Document Name (Optional)
                </label>
                <input
                  id="uploadDocName"
                  type="text"
                  className="admin-field-input"
                  placeholder="e.g. September 2026 Payslip"
                  value={uploadForm.documentName}
                  onChange={(e) =>
                    setUploadForm((p) => ({ ...p, documentName: e.target.value }))
                  }
                />
              </div>

              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label className="admin-field-label">
                  Upload File <span className="text-required">*</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="admin-field-input"
                  style={{ paddingTop: '0.4rem' }}
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                  required
                />
              </div>

              {uploadForm.documentType === 'Payslip' && (
                <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                  <label htmlFor="uploadMonthYear" className="admin-field-label">
                    Month / Year (Optional)
                  </label>
                  <input
                    id="uploadMonthYear"
                    type="text"
                    className="admin-field-input"
                    placeholder="e.g. September 2026"
                    value={uploadForm.monthYear}
                    onChange={(e) =>
                      setUploadForm((p) => ({ ...p, monthYear: e.target.value }))
                    }
                  />
                </div>
              )}

              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label htmlFor="uploadDescription" className="admin-field-label">
                  Description (Optional)
                </label>
                <textarea
                  id="uploadDescription"
                  rows="3"
                  className="admin-field-textarea"
                  placeholder="Add any administrative notes regarding this document..."
                  value={uploadForm.description}
                  onChange={(e) =>
                    setUploadForm((p) => ({ ...p, description: e.target.value }))
                  }
                ></textarea>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  disabled={uploading}
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setReplaceDocId(null);
                    setSelectedFile(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="admin-btn-primary" disabled={uploading}>
                  {uploading
                    ? 'Uploading...'
                    : replaceDocId
                    ? 'Replace Document'
                    : 'Upload Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Documents;
