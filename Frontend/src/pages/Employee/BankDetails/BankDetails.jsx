import { useState, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import './BankDetails.css';

const DEFAULT_BANK = 'IDFC Bank';
const APPROVED_BANKS = ['IDFC Bank'];
const ACCOUNT_TYPES = ['Savings', 'Current', 'Salary'];

const INITIAL_FORM_STATE = {
  account_holder_name: '',
  bank_name: DEFAULT_BANK,
  account_number: '',
  confirm_account_number: '',
  ifsc_code: '',
  branch_name: '',
  branch_city: '',
  branch_state: '',
  account_type: 'Savings',
};

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

export default function BankDetails() {
  const [bankData, setBankData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Form mode: true when user is filling/editing
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const applyBankData = useCallback((data) => {
    setBankData(data);
    if (data) {
      // Initialize form with existing data, preserving existing bank_name
      setFormData({
        account_holder_name: data.account_holder_name || '',
        bank_name: data.bank_name || DEFAULT_BANK,
        account_number: '',
        confirm_account_number: '',
        ifsc_code: data.ifsc_code || '',
        branch_name: data.branch_name || '',
        branch_city: data.branch_city || '',
        branch_state: data.branch_state || '',
        account_type: data.account_type || 'Savings',
      });
      setIsEditing(false);
    } else {
      // New form: default Bank Name is strictly IDFC Bank
      setFormData({
        ...INITIAL_FORM_STATE,
        bank_name: DEFAULT_BANK,
      });
      setIsEditing(true);
    }
  }, []);

  useEffect(() => {

    let ignore = false;

    async function load() {
      try {
        const response = await api.employee.getBankDetails();
        if (!ignore && response && response.success) {
          applyBankData(response.data);
          setError('');
        }
      } catch (err) {
        if (!ignore) {
          setError(err.message || 'Failed to fetch bank details.');
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
  }, [applyBankData]);


  // Compute dropdown options: include approved banks + any existing bank from saved data
  const bankOptions = [...APPROVED_BANKS];
  if (bankData?.bank_name && !bankOptions.includes(bankData.bank_name)) {
    bankOptions.unshift(bankData.bank_name);
  }
  if (formData.bank_name && !bankOptions.includes(formData.bank_name)) {
    bankOptions.push(formData.bank_name);
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'ifsc_code' ? value.toUpperCase() : value,
    }));
    // Clear validation error on change
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleStartEdit = () => {
    if (bankData) {
      setFormData({
        account_holder_name: bankData.account_holder_name || '',
        bank_name: bankData.bank_name || DEFAULT_BANK, // Preserves saved bank name
        account_number: '',
        confirm_account_number: '',
        ifsc_code: bankData.ifsc_code || '',
        branch_name: bankData.branch_name || '',
        branch_city: bankData.branch_city || '',
        branch_state: bankData.branch_state || '',
        account_type: bankData.account_type || 'Savings',
      });
    }
    setFormErrors({});
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (bankData) {
      setIsEditing(false);
      setFormErrors({});
    }
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.account_holder_name.trim()) {
      errors.account_holder_name = 'Account Holder Name is required.';
    }

    if (!formData.bank_name.trim()) {
      errors.bank_name = 'Bank Name is required.';
    }

    // Account number validation
    if (!bankData) {
      // New record: account number is strictly required
      if (!formData.account_number.trim()) {
        errors.account_number = 'Account Number is required.';
      } else if (!/^\d{9,18}$/.test(formData.account_number.trim())) {
        errors.account_number = 'Account Number must contain 9 to 18 digits.';
      }

      if (!formData.confirm_account_number.trim()) {
        errors.confirm_account_number = 'Please confirm your account number.';
      } else if (formData.account_number.trim() !== formData.confirm_account_number.trim()) {
        errors.confirm_account_number = 'Account numbers do not match.';
      }
    } else {
      // Existing record: account number is optional to change
      if (formData.account_number.trim()) {
        if (!/^\d{9,18}$/.test(formData.account_number.trim())) {
          errors.account_number = 'Account Number must contain 9 to 18 digits.';
        }
        if (formData.account_number.trim() !== formData.confirm_account_number.trim()) {
          errors.confirm_account_number = 'Account numbers do not match.';
        }
      }
    }

    // IFSC validation
    if (!formData.ifsc_code.trim()) {
      errors.ifsc_code = 'IFSC Code is required.';
    } else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.ifsc_code.trim().toUpperCase())) {
      errors.ifsc_code = 'Invalid IFSC format. Must be 11 characters (e.g. IDFB0040101).';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const payload = {
        account_holder_name: formData.account_holder_name.trim(),
        bank_name: formData.bank_name.trim(),
        ifsc_code: formData.ifsc_code.trim().toUpperCase(),
        branch_name: formData.branch_name.trim() || null,
        branch_city: formData.branch_city.trim() || null,
        branch_state: formData.branch_state.trim() || null,
        account_type: formData.account_type,
      };

      if (formData.account_number.trim()) {
        payload.account_number = formData.account_number.trim();
        payload.confirm_account_number = formData.confirm_account_number.trim();
      }

      const response = await api.employee.saveBankDetails(payload);

      if (response && response.success) {
        setSuccessMessage(response.message || 'Bank details saved successfully.');
        setBankData(response.data);
        setIsEditing(false);
        setTimeout(() => setSuccessMessage(''), 4000);
      }
    } catch (err) {
      setError(err.message || 'Failed to save bank details.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bank-details-page">
        <div className="bank-loading-card">
          <div className="bank-spinner" aria-hidden="true"></div>
          <p>Loading bank account details...</p>
        </div>
      </div>
    );
  }

  const status = bankData?.verification_status || 'Pending';
  const statusClass =
    status === 'Verified'
      ? 'status-verified'
      : status === 'Rejected'
      ? 'status-rejected'
      : 'status-pending';

  return (
    <div className="bank-details-page">
      {/* Page Header */}
      <div className="bank-page-header">
        <div>
          <h1 className="bank-page-title">Salary Bank Details</h1>
          <p className="bank-page-desc">
            Manage your salary disbursement account information. Official disbursement uses IDFC Bank.
          </p>
        </div>
        {bankData && !isEditing && (
          <button
            type="button"
            className="bank-btn-primary"
            onClick={handleStartEdit}
            id="edit-bank-details-btn"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>Update Bank Details</span>
          </button>
        )}
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="bank-alert bank-alert-error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="bank-alert bank-alert-success" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Organization Policy Banner */}
      <div className="bank-org-banner">
        <div className="bank-org-banner-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
        </div>
        <div className="bank-org-banner-content">
          <strong>Official Salary Disbursement: IDFC Bank</strong>
          <p>
            All employee salary accounts are centrally processed through <strong>IDFC Bank</strong>.
            New registrations default to IDFC Bank. For account assistance, contact Finance & Payroll.
          </p>
        </div>
      </div>

      {/* VIEW MODE */}
      {bankData && !isEditing ? (
        <div className="bank-card bank-summary-card">
          <div className="bank-card-header">
            <div className="bank-card-header-left">
              <div className="bank-icon-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                  <path d="M3 21h18" />
                  <path d="M3 10h18" />
                  <path d="M5 6l7-3 7 3" />
                  <path d="M4 10v11" />
                  <path d="M20 10v11" />
                  <path d="M8 14v4" />
                  <path d="M12 14v4" />
                  <path d="M16 14v4" />
                </svg>
              </div>
              <div>
                <h2 className="bank-card-title">{bankData.bank_name}</h2>
                <span className="bank-card-subtitle">
                  {bankData.account_type || 'Savings'} Account &bull; Registered for Salary Credit
                </span>
              </div>
            </div>

            <div className={`bank-status-pill ${statusClass}`}>
              <span className="bank-status-dot" aria-hidden="true"></span>
              <span>{status}</span>
            </div>
          </div>

          {/* Verification Status Details */}
          {status === 'Pending' && (
            <div className="bank-status-notice bank-notice-pending">
              <strong>Verification in progress:</strong> Your submitted bank details are under administrative review. Once verified, salary credits will disburse to this account.
            </div>
          )}
          {status === 'Rejected' && (
            <div className="bank-status-notice bank-notice-rejected">
              <strong>Verification rejected:</strong> {bankData.admin_remarks || 'Please check your bank details and submit them again.'}
            </div>
          )}

          {/* Details Grid */}
          <div className="bank-details-grid">
            <div className="bank-detail-group">
              <span className="bank-detail-label">Account Holder Name</span>
              <span className="bank-detail-val">{bankData.account_holder_name}</span>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">Bank Name</span>
              <span className="bank-detail-val font-semibold">{bankData.bank_name}</span>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">Account Number</span>
              <div className="bank-account-masked-wrap">
                <span className="bank-detail-val font-mono">{bankData.account_number}</span>
                <span className="bank-encrypted-tag" title="Stored with AES-256-GCM encryption at rest">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Encrypted at Rest
                </span>
              </div>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">IFSC Code</span>
              <span className="bank-detail-val font-mono uppercase">{bankData.ifsc_code}</span>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">Account Type</span>
              <span className="bank-detail-val">{bankData.account_type || 'Savings'}</span>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">Branch Name</span>
              <span className="bank-detail-val">{bankData.branch_name || '—'}</span>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">Branch City</span>
              <span className="bank-detail-val">{bankData.branch_city || '—'}</span>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">Branch State</span>
              <span className="bank-detail-val">{bankData.branch_state || '—'}</span>
            </div>

            <div className="bank-detail-group">
              <span className="bank-detail-label">Last Updated</span>
              <span className="bank-detail-val text-muted">{formatDate(bankData.updated_at)}</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* FORM MODE (New Submission or Update) */}
      {isEditing && (
        <form className="bank-card bank-form-card" onSubmit={handleSubmit} noValidate>
          <div className="bank-form-header">
            <div>
              <h2 className="bank-card-title">
                {bankData ? 'Update Bank Information' : 'Submit Bank Account Details'}
              </h2>
              <p className="bank-card-subtitle">
                {bankData
                  ? 'Update your banking information. Note: updating will queue details for re-verification.'
                  : 'Enter your official bank details for monthly salary processing.'}
              </p>
            </div>
          </div>

          <div className="bank-form-grid">
            {/* Account Holder Name */}
            <div className="bank-input-group full-width">
              <label htmlFor="account_holder_name" className="bank-input-label">
                Account Holder Name <span className="text-required">*</span>
              </label>
              <input
                id="account_holder_name"
                name="account_holder_name"
                type="text"
                className={`bank-input ${formErrors.account_holder_name ? 'input-error' : ''}`}
                value={formData.account_holder_name}
                onChange={handleInputChange}
                placeholder="Name as it appears on bank passbook / statement"
                required
              />
              {formErrors.account_holder_name && (
                <span className="bank-error-text">{formErrors.account_holder_name}</span>
              )}
            </div>

            {/* Bank Name Dropdown */}
            <div className="bank-input-group">
              <label htmlFor="bank_name" className="bank-input-label">
                Bank Name <span className="text-required">*</span>
              </label>
              <div className="bank-select-wrapper">
                <select
                  id="bank_name"
                  name="bank_name"
                  className={`bank-select ${formErrors.bank_name ? 'input-error' : ''}`}
                  value={formData.bank_name}
                  onChange={handleInputChange}
                  required
                >
                  {bankOptions.map((bank) => (
                    <option key={bank} value={bank}>
                      {bank}
                    </option>
                  ))}
                </select>
                <div className="bank-select-arrow" aria-hidden="true">
                  ▼
                </div>
              </div>
              <span className="bank-input-hint">
                Default organizational banking partner is IDFC Bank.
              </span>
              {formErrors.bank_name && (
                <span className="bank-error-text">{formErrors.bank_name}</span>
              )}
            </div>

            {/* Account Type */}
            <div className="bank-input-group">
              <label htmlFor="account_type" className="bank-input-label">
                Account Type <span className="text-required">*</span>
              </label>
              <div className="bank-select-wrapper">
                <select
                  id="account_type"
                  name="account_type"
                  className="bank-select"
                  value={formData.account_type}
                  onChange={handleInputChange}
                >
                  {ACCOUNT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type} Account
                    </option>
                  ))}
                </select>
                <div className="bank-select-arrow" aria-hidden="true">
                  ▼
                </div>
              </div>
            </div>

            {/* Account Number */}
            <div className="bank-input-group">
              <label htmlFor="account_number" className="bank-input-label">
                Account Number <span className="text-required">*</span>
              </label>
              <input
                id="account_number"
                name="account_number"
                type="password"
                autoComplete="off"
                className={`bank-input font-mono ${formErrors.account_number ? 'input-error' : ''}`}
                value={formData.account_number}
                onChange={handleInputChange}
                placeholder={
                  bankData
                    ? `Saved: ${bankData.account_number} (leave blank to keep)`
                    : 'Enter 9-18 digit account number'
                }
              />
              <span className="bank-input-hint">
                {bankData ? 'Leave blank to keep your current account number.' : 'Digits only.'}
              </span>
              {formErrors.account_number && (
                <span className="bank-error-text">{formErrors.account_number}</span>
              )}
            </div>

            {/* Confirm Account Number */}
            <div className="bank-input-group">
              <label htmlFor="confirm_account_number" className="bank-input-label">
                Confirm Account Number <span className="text-required">*</span>
              </label>
              <input
                id="confirm_account_number"
                name="confirm_account_number"
                type="text"
                autoComplete="off"
                className={`bank-input font-mono ${formErrors.confirm_account_number ? 'input-error' : ''}`}
                value={formData.confirm_account_number}
                onChange={handleInputChange}
                placeholder="Re-enter account number"
              />
              {formErrors.confirm_account_number && (
                <span className="bank-error-text">{formErrors.confirm_account_number}</span>
              )}
            </div>

            {/* IFSC Code */}
            <div className="bank-input-group">
              <label htmlFor="ifsc_code" className="bank-input-label">
                IFSC Code <span className="text-required">*</span>
              </label>
              <input
                id="ifsc_code"
                name="ifsc_code"
                type="text"
                maxLength={11}
                className={`bank-input font-mono uppercase ${formErrors.ifsc_code ? 'input-error' : ''}`}
                value={formData.ifsc_code}
                onChange={handleInputChange}
                placeholder="e.g. IDFB0040101"
                required
              />
              <span className="bank-input-hint">11-character Indian Financial System Code.</span>
              {formErrors.ifsc_code && (
                <span className="bank-error-text">{formErrors.ifsc_code}</span>
              )}
            </div>

            {/* Branch Name */}
            <div className="bank-input-group">
              <label htmlFor="branch_name" className="bank-input-label">
                Branch Name
              </label>
              <input
                id="branch_name"
                name="branch_name"
                type="text"
                className="bank-input"
                value={formData.branch_name}
                onChange={handleInputChange}
                placeholder="e.g. Hitec City Branch"
              />
            </div>

            {/* Branch City */}
            <div className="bank-input-group">
              <label htmlFor="branch_city" className="bank-input-label">
                Branch City
              </label>
              <input
                id="branch_city"
                name="branch_city"
                type="text"
                className="bank-input"
                value={formData.branch_city}
                onChange={handleInputChange}
                placeholder="e.g. Hyderabad"
              />
            </div>

            {/* Branch State */}
            <div className="bank-input-group">
              <label htmlFor="branch_state" className="bank-input-label">
                Branch State
              </label>
              <input
                id="branch_state"
                name="branch_state"
                type="text"
                className="bank-input"
                value={formData.branch_state}
                onChange={handleInputChange}
                placeholder="e.g. Telangana"
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="bank-form-actions">
            {bankData && (
              <button
                type="button"
                className="bank-btn-secondary"
                onClick={handleCancelEdit}
                disabled={submitting}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="bank-btn-primary"
              disabled={submitting}
              id="submit-bank-details-btn"
            >
              {submitting ? (
                <>
                  <span className="bank-btn-spinner" aria-hidden="true"></span>
                  <span>Saving...</span>
                </>
              ) : (
                <span>{bankData ? 'Save Changes' : 'Submit Bank Details'}</span>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
