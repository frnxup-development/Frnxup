import { cors, json, adminClient, hmac, randomTicket } from "../_shared/signup.ts";
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed."},405);
  try {
    const body=await req.json();
    const id=String(body?.challenge_id||"");
    const emailCode=String(body?.email_code||"").trim();
    const phoneCode=String(body?.phone_code||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(id)||!/^\d{6}$/.test(emailCode)||!/^\d{6}$/.test(phoneCode))
      return json({error:"Enter both six-digit verification codes."},400);
    const admin=adminClient();
    const ticket=randomTicket();
    const [emailHash,phoneHash,ticketHash]=await Promise.all([
      hmac(`email:${id}:${emailCode}`),hmac(`phone:${id}:${phoneCode}`),hmac(`ticket:${ticket}`)
    ]);
    const now=new Date();
    const {data:result,error}=await admin.rpc("frnxup_verify_signup_codes",{
      p_challenge_id:id,
      p_email_hash:emailHash,
      p_phone_hash:phoneHash,
      p_ticket_hash:ticketHash,
      p_now:now.toISOString(),
      p_ticket_expires_at:new Date(now.getTime()+10*60*1000).toISOString()
    });
    if(error) throw error;
    if(result==="expired") return json({error:"Your verification codes have expired. Request new codes."},410);
    if(result==="too_many") return json({error:"Too many incorrect attempts. Request new verification codes."},429);
    if(result==="already_verified") return json({error:"These codes have already been used. Continue to password setup or start registration again."},409);
    if(result!=="verified") return json({error:"One or both codes are incorrect. Check both messages and try again."},400);
    return json({ok:true,registration_ticket:ticket,expires_in_seconds:600});
  } catch(error) {
    console.error("signup-verify error",error);
    return json({error:"Frnxup could not verify your codes. Please try again."},500);
  }
});
