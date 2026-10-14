import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import gaintproLogo from '../../assets/gaintpro-logo.png';
import LoginTransition from '../../components/LoginTransition/LoginTransition';
import NeuralConstellation from '../../components/NeuralConstellation/NeuralConstellation';
import './Login.css';

function Login() {
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const isExpired = searchParams.get('expired') === 'true';
      const storedNotice = sessionStorage.getItem('session_expired_notice');

      if (isExpired || storedNotice) {
        sessionStorage.removeItem('session_expired_notice');
        return storedNotice || 'Your session has expired. Please log in again.';
      }
    } catch {
      // Storage access error fallback
    }
    return '';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpExpiresIn, setOtpExpiresIn] = useState(120); // 120 seconds (2 minutes)
  const [showTransition, setShowTransition] = useState(false);
  const [transitionRole, setTransitionRole] = useState('');

  const targetPathRef = useRef('');
  const pendingAuthRef = useRef(null);
  const animationFinishedRef = useRef(false);
  const hasNavigatedRef = useRef(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  // Preload transition video asset only when user enters OTP step
  useEffect(() => {
    if (step === 'otp') {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'video';
      link.href = '/animations/gaintpro-login.mp4';
      link.type = 'video/mp4';
      document.head.appendChild(link);
      return () => {
        if (link.parentNode) link.parentNode.removeChild(link);
      };
    }
  }, [step]);

  // Cooldown countdown timer for resending OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // OTP expiration countdown timer (120 seconds / 2 minutes)
  useEffect(() => {
    if (step !== 'otp' || otpExpiresIn <= 0) return;
    const interval = setInterval(() => {
      setOtpExpiresIn((prev) => {
        if (prev <= 1) {
          setErrorMessage('OTP has expired. Please request a new one.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step, otpExpiresIn]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
      setOtpExpiresIn(120);
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

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await api.auth.requestOtp(email.trim());
      setInfoMessage(response?.message || 'A new OTP has been sent to your registered email.');
      setResendCooldown(60);
      setOtpExpiresIn(120);
      setOtp('');
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
    setOtpExpiresIn(120);
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (isSubmitting || showTransition || hasNavigatedRef.current) return;

    if (otpExpiresIn <= 0) {
      setErrorMessage('OTP has expired. Please request a new one.');
      return;
    }

    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      setErrorMessage('Please enter the full 6-digit OTP.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    pendingAuthRef.current = null;
    animationFinishedRef.current = false;

    try {
      // 1. Verify OTP with backend
      const verifyRes = await api.auth.verifyOtp(email, trimmedOtp);
      const token = verifyRes?.token;

      if (!token) {
        throw new Error(verifyRes?.message || 'Verification failed. Token not received.');
      }

      // 2. Fetch authenticated user profile via GET /api/auth/me or verifyRes.user
      let user = verifyRes.user;
      try {
        const meRes = await api.auth.getMe(token);
        if (meRes?.user) {
          user = meRes.user;
        }
      } catch {
        // Fall back to verifyRes.user
      }

      if (!user || !user.role) {
        throw new Error('Failed to retrieve user profile.');
      }

      // 3. Determine destination dashboard based on verified role
      let destination = '/login';
      if (user.role === 'EMPLOYEE') {
        destination = '/employee/dashboard';
      } else if (user.role === 'ADMIN') {
        destination = '/admin/dashboard';
      }

      // 4. Stash authenticated session to be activated ONLY after transition animation finishes
      pendingAuthRef.current = { token, user, destination };
      targetPathRef.current = destination;
      setTransitionRole(user.role);

      // 5. Activate branded transition overlay
      // Note: We deliberately DO NOT call login(token, user) or navigate() here.
      // Calling login() updates AuthContext, causing PublicRoute in AppRoutes to immediately
      // redirect and unmount <Login> and <LoginTransition> before the video's onEnded event fires.
      setShowTransition(true);
    } catch (err) {
      setShowTransition(false);
      pendingAuthRef.current = null;
      animationFinishedRef.current = false;
      const displayMsg =
        err.data?.message ||
        err.message ||
        'Verification failed. Please check the code and try again.';
      setErrorMessage(displayMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransitionComplete = () => {
    animationFinishedRef.current = true;
    const authData = pendingAuthRef.current;
    if (authData && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      console.log(`[Login] dashboard navigation: navigating to ${authData.destination}`);
      login(authData.token, authData.user);
      navigate(authData.destination, { replace: true });
    }
  };

  return (
    <>
      <LoginTransition
        isActive={showTransition}
        userRole={transitionRole}
        onTransitionComplete={handleTransitionComplete}
      />
      <main className="login-page">
        <NeuralConstellation />
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
              : 'Sign in to your organization account'}
          </p>
        </header>

        {step === 'email' ? (
          <form className="login-form" onSubmit={handleRequestOtp} noValidate>
            <div className="login-field-group">
              <label htmlFor="organization-email" className="login-label">
                Organization Email
              </label>
              <div className="login-input-wrapper">
                <svg
                  className="login-input-icon"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                  <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                </svg>
                <input
                  id="organization-email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={handleEmailChange}
                  placeholder="Enter your organization email"
                  autoComplete="email"
                  disabled={isSubmitting}
                  className={`login-input login-input-with-icon ${errorMessage ? 'login-input-error' : ''}`}
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={
                    errorMessage ? 'login-email-error' : 'login-security-message'
                  }
                />
              </div>
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
            >
              {isSubmitting ? (
                <span className="login-button-content">
                  <svg className="login-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Sending OTP...
                </span>
              ) : (
                'Send OTP'
              )}
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
              <div className="login-otp-header-row">
                <label htmlFor="otp-input" className="login-label" style={{ marginBottom: 0 }}>
                  One-Time Password (OTP)
                </label>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: otpExpiresIn > 30 ? '#2563eb' : otpExpiresIn > 0 ? '#d97706' : '#dc2626',
                    backgroundColor: otpExpiresIn > 30 ? '#eff6ff' : otpExpiresIn > 0 ? '#fffbeb' : '#fef2f2',
                    border: otpExpiresIn > 30 ? '1px solid #bfdbfe' : otpExpiresIn > 0 ? '1px solid #fde68a' : '1px solid #fecaca',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '9999px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                  role="timer"
                  aria-live="polite"
                >
                  {otpExpiresIn > 0 ? `Expires in ${formatTime(otpExpiresIn)}` : 'OTP Expired'}
                </span>
              </div>
              <div className="login-input-wrapper">
                <svg
                  className="login-input-icon"
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
                  disabled={isSubmitting || otpExpiresIn <= 0}
                  className={`login-input login-input-with-icon ${errorMessage ? 'login-input-error' : ''}`}
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={
                    errorMessage ? 'login-otp-error' : 'login-security-message'
                  }
                  autoFocus
                />
              </div>
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
              disabled={isSubmitting || otp.length !== 6 || otpExpiresIn <= 0}
            >
              {isSubmitting ? (
                <span className="login-button-content">
                  <svg className="login-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Verifying...
                </span>
              ) : otpExpiresIn <= 0 ? (
                'OTP Expired'
              ) : (
                'Verify & Sign In'
              )}
            </button>

            <div
              id="login-security-message"
              className="login-otp-actions"
            >
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={isSubmitting || resendCooldown > 0}
                className="login-action-btn login-resend-btn"
              >
                {resendCooldown > 0
                  ? `Resend OTP (${resendCooldown}s)`
                  : 'Resend OTP'}
              </button>

              <button
                type="button"
                onClick={handleChangeEmail}
                disabled={isSubmitting}
                className="login-action-btn login-change-email-btn"
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
  </>
  );
}

export default Login;
