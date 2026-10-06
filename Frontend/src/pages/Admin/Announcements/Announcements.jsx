import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../../services/api';
import './Announcements.css';

// Helper to format ISO timestamp to UK date/time
function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// Convert ISO string to format suitable for datetime-local input (YYYY-MM-DDTHH:mm)
function toDatetimeLocalString(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  } catch {
    return '';
  }
}

function getPriorityBadgeClass(priority) {
  const p = (priority || '').toLowerCase();
  if (p === 'urgent') return 'priority-badge-urgent';
  if (p === 'high') return 'priority-badge-high';
  return 'priority-badge-normal';
}

function getStatusBadgeClass(status) {
  const s = (status || '').toUpperCase();
  if (s === 'PUBLISHED') return 'status-badge-published';
  if (s === 'ARCHIVED') return 'status-badge-archived';
  return 'status-badge-draft';
}

function AdminAnnouncements() {
  // Announcements data state
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  // Pagination & filter state
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [targetTypeFilter, setTargetTypeFilter] = useState('All');

  // Real employee & department lists from DB for targeting
  const [employeesList, setEmployeesList] = useState([]);

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [viewingAnnouncement, setViewingAnnouncement] = useState(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [formError, setFormError] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'Normal',
    target_type: 'ALL',
    target_department: '',
    target_employee_id: '',
    status: 'DRAFT',
    publish_at: '',
    expires_at: '',
  });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  // Fetch employees list once on mount to populate department & employee selectors
  useEffect(() => {
    let ignore = false;
    async function loadEmployees() {
      try {
        const res = await api.admin.getEmployees({ limit: 100 });
        if (!ignore && res && res.success && Array.isArray(res.data?.employees)) {
          setEmployeesList(res.data.employees);
        }
      } catch (err) {
        console.error('Failed to load employees for targeting:', err);
      }
    }
    loadEmployees();
    return () => { ignore = true; };
  }, []);

  // Compute distinct active departments dynamically from real DB employees
  const availableDepartments = useMemo(() => {
    const set = new Set();
    employeesList.forEach((e) => {
      if (e.department && String(e.department).trim()) {
        set.add(String(e.department).trim());
      }
    });
    // Ensure Engineering is always an option if present
    if (set.size === 0) set.add('Engineering');
    return Array.from(set).sort();
  }, [employeesList]);

  // Fetch announcements list from API
  const fetchAnnouncements = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.admin.getAnnouncements({
        page,
        limit,
        search,
        status: statusFilter,
        priority: priorityFilter,
        target_type: targetTypeFilter,
      });

      if (res && res.success && res.data) {
        setAnnouncements(res.data.announcements || []);
        setTotalCount(res.data.pagination?.total || 0);
        setTotalPages(res.data.pagination?.total_pages || 1);
      } else {
        setError(res?.message || 'Unable to fetch announcements.');
      }
    } catch (err) {
      setError(err?.message || 'Failed to load announcements. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter, priorityFilter, targetTypeFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAnnouncements();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchAnnouncements]);

  // Debounced search handler
  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  // Filter change handlers
  const handleStatusChange = (e) => {
    setStatusFilter(e.target.value);
    setPage(1);
  };

  const handlePriorityChange = (e) => {
    setPriorityFilter(e.target.value);
    setPage(1);
  };

  const handleTargetTypeChange = (e) => {
    setTargetTypeFilter(e.target.value);
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setPriorityFilter('All');
    setTargetTypeFilter('All');
    setPage(1);
  };

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingAnnouncement(null);
    setFormData({
      title: '',
      content: '',
      priority: 'Normal',
      target_type: 'ALL',
      target_department: availableDepartments[0] || 'Engineering',
      target_employee_id: employeesList[0]?.employee_id || '',
      status: 'DRAFT',
      publish_at: '',
      expires_at: '',
    });
    setFormError(null);
    setIsFormModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (item) => {
    setEditingAnnouncement(item);
    setFormData({
      title: item.title || '',
      content: item.content || '',
      priority: item.priority || 'Normal',
      target_type: item.target_type || 'ALL',
      target_department: item.target_department || availableDepartments[0] || 'Engineering',
      target_employee_id: item.target_employee_id || employeesList[0]?.employee_id || '',
      status: item.status || 'DRAFT',
      publish_at: toDatetimeLocalString(item.publish_at),
      expires_at: toDatetimeLocalString(item.expires_at),
    });
    setFormError(null);
    setIsFormModalOpen(true);
  };

  // Submit Form (Create or Update)
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    if (!formData.title.trim()) {
      setFormError('Announcement title is required.');
      return;
    }
    if (formData.title.trim().length > 200) {
      setFormError('Announcement title cannot exceed 200 characters.');
      return;
    }
    if (!formData.content.trim()) {
      setFormError('Announcement content is required.');
      return;
    }
    if (formData.target_type === 'DEPARTMENT' && !formData.target_department) {
      setFormError('Please select a target department.');
      return;
    }
    if (formData.target_type === 'EMPLOYEE' && !formData.target_employee_id) {
      setFormError('Please select a target employee.');
      return;
    }
    if (formData.publish_at && formData.expires_at) {
      if (new Date(formData.expires_at) <= new Date(formData.publish_at)) {
        setFormError('Expiry date must be later than the publish date.');
        return;
      }
    }

    try {
      setActionLoading(true);
      const payload = {
        title: formData.title.trim(),
        content: formData.content.trim(),
        priority: formData.priority,
        target_type: formData.target_type,
        target_department: formData.target_type === 'DEPARTMENT' ? formData.target_department : null,
        target_employee_id: formData.target_type === 'EMPLOYEE' ? formData.target_employee_id : null,
        status: formData.status,
        publish_at: formData.publish_at ? new Date(formData.publish_at).toISOString() : null,
        expires_at: formData.expires_at ? new Date(formData.expires_at).toISOString() : null,
      };

      if (editingAnnouncement) {
        await api.admin.updateAnnouncement(editingAnnouncement.id, payload);
        showToast('Announcement updated successfully.');
      } else {
        await api.admin.createAnnouncement(payload);
        showToast('Announcement created successfully.');
      }

      setIsFormModalOpen(false);
      fetchAnnouncements();
    } catch (err) {
      setFormError(err?.message || 'Failed to save announcement.');
    } finally {
      setActionLoading(false);
    }
  };

  // Quick Action: Publish
  const handlePublish = async (item) => {
    try {
      setActionLoading(true);
      await api.admin.publishAnnouncement(item.id);
      showToast(`Announcement "${item.title}" published successfully.`);
      fetchAnnouncements();
    } catch (err) {
      alert(`Publish failed: ${err?.message || 'Error publishing announcement'}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Quick Action: Archive
  const handleArchive = async (item) => {
    try {
      setActionLoading(true);
      await api.admin.archiveAnnouncement(item.id);
      showToast(`Announcement "${item.title}" archived successfully.`);
      fetchAnnouncements();
    } catch (err) {
      alert(`Archive failed: ${err?.message || 'Error archiving announcement'}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Quick Action: Delete
  const handleDeleteConfirm = async () => {
    if (!deletingAnnouncement) return;
    try {
      setActionLoading(true);
      await api.admin.deleteAnnouncement(deletingAnnouncement.id);
      showToast(`Announcement deleted successfully.`);
      setDeletingAnnouncement(null);
      fetchAnnouncements();
    } catch (err) {
      alert(`Delete failed: ${err?.message || 'Error deleting announcement'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const hasActiveFilters =
    search.trim() !== '' ||
    statusFilter !== 'All' ||
    priorityFilter !== 'All' ||
    targetTypeFilter !== 'All';

  return (
    <div className="admin-announcements-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-announcements-toast" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <header className="admin-announcements-header">
        <div className="header-titles">
          <h1 className="header-title">Announcements & Notices</h1>
          <p className="header-subtitle">
            Publish organization-wide announcements, department updates, or direct employee notices.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-create-announcement"
            onClick={handleOpenCreateModal}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Create Announcement</span>
          </button>
        </div>
      </header>

      {/* Filter Toolbar */}
      <section className="admin-announcements-filter-bar" aria-label="Announcement Filters">
        <div className="filter-search-box">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search by title or content..."
            value={search}
            onChange={handleSearchChange}
          />
          {search && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => { setSearch(''); setPage(1); }}
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        <div className="filter-dropdowns">
          <div className="filter-field">
            <label htmlFor="filter-status" className="filter-label">Status</label>
            <select
              id="filter-status"
              className="filter-select"
              value={statusFilter}
              onChange={handleStatusChange}
            >
              <option value="All">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          <div className="filter-field">
            <label htmlFor="filter-priority" className="filter-label">Priority</label>
            <select
              id="filter-priority"
              className="filter-select"
              value={priorityFilter}
              onChange={handlePriorityChange}
            >
              <option value="All">All Priorities</option>
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
          </div>

          <div className="filter-field">
            <label htmlFor="filter-target" className="filter-label">Target</label>
            <select
              id="filter-target"
              className="filter-select"
              value={targetTypeFilter}
              onChange={handleTargetTypeChange}
            >
              <option value="All">All Targets</option>
              <option value="ALL">All Employees</option>
              <option value="DEPARTMENT">Department</option>
              <option value="EMPLOYEE">Specific Employee</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="btn-clear-filters"
              onClick={handleClearFilters}
            >
              Reset Filters
            </button>
          )}
        </div>
      </section>

      {/* Main Content Area */}
      <main className="admin-announcements-table-container">
        {loading ? (
          <div className="table-state-box">
            <div className="spinner" aria-hidden="true"></div>
            <p className="state-text">Loading announcements...</p>
          </div>
        ) : error ? (
          <div className="table-state-box error-box">
            <p className="state-error-text">{error}</p>
            <button type="button" className="btn-retry" onClick={fetchAnnouncements}>
              Retry
            </button>
          </div>
        ) : announcements.length === 0 ? (
          <div className="table-state-box empty-box">
            <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <h3 className="empty-title">No announcements found</h3>
            <p className="empty-desc">
              {hasActiveFilters
                ? 'Try adjusting your search or filter options.'
                : 'Click "+ Create Announcement" to publish your first communication.'}
            </p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="admin-announcements-table">
              <thead>
                <tr>
                  <th>Title & Content</th>
                  <th>Priority</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th>Publish Date</th>
                  <th>Reads</th>
                  <th className="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {announcements.map((item) => (
                  <tr key={item.id}>
                    <td className="td-title-content">
                      <div className="announcement-title-row">
                        <span className="announcement-table-title" title={item.title}>
                          {item.title}
                        </span>
                      </div>
                      <p className="announcement-table-snippet" title={item.content}>
                        {item.content}
                      </p>
                    </td>

                    <td>
                      <span className={`priority-badge ${getPriorityBadgeClass(item.priority)}`}>
                        {item.priority}
                      </span>
                    </td>

                    <td>
                      <div className="audience-indicator">
                        {item.target_type === 'ALL' && (
                          <span className="target-pill target-all">All Employees</span>
                        )}
                        {item.target_type === 'DEPARTMENT' && (
                          <span className="target-pill target-dept">Dept: {item.target_department}</span>
                        )}
                        {item.target_type === 'EMPLOYEE' && (
                          <span className="target-pill target-emp" title={item.target_employee_name || item.target_employee_id}>
                            Emp: {item.target_employee_name || item.target_employee_id}
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className={`status-badge ${getStatusBadgeClass(item.status)}`}>
                        <span className="status-dot" aria-hidden="true"></span>
                        {item.status}
                      </span>
                    </td>

                    <td className="td-date">
                      {formatDateTime(item.publish_at || item.created_at)}
                    </td>

                    <td className="td-reads">
                      <span className="reads-badge">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>{item.read_count || 0}</span>
                      </span>
                    </td>

                    <td className="td-actions">
                      <div className="action-buttons-group">
                        <button
                          type="button"
                          className="action-btn action-btn-view"
                          title="View Details"
                          onClick={() => setViewingAnnouncement(item)}
                          aria-label={`View ${item.title}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>

                        <button
                          type="button"
                          className="action-btn action-btn-edit"
                          title="Edit Announcement"
                          onClick={() => handleOpenEditModal(item)}
                          aria-label={`Edit ${item.title}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>

                        {item.status !== 'PUBLISHED' && (
                          <button
                            type="button"
                            className="action-btn action-btn-publish"
                            title="Publish Announcement"
                            onClick={() => handlePublish(item)}
                            disabled={actionLoading}
                            aria-label={`Publish ${item.title}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                        )}

                        {item.status !== 'ARCHIVED' && (
                          <button
                            type="button"
                            className="action-btn action-btn-archive"
                            title="Archive Announcement"
                            onClick={() => handleArchive(item)}
                            disabled={actionLoading}
                            aria-label={`Archive ${item.title}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="21 8 21 21 3 21 3 8" />
                              <rect x="1" y="3" width="22" height="5" />
                              <line x1="10" y1="12" x2="14" y2="12" />
                            </svg>
                          </button>
                        )}

                        <button
                          type="button"
                          className="action-btn action-btn-delete"
                          title="Delete Announcement"
                          onClick={() => setDeletingAnnouncement(item)}
                          disabled={actionLoading}
                          aria-label={`Delete ${item.title}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && !error && totalCount > 0 && (
          <div className="table-pagination-bar">
            <span className="pagination-info">
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} announcements
            </span>
            <div className="pagination-controls">
              <button
                type="button"
                className="pagination-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="pagination-page-indicator">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="pagination-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ====================================================================
          CREATE / EDIT MODAL
          ==================================================================== */}
      {isFormModalOpen && (
        <div
          className="admin-modal-backdrop"
          onClick={() => setIsFormModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-form-title"
        >
          <div
            className="admin-modal-window modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header">
              <h2 id="modal-form-title" className="admin-modal-title">
                {editingAnnouncement ? 'Edit Announcement' : 'Create New Announcement'}
              </h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setIsFormModalOpen(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="admin-modal-form">
              {formError && (
                <div className="form-error-banner" role="alert">
                  {formError}
                </div>
              )}

              <div className="form-grid-2">
                <div className="form-group full-span">
                  <label htmlFor="form-title" className="form-label required">Title</label>
                  <input
                    id="form-title"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Office Holiday Notice, All-Hands Meeting"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    maxLength={200}
                    required
                  />
                  <span className="field-hint">{formData.title.length}/200 characters</span>
                </div>

                <div className="form-group">
                  <label htmlFor="form-priority" className="form-label required">Priority</label>
                  <select
                    id="form-priority"
                    className="form-select"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  >
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="form-status" className="form-label required">Status</label>
                  <select
                    id="form-status"
                    className="form-select"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PUBLISHED">Published</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="form-target-type" className="form-label required">Target Audience</label>
                  <select
                    id="form-target-type"
                    className="form-select"
                    value={formData.target_type}
                    onChange={(e) => setFormData({ ...formData, target_type: e.target.value })}
                  >
                    <option value="ALL">All Employees</option>
                    <option value="DEPARTMENT">Specific Department</option>
                    <option value="EMPLOYEE">Specific Employee</option>
                  </select>
                </div>

                {formData.target_type === 'DEPARTMENT' && (
                  <div className="form-group">
                    <label htmlFor="form-department" className="form-label required">Target Department</label>
                    <select
                      id="form-department"
                      className="form-select"
                      value={formData.target_department}
                      onChange={(e) => setFormData({ ...formData, target_department: e.target.value })}
                      required
                    >
                      {availableDepartments.map((dept) => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                )}

                {formData.target_type === 'EMPLOYEE' && (
                  <div className="form-group">
                    <label htmlFor="form-employee" className="form-label required">Target Employee</label>
                    <select
                      id="form-employee"
                      className="form-select"
                      value={formData.target_employee_id}
                      onChange={(e) => setFormData({ ...formData, target_employee_id: e.target.value })}
                      required
                    >
                      {employeesList.map((emp) => (
                        <option key={emp.employee_id} value={emp.employee_id}>
                          {emp.first_name} {emp.last_name} ({emp.employee_id})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="form-publish-at" className="form-label">
                    Publish Date & Time <span className="label-sub">(optional)</span>
                  </label>
                  <input
                    id="form-publish-at"
                    type="datetime-local"
                    className="form-input"
                    value={formData.publish_at}
                    onChange={(e) => setFormData({ ...formData, publish_at: e.target.value })}
                  />
                  <span className="field-hint">Defaults to immediate if published</span>
                </div>

                <div className="form-group">
                  <label htmlFor="form-expires-at" className="form-label">
                    Expiry Date & Time <span className="label-sub">(optional)</span>
                  </label>
                  <input
                    id="form-expires-at"
                    type="datetime-local"
                    className="form-input"
                    value={formData.expires_at}
                    onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                  />
                  <span className="field-hint">Auto-hides from employees after this date</span>
                </div>

                <div className="form-group full-span">
                  <label htmlFor="form-content" className="form-label required">Content / Notice</label>
                  <textarea
                    id="form-content"
                    className="form-textarea"
                    rows={5}
                    placeholder="Enter announcement details, instructions, or meeting agenda..."
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="btn-modal-secondary"
                  onClick={() => setIsFormModalOpen(false)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Saving...' : editingAnnouncement ? 'Update Announcement' : 'Create Announcement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          VIEW DETAILS MODAL
          ==================================================================== */}
      {viewingAnnouncement && (
        <div
          className="admin-modal-backdrop"
          onClick={() => setViewingAnnouncement(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-view-title"
        >
          <div
            className="admin-modal-window modal-view"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header">
              <div className="view-header-left">
                <span className={`priority-badge ${getPriorityBadgeClass(viewingAnnouncement.priority)}`}>
                  {viewingAnnouncement.priority} Priority
                </span>
                <span className={`status-badge ${getStatusBadgeClass(viewingAnnouncement.status)}`}>
                  {viewingAnnouncement.status}
                </span>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setViewingAnnouncement(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-modal-body">
              <h2 id="modal-view-title" className="view-modal-title">
                {viewingAnnouncement.title}
              </h2>

              <div className="view-metadata-grid">
                <div className="meta-box">
                  <span className="meta-lbl">Target Audience</span>
                  <span className="meta-val">
                    {viewingAnnouncement.target_type === 'ALL' && 'All Employees'}
                    {viewingAnnouncement.target_type === 'DEPARTMENT' && `Department: ${viewingAnnouncement.target_department}`}
                    {viewingAnnouncement.target_type === 'EMPLOYEE' && `Employee: ${viewingAnnouncement.target_employee_name || viewingAnnouncement.target_employee_id}`}
                  </span>
                </div>

                <div className="meta-box">
                  <span className="meta-lbl">Publish Date</span>
                  <span className="meta-val">
                    {formatDateTime(viewingAnnouncement.publish_at || viewingAnnouncement.created_at)}
                  </span>
                </div>

                <div className="meta-box">
                  <span className="meta-lbl">Expiry Date</span>
                  <span className="meta-val">
                    {viewingAnnouncement.expires_at ? formatDateTime(viewingAnnouncement.expires_at) : 'No Expiry'}
                  </span>
                </div>

                <div className="meta-box">
                  <span className="meta-lbl">Employee Reads</span>
                  <span className="meta-val">
                    {viewingAnnouncement.read_count || 0} unique read(s)
                  </span>
                </div>
              </div>

              <div className="view-content-section">
                <h4 className="view-content-heading">Announcement Details</h4>
                <p className="view-content-text">{viewingAnnouncement.content}</p>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="btn-modal-secondary"
                onClick={() => setViewingAnnouncement(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          DELETE CONFIRMATION MODAL
          ==================================================================== */}
      {deletingAnnouncement && (
        <div
          className="admin-modal-backdrop"
          onClick={() => setDeletingAnnouncement(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-delete-title"
        >
          <div
            className="admin-modal-window modal-delete"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header header-delete">
              <h3 id="modal-delete-title" className="admin-modal-title">
                Confirm Deletion
              </h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setDeletingAnnouncement(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-modal-body">
              <p className="delete-confirm-text">
                Are you sure you want to permanently delete the announcement:
                <strong> "{deletingAnnouncement.title}"</strong>?
              </p>
              <p className="delete-confirm-sub">
                This action is irreversible and will delete all associated employee read records.
              </p>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="btn-modal-secondary"
                onClick={() => setDeletingAnnouncement(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-modal-danger"
                onClick={handleDeleteConfirm}
                disabled={actionLoading}
              >
                {actionLoading ? 'Deleting...' : 'Delete Announcement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminAnnouncements;
