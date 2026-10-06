import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import './EmployeeDetails.css';

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

  // Upload document form state
  const [uploadForm, setUploadForm] = useState({
    docName: '',
    docType: 'PDF',
  });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3500);
  };

  const applyEmployeeData = (raw) => {
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
        uan: '—',
        pfNumber: '—',
        employerContribution: '—',
        employeeContribution: '—',
        pfStatus: 'Not Configured',
      },
      leaveSummary: {
        pl: { total: 0, used: 0, remaining: 0 },
        sick: { total: 0, used: 0, remaining: 0 },
        upl: { used: 0 },
      },
      documents: [],
      recentLeaves: [],
    });
  };

  const fetchEmployeeDetails = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.getEmployee(employeeId);
      if (response && response.success && response.data) {
        applyEmployeeData(response.data);
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

    api.admin.getEmployee(employeeId)
      .then((response) => {
        if (ignore) return;
        if (response && response.success && response.data) {
          applyEmployeeData(response.data);
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

  // Open edit modal & sync values
  const handleOpenEditModal = () => {
    if (!employee) return;
    setEditError('');
    setEditForm({
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone === '—' ? '' : employee.phone,
      department: employee.department === '—' ? 'Technology' : employee.department,
      designation: employee.designation === '—' ? '' : employee.designation,
      joiningDate: employee.dateOfJoining === '—' ? '' : employee.dateOfJoining,
      employmentType: employee.employmentType,
      workLocation: employee.workLocation,
      reportingManager: employee.reportingManager,
      employmentStatus: employee.status,
    });
    setIsEditModalOpen(true);
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

  // Upload document (Read-only notice)
  const handleUploadSubmit = (e) => {
    e.preventDefault();
    setIsUploadModalOpen(false);
    showToast('Document upload will be enabled in a future release (Read-Only phase).');
  };

  // Simulated download action
  const handleSimulatedDownload = (docName) => {
    showToast(`Download action for "${docName}". (Read-Only phase)`);
  };

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
            <span className="admin-summary-department">{employee.department}</span>
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
              <span className="admin-info-value">{employee.department}</span>
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
            onClick={() => setIsUploadModalOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Upload Document</span>
          </button>
        </div>

        <div className="admin-docs-list">
          {employee.documents && employee.documents.length > 0 ? (
            employee.documents.map((doc) => {
              const isAvailable = doc.status === 'Available';
              return (
                <div key={doc.id} className="admin-doc-item">
                  <div className="admin-doc-left">
                    <div className="admin-doc-icon-wrapper" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    </div>
                    <div className="admin-doc-meta">
                      <span className="admin-doc-name">{doc.name}</span>
                      <span className="admin-doc-subtext">
                        {doc.type} &bull; {isAvailable ? `Uploaded: ${doc.uploadedDate}` : 'File pending upload'}
                      </span>
                    </div>
                  </div>

                  <div className="admin-doc-right">
                    <span
                      className={`admin-status-badge ${
                        isAvailable ? 'status-active' : 'status-inactive'
                      }`}
                    >
                      <span className="status-dot" aria-hidden="true"></span>
                      {doc.status}
                    </span>

                    <div className="admin-doc-actions">
                      <button
                        type="button"
                        className="admin-doc-btn"
                        disabled={!isAvailable}
                        onClick={() => setPreviewDoc(doc)}
                        aria-label={`View ${doc.name}`}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="admin-doc-btn"
                        disabled={!isAvailable}
                        onClick={() => handleSimulatedDownload(doc.name)}
                        aria-label={`Download ${doc.name}`}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-muted" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              No official documents on record for this employee.
            </div>
          )}
        </div>
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

            <div className="admin-pf-stat-box admin-field-full">
              <span className="admin-pf-stat-label">PF Status</span>
              <span className="admin-pf-stat-val">
                <span className="admin-status-badge status-active">
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
                    <option value="Technology">Technology</option>
                    <option value="HR">HR</option>
                    <option value="Finance">Finance</option>
                    <option value="Operations">Operations</option>
                    <option value="Sales">Sales</option>
                  </select>
                </div>

                {/* Designation */}
                <div className="admin-form-field">
                  <label htmlFor="editDesignation" className="admin-field-label">Designation</label>
                  <input
                    id="editDesignation"
                    name="designation"
                    type="text"
                    className="admin-field-input"
                    value={editForm.designation}
                    onChange={handleEditChange}
                  />
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
          UPLOAD DOCUMENT MODAL (UI-only)
          ==================================================================== */}
      {isUploadModalOpen && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Upload Employee Document</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsUploadModalOpen(false)}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="admin-modal-form">
              <div className="admin-form-field">
                <label htmlFor="docName" className="admin-field-label">
                  Document Title <span className="text-required">*</span>
                </label>
                <input
                  id="docName"
                  type="text"
                  required
                  placeholder="e.g. Appointment Letter"
                  className="admin-field-input"
                  value={uploadForm.docName}
                  onChange={(e) => setUploadForm((p) => ({ ...p, docName: e.target.value }))}
                />
              </div>

              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label htmlFor="docType" className="admin-field-label">Document Type</label>
                <select
                  id="docType"
                  className="admin-field-select"
                  value={uploadForm.docType}
                  onChange={(e) => setUploadForm((p) => ({ ...p, docType: e.target.value }))}
                >
                  <option value="PDF">PDF Document</option>
                  <option value="DOCX">Word Document (.docx)</option>
                  <option value="SCAN">Scanned Image</option>
                </select>
              </div>

              <div className="admin-form-field" style={{ marginTop: '1rem' }}>
                <label className="admin-field-label">Choose File (Simulated)</label>
                <input
                  type="file"
                  className="admin-field-input"
                  style={{ paddingTop: '0.4rem' }}
                />
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setIsUploadModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="admin-btn-primary">
                  Upload Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          DOCUMENT PREVIEW MODAL (UI-only)
          ==================================================================== */}
      {previewDoc && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-doc-preview-modal">
            <div className="admin-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div className="admin-doc-icon-wrapper" style={{ width: '28px', height: '28px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <h2 className="admin-modal-title">{previewDoc.name}</h2>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setPreviewDoc(null)}
                aria-label="Close preview"
              >
                &times;
              </button>
            </div>

            <div className="admin-preview-content">
              <div className="admin-preview-simulated-sheet">
                <div className="admin-preview-sheet-header">
                  <span className="sheet-org">GaintPro Software Technologies</span>
                  <span className="sheet-doc-type">{previewDoc.type} DOCUMENT PREVIEW</span>
                </div>
                <h3 className="sheet-title">{previewDoc.name}</h3>
                <p className="sheet-text">
                  Issued to: <strong>{employee.name}</strong> ({employee.employeeId})
                </p>
                <p className="sheet-text">
                  Department: <strong>{employee.department}</strong> &bull; Designation: <strong>{employee.designation}</strong>
                </p>
                <p className="sheet-text">
                  Uploaded on: <strong>{previewDoc.uploadedDate || '15 May 2025'}</strong>
                </p>
                <div className="sheet-watermark">PREVIEW ONLY</div>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setPreviewDoc(null)}
              >
                Close Preview
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => {
                  handleSimulatedDownload(previewDoc.name);
                  setPreviewDoc(null);
                }}
              >
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EmployeeDetails;
