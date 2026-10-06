import './DocumentCard.css';

function DocumentCard({ document }) {
  return (
    <div className="document-card">
      <h3>{document?.title || 'Document Card'}</h3>
    </div>
  );
}

export default DocumentCard;
