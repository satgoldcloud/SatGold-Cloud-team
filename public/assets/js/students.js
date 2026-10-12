import { getClient, api } from './client.js';

const form = document.querySelector('#student-form');
const pageStatus = document.querySelector('#page-status');
const formNotice = document.querySelector('#form-notice');
const schoolSelect = document.querySelector('#school-id');
const classSelect = document.querySelector('#class-id');
const armSelect = document.querySelector('#class-arm-id');
const studentList = document.querySelector('#student-list');
let schoolRows = [];

function option(value, label) { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; }
async function loadClasses() {
  classSelect.replaceChildren(option('', 'Choose a class'));
  armSelect.replaceChildren(option('', 'No arm'));
  if (!schoolSelect.value) return;
  const { classes } = await api(`/api/schools/classes?schoolId=${encodeURIComponent(schoolSelect.value)}`);
  classes.forEach((row) => classSelect.append(option(row.id, row.name)));
  classSelect._classes = classes;
}
async function loadStudents() {
  if (!schoolSelect.value) return;
  const { students } = await api(`/api/students?schoolId=${encodeURIComponent(schoolSelect.value)}`);
  studentList.replaceChildren();
  if (!students.length) { studentList.innerHTML = '<p class="empty-state">No students have been added yet.</p>'; return; }
  const list = document.createElement('div'); list.className = 'student-cards';
  students.forEach((student) => {
    const card = document.createElement('article'); card.className = 'school-card';
    const name = document.createElement('h3'); name.textContent = `${student.first_name} ${student.last_name}`;
    const number = document.createElement('p'); number.textContent = student.student_number;
    const status = document.createElement('small'); status.textContent = student.status;
    card.append(name, number, status); list.append(card);
  });
  studentList.append(list);
}

schoolSelect.addEventListener('change', async () => {
  try { await loadClasses(); await loadStudents(); } catch (error) { pageStatus.textContent = error.message; }
});
classSelect.addEventListener('change', () => {
  armSelect.replaceChildren(option('', 'No arm'));
  const selected = classSelect._classes?.find((row) => row.id === classSelect.value);
  selected?.class_arms?.forEach((arm) => armSelect.append(option(arm.id, arm.name)));
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  formNotice.textContent = 'Creating accounts and sending guardian instructions...'; formNotice.className = 'form-notice';
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const { student, message } = await api('/api/students', { method: 'POST', body: JSON.stringify(payload) });
    form.reset(); await loadClasses(); await loadStudents();
    formNotice.textContent = `${message} Student login: ${student.loginIdentifier}`; formNotice.className = 'form-notice is-success';
  } catch (error) { formNotice.textContent = error.message; formNotice.className = 'form-notice is-error'; }
  finally { button.disabled = false; }
});

document.querySelector('#sign-out')?.addEventListener('click', async () => { const client = await getClient(); await client.auth.signOut(); location.assign('/login.html'); });

async function init() {
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) { location.replace('/login.html'); return; }
    if (session.user?.user_metadata?.must_change_password) { location.replace('/reset-password.html?required=1'); return; }
    const data = await api('/api/me');
    schoolRows = data.schools.filter(({ role }) => ['owner','admin'].includes(role));
    if (!schoolRows.length) { pageStatus.textContent = 'Student administration is available to school owners and administrators.'; form.hidden = true; return; }
    schoolRows.forEach(({ school }) => schoolSelect.append(option(school.id, school.name)));
    pageStatus.textContent = 'Create student records and securely link parent or guardian accounts.';
    await loadClasses(); await loadStudents();
  } catch (error) { pageStatus.textContent = error.message || 'Could not load student administration.'; }
}
init();
