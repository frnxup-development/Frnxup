import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"86400"};
export const json = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
export function readServiceKey(): string { const raw=Deno.env.get("SUPABASE_SECRET_KEYS"); if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==="string"&&parsed.default.trim())return parsed.default.trim();}catch{}} return Deno.env.get("SUPABASE_SECRET_KEY")?.trim()||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()||""; }
export function adminClient(){const url=Deno.env.get("SUPABASE_URL")||"";const key=readServiceKey();if(!url||!key)throw new Error("Frnxup server configuration is incomplete.");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function sha256(value:string):Promise<string>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");}
export async function hmac(value:string):Promise<string>{const pepper=Deno.env.get("FRNXUP_OTP_PEPPER");if(!pepper||pepper.length<32)throw new Error("Frnxup OTP signing secret is not configured.");const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pepper),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));return Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,"0")).join("");}
export function randomDigits():string{const max=0xffffffff;const limit=max-(max%1000000);let n:number;do{const b=new Uint32Array(1);crypto.getRandomValues(b);n=b[0];}while(n>=limit);return String(n%1000000).padStart(6,"0");}
export function randomTicket():string{const b=new Uint8Array(32);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
export function normalizeText(value:unknown,max=254):string{return String(value??"").trim().slice(0,max);}
export async function registrationEnabled(admin:any):Promise<boolean>{const {data,error}=await admin.from("site_settings").select("key,value").in("key",["registration_enabled","maintenance_mode"]);if(error)throw error;const s=Object.fromEntries((data||[]).map((x:any)=>[x.key,x.value]));return s.registration_enabled!==false && s.maintenance_mode!==true;}
export async function sendEmailOtp(email:string,code:string){const api=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("RESEND_FROM");if(!api||!from)throw new Error("Email OTP delivery is not configured. Set RESEND_API_KEY and RESEND_FROM.");const html=`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#162b38"><div style="font-size:24px;font-weight:800;color:#138f8b">Frnxup</div><h2>Verify your email address</h2><p>Use this 6-digit code to continue creating your Frnxup account:</p><div style="font-size:34px;letter-spacing:8px;font-weight:800;padding:18px;background:#f0f7f8;border-radius:12px;text-align:center">${code}</div><p>This code expires in 10 minutes. Never share it with anyone, including Frnxup staff.</p><p style="color:#71858e;font-size:12px">If you did not request this, you can ignore this email.</p></div>`;const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${api}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Your Frnxup email verification code",html})});if(!response.ok){const detail=await response.text();console.error("Resend delivery failed",response.status,detail.slice(0,400));throw new Error("Email OTP could not be delivered.");}}
export async function sendPhoneOtp(phone:string,code:string):Promise<string>{
  const sid=Deno.env.get("TWILIO_ACCOUNT_SID"),token=Deno.env.get("TWILIO_AUTH_TOKEN");
  const whatsappFrom=Deno.env.get("TWILIO_WHATSAPP_FROM"),whatsappTemplate=Deno.env.get("TWILIO_WHATSAPP_CONTENT_SID");
  const smsFrom=Deno.env.get("TWILIO_PHONE_NUMBER");
  const useWhatsApp=!!whatsappFrom&&!!whatsappTemplate;
  if(!sid||!token||(!useWhatsApp&&!smsFrom))throw new Error("Phone OTP delivery is not configured. Set Twilio credentials and an SMS sender, or an approved WhatsApp template sender.");
  const params=new URLSearchParams();
  if(useWhatsApp){
    params.set("To",`whatsapp:${phone}`);
    params.set("From",whatsappFrom!.startsWith("whatsapp:")?whatsappFrom!:`whatsapp:${whatsappFrom}`);
    params.set("ContentSid",whatsappTemplate!);
    params.set("ContentVariables",JSON.stringify({"1":code}));
  } else {
    params.set("To",phone);params.set("From",smsFrom!);
    params.set("Body",`Your Frnxup phone verification code is ${code}. It expires in 10 minutes. Do not share this code.`);
  }
  const auth=btoa(`${sid}:${token}`);
  const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:"POST",headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/x-www-form-urlencoded"},body:params.toString()});
  if(!response.ok){const detail=await response.text();console.error("Twilio delivery failed",response.status,detail.slice(0,400));throw new Error("Phone OTP could not be delivered.");}
  return useWhatsApp?"WhatsApp":"SMS";
}
export function phoneMask(phone:string):string{return phone.length>6?phone.slice(0,4)+"••••"+phone.slice(-2):"your phone";}
