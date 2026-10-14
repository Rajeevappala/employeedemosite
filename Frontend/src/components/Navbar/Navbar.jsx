import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LogoutConfirmModal from '../LogoutConfirmModal/LogoutConfirmModal';
import gaintproLogo from '../../assets/gaintpro-logo.png';
import './Navbar.css';

function Navbar({ onToggleSidebar, isSidebarOpen }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Employee'
    : 'Employee';

  const displayRole = user?.role === 'ADMIN' ? 'Administrator' : 'Employee';

  const handleOpenLogout = () => {
    setShowLogoutModal(true);
  };

  const handleCancelLogout = () => {
    setShowLogoutModal(false);
  };

  const handleConfirmLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
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

          {/* Header Logout Button */}
          <button
            type="button"
            className="navbar-logout-btn"
            onClick={handleOpenLogout}
            aria-label="Logout"
            title="Logout"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="navbar-logout-icon"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="navbar-logout-label">Logout</span>
          </button>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onCancel={handleCancelLogout}
        onConfirm={handleConfirmLogout}
        isLoggingOut={isLoggingOut}
      />
    </>
  );
}

export default Navbar;
