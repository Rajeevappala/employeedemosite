import { createContext, useState } from 'react';
import { useLeave } from './useLeave';

// ============================================================================
// Single Source of Truth for Attendance Management
// Architecture ready for:
// GET  /api/employee/attendance
// GET  /api/employee/attendance?month=2026-09
// GET  /api/admin/attendance?date=2026-09-29
// POST /api/admin/attendance
// PUT  /api/admin/attendance/:attendanceId
// ============================================================================

const AttendanceContext = createContext(null);

const MOCK_EMPLOYEES = [
  {
    id: 'GP001',
    name: 'Sai Rajeev Appala',
    department: 'Technology',
    designation: 'Python Developer',
    email: 'sai.rajeev@example.com',
    status: 'Active',
    avatarInitial: 'SR',
  },
  {
    id: 'GP002',
    name: 'Arjun Kumar',
    department: 'Technology',
    designation: 'Backend Developer',
    email: 'arjun@example.com',
    status: 'Active',
    avatarInitial: 'AK',
  },
  {
    id: 'GP003',
    name: 'Priya Sharma',
    department: 'HR',
    designation: 'HR Executive',
    email: 'priya@example.com',
    status: 'Active',
    avatarInitial: 'PS',
  },
  {
    id: 'GP004',
    name: 'Rahul Verma',
    department: 'Finance',
    designation: 'Accountant',
    email: 'rahul.verma@example.com',
    status: 'Active',
    avatarInitial: 'RV',
  },
  {
    id: 'GP005',
    name: 'Sneha Reddy',
    department: 'Technology',
    designation: 'React Developer',
    email: 'sneha.reddy@example.com',
    status: 'Active',
    avatarInitial: 'SR',
  },
  {
    id: 'GP006',
    name: 'Kiran Rao',
    department: 'Operations',
    designation: 'Operations Executive',
    email: 'kiran.rao@example.com',
    status: 'Active',
    avatarInitial: 'KR',
  },
  {
    id: 'GP007',
    name: 'Amit Patel',
    department: 'Sales',
    designation: 'Business Development Exec',
    email: 'amit.patel@example.com',
    status: 'Active',
    avatarInitial: 'AP',
  },
  {
    id: 'GP008',
    name: 'Neha Gupta',
    department: 'HR',
    designation: 'Talent Acquisition Lead',
    email: 'neha.gupta@example.com',
    status: 'Active',
    avatarInitial: 'NG',
  },
  {
    id: 'GP009',
    name: 'Vikram Singh',
    department: 'Technology',
    designation: 'DevOps Engineer',
    email: 'vikram.singh@example.com',
    status: 'Active',
    avatarInitial: 'VS',
  },
  {
    id: 'GP010',
    name: 'Divya Nair',
    department: 'Finance',
    designation: 'Financial Analyst',
    email: 'divya.nair@example.com',
    status: 'Active',
    avatarInitial: 'DN',
  },
];

