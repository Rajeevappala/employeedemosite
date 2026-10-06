import './EmployeeCard.css';

function EmployeeCard({ employee }) {
  return (
    <div className="employee-card">
      <h3>{employee?.name || 'Employee Card'}</h3>
    </div>
  );
}

export default EmployeeCard;
