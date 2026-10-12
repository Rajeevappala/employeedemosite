import { useAuth } from '../../context/AuthContext';
import gaintproLogo from '../../assets/gaintpro-logo.png';
import './Navbar.css';

function Navbar({ onToggleSidebar, isSidebarOpen }) {
  const { user } = useAuth();

  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Employee'
    : 'Employee';

  const displayRole = user?.role === 'ADMIN' ? 'Administrator' : 'Employee';

  return (
    <header className="portal-navbar">
      <div className="navbar-left">
        <button
          type="button"
          className="navbar-hamburger-btn"
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
          aria-expanded={Boolean(isSidebarOpen)}
        >
          <svg
            className="hamburger-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {isSidebarOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>

        <div className="navbar-brand">
          <img
            src={gaintproLogo}
            alt="GaintPro Software Technologies logo"
            className="navbar-brand-logo"
          />
          <span className="navbar-brand-text">GaintPro HRM Portal</span>
        </div>
      </div>

      <div className="navbar-right">
        {/* User Profile Section */}
        <div className="navbar-user-profile">
          <div className="navbar-avatar" aria-hidden="true">
            <svg
              className="avatar-user-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="navbar-user-details">
            <span className="navbar-employee-name">{displayName}</span>
            <span className="navbar-employee-role">{displayRole}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
