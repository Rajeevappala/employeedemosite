import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Pages
import Login from '../pages/Login/Login';

// Employee Layout & Pages
import EmployeeLayout from '../pages/Employee/EmployeeLayout/EmployeeLayout';
import EmployeeDashboard from '../pages/Employee/Dashboard/Dashboard';
import EmployeeProfile from '../pages/Employee/Profile/Profile';
import EmployeeDocuments from '../pages/Employee/Documents/Documents';
import EmployeePFDetails from '../pages/Employee/PFDetails/PFDetails';
import EmployeeLeaves from '../pages/Employee/Leaves/Leaves';
import EmployeeAttendance from '../pages/Employee/Attendance/Attendance';
import EmployeePayslips from '../pages/Employee/Payslips/Payslips';
import EmployeeAnnouncements from '../pages/Employee/Announcements/Announcements';
import EmployeeExit from '../pages/Employee/Exit/Exit';

// Admin Layout & Pages
import AdminLayout from '../components/AdminLayout/AdminLayout';
import AdminDashboard from '../pages/Admin/Dashboard/Dashboard';
import AdminEmployees from '../pages/Admin/Employees/Employees';
import AdminEmployeeDetails from '../pages/Admin/EmployeeDetails/EmployeeDetails';
import AdminDocuments from '../pages/Admin/Documents/Documents';
import AdminPFDetails from '../pages/Admin/PFDetails/PFDetails';
import AdminLeaves from '../pages/Admin/Leaves/Leaves';
import AdminAttendance from '../pages/Admin/Attendance/Attendance';
import AdminPayroll from '../pages/Admin/Payroll/Payroll';
import AdminAnnouncements from '../pages/Admin/Announcements/Announcements';
import AdminExit from '../pages/Admin/Exit/Exit';

function ProtectedRoute({ allowedRoles, children }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          backgroundColor: '#f5f7fa',
          color: '#6b7280',
          fontFamily: 'inherit',
          fontSize: '0.9375rem',
        }}
      >
        Loading...
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === 'EMPLOYEE') {
      return <Navigate to="/employee/dashboard" replace />;
    }
    return <Navigate to="/admin/dashboard" replace />;
  }

  return children;
}

function PublicRoute({ children }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          backgroundColor: '#f5f7fa',
          color: '#6b7280',
          fontFamily: 'inherit',
          fontSize: '0.9375rem',
        }}
      >
        Loading...
      </div>
    );
  }

  if (isAuthenticated && user) {
    if (user.role === 'EMPLOYEE') {
      return <Navigate to="/employee/dashboard" replace />;
    }
    return <Navigate to="/admin/dashboard" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Default route */}
        <Route
          path="/"
          element={
            <PublicRoute>
              <Navigate to="/login" replace />
            </PublicRoute>
          }
        />

        {/* Authentication */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />

        {/* Employee Portal Routes with Reusable Layout */}
        <Route
          path="/employee"
          element={
            <ProtectedRoute allowedRoles={['EMPLOYEE']}>
              <EmployeeLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<EmployeeDashboard />} />
          <Route path="profile" element={<EmployeeProfile />} />
          <Route path="documents" element={<EmployeeDocuments />} />
          <Route path="pf" element={<EmployeePFDetails />} />
          <Route path="attendance" element={<EmployeeAttendance />} />
          <Route path="leaves" element={<EmployeeLeaves />} />
          <Route path="payslips" element={<EmployeePayslips />} />
          <Route path="announcements" element={<EmployeeAnnouncements />} />
          <Route path="exit" element={<EmployeeExit />} />
        </Route>

        {/* Admin Portal Routes with Nested Layout */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="employees" element={<AdminEmployees />} />
          <Route path="employees/:employeeId" element={<AdminEmployeeDetails />} />
          <Route path="attendance" element={<AdminAttendance />} />
          <Route path="documents" element={<AdminDocuments />} />
          <Route path="pf" element={<AdminPFDetails />} />
          <Route path="leaves" element={<AdminLeaves />} />
          <Route path="payroll" element={<AdminPayroll />} />
          <Route path="payroll/monthly-payslips" element={<AdminPayroll defaultTab="monthly_payslips" />} />
          <Route path="announcements" element={<AdminAnnouncements />} />
          <Route path="exit" element={<AdminExit />} />
        </Route>

        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;
