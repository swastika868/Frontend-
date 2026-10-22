// ==========================================================
// CONFIG
// ==========================================================
const API_BASE_URL = 'https://backend786-production.up.railway.app/api';

// ==========================================================
// API HELPER
// ==========================================================
async function postJson(path, body) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch (_) { /* non-JSON response */ }
    return { status: response.status, ok: response.ok, data };
}

// ==========================================================
// TOAST (replaces alert())
// ==========================================================
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const text = document.getElementById('toast-text');
    text.textContent = message;
    toast.classList.remove('is-error', 'is-success');
    if (type === 'error') toast.classList.add('is-error');
    if (type === 'success') toast.classList.add('is-success');
    toast.classList.add('is-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

// ==========================================================
// PASSWORD SHOW / HIDE
// ==========================================================
document.querySelectorAll('.eye-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.getAttribute('data-target'));
        const isVisible = input.type === 'text';
        input.type = isVisible ? 'password' : 'text';
        btn.classList.toggle('is-visible', !isVisible);
        btn.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    });
});

// ==========================================================
// SEAL PROGRESS ARC
// ==========================================================
const sealArc = document.getElementById('seal-arc');
if (sealArc) {
    const circumference = 2 * Math.PI * 76;
    sealArc.style.strokeDasharray = circumference;
    sealArc.style.strokeDashoffset = circumference;
    window.setSealProgress = (fraction) => {
        sealArc.style.strokeDashoffset = circumference * (1 - fraction);
    };
}

function markStepDone(stepEl) {
    stepEl.classList.remove('is-active');
    stepEl.classList.add('is-done');
}

// ==========================================================
// SIGNUP PAGE LOGIC
// Flow:  /otp/send  ->  /otp/verify (gives verificationToken)  ->  /auth/signup
// ==========================================================
const signupForm = document.getElementById('signup-form');

