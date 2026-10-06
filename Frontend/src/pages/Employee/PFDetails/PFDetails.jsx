import { useState, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import './PFDetails.css';

/**
 * Formats an ISO date string to a user-friendly format (e.g. 15 May 2025).
 */
function formatDate(dateString) {
  if (!dateString) return '—';
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
 * Maps raw backend PF details data strictly to the fields stored in PostgreSQL.
 * Sourced from columns: id, employee_id, uan_number, pf_number, pension_number, created_at, updated_at.
 */
function mapPFData(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    employeeId: raw.employee_id || '',
    uan: raw.uan_number || '',
    pfNumber: raw.pf_number || '',
    pensionNumber: raw.pension_number || '',
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
  };
}

// Reusable data field for key-value pairs
function PFDataField({ label, value, isStatus, isMono }) {
  return (
    <div className="pf-data-field">
      <span className="pf-data-label">{label}</span>
      {isStatus ? (
        <span className="status-badge status-badge-active">
          <span className="status-badge-dot" aria-hidden="true"></span>
          {value || 'Active'}
        </span>
      ) : (
        <span className={`pf-data-value ${isMono ? 'pf-data-mono' : ''}`}>
          {value || '—'}
        </span>
      )}
    </div>
  );
}

function PFDetails() {
  const [pf, setPf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user } = useAuth();

  const fetchPF = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.employee.getPF();
      const rawData = response?.data;
      setPf(mapPFData(rawData));
    } catch (err) {
      const msg =
        err.data?.message || err.message || 'Unable to load PF details. Please try again.';
      setError(msg);
      setPf(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const response = await api.employee.getPF();
        if (!ignore) {
          const rawData = response?.data;
          setPf(mapPFData(rawData));
          setError(null);
        }
      } catch (err) {
        if (!ignore) {
          const msg =
            err.data?.message || err.message || 'Unable to load PF details. Please try again.';
          setError(msg);
          setPf(null);
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

  const handleRetry = () => {
    fetchPF();
  };

  // Section 1: Provident Fund Account Fields (built from actual backend columns)
  const pfAccountFields = pf
    ? [
        { label: 'UAN Number', value: pf.uan, isMono: true },
        { label: 'PF Number', value: pf.pfNumber, isMono: true },
        { label: 'Pension Number (EPS)', value: pf.pensionNumber, isMono: true },
        { label: 'Registration Date', value: formatDate(pf.createdAt) },
      ]
    : [];

  // Section 2: Employment Fields (authenticated employee profile context)
  const employeeName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || '—'
    : '—';
  const employeeStatus = user?.status
    ? user.status.charAt(0).toUpperCase() + user.status.slice(1).toLowerCase()
    : 'Active';

  const employmentFields = pf
    ? [
        { label: 'Employee ID', value: pf.employeeId || user?.employee_id || '—' },
        { label: 'Employee Name', value: employeeName },
        { label: 'Department', value: user?.department || '—' },
        { label: 'Designation', value: user?.designation || '—' },
        { label: 'Employment Status', value: employeeStatus, isStatus: true },
      ]
    : [];

  return (
    <div className="employee-pf-details-page">
      {/* Page Header */}
      <header className="pf-page-header">
        <h1 className="pf-page-title">PF Details</h1>
        <p className="pf-page-subtitle">View your Provident Fund information.</p>
      </header>

      {/* Informational Notice Banner */}
      <aside className="pf-notice-card" aria-label="Provident Fund Information Notice">
        <div className="pf-notice-icon-box" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="pf-notice-body">
          <p className="pf-notice-primary">
            PF information displayed here is based on the records maintained by the organization.
          </p>
          <p className="pf-notice-secondary">
            For corrections or questions regarding your PF details, please contact the HR department.
          </p>
        </div>
      </aside>

      {/* Loading State */}
      {loading ? (
        <section
          className="pf-section-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem 1.5rem',
            textAlign: 'center',
            gap: '0.75rem',
          }}
          aria-label="Loading PF details"
        >
          <p style={{ margin: 0, fontSize: '0.95rem', color: '#4b5563', fontWeight: 500 }}>
            Loading PF details...
          </p>
        </section>
      ) : error ? (
        /* Error State with Retry */
        <section
          className="pf-section-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem 1.5rem',
            textAlign: 'center',
            gap: '1rem',
          }}
          aria-label="Error loading PF details"
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: '#fee2e2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              style={{ width: '22px', height: '22px' }}
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div>
            <h2
              style={{
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#111827',
                margin: '0 0 0.35rem 0',
              }}
            >
              Unable to load PF details
            </h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
              {error}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              minHeight: '40px',
              backgroundColor: '#ffffff',
              border: '1px solid #d1d5db',
              borderRadius: '0.5rem',
              color: '#374151',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Retry
          </button>
        </section>
      ) : !pf ? (
        /* Empty State: PF data is null (clean message, not a server error) */
        <section
          className="pf-section-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3.5rem 1.5rem',
            textAlign: 'center',
            gap: '0.75rem',
          }}
          aria-label="PF details not available"
        >
          <div
            className="pf-card-icon-badge"
            style={{ width: '48px', height: '48px', borderRadius: '50%', marginBottom: '0.5rem' }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: '24px', height: '24px' }}
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
              <line x1="7" y1="15" x2="7.01" y2="15" />
              <line x1="11" y1="15" x2="13" y2="15" />
            </svg>
          </div>
          <h2 className="pf-card-title" style={{ fontSize: '1.25rem', margin: 0 }}>
            PF details are not available yet.
          </h2>
          <p
            className="pf-card-subtitle"
            style={{ maxWidth: '440px', margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}
          >
            Your Provident Fund records have not been registered in the system. Please contact the HR department for further assistance.
          </p>
        </section>
      ) : (
        <>
          {/* Section 1: Provident Fund Account Information */}
          <section className="pf-section-card" aria-labelledby="pf-account-info-heading">
            <div className="pf-card-header">
              <div className="pf-card-title-group">
                <div className="pf-card-icon-badge" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                    <line x1="7" y1="15" x2="7.01" y2="15" />
                    <line x1="11" y1="15" x2="13" y2="15" />
                  </svg>
                </div>
                <div>
                  <h2 id="pf-account-info-heading" className="pf-card-title">
                    Provident Fund Information
                  </h2>
                  <p className="pf-card-subtitle">Official account details and identifiers</p>
                </div>
              </div>

              <span className="status-badge status-badge-active">
                <span className="status-badge-dot" aria-hidden="true"></span>
                Active
              </span>
            </div>

            <div className="pf-data-grid">
              {pfAccountFields.map((field) => (
                <PFDataField
                  key={field.label}
                  label={field.label}
                  value={field.value}
                  isStatus={field.isStatus}
                  isMono={field.isMono}
                />
              ))}
            </div>
          </section>

          {/* Section 2: PF Employment Information */}
          <section className="pf-section-card" aria-labelledby="pf-employment-info-heading">
            <div className="pf-card-header">
              <div className="pf-card-title-group">
                <div className="pf-card-icon-badge" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div>
                  <h2 id="pf-employment-info-heading" className="pf-card-title">
                    Employment Information
                  </h2>
                  <p className="pf-card-subtitle">Associated organizational employee profile</p>
                </div>
              </div>
            </div>

            <div className="pf-data-grid">
              {employmentFields.map((field) => (
                <PFDataField
                  key={field.label}
                  label={field.label}
                  value={field.value}
                  isStatus={field.isStatus}
                  isMono={field.isMono}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default PFDetails;
