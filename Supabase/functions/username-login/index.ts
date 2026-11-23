import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function readServiceKey(): string {
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim();}catch{}}
  return Deno.env.get('SUPABASE_SECRET_KEY')?.trim()||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()||'';
}
const bannedMessage="This account is banned from using Frnxup, contact Frnxup support at frnxup@gmail.com.";
const suspendedMessage="This account has been suspended by Frnxup administrators. Submit an appeal at /Auth/appeal.html or contact Frnxup support at frnxup@gmail.com.";
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers:cors});
  try{
    const {username,password}=await req.json();
    if(typeof username!=='string'||typeof password!=='string'||password.length<8)
      return Response.json({error:'Enter a valid username and password.'},{status:400,headers:cors});
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=readServiceKey();
    if(!service)throw new Error('The username sign-in service is not configured.');
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const key=username.replace(/^@/,'').toLowerCase();
    const {data:p,error:pe}=await admin.from('profiles').select('id,account_status').ilike('username',key).maybeSingle();
    if(pe)throw pe;
    if(!p)return Response.json({error:'Invalid username or password.'},{status:401,headers:cors});
    const {data:u,error:ue}=await admin.auth.admin.getUserById(p.id);
    if(ue||!u.user)return Response.json({error:'Invalid username or password.'},{status:401,headers:cors});
    const login=u.user.email?{email:u.user.email}:u.user.phone?{phone:u.user.phone}:null;
    if(!login)return Response.json({error:'This account has no verified login method.'},{status:400,headers:cors});
    const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.signInWithPassword({...login,password});
    if(error||!data.session)return Response.json({error:'Invalid username or password.'},{status:401,headers:cors});
    // Double-check status immediately before returning the session. Admin actions
    // may have changed the state between the initial lookup and password check.
    const {data:latest,error:latestError}=await admin.from('profiles').select('account_status').eq('id',p.id).maybeSingle();
    if(latestError||latest?.account_status!=='active'){
      await client.auth.signOut();
      const status=latest?.account_status;
      return Response.json({error:status==='banned'?bannedMessage:status==='suspended'?suspendedMessage:'This account is not active. Contact Frnxup support at frnxup@gmail.com.',account_status:status||'inactive'},{status:403,headers:cors});
    }
    return Response.json({access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_in:data.session.expires_in,token_type:'bearer'},{headers:cors});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Unable to process sign-in.'},{status:400,headers:cors});
  }
});
