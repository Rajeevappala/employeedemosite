import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import gaintproLogo from '../../assets/gaintpro-logo.png';
import './Login.css';

function Login() {
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const { login } = useAuth();
  const navigate = useNavigate();

  // Cooldown countdown timer for resending OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    if (errorMessage) {
      setErrorMessage('');
    }
    if (infoMessage) {
      setInfoMessage('');
    }
  };

  const handleOtpChange = (e) => {
    // Numeric input only, maximum 6 digits
    const numericValue = e.target.value.replace(/\D/g, '').slice(0, 6);
    setOtp(numericValue);
    if (errorMessage) {
      setErrorMessage('');
    }
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const clickTimestamp = new Date().toISOString();
    console.log(`[OTP_DEBUG] [${clickTimestamp}] Send OTP button clicked.`);

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMessage('Please enter your organization email.');
      setInfoMessage('');
      return;
    }

    // Basic format validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid organization email address.');
      setInfoMessage('');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setInfoMessage('');

    try {
      const response = await api.auth.requestOtp(trimmedEmail);
      setStep('otp');
      setOtp('');
      setInfoMessage(response?.message || 'OTP sent to your registered email.');
      setResendCooldown(60);
    } catch (err) {
      const displayMsg =
        err.data?.message || err.message || 'Unable to send OTP. Please try again.';
      console.error(
        `[OTP_DEBUG] [${new Date().toISOString()}] Login UI caught OTP request error: "${displayMsg}" (Status: ${err.status ?? 'Network/Error'})`
      );
      setErrorMessage(displayMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (isSubmitting || resendCooldown > 0) return;

    const clickTimestamp = new Date().toISOString();
    console.log(`[OTP_DEBUG] [${clickTimestamp}] Send OTP button clicked (Resend OTP).`);

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await api.auth.requestOtp(email.trim());
      setInfoMessage(response?.message || 'A new OTP has been sent to your registered email.');
      setResendCooldown(60);
    } catch (err) {
      const displayMsg =
        err.data?.message || err.message || 'Failed to resend OTP. Please try again.';
      console.error(
        `[OTP_DEBUG] [${new Date().toISOString()}] Login UI caught resend OTP error: "${displayMsg}" (Status: ${err.status ?? 'Network/Error'})`
      );
      setErrorMessage(displayMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeEmail = () => {
    setStep('email');
    setOtp('');
    setErrorMessage('');
    setInfoMessage('');
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      setErrorMessage('Please enter the full 6-digit OTP.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      // 1. Verify OTP with backend
      const verifyRes = await api.auth.verifyOtp(email, trimmedOtp);
      const token = verifyRes?.token;

      if (!token) {
        throw new Error(verifyRes?.message || 'Verification failed. Token not received.');
      }

      // 2. Store JWT in localStorage
      localStorage.setItem('token', token);

      // 3. Fetch authenticated user profile via GET /api/auth/me
      const meRes = await api.auth.getMe(token);
      const user = meRes?.user || verifyRes.user;

      if (!user || !user.role) {
        throw new Error('Failed to retrieve user profile.');
      }

      // 4. Update authentication context state
      login(token, user);

      // 5. Navigate based on authenticated role
      if (user.role === 'EMPLOYEE') {
        navigate('/employee/dashboard', { replace: true });
      } else if (user.role === 'ADMIN') {
        navigate('/admin/dashboard', { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    } catch (err) {
      const displayMsg =
        err.data?.message ||
        err.message ||
        'Verification failed. Please check the code and try again.';
      setErrorMessage(displayMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-card">
        <header className="login-header">
          <img
            src={gaintproLogo}
            alt="GaintPro Software Technologies logo"
            className="login-brand-logo"
          />

          <p className="login-org-name">GaintPro HRM Portal</p>
          <h1 className="login-title">Welcome Back</h1>
          <p className="login-subtitle">
            {step === 'otp'
              ? `Enter the 6-digit code sent to ${email}`
              : 'Sign in using your registered organization email.'}
          </p>
        </header>

        {step === 'email' ? (
          <form className="login-form" onSubmit={handleRequestOtp} noValidate>
            <div className="login-field-group">
              <label htmlFor="organization-email" className="login-label">
                Organization Email
              </label>
              <input
                id="organization-email"
                type="email"
                name="email"
                value={email}
                onChange={handleEmailChange}
                placeholder="Enter your organization email"
                autoComplete="email"
                disabled={isSubmitting}
                className={`login-input ${errorMessage ? 'login-input-error' : ''}`}
                aria-invalid={Boolean(errorMessage)}
                aria-describedby={
                  errorMessage ? 'login-email-error' : 'login-security-message'
                }
              />
              {errorMessage && (
                <p
                  id="login-email-error"
                  className="login-error-message"
                  role="alert"
                >
                  <svg
                    className="login-alert-icon"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {errorMessage}
                </p>
              )}
            </div>

            {infoMessage && (
              <div
                className="login-info-box"
                role="status"
                aria-live="polite"
              >
                <svg
                  className="login-info-icon"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{infoMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className="login-submit-button"
              disabled={isSubmitting}
              onClick={() => {
                console.log(`[OTP_DEBUG] [${new Date().toISOString()}] Send OTP button clicked.`);
              }}
            >
              {isSubmitting ? 'Sending OTP...' : 'Send OTP'}
            </button>

            <div
              id="login-security-message"
              className="login-security-message"
            >
              <svg
                className="login-shield-icon"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                  clipRule="evenodd"
                />
              </svg>
              <span>
                A one-time password will be sent to your registered email.
              </span>
            </div>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleVerifyOtp} noValidate>
            <div className="login-field-group">
              <label htmlFor="otp-input" className="login-label">
                One-Time Password (OTP)
              </label>
              <input
                id="otp-input"
                type="text"
                name="otp"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                placeholder="Enter 6-digit OTP"
                autoComplete="one-time-code"
                disabled={isSubmitting}
                className={`login-input ${errorMessage ? 'login-input-error' : ''}`}
                aria-invalid={Boolean(errorMessage)}
                aria-describedby={
                  errorMessage ? 'login-otp-error' : 'login-security-message'
                }
                autoFocus
              />
              {errorMessage && (
                <p
                  id="login-otp-error"
                  className="login-error-message"
                  role="alert"
                >
                  <svg
                    className="login-alert-icon"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {errorMessage}
                </p>
              )}
            </div>

            {infoMessage && (
              <div
                className="login-info-box"
                role="status"
                aria-live="polite"
              >
                <svg
                  className="login-info-icon"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{infoMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className="login-submit-button"
              disabled={isSubmitting || otp.length !== 6}
            >
              {isSubmitting ? 'Verifying...' : 'Verify & Sign In'}
            </button>

            <div
              id="login-security-message"
              className="login-security-message"
              style={{ justifyContent: 'space-between', marginTop: '1.25rem' }}
            >
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={isSubmitting || resendCooldown > 0}
                style={{
                  background: 'none',
                  border: 'none',
                  color: resendCooldown > 0 ? '#9ca3af' : '#2563eb',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                {resendCooldown > 0
                  ? `Resend OTP (${resendCooldown}s)`
                  : 'Resend OTP'}
              </button>

              <button
                type="button"
                onClick={handleChangeEmail}
                disabled={isSubmitting}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  fontFamily: 'inherit',
                }}
              >
                Change Email
              </button>
            </div>
          </form>
        )}

        <footer className="login-footer">
          <p>Authorized employees only</p>
        </footer>
      </div>
    </main>
  );
}

export default Login;
