import { getClient } from './client.js';

const form = document.querySelector('#login-form');
const notice = document.querySelector('#form-notice');
getClient().then(async (client) => {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return;
  location.replace(session.user?.user_metadata?.must_change_password ? '/reset-password.html?required=1' : '/dashboard.html');
}).catch(() => {});
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  notice.textContent = 'Signing in…';
  notice.className = 'form-notice';
  try {
    const client = await getClient();
    const { data, error } = await client.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) throw error;
    if (data.user?.user_metadata?.must_change_password) { location.assign('/reset-password.html?required=1'); return; }
    location.assign('/dashboard.html');
  } catch (error) {
    notice.textContent = error.message || 'Sign in failed. Check your details and try again.';
    notice.className = 'form-notice is-error';
  } finally { button.disabled = false; }
});

document.querySelector('#forgot-password')?.addEventListener('click', async (event) => {
  event.preventDefault();
  const email = form.email.value.trim();
  if (!email) { notice.textContent = 'Enter your email address first.'; notice.className = 'form-notice is-error'; return; }
  try {
    const client = await getClient();
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password.html` });
    if (error) throw error;
    notice.textContent = 'If an account exists for this email, a recovery link will arrive shortly.';
    notice.className = 'form-notice is-success';
  } catch (error) { notice.textContent = error.message; notice.className = 'form-notice is-error'; }
});
