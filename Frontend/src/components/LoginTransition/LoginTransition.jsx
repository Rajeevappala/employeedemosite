import { useEffect, useRef, useState, useCallback } from 'react';
import gaintproLogo from '../../assets/gaintpro-logo.png';
import './LoginTransition.css';

const VIDEO_SRC = '/animations/gaintpro-login.mp4';
const TRIM_START_SECONDS = 2.8;   // Starts right as geometric shapes assemble into the logo
// Reference branded reveal timestamp: TRIM_END_SECONDS = 6.8 (video plays to onEnded completion)
const FALLBACK_DURATION_MS = 2200; // Duration when using static logo fallback or reduced motion
const WATCHDOG_TIMEOUT_MS = 15000;  // Safety timeout ensuring user is never indefinitely stuck

function checkReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * LoginTransition
 * Full-screen branded transition animation overlay displayed immediately
 * after successful OTP verification and before entering the dashboard.
 */
export default function LoginTransition({
  isActive = false,
  userRole = '',
  onTransitionComplete = () => {},
}) {
  const [useFallback, setUseFallback] = useState(() => checkReducedMotion());
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const videoRef = useRef(null);
  const hasFinishedRef = useRef(false);
  const hasSeekedRef = useRef(false);

  // Trigger completion with smooth fade-out
  const finishTransition = useCallback(() => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;
    setIsFadingOut(true);
    setTimeout(() => {
      onTransitionComplete();
    }, 380);
  }, [onTransitionComplete]);

  // Handle initialization and accessibility modes
  useEffect(() => {
    if (!isActive) return;

    if (useFallback) {
      console.log('[LoginTransition] Using fallback mode (reduced motion or video unavailable)');
      const timer = setTimeout(finishTransition, FALLBACK_DURATION_MS);
      return () => clearTimeout(timer);
    }

    // Safety watchdog timer: triggers fallback/completion if video fails to progress
    const watchdogTimer = setTimeout(() => {
      if (!hasFinishedRef.current) {
        console.warn('[LoginTransition] Watchdog timer fired after 15s; finishing transition');
        finishTransition();
      }
    }, WATCHDOG_TIMEOUT_MS);

    return () => {
      clearTimeout(watchdogTimer);
    };
  }, [isActive, useFallback, finishTransition]);

  // Video playback started
  const handlePlay = () => {
    console.log('[LoginTransition] onPlay: video playback started');
    setIsVideoLoaded(true);
  };

  // Video metadata loaded
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    console.log(`[LoginTransition] onLoadedMetadata: video duration=${video.duration?.toFixed(2)}s`);

    if (!hasSeekedRef.current) {
      hasSeekedRef.current = true;
      try {
        if (video.duration && video.duration >= TRIM_START_SECONDS) {
          video.currentTime = TRIM_START_SECONDS;
        }
      } catch {
        // Ignore seek exception in restricted contexts
      }
    }

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          // Autoplay started successfully
        })
        .catch((err) => {
          console.error('[LoginTransition] playback error (autoplay policy restricted):', err);
          setUseFallback(true);
        });
    }
  };

  // Video error handler
  const handleVideoError = (err) => {
    console.error('[LoginTransition] playback error:', err?.nativeEvent || err);
    setUseFallback(true);
  };

  // Natural video ended handler - primary completion trigger
  const handleVideoEnded = () => {
    console.log('[LoginTransition] onEnded: video playback ended');
    finishTransition();
  };

  if (!isActive) return null;

  const roleText =
    userRole === 'ADMIN'
      ? 'Admin Portal'
      : userRole === 'EMPLOYEE'
      ? 'Employee Portal'
      : 'GaintPro HRM';

  return (
    <div
      className={`login-transition-overlay ${isFadingOut ? 'fade-out' : 'fade-in'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Preparing your workspace"
    >
      <div className="login-transition-container">
        {!useFallback ? (
          <div className="login-transition-video-wrapper">
            <video
              ref={videoRef}
              className={`login-transition-video ${isVideoLoaded ? 'visible' : 'hidden'}`}
              src={VIDEO_SRC}
              muted
              playsInline
              autoPlay
              preload="auto"
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={handlePlay}
              onEnded={handleVideoEnded}
              onError={handleVideoError}
              aria-label="GaintPro Logo Reveal Animation"
            />

            {!isVideoLoaded && (
              <div className="login-transition-fallback-card initial-loading">
                <img
                  src={gaintproLogo}
                  alt="GaintPro Software Technologies"
                  className="login-transition-logo"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="login-transition-fallback-card">
            <img
              src={gaintproLogo}
              alt="GaintPro Software Technologies"
              className="login-transition-logo"
            />
          </div>
        )}

        <div className="login-transition-status">
          <p className="login-transition-message">Preparing your workspace...</p>
          <span className="login-transition-role-badge">{roleText}</span>
          <div className="login-transition-progress-track" aria-hidden="true">
            <div className="login-transition-progress-bar" />
          </div>
        </div>
      </div>
    </div>
  );
}
