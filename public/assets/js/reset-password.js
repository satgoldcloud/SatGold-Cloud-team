import { getClient } from './client.js';

const form = document.querySelector('#reset-form');
const notice = document.querySelector('#form-notice');
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = form.password.value;
  if (password.length < 10) { notice.textContent = 'Use at least 10 characters.'; notice.className = 'form-notice is-error'; return; }
  try {
    const client = await getClient();
    const { error } = await client.auth.updateUser({ password, data: { must_change_password: false } });
    if (error) throw error;
    notice.textContent = 'Password updated. You can now sign in.';
    notice.className = 'form-notice is-success';
    form.reset();
    if (new URLSearchParams(location.search).has('required')) location.assign('/dashboard.html');
  } catch (error) { notice.textContent = error.message || 'The password could not be updated.'; notice.className = 'form-notice is-error'; }
});