// Helper to generate full September 2026 records for GP001 exactly matching prompt:
// September 2026: Working Days: 26, Present: 22, Absent: 1, Paid Leave: 2, Work From Home: 1, Half Day: 0, Holiday: 4
function generateInitialRecords() {
  const records = [];
  let idCounter = 1;

  // GP001 September 2026 records (30 days total)
  // Sundays: 6, 13, 20, 27 (4 Holidays)
  // Paid Leave: 11, 12 (2 Days)
  // Absent: 17 (1 Day)
  // WFH: 28 (1 Day)
  // Present: Remaining 22 days (1, 2, 3, 4, 5, 7, 8, 9, 10, 14, 15, 16, 18, 19, 21, 22, 23, 24, 25, 26, 29, 30)
  for (let day = 1; day <= 30; day++) {
    const dayStr = day < 10 ? `0${day}` : `${day}`;
    const date = `2026-09-${dayStr}`;

    let status = 'Present';
    let remarks = '';
    let markedBy = 'Admin';

    if ([6, 13, 20, 27].includes(day)) {
      status = 'Holiday';
      remarks = 'Weekend';
      markedBy = 'System';
    } else if (day === 11 || day === 12) {
      status = 'Leave';
      remarks = 'Approved PL';
      markedBy = 'Admin';
    } else if (day === 17) {
      status = 'Absent';
      remarks = 'Unplanned absence';
      markedBy = 'Admin';
    } else if (day === 28) {
      status = 'Work From Home';
      remarks = 'Approved WFH';
      markedBy = 'Admin';
    } else {
      status = 'Present';
      remarks = '';
      markedBy = 'Admin';
    }

    records.push({
      id: `ATT_${String(idCounter++).padStart(4, '0')}`,
      employeeId: 'GP001',
      employeeName: 'Sai Rajeev Appala',
      date,
      status,
      remarks,
      markedBy,
      markedAt: `${date}T09:30:00`,
      updatedAt: `${date}T09:30:00`,
    });
  }

  // 29 September 2026 Records for all employees:
  // GP001: Present (already added above)
  // GP002: Present
  // GP003: Leave
  // GP004: Absent
  // GP005: Work From Home
  // GP006: Present
  // GP007: Present
  // GP008: Present
  // GP009: Present
  // GP010: Present
  const date29 = '2026-09-29';
  const sep29Statuses = [
    { empId: 'GP002', name: 'Arjun Kumar', status: 'Present', remarks: '' },
    { empId: 'GP003', name: 'Priya Sharma', status: 'Leave', remarks: 'Approved PL' },
    { empId: 'GP004', name: 'Rahul Verma', status: 'Absent', remarks: 'Unplanned absence' },
    { empId: 'GP005', name: 'Sneha Reddy', status: 'Work From Home', remarks: 'Approved WFH' },
    { empId: 'GP006', name: 'Kiran Rao', status: 'Present', remarks: '' },
    { empId: 'GP007', name: 'Amit Patel', status: 'Present', remarks: '' },
    { empId: 'GP008', name: 'Neha Gupta', status: 'Present', remarks: '' },
    { empId: 'GP009', name: 'Vikram Singh', status: 'Present', remarks: '' },
    { empId: 'GP010', name: 'Divya Nair', status: 'Present', remarks: '' },
  ];

  sep29Statuses.forEach((item) => {
    records.push({
      id: `ATT_${String(idCounter++).padStart(4, '0')}`,
      employeeId: item.empId,
      employeeName: item.name,
      date: date29,
      status: item.status,
      remarks: item.remarks,
      markedBy: item.status === 'Leave' ? 'Admin' : 'Admin',
      markedAt: `${date29}T09:30:00`,
      updatedAt: `${date29}T09:30:00`,
    });
  });

  // Additional realistic history for other employees in September for testing:
  const sampleDates = ['2026-09-28', '2026-09-27', '2026-09-26', '2026-09-25'];
  sampleDates.forEach((d) => {
    const isSun = d === '2026-09-27';
    ['GP002', 'GP003', 'GP004', 'GP005'].forEach((empId) => {
      const emp = MOCK_EMPLOYEES.find((e) => e.id === empId);
      const status = isSun
        ? 'Holiday'
        : empId === 'GP005' && d === '2026-09-28'
        ? 'Work From Home'
        : empId === 'GP004' && d === '2026-09-26'
        ? 'Leave'
        : 'Present';

      records.push({
        id: `ATT_${String(idCounter++).padStart(4, '0')}`,
        employeeId: empId,
        employeeName: emp?.name || empId,
        date: d,
        status,
        remarks: isSun ? 'Weekend' : status === 'Leave' ? 'Approved Leave' : status === 'Work From Home' ? 'Approved WFH' : '',
        markedBy: isSun ? 'System' : 'Admin',
        markedAt: `${d}T09:30:00`,
        updatedAt: `${d}T09:30:00`,
      });
    });
  });

  // Sample records for August 2026 for GP001 (so month selector switching has data)
  for (let day = 1; day <= 31; day++) {
    const dayStr = day < 10 ? `0${day}` : `${day}`;
    const date = `2026-08-${dayStr}`;
    // Sundays in Aug 2026: 2, 9, 16, 23, 30 (5 Holidays)
    const isSunday = [2, 9, 16, 23, 30].includes(day);
    const status = isSunday
      ? 'Holiday'
      : day === 14 || day === 15
      ? 'Leave'
      : day === 20
      ? 'Work From Home'
      : day === 25
      ? 'Absent'
      : 'Present';

    records.push({
      id: `ATT_${String(idCounter++).padStart(4, '0')}`,
      employeeId: 'GP001',
      employeeName: 'Sai Rajeev Appala',
      date,
      status,
      remarks: isSunday ? 'Weekend' : status === 'Leave' ? 'Independence Day extended trip' : '',
      markedBy: isSunday ? 'System' : 'Admin',
      markedAt: `${date}T09:30:00`,
      updatedAt: `${date}T09:30:00`,
    });
  }

  return records;
}

