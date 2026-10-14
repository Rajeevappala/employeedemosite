import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import './EmployeeDetails.css';
import '../../Employee/Documents/Documents.css';

const CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'employment', label: 'Employment' },
  { id: 'identity', label: 'Identity & Personal' },
  { id: 'statutory', label: 'PF & Statutory' },
  { id: 'payslip', label: 'Payslips' },
  { id: 'other', label: 'Other' },
];

const SECTION_CONFIG = {
  employment: { id: 'employment', title: 'Employment Documents' },
  identity: { id: 'identity', title: 'Identity and Personal Documents' },
  statutory: { id: 'statutory', title: 'PF and Statutory Documents' },
  payslip: { id: 'payslip', title: 'Payslips' },
  other: { id: 'other', title: 'Other Documents' },
};

function determineCategory(documentType) {
  if (!documentType) return 'other';
  const lower = documentType.trim().toLowerCase();

  const employmentKeywords = [
    'offer letter',
    'appointment letter',
    'experience letter',
    'experience certificate',
    'relieving letter',
    'fnf',
    'settlement',
    'internship',
    'employment',
    'contract',
    'joining',
  ];
  if (employmentKeywords.some((k) => lower.includes(k))) {
    return 'employment';
  }

  const identityKeywords = [
    'aadhaar',
    'pan card',
    'pan',
    'passport',
    'voter',
    'license',
    'driving',
    'identity',
    'id proof',
    'photo',
    'address proof',
  ];
  if (identityKeywords.some((k) => lower.includes(k))) {
    return 'identity';
  }

  const statutoryKeywords = [
    'pf',
    'provident fund',
    'uan',
    'form 16',
    'form-16',
    'esic',
    'tax',
    'statutory',
  ];
  if (statutoryKeywords.some((k) => lower.includes(k))) {
    return 'statutory';
  }

  const payslipKeywords = ['payslip', 'pay slip', 'salary slip', 'salary'];
  if (payslipKeywords.some((k) => lower.includes(k))) {
    return 'payslip';
  }

  return 'other';
}

function formatUploadedDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

function mapAdminDocument(doc) {
  const isAvailable = doc.is_file_available !== false && doc.file_available !== false && doc.status !== 'Unavailable';
  const fileName = doc.file_name || doc.fileName || 'document.pdf';
  const extMatch = fileName.lastIndexOf('.');
  const rawExt = extMatch > -1 ? fileName.slice(extMatch + 1).toUpperCase() : 'PDF';
  const ext = rawExt.length <= 4 ? rawExt : 'DOC';

  return {
    id: doc.id,
    employeeId: doc.employee_id,
    category: determineCategory(doc.document_type),
    name: doc.document_type || doc.name || 'Document',
    fileName: fileName,
    type: doc.document_type || doc.type || 'Document',
    uploadedDate: formatUploadedDate(doc.created_at || doc.uploadedDate),
    isFileAvailable: isAvailable,
    status: isAvailable ? 'Available' : 'Unavailable',
    ext: ext,
  };
}

