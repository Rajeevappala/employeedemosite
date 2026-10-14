import { useEffect } from 'react';
import './LogoutConfirmModal.css';

/**
 * Logout Confirmation Modal
 * Displays a confirmation popup before logging out the user.
 *
 * Requirements:
 * - Title: "Confirm Logout"
 * - Message: "Are you sure you want to log out?"
 * - Buttons: "Cancel" and "Yes, Logout"
 * - Pressing Escape or clicking outside closes the modal without logging out.
 * - Prevents duplicate logout submissions via disabled state.
 */
function LogoutConfirmModal({ isOpen, onCancel, onConfirm, isLoggingOut = false }) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isLoggingOut) {
        onCancel?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel, isLoggingOut]);

  if (!isOpen) return null;

  return (
    <div
      className="logout-modal-backdrop"
      onClick={!isLoggingOut ? onCancel : undefined}
      aria-hidden="true"
    >
      <div
        className="logout-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        aria-describedby="logout-modal-message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="logout-modal-header">
          <div className="logout-modal-icon-badge" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="logout-modal-icon"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </div>
          <h3 id="logout-modal-title" className="logout-modal-title">
            Confirm Logout
          </h3>
          <button
            type="button"
            className="logout-modal-close-btn"
            onClick={onCancel}
            disabled={isLoggingOut}
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        <div className="logout-modal-body">
          <p id="logout-modal-message" className="logout-modal-message">
            Are you sure you want to log out?
          </p>
        </div>

        <div className="logout-modal-footer">
          <button
            type="button"
            className="logout-modal-btn logout-modal-btn-cancel"
            onClick={onCancel}
            disabled={isLoggingOut}
          >
            Cancel
          </button>
          <button
            type="button"
            className="logout-modal-btn logout-modal-btn-confirm"
            onClick={onConfirm}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? 'Logging out...' : 'Yes, Logout'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LogoutConfirmModal;
