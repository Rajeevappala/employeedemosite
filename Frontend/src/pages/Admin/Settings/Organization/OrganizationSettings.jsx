import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../../../services/api';
import gaintproLogo from '../../../../assets/gaintpro-logo.png';
import './OrganizationSettings.css';

const DEFAULT_SETTINGS = {
  organization_name: 'GaintPro Software Technologies',
  legal_name: '',
  phone: '',
  email: '',
  website: '',
  address_line_1: '',
  address_line_2: '',
  city: '',
  state: '',
  postal_code: '',
  country: 'India',
};

function OrganizationSettings() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState(DEFAULT_SETTINGS);
  const [initialData, setInitialData] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Fetch current organization configuration from backend
  useEffect(() => {
    let isMounted = true;

    api.admin.settings.organization
      .get()
      .then((res) => {
        if (!isMounted) return;
        if (res && res.success && res.data) {
          const normalized = {
            organization_name: res.data.organization_name || 'GaintPro Software Technologies',
            legal_name: res.data.legal_name || '',
            phone: res.data.phone || '',
            email: res.data.email || '',
            website: res.data.website || '',
            address_line_1: res.data.address_line_1 || '',
            address_line_2: res.data.address_line_2 || '',
            city: res.data.city || '',
            state: res.data.state || '',
            postal_code: res.data.postal_code || '',
            country: res.data.country || 'India',
          };
          setFormData(normalized);
          setInitialData(normalized);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Failed to load organization settings:', err);
        setError(err.message || 'Failed to load organization settings. Using system defaults.');
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Track if form contains unsaved modifications
  const isDirty = useMemo(() => {
    return Object.keys(DEFAULT_SETTINGS).some(
      (key) => (formData[key] || '').trim() !== (initialData[key] || '').trim()
    );
  }, [formData, initialData]);

  // Input change handler
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (error) setError(null);
    if (successMessage) setSuccessMessage(null);
  };

  // Revert form to initial loaded/saved values
  const handleCancel = () => {
    setFormData(initialData);
    setError(null);
    setSuccessMessage(null);
  };

  // Unsaved changes protection when navigating back
  const handleBack = (e) => {
    e.preventDefault();
    if (isDirty) {
      const confirmLeave = window.confirm(
        'You have unsaved changes on Organization Settings. Are you sure you want to return to Settings?'
      );
      if (!confirmLeave) return;
    }
    navigate('/admin/settings');
  };

  // Form submit handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Frontend validations
    const orgName = (formData.organization_name || '').trim();
    if (!orgName) {
      setError('Organization Name is required.');
      return;
    }

    const country = (formData.country || '').trim();
    if (!country) {
      setError('Country is required.');
      return;
    }

    const postalCode = (formData.postal_code || '').trim();
    const isIndia = ['india', 'in'].includes(country.toLowerCase());
    if (postalCode && isIndia && !/^[1-9][0-9]{2}\s?[0-9]{3}$/.test(postalCode)) {
      setError('Please enter a valid 6-digit Indian postal code (e.g., 500081).');
      return;
    }

    const email = (formData.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setSaving(true);
      const res = await api.admin.settings.organization.update(formData);
      if (res && res.success) {
        const saved = {
          organization_name: res.data.organization_name || orgName,
          legal_name: res.data.legal_name || '',
          phone: res.data.phone || '',
          email: res.data.email || '',
          website: res.data.website || '',
          address_line_1: res.data.address_line_1 || '',
          address_line_2: res.data.address_line_2 || '',
          city: res.data.city || '',
          state: res.data.state || '',
          postal_code: res.data.postal_code || '',
          country: res.data.country || country,
        };
        setFormData(saved);
        setInitialData(saved);
        setSuccessMessage('Organization settings updated successfully.');
      }
    } catch (err) {
      console.error('Failed to save organization settings:', err);
      setError(err.message || 'Failed to save changes. Please review your input.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-org-settings-page">
      {/* Navigation & Breadcrumb */}
      <div className="admin-org-settings-top-nav">
        <button
          type="button"
          onClick={handleBack}
          className="admin-org-settings-back-btn"
          aria-label="Back to Settings landing hub"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Settings
        </button>

        <div className="admin-org-settings-breadcrumbs" aria-label="Breadcrumbs">
          <Link to="/admin/settings">Settings</Link>
          <span className="separator" aria-hidden="true">/</span>
          <span className="current">Organization</span>
        </div>
      </div>

      {/* Header Card */}
      <div className="admin-org-settings-header-card">
        <div className="admin-org-settings-title-group">
          <h1 className="admin-org-settings-title">Organization Settings</h1>
          <p className="admin-org-settings-subtitle">
            Manage the basic organization information used throughout the GaintPro HRM portal.
          </p>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="admin-org-settings-alert admin-org-settings-alert-success" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div>{successMessage}</div>
          <button
            type="button"
            className="admin-org-settings-alert-close"
            onClick={() => setSuccessMessage(null)}
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Notification */}
      {error && (
        <div className="admin-org-settings-alert admin-org-settings-alert-error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>{error}</div>
          <button
            type="button"
            className="admin-org-settings-alert-close"
            onClick={() => setError(null)}
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="admin-org-settings-loading-card">
          <div className="admin-org-settings-spinner" aria-hidden="true" />
          <span>Loading organization configuration...</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="admin-org-settings-form">
          {/* SECTION 1: Organization Information */}
          <div className="admin-org-settings-section-card">
            <div className="admin-org-settings-section-header">
              <div className="admin-org-settings-section-icon" aria-hidden="true">
                🏢
              </div>
              <div>
                <h2 className="admin-org-settings-section-title">Organization Information</h2>
                <p className="admin-org-settings-section-desc">
                  Core enterprise identity and official business registration name.
                </p>
              </div>
            </div>

            <div className="admin-org-settings-grid-2">
              <div className="admin-org-settings-field-group">
                <label htmlFor="organization_name" className="admin-org-settings-label">
                  Organization Name <span className="admin-org-settings-required">*</span>
                </label>
                <input
                  type="text"
                  id="organization_name"
                  name="organization_name"
                  value={formData.organization_name}
                  onChange={handleChange}
                  required
                  maxLength={200}
                  className="admin-org-settings-input"
                  placeholder="GaintPro Software Technologies"
                  disabled={saving}
                />
                <span className="admin-org-settings-hint">Used across headers, payslips, and system notifications.</span>
              </div>

              <div className="admin-org-settings-field-group">
                <label htmlFor="legal_name" className="admin-org-settings-label">
                  Legal Name
                </label>
                <input
                  type="text"
                  id="legal_name"
                  name="legal_name"
                  value={formData.legal_name}
                  onChange={handleChange}
                  maxLength={200}
                  className="admin-org-settings-input"
                  placeholder="GaintPro Software Technologies Private Limited"
                  disabled={saving}
                />
                <span className="admin-org-settings-hint">Registered corporate entity name for legal documentation.</span>
              </div>
            </div>
          </div>

          {/* SECTION 2: Contact Information */}
          <div className="admin-org-settings-section-card">
            <div className="admin-org-settings-section-header">
              <div className="admin-org-settings-section-icon" aria-hidden="true">
                📞
              </div>
              <div>
                <h2 className="admin-org-settings-section-title">Contact Information</h2>
                <p className="admin-org-settings-section-desc">
                  Official contact channels for general correspondence.
                </p>
              </div>
            </div>

            <div className="admin-org-settings-grid-3">
              <div className="admin-org-settings-field-group">
                <label htmlFor="phone" className="admin-org-settings-label">
                  Phone
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  maxLength={50}
                  className="admin-org-settings-input"
                  placeholder="+91 9876543210"
                  disabled={saving}
                />
              </div>

              <div className="admin-org-settings-field-group">
                <label htmlFor="email" className="admin-org-settings-label">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  maxLength={255}
                  className="admin-org-settings-input"
                  placeholder="hr@gaintpro.com"
                  disabled={saving}
                />
              </div>

              <div className="admin-org-settings-field-group">
                <label htmlFor="website" className="admin-org-settings-label">
                  Website
                </label>
                <input
                  type="text"
                  id="website"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  maxLength={255}
                  className="admin-org-settings-input"
                  placeholder="https://gaintpro.com"
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: Address */}
          <div className="admin-org-settings-section-card">
            <div className="admin-org-settings-section-header">
              <div className="admin-org-settings-section-icon" aria-hidden="true">
                📍
              </div>
              <div>
                <h2 className="admin-org-settings-section-title">Address</h2>
                <p className="admin-org-settings-section-desc">
                  Physical registered headquarters address of the organization.
                </p>
              </div>
            </div>

            <div className="admin-org-settings-grid-2">
              <div className="admin-org-settings-field-group admin-org-settings-field-full">
                <label htmlFor="address_line_1" className="admin-org-settings-label">
                  Address Line 1
                </label>
                <input
                  type="text"
                  id="address_line_1"
                  name="address_line_1"
                  value={formData.address_line_1}
                  onChange={handleChange}
                  maxLength={500}
                  className="admin-org-settings-input"
                  placeholder="Building No, Tech Park, Street Address"
                  disabled={saving}
                />
              </div>

              <div className="admin-org-settings-field-group admin-org-settings-field-full">
                <label htmlFor="address_line_2" className="admin-org-settings-label">
                  Address Line 2
                </label>
                <input
                  type="text"
                  id="address_line_2"
                  name="address_line_2"
                  value={formData.address_line_2}
                  onChange={handleChange}
                  maxLength={500}
                  className="admin-org-settings-input"
                  placeholder="Suite, Floor, Landmark (Optional)"
                  disabled={saving}
                />
              </div>

              <div className="admin-org-settings-field-group">
                <label htmlFor="city" className="admin-org-settings-label">
                  City
                </label>
                <input
                  type="text"
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  maxLength={100}
                  className="admin-org-settings-input"
                  placeholder="Hyderabad"
                  disabled={saving}
                />
              </div>

              <div className="admin-org-settings-field-group">
                <label htmlFor="state" className="admin-org-settings-label">
                  State
                </label>
                <input
                  type="text"
                  id="state"
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  maxLength={100}
                  className="admin-org-settings-input"
                  placeholder="Telangana"
                  disabled={saving}
                />
              </div>

              <div className="admin-org-settings-field-group">
                <label htmlFor="postal_code" className="admin-org-settings-label">
                  Postal Code
                </label>
                <input
                  type="text"
                  id="postal_code"
                  name="postal_code"
                  value={formData.postal_code}
                  onChange={handleChange}
                  maxLength={20}
                  className="admin-org-settings-input"
                  placeholder="500081"
                  disabled={saving}
                />
                <span className="admin-org-settings-hint">6-digit PIN code for India.</span>
              </div>

              <div className="admin-org-settings-field-group">
                <label htmlFor="country" className="admin-org-settings-label">
                  Country <span className="admin-org-settings-required">*</span>
                </label>
                <input
                  type="text"
                  id="country"
                  name="country"
                  value={formData.country}
                  onChange={handleChange}
                  required
                  maxLength={100}
                  className="admin-org-settings-input"
                  placeholder="India"
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          {/* SECTION 4: Organization Logo */}
          <div className="admin-org-settings-section-card">
            <div className="admin-org-settings-section-header">
              <div className="admin-org-settings-section-icon" aria-hidden="true">
                🎨
              </div>
              <div>
                <h2 className="admin-org-settings-section-title">Organization Logo</h2>
                <p className="admin-org-settings-section-desc">
                  Default company branding and asset rendering.
                </p>
              </div>
            </div>

            <div className="admin-org-settings-logo-container">
              <div className="admin-org-settings-logo-preview" aria-hidden="true">
                <img
                  src={gaintproLogo}
                  alt="GaintPro Software Technologies logo"
                  className="admin-org-settings-logo-img"
                />
              </div>
              <div className="admin-org-settings-logo-info">
                <span className="admin-org-settings-logo-info-title">GaintPro Official Brand Asset</span>
                <span className="admin-org-settings-logo-info-desc">
                  Official GaintPro Software Technologies corporate logo used across portal headers and payslip PDFs.
                </span>
                <span className="admin-org-settings-logo-badge">
                  Official Brand Active
                </span>
              </div>
            </div>
          </div>

          {/* Form Actions Card */}
          <div className="admin-org-settings-actions-card">
            <div className="admin-org-settings-dirty-status">
              {isDirty ? (
                <>
                  <span className="admin-org-settings-dirty-dot" aria-hidden="true" />
                  <span>Unsaved changes</span>
                </>
              ) : (
                <>
                  <span className="admin-org-settings-clean-dot" aria-hidden="true" />
                  <span>All changes saved</span>
                </>
              )}
            </div>

            <div className="admin-org-settings-btn-group">
              <button
                type="button"
                onClick={handleCancel}
                className="admin-org-settings-btn admin-org-settings-btn-cancel"
                disabled={!isDirty || saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="admin-org-settings-btn admin-org-settings-btn-primary"
                disabled={saving || !isDirty}
              >
                {saving ? 'Saving Changes...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

export default OrganizationSettings;
