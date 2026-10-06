import './Button.css';

function Button({ children, type = 'button', onClick, className = '', ...props }) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`custom-button ${className}`.trim()}
      {...props}
    >
      {children || 'Button'}
    </button>
  );
}

export default Button;