// ============================================================================
// Document Card Item Component
// ============================================================================
function DocumentCardItem({ doc, onView, onDownload, onDelete }) {
  const isImage = ['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'SVG'].includes(doc.ext);

  return (
    <article className="document-card admin-document-card" aria-labelledby={`doc-title-${doc.id}`}>
      <div className="document-card-top">
        <div className="document-icon-badge" aria-hidden="true">
          <svg
            className="document-svg-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className={`document-badge-ext ${isImage ? 'badge-ext-image' : ''}`}>
            {doc.ext}
          </span>
        </div>

        <div className="document-text-container">
          <h3 id={`doc-title-${doc.id}`} className="document-title" title={doc.name}>
            {doc.name}
          </h3>
          <p className="document-filename" title={doc.fileName}>{doc.fileName}</p>
        </div>
      </div>

      <div className="document-meta-details">
        <div className="document-meta-item">
          <span className="document-meta-label">Type</span>
          <span className="document-meta-value">{doc.type}</span>
        </div>
        <div className="document-meta-item">
          <span className="document-meta-label">Uploaded</span>
          <span className="document-meta-value">{doc.uploadedDate}</span>
        </div>
        <div className="document-meta-item">
          <span className="document-meta-label">Status</span>
          <span className="document-meta-value">
            {doc.isFileAvailable ? (
              <span className="admin-status-badge status-active" style={{ fontSize: '0.6875rem', padding: '0.15rem 0.5rem' }}>
                <span className="status-dot" aria-hidden="true"></span>
                Available
              </span>
            ) : (
              <span
                className="status-unavailable-badge"
                title="Physical file is unavailable in private storage"
              >
                <span className="status-unavailable-dot" aria-hidden="true"></span>
                File Unavailable
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="document-card-actions">
        <button
          type="button"
          className="document-btn document-btn-view"
          disabled={!doc.isFileAvailable}
          onClick={() => onView(doc)}
          aria-label={`View ${doc.name}`}
          title={!doc.isFileAvailable ? 'Physical file is unavailable in storage' : `View ${doc.name}`}
        >
          <svg
            className="btn-action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          View
        </button>
        <button
          type="button"
          className="document-btn document-btn-download"
          disabled={!doc.isFileAvailable}
          onClick={() => onDownload(doc)}
          aria-label={`Download ${doc.name}`}
          title={!doc.isFileAvailable ? 'Physical file is unavailable in storage' : `Download ${doc.name}`}
        >
          <svg
            className="btn-action-icon"
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
          Download
        </button>
        <button
          type="button"
          className="document-btn document-btn-delete"
          onClick={() => onDelete(doc)}
          aria-label={`Delete ${doc.name}`}
          title={`Delete ${doc.name}`}
        >
          <svg
            className="btn-action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
          Delete
        </button>
      </div>
    </article>
  );
}

// ============================================================================
// Genuine Document Preview Modal Component
// ============================================================================
function DocumentPreviewModal({ doc, employeeId, onClose, onDownload }) {
  const fileName = doc?.fileName || '';
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const isPdf = ext === '.pdf';
  const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext);
  const isUnsupported = !isPdf && !isImage;

  const [loading, setLoading] = useState(!isUnsupported);
  const [error, setError] = useState(null);
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    let createdUrl = null;

    if (!doc || !doc.id || isUnsupported) return;

    async function loadDocument() {
      try {
        const blob = await api.admin.viewDocument(doc.id, employeeId);
        if (isCancelled) return;

        const url = window.URL.createObjectURL(blob);
        createdUrl = url;
        setObjectUrl(url);
      } catch (err) {
        if (!isCancelled) {
          setError(err?.message || 'Unable to load this document from secure storage.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      isCancelled = true;
      if (createdUrl) {
        window.URL.revokeObjectURL(createdUrl);
      }
    };
  }, [doc, employeeId, isUnsupported]);

  if (!doc) return null;

  return (
    <div
      className="doc-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
    >
      <div
        className="doc-modal-window"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: isPdf ? '900px' : isImage ? '650px' : '520px',
          width: '95%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="doc-modal-header">
          <div className="doc-modal-headings">
            <h3 id="preview-modal-title" className="doc-modal-title">
              {doc.name}
            </h3>
            <span className="doc-modal-file">{doc.fileName}</span>
          </div>
          <button
            type="button"
            className="doc-modal-close"
            onClick={onClose}
            aria-label="Close document preview"
          >
            &times;
          </button>
        </div>

        <div
          className="doc-modal-content"
          style={{
            padding: isPdf && !loading && !error ? 0 : undefined,
            flex: 1,
            overflow: 'auto',
          }}
        >
          {loading ? (
            <div className="doc-preview-placeholder-box">
              <div
                className="doc-placeholder-icon"
                aria-hidden="true"
                style={{ animation: 'spin 1.2s linear infinite' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
              </div>
              <h4 className="doc-placeholder-title">Loading document...</h4>
              <p className="doc-placeholder-desc">
                Please wait while the document is securely retrieved.
              </p>
            </div>
          ) : error ? (
            <div className="doc-preview-placeholder-box">
              <div
                className="doc-placeholder-icon"
                style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h4 className="doc-placeholder-title" style={{ color: '#dc2626' }}>
                Unable to load this document.
              </h4>
              <p className="doc-placeholder-desc">{error}</p>
            </div>
          ) : isUnsupported ? (
            <div className="doc-preview-placeholder-box">
              <div className="doc-placeholder-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <h4 className="doc-placeholder-title">
                Preview is not available for this file type. Please download the document.
              </h4>
              <p className="doc-placeholder-desc">File: {doc.fileName}</p>
            </div>
          ) : isPdf && objectUrl ? (
            <iframe
              src={objectUrl}
              title={doc.fileName || 'PDF Document Preview'}
              style={{
                width: '100%',
                height: '65vh',
                minHeight: '480px',
                border: 'none',
                display: 'block',
              }}
            />
          ) : isImage && objectUrl ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '1.5rem',
                maxHeight: '65vh',
                overflow: 'auto',
              }}
            >
              <img
                src={objectUrl}
                alt={doc.fileName || 'Document Preview'}
                style={{
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  objectFit: 'contain',
                  borderRadius: '0.375rem',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                }}
              />
            </div>
          ) : null}
        </div>

        <div
          className="doc-modal-footer"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {onDownload && doc.isFileAvailable && (
            <button
              type="button"
              className="doc-card-btn doc-card-btn-download"
              onClick={() => onDownload(doc)}
              style={{ minHeight: '38px', padding: '0.4rem 1rem' }}
            >
              <svg
                className="btn-action-icon"
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
              Download
            </button>
          )}
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={onClose}
            style={{ marginLeft: 'auto' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_EDIT_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  department: 'Technology',
  designation: '',
  joiningDate: '',
  employmentType: 'Full Time',
  workLocation: 'Hyderabad',
  reportingManager: 'Admin',
  employmentStatus: 'Active',
};

function EmployeeDetails() {
  const { employeeId } = useParams();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [submittingStatus, setSubmittingStatus] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);

  // Documents search & category filter state
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [activeDocCategory, setActiveDocCategory] = useState('all');

  // Upload document form state
  const [uploadDocType, setUploadDocType] = useState('Offer Letter');
  const [uploadCustomType, setUploadCustomType] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [submittingUpload, setSubmittingUpload] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Delete document modal state
  const [docToDelete, setDocToDelete] = useState(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3500);
  };

  // Bank Details Verification Modal State
  const [isBankVerifyModalOpen, setIsBankVerifyModalOpen] = useState(false);
  const [bankVerifyStatus, setBankVerifyStatus] = useState('Verified');
  const [bankVerifyRemarks, setBankVerifyRemarks] = useState('');
  const [submittingBankVerify, setSubmittingBankVerify] = useState(false);

  const handleOpenBankVerifyModal = () => {
    if (employee?.bankDetails) {
      setBankVerifyStatus(employee.bankDetails.verificationStatus === 'Rejected' ? 'Rejected' : 'Verified');
      setBankVerifyRemarks(employee.bankDetails.adminRemarks || '');
      setIsBankVerifyModalOpen(true);
    }
  };

  const handleBankVerifySubmit = async (e) => {
    e.preventDefault();
    if (!employeeId) return;
    setSubmittingBankVerify(true);
    try {
      const response = await api.admin.verifyEmployeeBankDetails(employeeId, {
        verification_status: bankVerifyStatus,
        admin_remarks: bankVerifyRemarks,
      });
      if (response && response.success) {
        showToast(response.message || `Bank details marked as ${bankVerifyStatus}.`);
        setIsBankVerifyModalOpen(false);
        fetchEmployeeDetails();
      }
    } catch (err) {
      showToast(err.message || 'Failed to update bank details verification.');
    } finally {
      setSubmittingBankVerify(false);
    }
  };


  const applyEmployeeData = (raw, bankRaw = null) => {
    const fullName = [raw.first_name, raw.last_name].filter(Boolean).join(' ') || raw.employee_id;
    const formattedStatus = raw.status
      ? raw.status.charAt(0).toUpperCase() + raw.status.slice(1).toLowerCase()
      : 'Active';

    setEmployee({
      employeeId: raw.employee_id,
      firstName: raw.first_name || '',
      lastName: raw.last_name || '',
      name: fullName,
      designation: raw.designation || '—',
      department: raw.department || '—',
      status: formattedStatus,
      email: raw.email || '—',
      phone: raw.phone || '—',
      dob: raw.date_of_birth || '—',
      gender: raw.gender || '—',
      address: [raw.address, raw.city, raw.state, raw.postal_code].filter(Boolean).join(', ') || '—',
      emergencyContact: raw.emergency_contact_phone
        ? `${raw.emergency_contact_name || ''} (${raw.emergency_contact_phone})`.trim()
        : (raw.emergency_contact_name || '—'),
      employmentType: raw.employment_type || 'Full Time',
      dateOfJoining: raw.date_of_joining || '—',
      workLocation: [raw.city, raw.state].filter(Boolean).join(', ') || 'Hyderabad',
      reportingManager: raw.reporting_manager || 'Admin',
      pf: {
        uan: raw.pf_details?.uan_number || '—',
        pfNumber: raw.pf_details?.pf_number || '—',
        pensionNumber: raw.pf_details?.pension_number || '—',
        employerContribution: (raw.pf_details?.employer_contribution !== null && raw.pf_details?.employer_contribution !== undefined && raw.pf_details?.employer_contribution !== '')
          ? `₹${parseFloat(raw.pf_details.employer_contribution).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : 'Not configured',
        employeeContribution: (raw.pf_details?.employee_contribution !== null && raw.pf_details?.employee_contribution !== undefined && raw.pf_details?.employee_contribution !== '')
          ? `₹${parseFloat(raw.pf_details.employee_contribution).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : 'Not configured',
        pfStatus: raw.pf_details?.pf_status || (raw.pf_details?.uan_number ? 'Active' : 'Not Configured'),
      },
      leaveSummary: {
        pl: {
          total: raw.leave_balances?.paid_leave_total ?? 12,
          used: raw.leave_balances?.paid_leave_used ?? 0,
          remaining: raw.leave_balances?.paid_leave_balance ?? 12,
        },
        sick: {
          total: raw.leave_balances?.sick_leave_total ?? 10,
          used: raw.leave_balances?.sick_leave_used ?? 0,
          remaining: raw.leave_balances?.sick_leave_balance ?? 10,
        },
        upl: {
          used: raw.leave_balances?.unpaid_leave_balance ?? 0,
        },
      },
      documents: Array.isArray(raw.documents) ? raw.documents.map(mapAdminDocument) : [],
      recentLeaves: Array.isArray(raw.recent_leaves) ? raw.recent_leaves : [],
      bankDetails: (raw.bank_details || bankRaw) ? {
        id: bankRaw?.id || raw.bank_details?.id,
        accountHolderName: bankRaw?.account_holder_name || raw.bank_details?.account_holder_name || '—',
        bankName: bankRaw?.bank_name || raw.bank_details?.bank_name || '—',
        accountNumber: bankRaw?.account_number
          ? bankRaw.account_number
          : (bankLoadError || bankRaw?.account_number_error || !bankRaw?.account_number)
            ? 'Unable to load the full account number. Please retry.'
            : '—',
        accountNumberError: !bankRaw?.account_number && Boolean(bankLoadError || bankRaw?.account_number_error || raw.bank_details),
        accountNumberLast4: bankRaw?.account_number_last4 || raw.bank_details?.account_number_last4 || '',
        ifscCode: bankRaw?.ifsc_code || raw.bank_details?.ifsc_code || '—',
        branchName: bankRaw?.branch_name || raw.bank_details?.branch_name || '—',
        branchCity: bankRaw?.branch_city || raw.bank_details?.branch_city || '—',
        branchState: bankRaw?.branch_state || raw.bank_details?.branch_state || '—',
        accountType: bankRaw?.account_type || raw.bank_details?.account_type || 'Savings',
        verificationStatus: bankRaw?.verification_status || raw.bank_details?.verification_status || 'Pending',
        adminRemarks: bankRaw?.admin_remarks || raw.bank_details?.admin_remarks || '',
        createdAt: bankRaw?.created_at || raw.bank_details?.created_at,
        updatedAt: bankRaw?.updated_at || raw.bank_details?.updated_at,
      } : null,
    });

  };

  const fetchEmployeeDetails = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    try {
      const [response, bankResponse] = await Promise.all([
        api.admin.getEmployee(employeeId),
        api.admin.getEmployeeBankDetails(employeeId).catch((err) => ({ error: err })),
      ]);
      if (response && response.success && response.data) {
        const bankLoadError = Boolean(bankResponse?.error) || Boolean(bankResponse?.data?.account_number_error);
        applyEmployeeData(response.data, bankResponse?.data || null, bankLoadError);
      } else {
        setError('Employee not found.');
      }
    } catch (err) {
      if (err.status === 404) {
        setError('Employee not found.');
      } else if (err.status === 403) {
        setError('Access denied. Administrator privileges required.');
      } else {
        setError(err.message || 'Failed to load employee details.');
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    let ignore = false;
    if (!employeeId) return;

    Promise.all([
      api.admin.getEmployee(employeeId),
      api.admin.getEmployeeBankDetails(employeeId).catch((err) => ({ error: err })),
    ])
      .then(([response, bankResponse]) => {
        if (ignore) return;
        if (response && response.success && response.data) {
          const bankLoadError = Boolean(bankResponse?.error) || Boolean(bankResponse?.data?.account_number_error);
          applyEmployeeData(response.data, bankResponse?.data || null, bankLoadError);
        } else {
          setError('Employee not found.');
        }
      })
      .catch((err) => {
        if (ignore) return;
        if (err.status === 404) {
          setError('Employee not found.');
        } else if (err.status === 403) {
          setError('Access denied. Administrator privileges required.');
        } else {
          setError(err.message || 'Failed to load employee details.');
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [employeeId]);

  // Navigate to dedicated multi-step edit page
  const handleOpenEditModal = () => {
    navigate(`/admin/employees/${employeeId}/edit`);
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  // Save changes
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setEditError('');
    setSubmittingEdit(true);
    try {
      const payload = {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName ? editForm.lastName.trim() : '',
        email: editForm.email.trim().toLowerCase(),
        phone: editForm.phone ? editForm.phone.replace(/\D/g, '').slice(-10) : undefined,
        department: editForm.department,
        designation: editForm.designation ? editForm.designation.trim() : '',
        employmentType: editForm.employmentType,
        reportingManager: editForm.reportingManager ? editForm.reportingManager.trim() : null,
        city: editForm.workLocation || 'Hyderabad',
      };
      const res = await api.admin.updateEmployee(employeeId, payload);
      if (res && res.success) {
        if (editForm.employmentStatus && editForm.employmentStatus.toUpperCase() !== employee.status.toUpperCase()) {
          await api.admin.updateEmployeeStatus(
            employeeId,
            editForm.employmentStatus.toUpperCase(),
            'Status updated via Employee Profile edit'
          );
        }
        showToast(`Employee ${employeeId} updated successfully.`);
        setIsEditModalOpen(false);
        fetchEmployeeDetails();
      } else {
        setEditError(res?.message || 'Failed to update employee profile.');
      }
    } catch (err) {
      setEditError(err.message || 'An error occurred while saving employee.');
    } finally {
      setSubmittingEdit(false);
    }
  };

  // Toggle deactivation
  const handleConfirmDeactivate = async () => {
    if (!employee) return;
    setSubmittingStatus(true);
    const targetStatus = employee.status === 'Active' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await api.admin.updateEmployeeStatus(
        employeeId,
        targetStatus,
        `Status changed to ${targetStatus} from Employee Details view`
      );
      if (res && res.success) {
        showToast(`Employee status updated to ${targetStatus}.`);
        setIsDeactivateModalOpen(false);
        fetchEmployeeDetails();
      } else {
        showToast(res?.message || 'Failed to change employee status.');
      }
    } catch (err) {
      showToast(err.message || 'An error occurred while updating status.');
    } finally {
      setSubmittingStatus(false);
    }
  };

  // View document handler
  const handleViewDocument = (doc) => {
    if (!doc.isFileAvailable) {
      showToast(`Document "${doc.fileName}" is unavailable in physical storage.`);
      return;
    }
    setPreviewDoc(doc);
  };

  // Download document handler
  const handleDownloadDocument = async (doc) => {
    if (!doc.isFileAvailable) {
      showToast(`Document "${doc.fileName}" is unavailable in physical storage.`);
      return;
    }
    try {
      const blob = await api.admin.downloadDocument(doc.id, employeeId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', doc.fileName || `${doc.name}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showToast(`Downloaded "${doc.fileName}" successfully.`);
    } catch (err) {
      showToast(err.message || 'Failed to download document.');
    }
  };

  // Delete document handlers
  const handleOpenDeleteModal = (doc) => {
    setDocToDelete(doc);
    setDeleteError('');
  };

  const handleCloseDeleteModal = () => {
    if (submittingDelete) return;
    setDocToDelete(null);
    setDeleteError('');
  };

  const handleConfirmDelete = async () => {
    if (!docToDelete || !docToDelete.id) return;
    setSubmittingDelete(true);
    setDeleteError('');
    try {
      const res = await api.admin.deleteDocument(docToDelete.id, employeeId);
      if (res && res.success) {
        showToast('Document deleted successfully.');
        if (previewDoc?.id === docToDelete.id) {
          setPreviewDoc(null);
        }
        setDocToDelete(null);
        await fetchEmployeeDetails();
      } else {
        setDeleteError(res?.message || 'Failed to delete document.');
      }
    } catch (err) {
      setDeleteError(err.message || 'An error occurred while deleting the document.');
    } finally {
      setSubmittingDelete(false);
    }
  };

  // Upload document submit handler
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError('Please select a file to upload.');
      return;
    }
    setSubmittingUpload(true);
    setUploadError('');
    try {
      const finalDocType = uploadDocType === 'Other'
        ? (uploadCustomType.trim() || 'Other Document')
        : uploadDocType;
      const formData = new FormData();
      formData.append('employee_id', employeeId);
      formData.append('document_type', finalDocType);
      formData.append('file', uploadFile);

      const res = await api.admin.uploadDocument(formData);
      if (res && res.success) {
        showToast('Document uploaded successfully.');
        setIsUploadModalOpen(false);
        setUploadFile(null);
        setUploadCustomType('');
        setUploadDocType('Offer Letter');
        fetchEmployeeDetails();
      } else {
        setUploadError(res?.message || 'Failed to upload document.');
      }
    } catch (err) {
      setUploadError(err.message || 'An error occurred while uploading.');
    } finally {
      setSubmittingUpload(false);
    }
  };

  // Mapped documents and filters
  const mappedDocs = useMemo(() => {
    return employee?.documents || [];
  }, [employee?.documents]);

  const filteredDocs = useMemo(() => {
    return mappedDocs.filter((doc) => {
      if (activeDocCategory !== 'all' && doc.category !== activeDocCategory) {
        return false;
      }
      if (docSearchQuery.trim()) {
        const q = docSearchQuery.trim().toLowerCase();
        const matchName = (doc.name || '').toLowerCase().includes(q);
        const matchFile = (doc.fileName || '').toLowerCase().includes(q);
        const matchType = (doc.type || '').toLowerCase().includes(q);
        if (!matchName && !matchFile && !matchType) return false;
      }
      return true;
    });
  }, [mappedDocs, activeDocCategory, docSearchQuery]);

  const availableCategoryIds = useMemo(() => {
    const set = new Set();
    mappedDocs.forEach((d) => set.add(d.category));
    return set;
  }, [mappedDocs]);

  const groupedSections = useMemo(() => {
    const order = ['employment', 'identity', 'statutory', 'payslip', 'other'];
    const sections = [];
    order.forEach((catId) => {
      const docsInCat = filteredDocs.filter((d) => d.category === catId);
      if (docsInCat.length > 0) {
        sections.push({
          id: catId,
          title: SECTION_CONFIG[catId]?.title || 'Documents',
          docs: docsInCat,
        });
      }
    });
    return sections;
  }, [filteredDocs]);

  // Avatar initials
  const initials = employee && employee.firstName && employee.lastName
    ? `${employee.firstName[0]}${employee.lastName[0]}`.toUpperCase()
    : (employee?.firstName?.[0] || employee?.employeeId?.[0] || 'EM').toUpperCase();

  return (
    <div className="admin-employee-details-page">
      {/* ====================================================================
          PAGE HEADER
          ==================================================================== */}
      <header className="admin-details-page-header">
        <div className="admin-details-header-left">
          <button
            type="button"
            className="admin-back-link-btn"
            onClick={() => navigate('/admin/employees')}
            aria-label="Back to Employees list"
          >
            <svg
              className="admin-back-arrow"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>&larr; Back to Employees</span>
          </button>

          <div className="admin-details-title-wrap">
            <h1 className="admin-details-page-title">Employee Details</h1>
            <p className="admin-details-page-subtitle">
              View and manage employee information.
            </p>
          </div>
        </div>

        {employee && (
          <div className="admin-details-header-right">
            <button
              type="button"
              className="admin-btn-primary admin-edit-header-btn"
              onClick={handleOpenEditModal}
            >
              <svg
                className="admin-btn-icon-svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>Edit Employee</span>
            </button>
          </div>
        )}
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-details-toast" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <section className="admin-card" style={{ padding: '3.5rem 1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1.125rem', fontWeight: 600, color: '#1e293b', margin: 0 }}>
            Loading employee details...
          </p>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.5rem' }}>
            Fetching record for {employeeId}
          </p>
        </section>
      )}

      {/* Error state */}
      {error && !loading && (
        <section className="admin-card" style={{ padding: '3.5rem 1.5rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1.125rem', fontWeight: 600, color: '#dc2626', margin: 0 }}>
            {error}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => navigate('/admin/employees')}
            >
              Back to Employees
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={fetchEmployeeDetails}
            >
              Retry
            </button>
          </div>
        </section>
      )}

      {/* Employee Data Sections */}
      {employee && !loading && (
        <>
          {/* ====================================================================
              EMPLOYEE HEADER CARD
              ==================================================================== */}
          <section className="admin-card admin-summary-header-card" aria-label="Employee Summary">
            <div className="admin-summary-avatar-circle" aria-hidden="true">
              {initials}
            </div>

        <div className="admin-summary-content">
          <div className="admin-summary-title-row">
            <div className="admin-summary-name-group">
              <h2 className="admin-summary-name">{employee.name}</h2>
              <span className="admin-id-badge">{employee.employeeId}</span>
            </div>

            <span className={`admin-status-badge status-${employee.status.toLowerCase()}`}>
              <span className="status-dot" aria-hidden="true"></span>
              {employee.status}
            </span>
          </div>

          <div className="admin-summary-roles">
            <span className="admin-summary-designation">{employee.designation}</span>
            <span className="admin-summary-bullet">&bull;</span>
            <span className="admin-summary-department">
              {employee.department}
              {employee.department && !['IT', 'Non-IT'].includes(employee.department) && (
                <span style={{ marginLeft: '0.35rem', color: '#b45309', fontWeight: 600 }}> (Legacy)</span>
              )}
            </span>
          </div>

          <div className="admin-summary-contact-row">
            <div className="admin-summary-contact-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span>{employee.email}</span>
            </div>

            <div className="admin-summary-contact-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>{employee.phone}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          TWO-COLUMN INFO GRID (Section 1: Personal, Section 2: Employment)
          ==================================================================== */}
      <div className="admin-details-sections-grid">
        {/* SECTION 1 — PERSONAL INFORMATION */}
        <section className="admin-card admin-info-card" aria-labelledby="personal-info-heading">
          <div className="admin-card-header">
            <h2 id="personal-info-heading" className="admin-card-title">Personal Information</h2>
          </div>

          <div className="admin-info-fields-grid">
            <div className="admin-info-field">
              <span className="admin-info-label">Full Name</span>
              <span className="admin-info-value">{employee.name}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Email Address</span>
              <span className="admin-info-value">{employee.email}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Phone</span>
              <span className="admin-info-value">{employee.phone}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Date of Birth</span>
              <span className="admin-info-value">{employee.dob}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Gender</span>
              <span className="admin-info-value">{employee.gender}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Emergency Contact</span>
              <span className="admin-info-value">{employee.emergencyContact}</span>
            </div>

            <div className="admin-info-field admin-field-full">
              <span className="admin-info-label">Address</span>
              <span className="admin-info-value">{employee.address}</span>
            </div>
          </div>
        </section>

        {/* SECTION 2 — EMPLOYMENT INFORMATION */}
        <section className="admin-card admin-info-card" aria-labelledby="employment-info-heading">
          <div className="admin-card-header">
            <h2 id="employment-info-heading" className="admin-card-title">Employment Information</h2>
          </div>

          <div className="admin-info-fields-grid">
            <div className="admin-info-field">
              <span className="admin-info-label">Employee ID</span>
              <span className="admin-info-value font-mono">{employee.employeeId}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Department</span>
              <span className="admin-info-value">
                {employee.department}
                {employee.department && !['IT', 'Non-IT'].includes(employee.department) && (
                  <span style={{ marginLeft: '0.4rem', color: '#b45309', fontWeight: 600, fontSize: '0.8125rem' }}> (Legacy)</span>
                )}
              </span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Designation</span>
              <span className="admin-info-value">{employee.designation}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Employment Type</span>
              <span className="admin-info-value">{employee.employmentType}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Date of Joining</span>
              <span className="admin-info-value">{employee.dateOfJoining}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Work Location</span>
              <span className="admin-info-value">{employee.workLocation}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Reporting Manager</span>
              <span className="admin-info-value">{employee.reportingManager}</span>
            </div>

            <div className="admin-info-field">
              <span className="admin-info-label">Employment Status</span>
              <span className="admin-info-value">
                <span className={`admin-status-badge status-${employee.status.toLowerCase()}`}>
                  <span className="status-dot" aria-hidden="true"></span>
                  {employee.status}
                </span>
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* ====================================================================
          SECTION 3 — DOCUMENTS SUMMARY
          ==================================================================== */}
      <section className="admin-card admin-documents-card" aria-labelledby="documents-heading">
        <div className="admin-card-header">
          <div>
            <h2 id="documents-heading" className="admin-card-title">Employee Documents</h2>
            <p className="admin-card-subtitle">Official documents and employment records</p>
          </div>
          <button
            type="button"
            className="admin-btn-secondary admin-btn-sm"
            onClick={() => {
              setUploadError('');
              setUploadFile(null);
              setIsUploadModalOpen(true);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Upload Document</span>
          </button>
        </div>

        {employee.documents && employee.documents.length > 0 ? (
          <>
            {/* Toolbar: Search & Category Filter Pills */}
            <div className="admin-docs-toolbar">
              <div className="admin-docs-search-wrapper">
                <svg
                  className="admin-docs-search-icon"
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
                  className="admin-docs-search-input"
                  placeholder="Search by title, filename, or type..."
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  aria-label="Search employee documents"
                />
                {docSearchQuery && (
                  <button
                    type="button"
                    className="admin-docs-search-clear"
                    onClick={() => setDocSearchQuery('')}
                    aria-label="Clear document search"
                  >
                    &times;
                  </button>
                )}
              </div>

              <div className="admin-docs-category-filters" role="tablist" aria-label="Filter documents by category">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDocCategory === 'all'}
                  className={`admin-docs-filter-btn ${activeDocCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveDocCategory('all')}
                >
                  All
                  <span className="admin-docs-pill-count">{employee.documents.length}</span>
                </button>
                {CATEGORY_TABS.filter((cat) => cat.id !== 'all' && availableCategoryIds.has(cat.id)).map((cat) => {
                  const count = employee.documents.filter((d) => d.category === cat.id).length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="tab"
                      aria-selected={activeDocCategory === cat.id}
                      className={`admin-docs-filter-btn ${activeDocCategory === cat.id ? 'active' : ''}`}
                      onClick={() => setActiveDocCategory(cat.id)}
                    >
                      {cat.label}
                      <span className="admin-docs-pill-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Grouped Sections */}
            {groupedSections.length > 0 ? (
              <div className="documents-sections-wrapper" style={{ marginTop: '0.25rem' }}>
                {groupedSections.map((section) => (
                  <section key={section.id} className="admin-doc-category-group" aria-labelledby={`sec-title-${section.id}`}>
                    <div className="admin-category-header">
                      <h3 id={`sec-title-${section.id}`} className="admin-category-title">
                        {section.title}
                      </h3>
                      <span className="admin-category-count">
                        {section.docs.length} {section.docs.length === 1 ? 'Document' : 'Documents'}
                      </span>
                    </div>

                    <div className="admin-docs-grid">
                      {section.docs.map((doc) => (
                        <DocumentCardItem
                          key={doc.id}
                          doc={doc}
                          onView={handleViewDocument}
                          onDownload={handleDownloadDocument}
                          onDelete={handleOpenDeleteModal}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="text-muted" style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
                <p style={{ margin: 0, fontWeight: 500, color: '#475569' }}>
                  No documents match "{docSearchQuery}"{activeDocCategory !== 'all' ? ` in ${activeDocCategory}` : ''}.
                </p>
                <button
                  type="button"
                  className="admin-btn-secondary admin-btn-sm"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => {
                    setDocSearchQuery('');
                    setActiveDocCategory('all');
                  }}
                >
                  Clear Search & Filters
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="admin-docs-empty-state">
            <div className="admin-docs-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3 className="admin-docs-empty-title">No documents uploaded</h3>
            <p className="admin-docs-empty-desc">
              There are currently no official documents uploaded for this employee.
            </p>
            <button
              type="button"
              className="admin-btn-primary admin-btn-sm"
              onClick={() => {
                setUploadError('');
                setUploadFile(null);
                setIsUploadModalOpen(true);
              }}
              style={{ marginTop: '0.75rem' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Upload First Document</span>
            </button>
          </div>
        )}
      </section>

      {/* ====================================================================
          TWO-COLUMN GRID: Section 4 (PF Details) & Section 5 (Leave Summary)
          ==================================================================== */}
      <div className="admin-details-sections-grid">
        {/* SECTION 4 — PF DETAILS */}
        <section className="admin-card admin-pf-card" aria-labelledby="pf-heading">
          <div className="admin-card-header">
            <div>
              <h2 id="pf-heading" className="admin-card-title">Provident Fund Details</h2>
              <p className="admin-card-subtitle">Statutory EPF & contribution overview</p>
            </div>
            <button
              type="button"
              className="admin-btn-secondary admin-btn-sm"
              onClick={() => navigate('/admin/pf')}
            >
              View PF Details &rarr;
            </button>
          </div>

          <div className="admin-pf-stats-grid">
            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Universal Account No (UAN)</span>
              <span className="admin-pf-stat-val font-mono">{employee.pf.uan}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">PF Account Number</span>
              <span className="admin-pf-stat-val font-mono">{employee.pf.pfNumber}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Employer Contribution</span>
              <span className="admin-pf-stat-val text-primary">{employee.pf.employerContribution}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Employee Contribution</span>
              <span className="admin-pf-stat-val text-primary">{employee.pf.employeeContribution}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Pension Number (EPS)</span>
              <span className="admin-pf-stat-val font-mono">{employee.pf.pensionNumber}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">PF Status</span>
              <span className="admin-pf-stat-val">
                <span className={`admin-status-badge ${employee.pf.pfStatus === 'Active' || employee.pf.pfStatus === 'Configured' ? 'status-active' : 'status-neutral'}`}>
                  <span className="status-dot" aria-hidden="true"></span>
                  {employee.pf.pfStatus}
                </span>
              </span>
            </div>
          </div>
        </section>

        {/* SECTION 5 — LEAVE SUMMARY */}
        <section className="admin-card admin-leaves-card" aria-labelledby="leaves-heading">
          <div className="admin-card-header">
            <div>
              <h2 id="leaves-heading" className="admin-card-title">Leave Summary</h2>
              <p className="admin-card-subtitle">Annual allocations & balance</p>
            </div>
            <button
              type="button"
              className="admin-btn-secondary admin-btn-sm"
              onClick={() => navigate('/admin/leaves')}
            >
              Manage Leaves &rarr;
            </button>
          </div>

          <div className="admin-leave-cards-container">
            {/* Paid Leave (PL) */}
            <div className="admin-leave-subcard subcard-blue">
              <div className="admin-leave-subcard-header">
                <span className="admin-leave-type-name">Paid Leave (PL)</span>
                <span className="admin-leave-remaining-pill">
                  {employee.leaveSummary.pl.remaining} Left
                </span>
              </div>
              <div className="admin-leave-subcard-metrics">
                <div className="admin-leave-metric">
                  <span className="metric-val">{employee.leaveSummary.pl.total}</span>
                  <span className="metric-lbl">Total</span>
                </div>
                <div className="admin-leave-metric">
                  <span className="metric-val">{employee.leaveSummary.pl.used}</span>
                  <span className="metric-lbl">Used</span>
                </div>
                <div className="admin-leave-metric">
                  <span className="metric-val text-success">
                    {employee.leaveSummary.pl.remaining}
                  </span>
                  <span className="metric-lbl">Remaining</span>
                </div>
              </div>
            </div>

            {/* Sick Leave */}
            <div className="admin-leave-subcard subcard-green">
              <div className="admin-leave-subcard-header">
                <span className="admin-leave-type-name">Sick Leave</span>
                <span className="admin-leave-remaining-pill">
                  {employee.leaveSummary.sick.remaining} Left
                </span>
              </div>
              <div className="admin-leave-subcard-metrics">
                <div className="admin-leave-metric">
                  <span className="metric-val">{employee.leaveSummary.sick.total}</span>
                  <span className="metric-lbl">Total</span>
                </div>
                <div className="admin-leave-metric">
                  <span className="metric-val">{employee.leaveSummary.sick.used}</span>
                  <span className="metric-lbl">Used</span>
                </div>
                <div className="admin-leave-metric">
                  <span className="metric-val text-success">
                    {employee.leaveSummary.sick.remaining}
                  </span>
                  <span className="metric-lbl">Remaining</span>
                </div>
              </div>
            </div>

            {/* Unpaid Leave (UPL) */}
            <div className="admin-leave-subcard subcard-amber">
              <div className="admin-leave-subcard-header">
                <span className="admin-leave-type-name">Unpaid Leave (UPL)</span>
                <span className="admin-leave-upl-badge">Loss of Pay</span>
              </div>
              <div className="admin-leave-subcard-metrics single-metric">
                <div className="admin-leave-metric">
                  <span className="metric-val text-amber">{employee.leaveSummary.upl.used}</span>
                  <span className="metric-lbl">Total Days Used</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ====================================================================
          SECTION 5B — SALARY BANK DETAILS
          ==================================================================== */}
      <section className="admin-card admin-bank-card" aria-labelledby="bank-heading" style={{ marginBottom: '1.5rem' }}>
        <div className="admin-card-header">
          <div>
            <h2 id="bank-heading" className="admin-card-title">Salary Bank Details</h2>
            <p className="admin-card-subtitle">Employee salary disbursement account & verification review</p>
          </div>
          {employee.bankDetails && (
            <button
              type="button"
              className="admin-btn-secondary admin-btn-sm"
              onClick={handleOpenBankVerifyModal}
              id="admin-review-bank-btn"
            >
              Review / Verify Status &rarr;
            </button>
          )}
        </div>

        {employee.bankDetails ? (
          <div className="admin-pf-stats-grid">
            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Account Holder Name</span>
              <span className="admin-pf-stat-val">{employee.bankDetails.accountHolderName}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Bank Name</span>
              <span className="admin-pf-stat-val font-semibold">{employee.bankDetails.bankName}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Account Number</span>
              {employee.bankDetails.accountNumberError ? (
                <span className="admin-pf-stat-val font-mono" style={{ color: '#ef4444', fontSize: '0.875rem' }}>
                  {employee.bankDetails.accountNumber}
                </span>
              ) : (
                <span className="admin-pf-stat-val font-mono">{employee.bankDetails.accountNumber}</span>
              )}
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">IFSC Code</span>
              <span className="admin-pf-stat-val font-mono uppercase">{employee.bankDetails.ifscCode}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Account Type</span>
              <span className="admin-pf-stat-val">{employee.bankDetails.accountType}</span>
            </div>

            <div className="admin-pf-stat-box">
              <span className="admin-pf-stat-label">Branch</span>
              <span className="admin-pf-stat-val">
                {[employee.bankDetails.branchName, employee.bankDetails.branchCity, employee.bankDetails.branchState]
                  .filter((x) => x && x !== '—')
                  .join(', ') || '—'}
              </span>
            </div>

            <div className="admin-pf-stat-box admin-field-full">
              <span className="admin-pf-stat-label">Verification Status</span>
              <span className="admin-pf-stat-val">
                <span
                  className={`admin-status-badge ${
                    employee.bankDetails.verificationStatus === 'Verified'
                      ? 'status-active'
                      : employee.bankDetails.verificationStatus === 'Rejected'
                      ? 'status-inactive'
                      : 'status-pending'
                  }`}
                >
                  <span className="status-dot" aria-hidden="true"></span>
                  {employee.bankDetails.verificationStatus}
                </span>
                {employee.bankDetails.adminRemarks && (
                  <span style={{ marginLeft: '0.75rem', fontSize: '0.8125rem', color: '#64748b' }}>
                    Remarks: {employee.bankDetails.adminRemarks}
                  </span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-muted" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
            No bank details submitted by this employee yet.
          </div>
        )}
      </section>


      {/* ====================================================================
          SECTION 6 — RECENT LEAVE REQUESTS
          ==================================================================== */}
      <section className="admin-card admin-recent-leaves-table-card" aria-labelledby="recent-leaves-heading">
        <div className="admin-card-header">
          <div>
            <h2 id="recent-leaves-heading" className="admin-card-title">Recent Leave Requests</h2>
            <p className="admin-card-subtitle">Leave applications submitted by this employee</p>
          </div>
          <button
            type="button"
            className="admin-btn-secondary admin-btn-sm"
            onClick={() => navigate('/admin/leaves')}
          >
            View All Leaves &rarr;
          </button>
        </div>

        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Leave Type</th>
                <th scope="col">Dates</th>
                <th scope="col">Days</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {employee.recentLeaves && employee.recentLeaves.length > 0 ? (
                employee.recentLeaves.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <span className="admin-leave-type-name-strong">{req.type}</span>
                    </td>
                    <td className="text-muted">{req.dates}</td>
                    <td>
                      <span className="admin-days-pill">{req.days} {req.days === 1 ? 'Day' : 'Days'}</span>
                    </td>
                    <td>
                      <span className={`admin-status-badge status-${req.status.toLowerCase()}`}>
                        <span className="status-dot" aria-hidden="true"></span>
                        {req.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" className="text-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                    No recent leave requests found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ====================================================================
          SECTION 7 — ADMIN ACTIONS
          ==================================================================== */}
      <section className="admin-card admin-actions-card" aria-labelledby="employee-actions-heading">
        <div className="admin-card-header">
          <div>
            <h2 id="employee-actions-heading" className="admin-card-title">Employee Actions</h2>
            <p className="admin-card-subtitle">Quick administration tools for this employee</p>
          </div>
        </div>

        <div className="admin-action-buttons-wrap">
          <button
            type="button"
            className="admin-action-trigger-btn btn-action-primary"
            onClick={handleOpenEditModal}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>Edit Employee</span>
          </button>

          <button
            type="button"
            className="admin-action-trigger-btn btn-action-neutral"
            onClick={() => setIsUploadModalOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Upload Document</span>
          </button>

          <button
            type="button"
            className="admin-action-trigger-btn btn-action-neutral"
            onClick={() => navigate('/admin/pf')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
              <line x1="7" y1="15" x2="7.01" y2="15" />
              <line x1="11" y1="15" x2="13" y2="15" />
            </svg>
            <span>Update PF Details</span>
          </button>

          <button
            type="button"
            className="admin-action-trigger-btn btn-action-neutral"
            onClick={() => navigate('/admin/leaves')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>Manage Leaves</span>
          </button>

          <button
            type="button"
            className="admin-action-trigger-btn btn-action-danger"
            onClick={() => setIsDeactivateModalOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <span>{employee.status === 'Active' ? 'Deactivate Employee' : 'Activate Employee'}</span>
          </button>
        </div>
      </section>
        </>
      )}

      {/* ====================================================================
          EDIT EMPLOYEE MODAL (UI-only)
          ==================================================================== */}
      {isEditModalOpen && employee && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Edit Employee ({employee.employeeId})</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsEditModalOpen(false)}
                aria-label="Close edit modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="admin-modal-form">
              {editError && (
                <div
                  role="alert"
                  style={{
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '0.375rem',
                    color: '#991b1b',
                    fontSize: '0.875rem',
                  }}
                >
                  {editError}
                </div>
              )}
              <div className="admin-form-grid">
                {/* First Name */}
                <div className="admin-form-field">
                  <label htmlFor="editFirstName" className="admin-field-label">
                    First Name <span className="text-required">*</span>
                  </label>
                  <input
                    id="editFirstName"
                    name="firstName"
                    type="text"
                    required
                    className="admin-field-input"
                    value={editForm.firstName}
                    onChange={handleEditChange}
                  />
                </div>

                {/* Last Name */}
                <div className="admin-form-field">
                  <label htmlFor="editLastName" className="admin-field-label">Last Name</label>
                  <input
                    id="editLastName"
                    name="lastName"
                    type="text"
                    className="admin-field-input"
                    value={editForm.lastName}
                    onChange={handleEditChange}
                  />
                </div>

                {/* Email */}
                <div className="admin-form-field">
                  <label htmlFor="editEmail" className="admin-field-label">
                    Email <span className="text-required">*</span>
                  </label>
                  <input
                    id="editEmail"
                    name="email"
                    type="email"
                    required
                    className="admin-field-input"
                    value={editForm.email}
                    onChange={handleEditChange}
                  />
                </div>

                {/* Phone */}
                <div className="admin-form-field">
                  <label htmlFor="editPhone" className="admin-field-label">Phone</label>
                  <input
                    id="editPhone"
                    name="phone"
                    type="tel"
                    className="admin-field-input"
                    value={editForm.phone}
                    onChange={handleEditChange}
                  />
                </div>

                {/* Department */}
                <div className="admin-form-field">
                  <label htmlFor="editDepartment" className="admin-field-label">Department</label>
                  <select
                    id="editDepartment"
                    name="department"
                    className="admin-field-select"
                    value={editForm.department}
                    onChange={handleEditChange}
                  >
                    {editForm.department && !['IT', 'Non-IT'].includes(editForm.department) && (
                      <option value={editForm.department}>{editForm.department} (Legacy)</option>
                    )}
                    <option value="IT">IT</option>
                    <option value="Non-IT">Non-IT</option>
                  </select>
                </div>

                {/* Designation */}
                <div className="admin-form-field">
                  <label htmlFor="editDesignation" className="admin-field-label">Designation <span className="required" style={{ color: '#dc2626', marginLeft: '2px' }}>*</span></label>
                  <select
                    id="editDesignation"
                    name="designation"
                    required
                    className="admin-field-select"
                    value={editForm.designation}
                    onChange={handleEditChange}
                  >
                    <option value="">Select Designation</option>
                    <option value="Associate Software Engineer">Associate Software Engineer</option>
                    <option value="Associate">Associate</option>
                  </select>
                </div>

                {/* Joining Date */}
                <div className="admin-form-field">
                  <label htmlFor="editJoiningDate" className="admin-field-label">Joining Date</label>
                  <input
                    id="editJoiningDate"
                    name="joiningDate"
                    type="text"
                    className="admin-field-input"
                    value={editForm.joiningDate}
                    onChange={handleEditChange}
                  />
                </div>

                {/* Employment Type */}
                <div className="admin-form-field">
                  <label htmlFor="editEmploymentType" className="admin-field-label">Employment Type</label>
                  <select
                    id="editEmploymentType"
                    name="employmentType"
                    className="admin-field-select"
                    value={editForm.employmentType}
                    onChange={handleEditChange}
                  >
                    <option value="Full Time">Full Time</option>
                    <option value="Contract">Contract</option>
                    <option value="Intern">Intern</option>
                    <option value="Part Time">Part Time</option>
                  </select>
                </div>

                {/* Work Location */}
                <div className="admin-form-field">
                  <label htmlFor="editWorkLocation" className="admin-field-label">Work Location</label>
                  <select
                    id="editWorkLocation"
                    name="workLocation"
                    className="admin-field-select"
                    value={editForm.workLocation}
                    onChange={handleEditChange}
                  >
                    <option value="Hyderabad">Hyderabad</option>
                    <option value="Bangalore">Bangalore</option>
                    <option value="Mumbai">Mumbai</option>
                    <option value="Pune">Pune</option>
                    <option value="Remote">Remote</option>
                  </select>
                </div>

                {/* Reporting Manager */}
                <div className="admin-form-field">
                  <label htmlFor="editReportingManager" className="admin-field-label">Reporting Manager</label>
                  <input
                    id="editReportingManager"
                    name="reportingManager"
                    type="text"
                    className="admin-field-input"
                    value={editForm.reportingManager}
                    onChange={handleEditChange}
                  />
                </div>

                {/* Employment Status */}
                <div className="admin-form-field admin-field-full">
                  <label htmlFor="editEmploymentStatus" className="admin-field-label">Employment Status</label>
                  <select
                    id="editEmploymentStatus"
                    name="employmentStatus"
                    className="admin-field-select"
                    value={editForm.employmentStatus}
                    onChange={handleEditChange}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={submittingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn-primary"
                  disabled={submittingEdit}
                >
                  {submittingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          DEACTIVATE CONFIRMATION MODAL (UI-only)
          ==================================================================== */}
      {isDeactivateModalOpen && employee && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-confirm-modal">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">
                {employee.status === 'Active' ? 'Deactivate Employee' : 'Activate Employee'}
              </h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsDeactivateModalOpen(false)}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body">
              <div className="admin-confirm-icon-wrap" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="admin-confirm-message">
                Are you sure you want to {employee.status === 'Active' ? 'deactivate' : 'activate'} this employee?
              </p>
              <p className="admin-confirm-subtext">
                Employee: <strong>{employee.name}</strong> ({employee.employeeId})
              </p>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setIsDeactivateModalOpen(false)}
                disabled={submittingStatus}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`admin-btn ${
                  employee.status === 'Active' ? 'admin-btn-danger' : 'admin-btn-primary'
                }`}
                onClick={handleConfirmDeactivate}
                disabled={submittingStatus}
              >
                {submittingStatus ? 'Updating...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          UPLOAD DOCUMENT MODAL
          ==================================================================== */}
      {isUploadModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title">
          <div className="admin-modal-container" style={{ maxWidth: '520px' }}>
            <div className="admin-modal-header">
              <h2 id="upload-modal-title" className="admin-modal-title">Upload Employee Document</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsUploadModalOpen(false)}
                aria-label="Close dialog"
                disabled={submittingUpload}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="admin-modal-form">
              {uploadError && (
                <div style={{ padding: '0.625rem 0.875rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '1rem' }}>
                  {uploadError}
                </div>
              )}

              <div className="admin-form-field">
                <label htmlFor="uploadDocTypeSelect" className="admin-field-label">
                  Document Type <span className="text-required">*</span>
                </label>
                <select
                  id="uploadDocTypeSelect"
                  className="admin-field-select"
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value)}
                  disabled={submittingUpload}
                >
                  <optgroup label="Employment Documents">
                    <option value="Offer Letter">Offer Letter</option>
                    <option value="Appointment Letter">Appointment Letter</option>
                    <option value="Relieving Letter">Relieving Letter</option>
                    <option value="Experience Certificate">Experience Certificate</option>
                    <option value="FnF Statement">FnF Statement</option>
                  </optgroup>
                  <optgroup label="Identity & Personal">
                    <option value="Aadhaar Card">Aadhaar Card</option>
                    <option value="PAN Card">PAN Card</option>
                    <option value="Passport">Passport</option>
                    <option value="Profile Photo">Profile Photo</option>
                  </optgroup>
                  <optgroup label="PF & Statutory">
                    <option value="PF Document">PF Document</option>
                    <option value="Form 16">Form 16</option>
                  </optgroup>
                  <optgroup label="Other">
                    <option value="Educational Certificate">Educational Certificate</option>
                    <option value="Payslip">Payslip</option>
                    <option value="Other">Other Document...</option>
                  </optgroup>
                </select>
              </div>

              {uploadDocType === 'Other' && (
                <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                  <label htmlFor="customDocTitle" className="admin-field-label">
                    Custom Document Title <span className="text-required">*</span>
                  </label>
                  <input
                    id="customDocTitle"
                    type="text"
                    required
                    placeholder="e.g. Training Completion Certificate"
                    className="admin-field-input"
                    value={uploadCustomType}
                    onChange={(e) => setUploadCustomType(e.target.value)}
                    disabled={submittingUpload}
                  />
                </div>
              )}

              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label htmlFor="docFileInput" className="admin-field-label">
                  Select File (PDF, PNG, JPG) <span className="text-required">*</span>
                </label>
                <input
                  id="docFileInput"
                  type="file"
                  required
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="admin-field-input"
                  style={{ paddingTop: '0.45rem' }}
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  disabled={submittingUpload}
                />
                <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                  Supported formats: PDF, PNG, JPG, JPEG (Max: 10MB)
                </span>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setIsUploadModalOpen(false)}
                  disabled={submittingUpload}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn-primary"
                  disabled={submittingUpload}
                >
                  {submittingUpload ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          GENUINE DOCUMENT PREVIEW MODAL
          ==================================================================== */}
      {previewDoc && (
        <DocumentPreviewModal
          doc={previewDoc}
          employeeId={employeeId}
          onClose={() => setPreviewDoc(null)}
          onDownload={handleDownloadDocument}
        />
      )}

      {/* ====================================================================
          DELETE DOCUMENT CONFIRMATION MODAL
          ==================================================================== */}
      {docToDelete && (
        <div
          className="admin-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-doc-modal-title"
        >
          <div className="admin-modal-container admin-confirm-modal" style={{ maxWidth: '460px' }}>
            <div className="admin-modal-header">
              <h2 id="delete-doc-modal-title" className="admin-modal-title">
                Delete Document?
              </h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={handleCloseDeleteModal}
                disabled={submittingDelete}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>

            <div className="admin-confirm-body">
              <div
                className="admin-confirm-icon-wrap"
                style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </div>
              <p className="admin-confirm-message">
                Are you sure you want to permanently delete this document? This action cannot be undone.
              </p>
              <p className="admin-confirm-subtext">
                Document: <strong>{docToDelete.name}</strong> ({docToDelete.fileName})
              </p>
              {deleteError && (
                <div
                  style={{
                    marginTop: '0.875rem',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '0.375rem',
                    color: '#b91c1c',
                    fontSize: '0.8125rem',
                    textAlign: 'left',
                  }}
                >
                  {deleteError}
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={handleCloseDeleteModal}
                disabled={submittingDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={handleConfirmDelete}
                disabled={submittingDelete}
              >
                {submittingDelete ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BANK DETAILS VERIFICATION MODAL */}

      {isBankVerifyModalOpen && employee.bankDetails && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="bank-verify-modal-title">
          <div className="admin-modal-container" style={{ maxWidth: '480px' }}>
            <div className="admin-modal-header">
              <h2 id="bank-verify-modal-title" className="admin-modal-title">Review Bank Details</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsBankVerifyModalOpen(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleBankVerifySubmit}>
              <div className="admin-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '0.25rem' }}>Employee</div>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{employee.name} ({employee.employeeId})</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '0.25rem' }}>Bank & Account Number</div>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {employee.bankDetails.bankName} &bull;{' '}
                    <span
                      className="font-mono"
                      style={employee.bankDetails.accountNumberError ? { color: '#ef4444', fontSize: '0.875rem' } : {}}
                    >
                      {employee.bankDetails.accountNumber}
                    </span>
                  </div>
                </div>

                <div>
                  <label htmlFor="verification_status" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '0.375rem' }}>
                    Verification Status *
                  </label>
                  <select
                    id="verification_status"
                    className="admin-edit-input"
                    value={bankVerifyStatus}
                    onChange={(e) => setBankVerifyStatus(e.target.value)}
                  >
                    <option value="Verified">Verified</option>
                    <option value="Pending">Pending</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="admin_remarks" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '0.375rem' }}>
                    Admin Review Remarks
                  </label>
                  <textarea
                    id="admin_remarks"
                    className="admin-edit-input"
                    rows="3"
                    value={bankVerifyRemarks}
                    onChange={(e) => setBankVerifyRemarks(e.target.value)}
                    placeholder="Optional notes or rejection reasons"
                  />
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setIsBankVerifyModalOpen(false)}
                  disabled={submittingBankVerify}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn-primary"
                  disabled={submittingBankVerify}
                >
                  {submittingBankVerify ? 'Saving...' : 'Save Verification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

}

export default EmployeeDetails;
