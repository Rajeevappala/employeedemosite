import { Link } from 'react-router-dom';
import './Settings.css';

const SETTINGS_SECTIONS = [
  {
    id: 'organization',
    emoji: '🏢',
    theme: 'theme-blue',
    title: 'Organization',
    description: 'Company information and organization configuration.',
    status: 'Configurable Module',
    note: 'Legal entity, address, contact & organization details',
    link: '/admin/settings/organization',
  },
  {
    id: 'work-attendance',
    emoji: '📅',
    theme: 'theme-violet',
    title: 'Work & Attendance',
    description: 'Working days, work hours, weekly offs and attendance rules.',
    status: 'Configurable Module',
    note: 'Configurable 5-day / 6-day schedules, shift timings & rules',
    link: '/admin/settings/work-attendance',
  },
  {
    id: 'leaves',
    emoji: '🌴',
    theme: 'theme-emerald',
    title: 'Leave Management',
    description: 'Leave types, balances, carry-forward and leave rules.',
    status: 'Configurable Module',
    note: 'PL/SL/UPL quotas, sandwich rules & carry-forward caps',
    link: '/admin/settings/leave',
  },
  {
    id: 'holidays',
    emoji: '🏖️',
    theme: 'theme-amber',
    title: 'Holiday Calendar',
    description: 'Manage organization holidays and holiday calendar.',
    status: 'Configurable Module',
    note: 'Declared company holidays & public observance calendar',
    link: '/admin/settings/holidays',
  },
  {
    id: 'employee-config',
    emoji: '👥',
    theme: 'theme-indigo',
    title: 'Employee Configuration',
    description: 'Departments, designations, employment types and locations.',
    status: 'Configurable Module',
    note: 'Taxonomy, job bands, work locations & employment tiers',
    link: '/admin/settings/employees',
  },
];

function Settings() {
  return (
    <div className="admin-settings-page">
      {/* Page Header */}
      <div className="admin-settings-header-card">
        <div className="admin-settings-title-group">
          <h1 className="admin-settings-title">Settings</h1>
          <p className="admin-settings-subtitle">
            Manage organization-wide HR and portal configuration.
          </p>
        </div>

        <div className="admin-settings-info-banner" role="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <div>
            <strong>Configuration Hub:</strong> Below are the organization-wide settings domains. Select a module to manage its configuration, or review current operational defaults.
          </div>
        </div>
      </div>

      {/* Settings Domain Cards */}
      <div className="admin-settings-grid">
        {SETTINGS_SECTIONS.map((section) => {
          const CardContent = (
            <>
              <div>
                <div className="admin-settings-card-top">
                  <div className={`admin-settings-icon-wrapper ${section.theme}`} aria-hidden="true">
                    <span>{section.emoji}</span>
                  </div>
                  <span className="admin-settings-badge">
                    <span className="admin-settings-badge-dot"></span>
                    {section.status}
                  </span>
                </div>

                <div className="admin-settings-card-content">
                  <h2 className="admin-settings-card-title">{section.title}</h2>
                  <p className="admin-settings-card-desc">{section.description}</p>
                </div>
              </div>

              <div className="admin-settings-card-footer">
                {section.link ? (
                  <span className="admin-settings-action-cta">
                    Configure &amp; Manage
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </span>
                ) : (
                  <span className="admin-settings-status-note">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    {section.note}
                  </span>
                )}
              </div>
            </>
          );

          if (section.link) {
            return (
              <Link
                key={section.id}
                to={section.link}
                className="admin-settings-card admin-settings-card-clickable"
                aria-label={`Open ${section.title} settings`}
              >
                {CardContent}
              </Link>
            );
          }

          return (
            <div key={section.id} className="admin-settings-card">
              {CardContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Settings;

