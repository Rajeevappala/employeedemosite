import { useState, useMemo, useEffect } from 'react';
import api from '../../../services/api';
import './Documents.css';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'employment', label: 'Employment' },
  { id: 'payslip', label: 'Payslips' },
  { id: 'other', label: 'Other' },
];

const CATEGORY_TITLES = {
  employment: 'Employment Documents',
  payslip: 'Payslips',
  other: 'Other Documents',
};

/**
 * Categorizes a document type into one of the frontend filter categories.
 *
 * Employment: Offer Letter, Appointment Letter, Experience Letter, Relieving Letter
 * Payslips: Salary Slip, Payslip
 * Other: Everything else
 */
function determineCategory(documentType) {
  if (!documentType) return 'other';
  const lower = documentType.trim().toLowerCase();

  const employmentTypes = [
    'offer letter',
    'appointment letter',
    'experience letter',
    'relieving letter',
  ];
  if (employmentTypes.includes(lower)) {
    return 'employment';
  }

  const payslipTypes = ['salary slip', 'payslip'];
  if (payslipTypes.includes(lower) || lower.includes('payslip') || lower.includes('salary slip')) {
    return 'payslip';
  }

  return 'other';
}

/**
 * Formats an ISO created_at date string into a user-friendly format (e.g. 15 May 2025).
 */
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

/**
 * Maps backend document metadata to the frontend card model.
 */
function mapBackendDocument(doc) {
  return {
    id: doc.id,
    category: determineCategory(doc.document_type),
    name: doc.document_type || 'Document',
    fileName: doc.file_name || 'document.pdf',
    type: doc.document_type || 'Document',
    uploadedDate: formatUploadedDate(doc.created_at),
  };
}

// ============================================================================
// Document Card Component
// ============================================================================
function DocumentCardItem({ doc, onView, onDownload }) {
  return (
    <article className="document-card" aria-labelledby={`doc-title-${doc.id}`}>
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
          <span className="document-badge-ext">PDF</span>
        </div>

        <div className="document-text-container">
          <h3 id={`doc-title-${doc.id}`} className="document-title" title={doc.name}>
            {doc.name}
          </h3>
          <p className="document-filename">{doc.fileName}</p>
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
      </div>

      <div className="document-card-actions">
        <button
          type="button"
          className="document-btn document-btn-view"
          onClick={() => onView(doc)}
          aria-label={`View ${doc.name}`}
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
          onClick={() => onDownload(doc)}
          aria-label={`Download ${doc.name}`}
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
      </div>
    </article>
  );
}

