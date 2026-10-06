import { AuthProvider } from './context/AuthContext';
import { LeaveProvider } from './context/LeaveContext';
import { AttendanceProvider } from './context/AttendanceContext';
import AppRoutes from './routes/AppRoutes';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <LeaveProvider>
        <AttendanceProvider>
          <AppRoutes />
        </AttendanceProvider>
      </LeaveProvider>
    </AuthProvider>
  );
}

export default App;
