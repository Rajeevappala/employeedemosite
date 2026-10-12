import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../../services/api';
import './EmployeeConfiguration.css';

const TABS = [
  { id: 'departments', label: 'Departments', emoji: '🏢', singular: 'Department' },
  { id: 'designations', label: 'Designations', emoji: '💼', singular: 'Designation' },
  { id: 'employmentTypes', label: 'Employment Types', emoji: '📋', singular: 'Employment Type' },
  { id: 'locations', label: 'Work Locations', emoji: '📍', singular: 'Work Location' },
];

function EmployeeConfiguration() {
  const [activeTab, setActiveTab] = useState('departments');
  const [data, setData] = useState({
    departments: [],
    designations: [],
    employmentTypes: [],
    locations: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    address: '',
    city: '',
    state: '',
    country: 'India',
    is_active: true,
  });

  // Classification tool
  const [unclassifiedEmployees, setUnclassifiedEmployees] = useState([]);
  const [isClassifyModalOpen, setIsClassifyModalOpen] = useState(false);
  const [classifyTargetDept, setClassifyTargetDept] = useState(null);
  const [classifyMappings, setClassifyMappings] = useState({});
  const [classifySubmitting, setClassifySubmitting] = useState(false);
  const [classifyError, setClassifyError] = useState('');

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  }, []);

  const fetchUnclassifiedEmployees = useCallback(async () => {
    try {
      const res = await api.admin.getEmployees({ limit: 100 });
      if (res && res.success && Array.isArray(res.data?.employees)) {
        const unclass = res.data.employees.filter(
          (e) => e.department && !['it', 'non-it'].includes(e.department.trim().toLowerCase())
        );
        setUnclassifiedEmployees(unclass);
        const map = {};
        unclass.forEach((e) => {
          map[e.employee_id] = 'IT';
        });
        setClassifyMappings(map);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Fetch master data
  const fetchMasterData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.admin.settings.employees.get();
      if (res && res.success && res.data) {
        setData({
          departments: res.data.departments || [],
          designations: res.data.designations || [],
          employmentTypes: res.data.employmentTypes || [],
          locations: res.data.locations || [],
        });
        fetchUnclassifiedEmployees();
      } else {
        throw new Error(res?.message || 'Failed to load employee configuration.');
      }
    } catch (err) {
      setError(err.message || 'Unable to load configuration master data.');
    } finally {
      setLoading(false);
    }
  }, [fetchUnclassifiedEmployees]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMasterData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchMasterData]);

  // Active items list
  const currentItems = useMemo(() => {
    return data[activeTab] || [];
  }, [data, activeTab]);

  // Filtered by search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return currentItems;
    const q = searchQuery.toLowerCase().trim();
    return currentItems.filter((item) => {
      const matchName = item.name && item.name.toLowerCase().includes(q);
      const matchDesc = item.description && item.description.toLowerCase().includes(q);
      const matchCity = item.city && item.city.toLowerCase().includes(q);
      return matchName || matchDesc || matchCity;
    });
  }, [currentItems, searchQuery]);

  // Tab summary metrics
  const metrics = useMemo(() => {
    const getActiveCount = (list) => (list || []).filter((item) => item.is_active).length;
    const getTotalEmployees = (list) =>
      (list || []).reduce((acc, item) => acc + (parseInt(item.employee_count, 10) || 0), 0);

    return {
      departments: {
        total: data.departments.length,
        active: getActiveCount(data.departments),
        employees: getTotalEmployees(data.departments),
      },
      designations: {
        total: data.designations.length,
        active: getActiveCount(data.designations),
        employees: getTotalEmployees(data.designations),
      },
      employmentTypes: {
        total: data.employmentTypes.length,
        active: getActiveCount(data.employmentTypes),
        employees: getTotalEmployees(data.employmentTypes),
      },
      locations: {
        total: data.locations.length,
        active: getActiveCount(data.locations),
        employees: getTotalEmployees(data.locations),
      },
    };
  }, [data]);

  const currentTabInfo = useMemo(() => {
    return TABS.find((t) => t.id === activeTab) || TABS[0];
  }, [activeTab]);

  // Open Add modal
  const handleOpenAdd = () => {
    setFormData({
      name: '',
      description: '',
      address: '',
      city: '',
      state: '',
      country: 'India',
      is_active: true,
    });
    setModalError('');
    setIsAddModalOpen(true);
  };

  // Open Edit modal
  const handleOpenEdit = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name || '',
      description: item.description || '',
      address: item.address || '',
      city: item.city || '',
      state: item.state || '',
      country: item.country || 'India',
      is_active: item.is_active ?? true,
    });
    setModalError('');
  };

  // Submit Add
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setModalError(`${currentTabInfo.singular} name is required.`);
      return;
    }

    setModalSubmitting(true);
    setModalError('');

    try {
      let res;
      if (activeTab === 'departments') {
        res = await api.admin.settings.employees.departments.create({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
        });
      } else if (activeTab === 'designations') {
        res = await api.admin.settings.employees.designations.create({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
        });
      } else if (activeTab === 'employmentTypes') {
        res = await api.admin.settings.employees.employmentTypes.create({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
        });
      } else if (activeTab === 'locations') {
        res = await api.admin.settings.employees.locations.create({
          name: formData.name.trim(),
          address: formData.address.trim() || null,
          city: formData.city.trim() || null,
          state: formData.state.trim() || null,
          country: formData.country.trim() || 'India',
          description: formData.description.trim() || null,
        });
      }

      if (res && res.success) {
        showToast(`${currentTabInfo.singular} created successfully.`);
        setIsAddModalOpen(false);
        fetchMasterData();
      } else {
        setModalError(res?.message || 'Failed to create record.');
      }
    } catch (err) {
      setModalError(err.message || 'Operation failed. Please try again.');
    } finally {
      setModalSubmitting(false);
    }
  };

  // Submit Update
  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setModalError(`${currentTabInfo.singular} name is required.`);
      return;
    }

    setModalSubmitting(true);
    setModalError('');

    try {
      let res;
      const id = editingItem.id;
      if (activeTab === 'departments') {
        res = await api.admin.settings.employees.departments.update(id, {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          is_active: formData.is_active,
        });
      } else if (activeTab === 'designations') {
        res = await api.admin.settings.employees.designations.update(id, {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          is_active: formData.is_active,
        });
      } else if (activeTab === 'employmentTypes') {
        res = await api.admin.settings.employees.employmentTypes.update(id, {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          is_active: formData.is_active,
        });
      } else if (activeTab === 'locations') {
        res = await api.admin.settings.employees.locations.update(id, {
          name: formData.name.trim(),
          address: formData.address.trim() || null,
          city: formData.city.trim() || null,
          state: formData.state.trim() || null,
          country: formData.country.trim() || 'India',
          description: formData.description.trim() || null,
          is_active: formData.is_active,
        });
      }

      if (res && res.success) {
        showToast(`${currentTabInfo.singular} updated successfully.`);
        setEditingItem(null);
        fetchMasterData();
      } else {
        setModalError(res?.message || 'Failed to update record.');
      }
    } catch (err) {
      setModalError(err.message || 'Update failed. Please try again.');
    } finally {
      setModalSubmitting(false);
    }
  };

  // Toggle active status directly
  const handleToggleActive = async (item) => {
    const nextStatus = !item.is_active;
    if (activeTab === 'departments' && nextStatus === true && !['it', 'non-it'].includes(item.name.toLowerCase())) {
      showToast("Organization policy strictly permits only 'IT' and 'Non-IT' as active departments. Legacy departments cannot be reactivated.");
      return;
    }
    try {
      let res;
      if (activeTab === 'departments') {
        res = await api.admin.settings.employees.departments.update(item.id, { is_active: nextStatus });
      } else if (activeTab === 'designations') {
        res = await api.admin.settings.employees.designations.update(item.id, { is_active: nextStatus });
      } else if (activeTab === 'employmentTypes') {
        res = await api.admin.settings.employees.employmentTypes.update(item.id, { is_active: nextStatus });
      } else if (activeTab === 'locations') {
        res = await api.admin.settings.employees.locations.update(item.id, { is_active: nextStatus });
      }

      if (res && res.success) {
        showToast(`${currentTabInfo.singular} ${nextStatus ? 'activated' : 'deactivated'}.`);
        fetchMasterData();
      } else {
        showToast(res?.message || 'Failed to update status.');
      }
    } catch (err) {
      showToast(err.message || 'Operation failed.');
    }
  };

  // Delete execution
  const handleExecuteDelete = async () => {
    if (!deletingItem) return;
    setModalSubmitting(true);
    setModalError('');

    try {
      let res;
      const id = deletingItem.id;
      if (activeTab === 'departments') {
        res = await api.admin.settings.employees.departments.delete(id);
      } else if (activeTab === 'designations') {
        res = await api.admin.settings.employees.designations.delete(id);
      } else if (activeTab === 'employmentTypes') {
        res = await api.admin.settings.employees.employmentTypes.delete(id);
      } else if (activeTab === 'locations') {
        res = await api.admin.settings.employees.locations.delete(id);
      }

      if (res && res.success) {
        showToast(`${currentTabInfo.singular} deleted successfully.`);
        setDeletingItem(null);
        fetchMasterData();
      } else {
        setModalError(res?.message || 'Failed to delete record.');
      }
    } catch (err) {
      setModalError(err.message || 'Deletion rejected by server.');
    } finally {
      setModalSubmitting(false);
    }
  };

  return (
    <div className="emp-config-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="emp-config-toast" role="status" aria-live="polite">
          <span className="emp-config-toast-icon">✓</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Card */}
      <div className="emp-config-header-card">
        <div className="emp-config-header-top">
          <Link to="/admin/settings" className="emp-config-back-link">
            ← Back to Settings
          </Link>
          <span className="emp-config-badge">Master Data Module</span>
        </div>

        <div className="emp-config-title-row">
          <div>
            <h1 className="emp-config-title">Employee Configuration</h1>
            <p className="emp-config-subtitle">
              Manage employee master data used throughout the GaintPro HRM portal.
            </p>
          </div>
          <button
            type="button"
            className="emp-config-add-btn"
            onClick={handleOpenAdd}
            disabled={loading}
          >
            + Add {currentTabInfo.singular}
          </button>
        </div>
      </div>

      {/* 4 Overview Dashboard Cards */}
      <div className="emp-config-overview-grid">
        {TABS.map((tab) => {
          const tabMetric = metrics[tab.id] || { total: 0, active: 0, employees: 0 };
          const isSelected = activeTab === tab.id;
          return (
            <div
              key={tab.id}
              className={`emp-config-metric-card ${isSelected ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchQuery('');
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setActiveTab(tab.id);
                  setSearchQuery('');
                }
              }}
            >
              <div className="emp-config-card-header">
                <span className="emp-config-card-emoji">{tab.emoji}</span>
                <span className="emp-config-card-count-badge">
                  {tabMetric.active} Active
                </span>
              </div>
              <h3 className="emp-config-card-title">{tab.label}</h3>
              <p className="emp-config-card-desc">
                {tabMetric.total} total configured &bull; {tabMetric.employees} assigned employees
              </p>
              <div className="emp-config-card-footer">
                <span className="emp-config-manage-link">
                  {isSelected ? 'Currently Viewing' : 'Manage →'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="emp-config-content-card">
        {/* Navigation Tabs Bar */}
        <div className="emp-config-tabs-bar">
          <div className="emp-config-tabs-list" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`emp-config-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSearchQuery('');
                }}
              >
                <span>{tab.emoji}</span>
                <span>{tab.label}</span>
                <span className="emp-config-tab-counter">
                  {(data[tab.id] || []).length}
                </span>
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="emp-config-search-wrapper">
            <span className="emp-config-search-icon" aria-hidden="true">🔍</span>
            <input
              type="text"
              className="emp-config-search-input"
              placeholder={`Search ${currentTabInfo.label.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={`Search ${currentTabInfo.label}`}
            />
            {searchQuery && (
              <button
                type="button"
                className="emp-config-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Unclassified Employees Banner */}
        {activeTab === 'departments' && !loading && unclassifiedEmployees.length > 0 && (
          <div className="emp-config-classify-banner" role="alert">
            <div className="emp-config-classify-info">
              <span className="emp-config-classify-icon" aria-hidden="true">⚠️</span>
              <div>
                <h3 className="emp-config-classify-title">
                  {unclassifiedEmployees.length} Employee{unclassifiedEmployees.length > 1 ? 's' : ''} Pending Department Classification
                </h3>
                <p className="emp-config-classify-text">
                  Existing employee records currently use legacy department values. Classify them into IT or Non-IT to standardize master data.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="emp-config-classify-action-btn"
              onClick={() => {
                setClassifyTargetDept(null);
                setIsClassifyModalOpen(true);
              }}
            >
              Classify Employees →
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="emp-config-state-box">
            <div className="emp-config-spinner" aria-hidden="true" />
            <p className="emp-config-state-text">Loading {currentTabInfo.label.toLowerCase()}...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="emp-config-state-box error">
            <span className="emp-config-error-icon" aria-hidden="true">⚠️</span>
            <p className="emp-config-state-title">Error Loading Data</p>
            <p className="emp-config-state-text">{error}</p>
            <button
              type="button"
              className="emp-config-retry-btn"
              onClick={fetchMasterData}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredItems.length === 0 && (
          <div className="emp-config-state-box empty">
            <span className="emp-config-empty-icon" aria-hidden="true">📂</span>
            <p className="emp-config-state-title">
              {searchQuery
                ? `No ${currentTabInfo.label.toLowerCase()} matching "${searchQuery}"`
                : `No ${currentTabInfo.label.toLowerCase()} configured.`}
            </p>
            <p className="emp-config-state-text">
              {searchQuery
                ? 'Try a different search term or clear the filter.'
                : `Add your organization's first ${currentTabInfo.singular.toLowerCase()} to get started.`}
            </p>
            {!searchQuery && (
              <button
                type="button"
                className="emp-config-add-btn"
                onClick={handleOpenAdd}
              >
                + Add {currentTabInfo.singular}
              </button>
            )}
          </div>
        )}

        {/* Data Table (Desktop) & Cards (Mobile) */}
        {!loading && !error && filteredItems.length > 0 && (
          <>
            <div className="emp-config-table-responsive">
              <table className="emp-config-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {activeTab === 'locations' ? (
                      <th>Location Details</th>
                    ) : (
                      <th>Description</th>
                    )}
                    <th>Assigned Employees</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const empCount = parseInt(item.employee_count, 10) || 0;
                    const isLegacyDept = activeTab === 'departments' && !['it', 'non-it'].includes(item.name.toLowerCase());
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="emp-config-name-cell">
                            <span className="emp-config-item-name">{item.name}</span>
                            {activeTab === 'locations' && item.address && (
                              <span className="emp-config-item-subtext">{item.address}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {activeTab === 'locations' ? (
                            <span className="emp-config-loc-details">
                              {[item.city, item.state, item.country].filter(Boolean).join(', ') || '—'}
                            </span>
                          ) : (
                            <span className="emp-config-desc-text">
                              {item.description || '—'}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`emp-config-usage-pill ${empCount > 0 ? 'used' : 'unused'}`}>
                            {empCount > 0 ? `Used by ${empCount} employee${empCount > 1 ? 's' : ''}` : '0 employees'}
                          </span>
                        </td>
                        <td>
                          <span className={`emp-config-status-tag ${item.is_active ? 'active' : 'inactive'}`}>
                            <span className="status-dot" aria-hidden="true" />
                            {item.is_active ? 'Active' : isLegacyDept ? 'Legacy (Inactive)' : 'Inactive'}
                          </span>
                        </td>
                        <td className="text-right">
                          <div className="emp-config-actions-row">
                            {isLegacyDept && empCount > 0 && (
                              <button
                                type="button"
                                className="emp-config-btn-secondary"
                                style={{ color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff', fontWeight: 600 }}
                                onClick={() => {
                                  setClassifyTargetDept(item.name);
                                  setIsClassifyModalOpen(true);
                                }}
                                title="Classify assigned employees as IT or Non-IT"
                              >
                                Classify
                              </button>
                            )}
                            <button
                              type="button"
                              className="emp-config-btn-secondary"
                              onClick={() => handleOpenEdit(item)}
                              title="Edit item"
                            >
                              Edit
                            </button>
                            {isLegacyDept && !item.is_active ? (
                              <span className="emp-config-locked-tag" title="Legacy department cannot be reactivated">
                                Legacy
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={`emp-config-btn-toggle ${item.is_active ? 'deactivate' : 'activate'}`}
                                onClick={() => handleToggleActive(item)}
                                title={item.is_active ? 'Deactivate record' : 'Activate record'}
                              >
                                {item.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                            )}
                            <button
                              type="button"
                              className="emp-config-btn-delete"
                              onClick={() => {
                                setModalError('');
                                setDeletingItem(item);
                              }}
                              title="Delete record"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards Layout (< 768px) */}
            <div className="emp-config-mobile-cards">
              {filteredItems.map((item) => {
                const empCount = parseInt(item.employee_count, 10) || 0;
                const isLegacyDept = activeTab === 'departments' && !['IT', 'Non-IT'].includes(item.name);
                return (
                  <div key={item.id} className="emp-config-mobile-card">
                    <div className="emp-config-mobile-card-top">
                      <div>
                        <h4 className="emp-config-mobile-name">{item.name}</h4>
                        <span className={`emp-config-status-tag ${item.is_active ? 'active' : 'inactive'}`}>
                          <span className="status-dot" aria-hidden="true" />
                          {item.is_active ? 'Active' : isLegacyDept ? 'Legacy (Inactive)' : 'Inactive'}
                        </span>
                      </div>
                      <span className={`emp-config-usage-pill ${empCount > 0 ? 'used' : 'unused'}`}>
                        {empCount} staff
                      </span>
                    </div>

                    <div className="emp-config-mobile-details">
                      {activeTab === 'locations' ? (
                        <p className="emp-config-mobile-desc">
                          📍 {[item.address, item.city, item.state, item.country].filter(Boolean).join(', ') || 'No address specified'}
                        </p>
                      ) : (
                        <p className="emp-config-mobile-desc">
                          {item.description || 'No description provided.'}
                        </p>
                      )}
                    </div>

                    <div className="emp-config-mobile-actions">
                      {isLegacyDept && empCount > 0 && (
                        <button
                          type="button"
                          className="emp-config-btn-secondary"
                          style={{ color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff', fontWeight: 600 }}
                          onClick={() => {
                            setClassifyTargetDept(item.name);
                            setIsClassifyModalOpen(true);
                          }}
                          title="Classify assigned employees as IT or Non-IT"
                        >
                          Classify
                        </button>
                      )}
                      <button
                        type="button"
                        className="emp-config-btn-secondary"
                        onClick={() => handleOpenEdit(item)}
                      >
                        Edit
                      </button>
                      {isLegacyDept && !item.is_active ? (
                        <span className="emp-config-locked-tag" title="Legacy department cannot be reactivated">
                          Legacy
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`emp-config-btn-toggle ${item.is_active ? 'deactivate' : 'activate'}`}
                          onClick={() => handleToggleActive(item)}
                        >
                          {item.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="emp-config-btn-delete"
                        onClick={() => {
                          setModalError('');
                          setDeletingItem(item);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ADD MODAL */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="emp-config-modal-overlay" role="dialog" aria-modal="true">
          <div className="emp-config-modal-card">
            <div className="emp-config-modal-header">
              <div>
                <h3 className="emp-config-modal-title">
                  Add {currentTabInfo.singular}
                </h3>
                <p className="emp-config-modal-subtitle">
                  Define a new {currentTabInfo.singular.toLowerCase()} for the organization.
                </p>
              </div>
              <button
                type="button"
                className="emp-config-modal-close"
                onClick={() => setIsAddModalOpen(false)}
                disabled={modalSubmitting}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {modalError && (
              <div className="emp-config-modal-alert error">
                <span>⚠️</span>
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="emp-config-modal-form">
              <div className="emp-config-form-group">
                <label htmlFor="create-name" className="emp-config-label">
                  {currentTabInfo.singular} Name <span className="req-star">*</span>
                </label>
                <input
                  id="create-name"
                  type="text"
                  className="emp-config-input"
                  placeholder={`e.g., ${activeTab === 'departments' ? 'Engineering' : activeTab === 'designations' ? 'Software Engineer' : activeTab === 'employmentTypes' ? 'Full Time' : 'Bangalore Tech Center'}`}
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>

              {activeTab === 'locations' ? (
                <>
                  <div className="emp-config-form-group">
                    <label htmlFor="create-address" className="emp-config-label">
                      Address
                    </label>
                    <input
                      id="create-address"
                      type="text"
                      className="emp-config-input"
                      placeholder="e.g., Tech Park, Level 4"
                      value={formData.address}
                      onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                    />
                  </div>

                  <div className="emp-config-form-row">
                    <div className="emp-config-form-group">
                      <label htmlFor="create-city" className="emp-config-label">
                        City
                      </label>
                      <input
                        id="create-city"
                        type="text"
                        className="emp-config-input"
                        placeholder="e.g., Bangalore"
                        value={formData.city}
                        onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
                      />
                    </div>
                    <div className="emp-config-form-group">
                      <label htmlFor="create-state" className="emp-config-label">
                        State
                      </label>
                      <input
                        id="create-state"
                        type="text"
                        className="emp-config-input"
                        placeholder="e.g., Karnataka"
                        value={formData.state}
                        onChange={(e) => setFormData((prev) => ({ ...prev, state: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              <div className="emp-config-form-group">
                <label htmlFor="create-desc" className="emp-config-label">
                  Description
                </label>
                <textarea
                  id="create-desc"
                  rows={3}
                  className="emp-config-textarea"
                  placeholder={`Optional notes or scope of this ${currentTabInfo.singular.toLowerCase()}...`}
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div className="emp-config-modal-actions">
                <button
                  type="button"
                  className="emp-config-btn-secondary"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={modalSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="emp-config-btn-primary"
                  disabled={modalSubmitting}
                >
                  {modalSubmitting ? 'Saving...' : `Save ${currentTabInfo.singular}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* EDIT MODAL */}
      {/* ========================================================================= */}
      {editingItem && (
        <div className="emp-config-modal-overlay" role="dialog" aria-modal="true">
          <div className="emp-config-modal-card">
            <div className="emp-config-modal-header">
              <div>
                <h3 className="emp-config-modal-title">
                  Edit {currentTabInfo.singular}
                </h3>
                <p className="emp-config-modal-subtitle">
                  Update master data record details.
                </p>
              </div>
              <button
                type="button"
                className="emp-config-modal-close"
                onClick={() => setEditingItem(null)}
                disabled={modalSubmitting}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {modalError && (
              <div className="emp-config-modal-alert error">
                <span>⚠️</span>
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateSubmit} className="emp-config-modal-form">
              <div className="emp-config-form-group">
                <label htmlFor="edit-name" className="emp-config-label">
                  {currentTabInfo.singular} Name <span className="req-star">*</span>
                </label>
                <input
                  id="edit-name"
                  type="text"
                  className="emp-config-input"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>

              {activeTab === 'locations' ? (
                <>
                  <div className="emp-config-form-group">
                    <label htmlFor="edit-address" className="emp-config-label">
                      Address
                    </label>
                    <input
                      id="edit-address"
                      type="text"
                      className="emp-config-input"
                      value={formData.address}
                      onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                    />
                  </div>

                  <div className="emp-config-form-row">
                    <div className="emp-config-form-group">
                      <label htmlFor="edit-city" className="emp-config-label">
                        City
                      </label>
                      <input
                        id="edit-city"
                        type="text"
                        className="emp-config-input"
                        value={formData.city}
                        onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
                      />
                    </div>
                    <div className="emp-config-form-group">
                      <label htmlFor="edit-state" className="emp-config-label">
                        State
                      </label>
                      <input
                        id="edit-state"
                        type="text"
                        className="emp-config-input"
                        value={formData.state}
                        onChange={(e) => setFormData((prev) => ({ ...prev, state: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              <div className="emp-config-form-group">
                <label htmlFor="edit-desc" className="emp-config-label">
                  Description
                </label>
                <textarea
                  id="edit-desc"
                  rows={3}
                  className="emp-config-textarea"
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div className="emp-config-form-group">
                <label className="emp-config-label">Status</label>
                <label className="emp-config-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
                  />
                  <span>Active for new employee assignments</span>
                </label>
              </div>

              <div className="emp-config-modal-actions">
                <button
                  type="button"
                  className="emp-config-btn-secondary"
                  onClick={() => setEditingItem(null)}
                  disabled={modalSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="emp-config-btn-primary"
                  disabled={modalSubmitting}
                >
                  {modalSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deletingItem && (
        <div className="emp-config-modal-overlay" role="dialog" aria-modal="true">
          <div className="emp-config-modal-card danger">
            <div className="emp-config-modal-header">
              <div>
                <h3 className="emp-config-modal-title">
                  Delete {currentTabInfo.singular}
                </h3>
                <p className="emp-config-modal-subtitle">
                  Confirm permanent removal of master record.
                </p>
              </div>
              <button
                type="button"
                className="emp-config-modal-close"
                onClick={() => setDeletingItem(null)}
                disabled={modalSubmitting}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {modalError && (
              <div className="emp-config-modal-alert error">
                <span>⚠️</span>
                <span>{modalError}</span>
              </div>
            )}

            <div className="emp-config-delete-body">
              <p>
                Are you sure you want to delete this {currentTabInfo.singular.toLowerCase()}?
              </p>
              <div className="emp-config-delete-target-box">
                <strong>{deletingItem.name}</strong>
                <span className="emp-config-usage-pill">
                  Used by {parseInt(deletingItem.employee_count, 10) || 0} employees
                </span>
              </div>

              {parseInt(deletingItem.employee_count, 10) > 0 ? (
                <div className="emp-config-modal-alert warning">
                  <span>ℹ️</span>
                  <span>
                    This record is currently assigned to active employee profiles.
                    To preserve data integrity, please <strong>Deactivate</strong> this record instead of deleting it.
                  </span>
                </div>
              ) : (
                <p className="emp-config-text-muted">
                  No employees are currently assigned to this record. Deletion is safe and non-destructive to historical records.
                </p>
              )}
            </div>

            <div className="emp-config-modal-actions">
              <button
                type="button"
                className="emp-config-btn-secondary"
                onClick={() => setDeletingItem(null)}
                disabled={modalSubmitting}
              >
                Cancel
              </button>
              {parseInt(deletingItem.employee_count, 10) > 0 ? (
                <button
                  type="button"
                  className="emp-config-btn-toggle deactivate"
                  onClick={() => {
                    handleToggleActive(deletingItem);
                    setDeletingItem(null);
                  }}
                  disabled={modalSubmitting}
                >
                  Deactivate Instead
                </button>
              ) : (
                <button
                  type="button"
                  className="emp-config-btn-danger"
                  onClick={handleExecuteDelete}
                  disabled={modalSubmitting}
                >
                  {modalSubmitting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* CLASSIFY EMPLOYEES MODAL */}
      {/* ========================================================================= */}
      {isClassifyModalOpen && (
        <div className="emp-config-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="classify-modal-title">
          <div className="emp-config-modal-card" style={{ maxWidth: '640px' }}>
            <div className="emp-config-modal-header">
              <h2 id="classify-modal-title" className="emp-config-modal-title">
                Classify Employees — IT / Non-IT
              </h2>
              <button
                type="button"
                className="emp-config-modal-close"
                onClick={() => setIsClassifyModalOpen(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="emp-config-modal-body">
              <p className="emp-config-text-muted" style={{ margin: '0 0 1rem 0' }}>
                Select whether each employee belongs to <strong>IT</strong> or <strong>Non-IT</strong>.
                This permanently standardizes department classification across the HRM Portal.
              </p>

              {classifyError && (
                <div className="emp-config-modal-alert error" role="alert">
                  <span>⚠️</span>
                  <span>{classifyError}</span>
                </div>
              )}

              {(() => {
                const targets = classifyTargetDept
                  ? unclassifiedEmployees.filter(
                      (e) => (e.department || '').toLowerCase() === classifyTargetDept.toLowerCase()
                    )
                  : unclassifiedEmployees;

                if (targets.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                      No unclassified employees found.
                    </div>
                  );
                }

                return (
                  <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                      <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <tr>
                          <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Employee</th>
                          <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Current Dept</th>
                          <th style={{ padding: '0.65rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569' }}>New Dept</th>
                        </tr>
                      </thead>
                      <tbody>
                        {targets.map((emp) => (
                          <tr key={emp.employee_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.65rem 0.75rem' }}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                {emp.first_name} {emp.last_name}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>
                                {emp.employee_id}
                              </div>
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', color: '#b45309', fontWeight: 500 }}>
                              {emp.department} (Legacy)
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem' }}>
                              <select
                                style={{
                                  padding: '0.4rem 0.65rem',
                                  borderRadius: '0.375rem',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.875rem',
                                  background: 'white',
                                  fontWeight: 600,
                                }}
                                value={classifyMappings[emp.employee_id] || 'IT'}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setClassifyMappings((prev) => ({ ...prev, [emp.employee_id]: val }));
                                }}
                              >
                                <option value="IT">IT</option>
                                <option value="Non-IT">Non-IT</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            <div className="emp-config-modal-actions">
              <button
                type="button"
                className="emp-config-btn-secondary"
                onClick={() => setIsClassifyModalOpen(false)}
                disabled={classifySubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="emp-config-btn-primary"
                onClick={async () => {
                  setClassifySubmitting(true);
                  setClassifyError('');
                  try {
                    const targets = classifyTargetDept
                      ? unclassifiedEmployees.filter(
                          (e) => (e.department || '').toLowerCase() === classifyTargetDept.toLowerCase()
                        )
                      : unclassifiedEmployees;

                    const payload = targets.map((e) => ({
                      employee_id: e.employee_id,
                      department: classifyMappings[e.employee_id] || 'IT',
                    }));

                    if (payload.length === 0) {
                      setIsClassifyModalOpen(false);
                      return;
                    }

                    const res = await api.admin.bulkClassifyDepartments(payload);
                    if (res && res.success) {
                      showToast(`Successfully classified ${payload.length} employee(s) as IT / Non-IT.`);
                      setIsClassifyModalOpen(false);
                      fetchMasterData();
                      fetchUnclassifiedEmployees();
                    } else {
                      setClassifyError(res?.message || 'Classification failed.');
                    }
                  } catch (err) {
                    setClassifyError(err.message || 'Operation failed.');
                  } finally {
                    setClassifySubmitting(false);
                  }
                }}
                disabled={classifySubmitting}
              >
                {classifySubmitting ? 'Saving...' : 'Confirm Classifications'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EmployeeConfiguration;