// ============================================================================
// Document Preview Modal
// ============================================================================
function DocumentPreviewModal({ doc, onClose, onDownload }) {
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
        const blob = await api.employee.viewDocument(doc.id);
        if (isCancelled) return;

        const url = window.URL.createObjectURL(blob);
        createdUrl = url;
        setObjectUrl(url);
      } catch (err) {
        if (!isCancelled) {
          setError(err?.message || 'Unable to load this document.');
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
  }, [doc, isUnsupported]);

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
          {onDownload && (
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
// Main Documents Page Component
// ============================================================================
function Documents() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [downloadNotice, setDownloadNotice] = useState('');

  // Fetch real documents from backend on mount
  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const response = await api.employee.getDocuments();
        if (!ignore) {
          const rawDocs = response?.data || [];
          setDocuments(rawDocs.map(mapBackendDocument));
        }
      } catch (err) {
        if (!ignore) {
          setError(err?.message || 'Unable to load documents. Please try again.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, []);

  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.employee.getDocuments();
      const rawDocs = response?.data || [];
      setDocuments(rawDocs.map(mapBackendDocument));
    } catch (err) {
      setError(err?.message || 'Unable to load documents. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Close modal on Escape key for accessibility
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setPreviewDoc(null);
      }
    };

    if (previewDoc) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewDoc]);

  const handleView = (doc) => {
    setPreviewDoc(doc);
  };

  // Real secure document download via backend API
  const handleDownload = async (doc) => {
    if (!doc || !doc.id) return;
    try {
      setDownloadNotice(`Downloading ${doc.fileName}...`);
      const blob = await api.employee.downloadDocument(doc.id);

      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = doc.fileName || 'document.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);

      setDownloadNotice(`Downloaded ${doc.fileName} successfully.`);
    } catch (err) {
      const errorMsg = err?.message || 'Failed to download document. Please try again.';
      setDownloadNotice(`Error: ${errorMsg}`);
    }
  };

  const handleCloseDownloadNotice = () => {
    setDownloadNotice('');
  };

  // Filtered documents using search query and category
  const filteredDocuments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return documents.filter((doc) => {
      const matchesCategory =
        selectedCategory === 'all' || doc.category === selectedCategory;

      const matchesQuery =
        !query ||
        doc.name.toLowerCase().includes(query) ||
        doc.fileName.toLowerCase().includes(query) ||
        doc.type.toLowerCase().includes(query);

      return matchesCategory && matchesQuery;
    });
  }, [documents, searchTerm, selectedCategory]);

  // Group filtered documents by categories
  const groupedCategories = useMemo(() => {
    const categoryKeys = ['employment', 'payslip', 'other'];
    const groups = [];

    categoryKeys.forEach((key) => {
      if (selectedCategory === 'all' || selectedCategory === key) {
        const docs = filteredDocuments.filter((d) => d.category === key);
        if (docs.length > 0) {
          groups.push({
            id: key,
            title: CATEGORY_TITLES[key],
            documents: docs,
          });
        }
      }
    });

    return groups;
  }, [filteredDocuments, selectedCategory]);

  return (
    <div className="employee-documents-page">
      {/* Page Header */}
      <header className="documents-page-header">
        <h1 className="documents-page-title">My Documents</h1>
        <p className="documents-page-subtitle">
          View and access your employment-related documents.
        </p>
      </header>

      {/* Download Feedback Notice Banner */}
      {downloadNotice && (
        <div className="documents-notice-banner" role="status" aria-live="polite">
          <div className="documents-notice-content">
            <svg
              className="documents-notice-icon"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
            <span>{downloadNotice}</span>
          </div>
          <button
            type="button"
            className="documents-notice-dismiss"
            onClick={handleCloseDownloadNotice}
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      )}

      {/* Search and Category Filter Toolbar */}
      <section className="documents-controls-card" aria-label="Document filters">
        <div className="documents-search-wrapper">
          <label htmlFor="document-search-input" className="visually-hidden">
            Search documents
          </label>
          <div className="search-input-container">
            <svg
              className="search-input-icon"
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
              id="document-search-input"
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="documents-search-input"
            />
            {searchTerm && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchTerm('')}
                aria-label="Clear search query"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Category Pill Filters */}
        <div className="documents-category-filters" role="group" aria-label="Filter by category">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className={`category-filter-btn ${isSelected ? 'category-filter-active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
                aria-pressed={isSelected}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Content Area: Loading, Error, Documents Grid, or Empty State */}
      {loading ? (
        <section className="documents-empty-state" aria-label="Loading documents">
          <div className="empty-state-icon-box" aria-hidden="true">
            <svg
              className="empty-state-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 14 14" />
            </svg>
          </div>
          <h3 className="empty-state-heading">Loading documents...</h3>
          <p className="empty-state-text">Please wait while we fetch your documents.</p>
        </section>
      ) : error ? (
        <section className="documents-empty-state" aria-label="Error loading documents">
          <div className="empty-state-icon-box" aria-hidden="true">
            <svg
              className="empty-state-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h3 className="empty-state-heading">Unable to load documents</h3>
          <p className="empty-state-text">{error}</p>
          <button
            type="button"
            className="empty-state-reset-button"
            onClick={handleRetry}
          >
            Retry
          </button>
        </section>
      ) : groupedCategories.length > 0 ? (
        <div className="documents-sections-wrapper">
          {groupedCategories.map((group) => (
            <section
              key={group.id}
              className="document-category-section"
              aria-labelledby={`category-title-${group.id}`}
            >
              <div className="category-section-header">
                <h2 id={`category-title-${group.id}`} className="category-section-title">
                  {group.title}
                </h2>
                <span className="category-section-count">
                  {group.documents.length} {group.documents.length === 1 ? 'document' : 'documents'}
                </span>
              </div>

              <div className="documents-grid">
                {group.documents.map((doc) => (
                  <DocumentCardItem
                    key={doc.id}
                    doc={doc}
                    onView={handleView}
                    onDownload={handleDownload}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        /* Empty State */
        <section className="documents-empty-state" aria-label="No documents found">
          <div className="empty-state-icon-box" aria-hidden="true">
            <svg
              className="empty-state-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
          <h3 className="empty-state-heading">No documents found</h3>
          <p className="empty-state-text">Try changing your search or filter.</p>
          {(searchTerm || selectedCategory !== 'all') && (
            <button
              type="button"
              className="empty-state-reset-button"
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('all');
              }}
            >
              Reset Filters
            </button>
          )}
        </section>
      )}

      {/* View Document Modal */}
      <DocumentPreviewModal
        doc={previewDoc}
        onClose={() => setPreviewDoc(null)}
        onDownload={handleDownload}
      />
    </div>
  );
}

export default Documents;
