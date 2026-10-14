import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../../services/api';
import './Profile.css';

/**
 * Safely format text or empty values. Never returns undefined, null, or NaN.
 */
function formatValue(val, fallback = 'Not provided') {
  if (val === undefined || val === null || val === '' || String(val).trim() === '') {
    return fallback;
  }
  return String(val).trim();
}

/**
 * Safely format employment values with "Not available" fallback.
 */
function formatEmploymentValue(val, fallback = 'Not available') {
  if (val === undefined || val === null || val === '' || String(val).trim() === '') {
    return fallback;
  }
  return String(val).trim();
}

export default function Profile() {
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Profile Photo State
  const [photoBlobUrl, setPhotoBlobUrl] = useState(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);

  // Photo Preview Modal State
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 4000);
  };

  const loadProfilePhoto = useCallback(async () => {
    try {
      const blob = await api.employee.getProfilePhotoBlob();
      if (blob && blob.size > 0) {
        const objectUrl = URL.createObjectURL(blob);
        setPhotoBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      }
    } catch {
      setPhotoBlobUrl(null);
    }
  }, []);

  // Load employee profile & photo
  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.employee.getProfile();
      if (res && res.success && res.data) {
        setEmployee(res.data);
        if (res.data.has_profile_photo) {
          loadProfilePhoto();
        } else {
          setPhotoBlobUrl(null);
        }
      } else {
        setError(res?.message || 'Unable to load profile.');
      }
    } catch (err) {
      setError(err.message || 'Unable to load profile. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [loadProfilePhoto]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    fetchProfile();
  }, [fetchProfile]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (photoBlobUrl) URL.revokeObjectURL(photoBlobUrl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [photoBlobUrl, previewUrl]);

  // Trigger hidden file picker
  const handleOpenPicker = () => {
    setErrorMessage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Handle file selection and open preview modal
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setErrorMessage('Invalid image format. Only JPEG, PNG, and WebP images are allowed.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Image size exceeds the 5 MB limit. Please select a smaller photo.');
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewFile(file);
    setPreviewUrl(objectUrl);
    setIsPreviewOpen(true);
  };

  // Close preview modal
  const handleClosePreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setPreviewFile(null);
    setIsPreviewOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Confirm photo upload
  const handleConfirmUpload = async () => {
    if (!previewFile) return;

    try {
      setIsUploadingPhoto(true);
      setErrorMessage('');

      const formData = new FormData();
      formData.append('photo', previewFile);

      const res = await api.employee.uploadProfilePhoto(formData);
      if (res && res.success) {
        showToast('Profile photo updated successfully.');
        await loadProfilePhoto();
        setEmployee((prev) => (prev ? { ...prev, has_profile_photo: true } : prev));
        handleClosePreview();
      } else {
        setErrorMessage(res?.message || 'Failed to upload profile photo.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Error uploading profile photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const fullName = employee
    ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim()
    : '';
  const initials = employee
    ? `${employee.first_name?.charAt(0) || ''}${employee.last_name?.charAt(0) || ''}`.toUpperCase()
    : 'GP';
  const statusFormatted = employee?.status
    ? employee.status.charAt(0).toUpperCase() + employee.status.slice(1).toLowerCase()
    : 'Active';

  return (
    <div className="employee-profile-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="profile-toast-notification" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header */}
      <header className="profile-page-header">
        <div className="profile-header-titles">
          <h1 className="profile-page-title">My Profile</h1>
          <p className="profile-page-subtitle">
            Official employee identification, contact details, and organization records.
          </p>
        </div>
      </header>

      {/* Global Error Banner */}
      {errorMessage && (
        <div className="profile-error-banner" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorMessage}</span>
          <button
            type="button"
            className="profile-error-close-btn"
            onClick={() => setErrorMessage('')}
            aria-label="Close error message"
          >
            &times;
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <section className="profile-loading-card" aria-label="Loading profile">
          <div className="profile-spinner" aria-hidden="true" />
          <p>Loading employee profile...</p>
        </section>
      ) : error ? (
        /* Error State with Retry */
        <section className="profile-error-card" aria-label="Error loading profile">
          <div className="profile-error-icon-wrap" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2>Unable to load profile</h2>
          <p>{error}</p>
          <button type="button" className="profile-btn-primary" onClick={fetchProfile}>
            Retry
          </button>
        </section>
      ) : employee ? (
        <div className="profile-cards-stack">
          {/* Header Summary Card with Profile Photo */}
          <section className="profile-summary-card" aria-label="Profile Summary">
            {/* LEFT: Profile Photo & Camera Trigger */}
            <div className="profile-photo-wrapper">
              {photoBlobUrl ? (
                <img
                  src={photoBlobUrl}
                  alt={`${fullName} Profile`}
                  className="profile-photo-img"
                />
              ) : (
                <div className="profile-avatar-placeholder" aria-hidden="true">
                  {initials}
                </div>
              )}

              {/* Overlapping Camera Button */}
              <button
                type="button"
                className="profile-photo-camera-btn"
                onClick={handleOpenPicker}
                title="Change Profile Photo"
                aria-label="Change Profile Photo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>

              {/* Visually Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileChange}
                aria-hidden="true"
              />
            </div>

            {/* CENTER: Identity & Change Photo Button */}
            <div className="profile-summary-details">
              <div className="profile-summary-main">
                <h2 className="profile-employee-name">{fullName}</h2>
                <div className="profile-meta-row">
                  <span className="profile-employee-id-pill font-mono">
                    {employee.employee_id}
                  </span>
                  <span className="profile-meta-separator" aria-hidden="true">•</span>
                  <span className="profile-meta-text">{employee.designation || '—'}</span>
                  <span className="profile-meta-separator" aria-hidden="true">•</span>
                  <span className="profile-meta-text">{employee.department || 'General'}</span>
                </div>
              </div>

              <button
                type="button"
                className="profile-change-photo-btn"
                onClick={handleOpenPicker}
                aria-label="Change Profile Photo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Change Photo</span>
              </button>
            </div>

            {/* RIGHT: Status & Location */}
            <div className="profile-status-wrap">
              <span className={`profile-status-pill status-${employee.status?.toLowerCase() || 'active'}`}>
                <span className="status-dot" aria-hidden="true" />
                {statusFormatted}
              </span>
              <span className="profile-location-text">
                📍 {formatEmploymentValue(employee.work_location, 'Headquarters')}
              </span>
            </div>
          </section>

          {/* Section 1: Personal Information (Strictly Read-Only) */}
          <section className="profile-card" aria-labelledby="personal-info-title">
            <div className="profile-card-header">
              <div className="card-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <h3 id="personal-info-title" className="profile-card-title">
                  Personal Information
                </h3>
                <span className="profile-card-desc">Basic identification and personal contact data</span>
              </div>
            </div>

            <div className="profile-fields-grid">
              {/* First Name */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>First Name</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.first_name)}
                </div>
              </div>

              {/* Last Name */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Last Name</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.last_name)}
                </div>
              </div>

              {/* Employee ID */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Employee ID</span>
                </label>
                <div className="profile-field-readonly font-mono">
                  {employee.employee_id}
                </div>
              </div>

              {/* Official Email */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Official Email</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.email)}
                </div>
              </div>

              {/* Personal Email */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Personal Email</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.personal_email)}
                </div>
              </div>

              {/* Phone Number */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Phone Number</span>
                </label>
                <div className="profile-field-readonly font-mono">
                  {formatValue(employee.phone)}
                </div>
              </div>

              {/* Date of Birth */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Date of Birth</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.date_of_birth ? new Date(employee.date_of_birth).toLocaleDateString('en-GB') : null)}
                </div>
              </div>

              {/* Gender */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Gender</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.gender)}
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Contact Information (Strictly Read-Only) */}
          <section className="profile-card" aria-labelledby="contact-info-title">
            <div className="profile-card-header">
              <div className="card-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div>
                <h3 id="contact-info-title" className="profile-card-title">
                  Contact Information
                </h3>
                <span className="profile-card-desc">Residential address and postal details</span>
              </div>
            </div>

            <div className="profile-fields-grid">
              {/* Address */}
              <div className="profile-field-group full-width">
                <label className="profile-field-label">
                  <span>Residential Address</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.address)}
                </div>
              </div>

              {/* City */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>City</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.city)}
                </div>
              </div>

              {/* State */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>State</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.state)}
                </div>
              </div>

              {/* Pincode */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Postal / PIN Code</span>
                </label>
                <div className="profile-field-readonly font-mono">
                  {formatValue(employee.postal_code || employee.pincode)}
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Emergency Contact (Strictly Read-Only) */}
          <section className="profile-card" aria-labelledby="emergency-info-title">
            <div className="profile-card-header">
              <div className="card-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <div>
                <h3 id="emergency-info-title" className="profile-card-title">
                  Emergency Contact
                </h3>
                <span className="profile-card-desc">Primary contact person in case of an urgent emergency</span>
              </div>
            </div>

            <div className="profile-fields-grid">
              {/* Contact Name */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Contact Name</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.emergency_contact_name)}
                </div>
              </div>

              {/* Contact Number */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Contact Number</span>
                </label>
                <div className="profile-field-readonly font-mono">
                  {formatValue(employee.emergency_contact_phone || employee.emergency_contact_number)}
                </div>
              </div>

              {/* Relationship */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Relationship</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.emergency_contact_relationship)}
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Employment Information (Strictly Read-Only) */}
          <section className="profile-card" aria-labelledby="employment-info-title">
            <div className="profile-card-header">
              <div className="card-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
              </div>
              <div>
                <h3 id="employment-info-title" className="profile-card-title">
                  Employment Information
                </h3>
                <span className="profile-card-desc">
                  Company designation, reporting department, and working schedule
                </span>
              </div>
            </div>

            <div className="profile-fields-grid">
              {/* Department */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Department</span>
                </label>
                <div className="profile-field-readonly">
                  {formatEmploymentValue(employee.department)}
                </div>
              </div>

              {/* Designation */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Designation</span>
                </label>
                <div className="profile-field-readonly">
                  {formatEmploymentValue(employee.designation)}
                </div>
              </div>

              {/* Date of Joining */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Date of Joining</span>
                </label>
                <div className="profile-field-readonly">
                  {formatEmploymentValue(employee.date_of_joining ? new Date(employee.date_of_joining).toLocaleDateString('en-GB') : null)}
                </div>
              </div>

              {/* Work Location */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Work Location</span>
                </label>
                <div className="profile-field-readonly">
                  {formatEmploymentValue(employee.work_location)}
                </div>
              </div>

              {/* Employment Status */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Employment Status</span>
                </label>
                <div className="profile-field-readonly">
                  <span className={`status-pill-inline status-${employee.status?.toLowerCase() || 'active'}`}>
                    {statusFormatted}
                  </span>
                </div>
              </div>

              {/* Working Days */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  <span>Working Schedule</span>
                </label>
                <div className="profile-field-readonly">
                  {employee.working_days_per_week === 6
                    ? '6 days / week (Mon - Sat)'
                    : '5 days / week (Mon - Fri)'}
                </div>
              </div>
            </div>
          </section>

          {/* Section 5: Bank Details */}
          <section className="profile-card" aria-labelledby="bank-details-title">
            <div className="profile-card-header">
              <div className="card-header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <div>
                <h3 id="bank-details-title" className="profile-card-title">
                  Bank Details
                </h3>
                <span className="profile-card-desc">
                  Salary disbursement account and branch information
                </span>
              </div>
            </div>

            {employee.bank_details ? (
              <div className="profile-fields-grid">
                {/* Account Holder Name */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Account Holder Name</span>
                  </label>
                  <div className="profile-field-readonly">
                    {formatValue(employee.bank_details.account_holder_name)}
                  </div>
                </div>

                {/* Bank Name */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Bank Name</span>
                  </label>
                  <div className="profile-field-readonly">
                    {formatValue(employee.bank_details.bank_name)}
                  </div>
                </div>

                {/* Account Number (Masked) */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Account Number</span>
                  </label>
                  <div className="profile-field-readonly font-mono">
                    {formatValue(employee.bank_details.account_number)}
                  </div>
                </div>

                {/* IFSC Code */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>IFSC Code</span>
                  </label>
                  <div className="profile-field-readonly font-mono">
                    {formatValue(employee.bank_details.ifsc_code)}
                  </div>
                </div>

                {/* Branch Name */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Branch Name</span>
                  </label>
                  <div className="profile-field-readonly">
                    {formatValue(employee.bank_details.branch_name)}
                  </div>
                </div>

                {/* Branch City */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Branch City</span>
                  </label>
                  <div className="profile-field-readonly">
                    {formatValue(employee.bank_details.branch_city)}
                  </div>
                </div>

                {/* Branch State */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Branch State</span>
                  </label>
                  <div className="profile-field-readonly">
                    {formatValue(employee.bank_details.branch_state)}
                  </div>
                </div>

                {/* Account Type */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Account Type</span>
                  </label>
                  <div className="profile-field-readonly">
                    {formatValue(employee.bank_details.account_type, 'Savings')}
                  </div>
                </div>

                {/* Verification Status */}
                <div className="profile-field-group">
                  <label className="profile-field-label">
                    <span>Verification Status</span>
                  </label>
                  <div className="profile-field-readonly">
                    <span className={`status-pill-inline status-${employee.bank_details.verification_status?.toLowerCase() || 'pending'}`}>
                      {employee.bank_details.verification_status === 'Pending'
                        ? 'Pending Verification'
                        : (employee.bank_details.verification_status || 'Pending Verification')}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="profile-empty-state-notice">
                <p>Bank details have not been added yet.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* Photo Preview & Confirmation Modal */}
      {isPreviewOpen && previewUrl && (
        <div className="photo-preview-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="preview-title">
          <div className="photo-preview-modal-card">
            <div className="photo-preview-modal-header">
              <h3 id="preview-title" className="photo-preview-modal-title">
                Change Profile Photo
              </h3>
              <button
                type="button"
                className="photo-preview-modal-close"
                onClick={handleClosePreview}
                aria-label="Close photo preview"
                disabled={isUploadingPhoto}
              >
                &times;
              </button>
            </div>

            <div className="photo-preview-crop-container">
              <img
                src={previewUrl}
                alt="Selected profile photo preview"
              />
            </div>

            <p className="photo-preview-modal-desc">
              Preview your new profile picture above. The photo will be cropped to a circle and displayed across the portal.
            </p>

            <div className="photo-preview-modal-actions">
              <button
                type="button"
                className="profile-btn-secondary"
                onClick={handleClosePreview}
                disabled={isUploadingPhoto}
              >
                Cancel
              </button>
              <button
                type="button"
                className="profile-btn-primary"
                onClick={handleConfirmUpload}
                disabled={isUploadingPhoto}
              >
                {isUploadingPhoto ? (
                  <>
                    <span className="photo-uploading-spinner" aria-hidden="true" />
                    Uploading...
                  </>
                ) : (
                  'Upload Photo'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
