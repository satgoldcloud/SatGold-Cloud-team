import {createHmac} from 'node:crypto';
import {Resend} from 'resend';
import {send,method} from './_lib/http.js';
import {getSupabaseAdmin} from './_lib/supabase.js';
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const escape=(value)=>String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export default async(req,res)=>{
  if(!method(req,res,['POST']))return;
  if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL||!process.env.CONTACT_TO_EMAIL||!process.env.CONTACT_RATE_LIMIT_SALT)return send(res,503,{error:'Contact delivery is not configured yet.'});
  const name=clean(req.body?.name,120),email=clean(req.body?.email,254).toLowerCase(),school=clean(req.body?.school,120),message=clean(req.body?.message,3000),honeypot=clean(req.body?.company,120);
  if(honeypot)return send(res,200,{message:'Thank you. Your message was sent.'});
  if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||message.length<10)return send(res,400,{error:'Enter your name, a valid email and a message of at least 10 characters.'});
  try{
    const chain=String(req.headers['x-forwarded-for']||'').split(',').map((item)=>item.trim()).filter(Boolean);const forwarded=String(req.headers['x-real-ip']||chain.at(-1)||'unknown');
    const ipHash=createHmac('sha256',process.env.CONTACT_RATE_LIMIT_SALT).update(forwarded).digest('hex');
    const admin=getSupabaseAdmin();const {data:allowed,error:limitError}=await admin.rpc('consume_public_contact_request',{target_ip_hash:ipHash});
    if(limitError)throw limitError;if(!allowed)return send(res,429,{error:'Too many messages were sent from this connection. Try again later.'});
    const resend=new Resend(process.env.RESEND_API_KEY);const result=await resend.emails.send({from:`${process.env.RESEND_FROM_NAME||'SatGold Cloud'} <${process.env.RESEND_FROM_EMAIL}>`,to:[process.env.CONTACT_TO_EMAIL],replyTo:email,subject:`SatGold Cloud enquiry from ${name}`,text:`Name: ${name}\nEmail: ${email}\nSchool: ${school||'Not provided'}\n\n${message}`,html:`<div style="font-family:Arial,sans-serif;color:#17324d"><h2>New SatGold Cloud enquiry</h2><p><b>Name:</b> ${escape(name)}</p><p><b>Email:</b> ${escape(email)}</p><p><b>School:</b> ${escape(school||'Not provided')}</p><p>${escape(message).replace(/\n/g,'<br>')}</p></div>`});
    if(result.error)throw result.error;return send(res,200,{message:'Thank you. Your message was sent.'});
  }catch(error){console.error('Contact request failed:',error.message||error);return send(res,502,{error:'Your message could not be delivered. Please try again later.'});}
};

