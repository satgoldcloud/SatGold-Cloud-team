const form = document.querySelector('#register-form');
const notice = document.querySelector('#form-notice');
form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  notice.textContent = 'Creating your school account…';
  notice.className = 'form-notice';
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Registration could not be completed.');
    form.reset();
    notice.textContent = result.message;
    notice.className = 'form-notice is-success';
  } catch (error) {
    notice.textContent = error.message || 'Registration could not be completed.';
    notice.className = 'form-notice is-error';
  } finally { button.disabled = false; }
});
