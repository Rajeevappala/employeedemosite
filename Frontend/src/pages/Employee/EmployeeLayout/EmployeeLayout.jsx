import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../../../components/Navbar/Navbar';
import Sidebar from '../../../components/Sidebar/Sidebar';
import './EmployeeLayout.css';

function EmployeeLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Close drawer on pressing Escape key for accessibility
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsSidebarOpen(false);
      }
    };

    if (isSidebarOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSidebarOpen]);

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  return (
    <div className="employee-layout">
      <Navbar onToggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />
      <div className="employee-layout-body">
        <Sidebar isOpen={isSidebarOpen} onClose={closeSidebar} />
        <main className="employee-main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default EmployeeLayout;
