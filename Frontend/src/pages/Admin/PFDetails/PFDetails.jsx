import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import './PFDetails.css';

// Normalizes backend employee PF rows to frontend model
function mapPfRow(r) {
  return {
    id: r.pf_id || r.employee_id,
    employeeId: r.employee_id,
    name: r.employee_name || '—',
    email: r.email || '',
    department: r.department || '—',
    designation: r.designation || '—',
    uan: r.uan_number || '—',
    pfNumber: r.pf_number || '—',
    pensionNumber: r.pension_number || '—',
    employeeContribution: '—',
    employerContribution: '—',
    status: r.pf_status || 'Not Available',
    dateOfJoining: r.date_of_joining || '—',
    lastUpdated: r.pf_updated_formatted || r.pf_created_formatted || '—',
    createdAt: r.pf_created_at,
    updatedAt: r.pf_updated_at,
  };
}

function PFDetails() {
  const navigate = useNavigate();

  // State management from real backend
  const [pfRecords, setPfRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedDept, setSelectedDept] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Summary statistics from backend
  const [summaryStats, setSummaryStats] = useState({
    total_employees: 0,
    pf_active: 0,
    pf_pending: 0,
    pf_not_available: 0,
  });

  // Modals state
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [editForm, setEditForm] = useState({
    uan: '',
    pfNumber: '',
    pensionNumber: '',
  });

  const [toastMessage, setToastMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const dropdownRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdownId(null);
      }
    };
    if (openDropdownId) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [openDropdownId]);

  // Lock background body scroll when any modal is open
  useEffect(() => {
    const isAnyModalOpen = Boolean(viewRecord || editRecord);
    if (isAnyModalOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [viewRecord, editRecord]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3500);
  };

  // Fetch PF records from backend API
  const fetchPfRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page: currentPage,
        limit: 10,
      };
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (selectedStatus !== 'All') {
        params.status = selectedStatus;
      }
      if (selectedDept !== 'All' && selectedDept !== 'All Departments') {
        params.department = selectedDept;
      }

      const response = await api.admin.getPF(params);
      if (response && response.success) {
        setPfRecords((response.data || []).map(mapPfRow));
        if (response.pagination) {
          setTotalPages(response.pagination.total_pages || 1);
          setTotalCount(response.pagination.total || 0);
        }
        if (response.summary) {
          setSummaryStats(response.summary);
        }
      } else {
        setPfRecords([]);
      }
    } catch (err) {
      if (err.status === 403) {
        setError('Access denied. Administrator privileges required.');
      } else {
        setError(err.message || 'Unable to load PF details. Please try again.');
      }
      setPfRecords([]);
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, selectedStatus, selectedDept]);

  // Debounced effect for search, filters, and page
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPfRecords();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchPfRecords]);

  // Open Edit Modal
  const handleOpenEditModal = (rec) => {
    setEditRecord(rec);
    setEditForm({
      uan: rec.uan === '—' || rec.uan === '-' ? '' : rec.uan,
      pfNumber: rec.pfNumber === '—' || rec.pfNumber === '-' ? '' : rec.pfNumber,
      pensionNumber: rec.pensionNumber === '—' || rec.pensionNumber === '-' ? '' : rec.pensionNumber,
    });
    setActionError('');
    setOpenDropdownId(null);
  };

  // Save Edit Changes to PostgreSQL backend
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editRecord) return;
    setActionLoading(true);
    setActionError('');
    try {
      await api.admin.updatePF(editRecord.employeeId, {
        uan: editForm.uan.trim() || null,
        pfNumber: editForm.pfNumber.trim() || null,
        pensionNumber: editForm.pensionNumber.trim() || null,
      });
      showToast(`PF details for ${editRecord.name} updated successfully.`);
      setEditRecord(null);
      await fetchPfRecords();
    } catch (err) {
      setActionError(err.message || 'Failed to update PF details.');
    } finally {
      setActionLoading(false);
    }
  };

  // Remove PF Details action
  const handleRemovePF = async (empId, empName) => {
    setActionLoading(true);
    try {
      await api.admin.deletePF(empId);
      showToast(`PF details for ${empName || empId} removed.`);
      setOpenDropdownId(null);
      await fetchPfRecords();
    } catch (err) {
      showToast(err.message || 'Failed to remove PF details.');
    } finally {
      setActionLoading(false);
    }
  };

  // Export report as real CSV download
  const handleExportReport = () => {
    try {
      if (pfRecords.length === 0) {
        showToast('No PF records to export.');
        return;
      }
      const headers = ['Employee ID', 'Employee Name', 'Department', 'Designation', 'UAN', 'PF Number', 'Pension Number', 'PF Status', 'Date of Joining'];
      const rows = pfRecords.map((r) => [
        `"${r.employeeId}"`,
        `"${r.name}"`,
        `"${r.department}"`,
        `"${r.designation}"`,
        `"${r.uan}"`,
        `"${r.pfNumber}"`,
        `"${r.pensionNumber}"`,
        `"${r.status}"`,
        `"${r.dateOfJoining}"`,
      ]);
      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `pf_report_${new Date().toISOString().substring(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('PF Report exported successfully.');
    } catch {
      showToast('Failed to export PF report.');
    }
  };

  // Handlers for search and filter changes
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusChange = (e) => {
    setSelectedStatus(e.target.value);
    setCurrentPage(1);
  };

  const handleDeptChange = (e) => {
    setSelectedDept(e.target.value);
    setCurrentPage(1);
  };

  const hasActiveFilters =
    searchQuery !== '' ||
    selectedStatus !== 'All' ||
    selectedDept !== 'All';

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedStatus('All');
    setSelectedDept('All');
    setCurrentPage(1);
  };

  return (
    <div className="admin-pf-page">
      {/* ====================================================================
          PAGE HEADER
          ==================================================================== */}
      <header className="admin-pf-header">
        <div className="admin-pf-title-group">
          <h1 className="admin-pf-title">PF Details</h1>
          <p className="admin-pf-subtitle">
            Manage employee provident fund information and contributions.
          </p>
        </div>

        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={handleExportReport}
            aria-label="Export PF Report"
          >
            <svg
              className="admin-btn-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Export PF Report</span>
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-pf-toast" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ====================================================================
          SUMMARY CARDS (4 Cards connected to real database counts)
          ==================================================================== */}
      <section className="admin-pf-summary-grid" aria-label="Provident Fund Overview">
        {/* Card 1: Total Employees */}
        <div className="admin-pf-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">Total Employees</span>
            <div className="admin-stat-icon-wrapper stat-blue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.total_employees}</div>
          <div className="admin-stat-footer">Active employees in directory</div>
        </div>

        {/* Card 2: PF Active */}
        <div className="admin-pf-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">PF Active</span>
            <div className="admin-stat-icon-wrapper stat-green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.pf_active}</div>
          <div className="admin-stat-footer">Compliant & contributing</div>
        </div>

        {/* Card 3: PF Pending */}
        <div className="admin-pf-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">PF Pending</span>
            <div className="admin-stat-icon-wrapper stat-amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.pf_pending}</div>
          <div className="admin-stat-footer">Verification in progress</div>
        </div>

        {/* Card 4: PF Not Available */}
        <div className="admin-pf-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-label">PF Not Available</span>
            <div className="admin-stat-icon-wrapper stat-neutral">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </div>
          </div>
          <div className="admin-stat-value">{summaryStats.pf_not_available}</div>
          <div className="admin-stat-footer">Exempted / without PF record</div>
        </div>
      </section>

      {/* ====================================================================
          SEARCH AND FILTERS
          ==================================================================== */}
      <section className="admin-filters-card" aria-label="Search and Filter PF Records">
        <div className="admin-search-wrapper">
          <svg
            className="admin-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="admin-search-input"
            placeholder="Search employee by name, ID or UAN..."
            value={searchQuery}
            onChange={handleSearchChange}
            aria-label="Search employee PF records"
          />
          {searchQuery && (
            <button
              type="button"
              className="admin-search-clear-btn"
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              aria-label="Clear search query"
            >
              &times;
            </button>
          )}
        </div>

        <div className="admin-filter-controls">
          {/* PF Status Filter */}
          <div className="admin-filter-group">
            <label htmlFor="pfStatusFilter" className="admin-filter-label">PF Status:</label>
            <select
              id="pfStatusFilter"
              className="admin-filter-select"
              value={selectedStatus}
              onChange={handleStatusChange}
            >
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="Pending">Pending</option>
              <option value="Not Available">Not Available</option>
            </select>
          </div>

          {/* Department Filter */}
          <div className="admin-filter-group">
            <label htmlFor="deptFilter" className="admin-filter-label">Department:</label>
            <select
              id="deptFilter"
              className="admin-filter-select"
              value={selectedDept}
              onChange={handleDeptChange}
            >
              <option value="All">All Departments</option>
              <option value="IT">IT</option>
              <option value="Non-IT">Non-IT</option>
            </select>
          </div>
        </div>
      </section>

      {/* ====================================================================
          PF TABLE
          ==================================================================== */}
      <section className="admin-card admin-pf-table-card">
        <div className="admin-table-header-meta">
          <span className="admin-results-count">
            Showing <strong>{pfRecords.length}</strong> of {totalCount} employee records
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              className="admin-reset-filters-btn"
              onClick={handleResetFilters}
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Employee ID</th>
                <th scope="col">Employee</th>
                <th scope="col">Department</th>
                <th scope="col">UAN</th>
                <th scope="col">PF Number</th>
                <th scope="col">Employee Contribution</th>
                <th scope="col">Employer Contribution</th>
                <th scope="col">PF Status</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title">Loading PF records...</p>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="9" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title" style={{ color: '#dc2626' }}>
                        {error}
                      </p>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        onClick={fetchPfRecords}
                        style={{ marginTop: '0.5rem' }}
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : pfRecords.length > 0 ? (
                pfRecords.map((rec) => {
                  const statusClass =
                    rec.status === 'Active'
                      ? 'status-active'
                      : rec.status === 'Pending'
                      ? 'status-pending'
                      : 'status-neutral';

                  return (
                    <tr key={rec.employeeId}>
                      {/* Employee ID (Clickable) */}
                      <td>
                        <button
                          type="button"
                          className="admin-id-badge admin-id-badge-interactive"
                          onClick={() => navigate(`/admin/employees/${rec.employeeId}`)}
                          title={`Navigate to ${rec.employeeId}`}
                        >
                          {rec.employeeId}
                        </button>
                      </td>

                      {/* Employee Name (Clickable) */}
                      <td>
                        <button
                          type="button"
                          className="admin-emp-link-btn"
                          onClick={() => navigate(`/admin/employees/${rec.employeeId}`)}
                          title={`View ${rec.name}'s profile`}
                        >
                          {rec.name}
                        </button>
                      </td>

                      {/* Department */}
                      <td>
                        <span className="admin-dept-tag">{rec.department}</span>
                      </td>

                      {/* UAN */}
                      <td className="font-mono">{rec.uan}</td>

                      {/* PF Number */}
                      <td className="font-mono">{rec.pfNumber}</td>

                      {/* Employee Contribution */}
                      <td className="text-contrib">{rec.employeeContribution}</td>

                      {/* Employer Contribution */}
                      <td className="text-contrib">{rec.employerContribution}</td>

                      {/* PF Status */}
                      <td>
                        <span className={`admin-status-badge ${statusClass}`}>
                          <span className="status-dot" aria-hidden="true"></span>
                          {rec.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="text-right">
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-action-btn-pill admin-action-view"
                            onClick={() => setViewRecord(rec)}
                            aria-label={`View PF details for ${rec.name}`}
                          >
                            View
                          </button>

                          <button
                            type="button"
                            className="admin-action-btn-pill admin-action-edit"
                            onClick={() => handleOpenEditModal(rec)}
                            aria-label={`Edit PF details for ${rec.name}`}
                          >
                            Edit
                          </button>

                          {/* More Dropdown */}
                          <div
                            className="admin-dropdown-wrapper"
                            ref={openDropdownId === rec.employeeId ? dropdownRef : null}
                          >
                            <button
                              type="button"
                              className="admin-action-btn-more"
                              onClick={() =>
                                setOpenDropdownId(openDropdownId === rec.employeeId ? null : rec.employeeId)
                              }
                              aria-label={`More options for ${rec.name}`}
                              aria-expanded={openDropdownId === rec.employeeId}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="1" />
                                <circle cx="12" cy="5" r="1" />
                                <circle cx="12" cy="19" r="1" />
                              </svg>
                            </button>

                            {openDropdownId === rec.employeeId && (
                              <div className="admin-action-dropdown-menu" role="menu">
                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item"
                                  onClick={() => {
                                    setOpenDropdownId(null);
                                    setViewRecord(rec);
                                  }}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  <span>View PF Details</span>
                                </button>

                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item"
                                  onClick={() => handleOpenEditModal(rec)}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                  <span>Edit PF Details</span>
                                </button>

                                {rec.status !== 'Not Available' && (
                                  <button
                                    type="button"
                                    className="admin-dropdown-menu-item text-danger"
                                    onClick={() => handleRemovePF(rec.employeeId, rec.name)}
                                    role="menuitem"
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                    <span>Remove PF Details</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="9" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <p className="admin-empty-title">No PF records found</p>
                      <p className="admin-empty-desc">
                        No employee provident fund records match your search or filter selection.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ====================================================================
            PAGINATION
            ==================================================================== */}
        <div className="admin-pagination-wrapper">
          <div className="admin-pagination-info">
            Showing page {currentPage} of {Math.max(1, totalPages)}
          </div>

          <div className="admin-pagination-controls">
            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={currentPage <= 1 || loading}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              &larr; Previous
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                className={`admin-page-btn ${currentPage === page ? 'admin-page-active' : ''}`}
                onClick={() => setCurrentPage(page)}
                disabled={loading}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={currentPage >= totalPages || loading}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </section>

      {/* ====================================================================
          CONTRIBUTION OVERVIEW (Below Table)
          ==================================================================== */}
      <section className="admin-card admin-pf-overview-card" aria-label="Contribution Overview">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">Contribution Overview</h2>
            <p className="admin-card-subtitle">Monthly provident fund deduction totals</p>
          </div>
          <span className="admin-badge admin-badge-neutral">Current Month</span>
        </div>

        <div className="admin-contribution-stats-grid">
          <div className="admin-contribution-box box-blue">
            <span className="contrib-label">Employee Contributions</span>
            <span className="contrib-value">— <span className="contrib-period">/ month</span></span>
            <span className="contrib-desc">Not configured in payroll</span>
          </div>

          <div className="admin-contribution-box box-purple">
            <span className="contrib-label">Employer Contributions</span>
            <span className="contrib-value">— <span className="contrib-period">/ month</span></span>
            <span className="contrib-desc">Not configured in payroll</span>
          </div>

          <div className="admin-contribution-box box-green">
            <span className="contrib-label">Total Monthly Contributions</span>
            <span className="contrib-value text-success">— <span className="contrib-period">/ month</span></span>
            <span className="contrib-desc">EPFO remittance record pending</span>
          </div>
        </div>
      </section>

      {/* ====================================================================
          PF DETAILS VIEW MODAL
          ==================================================================== */}
      {viewRecord && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container admin-pf-modal-shell">
            <div className="admin-modal-header">
              <div className="admin-pf-modal-header-info">
                <div className="admin-doc-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                    <line x1="7" y1="15" x2="7.01" y2="15" />
                    <line x1="11" y1="15" x2="13" y2="15" />
                  </svg>
                </div>
                <div>
                  <h2 className="admin-modal-title">PF Details</h2>
                  <span className="admin-doc-modal-subtitle">
                    {viewRecord.name} ({viewRecord.employeeId})
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setViewRecord(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-modal-body admin-pf-modal-body">
              {/* Employee Information Section */}
              <div className="admin-pf-modal-section">
                <h3 className="admin-pf-section-title">Employee Information</h3>
                <div className="admin-pf-section-grid">
                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Employee ID</span>
                    <span className="pf-item-val font-mono">{viewRecord.employeeId}</span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Employee Name</span>
                    <span className="pf-item-val font-semibold">{viewRecord.name}</span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Department</span>
                    <span className="pf-item-val">{viewRecord.department}</span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Designation</span>
                    <span className="pf-item-val">{viewRecord.designation}</span>
                  </div>
                </div>
              </div>

              {/* PF Information Section */}
              <div className="admin-pf-modal-section">
                <h3 className="admin-pf-section-title">PF Information</h3>
                <div className="admin-pf-section-grid">
                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Universal Account No (UAN)</span>
                    <span className="pf-item-val font-mono">{viewRecord.uan}</span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">PF Number</span>
                    <span className="pf-item-val font-mono">{viewRecord.pfNumber}</span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Pension Number (EPS)</span>
                    <span className="pf-item-val font-mono">{viewRecord.pensionNumber}</span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">PF Status</span>
                    <span className="pf-item-val">
                      <span
                        className={`admin-status-badge ${
                          viewRecord.status === 'Active'
                            ? 'status-active'
                            : viewRecord.status === 'Pending'
                            ? 'status-pending'
                            : 'status-neutral'
                        }`}
                      >
                        <span className="status-dot" aria-hidden="true"></span>
                        {viewRecord.status}
                      </span>
                    </span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Employee Contribution</span>
                    <span className="pf-item-val text-muted">
                      {viewRecord.employeeContribution}
                    </span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Employer Contribution</span>
                    <span className="pf-item-val text-muted">
                      {viewRecord.employerContribution}
                    </span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Total Monthly Contribution</span>
                    <span className="pf-item-val text-muted">
                      —
                    </span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Date of Joining</span>
                    <span className="pf-item-val">{viewRecord.dateOfJoining}</span>
                  </div>

                  <div className="admin-pf-item">
                    <span className="pf-item-lbl">Last Updated</span>
                    <span className="pf-item-val text-muted">{viewRecord.lastUpdated}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setViewRecord(null)}
              >
                Close
              </button>

              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => {
                  setViewRecord(null);
                  navigate(`/admin/employees/${viewRecord.employeeId}`);
                }}
              >
                View Employee
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          EDIT PF DETAILS MODAL
          ==================================================================== */}
      {editRecord && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-modal-container">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Edit PF Details</h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => {
                  setEditRecord(null);
                  setActionError('');
                }}
                disabled={actionLoading}
                aria-label="Close edit dialog"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="admin-modal-form">
              <div className="admin-form-grid">
                {/* Employee Name (Read-only) */}
                <div className="admin-form-field">
                  <label className="admin-field-label">Employee</label>
                  <input
                    type="text"
                    readOnly
                    className="admin-field-input admin-field-readonly"
                    value={editRecord.name}
                  />
                </div>

                {/* Employee ID (Read-only) */}
                <div className="admin-form-field">
                  <label className="admin-field-label">Employee ID</label>
                  <input
                    type="text"
                    readOnly
                    className="admin-field-input admin-field-readonly font-mono"
                    value={editRecord.employeeId}
                  />
                </div>

                {/* UAN */}
                <div className="admin-form-field">
                  <label htmlFor="uanInput" className="admin-field-label">
                    Universal Account No (UAN)
                  </label>
                  <input
                    id="uanInput"
                    type="text"
                    className="admin-field-input font-mono"
                    placeholder="e.g. 100123456789"
                    value={editForm.uan}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, uan: e.target.value }))
                    }
                    disabled={actionLoading}
                  />
                </div>

                {/* PF Number */}
                <div className="admin-form-field">
                  <label htmlFor="pfNumberInput" className="admin-field-label">
                    PF Number
                  </label>
                  <input
                    id="pfNumberInput"
                    type="text"
                    className="admin-field-input font-mono"
                    placeholder="e.g. TG/HYD/1234567"
                    value={editForm.pfNumber}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, pfNumber: e.target.value }))
                    }
                    disabled={actionLoading}
                  />
                </div>

                {/* Pension Number (EPS) */}
                <div className="admin-form-field">
                  <label htmlFor="pensionNumberInput" className="admin-field-label">
                    Pension Number (EPS)
                  </label>
                  <input
                    id="pensionNumberInput"
                    type="text"
                    className="admin-field-input font-mono"
                    placeholder="e.g. EPS/HYD/1234567"
                    value={editForm.pensionNumber}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, pensionNumber: e.target.value }))
                    }
                    disabled={actionLoading}
                  />
                </div>

                {/* Current PF Status */}
                <div className="admin-form-field">
                  <label className="admin-field-label">
                    Current PF Status
                  </label>
                  <input
                    type="text"
                    readOnly
                    className="admin-field-input admin-field-readonly"
                    value={editRecord.status}
                  />
                </div>
              </div>

              {actionError && (
                <div style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.75rem', textAlign: 'left' }}>
                  {actionError}
                </div>
              )}

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => {
                    setEditRecord(null);
                    setActionError('');
                  }}
                  disabled={actionLoading}
                >
                  Cancel
                </button>

                <button type="submit" className="admin-btn-primary" disabled={actionLoading}>
                  {actionLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default PFDetails;
