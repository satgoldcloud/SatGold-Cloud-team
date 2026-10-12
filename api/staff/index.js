import { randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { send,method } from '../_lib/http.js';
import { requireUser,requireSchoolRole } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabase.js';
import { getSchoolEntitlements,exceedsEntitlement } from '../_lib/entitlements.js';

const text=(value,max=120)=>typeof value==='string'?value.trim().slice(0,max):'';
const safe=(value)=>String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export default async(req,res)=>{
  if(!method(req,res,['GET','POST']))return;
  const auth=await requireUser(req);if(auth.error)return send(res,auth.status,{error:auth.error});
  const schoolId=String(req.query.schoolId||req.body?.schoolId||'');if(!/^[0-9a-f-]{36}$/i.test(schoolId))return send(res,400,{error:'A valid school ID is required.'});
  try{
    const membership=await requireSchoolRole(auth.user.id,schoolId);if(!membership)return send(res,403,{error:'You do not have access to this school.'});
    const admin=getSupabaseAdmin();
    if(req.method==='GET'){
      if(!['owner','admin','teacher','staff'].includes(membership.role))return send(res,403,{error:'You cannot view the staff register.'});
      let query=admin.from('staff_profiles').select('id,staff_number,first_name,last_name,job_title,staff_type,status,user_id').eq('school_id',schoolId).order('last_name').limit(500);
      if(membership.role==='teacher'||membership.role==='staff')query=query.eq('user_id',auth.user.id);
      const {data,error}=await query;if(error)throw error;return send(res,200,{staff:data||[]});
    }
    if(!['owner','admin'].includes(membership.role))return send(res,403,{error:'Only school administrators can create staff accounts.'});
    if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL)return send(res,503,{error:'Staff invitations require verified email delivery to be configured.'});
    const plan=await getSchoolEntitlements(admin,schoolId);if(!plan)return send(res,402,{error:'This school subscription is not active.'});
    const {count:staffCount,error:countError}=await admin.from('staff_profiles').select('id',{count:'exact',head:true}).eq('school_id',schoolId);
    if(countError)throw countError;if(exceedsEntitlement(plan.entitlements,'staff',staffCount||0))return send(res,402,{error:'This school has reached its staff limit for this plan.'});
    const firstName=text(req.body?.firstName,80),lastName=text(req.body?.lastName,80),jobTitle=text(req.body?.jobTitle,100)||null;
    const email=text(req.body?.email,254).toLowerCase(),staffType=req.body?.staffType==='non_teaching'?'non_teaching':'teaching';
    if(firstName.length<1||lastName.length<1||!/^\S+@\S+\.\S+$/.test(email))return send(res,400,{error:'Enter staff first name, last name and a valid email address.'});
    const {data:school,error:schoolError}=await admin.from('schools').select('name').eq('id',schoolId).single();if(schoolError)throw schoolError;
    const tempPassword=`${randomBytes(24).toString('base64url')}A9!`;
    let userId,staffId;
    try{
      const {data:account,error:accountError}=await admin.auth.admin.generateLink({type:'signup',email,password:tempPassword,options:{data:{display_name:`${firstName} ${lastName}`,must_change_password:true,account_type:staffType==='teaching'?'teacher':'staff'},redirectTo:`${process.env.APP_URL||'http://localhost:3000'}/dashboard.html`}});
      if(accountError)throw accountError;userId=account.user.id;
      const staffNumber=`ST-${randomBytes(4).toString('hex').toUpperCase()}`;
      const {data:staff,error:staffError}=await admin.from('staff_profiles').insert({school_id:schoolId,user_id:userId,staff_number:staffNumber,first_name:firstName,last_name:lastName,job_title:jobTitle,staff_type:staffType,status:'active'}).select('id,staff_number,first_name,last_name,staff_type').single();
      if(staffError)throw staffError;staffId=staff.id;
      const {error:memberError}=await admin.from('school_memberships').insert({school_id:schoolId,user_id:userId,role:staffType==='teaching'?'teacher':'staff',status:'active'});
      if(memberError)throw memberError;
      const resend=new Resend(process.env.RESEND_API_KEY);
      const sent=await resend.emails.send({from:`${process.env.RESEND_FROM_NAME||'SatGold Cloud'} <${process.env.RESEND_FROM_EMAIL}>`,to:[email],subject:`Your ${safe(school.name)} SatGold Cloud account`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17324d"><h1>Welcome to ${safe(school.name)}</h1><p>Hello ${safe(firstName)}, your staff account is ready. Activate it and choose a new password before signing in.</p><p><a href="${safe(account.properties.action_link)}" style="display:inline-block;background:#17324d;color:#fff;padding:13px 20px;border-radius:5px;text-decoration:none">Activate staff account</a></p><p>Your staff number is ${safe(staffNumber)}.</p></div>`});
      if(sent.error)throw sent.error;
      await admin.from('audit_logs').insert({school_id:schoolId,actor_id:auth.user.id,action:'staff.account_invited',entity_type:'staff',entity_id:staffId,metadata:{staff_number:staffNumber,staff_type:staffType}});
      return send(res,201,{staff,message:'Staff account invitation sent.'});
    }catch(error){if(staffId)await admin.from('staff_profiles').delete().eq('id',staffId);if(userId)await admin.auth.admin.deleteUser(userId);if(/already registered|already been registered|duplicate key/i.test(error.message||''))return send(res,409,{error:'A staff account or staff number already exists. Review the staff register.'});console.error('Staff provisioning failed:',error.message||error);return send(res,500,{error:'Staff account could not be provisioned.'});}
  }catch(error){console.error('Staff endpoint failed:',error.message||error);return send(res,500,{error:'Could not complete the staff request.'});}
};