export function AttendanceProvider({ children }) {
  const [attendanceRecords, setAttendanceRecords] = useState(generateInitialRecords);
  const [employees] = useState(MOCK_EMPLOYEES);
  const { leaveRequests } = useLeave();

  // Helper to check if employee has an approved leave request on a given date
  const getApprovedLeave = (employeeId, dateStr) => {
    if (!leaveRequests || !leaveRequests.length) return null;
    return leaveRequests.find(
      (lr) =>
        lr.employeeId === employeeId &&
        lr.status === 'Approved' &&
        dateStr >= lr.startDate &&
        dateStr <= lr.endDate
    );
  };

  // Get specific attendance record for an employee on a date
  // Checks:
  // 1. Explicit attendance record in state
  // 2. Approved leave in LeaveContext
  // 3. Weekend (Sunday)
  const getEmployeeRecordForDate = (employeeId, dateStr) => {
    const existing = attendanceRecords.find(
      (r) => r.employeeId === employeeId && r.date === dateStr
    );
    if (existing) return existing;

    // Check approved leave
    const approvedLeave = getApprovedLeave(employeeId, dateStr);
    if (approvedLeave) {
      const emp = employees.find((e) => e.id === employeeId);
      return {
        id: `ATT_LEAVE_${employeeId}_${dateStr}`,
        employeeId,
        employeeName: emp?.name || employeeId,
        date: dateStr,
        status: 'Leave',
        remarks: `Approved ${approvedLeave.leaveType || 'Leave'}`,
        markedBy: 'System (Leave)',
        markedAt: `${dateStr}T09:00:00`,
        isFromLeaveContext: true,
      };
    }

    return null;
  };

  // Get all attendance records for an employee
  const getEmployeeAttendance = (employeeId) => {
    return attendanceRecords
      .filter((r) => r.employeeId === employeeId)
      .sort((a, b) => b.date.localeCompare(a.date));
  };

  // Get records for a specific date across all employees
  const getAttendanceByDate = (dateStr) => {
    return attendanceRecords.filter((r) => r.date === dateStr);
  };

  // Get records for an employee in a specific month (e.g. '2026-09')
  const getAttendanceByMonth = (employeeId, yearMonthStr) => {
    return attendanceRecords
      .filter((r) => r.employeeId === employeeId && r.date.startsWith(yearMonthStr))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  // Check if attendance has been explicitly marked
  const isAttendanceMarked = (employeeId, dateStr) => {
    return Boolean(
      attendanceRecords.some((r) => r.employeeId === employeeId && r.date === dateStr)
    );
  };

  // Mark or update attendance for an employee on a date
  // Prevents duplicate records for the same employee + date
  const markAttendance = ({ employeeId, employeeName, date, status, remarks, markedBy = 'Admin' }) => {
    const emp = employees.find((e) => e.id === employeeId);
    const resolvedName = employeeName || emp?.name || employeeId;
    const nowIso = new Date().toISOString();

    setAttendanceRecords((prev) => {
      const existingIndex = prev.findIndex(
        (r) => r.employeeId === employeeId && r.date === date
      );

      if (existingIndex >= 0) {
        // Update existing record
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          status,
          remarks: remarks !== undefined ? remarks : updated[existingIndex].remarks,
          markedBy,
          updatedAt: nowIso,
        };
        return updated;
      } else {
        // Create new record
        const newRecord = {
          id: `ATT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          employeeId,
          employeeName: resolvedName,
          date,
          status,
          remarks: remarks || '',
          markedBy,
          markedAt: nowIso,
          updatedAt: nowIso,
        };
        return [...prev, newRecord];
      }
    });
  };

  // Update existing record by ID
  const updateAttendance = (attendanceId, updatedFields) => {
    const nowIso = new Date().toISOString();
    setAttendanceRecords((prev) =>
      prev.map((r) =>
        r.id === attendanceId
          ? { ...r, ...updatedFields, updatedAt: nowIso }
          : r
      )
    );
  };

  // Mark all unmarked employees as Present for a selected date
  // IMPORTANT: Does NOT overwrite existing Leave, Holiday, Absent, Half Day, or WFH
  const markAllPresent = (dateStr) => {
    const nowIso = new Date().toISOString();
    const newRecords = [];

    employees.forEach((emp) => {
      // Check if employee already has an explicit record
      const hasRecord = attendanceRecords.some(
        (r) => r.employeeId === emp.id && r.date === dateStr
      );

      // Check if employee has an approved leave
      const hasApprovedLeave = Boolean(getApprovedLeave(emp.id, dateStr));

      // Check if Sunday
      const parts = dateStr.split('-');
      const dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      const isSunday = dObj.getDay() === 0;

      if (!hasRecord && !hasApprovedLeave && !isSunday) {
        newRecords.push({
          id: `ATT_${Date.now()}_${emp.id}_${Math.floor(Math.random() * 1000)}`,
          employeeId: emp.id,
          employeeName: emp.name,
          date: dateStr,
          status: 'Present',
          remarks: 'Marked Present by Admin',
          markedBy: 'Admin',
          markedAt: nowIso,
          updatedAt: nowIso,
        });
      }
    });

    if (newRecords.length > 0) {
      setAttendanceRecords((prev) => [...prev, ...newRecords]);
    }

    return newRecords.length;
  };

  // Calculate monthly summary for an employee
  const getMonthlySummary = (employeeId, yearMonthStr) => {
    const records = getAttendanceByMonth(employeeId, yearMonthStr);

    let present = 0;
    let absent = 0;
    let paidLeave = 0;
    let workFromHome = 0;
    let halfDay = 0;
    let holiday = 0;

    records.forEach((r) => {
      switch (r.status) {
        case 'Present':
          present += 1;
          break;
        case 'Absent':
          absent += 1;
          break;
        case 'Leave':
          paidLeave += 1;
          break;
        case 'Work From Home':
          workFromHome += 1;
          break;
        case 'Half Day':
          halfDay += 1;
          break;
        case 'Holiday':
          holiday += 1;
          break;
        default:
          break;
      }
    });

    // Working days are standard workdays (present + absent + leave + wfh + half day)
    const workingDays = present + absent + paidLeave + workFromHome + halfDay;

    return {
      workingDays,
      present,
      absent,
      paidLeave,
      workFromHome,
      halfDay,
      holiday,
      totalRecords: records.length,
    };
  };

  // Calculate daily summary for Admin date view
  const getDailySummary = (dateStr) => {
    let present = 0;
    let absent = 0;
    let leave = 0;
    let workFromHome = 0;
    let halfDay = 0;
    let holiday = 0;
    let unmarked = 0;

    employees.forEach((emp) => {
      const rec = getEmployeeRecordForDate(emp.id, dateStr);
      if (!rec) {
        unmarked += 1;
      } else {
        switch (rec.status) {
          case 'Present':
            present += 1;
            break;
          case 'Absent':
            absent += 1;
            break;
          case 'Leave':
            leave += 1;
            break;
          case 'Work From Home':
            workFromHome += 1;
            break;
          case 'Half Day':
            halfDay += 1;
            break;
          case 'Holiday':
            holiday += 1;
            break;
          default:
            unmarked += 1;
            break;
        }
      }
    });

    return {
      totalEmployees: employees.length,
      present,
      absent,
      leave,
      workFromHome,
      halfDay,
      holiday,
      unmarked,
    };
  };

  return (
    <AttendanceContext.Provider
      value={{
        employees,
        attendanceRecords,
        getEmployeeAttendance,
        getAttendanceByDate,
        getAttendanceByMonth,
        getEmployeeRecordForDate,
        markAttendance,
        updateAttendance,
        markAllPresent,
        getMonthlySummary,
        getDailySummary,
        isAttendanceMarked,
        getApprovedLeave,
      }}
    >
      {children}
    </AttendanceContext.Provider>
  );
}

export default AttendanceContext;
