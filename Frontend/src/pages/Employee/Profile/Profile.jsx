import { useState, useEffect, useRef } from 'react';
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

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    personalEmail: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
  });

  // Profile Photo State
  const [photoBlobUrl, setPhotoBlobUrl] = useState(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 4000);
  };

  // Load employee profile & photo
  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.employee.getProfile();
      if (res && res.success && res.data) {
        setEmployee(res.data);
        syncFormData(res.data);
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
  };

  const loadProfilePhoto = async () => {
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
      // Photo fetch error (non-critical, fallback to initials avatar)
      setPhotoBlobUrl(null);
    }
  };

  const syncFormData = (data) => {
    setFormData({
      personalEmail: data.personal_email || '',
      phone: data.phone || '',
      address: data.address || '',
      city: data.city || '',
      state: data.state || '',
      pincode: data.postal_code || data.pincode || '',
      emergencyContactName: data.emergency_contact_name || '',
      emergencyContactPhone: data.emergency_contact_phone || data.emergency_contact_number || '',
      emergencyContactRelationship: data.emergency_contact_relationship || '',
    });
  };

  const photoBlobUrlRef = useRef(null);
  useEffect(() => {
    photoBlobUrlRef.current = photoBlobUrl;
  }, [photoBlobUrl]);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.employee.getProfile();
        if (!ignore) {
          if (res && res.success && res.data) {
            setEmployee(res.data);
            syncFormData(res.data);
            if (res.data.has_profile_photo) {
              loadProfilePhoto();
            }
          } else {
            setError(res?.message || 'Unable to load profile.');
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err.message || 'Unable to load profile.');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      ignore = true;
      if (photoBlobUrlRef.current) {
        URL.revokeObjectURL(photoBlobUrlRef.current);
      }
    };
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleStartEdit = () => {
    if (employee) {
      syncFormData(employee);
    }
    setErrorMessage('');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (employee) {
      syncFormData(employee);
    }
    setErrorMessage('');
    setIsEditing(false);
  };

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    // Client-side validations
    if (formData.personalEmail && formData.personalEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.personalEmail.trim())) {
        setErrorMessage('Please enter a valid personal email address.');
        return;
      }
    }

    if (formData.phone && formData.phone.trim()) {
      const cleanPhone = formData.phone.trim().replace(/[\s-]/g, '');
      if (!/^\d{10}$/.test(cleanPhone)) {
        setErrorMessage('Phone number must be a valid 10-digit number.');
        return;
      }
    }

    if (formData.pincode && formData.pincode.trim()) {
      const cleanPincode = formData.pincode.trim().replace(/\s/g, '');
      if (!/^\d{6}$/.test(cleanPincode)) {
        setErrorMessage('Pincode must be exactly 6 numeric digits.');
        return;
      }
    }

    if (formData.emergencyContactPhone && formData.emergencyContactPhone.trim()) {
      const cleanEmerPhone = formData.emergencyContactPhone.trim().replace(/[\s-]/g, '');
      if (!/^\d{10}$/.test(cleanEmerPhone)) {
        setErrorMessage('Emergency contact phone must be a valid 10-digit number.');
        return;
      }
    }

    try {
      setIsSaving(true);
      const payload = {
        personal_email: formData.personalEmail.trim() || null,
        phone: formData.phone.trim() || null,
        address: formData.address.trim() || null,
        city: formData.city.trim() || null,
        state: formData.state.trim() || null,
        postal_code: formData.pincode.trim() || null,
        emergency_contact_name: formData.emergencyContactName.trim() || null,
        emergency_contact_phone: formData.emergencyContactPhone.trim() || null,
        emergency_contact_relationship: formData.emergencyContactRelationship.trim() || null,
      };

      const res = await api.employee.updateProfile(payload);
      if (res && res.success && res.data) {
        setEmployee(res.data);
        syncFormData(res.data);
        setIsEditing(false);
        showToast('Profile updated successfully.');
      } else {
        setErrorMessage(res?.message || 'Failed to update profile.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'An error occurred while updating profile.');
    } finally {
      setIsSaving(false);
    }
  };

  // Profile Photo Upload Handler
  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setErrorMessage('Invalid image type. Please select a JPEG, PNG, or WebP image.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Image size exceeds the 5 MB limit.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setIsUploadingPhoto(true);
      setErrorMessage('');
      const photoFormData = new FormData();
      photoFormData.append('photo', file);

      const res = await api.employee.uploadProfilePhoto(photoFormData);
      if (res && res.success) {
        showToast('Profile photo updated successfully.');
        await loadProfilePhoto();
        setEmployee((prev) => (prev ? { ...prev, has_profile_photo: true } : prev));
      } else {
        setErrorMessage(res?.message || 'Failed to upload profile photo.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Error uploading profile photo.');
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
            View your personal details, contact information, and official employment records.
          </p>
        </div>

        {!isEditing && !loading && employee && (
          <button
            type="button"
            className="profile-edit-btn"
            onClick={handleStartEdit}
            aria-label="Edit Profile"
          >
            <svg
              className="profile-edit-icon"
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
            <span>Edit Profile</span>
          </button>
        )}
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
        <form onSubmit={handleSaveChanges} noValidate className="profile-form-container">
          {/* Header Summary Card with Profile Photo */}
          <section className="profile-summary-card" aria-label="Profile Summary">
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

              {/* Photo Upload Trigger */}
              <input
                ref={fileInputRef}
                type="file"
                id="profilePhotoUpload"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoSelect}
                disabled={isUploadingPhoto}
              />
              <label
                htmlFor="profilePhotoUpload"
                className={`profile-photo-change-btn ${isUploadingPhoto ? 'uploading' : ''}`}
                title="Change Profile Photo"
                aria-label="Change Profile Photo"
              >
                {isUploadingPhoto ? (
                  <span className="photo-spinner" aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
              </label>
            </div>

            <div className="profile-summary-details">
              <div className="profile-summary-main">
                <h2 className="profile-employee-name">{fullName}</h2>
                <div className="profile-meta-row">
                  <span className="profile-employee-id-pill font-mono">
                    {employee.employee_id}
                  </span>
                  <span className="profile-meta-separator" aria-hidden="true">•</span>
                  <span className="profile-meta-text">{employee.designation || 'Staff'}</span>
                  <span className="profile-meta-separator" aria-hidden="true">•</span>
                  <span className="profile-meta-text">{employee.department || 'General'}</span>
                </div>
              </div>

              <div className="profile-status-wrap">
                <span className={`profile-status-pill status-${employee.status?.toLowerCase() || 'active'}`}>
                  <span className="status-dot" aria-hidden="true" />
                  {statusFormatted}
                </span>
                <span className="profile-location-text">
                  📍 {formatEmploymentValue(employee.work_location, 'Headquarters')}
                </span>
              </div>
            </div>
          </section>

          {/* Section 1: Personal Information */}
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
              {/* First Name (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  First Name <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.first_name)}
                </div>
              </div>

              {/* Last Name (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Last Name <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.last_name)}
                </div>
              </div>

              {/* Employee ID (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Employee ID <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly font-mono font-semibold">
                  {employee.employee_id}
                </div>
              </div>

              {/* Official Email (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Official Email <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.email)}
                </div>
              </div>

              {/* Personal Email (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-personal-email" className="profile-field-label">
                  Personal Email {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-personal-email"
                    type="email"
                    name="personalEmail"
                    className="profile-field-input"
                    value={formData.personalEmail}
                    onChange={handleInputChange}
                    placeholder="e.g. name@example.com"
                  />
                ) : (
                  <div className="profile-field-readonly">
                    {formatValue(employee.personal_email)}
                  </div>
                )}
              </div>

              {/* Phone Number (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-phone" className="profile-field-label">
                  Phone Number {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-phone"
                    type="tel"
                    name="phone"
                    className="profile-field-input font-mono"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="10-digit mobile number"
                    maxLength={10}
                  />
                ) : (
                  <div className="profile-field-readonly font-mono">
                    {formatValue(employee.phone)}
                  </div>
                )}
              </div>

              {/* Date of Birth (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Date of Birth <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.date_of_birth)}
                </div>
              </div>

              {/* Gender (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Gender <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {formatValue(employee.gender)}
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Contact Information */}
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
              {/* Address (Editable, Full Width) */}
              <div className="profile-field-group full-width">
                <label htmlFor="field-address" className="profile-field-label">
                  Residential Address {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <textarea
                    id="field-address"
                    name="address"
                    rows={2}
                    className="profile-field-textarea"
                    value={formData.address}
                    onChange={handleInputChange}
                    placeholder="Street address, apartment, or flat number"
                  />
                ) : (
                  <div className="profile-field-readonly">
                    {formatValue(employee.address)}
                  </div>
                )}
              </div>

              {/* City (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-city" className="profile-field-label">
                  City {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-city"
                    type="text"
                    name="city"
                    className="profile-field-input"
                    value={formData.city}
                    onChange={handleInputChange}
                    placeholder="City"
                  />
                ) : (
                  <div className="profile-field-readonly">
                    {formatValue(employee.city)}
                  </div>
                )}
              </div>

              {/* State (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-state" className="profile-field-label">
                  State {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-state"
                    type="text"
                    name="state"
                    className="profile-field-input"
                    value={formData.state}
                    onChange={handleInputChange}
                    placeholder="State / Province"
                  />
                ) : (
                  <div className="profile-field-readonly">
                    {formatValue(employee.state)}
                  </div>
                )}
              </div>

              {/* Pincode (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-pincode" className="profile-field-label">
                  Pincode {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-pincode"
                    type="text"
                    name="pincode"
                    className="profile-field-input font-mono"
                    value={formData.pincode}
                    onChange={handleInputChange}
                    placeholder="6-digit pincode"
                    maxLength={6}
                  />
                ) : (
                  <div className="profile-field-readonly font-mono">
                    {formatValue(employee.postal_code || employee.pincode)}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section 3: Emergency Contact */}
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
              {/* Emergency Contact Name (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-emer-name" className="profile-field-label">
                  Contact Name {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-emer-name"
                    type="text"
                    name="emergencyContactName"
                    className="profile-field-input"
                    value={formData.emergencyContactName}
                    onChange={handleInputChange}
                    placeholder="Full name of emergency contact"
                  />
                ) : (
                  <div className="profile-field-readonly">
                    {formatValue(employee.emergency_contact_name)}
                  </div>
                )}
              </div>

              {/* Emergency Contact Number (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-emer-phone" className="profile-field-label">
                  Contact Number {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-emer-phone"
                    type="tel"
                    name="emergencyContactPhone"
                    className="profile-field-input font-mono"
                    value={formData.emergencyContactPhone}
                    onChange={handleInputChange}
                    placeholder="10-digit mobile number"
                    maxLength={10}
                  />
                ) : (
                  <div className="profile-field-readonly font-mono">
                    {formatValue(employee.emergency_contact_phone || employee.emergency_contact_number)}
                  </div>
                )}
              </div>

              {/* Emergency Contact Relationship (Editable) */}
              <div className="profile-field-group">
                <label htmlFor="field-emer-rel" className="profile-field-label">
                  Relationship {isEditing && <span className="editable-badge">Editable</span>}
                </label>
                {isEditing ? (
                  <input
                    id="field-emer-rel"
                    type="text"
                    name="emergencyContactRelationship"
                    className="profile-field-input"
                    value={formData.emergencyContactRelationship}
                    onChange={handleInputChange}
                    placeholder="e.g. Spouse, Parent, Sibling"
                  />
                ) : (
                  <div className="profile-field-readonly">
                    {formatValue(employee.emergency_contact_relationship)}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section 4: Employment Information (All Strictly Read-Only) */}
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
              {/* Department (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Department <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly font-medium">
                  {formatEmploymentValue(employee.department)}
                </div>
              </div>

              {/* Designation (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Designation <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly font-medium">
                  {formatEmploymentValue(employee.designation)}
                </div>
              </div>

              {/* Date of Joining (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Date of Joining <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {formatEmploymentValue(employee.date_of_joining)}
                </div>
              </div>

              {/* Work Location (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Work Location <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {formatEmploymentValue(employee.work_location)}
                </div>
              </div>

              {/* Employment Status (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Employment Status <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  <span className={`status-pill-inline status-${employee.status?.toLowerCase() || 'active'}`}>
                    {statusFormatted}
                  </span>
                </div>
              </div>

              {/* Working Days (Read-Only) */}
              <div className="profile-field-group">
                <label className="profile-field-label">
                  Working Schedule <span className="readonly-badge">Read-only</span>
                </label>
                <div className="profile-field-readonly">
                  {employee.working_days_per_week === 6
                    ? '6 days / week (Mon - Sat)'
                    : '5 days / week (Mon - Fri)'}
                </div>
              </div>
            </div>
          </section>

          {/* Bottom Edit Action Controls */}
          {isEditing && (
            <div className="profile-edit-actions-bar">
              <button
                type="button"
                className="profile-btn-secondary"
                onClick={handleCancelEdit}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="profile-btn-primary"
                disabled={isSaving}
              >
                {isSaving ? 'Saving Changes...' : 'Save Changes'}
              </button>
            </div>
          )}
        </form>
      ) : null}
    </div>
  );
}
