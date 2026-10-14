import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import EmployeeOnboardingModal from './EmployeeOnboardingModal';
import './Employees.css';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  department: 'Technology',
  designation: '',
  employmentType: 'Full Time',
  workLocation: 'Hyderabad',
  manager: '',
  status: 'Active',
  workingDaysPerWeek: '5',
};

function Employees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 10,
    total_pages: 1,
  });
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [isAddWizardOpen, setIsAddWizardOpen] = useState(false);
  const [modalMode, setModalMode] = useState(null); // 'edit' | null
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('employees'); // 'employees' | 'admins'
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState(null);

  // Permanent Delete Modal state (Employees)
  const [deleteTargetEmployee, setDeleteTargetEmployee] = useState(null);
  const [deleteConfirmEmpId, setDeleteConfirmEmpId] = useState('');
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Permanent Delete Modal state (Admins)
  const [deleteTargetAdmin, setDeleteTargetAdmin] = useState(null);
  const [deleteConfirmAdminEmail, setDeleteConfirmAdminEmail] = useState('');
  const [deleteConfirmAdminChecked, setDeleteConfirmAdminChecked] = useState(false);
  const [isDeletingAdmin, setIsDeletingAdmin] = useState(false);
  const [deleteAdminError, setDeleteAdminError] = useState('');

  // Administrator Details Modal state
  const [viewTargetAdmin, setViewTargetAdmin] = useState(null);

  // Administrator Edit Modal state
  const [editTargetAdmin, setEditTargetAdmin] = useState(null);
  const [editAdminForm, setEditAdminForm] = useState({
    adminId: '',
    firstName: '',
    lastName: '',
    phone: '',
  });
  const [editAdminErrors, setEditAdminErrors] = useState({});
  const [isUpdatingAdmin, setIsUpdatingAdmin] = useState(false);
  const [editAdminGeneralError, setEditAdminGeneralError] = useState('');

  const handleOpenEditAdmin = (admin) => {
    setEditTargetAdmin(admin);
    const nameParts = (admin.name || '').trim().split(/\s+/);
    const firstName = admin.firstName || nameParts[0] || '';
    const lastName = admin.lastName || nameParts.slice(1).join(' ') || '';
    setEditAdminForm({
      adminId: admin.adminId || '',
      firstName,
      lastName,
      phone: admin.phone || '',
    });
    setEditAdminErrors({});
    setEditAdminGeneralError('');
  };

  const handleSaveEditAdmin = async (e) => {
    if (e) e.preventDefault();
    if (!editTargetAdmin) return;
    setEditAdminGeneralError('');
    const errors = {};

    const trimmedAdminId = (editAdminForm.adminId || '').trim().toUpperCase();
    if (!trimmedAdminId) {
      errors.adminId = 'Admin ID Number is required.';
    } else if (trimmedAdminId.length < 2 || trimmedAdminId.length > 30) {
      errors.adminId = 'Admin ID Number must be between 2 and 30 characters.';
    } else if (!/^[A-Z0-9\-_/]+$/.test(trimmedAdminId)) {
      errors.adminId = 'Admin ID Number may only contain letters, numbers, hyphens, slashes, and underscores.';
    }

    if (!editAdminForm.firstName.trim()) {
      errors.firstName = 'First name is required.';
    }
    if (!editAdminForm.lastName.trim()) {
      errors.lastName = 'Last name is required.';
    }
    if (editAdminForm.phone && editAdminForm.phone.trim()) {
      if (!/^[0-9+()\- ]{7,20}$/.test(editAdminForm.phone.trim())) {
        errors.phone = 'Invalid phone number format.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setEditAdminErrors(errors);
      setEditAdminGeneralError('Please fix the validation errors before saving.');
      return;
    }

    setIsUpdatingAdmin(true);
    try {
      const res = await api.admin.updateUser(editTargetAdmin.id, {
        adminId: trimmedAdminId,
        firstName: editAdminForm.firstName.trim(),
        lastName: editAdminForm.lastName.trim(),
        phone: editAdminForm.phone.trim() || undefined,
      });

      if (res && res.success) {
        showToast('Administrator details updated successfully.');
        setEditTargetAdmin(null);
        if (viewTargetAdmin && viewTargetAdmin.id === editTargetAdmin.id) {
          setViewTargetAdmin((prev) => ({
            ...prev,
            adminId: trimmedAdminId,
            firstName: editAdminForm.firstName.trim(),
            lastName: editAdminForm.lastName.trim(),
            name: `${editAdminForm.firstName.trim()} ${editAdminForm.lastName.trim()}`,
            phone: editAdminForm.phone.trim(),
          }));
        }
        fetchAdminUsers();
      } else {
        setEditAdminGeneralError(res?.message || 'Failed to update administrator.');
      }
    } catch (err) {
      const errMsg = err.message || 'Failed to update administrator.';
      setEditAdminGeneralError(errMsg);
      if (errMsg.toLowerCase().includes('admin id')) {
        setEditAdminErrors((prev) => ({ ...prev, adminId: errMsg }));
      }
    } finally {
      setIsUpdatingAdmin(false);
    }
  };

  const dropdownMenuRef = useRef(null);

  const fetchAdminUsers = useCallback(async () => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      const res = await api.admin.getUsers({ role: 'ADMIN' });
      if (res && res.success) {
        setAdminUsers(res.data || []);
      } else {
        setAdminUsers([]);
      }
    } catch (err) {
      setAdminError(err.message || 'Failed to load administrator accounts.');
    } finally {
      setAdminLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAdminUsers();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAdminUsers]);

  // Lock background body scroll while any modal is open
  const isAnyModalOpen = Boolean(
    deleteTargetEmployee ||
    deleteTargetAdmin ||
    viewTargetAdmin ||
    editTargetAdmin ||
    isAddWizardOpen ||
    modalMode
  );

  useEffect(() => {
    if (isAnyModalOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow || '';
      };
    }
  }, [isAnyModalOpen]);

  const handleToggleAdminStatus = async (userId, currentStatus) => {
    try {
      const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const res = await api.admin.updateUserStatus(userId, nextStatus);
      if (res && res.success) {
        showToast(`Administrator status updated to ${nextStatus}.`);
        fetchAdminUsers();
      }
    } catch (err) {
      showToast(err.message || 'Failed to update administrator status.');
    }
  };

  const handleExecutePermanentDelete = async () => {
    if (!deleteTargetEmployee || isDeleting) return;
    setDeleteError('');

    const targetEmpId = String(
      deleteTargetEmployee.employee_id ||
      deleteTargetEmployee.employeeId ||
      deleteTargetEmployee.id ||
      ''
    ).trim();

    if (!targetEmpId) {
      setDeleteError('Unable to identify target employee ID from record.');
      return;
    }

    const trimmedInput = (deleteConfirmEmpId || '').trim();
    if (trimmedInput.toUpperCase() !== targetEmpId.toUpperCase()) {
      setDeleteError(`Confirmation Employee ID does not match. Expected "${targetEmpId}".`);
      return;
    }

    if (!deleteConfirmChecked) {
      setDeleteError('Please check the confirmation box to authorize permanent deletion.');
      return;
    }

    setIsDeleting(true);
    try {
      const res = await api.admin.deleteEmployeePermanently(targetEmpId, {
        confirmEmployeeId: trimmedInput.toUpperCase(),
        confirmCheckbox: true,
      });

      showToast(res?.message || `Employee ${targetEmpId} permanently deleted.`);
      setDeleteTargetEmployee(null);
      setDeleteConfirmEmpId('');
      setDeleteConfirmChecked(false);
      setDeleteError('');
      fetchEmployees(searchQuery, selectedStatus, currentPage);
    } catch (err) {
      setDeleteError(err.message || 'Failed to permanently delete employee.');
    } finally {
      setIsDeleting(false);
    }
  };

  const isSelfAdmin = useCallback(
    (targetAdmin) => {
      if (!targetAdmin || !currentUser) return false;
      if (targetAdmin.id && currentUser.id && String(targetAdmin.id) === String(currentUser.id)) return true;
      if (
        targetAdmin.email &&
        currentUser.email &&
        targetAdmin.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()
      ) {
        return true;
      }
      return false;
    },
    [currentUser]
  );

  const handleExecuteDeleteAdmin = async () => {
    if (!deleteTargetAdmin || isDeletingAdmin) return;
    setDeleteAdminError('');

    if (isSelfAdmin(deleteTargetAdmin)) {
      setDeleteAdminError('Administrators cannot delete their own account. Another active administrator must perform this action.');
      return;
    }

    const targetEmail = (deleteTargetAdmin.email || '').trim().toLowerCase();
    const typedEmail = (deleteConfirmAdminEmail || '').trim().toLowerCase();

    if (typedEmail !== targetEmail) {
      setDeleteAdminError('Confirmation email does not match the target administrator email.');
      return;
    }

    if (!deleteConfirmAdminChecked) {
      setDeleteAdminError('Please check the confirmation box to authorize permanent deletion.');
      return;
    }

    setIsDeletingAdmin(true);
    try {
      const res = await api.admin.deleteUserPermanently(deleteTargetAdmin.id, {
        confirmationEmail: typedEmail,
        confirmed: true,
      });

      showToast(res?.message || `Administrator ${deleteTargetAdmin.email} permanently deleted.`);
      setDeleteTargetAdmin(null);
      setDeleteConfirmAdminEmail('');
      setDeleteConfirmAdminChecked(false);
      setDeleteAdminError('');
      fetchAdminUsers();
    } catch (err) {
      setDeleteAdminError(err.message || 'Failed to permanently delete administrator account.');
    } finally {
      setIsDeletingAdmin(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownMenuRef.current && !dropdownMenuRef.current.contains(event.target)) {
        setOpenDropdownId(null);
      }
    };

    if (openDropdownId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openDropdownId]);

  // Toast auto-dismiss
  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage('');
    }, 3500);
  };

  // Fetch employees from backend API
  const fetchEmployees = useCallback(async (search, status, page) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: 10,
      };
      if (search && search.trim()) {
        params.search = search.trim();
      }
      if (status && status !== 'All') {
        params.status = status;
      }
      const response = await api.admin.getEmployees(params);
      if (response && response.success) {
        setEmployees(response.data || []);
        if (response.pagination) {
          setPagination(response.pagination);
        }
      } else {
        setEmployees([]);
      }
    } catch (err) {
      if (err.status === 403) {
        setError('Access denied. Administrator privileges required.');
      } else {
        setError(err.message || 'Failed to load employee records.');
      }
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced effect for search, status, and page
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEmployees(searchQuery, selectedStatus, currentPage);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedStatus, currentPage, fetchEmployees]);

  // Secondary client-side department filter
  const displayedEmployees = useMemo(() => {
    if (selectedDept === 'All') return employees;
    return employees.filter(
      (emp) => emp.department && emp.department.toLowerCase() === selectedDept.toLowerCase()
    );
  }, [employees, selectedDept]);

  // Handlers for search and filters
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusChange = (e) => {
    setSelectedStatus(e.target.value);
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDept('All');
    setSelectedStatus('All');
    setCurrentPage(1);
  };

  // Open Add Modal (8-Step Onboarding Wizard)
  const handleOpenAddModal = () => {
    setIsAddWizardOpen(true);
  };

  // Open Edit Experience (8-Step Full Edit Page)
  const handleOpenEditModal = (emp) => {
    setOpenDropdownId(null);
    const empId = emp.employee_id || emp.id;
    navigate(`/admin/employees/${empId}/edit`);
  };

  // Toggle status (Active / Inactive)
  const handleToggleStatus = async (empId, currentStatus) => {
    setOpenDropdownId(null);
    const newStatus = (currentStatus || '').toUpperCase() === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await api.admin.updateEmployeeStatus(empId, newStatus, 'Status changed via Employee list');
      if (res && res.success) {
        showToast(`Employee ${empId} status updated to ${newStatus}.`);
        fetchEmployees(searchQuery, selectedStatus, currentPage);
      } else {
        showToast(res?.message || 'Failed to update employee status.');
      }
    } catch (err) {
      showToast(err.message || 'Error updating employee status.');
    }
  };

  // Close Modal
  const handleCloseModal = () => {
    setModalMode(null);
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setFormError('');
  };

  // Form input change
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Save Employee (Edit Mode)
  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      if (modalMode === 'edit' && editingId) {
        const payload = {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName ? formData.lastName.trim() : '',
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone ? formData.phone.replace(/\D/g, '').slice(-10) : undefined,
          department: formData.department,
          designation: formData.designation ? formData.designation.trim() : '',
          employmentType: formData.employmentType,
          reportingManager: formData.manager ? formData.manager.trim() : null,
          city: formData.workLocation || 'Hyderabad',
          workingDaysPerWeek: formData.workingDaysPerWeek ? parseInt(formData.workingDaysPerWeek, 10) : 5,
        };
        const res = await api.admin.updateEmployee(editingId, payload);
        if (res && res.success) {
          showToast(`Employee ${editingId} updated successfully.`);
          handleCloseModal();
          fetchEmployees(searchQuery, selectedStatus, currentPage);
        } else {
          setFormError(res?.message || 'Failed to update employee.');
        }
      }
    } catch (err) {
      setFormError(err.message || 'An error occurred while saving employee.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-employees-page">
      {/* Top Action Area */}
      <header className="admin-employees-header">
        <div className="admin-header-title-block">
          <div className="admin-title-row">
            <h1 className="admin-employees-title">
              {activeTab === 'admins' ? 'Administrators' : 'Employees'}
            </h1>
            <span className="admin-total-badge">
              {activeTab === 'admins'
                ? `${adminUsers.length} total ${adminUsers.length === 1 ? 'admin' : 'admins'}`
                : `${pagination.total} total ${pagination.total === 1 ? 'employee' : 'employees'}`}
            </span>
          </div>
          <p className="admin-employees-subtitle">
            {activeTab === 'admins'
              ? 'Manage administrator accounts and portal access.'
              : 'Manage employee records and employment information.'}
          </p>

          {/* View Switcher Tabs */}
          <div className="admin-view-tabs" role="tablist" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'employees'}
              className={`admin-tab-btn ${activeTab === 'employees' ? 'active' : ''}`}
              onClick={() => setActiveTab('employees')}
              style={{
                padding: '0.45rem 1rem',
                borderRadius: '0.375rem',
                fontWeight: 600,
                fontSize: '0.875rem',
                border: '1px solid',
                borderColor: activeTab === 'employees' ? '#2563eb' : '#cbd5e1',
                backgroundColor: activeTab === 'employees' ? '#eff6ff' : '#ffffff',
                color: activeTab === 'employees' ? '#1d4ed8' : '#64748b',
                cursor: 'pointer',
              }}
            >
              Employees ({pagination.total})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'admins'}
              className={`admin-tab-btn ${activeTab === 'admins' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('admins');
                fetchAdminUsers();
              }}
              style={{
                padding: '0.45rem 1rem',
                borderRadius: '0.375rem',
                fontWeight: 600,
                fontSize: '0.875rem',
                border: '1px solid',
                borderColor: activeTab === 'admins' ? '#2563eb' : '#cbd5e1',
                backgroundColor: activeTab === 'admins' ? '#eff6ff' : '#ffffff',
                color: activeTab === 'admins' ? '#1d4ed8' : '#64748b',
                cursor: 'pointer',
              }}
            >
              Administrators ({adminUsers.length})
            </button>
          </div>
        </div>

        <button
          type="button"
          className="admin-btn-primary admin-add-btn"
          onClick={handleOpenAddModal}
        >
          <svg
            className="admin-btn-svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{activeTab === 'admins' ? 'Add User / Admin' : 'Add Employee'}</span>
        </button>
      </header>

      {/* Toast Banner */}
      {toastMessage && (
        <div className="admin-toast-banner" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          style={{
            padding: '0.875rem 1.25rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '0.5rem',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.875rem',
            gap: '1rem',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchEmployees(searchQuery, selectedStatus, currentPage)}
            style={{
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.35rem 0.75rem',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              fontWeight: '600',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Administrators View */}
      {activeTab === 'admins' ? (
        <section className="admin-table-card" aria-label="Administrators List">
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
              Administrator Accounts
            </h2>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
              Portal administrative users. Pure administrators do not have employee profiles or payroll records.
            </p>
          </div>

          {adminLoading ? (
            <div className="admin-table-loading" role="status" style={{ padding: '3rem', textAlign: 'center' }}>
              <span style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading administrator records...</span>
            </div>
          ) : adminError ? (
            <div style={{ padding: '1.5rem', color: '#991b1b', backgroundColor: '#fef2f2' }} role="alert">
              <span>{adminError}</span>
              <button
                type="button"
                onClick={fetchAdminUsers}
                style={{
                  marginLeft: '1rem',
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="admin-table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Admin ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created At</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.length > 0 ? (
                    adminUsers.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          {admin.adminId ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                backgroundColor: '#f1f5f9',
                                color: '#1e293b',
                                letterSpacing: '0.05em',
                                fontFamily: 'monospace',
                              }}
                            >
                              {admin.adminId}
                            </span>
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                backgroundColor: '#fef3c7',
                                color: '#92400e',
                              }}
                              title="Admin ID not yet assigned. Click Edit to assign an ID."
                            >
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="admin-emp-cell">
                            <div className="admin-emp-avatar" aria-hidden="true">
                              {((admin.firstName || admin.name || 'A')[0]).toUpperCase()}
                            </div>
                            <span className="admin-emp-name">{admin.name || 'Administrator'}</span>
                          </div>
                        </td>
                        <td>
                          <span className="admin-emp-email">{admin.email}</span>
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '0.25rem',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              backgroundColor: '#e0e7ff',
                              color: '#3730a3',
                            }}
                          >
                            {admin.role}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`admin-status-badge admin-status-${(admin.status || '').toLowerCase()}`}
                          >
                            <span className="admin-status-dot" aria-hidden="true" />
                            {admin.status}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                            {admin.createdAt ? new Date(admin.createdAt).toLocaleDateString() : '—'}
                          </span>
                        </td>
                        <td className="text-right">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="admin-action-btn-pill admin-action-view"
                              onClick={() => setViewTargetAdmin(admin)}
                              style={{
                                fontSize: '0.75rem',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="admin-action-btn-pill admin-action-edit"
                              onClick={() => handleOpenEditAdmin(admin)}
                              style={{
                                fontSize: '0.75rem',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Edit
                            </button>
                            {isSelfAdmin(admin) ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '0.25rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  backgroundColor: '#f1f5f9',
                                  color: '#475569',
                                }}
                              >
                                Current (You)
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={`admin-action-btn-pill ${admin.status === 'ACTIVE' ? 'admin-action-deactivate' : 'admin-action-activate'}`}
                                  onClick={() => handleToggleAdminStatus(admin.id, admin.status)}
                                  style={{
                                    fontSize: '0.75rem',
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '0.25rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '1px solid',
                                    backgroundColor: admin.status === 'ACTIVE' ? '#fef3c7' : '#dcfce7',
                                    color: admin.status === 'ACTIVE' ? '#92400e' : '#166534',
                                    borderColor: admin.status === 'ACTIVE' ? '#fde68a' : '#86efac',
                                  }}
                                >
                                  {admin.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                                </button>
                                <button
                                  type="button"
                                  className="admin-action-btn-pill"
                                  onClick={() => {
                                    setDeleteTargetAdmin(admin);
                                    setDeleteConfirmAdminEmail('');
                                    setDeleteConfirmAdminChecked(false);
                                    setDeleteAdminError('');
                                  }}
                                  style={{
                                    fontSize: '0.75rem',
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '0.25rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '1px solid #fca5a5',
                                    backgroundColor: '#fee2e2',
                                    color: '#991b1b',
                                  }}
                                  title="Permanently delete administrator"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="admin-empty-table-cell">
                        <div className="admin-empty-state">
                          <p className="admin-empty-title">No administrators found</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <>
          {/* Search and Filters Section */}
          <section className="admin-filters-card" aria-label="Search and Filter Employees">
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
            placeholder="Search employees by ID, name, email, department, designation..."
            value={searchQuery}
            onChange={handleSearchChange}
            aria-label="Search employees"
          />
          {searchQuery && (
            <button
              type="button"
              className="admin-search-clear-btn"
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        <div className="admin-filter-controls">
          {/* Department Filter */}
          <div className="admin-filter-group">
            <label htmlFor="dept-filter" className="admin-filter-label">Department:</label>
            <select
              id="dept-filter"
              className="admin-filter-select"
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
            >
              <option value="All">All Departments</option>
              <option value="IT">IT</option>
              <option value="Non-IT">Non-IT</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="admin-filter-group">
            <label htmlFor="status-filter" className="admin-filter-label">Status:</label>
            <select
              id="status-filter"
              className="admin-filter-select"
              value={selectedStatus}
              onChange={handleStatusChange}
            >
              <option value="All">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>
      </section>

      {/* Employee Table Card */}
      <section className="admin-card admin-employees-table-card">
        <div className="admin-table-header-meta">
          <span className="admin-results-count">
            Showing <strong>{displayedEmployees.length}</strong> of {pagination.total} employees
          </span>
          {(searchQuery || selectedDept !== 'All' || selectedStatus !== 'All') && (
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
                <th scope="col">Email</th>
                <th scope="col">Department</th>
                <th scope="col">Designation</th>
                <th scope="col">Joining Date</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title">Loading employees...</p>
                      <p className="admin-empty-desc">Fetching employee records from database.</p>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="8" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <p className="admin-empty-title text-danger">{error}</p>
                      <button
                        type="button"
                        className="admin-btn-primary"
                        style={{ marginTop: '0.75rem' }}
                        onClick={() => fetchEmployees(searchQuery, selectedStatus, currentPage)}
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : displayedEmployees.length > 0 ? (
                displayedEmployees.map((emp) => {
                  const empId = emp.employee_id || emp.id;
                  const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || empId;
                  const avatarInitials = (emp.first_name?.[0] || '') + (emp.last_name?.[0] || '') || (empId?.[0] || 'E');
                  const formattedStatus = emp.status
                    ? emp.status.charAt(0).toUpperCase() + emp.status.slice(1).toLowerCase()
                    : 'Active';

                  return (
                    <tr key={empId}>
                      <td>
                        <span className="admin-id-badge">{empId}</span>
                      </td>
                      <td>
                        <div className="admin-user-cell">
                          <div className="admin-user-avatar-small">{avatarInitials.toUpperCase()}</div>
                          <span className="admin-user-name-strong">{fullName}</span>
                        </div>
                      </td>
                      <td>
                        <span className="admin-email-text">{emp.email || '—'}</span>
                      </td>
                      <td>
                        <span className="admin-dept-tag">{emp.department || '—'}</span>
                      </td>
                      <td className="text-muted">{emp.designation || '—'}</td>
                      <td className="text-muted">{emp.date_of_joining || '—'}</td>
                      <td>
                        <span className={`admin-status-badge status-${(emp.status || 'active').toLowerCase()}`}>
                          <span className="status-dot" aria-hidden="true"></span>
                          {formattedStatus}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-action-btn-pill admin-action-view"
                            onClick={() => navigate(`/admin/employees/${empId}`)}
                            aria-label={`View ${fullName}`}
                          >
                            View
                          </button>

                          <button
                            type="button"
                            className="admin-action-btn-pill admin-action-edit"
                            onClick={() => handleOpenEditModal(emp)}
                            aria-label={`Edit ${fullName}`}
                          >
                            Edit
                          </button>

                          {/* More Menu Dropdown */}
                          <div className="admin-dropdown-wrapper" ref={openDropdownId === empId ? dropdownMenuRef : null}>
                            <button
                              type="button"
                              className="admin-action-btn-more"
                              onClick={() =>
                                setOpenDropdownId(openDropdownId === empId ? null : empId)
                              }
                              aria-label={`More actions for ${fullName}`}
                              aria-expanded={openDropdownId === empId}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="1" />
                                <circle cx="12" cy="5" r="1" />
                                <circle cx="12" cy="19" r="1" />
                              </svg>
                            </button>

                            {openDropdownId === empId && (
                              <div className="admin-action-dropdown-menu" role="menu">
                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item"
                                  onClick={() => {
                                    setOpenDropdownId(null);
                                    navigate(`/admin/employees/${empId}`);
                                  }}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  <span>View Details</span>
                                </button>

                                <button
                                  type="button"
                                  className="admin-dropdown-menu-item"
                                  onClick={() => handleOpenEditModal(emp)}
                                  role="menuitem"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                  <span>Edit Employee</span>
                                </button>

                                <button
                                  type="button"
                                  className={`admin-dropdown-menu-item ${
                                    (emp.status || '').toUpperCase() === 'ACTIVE' ? 'text-danger' : 'text-success'
                                  }`}
                                  onClick={() => handleToggleStatus(empId, emp.status)}
                                  role="menuitem"
                                >
                                  {(emp.status || '').toUpperCase() === 'ACTIVE' ? (
                                    <>
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                      </svg>
                                      <span>Deactivate</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                      <span>Activate</span>
                                    </>
                                  )}
                                </button>

                                {(currentUser?.role === 'ADMIN') && (
                                  <button
                                    type="button"
                                    className="admin-dropdown-menu-item text-danger"
                                    onClick={() => {
                                      setOpenDropdownId(null);
                                      setDeleteTargetEmployee(emp);
                                      setDeleteConfirmEmpId('');
                                      setDeleteConfirmChecked(false);
                                      setDeleteError('');
                                    }}
                                    role="menuitem"
                                    style={{ color: '#dc2626' }}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                    <span>Permanently Delete</span>
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
                  <td colSpan="8" className="admin-empty-table-cell">
                    <div className="admin-empty-state">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <p className="admin-empty-title">No employees found</p>
                      <p className="admin-empty-desc">
                        No employee records match the search query or filter selection.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination UI */}
        <div className="admin-pagination-wrapper">
          <div className="admin-pagination-info">
            Showing page {pagination.page} of {pagination.total_pages}
          </div>

          <div className="admin-pagination-controls">
            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              &larr; Previous
            </button>

            {Array.from({ length: pagination.total_pages || 1 }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                className={`admin-page-btn ${currentPage === page ? 'admin-page-active' : ''}`}
                disabled={loading}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              className="admin-page-btn admin-page-nav"
              disabled={pagination.page >= pagination.total_pages || loading}
              onClick={() => setCurrentPage((p) => Math.min(pagination.total_pages, p + 1))}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </section>
        </>
      )}

      {/* 8-Step Employee Onboarding Wizard Modal */}
      <EmployeeOnboardingModal
        isOpen={isAddWizardOpen}
        onClose={() => setIsAddWizardOpen(false)}
        onSuccess={(newId, customMessage) => {
          showToast(customMessage || `Employee ${newId} onboarded successfully!`);
          fetchEmployees(searchQuery, selectedStatus, 1);
          fetchAdminUsers();
        }}
      />

      {/* Edit Employee Profile Modal */}
      {modalMode === 'edit' && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div className="admin-modal-container">
            <div className="admin-modal-header">
              <h2 id="edit-modal-title" className="admin-modal-title">
                Edit Employee ({editingId})
              </h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={handleCloseModal}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="admin-modal-form">
              {formError && (
                <div
                  role="alert"
                  style={{
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '0.375rem',
                    color: '#991b1b',
                    fontSize: '0.875rem',
                  }}
                >
                  {formError}
                </div>
              )}

              <div className="admin-form-grid">
                {/* First Name */}
                <div className="admin-form-field">
                  <label htmlFor="editFirstName" className="admin-field-label">
                    First Name <span className="required" style={{ color: '#dc2626', marginLeft: '2px' }}>*</span>
                  </label>
                  <input
                    id="editFirstName"
                    name="firstName"
                    type="text"
                    required
                    aria-required="true"
                    className="admin-field-input"
                    value={formData.firstName}
                    onChange={handleFormChange}
                    placeholder="Enter first name"
                  />
                </div>

                {/* Last Name */}
                <div className="admin-form-field">
                  <label htmlFor="editLastName" className="admin-field-label">
                    Last Name <span className="required" style={{ color: '#dc2626', marginLeft: '2px' }}>*</span>
                  </label>
                  <input
                    id="editLastName"
                    name="lastName"
                    type="text"
                    required
                    aria-required="true"
                    className="admin-field-input"
                    value={formData.lastName}
                    onChange={handleFormChange}
                    placeholder="Enter last name"
                  />
                </div>

                {/* Email */}
                <div className="admin-form-field">
                  <label htmlFor="editEmail" className="admin-field-label">
                    Organization Email <span className="required" style={{ color: '#dc2626', marginLeft: '2px' }}>*</span>
                  </label>
                  <input
                    id="editEmail"
                    name="email"
                    type="email"
                    required
                    aria-required="true"
                    className="admin-field-input"
                    value={formData.email}
                    onChange={handleFormChange}
                    placeholder="Enter official email"
                  />
                </div>

                {/* Phone */}
                <div className="admin-form-field">
                  <label htmlFor="editPhone" className="admin-field-label">Phone Number</label>
                  <input
                    id="editPhone"
                    name="phone"
                    type="tel"
                    className="admin-field-input"
                    value={formData.phone}
                    onChange={handleFormChange}
                    placeholder="Enter 10-digit phone number"
                  />
                </div>

                {/* Department */}
                <div className="admin-form-field">
                  <label htmlFor="editDepartment" className="admin-field-label">
                    Department <span className="required" style={{ color: '#dc2626', marginLeft: '2px' }}>*</span>
                  </label>
                  <select
                    id="editDepartment"
                    name="department"
                    required
                    aria-required="true"
                    className="admin-field-select"
                    value={formData.department}
                    onChange={handleFormChange}
                  >
                    <option value="Technology">Technology</option>
                    <option value="HR">HR</option>
                    <option value="Finance">Finance</option>
                    <option value="Operations">Operations</option>
                    <option value="Sales">Sales</option>
                    <option value="Marketing">Marketing</option>
                  </select>
                </div>

                {/* Designation */}
                <div className="admin-form-field">
                  <label htmlFor="editDesignation" className="admin-field-label">
                    Designation <span className="required" style={{ color: '#dc2626', marginLeft: '2px' }}>*</span>
                  </label>
                  <select
                    id="editDesignation"
                    name="designation"
                    required
                    aria-required="true"
                    className="admin-field-select"
                    value={formData.designation}
                    onChange={handleFormChange}
                  >
                    <option value="">Select Designation</option>
                    <option value="Associate Software Engineer">Associate Software Engineer</option>
                    <option value="Associate">Associate</option>
                  </select>
                </div>

                {/* Employment Type */}
                <div className="admin-form-field">
                  <label htmlFor="editEmploymentType" className="admin-field-label">Employment Type</label>
                  <select
                    id="editEmploymentType"
                    name="employmentType"
                    className="admin-field-select"
                    value={formData.employmentType}
                    onChange={handleFormChange}
                  >
                    <option value="Full Time">Full Time</option>
                    <option value="Contract">Contract</option>
                    <option value="Intern">Intern</option>
                    <option value="Part Time">Part Time</option>
                  </select>
                </div>

                {/* Work Location */}
                <div className="admin-form-field">
                  <label htmlFor="editWorkLocation" className="admin-field-label">Work Location</label>
                  <select
                    id="editWorkLocation"
                    name="workLocation"
                    className="admin-field-select"
                    value={formData.workLocation}
                    onChange={handleFormChange}
                  >
                    <option value="Hyderabad">Hyderabad</option>
                    <option value="Bangalore">Bangalore</option>
                    <option value="Mumbai">Mumbai</option>
                    <option value="Pune">Pune</option>
                    <option value="Remote">Remote</option>
                  </select>
                </div>

                {/* Manager */}
                <div className="admin-form-field">
                  <label htmlFor="editManager" className="admin-field-label">Reporting Manager</label>
                  <input
                    id="editManager"
                    name="manager"
                    type="text"
                    className="admin-field-input"
                    value={formData.manager}
                    onChange={handleFormChange}
                    placeholder="Enter reporting manager name"
                  />
                </div>

                {/* Status */}
                <div className="admin-form-field">
                  <label htmlFor="editStatus" className="admin-field-label">Status</label>
                  <select
                    id="editStatus"
                    name="status"
                    className="admin-field-select"
                    value={formData.status}
                    onChange={handleFormChange}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>

                {/* Working Days per Week */}
                <div className="admin-form-field">
                  <label htmlFor="editWorkingDaysPerWeek" className="admin-field-label">
                    Working Days per Week <span className="required" style={{ color: '#dc2626', marginLeft: '2px' }}>*</span>
                  </label>
                  <select
                    id="editWorkingDaysPerWeek"
                    name="workingDaysPerWeek"
                    required
                    aria-required="true"
                    className="admin-field-select"
                    value={formData.workingDaysPerWeek || '5'}
                    onChange={handleFormChange}
                  >
                    <option value="5">5 Days</option>
                    <option value="6">6 Days</option>
                  </select>
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    Defines the employee's regular weekly working schedule.
                  </span>
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={handleCloseModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Modal (Employees) */}
      {/* Permanent Delete Confirmation Modal (Employees) */}
      {deleteTargetEmployee && (() => {
        const targetEmpId = String(
          deleteTargetEmployee.employee_id ||
          deleteTargetEmployee.employeeId ||
          deleteTargetEmployee.id ||
          ''
        ).trim();
        const normalizedTargetEmpId = targetEmpId.toUpperCase();
        const typedConfirmEmpId = (deleteConfirmEmpId || '').trim();
        const normalizedTypedEmpId = typedConfirmEmpId.toUpperCase();
        const isEmpIdMatched = Boolean(normalizedTargetEmpId && normalizedTypedEmpId === normalizedTargetEmpId);
        const isDeleteEnabled = Boolean(isEmpIdMatched && deleteConfirmChecked && !isDeleting);

        return (
          <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
            <div className="admin-modal-container admin-delete-modal-container" style={{ maxWidth: '580px', maxHeight: '85vh' }}>
              <div className="admin-modal-header" style={{ borderBottom: '2px solid #ef4444', flexShrink: 0 }}>
                <div className="wizard-title-block">
                  <h2 id="delete-modal-title" className="admin-modal-title" style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" style={{ width: '1.5rem', height: '1.5rem', flexShrink: 0 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Permanently Delete Employee
                  </h2>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                    Irreversible destructive operation
                  </p>
                </div>
                <button
                  type="button"
                  className="admin-modal-close-btn"
                  onClick={() => {
                    setDeleteTargetEmployee(null);
                    setDeleteConfirmEmpId('');
                    setDeleteConfirmChecked(false);
                    setDeleteError('');
                  }}
                  aria-label="Close modal"
                  disabled={isDeleting}
                >
                  &times;
                </button>
              </div>

              <div className="admin-modal-body-scrollable">
                {deleteError && (
                  <div
                    role="alert"
                    style={{
                      padding: '0.75rem 1rem',
                      marginBottom: '1rem',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '0.375rem',
                      color: '#991b1b',
                      fontSize: '0.875rem',
                    }}
                  >
                    {deleteError}
                  </div>
                )}

                <div style={{ backgroundColor: '#f8fafc', padding: '0.875rem 1rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>Employee ID:</span>
                    <span style={{ fontSize: '0.875rem', color: '#0f172a', fontWeight: 700, fontFamily: 'monospace' }}>
                      {targetEmpId || '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>Employee Name:</span>
                    <span style={{ fontSize: '0.875rem', color: '#0f172a', fontWeight: 600 }}>
                      {deleteTargetEmployee.first_name} {deleteTargetEmployee.last_name || ''}
                    </span>
                  </div>
                </div>

                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', padding: '1rem', color: '#991b1b', fontSize: '0.8125rem', lineHeight: '1.5', marginBottom: '1.25rem' }}>
                  <p style={{ fontWeight: 700, margin: '0 0 0.5rem 0', textTransform: 'uppercase' }}>WARNING:</p>
                  <p style={{ margin: '0 0 0.5rem 0' }}>
                    This action permanently removes this employee's account and employee-linked data.
                  </p>
                  <p style={{ margin: '0 0 0.25rem 0' }}>It may remove:</p>
                  <ul style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.25rem' }}>
                    <li>Employee profile</li>
                    <li>Login account</li>
                    <li>PF details</li>
                    <li>Payroll profile</li>
                    <li>Payroll history</li>
                    <li>Attendance</li>
                    <li>Leave requests</li>
                    <li>Leave balances</li>
                    <li>Documents &amp; private storage files</li>
                    <li>Offboarding records</li>
                    <li>F&amp;F records</li>
                  </ul>
                  <p style={{ margin: 0, fontWeight: 700 }}>This action cannot be undone.</p>
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label htmlFor="deleteConfirmEmpIdInput" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.375rem' }}>
                    To confirm, type the Employee ID:
                  </label>
                  <input
                    type="text"
                    id="deleteConfirmEmpIdInput"
                    className="admin-field-input"
                    placeholder={`Enter ${targetEmpId || 'Employee ID'}`}
                    value={deleteConfirmEmpId}
                    onChange={(e) => {
                      setDeleteConfirmEmpId(e.target.value);
                      setDeleteError('');
                    }}
                    disabled={isDeleting}
                    autoComplete="off"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      borderColor: typedConfirmEmpId
                        ? isEmpIdMatched
                          ? '#16a34a'
                          : '#dc2626'
                        : '#cbd5e1',
                    }}
                  />
                  {typedConfirmEmpId ? (
                    <div
                      id="delete-empid-feedback"
                      role={isEmpIdMatched ? 'status' : 'alert'}
                      style={{
                        marginTop: '0.375rem',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color: isEmpIdMatched ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {isEmpIdMatched
                        ? `✓ Employee ID matches target employee (${targetEmpId})`
                        : `✗ Employee ID does not match. Expected: ${targetEmpId}`}
                    </div>
                  ) : (
                    <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      Type the exact Employee ID (<strong>{targetEmpId}</strong>) to confirm.
                    </small>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                  <input
                    type="checkbox"
                    id="deleteConfirmCheck"
                    checked={deleteConfirmChecked}
                    onChange={(e) => {
                      setDeleteConfirmChecked(e.target.checked);
                      setDeleteError('');
                    }}
                    disabled={isDeleting}
                    style={{ marginTop: '0.2rem', width: '1rem', height: '1rem', cursor: 'pointer' }}
                  />
                  <label htmlFor="deleteConfirmCheck" style={{ fontSize: '0.8125rem', color: '#334155', fontWeight: 500, cursor: 'pointer' }}>
                    I understand that this action permanently deletes the employee's data.
                  </label>
                </div>
              </div>

              <div className="admin-modal-footer" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => {
                    setDeleteTargetEmployee(null);
                    setDeleteConfirmEmpId('');
                    setDeleteConfirmChecked(false);
                    setDeleteError('');
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={handleExecutePermanentDelete}
                  disabled={!isDeleteEnabled}
                  title={
                    !isEmpIdMatched
                      ? `Type matching Employee ID (${targetEmpId})`
                      : !deleteConfirmChecked
                      ? 'Check the confirmation checkbox to authorize permanent deletion'
                      : 'Permanently delete this employee'
                  }
                  style={{
                    backgroundColor: '#dc2626',
                    borderColor: '#dc2626',
                    color: '#ffffff',
                    fontWeight: 600,
                    opacity: isDeleteEnabled ? 1 : 0.5,
                    cursor: isDeleteEnabled ? 'pointer' : 'not-allowed',
                  }}
                >
                  {isDeleting ? 'Deleting Permanently...' : 'Permanently Delete Employee'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Permanent Delete Admin Confirmation Modal */}
      {deleteTargetAdmin && (() => {
        const targetAdminEmail = (deleteTargetAdmin.email || '').trim().toLowerCase();
        const typedConfirmEmail = (deleteConfirmAdminEmail || '').trim().toLowerCase();
        const isEmailMatched = Boolean(targetAdminEmail && typedConfirmEmail === targetAdminEmail);
        const isTargetAdminSelf = isSelfAdmin(deleteTargetAdmin);
        const isDeleteAdminDisabled =
          isDeletingAdmin ||
          !isEmailMatched ||
          !deleteConfirmAdminChecked ||
          isTargetAdminSelf;

        return (
          <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-admin-modal-title">
            <div className="admin-modal-container admin-delete-modal-container" style={{ maxWidth: '580px', maxHeight: '85vh' }}>
              <div className="admin-modal-header" style={{ borderBottom: '2px solid #ef4444', flexShrink: 0 }}>
                <div className="wizard-title-block">
                  <h2 id="delete-admin-modal-title" className="admin-modal-title" style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" style={{ width: '1.5rem', height: '1.5rem', flexShrink: 0 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Permanently Delete Administrator
                  </h2>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                    Irreversible destructive operation
                  </p>
                </div>
                <button
                  type="button"
                  className="admin-modal-close-btn"
                  onClick={() => {
                    setDeleteTargetAdmin(null);
                    setDeleteConfirmAdminEmail('');
                    setDeleteConfirmAdminChecked(false);
                    setDeleteAdminError('');
                  }}
                  aria-label="Close modal"
                  disabled={isDeletingAdmin}
                >
                  &times;
                </button>
              </div>

              <div className="admin-modal-body-scrollable">
                {deleteAdminError && (
                  <div
                    role="alert"
                    style={{
                      padding: '0.75rem 1rem',
                      marginBottom: '1rem',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '0.375rem',
                      color: '#991b1b',
                      fontSize: '0.875rem',
                    }}
                  >
                    {deleteAdminError}
                  </div>
                )}

                <div style={{ backgroundColor: '#f8fafc', padding: '0.875rem 1rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>Admin ID:</span>
                    <span style={{ fontSize: '0.875rem', color: '#0f172a', fontWeight: 700, fontFamily: 'monospace' }}>
                      {deleteTargetAdmin.adminId || 'Unassigned'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>Administrator Email:</span>
                    <span style={{ fontSize: '0.875rem', color: '#0f172a', fontWeight: 700 }}>
                      {deleteTargetAdmin.email}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>Administrator Name:</span>
                    <span style={{ fontSize: '0.875rem', color: '#0f172a', fontWeight: 600 }}>
                      {deleteTargetAdmin.name || 'Administrator'}
                    </span>
                  </div>
                </div>

                {isTargetAdminSelf ? (
                  <div
                    role="alert"
                    style={{
                      backgroundColor: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '0.375rem',
                      padding: '1rem',
                      color: '#92400e',
                      fontSize: '0.8125rem',
                      lineHeight: '1.5',
                      marginBottom: '1.25rem',
                    }}
                  >
                    <p style={{ fontWeight: 700, margin: '0 0 0.375rem 0', textTransform: 'uppercase' }}>
                      Self-Deletion Not Permitted
                    </p>
                    <p style={{ margin: 0 }}>
                      You are currently logged in as this administrator (<strong>{deleteTargetAdmin.email}</strong>).
                      To maintain uninterrupted administrative access and prevent accidental portal lockout, you cannot delete your own account.
                      Another active administrator must perform this action.
                    </p>
                  </div>
                ) : (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', padding: '1rem', color: '#991b1b', fontSize: '0.8125rem', lineHeight: '1.5', marginBottom: '1.25rem' }}>
                    <p style={{ fontWeight: 700, margin: '0 0 0.5rem 0', textTransform: 'uppercase' }}>WARNING:</p>
                    <p style={{ margin: '0 0 0.5rem 0' }}>
                      This action permanently deletes this administrator account from the system.
                    </p>
                    <ul style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.25rem' }}>
                      <li>Administrator credentials and login access will be revoked immediately</li>
                      <li>Active sessions and OTP verifications will be invalidated</li>
                      <li>Any company announcements authored by this admin will be safely reassigned to your account</li>
                    </ul>
                    <p style={{ margin: 0, fontWeight: 700 }}>This action cannot be undone.</p>
                  </div>
                )}

                <div style={{ marginBottom: '1.25rem' }}>
                  <label htmlFor="deleteConfirmAdminEmailInput" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.375rem' }}>
                    To confirm, type the administrator email:
                  </label>
                  <input
                    type="text"
                    id="deleteConfirmAdminEmailInput"
                    className="admin-field-input"
                    placeholder="Enter administrator email"
                    value={deleteConfirmAdminEmail}
                    onChange={(e) => {
                      setDeleteConfirmAdminEmail(e.target.value);
                      setDeleteAdminError('');
                    }}
                    disabled={isDeletingAdmin || isTargetAdminSelf}
                    autoComplete="off"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      borderColor: deleteConfirmAdminEmail.trim()
                        ? isEmailMatched
                          ? '#16a34a'
                          : '#dc2626'
                        : '#cbd5e1',
                    }}
                  />
                  {!isTargetAdminSelf && deleteConfirmAdminEmail.trim() && (
                    <div style={{ marginTop: '0.375rem', fontSize: '0.75rem', fontWeight: 500, color: isEmailMatched ? '#16a34a' : '#dc2626' }}>
                      {isEmailMatched ? '✓ Email matches target administrator' : '✗ Email does not match target administrator'}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                  <input
                    type="checkbox"
                    id="deleteConfirmAdminCheck"
                    checked={deleteConfirmAdminChecked}
                    onChange={(e) => {
                      setDeleteConfirmAdminChecked(e.target.checked);
                      setDeleteAdminError('');
                    }}
                    disabled={isDeletingAdmin || isTargetAdminSelf}
                    style={{ marginTop: '0.2rem', width: '1rem', height: '1rem', cursor: isTargetAdminSelf ? 'not-allowed' : 'pointer' }}
                  />
                  <label htmlFor="deleteConfirmAdminCheck" style={{ fontSize: '0.8125rem', color: '#334155', fontWeight: 500, cursor: isTargetAdminSelf ? 'not-allowed' : 'pointer' }}>
                    I understand that this action permanently deletes the administrator account.
                  </label>
                </div>
              </div>

              <div className="admin-modal-footer" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => {
                    setDeleteTargetAdmin(null);
                    setDeleteConfirmAdminEmail('');
                    setDeleteConfirmAdminChecked(false);
                    setDeleteAdminError('');
                  }}
                  disabled={isDeletingAdmin}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={handleExecuteDeleteAdmin}
                  disabled={isDeleteAdminDisabled}
                  style={{
                    backgroundColor: '#dc2626',
                    borderColor: '#dc2626',
                    color: '#ffffff',
                    fontWeight: 600,
                    opacity: isDeleteAdminDisabled ? 0.5 : 1,
                    cursor: isDeleteAdminDisabled ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                  title={
                    isTargetAdminSelf
                      ? 'You cannot delete your own administrator account'
                      : isDeleteAdminDisabled
                      ? 'Type matching email and check confirmation box to enable'
                      : 'Permanently delete this administrator'
                  }
                >
                  {isDeletingAdmin && (
                    <span
                      style={{
                        width: '0.875rem',
                        height: '0.875rem',
                        border: '2px solid rgba(255,255,255,0.4)',
                        borderTopColor: '#ffffff',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        display: 'inline-block',
                      }}
                      aria-hidden="true"
                    />
                  )}
                  {isDeletingAdmin ? 'Deleting Permanently...' : 'Permanently Delete Admin'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Administrator Details Modal */}
      {viewTargetAdmin && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="view-admin-modal-title">
          <div className="admin-modal-container" style={{ maxWidth: '540px', maxHeight: '85vh' }}>
            <div className="admin-modal-header" style={{ flexShrink: 0 }}>
              <div className="wizard-title-block">
                <h2 id="view-admin-modal-title" className="admin-modal-title">
                  Administrator Profile Details
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                  Administrative user credentials &amp; permissions
                </p>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setViewTargetAdmin(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div className="admin-modal-body-scrollable">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid #e2e8f0' }}>
                <div
                  style={{
                    width: '3.5rem',
                    height: '3.5rem',
                    borderRadius: '9999px',
                    backgroundColor: '#e0e7ff',
                    color: '#3730a3',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                    fontWeight: 700,
                  }}
                  aria-hidden="true"
                >
                  {((viewTargetAdmin.firstName || viewTargetAdmin.name || 'A')[0]).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#0f172a' }}>
                    {viewTargetAdmin.name || 'Administrator'}
                  </h3>
                  <p style={{ margin: '0.125rem 0 0 0', fontSize: '0.875rem', color: '#64748b' }}>
                    {viewTargetAdmin.email}
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', backgroundColor: '#f8fafc', padding: '1.25rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Admin ID Number
                  </span>
                  <div style={{ marginTop: '0.25rem' }}>
                    {viewTargetAdmin.adminId ? (
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a', fontSize: '0.9375rem' }}>
                        {viewTargetAdmin.adminId}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#fef3c7', color: '#92400e' }}>
                        Unassigned
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Role
                  </span>
                  <div style={{ marginTop: '0.25rem' }}>
                    <span style={{ display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 700, backgroundColor: '#e0e7ff', color: '#3730a3' }}>
                      {viewTargetAdmin.role}
                    </span>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Account Status
                  </span>
                  <div style={{ marginTop: '0.25rem' }}>
                    <span className={`admin-status-badge admin-status-${(viewTargetAdmin.status || '').toLowerCase()}`}>
                      <span className="admin-status-dot" aria-hidden="true" />
                      {viewTargetAdmin.status}
                    </span>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Phone Number
                  </span>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: '#0f172a', fontWeight: 500 }}>
                    {viewTargetAdmin.phone || '—'}
                  </div>
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Created Date
                  </span>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: '#0f172a' }}>
                    {viewTargetAdmin.createdAt ? new Date(viewTargetAdmin.createdAt).toLocaleString() : '—'}
                  </div>
                </div>
              </div>

              {!viewTargetAdmin.adminId && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.375rem', fontSize: '0.8125rem', color: '#92400e' }}>
                  <strong>Notice:</strong> This administrator has not yet been assigned an Admin ID Number. Click <strong>Edit Administrator</strong> to assign a unique ID.
                </div>
              )}
            </div>

            <div className="admin-modal-footer" style={{ flexShrink: 0 }}>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setViewTargetAdmin(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => {
                  const target = viewTargetAdmin;
                  setViewTargetAdmin(null);
                  handleOpenEditAdmin(target);
                }}
              >
                Edit Administrator
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Administrator Modal */}
      {editTargetAdmin && (
        <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-admin-modal-title">
          <div className="admin-modal-container" style={{ maxWidth: '540px', maxHeight: '85vh' }}>
            <div className="admin-modal-header" style={{ flexShrink: 0 }}>
              <div className="wizard-title-block">
                <h2 id="edit-admin-modal-title" className="admin-modal-title">
                  Edit Administrator Details
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                  Update administrator ID, name, and contact details
                </p>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setEditTargetAdmin(null)}
                aria-label="Close modal"
                disabled={isUpdatingAdmin}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveEditAdmin} style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
              <div className="admin-modal-body-scrollable">
                {editAdminGeneralError && (
                  <div
                    role="alert"
                    style={{
                      padding: '0.75rem 1rem',
                      marginBottom: '1.25rem',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '0.375rem',
                      color: '#991b1b',
                      fontSize: '0.875rem',
                    }}
                  >
                    {editAdminGeneralError}
                  </div>
                )}

                {!editTargetAdmin.adminId && (
                  <div
                    style={{
                      padding: '0.75rem 1rem',
                      marginBottom: '1.25rem',
                      backgroundColor: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '0.375rem',
                      color: '#1e40af',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <strong>Assign Admin ID:</strong> This existing administrator currently has no ID number. Please enter a unique Admin ID Number below to complete their profile.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label htmlFor="editAdminIdInput" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.375rem' }}>
                      Admin ID Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      id="editAdminIdInput"
                      className="admin-field-input"
                      placeholder="e.g. ADM0001"
                      value={editAdminForm.adminId}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setEditAdminForm((prev) => ({ ...prev, adminId: val }));
                        setEditAdminErrors((prev) => ({ ...prev, adminId: '' }));
                        setEditAdminGeneralError('');
                      }}
                      maxLength={30}
                      disabled={isUpdatingAdmin}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        borderColor: editAdminErrors.adminId ? '#ef4444' : undefined,
                      }}
                    />
                    {editAdminErrors.adminId && (
                      <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                        {editAdminErrors.adminId}
                      </span>
                    )}
                    <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      Must be unique across all administrators. Alphanumeric, hyphens, slashes, underscores.
                    </small>
                  </div>

                  <div>
                    <label htmlFor="editAdminEmailInput" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.375rem' }}>
                      Email Address
                    </label>
                    <input
                      type="email"
                      id="editAdminEmailInput"
                      className="admin-field-input"
                      value={editTargetAdmin.email}
                      disabled
                      readOnly
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        backgroundColor: '#f1f5f9',
                        cursor: 'not-allowed',
                        color: '#64748b',
                      }}
                    />
                    <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      Email address is linked to login credentials and cannot be edited directly.
                    </small>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                    <div>
                      <label htmlFor="editAdminFirstNameInput" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.375rem' }}>
                        First Name <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        type="text"
                        id="editAdminFirstNameInput"
                        className="admin-field-input"
                        placeholder="Enter first name"
                        value={editAdminForm.firstName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditAdminForm((prev) => ({ ...prev, firstName: val }));
                          setEditAdminErrors((prev) => ({ ...prev, firstName: '' }));
                          setEditAdminGeneralError('');
                        }}
                        maxLength={50}
                        disabled={isUpdatingAdmin}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          borderColor: editAdminErrors.firstName ? '#ef4444' : undefined,
                        }}
                      />
                      {editAdminErrors.firstName && (
                        <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                          {editAdminErrors.firstName}
                        </span>
                      )}
                    </div>

                    <div>
                      <label htmlFor="editAdminLastNameInput" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.375rem' }}>
                        Last Name <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        type="text"
                        id="editAdminLastNameInput"
                        className="admin-field-input"
                        placeholder="Enter last name"
                        value={editAdminForm.lastName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditAdminForm((prev) => ({ ...prev, lastName: val }));
                          setEditAdminErrors((prev) => ({ ...prev, lastName: '' }));
                          setEditAdminGeneralError('');
                        }}
                        maxLength={50}
                        disabled={isUpdatingAdmin}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          borderColor: editAdminErrors.lastName ? '#ef4444' : undefined,
                        }}
                      />
                      {editAdminErrors.lastName && (
                        <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                          {editAdminErrors.lastName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="editAdminPhoneInput" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.375rem' }}>
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      id="editAdminPhoneInput"
                      className="admin-field-input"
                      placeholder="Enter phone number"
                      value={editAdminForm.phone}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditAdminForm((prev) => ({ ...prev, phone: val }));
                        setEditAdminErrors((prev) => ({ ...prev, phone: '' }));
                        setEditAdminGeneralError('');
                      }}
                      disabled={isUpdatingAdmin}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        borderColor: editAdminErrors.phone ? '#ef4444' : undefined,
                      }}
                    />
                    {editAdminErrors.phone && (
                      <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                        {editAdminErrors.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="admin-modal-footer" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setEditTargetAdmin(null)}
                  disabled={isUpdatingAdmin}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={isUpdatingAdmin}
                >
                  {isUpdatingAdmin ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Employees;
