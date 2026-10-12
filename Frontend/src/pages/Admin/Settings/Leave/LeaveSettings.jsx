import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../../../services/api';
import './LeaveSettings.css';

const DEFAULT_LEAVE_SETTINGS = {
  default_annual_paid_leave: 18,
  default_annual_sick_leave: 10,
  default_annual_unpaid_leave: 0,
  allow_carry_forward: true,
  max_carry_forward_days: 5,
  allow_negative_balance: false,
  require_admin_approval: true,
  minimum_leave_notice_days: 1,
  maximum_continuous_leave_days: 14,
};

function LeaveSettings() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState(DEFAULT_LEAVE_SETTINGS);
  const [initialData, setInitialData] = useState(DEFAULT_LEAVE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Fetch current organization leave policy defaults
  useEffect(() => {
    let isMounted = true;

    api.admin.settings.leave
      .get()
      .then((res) => {
        if (!isMounted) return;
        if (res && res.success && res.data) {
          const raw = res.data;
          const normalized = {
            default_annual_paid_leave: Number(raw.default_annual_paid_leave ?? 18),
            default_annual_sick_leave: Number(raw.default_annual_sick_leave ?? 10),
            default_annual_unpaid_leave: Number(raw.default_annual_unpaid_leave ?? 0),
            allow_carry_forward: Boolean(raw.allow_carry_forward),
            max_carry_forward_days: Number(raw.max_carry_forward_days ?? 5),
            allow_negative_balance: Boolean(raw.allow_negative_balance),
            require_admin_approval: Boolean(raw.require_admin_approval),
            minimum_leave_notice_days: Number(raw.minimum_leave_notice_days ?? 1),
            maximum_continuous_leave_days: Number(raw.maximum_continuous_leave_days ?? 14),
          };
          setFormData(normalized);
          setInitialData(normalized);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Failed to load leave management settings:', err);
        setError(err.message || 'Failed to load configuration. Using system defaults.');
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

  // Compute dirty state
  const isDirty = useMemo(() => {
    if (Number(formData.default_annual_paid_leave) !== Number(initialData.default_annual_paid_leave)) return true;
    if (Number(formData.default_annual_sick_leave) !== Number(initialData.default_annual_sick_leave)) return true;
    if (Number(formData.default_annual_unpaid_leave) !== Number(initialData.default_annual_unpaid_leave)) return true;
    if (formData.allow_carry_forward !== initialData.allow_carry_forward) return true;
    if (Number(formData.max_carry_forward_days) !== Number(initialData.max_carry_forward_days)) return true;
    if (formData.allow_negative_balance !== initialData.allow_negative_balance) return true;
    if (formData.require_admin_approval !== initialData.require_admin_approval) return true;
    if (Number(formData.minimum_leave_notice_days) !== Number(initialData.minimum_leave_notice_days)) return true;
    if (Number(formData.maximum_continuous_leave_days) !== Number(initialData.maximum_continuous_leave_days)) return true;
    return false;
  }, [formData, initialData]);

  // Generic input change handler
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (error) setError(null);
    if (successMessage) setSuccessMessage(null);
  };

  // Revert form to initial saved values
  const handleCancel = () => {
    setFormData(initialData);
    setError(null);
    setSuccessMessage(null);
  };

  // Back navigation with unsaved changes confirmation
  const handleBack = (e) => {
    e.preventDefault();
    if (isDirty) {
      const confirmLeave = window.confirm(
        'You have unsaved changes on Leave Management Settings. Are you sure you want to return to Settings?'
      );
      if (!confirmLeave) return;
    }
    navigate('/admin/settings');
  };

  // Submit form
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Frontend validations
    const pl = Number(formData.default_annual_paid_leave);
    if (isNaN(pl) || !Number.isInteger(pl) || pl < 0 || pl > 365) {
      setError('Paid Leave annual allocation must be an integer between 0 and 365.');
      return;
    }

    const sl = Number(formData.default_annual_sick_leave);
    if (isNaN(sl) || !Number.isInteger(sl) || sl < 0 || sl > 365) {
      setError('Sick Leave annual allocation must be an integer between 0 and 365.');
      return;
    }

    const upl = Number(formData.default_annual_unpaid_leave);
    if (isNaN(upl) || !Number.isInteger(upl) || upl < 0 || upl > 365) {
      setError('Unpaid Leave annual allocation must be an integer between 0 and 365.');
      return;
    }

    const carryDays = Number(formData.max_carry_forward_days);
    if (isNaN(carryDays) || !Number.isInteger(carryDays) || carryDays < 0 || carryDays > 365) {
      setError('Maximum carry forward days must be an integer between 0 and 365.');
      return;
    }

    const noticeDays = Number(formData.minimum_leave_notice_days);
    if (isNaN(noticeDays) || !Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365) {
      setError('Minimum leave notice must be an integer between 0 and 365 days.');
      return;
    }

    const continuousDays = Number(formData.maximum_continuous_leave_days);
    if (isNaN(continuousDays) || !Number.isInteger(continuousDays) || continuousDays <= 0 || continuousDays > 365) {
      setError('Maximum continuous leave must be an integer between 1 and 365 days.');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        default_annual_paid_leave: pl,
        default_annual_sick_leave: sl,
        default_annual_unpaid_leave: upl,
        allow_carry_forward: Boolean(formData.allow_carry_forward),
        max_carry_forward_days: carryDays,
        allow_negative_balance: Boolean(formData.allow_negative_balance),
        require_admin_approval: Boolean(formData.require_admin_approval),
        minimum_leave_notice_days: noticeDays,
        maximum_continuous_leave_days: continuousDays,
      };

      const res = await api.admin.settings.leave.update(payload);
      if (res && res.success) {
        const raw = res.data;
        const saved = {
          default_annual_paid_leave: Number(raw.default_annual_paid_leave ?? pl),
          default_annual_sick_leave: Number(raw.default_annual_sick_leave ?? sl),
          default_annual_unpaid_leave: Number(raw.default_annual_unpaid_leave ?? upl),
          allow_carry_forward: Boolean(raw.allow_carry_forward),
          max_carry_forward_days: Number(raw.max_carry_forward_days ?? carryDays),
          allow_negative_balance: Boolean(raw.allow_negative_balance),
          require_admin_approval: Boolean(raw.require_admin_approval),
          minimum_leave_notice_days: Number(raw.minimum_leave_notice_days ?? noticeDays),
          maximum_continuous_leave_days: Number(raw.maximum_continuous_leave_days ?? continuousDays),
        };
        setFormData(saved);
        setInitialData(saved);
        setSuccessMessage('Leave management settings updated successfully.');
      }
    } catch (err) {
      console.error('Failed to save leave settings:', err);
      setError(err.message || 'Failed to save changes. Please review your input.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-leave-settings-page">
      {/* Navigation & Breadcrumbs */}
      <div className="admin-leave-settings-top-nav">
        <button
          type="button"
          onClick={handleBack}
          className="admin-leave-settings-back-btn"
          aria-label="Back to Settings landing hub"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Settings
        </button>

        <div className="admin-leave-settings-breadcrumbs" aria-label="Breadcrumbs">
          <Link to="/admin/settings">Settings</Link>
          <span className="separator" aria-hidden="true">/</span>
          <span className="current">Leave Management</span>
        </div>
      </div>

      {/* Header Card */}
      <div className="admin-leave-settings-header-card">
        <div className="admin-leave-settings-title-group">
          <h1 className="admin-leave-settings-title">Leave Management Settings</h1>
          <p className="admin-leave-settings-subtitle">
            Configure organization-wide leave policies and defaults.
          </p>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="admin-leave-settings-alert admin-leave-settings-alert-success" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div>
            <strong>Success:</strong> {successMessage}
          </div>
        </div>
      )}

      {error && (
        <div className="admin-leave-settings-alert admin-leave-settings-alert-error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {/* Main Form or Loading Indicator */}
      {loading ? (
        <div className="admin-leave-settings-loading-card">
          <div className="admin-leave-settings-loading-spinner" aria-hidden="true" />
          <p className="admin-leave-settings-loading-text">Loading leave management configuration...</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="admin-leave-settings-form" noValidate>
          {/* SECTION 1: Leave Allocation */}
          <section className="admin-leave-settings-section" aria-labelledby="section-allocation-heading">
            <div className="admin-leave-settings-section-header">
              <h2 id="section-allocation-heading" className="admin-leave-settings-section-title">
                Leave Allocation
              </h2>
              <p className="admin-leave-settings-section-desc">
                Configure organization-level annual quota defaults for active leave types.
              </p>
            </div>

            <div className="admin-leave-settings-allocation-grid">
              {/* Paid Leave (PL) */}
              <div className="admin-leave-settings-allocation-card">
                <div className="admin-leave-settings-type-header">
                  <h3 className="admin-leave-settings-type-name">Paid Leave</h3>
                  <span className="admin-leave-settings-type-badge badge-pl">PL</span>
                </div>
                <p className="admin-leave-settings-type-desc">
                  Standard paid annual leave for vacation and personal requirements.
                </p>
                <div className="admin-leave-settings-input-group">
                  <label htmlFor="default_annual_paid_leave" className="admin-leave-settings-input-label">
                    Annual Allocation
                  </label>
                  <div className="admin-leave-settings-input-wrapper">
                    <input
                      id="default_annual_paid_leave"
                      type="number"
                      name="default_annual_paid_leave"
                      min="0"
                      max="365"
                      step="1"
                      value={formData.default_annual_paid_leave}
                      onChange={handleChange}
                      disabled={saving}
                      className="admin-leave-settings-input"
                      required
                    />
                    <span className="admin-leave-settings-input-unit">days</span>
                  </div>
                </div>
              </div>

              {/* Sick Leave */}
              <div className="admin-leave-settings-allocation-card">
                <div className="admin-leave-settings-type-header">
                  <h3 className="admin-leave-settings-type-name">Sick Leave</h3>
                  <span className="admin-leave-settings-type-badge badge-sl">SL</span>
                </div>
                <p className="admin-leave-settings-type-desc">
                  Medical recovery and health-related leave entitlement.
                </p>
                <div className="admin-leave-settings-input-group">
                  <label htmlFor="default_annual_sick_leave" className="admin-leave-settings-input-label">
                    Annual Allocation
                  </label>
                  <div className="admin-leave-settings-input-wrapper">
                    <input
                      id="default_annual_sick_leave"
                      type="number"
                      name="default_annual_sick_leave"
                      min="0"
                      max="365"
                      step="1"
                      value={formData.default_annual_sick_leave}
                      onChange={handleChange}
                      disabled={saving}
                      className="admin-leave-settings-input"
                      required
                    />
                    <span className="admin-leave-settings-input-unit">days</span>
                  </div>
                </div>
              </div>

              {/* Unpaid Leave (UPL) */}
              <div className="admin-leave-settings-allocation-card">
                <div className="admin-leave-settings-type-header">
                  <h3 className="admin-leave-settings-type-name">Unpaid Leave</h3>
                  <span className="admin-leave-settings-type-badge badge-upl">UPL</span>
                </div>
                <p className="admin-leave-settings-type-desc">
                  Leave without pay when paid balances are exhausted.
                </p>
                <div className="admin-leave-settings-input-group">
                  <label htmlFor="default_annual_unpaid_leave" className="admin-leave-settings-input-label">
                    Annual Allocation
                  </label>
                  <div className="admin-leave-settings-input-wrapper">
                    <input
                      id="default_annual_unpaid_leave"
                      type="number"
                      name="default_annual_unpaid_leave"
                      min="0"
                      max="365"
                      step="1"
                      value={formData.default_annual_unpaid_leave}
                      onChange={handleChange}
                      disabled={saving}
                      className="admin-leave-settings-input"
                      required
                    />
                    <span className="admin-leave-settings-input-unit">days</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 2: Carry Forward */}
          <section className="admin-leave-settings-section" aria-labelledby="section-carry-forward-heading">
            <div className="admin-leave-settings-section-header">
              <h2 id="section-carry-forward-heading" className="admin-leave-settings-section-title">
                Carry Forward
              </h2>
              <p className="admin-leave-settings-section-desc">
                Configure annual rollover rules for unutilized leave days.
              </p>
            </div>

            <div className="admin-leave-settings-grid-2col">
              {/* Carry Forward Toggle */}
              <div className="admin-leave-settings-toggle-row">
                <div className="admin-leave-settings-toggle-text">
                  <span className="admin-leave-settings-toggle-title">Enable Carry Forward</span>
                  <span className="admin-leave-settings-toggle-desc">
                    Permit employees to carry forward unused leave balances into the next year.
                  </span>
                </div>
                <label className="admin-leave-settings-switch" aria-label="Toggle Carry Forward">
                  <input
                    type="checkbox"
                    name="allow_carry_forward"
                    checked={formData.allow_carry_forward}
                    onChange={handleChange}
                    disabled={saving}
                  />
                  <span className="admin-leave-settings-slider"></span>
                </label>
              </div>

              {/* Maximum Carry Forward Days */}
              <div className="admin-leave-settings-field-group">
                <label htmlFor="max_carry_forward_days" className="admin-leave-settings-label">
                  Maximum Carry Forward Days
                </label>
                <div className="admin-leave-settings-input-wrapper">
                  <input
                    id="max_carry_forward_days"
                    type="number"
                    name="max_carry_forward_days"
                    min="0"
                    max="365"
                    step="1"
                    value={formData.max_carry_forward_days}
                    onChange={handleChange}
                    disabled={saving || !formData.allow_carry_forward}
                    className="admin-leave-settings-input"
                    required
                  />
                  <span className="admin-leave-settings-input-unit">days</span>
                </div>
                <span className="admin-leave-settings-hint">
                  {formData.allow_carry_forward
                    ? 'Maximum number of days eligible for annual rollover.'
                    : 'Carry forward is currently disabled.'}
                </span>
              </div>
            </div>

            <div className="admin-leave-settings-notice-box" role="note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                Changes apply to future leave-balance processing and do not modify historical leave records.
              </span>
            </div>
          </section>

          {/* SECTION 3: Leave Balance Rules */}
          <section className="admin-leave-settings-section" aria-labelledby="section-balance-rules-heading">
            <div className="admin-leave-settings-section-header">
              <h2 id="section-balance-rules-heading" className="admin-leave-settings-section-title">
                Leave Balance Rules
              </h2>
              <p className="admin-leave-settings-section-desc">
                Define balance thresholds and negative balance policies.
              </p>
            </div>

            <div className="admin-leave-settings-toggle-row">
              <div className="admin-leave-settings-toggle-text">
                <span className="admin-leave-settings-toggle-title">Allow Negative Leave Balance</span>
                <span className="admin-leave-settings-toggle-desc">
                  Allow employees to request leave days exceeding their current remaining balance.
                </span>
              </div>
              <label className="admin-leave-settings-switch" aria-label="Toggle Negative Leave Balance">
                <input
                  type="checkbox"
                  name="allow_negative_balance"
                  checked={formData.allow_negative_balance}
                  onChange={handleChange}
                  disabled={saving}
                />
                <span className="admin-leave-settings-slider"></span>
              </label>
            </div>
          </section>

          {/* SECTION 4: Leave Request Rules */}
          <section className="admin-leave-settings-section" aria-labelledby="section-request-rules-heading">
            <div className="admin-leave-settings-section-header">
              <h2 id="section-request-rules-heading" className="admin-leave-settings-section-title">
                Leave Request Rules
              </h2>
              <p className="admin-leave-settings-section-desc">
                Set approval and advance notice constraints on leave applications.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="admin-leave-settings-toggle-row">
                <div className="admin-leave-settings-toggle-text">
                  <span className="admin-leave-settings-toggle-title">Require Admin Approval</span>
                  <span className="admin-leave-settings-toggle-desc">
                    All submitted leave requests require administrator review and approval.
                  </span>
                </div>
                <label className="admin-leave-settings-switch" aria-label="Toggle Admin Approval">
                  <input
                    type="checkbox"
                    name="require_admin_approval"
                    checked={formData.require_admin_approval}
                    onChange={handleChange}
                    disabled={saving}
                  />
                  <span className="admin-leave-settings-slider"></span>
                </label>
              </div>

              <div className="admin-leave-settings-grid-2col">
                <div className="admin-leave-settings-field-group">
                  <label htmlFor="minimum_leave_notice_days" className="admin-leave-settings-label">
                    Minimum Leave Notice
                  </label>
                  <div className="admin-leave-settings-input-wrapper">
                    <input
                      id="minimum_leave_notice_days"
                      type="number"
                      name="minimum_leave_notice_days"
                      min="0"
                      max="365"
                      step="1"
                      value={formData.minimum_leave_notice_days}
                      onChange={handleChange}
                      disabled={saving}
                      className="admin-leave-settings-input"
                      required
                    />
                    <span className="admin-leave-settings-input-unit">days</span>
                  </div>
                  <span className="admin-leave-settings-hint">
                    Required advance notice period before leave start date.
                  </span>
                </div>

                <div className="admin-leave-settings-field-group">
                  <label htmlFor="maximum_continuous_leave_days" className="admin-leave-settings-label">
                    Maximum Continuous Leave
                  </label>
                  <div className="admin-leave-settings-input-wrapper">
                    <input
                      id="maximum_continuous_leave_days"
                      type="number"
                      name="maximum_continuous_leave_days"
                      min="1"
                      max="365"
                      step="1"
                      value={formData.maximum_continuous_leave_days}
                      onChange={handleChange}
                      disabled={saving}
                      className="admin-leave-settings-input"
                      required
                    />
                    <span className="admin-leave-settings-input-unit">days</span>
                  </div>
                  <span className="admin-leave-settings-hint">
                    Maximum consecutive leave duration allowed in a single request.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 5: Policy Information */}
          <div className="admin-leave-settings-policy-banner" role="region" aria-label="Policy Information">
            <div className="admin-leave-settings-policy-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="admin-leave-settings-policy-content">
              <h3 className="admin-leave-settings-policy-title">Policy Information</h3>
              <p className="admin-leave-settings-policy-text">
                These settings define organization-level leave policies. Employee leave balances and historical leave requests are not automatically changed when these settings are updated.
              </p>
            </div>
          </div>

          {/* Footer Action Bar */}
          <div className="admin-leave-settings-footer">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving || !isDirty}
              className="admin-leave-settings-btn admin-leave-settings-btn-cancel"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving || !isDirty}
              className="admin-leave-settings-btn admin-leave-settings-btn-save"
            >
              {saving ? (
                <>
                  <span className="admin-leave-settings-spinner" aria-hidden="true"></span>
                  Saving Changes...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default LeaveSettings;
