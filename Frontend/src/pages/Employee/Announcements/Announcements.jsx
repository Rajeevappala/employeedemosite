import { useState, useEffect, useCallback } from 'react';
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

function getPriorityBadgeClass(priority) {
  const p = (priority || '').toLowerCase();
  if (p === 'urgent') return 'priority-badge-urgent';
  if (p === 'high') return 'priority-badge-high';
  return 'priority-badge-normal';
}

function EmployeeAnnouncements() {
  const [announcements, setAnnouncements] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tab: 'all' or 'unread'
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Detail Modal state
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);

  // Fetch announcements list
  const fetchAnnouncements = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.employee.getAnnouncements({
        page,
        limit,
        unread_only: activeTab === 'unread',
      });

      if (res && res.success && res.data) {
        setAnnouncements(res.data.announcements || []);
        setUnreadCount(res.data.unread_count || 0);
        setTotalCount(res.data.pagination?.total || 0);
        setTotalPages(res.data.pagination?.total_pages || 1);
      } else {
        setError(res?.message || 'Unable to retrieve announcements.');
      }
    } catch (err) {
      setError(err?.message || 'Failed to load announcements. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, limit, activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAnnouncements();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAnnouncements]);

  // Open Announcement Detail & Mark as Read in DB
  const handleOpenDetail = async (item) => {
    setActiveAnnouncement(item);

    // If unread, mark as read in PostgreSQL immediately
    if (!item.is_read) {
      try {
        await api.employee.markAnnouncementAsRead(item.id);

        // Optimistically update read status locally
        setAnnouncements((prev) =>
          prev.map((a) => (a.id === item.id ? { ...a, is_read: true, read_at: new Date().toISOString() } : a))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch (err) {
        console.error('Failed to mark announcement as read:', err);
      }
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setPage(1);
  };

  return (
    <div className="employee-announcements-page">
      {/* Header */}
      <header className="employee-announcements-header">
        <div className="header-titles">
          <h1 className="header-title">Announcements & Notices</h1>
          <p className="header-subtitle">
            Stay updated with organization announcements, technical updates, and important notices.
          </p>
        </div>

        {/* Tab Filters */}
        <div className="announcements-tab-group" role="tablist">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
            role="tab"
            aria-selected={activeTab === 'all'}
          >
            All Announcements
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'unread' ? 'active' : ''}`}
            onClick={() => handleTabChange('unread')}
            role="tab"
            aria-selected={activeTab === 'unread'}
          >
            Unread Only
            {unreadCount > 0 && (
              <span className="unread-counter-pill" aria-label={`${unreadCount} unread notices`}>
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="announcements-content-container">
        {loading ? (
          <div className="announcements-skeleton-grid" aria-busy="true" aria-label="Loading announcements">
            {[1, 2, 3].map((i) => (
              <div key={i} className="announcement-skeleton-card">
                <div className="skeleton skeleton-header" />
                <div className="skeleton skeleton-title" />
                <div className="skeleton skeleton-body" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="announcements-state-card error-card" role="alert">
            <svg className="state-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="state-card-title">Unable to Load Announcements</h3>
            <p className="state-card-desc">{error}</p>
            <button type="button" className="btn-retry" onClick={fetchAnnouncements}>
              Try Again
            </button>
          </div>
        ) : announcements.length === 0 ? (
          <div className="announcements-state-card empty-card">
            <div className="empty-icon-wrap" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h3 className="state-card-title">
              {activeTab === 'unread' ? "You're all caught up!" : 'No announcements available'}
            </h3>
            <p className="state-card-desc">
              {activeTab === 'unread'
                ? 'There are no unread announcements at this time.'
                : 'No announcements have been published for your profile yet.'}
            </p>
            {activeTab === 'unread' && (
              <button
                type="button"
                className="btn-switch-tab"
                onClick={() => handleTabChange('all')}
              >
                View All Announcements
              </button>
            )}
          </div>
        ) : (
          <div className="announcements-cards-list">
            {announcements.map((item) => (
              <article
                key={item.id}
                className={`announcement-card ${!item.is_read ? 'card-unread' : ''}`}
                onClick={() => handleOpenDetail(item)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleOpenDetail(item); }}
                aria-label={`Announcement: ${item.title}`}
              >
                <div className="card-top-row">
                  <div className="card-badges-left">
                    <span className={`priority-badge ${getPriorityBadgeClass(item.priority)}`}>
                      {item.priority}
                    </span>

                    {item.target_type === 'ALL' && (
                      <span className="audience-tag tag-all">All Employees</span>
                    )}
                    {item.target_type === 'DEPARTMENT' && (
                      <span className="audience-tag tag-dept">Department Notice</span>
                    )}
                    {item.target_type === 'EMPLOYEE' && (
                      <span className="audience-tag tag-emp">Direct Notice</span>
                    )}
                  </div>

                  <div className="card-badges-right">
                    {!item.is_read ? (
                      <span className="status-read-pill pill-unread">
                        <span className="pulse-dot" aria-hidden="true"></span>
                        Unread
                      </span>
                    ) : (
                      <span className="status-read-pill pill-read">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Read
                      </span>
                    )}
                    <span className="card-pub-date">
                      {formatDateTime(item.publish_at || item.created_at)}
                    </span>
                  </div>
                </div>

                <h2 className="card-title">{item.title}</h2>
                <p className="card-snippet">{item.content}</p>

                <div className="card-footer-row">
                  <span className="read-more-link">
                    Read notice details &rarr;
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && !error && totalCount > 0 && (
          <div className="announcements-pagination">
            <span className="pagination-text">
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} announcements
            </span>
            <div className="pagination-btns">
              <button
                type="button"
                className="p-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="p-indicator">Page {page} of {totalPages}</span>
              <button
                type="button"
                className="p-btn"
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
          DETAIL MODAL
          ==================================================================== */}
      {activeAnnouncement && (
        <div
          className="announcement-modal-backdrop"
          onClick={() => setActiveAnnouncement(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-announcement-title"
        >
          <div
            className="announcement-modal-window"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-top-bar">
              <div className="modal-badges">
                <span className={`priority-badge ${getPriorityBadgeClass(activeAnnouncement.priority)}`}>
                  {activeAnnouncement.priority} Priority
                </span>
                <span className="modal-date-tag">
                  {formatDateTime(activeAnnouncement.publish_at || activeAnnouncement.created_at)}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setActiveAnnouncement(null)}
                aria-label="Close announcement"
              >
                &times;
              </button>
            </div>

            <div className="modal-body-content">
              <h2 id="modal-announcement-title" className="modal-title">
                {activeAnnouncement.title}
              </h2>

              <div className="modal-full-text">
                {activeAnnouncement.content}
              </div>
            </div>

            <div className="modal-footer-bar">
              <span className="modal-read-confirmation">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Marked as read
              </span>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setActiveAnnouncement(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EmployeeAnnouncements;
