import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../../../services/api';
import './WorkAttendanceSettings.css';

const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const DEFAULT_SETTINGS = {
  default_work_week: '5-Day Work Week',
  default_work_start_time: '09:30',
  default_work_end_time: '18:30',
  default_break_duration_minutes: 60,
  default_weekly_off_days: ['Saturday', 'Sunday'],
  allow_half_day: true,
  allow_work_from_home: true,
};

function WorkAttendanceSettings() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState(DEFAULT_SETTINGS);
  const [initialData, setInitialData] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Fetch current organization work & attendance configuration
  useEffect(() => {
    let isMounted = true;

    api.admin.settings.workAttendance
      .get()
      .then((res) => {
        if (!isMounted) return;
        if (res && res.success && res.data) {
          const raw = res.data;
          const normalized = {
            default_work_week: raw.default_work_week || '5-Day Work Week',
            default_work_start_time: (raw.default_work_start_time || '09:30').slice(0, 5),
            default_work_end_time: (raw.default_work_end_time || '18:30').slice(0, 5),
            default_break_duration_minutes: Number(raw.default_break_duration_minutes ?? 60),
            default_weekly_off_days: Array.isArray(raw.default_weekly_off_days)
              ? raw.default_weekly_off_days
              : ['Saturday', 'Sunday'],
            allow_half_day: Boolean(raw.allow_half_day),
            allow_work_from_home: Boolean(raw.allow_work_from_home),
          };
          setFormData(normalized);
          setInitialData(normalized);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Failed to load work & attendance settings:', err);
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
    if (formData.default_work_week !== initialData.default_work_week) return true;
    if (formData.default_work_start_time !== initialData.default_work_start_time) return true;
    if (formData.default_work_end_time !== initialData.default_work_end_time) return true;
    if (Number(formData.default_break_duration_minutes) !== Number(initialData.default_break_duration_minutes)) return true;
    if (formData.allow_half_day !== initialData.allow_half_day) return true;
    if (formData.allow_work_from_home !== initialData.allow_work_from_home) return true;

    const currentDays = [...formData.default_weekly_off_days].sort().join(',');
    const initialDays = [...initialData.default_weekly_off_days].sort().join(',');
    return currentDays !== initialDays;
  }, [formData, initialData]);

  // Generic input change
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (error) setError(null);
    if (successMessage) setSuccessMessage(null);
  };

  // Weekly off toggle
  const handleToggleWeeklyOff = (day) => {
    setFormData((prev) => {
      const exists = prev.default_weekly_off_days.includes(day);
      let updated;
      if (exists) {
        updated = prev.default_weekly_off_days.filter((d) => d !== day);
      } else {
        updated = [...prev.default_weekly_off_days, day];
      }
      return {
        ...prev,
        default_weekly_off_days: updated,
      };
    });
    if (error) setError(null);
    if (successMessage) setSuccessMessage(null);
  };

  // Revert form to initial saved values
  const handleCancel = () => {
    setFormData(initialData);
    setError(null);
    setSuccessMessage(null);
  };

  // Back navigation with unsaved changes prompt
  const handleBack = (e) => {
    e.preventDefault();
    if (isDirty) {
      const confirmLeave = window.confirm(
        'You have unsaved changes on Work & Attendance Settings. Are you sure you want to return to Settings?'
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
    if (!['5-Day Work Week', '6-Day Work Week'].includes(formData.default_work_week)) {
      setError('Please select a valid Default Work Week (5-Day or 6-Day).');
      return;
    }

    if (!formData.default_work_start_time || !formData.default_work_end_time) {
      setError('Both Work Start Time and Work End Time are required.');
      return;
    }

    if (formData.default_work_start_time === formData.default_work_end_time) {
      setError('Work start time and end time cannot be identical.');
      return;
    }

    const breakMins = Number(formData.default_break_duration_minutes);
    if (isNaN(breakMins) || breakMins < 0 || breakMins > 480) {
      setError('Break duration must be an integer between 0 and 480 minutes.');
      return;
    }

    if (!formData.default_weekly_off_days || formData.default_weekly_off_days.length === 0) {
      setError('At least one weekly off day must be selected.');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        default_work_week: formData.default_work_week,
        default_work_start_time: `${formData.default_work_start_time}:00`,
        default_work_end_time: `${formData.default_work_end_time}:00`,
        default_break_duration_minutes: breakMins,
        default_weekly_off_days: formData.default_weekly_off_days,
        allow_half_day: Boolean(formData.allow_half_day),
        allow_work_from_home: Boolean(formData.allow_work_from_home),
      };

      const res = await api.admin.settings.workAttendance.update(payload);
      if (res && res.success) {
        const raw = res.data;
        const saved = {
          default_work_week: raw.default_work_week || formData.default_work_week,
          default_work_start_time: (raw.default_work_start_time || formData.default_work_start_time).slice(0, 5),
          default_work_end_time: (raw.default_work_end_time || formData.default_work_end_time).slice(0, 5),
          default_break_duration_minutes: Number(raw.default_break_duration_minutes ?? breakMins),
          default_weekly_off_days: Array.isArray(raw.default_weekly_off_days)
            ? raw.default_weekly_off_days
            : formData.default_weekly_off_days,
          allow_half_day: Boolean(raw.allow_half_day),
          allow_work_from_home: Boolean(raw.allow_work_from_home),
        };
        setFormData(saved);
        setInitialData(saved);
        setSuccessMessage('Work & Attendance settings updated successfully.');
      }
    } catch (err) {
      console.error('Failed to save work & attendance settings:', err);
      setError(err.message || 'Failed to save changes. Please review your input.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-work-settings-page">
      {/* Navigation & Breadcrumb */}
      <div className="admin-work-settings-top-nav">
        <button
          type="button"
          onClick={handleBack}
          className="admin-work-settings-back-btn"
          aria-label="Back to Settings landing hub"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Settings
        </button>

        <div className="admin-work-settings-breadcrumbs" aria-label="Breadcrumbs">
          <Link to="/admin/settings">Settings</Link>
          <span className="separator" aria-hidden="true">/</span>
          <span className="current">Work &amp; Attendance</span>
        </div>
      </div>

      {/* Header Card */}
      <div className="admin-work-settings-header-card">
        <div className="admin-work-settings-title-group">
          <h1 className="admin-work-settings-title">Work &amp; Attendance Settings</h1>
          <p className="admin-work-settings-subtitle">
            Configure organization-wide default working schedules and attendance rules.
          </p>
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="admin-work-settings-alert admin-work-settings-alert-success" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div>{successMessage}</div>
          <button
            type="button"
            className="admin-work-settings-alert-close"
            onClick={() => setSuccessMessage(null)}
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Notification */}
      {error && (
        <div className="admin-work-settings-alert admin-work-settings-alert-error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>{error}</div>
          <button
            type="button"
            className="admin-work-settings-alert-close"
            onClick={() => setError(null)}
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="admin-work-settings-loading-card">
          <div className="admin-work-settings-spinner" aria-hidden="true" />
          <span>Loading work &amp; attendance configuration...</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="admin-work-settings-form">
          {/* SECTION 1: Default Work Schedule */}
          <div className="admin-work-settings-section-card">
            <div className="admin-work-settings-section-header">
              <div className="admin-work-settings-section-icon" aria-hidden="true">
                📅
              </div>
              <div>
                <h2 className="admin-work-settings-section-title">SECTION 1: Default Work Schedule</h2>
                <p className="admin-work-settings-section-desc">
                  Working days per week, standard shift hours, and typical meal break duration.
                </p>
              </div>
            </div>

            {/* Default Work Week Options */}
            <div className="admin-work-settings-field-group">
              <label className="admin-work-settings-label">
                Default Work Week <span className="admin-work-settings-required">*</span>
              </label>
              <div className="admin-work-week-selector">
                <label
                  className={`admin-work-week-option ${formData.default_work_week === '5-Day Work Week' ? 'admin-work-week-option-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="default_work_week"
                    value="5-Day Work Week"
                    checked={formData.default_work_week === '5-Day Work Week'}
                    onChange={handleChange}
                    disabled={saving}
                  />
                  <div className="admin-work-week-option-text">
                    <span className="admin-work-week-title">5-Day Work Week</span>
                    <span className="admin-work-week-desc">Monday to Friday (Saturday &amp; Sunday regular weekly offs).</span>
                  </div>
                </label>

                <label
                  className={`admin-work-week-option ${formData.default_work_week === '6-Day Work Week' ? 'admin-work-week-option-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="default_work_week"
                    value="6-Day Work Week"
                    checked={formData.default_work_week === '6-Day Work Week'}
                    onChange={handleChange}
                    disabled={saving}
                  />
                  <div className="admin-work-week-option-text">
                    <span className="admin-work-week-title">6-Day Work Week</span>
                    <span className="admin-work-week-desc">Monday to Saturday (Sunday regular weekly off).</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Timings and Break Grid */}
            <div className="admin-work-settings-grid-3">
              <div className="admin-work-settings-field-group">
                <label htmlFor="default_work_start_time" className="admin-work-settings-label">
                  Work Start Time <span className="admin-work-settings-required">*</span>
                </label>
                <input
                  type="time"
                  id="default_work_start_time"
                  name="default_work_start_time"
                  value={formData.default_work_start_time}
                  onChange={handleChange}
                  required
                  className="admin-work-settings-input"
                  disabled={saving}
                />
                <span className="admin-work-settings-hint">Expected daily shift check-in time.</span>
              </div>

              <div className="admin-work-settings-field-group">
                <label htmlFor="default_work_end_time" className="admin-work-settings-label">
                  Work End Time <span className="admin-work-settings-required">*</span>
                </label>
                <input
                  type="time"
                  id="default_work_end_time"
                  name="default_work_end_time"
                  value={formData.default_work_end_time}
                  onChange={handleChange}
                  required
                  className="admin-work-settings-input"
                  disabled={saving}
                />
                <span className="admin-work-settings-hint">Expected daily shift check-out time.</span>
              </div>

              <div className="admin-work-settings-field-group">
                <label htmlFor="default_break_duration_minutes" className="admin-work-settings-label">
                  Default Break Duration (Minutes) <span className="admin-work-settings-required">*</span>
                </label>
                <input
                  type="number"
                  id="default_break_duration_minutes"
                  name="default_break_duration_minutes"
                  value={formData.default_break_duration_minutes}
                  onChange={handleChange}
                  min={0}
                  max={480}
                  step={5}
                  required
                  className="admin-work-settings-input"
                  placeholder="60"
                  disabled={saving}
                />
                <span className="admin-work-settings-hint">Standard lunch &amp; recess minutes per shift.</span>
              </div>
            </div>
          </div>

          {/* SECTION 2: Default Weekly Off */}
          <div className="admin-work-settings-section-card">
            <div className="admin-work-settings-section-header">
              <div className="admin-work-settings-section-icon" aria-hidden="true">
                🏖️
              </div>
              <div>
                <h2 className="admin-work-settings-section-title">SECTION 2: Default Weekly Off</h2>
                <p className="admin-work-settings-section-desc">
                  Select default non-working days for organization calendars and schedules.
                </p>
              </div>
            </div>

            <div className="admin-weekly-off-grid">
              {DAYS_OF_WEEK.map((day) => {
                const isChecked = formData.default_weekly_off_days.includes(day);
                return (
                  <label
                    key={day}
                    className={`admin-weekly-off-checkbox-card ${isChecked ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleWeeklyOff(day)}
                      disabled={saving}
                    />
                    <span className="admin-weekly-off-day-name">{day}</span>
                  </label>
                );
              })}
            </div>

            <div className="admin-work-settings-callout" role="note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div>
                <strong>Important Distinction:</strong> Weekly Off is different from an Organization Holiday. Weekly Off days do not count as Absent or Leave, and are distinct from declared public holidays.
              </div>
            </div>
          </div>

          {/* SECTION 3: Attendance Rules */}
          <div className="admin-work-settings-section-card">
            <div className="admin-work-settings-section-header">
              <div className="admin-work-settings-section-icon" aria-hidden="true">
                ⚙️
              </div>
              <div>
                <h2 className="admin-work-settings-section-title">SECTION 3: Attendance Rules</h2>
                <p className="admin-work-settings-section-desc">
                  Organization-level attendance options and flexible work permissions.
                </p>
              </div>
            </div>

            <div className="admin-attendance-rules-list">
              <div className="admin-attendance-rule-row">
                <div className="admin-attendance-rule-info">
                  <span className="admin-attendance-rule-title">Allow Half Day</span>
                  <span className="admin-attendance-rule-desc">
                    Permit employees to log Half Day attendance and apply for half-day leaves.
                  </span>
                </div>
                <label className="admin-toggle-switch">
                  <input
                    type="checkbox"
                    name="allow_half_day"
                    checked={formData.allow_half_day}
                    onChange={handleChange}
                    disabled={saving}
                    aria-label="Toggle Allow Half Day"
                  />
                  <span className="admin-toggle-slider" />
                </label>
              </div>

              <div className="admin-attendance-rule-row">
                <div className="admin-attendance-rule-info">
                  <span className="admin-attendance-rule-title">Allow Work From Home (WFH)</span>
                  <span className="admin-attendance-rule-desc">
                    Permit remote attendance marking and Work From Home status tracking.
                  </span>
                </div>
                <label className="admin-toggle-switch">
                  <input
                    type="checkbox"
                    name="allow_work_from_home"
                    checked={formData.allow_work_from_home}
                    onChange={handleChange}
                    disabled={saving}
                    aria-label="Toggle Allow Work From Home"
                  />
                  <span className="admin-toggle-slider" />
                </label>
              </div>
            </div>
          </div>

          {/* SECTION 4: Information */}
          <div className="admin-work-settings-section-card">
            <div className="admin-work-settings-section-header">
              <div className="admin-work-settings-section-icon" aria-hidden="true">
                ℹ️
              </div>
              <div>
                <h2 className="admin-work-settings-section-title">SECTION 4: Information</h2>
                <p className="admin-work-settings-section-desc">
                  Operational boundaries and schedule hierarchy guidance.
                </p>
              </div>
            </div>

            <div className="admin-work-settings-callout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <div>
                <p style={{ margin: '0 0 0.5rem 0' }}>
                  These settings define organization-wide defaults. Employee-specific schedules configured in Employee Configuration are not automatically changed when these defaults are updated.
                </p>
                <p style={{ margin: 0, fontStyle: 'italic', color: '#64748b' }}>
                  Organization holidays are managed through Holiday Calendar.
                </p>
              </div>
            </div>
          </div>

          {/* Form Actions Card */}
          <div className="admin-work-settings-actions-card">
            <div className="admin-work-settings-dirty-status">
              {isDirty ? (
                <>
                  <span className="admin-work-settings-dirty-dot" aria-hidden="true" />
                  <span>Unsaved changes</span>
                </>
              ) : (
                <>
                  <span className="admin-work-settings-clean-dot" aria-hidden="true" />
                  <span>All changes saved</span>
                </>
              )}
            </div>

            <div className="admin-work-settings-btn-group">
              <button
                type="button"
                onClick={handleCancel}
                className="admin-work-settings-btn admin-work-settings-btn-cancel"
                disabled={!isDirty || saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="admin-work-settings-btn admin-work-settings-btn-primary"
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

export default WorkAttendanceSettings;
