import { useContext } from 'react';
import LeaveContext from './LeaveContext';

export function useLeave() {
  const context = useContext(LeaveContext);
  if (!context) {
    throw new Error('useLeave must be used within a LeaveProvider');
  }
  return context;
}

export default useLeave;
