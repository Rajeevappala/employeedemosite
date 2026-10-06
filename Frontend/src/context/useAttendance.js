import { useContext } from 'react';
import AttendanceContext from './AttendanceContext';

export function useAttendance() {
  const context = useContext(AttendanceContext);
  if (!context) {
    throw new Error('useAttendance must be used within an AttendanceProvider');
  }
  return context;
}

export default useAttendance;
