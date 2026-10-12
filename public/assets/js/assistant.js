import { getClient, api } from './client.js';

const schoolSelect=document.querySelector('#school-id');
const status=document.querySelector('#assistant-status');
const notice=document.querySelector('#assistant-notice');
const output=document.querySelector('#assistant-output');
const outputText=document.querySelector('#assistant-text');
function addOption(value,label){const item=document.createElement('option');item.value=value;item.textContent=label;schoolSelect.append(item);}
document.querySelector('#assistant-form').addEventListener('submit',async(event)=>{
  event.preventDefault(); const button=event.currentTarget.querySelector('button[type="submit"]'); button.disabled=true;
  notice.textContent='Preparing your draft...'; notice.className='form-notice'; output.hidden=true;
  try{const result=await api('/api/ai/assist',{method:'POST',body:JSON.stringify({schoolId:schoolSelect.value,prompt:document.querySelector('#prompt').value})});outputText.textContent=result.text;output.hidden=false;notice.textContent=`Request complete. ${result.requestsUsed} requests used this month.`;notice.className='form-notice is-success';}
  catch(error){notice.textContent=error.message;notice.className='form-notice is-error';}finally{button.disabled=false;}
});
document.querySelector('#sign-out')?.addEventListener('click',async()=>{const client=await getClient();await client.auth.signOut();location.assign('/login.html');});
async function init(){try{const client=await getClient();const {data:{session}}=await client.auth.getSession();if(!session){location.replace('/login.html');return;}if(session.user?.user_metadata?.must_change_password){location.replace('/reset-password.html?required=1');return;}const me=await api('/api/me');const profileAllows=['super_admin'].includes(me.profile?.platform_role);const schools=me.schools.filter(({role})=>['owner','admin','teacher','staff'].includes(role));if(!schools.length&&!profileAllows){status.textContent='The assistant is available to authorized school staff only.';document.querySelector('#assistant-form').hidden=true;return;}schools.forEach(({school})=>addOption(school.id,school.name));if(!schools.length){status.textContent='Choose an authorized school context to continue.';document.querySelector('#assistant-form').hidden=true;return;}status.textContent='Create a lesson, activity, assessment or school communication draft.';}catch(error){status.textContent=error.message||'Could not check assistant access.';}}
init();
