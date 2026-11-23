import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt) return json({error:"Sign in required"},401);
  try {
    const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key) return json({error:"Server is not configured"},503);
    const admin=createClient(url,key,{auth:{persistSession:false}});
    const {data,error}=await admin.auth.getUser(jwt);
    if(error||!data.user) return json({error:"Session expired. Sign in again."},401);
    const {data:assurance,error:assuranceError}=await admin.auth.mfa.getAuthenticatorAssuranceLevel(jwt);
    if(assuranceError) return json({error:"Your second-factor status could not be verified. Sign in again and complete phone verification."},401);
    if(assurance?.nextLevel==="aal2"&&assurance?.currentLevel!=="aal2") return json({error:"Complete your phone or authenticator verification before deleting your Frnxup account."},403);
    const last=data.user.last_sign_in_at?new Date(data.user.last_sign_in_at).getTime():0;
    if(Date.now()-last>30*60*1000) return json({error:"For security, sign in again before deleting your account."},403);
    const {error:deleteError}=await admin.auth.admin.deleteUser(data.user.id);
    if(deleteError) throw deleteError;
    return json({ok:true});
  } catch(error) {
    return json({error:error instanceof Error?error.message:"Unable to delete this account."},400);
  }
});