if (signupForm) {
    const nameInput = document.getElementById('name');
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirm-password');
    const otpInput = document.getElementById('otp');

    const sendOtpBtn = document.getElementById('send-otp-btn');
    const verifyOtpBtn = document.getElementById('verify-otp-btn');

    const emailHint = document.getElementById('email-hint');
    const usernameHint = document.getElementById('username-hint');
    const confirmHint = document.getElementById('confirm-hint');
    const strengthBars = document.querySelectorAll('[data-bar]');
    const strengthLabel = document.getElementById('strength-label');

    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const stepCount = document.getElementById('step-count');

    const RESEND_SECONDS = 60; // backend enforces a 60s cooldown
    const USERNAME_RX = /^[a-z0-9._]{3,30}$/;

    let otpSent = false;
    let resendTimer = null;
    let locked = false;               // true once we redirect (keeps buttons disabled)
    let verificationToken = null;     // returned by /otp/verify, needed by /auth/signup
    let verifiedEmail = null;         // email the token belongs to

    // ---------- password strength ----------
    function scorePassword(pw) {
        let score = 0;
        if (pw.length >= 8) score++;
        if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
        if (/\d/.test(pw)) score++;
        if (/[^A-Za-z0-9]/.test(pw)) score++;
        return score; // 0-4
    }

    const strengthCopy = ['Too short', 'Weak — add a number or symbol', 'Getting there', 'Good password', 'Strong password'];
    const strengthColors = ['#e2665d', '#e2665d', '#c9a227', '#4caf7d', '#4caf7d'];

    passwordInput.addEventListener('input', () => {
        const score = scorePassword(passwordInput.value);
        strengthBars.forEach((bar, i) => {
            bar.style.background = i < score ? strengthColors[score] : 'var(--line)';
        });
        strengthLabel.textContent = passwordInput.value ? strengthCopy[score] : 'Use 8+ characters with a number and a symbol';
        validateConfirm();
    });

    // ---------- confirm password match ----------
    function validateConfirm() {
        if (!confirmInput.value) {
            confirmInput.classList.remove('is-valid', 'is-invalid');
            confirmHint.textContent = '';
            confirmHint.className = 'field-hint';
            return;
        }
        const matches = confirmInput.value === passwordInput.value;
        confirmInput.classList.toggle('is-valid', matches);
        confirmInput.classList.toggle('is-invalid', !matches);
        confirmHint.textContent = matches ? 'Passwords match' : 'Passwords do not match';
        confirmHint.className = 'field-hint ' + (matches ? 'is-good' : 'is-bad');
    }
    confirmInput.addEventListener('input', validateConfirm);

    // ---------- username check ----------
    usernameInput.addEventListener('input', () => {
        usernameInput.value = usernameInput.value.toLowerCase().replace(/[^a-z0-9._]/g, '');
        const v = usernameInput.value;
        if (!v) {
            usernameInput.classList.remove('is-valid', 'is-invalid');
            usernameHint.textContent = '';
            usernameHint.className = 'field-hint';
            return;
        }
        const ok = USERNAME_RX.test(v);
        usernameInput.classList.toggle('is-valid', ok);
        usernameInput.classList.toggle('is-invalid', !ok);
        usernameHint.textContent = ok ? '' : '3–30 characters: letters, numbers, . and _';
        usernameHint.className = 'field-hint ' + (ok ? '' : 'is-bad');
    });

    // ---------- email ----------
    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    }

    // If the user edits the email after getting a code, the old code/token no longer applies.
    emailInput.addEventListener('input', () => {
        if (verifiedEmail && emailInput.value.trim().toLowerCase() !== verifiedEmail) {
            verificationToken = null;
            verifiedEmail = null;
        }
    });

    // Only treat it as "email exists" when the backend says so about the EMAIL
    // (a taken username also returns 409 and must NOT redirect to login).
    function isEmailExistsResponse(res) {
        return res.status === 409 && /email/i.test(res.data.message || '');
    }

    function cancelSignupForExistingEmail() {
        locked = true;
        clearInterval(resendTimer);
        signupForm.querySelectorAll('input, button').forEach((el) => (el.disabled = true));
        emailInput.classList.add('is-invalid');
        emailHint.textContent = 'Email already exists — please login';
        emailHint.className = 'field-hint is-bad';
        showToast('Email already exists — redirecting to login…', 'error');
        setTimeout(() => {
            window.location.href = `login.html?email=${encodeURIComponent(emailInput.value.trim())}`;
        }, 1600);
    }

    // ---------- send OTP ----------
    function startResendCountdown(seconds) {
        let remaining = seconds;
        sendOtpBtn.disabled = true;
        sendOtpBtn.textContent = `Resend in ${remaining}s`;
        clearInterval(resendTimer);
        resendTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(resendTimer);
                if (!locked) {
                    sendOtpBtn.disabled = false;
                    sendOtpBtn.textContent = 'Resend code';
                }
                return;
            }
            sendOtpBtn.textContent = `Resend in ${remaining}s`;
        }, 1000);
    }

    sendOtpBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();

        if (!email || !isValidEmail(email)) {
            emailInput.classList.add('is-invalid');
            emailHint.textContent = 'Enter a valid email address first';
            emailHint.className = 'field-hint is-bad';
            return;
        }
        emailInput.classList.remove('is-invalid');
        emailInput.classList.add('is-valid');
        emailHint.textContent = '';

        const originalLabel = sendOtpBtn.textContent;
        sendOtpBtn.disabled = true;
        sendOtpBtn.textContent = 'Sending…';

        try {
            const res = await postJson('/otp/send', { email, purpose: 'signup' });

            if (isEmailExistsResponse(res)) {
                cancelSignupForExistingEmail();
                return;
            }

            if (res.data.success) {
                showToast('Verification code sent to your email', 'success');
                otpSent = true;
                verificationToken = null;   // new code => old token is void
                verifiedEmail = null;
                emailHint.textContent = 'Code sent — check your inbox (and spam)';
                emailHint.className = 'field-hint is-good';
                startResendCountdown(RESEND_SECONDS);
                otpInput.focus();
                window.setSealProgress && window.setSealProgress(0.4);
            } else if (res.status === 429) {
                showToast(res.data.message || 'Please wait before requesting a new code', 'error');
                startResendCountdown(res.data.retryAfter || RESEND_SECONDS);
            } else {
                showToast(res.data.message || 'Could not send code', 'error');
                sendOtpBtn.disabled = false;
                sendOtpBtn.textContent = originalLabel;
            }
        } catch (err) {
            console.error('Error sending OTP:', err);
            showToast('Server unreachable. Please try again.', 'error');
            sendOtpBtn.disabled = false;
            sendOtpBtn.textContent = originalLabel;
        }
    });

    // ---------- verify OTP, then create account ----------
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (locked) return;

        const name = nameInput.value.trim();
        const username = usernameInput.value.trim().toLowerCase();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;
        const otp = otpInput.value.trim();

        if (!name || !username || !email || !password || !confirmPassword || !otp) {
            showToast('Please fill in every field', 'error');
            return;
        }
        if (!USERNAME_RX.test(username)) {
            showToast('Username: 3–30 characters, letters, numbers, . and _', 'error');
            usernameInput.focus();
            return;
        }
        if (!isValidEmail(email)) {
            showToast('Enter a valid email address', 'error');
            return;
        }
        if (password.length < 8) {
            showToast('Password must be at least 8 characters', 'error');
            return;
        }
        if (scorePassword(password) < 2) {
            showToast('Choose a stronger password', 'error');
            return;
        }
        if (password !== confirmPassword) {
            showToast('Passwords do not match', 'error');
            confirmInput.focus();
            return;
        }
        if (!/^\d{6}$/.test(otp)) {
            showToast('Enter the 6-digit code from your email', 'error');
            return;
        }
        if (!otpSent) {
            showToast('Send yourself a verification code first', 'error');
            return;
        }

        const originalLabel = verifyOtpBtn.textContent;
        verifyOtpBtn.disabled = true;

        try {
            // ----- Step 1: verify the OTP (skipped if we already hold a valid token for this email) -----
            const cleanEmail = email.toLowerCase();
            if (!verificationToken || verifiedEmail !== cleanEmail) {
                verifyOtpBtn.textContent = 'Verifying…';
                const v = await postJson('/otp/verify', { email, otp, purpose: 'signup' });

                if (!v.data.success || !v.data.verificationToken) {
                    showToast(v.data.message || 'Invalid code', 'error');
                    return;
                }
                verificationToken = v.data.verificationToken;
                verifiedEmail = cleanEmail;
                window.setSealProgress && window.setSealProgress(0.75);
            }

            // ----- Step 2: create the account (saved to MongoDB by the backend) -----
            verifyOtpBtn.textContent = 'Creating account…';
            const s = await postJson('/auth/signup', { name, username, email, password, verificationToken });

            if (s.data.success) {
                markStepDone(step1);
                markStepDone(step2);
                stepCount.textContent = '2';
                document.getElementById('seal-core').classList.add('is-verified');
                window.setSealProgress && window.setSealProgress(1);
                showToast('Account created — please log in', 'success');
                locked = true;
                setTimeout(() => { window.location.href = 'login.html'; }, 1000);
                return;
            }

            if (isEmailExistsResponse(s)) {
                cancelSignupForExistingEmail();
                return;
            }
            if (s.status === 409) {
                // username taken — email is still verified, user only needs to pick another username
                usernameInput.classList.add('is-invalid');
                usernameHint.textContent = 'Username already taken — try another';
                usernameHint.className = 'field-hint is-bad';
                showToast('Username already taken', 'error');
                usernameInput.focus();
                return;
            }
            if (s.status === 403) {
                // verification expired — need a fresh code
                verificationToken = null;
                verifiedEmail = null;
                showToast(s.data.message || 'Verification expired. Please request a new code', 'error');
                return;
            }
            showToast(s.data.message || 'Could not create account', 'error');
        } catch (err) {
            console.error('Signup error:', err);
            showToast('Server unreachable. Please try again.', 'error');
        } finally {
            if (!locked) {
                verifyOtpBtn.disabled = false;
                verifyOtpBtn.textContent = originalLabel;
            }
        }
    });
}
