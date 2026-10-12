import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../../../services/api';
import './HolidayCalendar.css';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  const d = new Date(year, month, day);
  const dayName = DAY_NAMES[d.getDay()] || '';
  const monthName = MONTH_NAMES[month] || '';
  return {
    formatted: `${day} ${monthName} ${year}`,
    dayName,
  };
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const CURRENT_YEAR = new Date().getFullYear();
const TODAY_STR = getTodayString();

function HolidayCalendar() {
  const navigate = useNavigate();

  const [holidays, setHolidays] = useState([]);
  const [allHolidays, setAllHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  // Filters
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));
  const [selectedStatus, setSelectedStatus] = useState('All');

  // Attendance application tracking: { [holiday_date]: boolean (isMarked) }
  const [appliedDates, setAppliedDates] = useState({});
  const [activeEmployeeCount, setActiveEmployeeCount] = useState(0);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isMarkModalOpen, setIsMarkModalOpen] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    holiday_name: '',
    holiday_date: '',
    description: '',
  });
  const [editHoliday, setEditHoliday] = useState(null);
  const [deleteHoliday, setDeleteHoliday] = useState(null);
  const [markTargetHoliday, setMarkTargetHoliday] = useState(null);
  const [markRemarks, setMarkRemarks] = useState('');
  const [markConflictWarning, setMarkConflictWarning] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState(null);

  const triggerRefresh = useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  // Fetch all holidays (for metric cards) and filtered holidays
  useEffect(() => {
    let isMounted = true;

    Promise.all([
      api.admin.settings.holidays.get({ year: 'All' }),
      api.admin.settings.holidays.get({
        year: selectedYear,
        status: selectedStatus === 'All' ? undefined : selectedStatus,
      }),
      api.admin.getEmployees({ status: 'ACTIVE', limit: 1 }).catch(() => null),
    ])
      .then(([allRes, filteredRes, empRes]) => {
        if (!isMounted) return;
        if (allRes && allRes.success) {
          setAllHolidays(allRes.data || []);
        }
        if (filteredRes && filteredRes.success) {
          setHolidays(filteredRes.data || []);
        }
        if (empRes && empRes.pagination) {
          setActiveEmployeeCount(empRes.pagination.total || 0);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Failed to load holidays:', err);
        setError(err.message || 'Failed to load organization holidays.');
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedYear, selectedStatus, refreshIndex]);

  // Check attendance status for visible holidays
  useEffect(() => {
    if (!holidays || holidays.length === 0) return;

    let isMounted = true;
    const checkAttendance = async () => {
      const updatedMap = {};
      for (const h of holidays) {
        try {
          const attRes = await api.admin.getAttendance(h.holiday_date);
          if (attRes && attRes.summary) {
            const { holiday, total } = attRes.summary;
            if (holiday > 0 && holiday === total) {
              updatedMap[h.holiday_date] = true;
            }
          }
        } catch {
          // ignore individual check failures
        }
      }
      if (isMounted) {
        setAppliedDates((prev) => ({ ...prev, ...updatedMap }));
      }
    };

    checkAttendance();
    return () => {
      isMounted = false;
    };
  }, [holidays]);

  // Metric summaries
  const metrics = useMemo(() => {
    const upcoming = allHolidays.filter((h) => h.holiday_date >= TODAY_STR).length;
    const thisYearCount = allHolidays.filter((h) => h.holiday_date.startsWith(String(CURRENT_YEAR))).length;
    const past = allHolidays.filter((h) => h.holiday_date < TODAY_STR).length;
    return { upcoming, thisYearCount, past };
  }, [allHolidays]);

  // Available year options (e.g. current - 1, current, current + 1)
  const yearOptions = useMemo(() => {
    return [
      String(CURRENT_YEAR - 1),
      String(CURRENT_YEAR),
      String(CURRENT_YEAR + 1),
      'All',
    ];
  }, []);

  // Open Add Modal
  const handleOpenAddModal = () => {
    setFormData({
      holiday_name: '',
      holiday_date: '',
      description: '',
    });
    setModalError(null);
    setIsAddModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (holiday) => {
    setEditHoliday(holiday);
    setFormData({
      holiday_name: holiday.holiday_name || '',
      holiday_date: holiday.holiday_date || '',
      description: holiday.description || '',
    });
    setModalError(null);
    setIsEditModalOpen(true);
  };

  // Open Delete Modal
  const handleOpenDeleteModal = (holiday) => {
    setDeleteHoliday(holiday);
    setModalError(null);
    setIsDeleteModalOpen(true);
  };

  // Open Mark Attendance Modal
  const handleOpenMarkModal = (holiday) => {
    setMarkTargetHoliday(holiday);
    setMarkRemarks(holiday.holiday_name || 'Organization Holiday');
    setMarkConflictWarning(null);
    setModalError(null);
    setIsMarkModalOpen(true);
  };

  // Handle Add Holiday Submit
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setModalError(null);

    const name = formData.holiday_name.trim();
    const date = formData.holiday_date.trim();
    const desc = formData.description ? formData.description.trim() : '';

    if (!name) {
      setModalError('Holiday name is required.');
      return;
    }
    if (!date) {
      setModalError('Holiday date is required.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.admin.settings.holidays.create({
        holiday_name: name,
        holiday_date: date,
        description: desc || null,
      });

      if (res && res.success) {
        setIsAddModalOpen(false);
        setSuccessMessage(`Holiday "${name}" created successfully.`);
        triggerRefresh();
      }
    } catch (err) {
      console.error('Failed to create holiday:', err);
      setModalError(err.message || 'Failed to create organization holiday.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Edit Holiday Submit
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editHoliday) return;
    setModalError(null);

    const name = formData.holiday_name.trim();
    const date = formData.holiday_date.trim();
    const desc = formData.description ? formData.description.trim() : '';

    if (!name) {
      setModalError('Holiday name is required.');
      return;
    }
    if (!date) {
      setModalError('Holiday date is required.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.admin.settings.holidays.update(editHoliday.id, {
        holiday_name: name,
        holiday_date: date,
        description: desc || null,
      });

      if (res && res.success) {
        setIsEditModalOpen(false);
        setSuccessMessage(`Holiday "${name}" updated successfully.`);
        triggerRefresh();
      }
    } catch (err) {
      console.error('Failed to update holiday:', err);
      setModalError(err.message || 'Failed to update organization holiday.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Delete Holiday Submit
  const handleDeleteSubmit = async () => {
    if (!deleteHoliday) return;
    setModalError(null);

    try {
      setSubmitting(true);
      const res = await api.admin.settings.holidays.delete(deleteHoliday.id);
      if (res && res.success) {
        setIsDeleteModalOpen(false);
        setSuccessMessage(`Holiday "${deleteHoliday.holiday_name}" deleted successfully.`);
        triggerRefresh();
      }
    } catch (err) {
      console.error('Failed to delete holiday:', err);
      setModalError(err.message || 'Failed to delete organization holiday.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Confirm Mark Attendance as Holiday
  const handleMarkAttendanceConfirm = async (forceOverwrite = false) => {
    if (!markTargetHoliday) return;
    setModalError(null);

    try {
      setSubmitting(true);
      const payload = {
        attendance_date: markTargetHoliday.holiday_date,
        remarks: markRemarks.trim() || markTargetHoliday.holiday_name,
      };

      if (forceOverwrite || markConflictWarning) {
        payload.confirm_overwrite = true;
      }

      const res = await api.admin.markHoliday(payload);

      setIsMarkModalOpen(false);
      setMarkConflictWarning(null);

      if (res && res.already_marked) {
        setSuccessMessage(res.message || `${markTargetHoliday.holiday_date} is already marked as Holiday for all active employees.`);
      } else if (res && res.data) {
        const { employees_affected, created, updated } = res.data;
        setSuccessMessage(
          `Attendance marked as Holiday for ${formatDisplayDate(markTargetHoliday.holiday_date).formatted} (${employees_affected} employees affected, ${created} created, ${updated} updated).`
        );
      } else {
        setSuccessMessage(`Attendance marked as Holiday for ${markTargetHoliday.holiday_name}.`);
      }

      // Mark applied in local map
      setAppliedDates((prev) => ({
        ...prev,
        [markTargetHoliday.holiday_date]: true,
      }));
    } catch (err) {
      console.error('Mark holiday attendance error:', err);
      if (err.data?.require_confirmation || err.status === 409) {
        setMarkConflictWarning(err.data || { message: err.message });
      } else {
        setModalError(err.message || 'Failed to apply holiday attendance.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Back Navigation Handler
  const handleBack = (e) => {
    e.preventDefault();
    if (isAddModalOpen || isEditModalOpen) {
      const confirmLeave = window.confirm(
        'You have an active holiday form open. Are you sure you want to return to Settings?'
      );
      if (!confirmLeave) return;
    }
    navigate('/admin/settings');
  };

  const getStatusBadge = (dateStr) => {
    if (dateStr > TODAY_STR) {
      return <span className="admin-holiday-status-badge status-upcoming">Upcoming</span>;
    }
    if (dateStr === TODAY_STR) {
      return <span className="admin-holiday-status-badge status-today">Today</span>;
    }
    return <span className="admin-holiday-status-badge status-past">Past</span>;
  };

  return (
    <div className="admin-holiday-page">
      {/* Top Nav & Breadcrumbs */}
      <div className="admin-holiday-top-nav">
        <button
          type="button"
          onClick={handleBack}
          className="admin-holiday-back-btn"
          aria-label="Back to Settings landing hub"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Settings
        </button>

        <div className="admin-holiday-breadcrumbs" aria-label="Breadcrumbs">
          <Link to="/admin/settings">Settings</Link>
          <span className="separator" aria-hidden="true">/</span>
          <span className="current">Holiday Calendar</span>
        </div>
      </div>

      {/* Header Card */}
      <div className="admin-holiday-header-card">
        <div className="admin-holiday-title-group">
          <h1 className="admin-holiday-title">Holiday Calendar</h1>
          <p className="admin-holiday-subtitle">
            Manage organization-wide holidays and apply them to employee attendance.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAddModal}
          className="admin-holiday-add-btn"
          aria-label="Add new organization holiday"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Holiday
        </button>
      </div>

      {/* Metrics Summary Grid */}
      <div className="admin-holiday-summary-grid">
        <div className="admin-holiday-metric-card">
          <div className="admin-holiday-metric-icon icon-upcoming" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="admin-holiday-metric-info">
            <span className="admin-holiday-metric-label">Upcoming Holidays</span>
            <span className="admin-holiday-metric-val">{metrics.upcoming}</span>
          </div>
        </div>

        <div className="admin-holiday-metric-card">
          <div className="admin-holiday-metric-icon icon-year" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="admin-holiday-metric-info">
            <span className="admin-holiday-metric-label">This Year ({currentYear})</span>
            <span className="admin-holiday-metric-val">{metrics.thisYearCount}</span>
          </div>
        </div>

        <div className="admin-holiday-metric-card">
          <div className="admin-holiday-metric-icon icon-past" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="admin-holiday-metric-info">
            <span className="admin-holiday-metric-label">Past Holidays</span>
            <span className="admin-holiday-metric-val">{metrics.past}</span>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="admin-holiday-alert admin-holiday-alert-success" role="status">
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
        <div className="admin-holiday-alert admin-holiday-alert-error" role="alert">
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

      {/* Filters Toolbar */}
      <div className="admin-holiday-toolbar">
        <div className="admin-holiday-filter-group">
          <label htmlFor="holidayYearSelect" className="admin-holiday-filter-label">
            Year:
          </label>
          <select
            id="holidayYearSelect"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="admin-holiday-select"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y === 'All' ? 'All Years' : y}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-holiday-status-pills" role="radiogroup" aria-label="Status filter">
          {['All', 'Upcoming', 'Past'].map((st) => (
            <button
              key={st}
              type="button"
              className={`admin-holiday-pill-btn ${selectedStatus === st ? 'active' : ''}`}
              onClick={() => setSelectedStatus(st)}
              role="radio"
              aria-checked={selectedStatus === st}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Holiday Content */}
      {loading ? (
        <div className="admin-holiday-loading-card">
          <div className="admin-holiday-spinner" aria-hidden="true" />
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9375rem' }}>Loading holidays...</p>
        </div>
      ) : holidays.length === 0 ? (
        <div className="admin-holiday-empty-state">
          <div className="admin-holiday-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <h2 className="admin-holiday-empty-title">No organization holidays found.</h2>
          <p className="admin-holiday-empty-text">
            No holidays recorded for the selected filter. Click below to add an organization holiday.
          </p>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="admin-holiday-add-btn"
          >
            + Add Holiday
          </button>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="admin-holiday-table-container">
            <table className="admin-holiday-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Holiday</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => {
                  const dateInfo = formatDisplayDate(h.holiday_date);
                  const isMarked = Boolean(appliedDates[h.holiday_date]);

                  return (
                    <tr key={h.id}>
                      <td>
                        <div className="admin-holiday-date-cell">
                          <span className="admin-holiday-date-main">{dateInfo.formatted}</span>
                          <span className="admin-holiday-date-day">{dateInfo.dayName}</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-holiday-name-cell">
                          <span className="admin-holiday-name-title">{h.holiday_name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="admin-holiday-desc-text">
                          {h.description || '—'}
                        </span>
                      </td>
                      <td>
                        {getStatusBadge(h.holiday_date)}
                      </td>
                      <td>
                        <div className="admin-holiday-actions" style={{ justifyContent: 'flex-end' }}>
                          {isMarked ? (
                            <span className="admin-holiday-btn-apply applied" title="Attendance already applied as Holiday">
                              ✓ Attendance Marked
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenMarkModal(h)}
                              className="admin-holiday-btn-apply"
                              title="Mark Attendance as Holiday for all active employees"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Mark Attendance
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(h)}
                            className="admin-holiday-btn-icon"
                            title="Edit holiday definition"
                            aria-label={`Edit ${h.holiday_name}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenDeleteModal(h)}
                            className="admin-holiday-btn-icon delete"
                            title="Delete holiday definition"
                            aria-label={`Delete ${h.holiday_name}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View (< 768px) */}
          <div className="admin-holiday-cards-mobile">
            {holidays.map((h) => {
              const dateInfo = formatDisplayDate(h.holiday_date);
              const isMarked = Boolean(appliedDates[h.holiday_date]);

              return (
                <div key={h.id} className="admin-holiday-card-item">
                  <div className="admin-holiday-card-top">
                    <div className="admin-holiday-date-cell">
                      <span className="admin-holiday-date-main">{dateInfo.formatted}</span>
                      <span className="admin-holiday-date-day">{dateInfo.dayName}</span>
                    </div>
                    {getStatusBadge(h.holiday_date)}
                  </div>

                  <div>
                    <h3 className="admin-holiday-name-title" style={{ margin: '0 0 0.25rem 0' }}>
                      {h.holiday_name}
                    </h3>
                    <p className="admin-holiday-desc-text" style={{ margin: 0 }}>
                      {h.description || 'No description provided.'}
                    </p>
                  </div>

                  <div className="admin-holiday-card-actions">
                    {isMarked ? (
                      <span className="admin-holiday-btn-apply applied">
                        ✓ Attendance Marked
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenMarkModal(h)}
                        className="admin-holiday-btn-apply"
                      >
                        Mark Attendance
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(h)}
                      className="admin-holiday-btn-icon"
                      aria-label="Edit holiday"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenDeleteModal(h)}
                      className="admin-holiday-btn-icon delete"
                      aria-label="Delete holiday"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ====================================================================
          MODAL: ADD HOLIDAY
          ==================================================================== */}
      {isAddModalOpen && (
        <div className="admin-holiday-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-holiday-modal-title">
          <div className="admin-holiday-modal">
            <div className="admin-holiday-modal-header">
              <h2 id="add-holiday-modal-title" className="admin-holiday-modal-title">
                Add Organization Holiday
              </h2>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="admin-holiday-modal-close-btn"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit}>
              <div className="admin-holiday-modal-body">
                {modalError && (
                  <div className="admin-holiday-alert admin-holiday-alert-error" role="alert">
                    <span>{modalError}</span>
                  </div>
                )}

                <div className="admin-holiday-form-group">
                  <label htmlFor="add_holiday_name" className="admin-holiday-label">
                    Holiday Name <span className="admin-holiday-required">*</span>
                  </label>
                  <input
                    id="add_holiday_name"
                    type="text"
                    required
                    maxLength={200}
                    placeholder="e.g. Dasara, Independence Day"
                    value={formData.holiday_name}
                    onChange={(e) => setFormData({ ...formData, holiday_name: e.target.value })}
                    className="admin-holiday-input"
                    disabled={submitting}
                  />
                </div>

                <div className="admin-holiday-form-group">
                  <label htmlFor="add_holiday_date" className="admin-holiday-label">
                    Holiday Date <span className="admin-holiday-required">*</span>
                  </label>
                  <input
                    id="add_holiday_date"
                    type="date"
                    required
                    value={formData.holiday_date}
                    onChange={(e) => setFormData({ ...formData, holiday_date: e.target.value })}
                    className="admin-holiday-input"
                    disabled={submitting}
                  />
                </div>

                <div className="admin-holiday-form-group">
                  <label htmlFor="add_holiday_desc" className="admin-holiday-label">
                    Description
                  </label>
                  <textarea
                    id="add_holiday_desc"
                    maxLength={1000}
                    placeholder="Optional details or context..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="admin-holiday-textarea"
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="admin-holiday-modal-footer">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={submitting}
                  className="admin-holiday-modal-btn cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="admin-holiday-modal-btn primary"
                >
                  {submitting ? 'Saving...' : 'Save Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: EDIT HOLIDAY
          ==================================================================== */}
      {isEditModalOpen && (
        <div className="admin-holiday-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-holiday-modal-title">
          <div className="admin-holiday-modal">
            <div className="admin-holiday-modal-header">
              <h2 id="edit-holiday-modal-title" className="admin-holiday-modal-title">
                Edit Organization Holiday
              </h2>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="admin-holiday-modal-close-btn"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              <div className="admin-holiday-modal-body">
                {modalError && (
                  <div className="admin-holiday-alert admin-holiday-alert-error" role="alert">
                    <span>{modalError}</span>
                  </div>
                )}

                <div className="admin-holiday-form-group">
                  <label htmlFor="edit_holiday_name" className="admin-holiday-label">
                    Holiday Name <span className="admin-holiday-required">*</span>
                  </label>
                  <input
                    id="edit_holiday_name"
                    type="text"
                    required
                    maxLength={200}
                    value={formData.holiday_name}
                    onChange={(e) => setFormData({ ...formData, holiday_name: e.target.value })}
                    className="admin-holiday-input"
                    disabled={submitting}
                  />
                </div>

                <div className="admin-holiday-form-group">
                  <label htmlFor="edit_holiday_date" className="admin-holiday-label">
                    Holiday Date <span className="admin-holiday-required">*</span>
                  </label>
                  <input
                    id="edit_holiday_date"
                    type="date"
                    required
                    value={formData.holiday_date}
                    onChange={(e) => setFormData({ ...formData, holiday_date: e.target.value })}
                    className="admin-holiday-input"
                    disabled={submitting}
                  />
                </div>

                <div className="admin-holiday-form-group">
                  <label htmlFor="edit_holiday_desc" className="admin-holiday-label">
                    Description
                  </label>
                  <textarea
                    id="edit_holiday_desc"
                    maxLength={1000}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="admin-holiday-textarea"
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="admin-holiday-modal-footer">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={submitting}
                  className="admin-holiday-modal-btn cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="admin-holiday-modal-btn primary"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: DELETE CONFIRMATION
          ==================================================================== */}
      {isDeleteModalOpen && deleteHoliday && (
        <div className="admin-holiday-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-holiday-modal-title">
          <div className="admin-holiday-modal">
            <div className="admin-holiday-modal-header">
              <h2 id="delete-holiday-modal-title" className="admin-holiday-modal-title">
                Delete Organization Holiday
              </h2>
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="admin-holiday-modal-close-btn"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="admin-holiday-modal-body">
              {modalError && (
                <div className="admin-holiday-alert admin-holiday-alert-error" role="alert">
                  <span>{modalError}</span>
                </div>
              )}

              <p style={{ margin: 0, fontSize: '0.9375rem', color: '#1e293b', lineHeight: 1.5 }}>
                Are you sure you want to delete this organization holiday definition?
              </p>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{deleteHoliday.holiday_name}</span>
                <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                  {formatDisplayDate(deleteHoliday.holiday_date).formatted} ({formatDisplayDate(deleteHoliday.holiday_date).dayName})
                </span>
              </div>

              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.875rem', fontSize: '0.8125rem', color: '#1e40af', lineHeight: 1.5 }}>
                <strong>Note:</strong> Deleting a holiday definition does not remove or alter historical employee attendance records.
              </div>
            </div>

            <div className="admin-holiday-modal-footer">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={submitting}
                className="admin-holiday-modal-btn cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteSubmit}
                disabled={submitting}
                className="admin-holiday-modal-btn danger"
              >
                {submitting ? 'Deleting...' : 'Delete Holiday'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: MARK ATTENDANCE AS HOLIDAY (WORKFLOW INTEGRATION)
          ==================================================================== */}
      {isMarkModalOpen && markTargetHoliday && (
        <div className="admin-holiday-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="mark-holiday-modal-title">
          <div className="admin-holiday-modal">
            <div className="admin-holiday-modal-header">
              <h2 id="mark-holiday-modal-title" className="admin-holiday-modal-title">
                Apply Holiday to Attendance
              </h2>
              <button
                type="button"
                onClick={() => setIsMarkModalOpen(false)}
                className="admin-holiday-modal-close-btn"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="admin-holiday-modal-body">
              {modalError && (
                <div className="admin-holiday-alert admin-holiday-alert-error" role="alert">
                  <span>{modalError}</span>
                </div>
              )}

              {markConflictWarning && (
                <div className="admin-holiday-alert admin-holiday-alert-error" role="alert">
                  <div>
                    <strong>Existing Records Detected:</strong>
                    <p style={{ margin: '0.25rem 0 0 0' }}>
                      {markConflictWarning.message || 'Non-holiday attendance records already exist on this date.'}
                    </p>
                    <p style={{ margin: '0.25rem 0 0 0', fontWeight: 600 }}>
                      Proceeding will overwrite non-holiday attendance with 'Holiday'.
                    </p>
                  </div>
                </div>
              )}

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>{markTargetHoliday.holiday_name}</span>
                <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                  Target Date: {formatDisplayDate(markTargetHoliday.holiday_date).formatted} ({formatDisplayDate(markTargetHoliday.holiday_date).dayName})
                </span>
                {activeEmployeeCount > 0 && (
                  <span style={{ fontSize: '0.8125rem', color: '#2563eb', fontWeight: 500 }}>
                    Active Employees Targeted: {activeEmployeeCount}
                  </span>
                )}
              </div>

              <div className="admin-holiday-form-group">
                <label htmlFor="mark_remarks" className="admin-holiday-label">
                  Attendance Remarks
                </label>
                <input
                  id="mark_remarks"
                  type="text"
                  maxLength={255}
                  value={markRemarks}
                  onChange={(e) => setMarkRemarks(e.target.value)}
                  className="admin-holiday-input"
                  placeholder="e.g. Dasara Festival Holiday"
                  disabled={submitting}
                />
              </div>

              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.5 }}>
                This action executes the organization bulk holiday process. All active employees will be updated with status <strong>Holiday</strong>. Leave balances and payroll profiles remain unchanged.
              </p>
            </div>

            <div className="admin-holiday-modal-footer">
              <button
                type="button"
                onClick={() => setIsMarkModalOpen(false)}
                disabled={submitting}
                className="admin-holiday-modal-btn cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleMarkAttendanceConfirm(Boolean(markConflictWarning))}
                disabled={submitting}
                className="admin-holiday-modal-btn primary"
              >
                {submitting ? 'Applying Holiday...' : (markConflictWarning ? 'Confirm & Overwrite' : 'Confirm & Apply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HolidayCalendar;
