// Base URL for the Employee Portal Backend API
const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:5000/api';

/**
 * Retrieves the JWT session token from localStorage.
 */
const getAuthToken = () => {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
};

/**
 * Generic request helper for standard JSON endpoints.
 * Automatically attaches Authorization header if a token exists.
 */
const request = async (endpoint, options = {}) => {
  const url = `${BASE_URL}${endpoint}`;
  const token = getAuthToken();

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  if (!headers['Authorization'] && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage = data?.message || `Request failed with status ${response.status}`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

/**
 * Dedicated helper to download binary files as a Blob.
 * Note: Content-Type is not manually set on GET download requests.
 */
const downloadFile = async (endpoint) => {
  const url = `${BASE_URL}${endpoint}`;
  const token = getAuthToken();

  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    let errorMessage = `Download failed with status ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson && errorJson.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // Response was not JSON
    }
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  return blob;
};

const api = {
  auth: {
    requestOtp: (email) =>
      request('/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: String(email).trim() }),
      }),

    verifyOtp: (email, otp) =>
      request('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          email: String(email).trim(),
          otp: String(otp).trim(),
        }),
      }),

    getMe: (token) =>
      request('/auth/me', {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
  },
  employee: {
    // GET /api/employee/dashboard
    getDashboard: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.month) searchParams.append('month', params.month);
      if (params.year) searchParams.append('year', params.year);
      if (params.date) searchParams.append('date', params.date);
      const qs = searchParams.toString();
      return request(`/employee/dashboard${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/employee/profile
    getProfile: () => request('/employee/profile', { method: 'GET' }),

    // PUT /api/employee/profile
    updateProfile: (data) =>
      request('/employee/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // POST /api/employee/profile/photo
    uploadProfilePhoto: (formData) =>
      request('/employee/profile/photo', {
        method: 'POST',
        body: formData,
      }),

    // GET /api/employee/profile/photo
    getProfilePhotoBlob: () => downloadFile('/employee/profile/photo'),

    // DELETE /api/employee/profile/photo
    deleteProfilePhoto: () =>
      request('/employee/profile/photo', {
        method: 'DELETE',
      }),

    // GET /api/employee/pf
    getPF: () => request('/employee/pf', { method: 'GET' }),

    // GET /api/employee/documents
    getDocuments: () => request('/employee/documents', { method: 'GET' }),

    // GET /api/employee/documents/:documentId/download
    downloadDocument: (documentId) => downloadFile(`/employee/documents/${documentId}/download`),

    // GET /api/employee/documents/:documentId/download (for secure preview)
    viewDocument: (documentId) => downloadFile(`/employee/documents/${documentId}/download`),

    // GET /api/employee/payslips
    getPayslips: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.year && params.year !== 'all') {
        searchParams.append('year', params.year);
      }
      if (params.month && params.month !== 'all') {
        searchParams.append('month', params.month);
      }
      if (params.page) {
        searchParams.append('page', params.page);
      }
      if (params.limit) {
        searchParams.append('limit', params.limit);
      }
      const qs = searchParams.toString();
      return request(`/employee/payslips${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/employee/payslips/:documentId/view
    viewPayslip: (documentId) => downloadFile(`/employee/payslips/${documentId}/view`),

    // GET /api/employee/payslips/:documentId/download
    downloadPayslip: (documentId) => downloadFile(`/employee/payslips/${documentId}/download`),

    // GET /api/employee/leaves
    getLeaves: () => request('/employee/leaves', { method: 'GET' }),

    // POST /api/employee/leaves
    createLeave: (data) =>
      request('/employee/leaves', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // PATCH /api/employee/leaves/:leaveId/cancel
    cancelLeave: (leaveId) =>
      request(`/employee/leaves/${leaveId}/cancel`, {
        method: 'PATCH',
      }),

    // GET /api/employee/attendance(?month=YYYY-MM)
    getAttendance: (month) => {
      const query = month ? `?month=${encodeURIComponent(month)}` : '';
      return request(`/employee/attendance${query}`, { method: 'GET' });
    },

    // GET /api/employee/announcements
    getAnnouncements: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.page) searchParams.append('page', params.page);
      if (params.limit) searchParams.append('limit', params.limit);
      if (params.unread_only) searchParams.append('unread_only', 'true');
      const qs = searchParams.toString();
      return request(`/employee/announcements${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/employee/announcements/unread-count
    getUnreadAnnouncementsCount: () =>
      request('/employee/announcements/unread-count', { method: 'GET' }),

    // GET /api/employee/announcements/:announcementId
    getAnnouncement: (announcementId) =>
      request(`/employee/announcements/${announcementId}`, { method: 'GET' }),

    // PATCH /api/employee/announcements/:announcementId/read
    markAnnouncementAsRead: (announcementId) =>
      request(`/employee/announcements/${announcementId}/read`, { method: 'PATCH' }),

    // Exit & Offboarding
    exit: {
      apply: (data) =>
        request('/employee/exit/apply', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      getStatus: () => request('/employee/exit/status', { method: 'GET' }),
      withdraw: () => request('/employee/exit/withdraw', { method: 'PATCH' }),
      downloadRelievingLetter: () => downloadFile('/employee/exit/relieving-letter'),
      downloadExperienceCertificate: () => downloadFile('/employee/exit/experience-certificate'),
      downloadFnfStatement: () => downloadFile('/employee/exit/fnf-statement'),
    },
  },
  admin: {
    // GET /api/admin/dashboard
    getDashboard: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.month) searchParams.append('month', params.month);
      if (params.year) searchParams.append('year', params.year);
      if (params.date) searchParams.append('date', params.date);
      const qs = searchParams.toString();
      return request(`/admin/dashboard${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/employees
    getEmployees: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.search && params.search.trim()) {
        searchParams.append('search', params.search.trim());
      }
      if (params.status && params.status !== 'All') {
        searchParams.append('status', params.status);
      }
      if (params.page) {
        searchParams.append('page', params.page);
      }
      if (params.limit) {
        searchParams.append('limit', params.limit);
      }
      const qs = searchParams.toString();
      return request(`/admin/employees${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/employees/:employeeId
    getEmployee: (employeeId) =>
      request(`/admin/employees/${encodeURIComponent(employeeId)}`, { method: 'GET' }),

    // GET /api/admin/employees/:employeeId/photo
    getEmployeePhotoBlob: (employeeId) =>
      downloadFile(`/admin/employees/${encodeURIComponent(employeeId)}/photo`),

    // POST /api/admin/employees (Phase 21 Onboarding)
    onboardEmployee: (data) =>
      request('/admin/employees', {
        method: 'POST',
        body: (typeof FormData !== 'undefined' && data instanceof FormData) ? data : JSON.stringify(data),
      }),

    // PUT /api/admin/employees/:employeeId (Phase 21 Profile Edit)
    updateEmployee: (employeeId, data) =>
      request(`/admin/employees/${encodeURIComponent(employeeId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // PATCH /api/admin/employees/:employeeId/status (Phase 21 Status Toggle)
    updateEmployeeStatus: (employeeId, status, remarks = '') =>
      request(`/admin/employees/${encodeURIComponent(employeeId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, remarks }),
      }),

    // DELETE /api/admin/employees/:employeeId (Phase 21+ Permanent Deletion)
    deleteEmployeePermanently: (employeeId, confirmation) =>
      request(`/admin/employees/${encodeURIComponent(employeeId)}`, {
        method: 'DELETE',
        body: JSON.stringify(confirmation),
      }),

    // GET /api/admin/users (Phase 21+ User/Admin Management)
    getUsers: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.role) searchParams.append('role', params.role);
      if (params.search) searchParams.append('search', params.search);
      const qs = searchParams.toString();
      return request(`/admin/users${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // POST /api/admin/users (Phase 21+ Admin Creation)
    createUser: (data) =>
      request('/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // PATCH /api/admin/users/:userId/status (Phase 21+ Admin Status Management)
    updateUserStatus: (userId, status) =>
      request(`/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),

    // GET /api/admin/documents
    getDocuments: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.search && params.search.trim()) {
        searchParams.append('search', params.search.trim());
      }
      if (params.employee_id && params.employee_id.trim() && params.employee_id !== 'All') {
        searchParams.append('employee_id', params.employee_id.trim());
      }
      if (params.document_type && params.document_type !== 'All') {
        searchParams.append('document_type', params.document_type);
      }
      if (params.month) {
        searchParams.append('month', params.month);
      }
      if (params.year) {
        searchParams.append('year', params.year);
      }
      if (params.page) {
        searchParams.append('page', params.page);
      }
      if (params.limit) {
        searchParams.append('limit', params.limit);
      }
      const qs = searchParams.toString();
      return request(`/admin/documents${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // POST /api/admin/documents
    uploadDocument: (formData) =>
      request('/admin/documents', {
        method: 'POST',
        body: formData,
      }),

    // GET /api/admin/documents/:documentId/download
    downloadDocument: (documentId) =>
      downloadFile(`/admin/documents/${encodeURIComponent(documentId)}/download`),

    // GET /api/admin/documents/:documentId/download
    viewDocument: (documentId) =>
      downloadFile(`/admin/documents/${encodeURIComponent(documentId)}/download`),

    // DELETE /api/admin/documents/:documentId
    deleteDocument: (documentId) =>
      request(`/admin/documents/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
      }),

    // GET /api/admin/attendance
    getAttendance: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.date) {
        searchParams.append('date', params.date);
      }
      if (params.month) {
        searchParams.append('month', params.month);
      }
      if (params.employee_id && params.employee_id !== 'All') {
        searchParams.append('employee_id', params.employee_id);
      }
      if (params.search && params.search.trim()) {
        searchParams.append('search', params.search.trim());
      }
      if (params.status && params.status !== 'All') {
        searchParams.append('status', params.status);
      }
      if (params.page) {
        searchParams.append('page', params.page);
      }
      if (params.limit) {
        searchParams.append('limit', params.limit);
      }
      const qs = searchParams.toString();
      return request(`/admin/attendance${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/attendance/monthly
    getMonthlyAttendance: (month) =>
      request(`/admin/attendance/monthly?month=${encodeURIComponent(month)}`, { method: 'GET' }),

    // POST /api/admin/attendance
    markAttendance: (data) =>
      request('/admin/attendance', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // POST /api/admin/attendance/mark-all-present
    markAllPresent: (data) =>
      request('/admin/attendance/mark-all-present', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // PUT /api/admin/attendance/:attendanceId
    updateAttendance: (attendanceId, data) =>
      request(`/admin/attendance/${encodeURIComponent(attendanceId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // GET /api/admin/leaves
    getLeaves: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.search && params.search.trim()) {
        searchParams.append('search', params.search.trim());
      }
      if (params.status && params.status !== 'All') {
        searchParams.append('status', params.status);
      }
      if (params.leave_type && params.leave_type !== 'All') {
        searchParams.append('leave_type', params.leave_type);
      }
      if (params.department && params.department !== 'All') {
        searchParams.append('department', params.department);
      }
      if (params.employee_id && params.employee_id !== 'All') {
        searchParams.append('employee_id', params.employee_id);
      }
      if (params.month && params.month !== 'All') {
        searchParams.append('month', params.month);
      }
      if (params.page) {
        searchParams.append('page', params.page);
      }
      if (params.limit) {
        searchParams.append('limit', params.limit);
      }
      const qs = searchParams.toString();
      return request(`/admin/leaves${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/leaves/balances
    getLeaveBalances: () =>
      request('/admin/leaves/balances', { method: 'GET' }),

    // GET /api/admin/leaves/:leaveId
    getLeave: (leaveId) =>
      request(`/admin/leaves/${encodeURIComponent(leaveId)}`, { method: 'GET' }),

    // PATCH /api/admin/leaves/:leaveId/status
    updateLeaveStatus: (leaveId, status, admin_remarks) =>
      request(`/admin/leaves/${encodeURIComponent(leaveId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, admin_remarks }),
      }),

    // Helper shortcuts
    approveLeave: (leaveId, admin_remarks) =>
      api.admin.updateLeaveStatus(leaveId, 'Approved', admin_remarks),

    rejectLeave: (leaveId, admin_remarks) =>
      api.admin.updateLeaveStatus(leaveId, 'Rejected', admin_remarks),

    // GET /api/admin/pf
    getPF: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.search && params.search.trim()) {
        searchParams.append('search', params.search.trim());
      }
      if (params.status && params.status !== 'All') {
        searchParams.append('status', params.status);
      }
      if (params.department && params.department !== 'All' && params.department !== 'All Departments') {
        searchParams.append('department', params.department);
      }
      if (params.page) {
        searchParams.append('page', params.page);
      }
      if (params.limit) {
        searchParams.append('limit', params.limit);
      }
      const qs = searchParams.toString();
      return request(`/admin/pf${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/pf/:employeeId
    getPFByEmployee: (employeeId) =>
      request(`/admin/pf/${encodeURIComponent(employeeId)}`, { method: 'GET' }),

    // PUT /api/admin/pf/:employeeId
    updatePF: (employeeId, data) =>
      request(`/admin/pf/${encodeURIComponent(employeeId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // DELETE /api/admin/pf/:employeeId
    deletePF: (employeeId) =>
      request(`/admin/pf/${encodeURIComponent(employeeId)}`, {
        method: 'DELETE',
      }),

    // GET /api/admin/payroll
    getPayroll: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.month && params.month !== 'All') {
        searchParams.append('month', params.month);
      }
      if (params.year && params.year !== 'All') {
        searchParams.append('year', params.year);
      }
      if (params.search && params.search.trim()) {
        searchParams.append('search', params.search.trim());
      }
      if (params.department && params.department !== 'All' && params.department !== 'All Departments') {
        searchParams.append('department', params.department);
      }
      if (params.status && params.status !== 'All') {
        searchParams.append('status', params.status);
      }
      if (params.page) {
        searchParams.append('page', params.page);
      }
      if (params.limit) {
        searchParams.append('limit', params.limit);
      }
      const qs = searchParams.toString();
      return request(`/admin/payroll${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/payroll/history
    getPayrollHistory: () =>
      request('/admin/payroll/history', { method: 'GET' }),

    // GET /api/admin/payroll/attendance-summary
    getPayrollAttendanceSummary: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.month) {
        searchParams.append('month', params.month);
      }
      if (params.year) {
        searchParams.append('year', params.year);
      }
      const qs = searchParams.toString();
      return request(`/admin/payroll/attendance-summary${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/payroll/:employeeId
    getPayrollByEmployee: (employeeId, params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.month) {
        searchParams.append('month', params.month);
      }
      if (params.year) {
        searchParams.append('year', params.year);
      }
      const qs = searchParams.toString();
      return request(`/admin/payroll/${encodeURIComponent(employeeId)}${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/payroll/:employeeId/profile
    getPayrollProfile: (employeeId) =>
      request(`/admin/payroll/${encodeURIComponent(employeeId)}/profile`, { method: 'GET' }),

    // PUT /api/admin/payroll/:employeeId/profile
    updatePayrollProfile: (employeeId, data) =>
      request(`/admin/payroll/${encodeURIComponent(employeeId)}/profile`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // POST /api/admin/payroll/process
    processPayroll: (data) =>
      request('/admin/payroll/process', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // POST /api/admin/payroll/:employeeId/:year/:month/generate-payslip
    generatePayslip: (employeeId, year, month) =>
      request(
        `/admin/payroll/${encodeURIComponent(employeeId)}/${encodeURIComponent(year)}/${encodeURIComponent(month)}/generate-payslip`,
        { method: 'POST' }
      ),

    // POST /api/admin/payroll/generate-payslips
    generateAllPayslips: (data) =>
      request('/admin/payroll/generate-payslips', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // GET /api/admin/payroll/template (Binary Excel download)
    downloadPayrollTemplate: () => downloadFile('/admin/payroll/template'),

    // POST /api/admin/payroll/import/preview (multipart/form-data)
    previewPayrollImport: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return request('/admin/payroll/import/preview', {
        method: 'POST',
        body: formData,
      });
    },

    // POST /api/admin/payroll/import/confirm
    confirmPayrollImport: ({ importId, importMode = 'CREATE_ONLY' }) =>
      request('/admin/payroll/import/confirm', {
        method: 'POST',
        body: JSON.stringify({ importId, importMode }),
      }),

    // GET /api/admin/payroll/monthly-payslips
    getMonthlyPayslips: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.month) searchParams.append('month', params.month);
      if (params.year) searchParams.append('year', params.year);
      const qs = searchParams.toString();
      return request(`/admin/payroll/monthly-payslips${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // POST /api/admin/payroll/monthly-payslips/upload
    uploadMonthlyPayslip: (formData) =>
      request('/admin/payroll/monthly-payslips/upload', {
        method: 'POST',
        body: formData,
      }),

    // POST /api/admin/payroll/monthly-payslips/replace
    replaceMonthlyPayslip: (formData) =>
      request('/admin/payroll/monthly-payslips/replace', {
        method: 'POST',
        body: formData,
      }),

    // GET /api/admin/announcements
    getAnnouncements: (params = {}) => {
      const searchParams = new URLSearchParams();
      if (params.page) searchParams.append('page', params.page);
      if (params.limit) searchParams.append('limit', params.limit);
      if (params.search && params.search.trim()) searchParams.append('search', params.search.trim());
      if (params.status && params.status !== 'All') searchParams.append('status', params.status);
      if (params.priority && params.priority !== 'All') searchParams.append('priority', params.priority);
      if (params.target_type && params.target_type !== 'All') searchParams.append('target_type', params.target_type);
      const qs = searchParams.toString();
      return request(`/admin/announcements${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },

    // GET /api/admin/announcements/:announcementId
    getAnnouncement: (announcementId) =>
      request(`/admin/announcements/${announcementId}`, { method: 'GET' }),

    // POST /api/admin/announcements
    createAnnouncement: (data) =>
      request('/admin/announcements', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // PUT /api/admin/announcements/:announcementId
    updateAnnouncement: (announcementId, data) =>
      request(`/admin/announcements/${announcementId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // PATCH /api/admin/announcements/:announcementId/publish
    publishAnnouncement: (announcementId) =>
      request(`/admin/announcements/${announcementId}/publish`, {
        method: 'PATCH',
      }),

    // PATCH /api/admin/announcements/:announcementId/archive
    archiveAnnouncement: (announcementId) =>
      request(`/admin/announcements/${announcementId}/archive`, {
        method: 'PATCH',
      }),

    // DELETE /api/admin/announcements/:announcementId
    deleteAnnouncement: (announcementId) =>
      request(`/admin/announcements/${announcementId}`, {
        method: 'DELETE',
      }),

    // Exit & Offboarding
    exit: {
      getRequests: (params = {}) => {
        const searchParams = new URLSearchParams();
        if (params.status && params.status !== 'All') searchParams.append('status', params.status);
        if (params.department && params.department !== 'All') searchParams.append('department', params.department);
        if (params.search && params.search.trim()) searchParams.append('search', params.search.trim());
        if (params.page) searchParams.append('page', params.page);
        if (params.limit) searchParams.append('limit', params.limit);
        const qs = searchParams.toString();
        return request(`/admin/exit/requests${qs ? `?${qs}` : ''}`, { method: 'GET' });
      },
      reviewRequest: (id, data) =>
        request(`/admin/exit/requests/${encodeURIComponent(id)}/review`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      updateClearance: (id, data) =>
        request(`/admin/exit/clearance/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      calculateFnf: (data) =>
        request('/admin/exit/fnf/calculate', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      finalizeFnf: (data) =>
        request('/admin/exit/fnf/finalize', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      downloadRelievingLetter: (id) =>
        downloadFile(`/admin/exit/${encodeURIComponent(id)}/relieving-letter`),
      downloadExperienceCertificate: (id) =>
        downloadFile(`/admin/exit/${encodeURIComponent(id)}/experience-certificate`),
      downloadFnfStatement: (id) =>
        downloadFile(`/admin/exit/${encodeURIComponent(id)}/fnf-statement`),
    },
  },
};

export default api;

