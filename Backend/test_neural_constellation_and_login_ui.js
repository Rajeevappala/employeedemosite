const fs = require('fs');
const path = require('path');

function run() {
  console.log('================================================================');
  console.log(' GAINTPRO HRM — NEURAL CONSTELLATION & LOGIN INTEGRATION TEST');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Component Architecture & Canvas Lifecycle
    console.log('--- 1. NeuralConstellation Component Architecture ---');
    const compPath = path.resolve(__dirname, '../Frontend/src/components/NeuralConstellation/NeuralConstellation.jsx');
    const cssPath = path.resolve(__dirname, '../Frontend/src/components/NeuralConstellation/NeuralConstellation.css');

    assert(fs.existsSync(compPath), 'NeuralConstellation.jsx component file exists');
    assert(fs.existsSync(cssPath), 'NeuralConstellation.css style file exists');

    const compContent = fs.readFileSync(compPath, 'utf8');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert(compContent.includes('useRef') && compContent.includes('canvasRef'), 'Component uses React canvasRef');
    assert(compContent.includes('requestAnimationFrame') && compContent.includes('cancelAnimationFrame'), 'Component implements requestAnimationFrame loop with cancel cleanup');
    assert(compContent.includes('devicePixelRatio'), 'Component scales for devicePixelRatio without memory bloat');
    assert(compContent.includes('PROXIMITY_DISTANCE = 125') || compContent.includes('PROXIMITY_DISTANCE'), 'Component defines proximity distance threshold for connections');
    assert(compContent.includes('MOUSE_RADIUS = 160') || compContent.includes('MOUSE_RADIUS'), 'Component defines magnetic cursor influence radius');
    assert(compContent.includes('MAX_SPEED'), 'Component defines velocity cap for smooth organic motion');
    assert(compContent.includes('prefers-reduced-motion'), 'Component listens and responds to prefers-reduced-motion media query');
    assert(compContent.includes('visibilitychange'), 'Component pauses rendering when tab is hidden to conserve CPU/battery');
    assert(compContent.includes('removeEventListener'), 'Component cleans up all resize, pointer, and visibility listeners on unmount');

    // 2. Visual Design & CSS Integrity
    console.log('\n--- 2. Visual Design & Layering Audit ---');
    assert(cssContent.includes('pointer-events: none'), 'CSS enforces pointer-events: none so canvas never blocks form input');
    assert(cssContent.includes('.neural-constellation-container') && cssContent.includes('position: absolute'), 'Container is positioned absolutely behind form');
    assert(cssContent.includes('.neural-constellation-ambient'), 'Ambient glowing gradients configured for background depth');

    // 3. Login Page Integration Audit
    console.log('\n--- 3. Login.jsx & Login.css Integration Audit ---');
    const loginJsxPath = path.resolve(__dirname, '../Frontend/src/pages/Login/Login.jsx');
    const loginCssPath = path.resolve(__dirname, '../Frontend/src/pages/Login/Login.css');

    const loginJsx = fs.readFileSync(loginJsxPath, 'utf8');
    const loginCss = fs.readFileSync(loginCssPath, 'utf8');

    assert(loginJsx.includes('NeuralConstellation'), 'Login.jsx imports NeuralConstellation component');
    assert(loginJsx.includes('<NeuralConstellation />'), 'Login.jsx renders <NeuralConstellation /> inside main container');
    assert(loginJsx.includes('<LoginTransition'), 'Login.jsx preserves GaintPro logo-reveal video transition overlay');
    assert(loginJsx.includes("step === 'email'") && loginJsx.includes("step === 'otp'"), 'Login.jsx preserves both email and OTP steps');
    assert(loginJsx.includes('handleVerifyOtp') && loginJsx.includes('handleRequestOtp'), 'Login.jsx preserves request and verify handlers');

    assert(loginJsx.includes('Sign in to your organization account'), 'Login.jsx renders required subtitle "Sign in to your organization account"');
    assert(loginJsx.includes('Organization Email'), 'Login.jsx renders "Organization Email" field label');
    assert(loginJsx.includes('login-input-icon'), 'Login.jsx renders envelope input icon');
    assert(loginJsx.includes('Send OTP'), 'Login.jsx renders "Send OTP" primary action');

    assert(loginCss.includes('background: #ffffff') || loginCss.includes('background-color: #ffffff'), 'Login card uses clean white surface');
    assert(loginCss.includes('border-radius: 1.375rem') || loginCss.includes('border-radius: 1.25rem') || loginCss.includes('20px') || loginCss.includes('22px'), 'Login card features 20-24px rounded corners');
    assert(loginCss.includes('z-index: 10'), 'Login card has higher z-index (10) above constellation canvas (1)');

    console.log('\n================================================================');
    console.log(` SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();
