import { getClient, api } from './client.js';

const status = document.querySelector('#dashboard-status');
const schools = document.querySelector('#school-list');
async function init() {
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) { location.replace('/login.html'); return; }
    if (session.user?.user_metadata?.must_change_password) { location.replace('/reset-password.html?required=1'); return; }
    const data = await api('/api/me');
    const displayName = data.profile?.display_name || session.user.email;
    document.querySelector('#user-name').textContent = displayName;
    document.querySelector('#user-name-title').textContent = displayName;
    const toolsLink = document.createElement('a'); toolsLink.className = 'button'; toolsLink.href = '/portal-tools.html'; toolsLink.textContent = 'School tools';
    document.querySelector('.workspace-actions')?.prepend(toolsLink);
    const platformAdminLink = document.querySelector('#platform-admin-link');
    if (platformAdminLink && data.profile?.platform_role === 'super_admin') platformAdminLink.hidden = false;
    schools.replaceChildren();
    if (!data.schools.length) {
      schools.innerHTML = '<p class="empty-state">You do not have a school workspace yet.</p>';
    } else {
      data.schools.forEach(({ school, role }) => {
        const card = document.createElement('article');
        card.className = 'school-card';
        const name = document.createElement('h3'); name.textContent = school.name;
        const meta = document.createElement('p'); meta.textContent = `${role} · ${school.status}`;
        const slug = document.createElement('small'); slug.textContent = `School page: /schools/${school.slug}`;
        card.append(name, meta, slug); schools.append(card);
      });
      const canManageStudents = data.schools.some(({ role }) => ['owner','admin'].includes(role));
      const manageStudents = document.querySelector('#manage-students');
      if (manageStudents && canManageStudents) manageStudents.hidden = false;
      const setupLink = document.querySelector('#setup-link');
      if (setupLink && canManageStudents) setupLink.hidden = false;
      if (canManageStudents) { const pageLink = document.createElement('a'); pageLink.className = 'button'; pageLink.href = '/school-page.html'; pageLink.textContent = 'School public page'; document.querySelector('.workspace-actions')?.append(pageLink); }
      const billingLink = document.querySelector('#billing-link');
      if (billingLink && canManageStudents) billingLink.hidden = false;
      const assistantLink = document.querySelector('#assistant-link');
      if (assistantLink && data.schools.some(({ role }) => ['owner','admin','teacher','staff'].includes(role))) assistantLink.hidden = false;
    }
    status.textContent = 'Your secure school workspace is ready.';
  } catch (error) { status.textContent = error.message || 'Could not load your workspace.'; }
}

document.querySelector('#sign-out')?.addEventListener('click', async () => {
  const client = await getClient(); await client.auth.signOut(); location.assign('/login.html');
});
init();
