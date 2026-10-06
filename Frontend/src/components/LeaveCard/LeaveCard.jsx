import './LeaveCard.css';

function LeaveCard({ leave }) {
  return (
    <div className="leave-card">
      <h3>{leave?.type || 'Leave Card'}</h3>
    </div>
  );
}

export default LeaveCard;
