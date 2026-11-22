import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// This function must run in the same Supabase project as js/config.js.
const FRNXUP_PROJECT_REF = "jsjlcunuvkizbeeoewsk";
const FRNXUP_PROJECT_URL = `https://${FRNXUP_PROJECT_REF}.supabase.co`;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});

function readProjectSecret(): { key: string | null; source: string } {
  // Current Supabase Edge Functions expose named secret keys as a JSON map.
  // Keep legacy fallbacks for projects that have not migrated their key setup.
  const rawMap = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap);
      if (typeof parsed?.default === 'string' && parsed.default.trim()) {
        return { key: parsed.default.trim(), source: 'SUPABASE_SECRET_KEYS.default' };
      }
    } catch (_) {
      // A malformed map is diagnosed below if no legacy key is available.
    }
  }
  const singular = Deno.env.get('SUPABASE_SECRET_KEY')?.trim();
  if (singular) return { key: singular, source: 'SUPABASE_SECRET_KEY' };
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy) return { key: legacy, source: 'SUPABASE_SERVICE_ROLE_KEY' };
  return { key: null, source: rawMap ? 'SUPABASE_SECRET_KEYS (missing default)' : 'not configured' };
}

function getProjectRef(value: string | null): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.endsWith('.supabase.co') ? host.slice(0, -'.supabase.co'.length) : null;
  } catch (_) { return null; }
}

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return json({error:'Authorization required'},401);
 let actionName='unknown';
 try{
  const configuredUrl = Deno.env.get('SUPABASE_URL') || '';
  const configuredProjectRef = getProjectRef(configuredUrl);
  const deploymentId = Deno.env.get('DENO_DEPLOYMENT_ID') || '';
  const deployedProjectRef = deploymentId ? deploymentId.split('_')[0] : null;
  if (configuredProjectRef !== FRNXUP_PROJECT_REF || (deployedProjectRef && deployedProjectRef !== FRNXUP_PROJECT_REF)) {
    return json({
      error: 'The admin-control function is not running in the Frnxup Supabase project. Deploy it to project jsjlcunuvkizbeeoewsk.',
      code: 'SUPABASE_PROJECT_MISMATCH',
      expected_project_ref: FRNXUP_PROJECT_REF,
      configured_project_ref: configuredProjectRef,
      deployed_project_ref: deployedProjectRef
    }, 500);
  }

  const secret = readProjectSecret();
  if (!secret.key) {
    return json({
      error: 'The Frnxup Edge Function has no usable project secret key. Configure the project secret key named default, or retain the legacy service-role key.',
      code: 'SUPABASE_SECRET_KEY_MISSING',
      project_ref: FRNXUP_PROJECT_REF,
      checked_key_source: secret.source
    }, 500);
  }

  // Use the verified Frnxup URL rather than an unchecked environment URL.
  const admin=createClient(FRNXUP_PROJECT_URL,secret.key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await admin.auth.getUser(token);
  if(authError||!authData.user) {
    return json({
      error: 'The Frnxup session could not be verified by the admin-control function. Confirm the deployed project secret key belongs to jsjlcunuvkizbeeoewsk and sign in again.',
      code: 'ADMIN_AUTH_VALIDATION_FAILED',
      project_ref: FRNXUP_PROJECT_REF,
      auth_error: authError?.message || 'No authenticated user was returned.'
    }, 401);
  }
  const actor=authData.user.id;
  const {data:actorProfile,error:roleError}=await admin.from('profiles').select('id,role,account_status').eq('id',actor).maybeSingle();
  if(roleError) return json({
    error: 'The Frnxup Auth account was verified, but reading its public.profiles row failed. Check the database error details below.',
    code: 'ADMIN_PROFILE_LOOKUP_FAILED',
    project_ref: FRNXUP_PROJECT_REF,
    auth_user_id: actor,
    database_error: { code: roleError.code || null, message: roleError.message || null, details: roleError.details || null, hint: roleError.hint || null }
  }, 502);
  if(!actorProfile)return json({error:'No Frnxup profile is linked to this signed-in Auth account. The owner profile recovery SQL must be run in the same Supabase project.',code:'ADMIN_PROFILE_NOT_FOUND',project_ref:FRNXUP_PROJECT_REF,auth_user_id:actor},403);
  const actorRole=String(actorProfile.role||'').trim().toLowerCase();
  const actorStatus=String(actorProfile.account_status||'').trim().toLowerCase();
  if(actorStatus!=='active')return json({error:'This Frnxup account is not active. Reactivate it before granting administrator access.',code:'ADMIN_ACCOUNT_INACTIVE'},403);
  if(!['owner','admin','moderator'].includes(actorRole))return json({error:`Administrator permission required. The signed-in profile currently has the “${actorRole||'not set'}” role. Only the platform owner can authorize administrator access.`,code:'ADMIN_ROLE_REQUIRED'},403);
  // Normalize values once so every permission branch below uses the same role value.
  actorProfile.role=actorRole;
  const owner=actorRole==='owner',adminRole=actorRole==='admin';const canManage=owner||adminRole;const canModerate=canManage||actorRole==='moderator';
  const body=await req.json();const action=String(body.action||'');actionName=action||'unknown';
  const log=async(a:string,t:string|null=null,id:string|null=null,details:any={})=>{const {error}=await admin.from('admin_audit_logs').insert({actor_id:actor,action:a,target_type:t,target_id:id,details});if(error)throw error};
  const toHex=(bytes:Uint8Array)=>Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('');
  const fromHex=(hex:string)=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));
  const randomHex=(length:number)=>{const bytes=new Uint8Array(length);crypto.getRandomValues(bytes);return toHex(bytes)};
  const hashPassword=async(password:string,saltHex:string)=>{
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromHex(saltHex),iterations:310000,hash:'SHA-256'},key,256);
    return toHex(new Uint8Array(bits));
  };
  const hashToken=async(token:string)=>toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));
  const generateStaffId=async()=>{
    for(let i=0;i<12;i++){
      const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
      const id=String(1000000000+(bytes[0]%9000000000)).padStart(10,'0');
      const {data}=await admin.from('admin_staff_accounts').select('staff_id').eq('staff_id',id).maybeSingle();
      if(!data)return id;
    }
    throw new Error('Could not generate a unique staff ID. Please try again.');
  };
  const issueStaffSession=async()=>{
    const raw=randomHex(32),token=raw;
    const tokenHash=await hashToken(token);
    const expiresAt=new Date(Date.now()+8*60*60*1000).toISOString();
    const {error}=await admin.from('admin_staff_sessions').insert({user_id:actor,token_hash:tokenHash,expires_at:expiresAt});
    if(error)throw error;
    return {staff_session_token:token,staff_session_expires_at:expiresAt};
  };
  const checkStaffSession=async(token:string)=>{
    if(!token)return false;
    const tokenHash=await hashToken(token);
    const {data,error}=await admin.from('admin_staff_sessions').select('id,user_id,expires_at').eq('token_hash',tokenHash).eq('user_id',actor).gt('expires_at',new Date().toISOString()).maybeSingle();
    return !error&&!!data;
  };
  const publicActions=new Set(['verify_access','staff_login','staff_logout','complete_staff_registration']);
  // The platform owner is the bootstrap authority and is not enrolled in the
  // appointed-staff credential flow. Only appointed admins/moderators require
  // a separate staff session. This is enforced server-side for every action.
  if(!owner&&!publicActions.has(action)){
    const valid=await checkStaffSession(String(body.staff_session_token||''));
    if(!valid)throw new Error('Your separate Frnxup staff session has expired. Sign in again with your 10-digit staff ID and staff password.');
  }
  const count=async(table:string,filters?:[string,string,any][])=>{let q=admin.from(table).select('*',{count:'exact',head:true});for(const [c,op,v] of filters||[])q=q.filter(c,op,v);const {count}=await q;return count||0};
  let result:any={};
  switch(action){
   case 'verify_access':{
    // Owner access is inherited from the verified Frnxup owner role. Do not
    // create, require, or inspect a separate staff account for the owner.
    let staff:any=null;
    if(!owner){const {data,error}=await admin.from('admin_staff_accounts').select('staff_id,status,role').eq('user_id',actor).maybeSingle();if(error)throw error;staff=data;}
    const staffSessionValid=owner?true:await checkStaffSession(String(body.staff_session_token||''));
    result={ok:true,project_ref:FRNXUP_PROJECT_REF,user_id:actor,role:actorRole,account_status:actorStatus,staff_id:staff?.staff_id||null,staff_status:owner?'not_required':(staff?.status||'not_registered'),staff_session_valid:!!staffSessionValid,staff_registration_required:!owner&&(!staff||staff.status!=='active')};break;
   }
   case 'staff_logout':{
    const token=String(body.staff_session_token||'');if(token){const {error}=await admin.from('admin_staff_sessions').delete().eq('user_id',actor).eq('token_hash',await hashToken(token));if(error)throw error;}
    result={ok:true};break;
   }
   case 'staff_login':{
    if(owner)throw new Error('The platform owner does not use appointed-staff credentials. Sign in with the verified Frnxup owner account.');
    const staffId=String(body.staff_id||'').trim();const password=String(body.staff_password||'');
    if(!/^\d{10}$/.test(staffId)||password.length<10)throw new Error('Enter your 10-digit staff ID and staff password.');
    const {data:attempt}=await admin.from('admin_staff_login_attempts').select('failed_attempts,locked_until').eq('user_id',actor).maybeSingle();
    if(attempt?.locked_until&&new Date(attempt.locked_until).getTime()>Date.now())throw new Error('Staff sign-in is temporarily locked after repeated failed attempts. Try again after 15 minutes.');
    const {data:staff,error}=await admin.from('admin_staff_accounts').select('staff_id,user_id,role,status,password_salt,password_hash').eq('staff_id',staffId).eq('user_id',actor).maybeSingle();
    if(error)throw error;
    let valid=false;if(staff&&staff.status==='active'&&staff.password_hash&&staff.password_salt){const supplied=await hashPassword(password,staff.password_salt);valid=supplied===staff.password_hash;}
    if(!valid){const priorFailures=attempt?.locked_until&&new Date(attempt.locked_until).getTime()<=Date.now()?0:(attempt?.failed_attempts||0);const failures=priorFailures+1;const lockedUntil=failures>=5?new Date(Date.now()+15*60*1000).toISOString():null;const {error:attemptError}=await admin.from('admin_staff_login_attempts').upsert({user_id:actor,failed_attempts:failures,locked_until:lockedUntil,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(attemptError)throw attemptError;throw new Error(failures>=5?'Too many failed staff sign-in attempts. Try again in 15 minutes.':'Staff ID or password is incorrect.');}
    const {error:resetError}=await admin.from('admin_staff_login_attempts').delete().eq('user_id',actor);if(resetError)throw resetError;
    const {error:cleanupError}=await admin.from('admin_staff_sessions').delete().eq('user_id',actor).lt('expires_at',new Date().toISOString());if(cleanupError)throw cleanupError;
    const issued=await issueStaffSession();await log('staff_login','admin_staff_account',staff.staff_id,{role:staff.role});
    result={ok:true,role:staff.role,staff_id:staff.staff_id,...issued};break;
   }
   case 'complete_staff_registration':{
    if(owner)throw new Error('The platform owner is exempt from appointed-staff registration. Only newly appointed administrators and moderators register a separate staff password.');
    if(!['admin','moderator'].includes(actorRole))throw new Error('Only an appointed administrator or moderator can complete staff registration.');
    let staffId=String(body.staff_id||'').trim();const password=String(body.staff_password||'');
    if(staffId&&!/^\d{10}$/.test(staffId))throw new Error('Staff ID must contain exactly 10 digits.');
    if(password.length<10||!/[0-9]/.test(password)||!/[A-Za-z]/.test(password))throw new Error('Staff password must be at least 10 characters and contain both letters and numbers. Use a password different from your public Frnxup password.');
    const {data:existing,error:existingError}=await admin.from('admin_staff_accounts').select('*').eq('user_id',actor).maybeSingle();if(existingError)throw existingError;
    const row=existing;
    if(!row||row.staff_id!==staffId)throw new Error('This staff ID is not assigned to the signed-in Frnxup account. Ask the platform owner to assign your role.');
    if(row.role!==actorRole)throw new Error('Your Frnxup role and staff assignment do not match. Contact the platform owner.');
    if(row.status==='active'&&row.password_hash)throw new Error('Staff registration is already complete. Use the Admin sign-in page.');
    const salt=randomHex(16);const passwordHash=await hashPassword(password,salt);
    const {error:updateError}=await admin.from('admin_staff_accounts').update({password_salt:salt,password_hash:passwordHash,status:'active',registered_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('user_id',actor);if(updateError)throw updateError;
    await log('complete_staff_registration','admin_staff_account',staffId,{role:row.role});
    const issued=await issueStaffSession();result={ok:true,role:row.role,staff_id:staffId,...issued};break;
   }
   case 'lookup_staff_user':{
    if(!owner)throw new Error('Only the platform owner can find staff candidates.');
    const identity=String(body.identity||'').trim();if(identity.length<3||identity.length>254)throw new Error('Enter a registered Frnxup username or email address.');
    let profile:any=null;
    if(identity.includes('@')){
      const email=identity.toLowerCase();let match:any=null;
      for(let page=1;page<=20&&!match;page++){
        const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});if(error)throw error;
        match=(data?.users||[]).find((u:any)=>String(u.email||'').toLowerCase()===email)||null;
        if(!data?.users||data.users.length<1000)break;
      }
      if(match){const {data,error}=await admin.from('profiles').select('id,username,display_name,role,account_status,created_at').eq('id',match.id).maybeSingle();if(error)throw error;profile=data?{...data,email:match.email}:null;}
    }else{
      const username=identity.replace(/^@/,'').trim().toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(username))throw new Error('Enter a valid Frnxup username (3–24 letters, numbers or underscores) or a registered email.');const {data,error}=await admin.from('profiles').select('id,username,display_name,role,account_status,created_at').eq('username',username).maybeSingle();if(error)throw error;
      if(data){const {data:u,error:ue}=await admin.auth.admin.getUserById(data.id);if(ue)throw ue;profile={...data,email:u?.user?.email||null};}
    }
    if(!profile)throw new Error('No registered Frnxup user was found with that exact username or email.');
    if(profile.role==='owner')throw new Error('The platform owner cannot be assigned as a new administrator or moderator.');
    if(profile.account_status!=='active')throw new Error('This Frnxup account is not active. Reactivate it before assigning a staff role.');
    result={user:profile};break;
   }
   case 'assign_staff_role':{
    if(!owner)throw new Error('Only the platform owner can assign administrator or moderator roles.');
    const userId=String(body.user_id||'');const staffRole=String(body.role||'').toLowerCase();if(!['admin','moderator'].includes(staffRole))throw new Error('Choose Administrator or Moderator.');
    const {data:target,error:targetError}=await admin.from('profiles').select('id,username,display_name,role,account_status').eq('id',userId).maybeSingle();if(targetError)throw targetError;
    if(!target)throw new Error('The selected Frnxup profile could not be found.');if(target.id===actor)throw new Error('You cannot assign a second staff role to your own owner account.');if(target.role==='owner')throw new Error('The owner account cannot be modified.');if(target.account_status!=='active')throw new Error('This Frnxup account is not active.');
    const {data:existing,error:staffError}=await admin.from('admin_staff_accounts').select('staff_id,status,password_hash').eq('user_id',userId).maybeSingle();if(staffError)throw staffError;
    const staffId=existing?.staff_id||await generateStaffId();
    const {error:roleError}=await admin.from('profiles').update({role:staffRole}).eq('id',userId);if(roleError)throw roleError;
    const staffPayload:any={user_id:userId,staff_id:staffId,role:staffRole,created_by:actor,updated_at:new Date().toISOString()};
    if(!existing){staffPayload.status='pending';staffPayload.password_hash=null;staffPayload.password_salt=null;}
    const {error:upsertError}=await admin.from('admin_staff_accounts').upsert(staffPayload,{onConflict:'user_id'});if(upsertError)throw upsertError;
    let notificationSent=false;
    if(!existing?.password_hash){const {error:notificationError}=await admin.from('notifications').insert({user_id:userId,actor_id:actor,type:'staff_invitation',title:'Frnxup staff role assigned',body:`You have been appointed as ${staffRole==='admin'?'an Administrator':'a Moderator'}. Your 10-digit staff ID is ${staffId}. Sign in to your Frnxup account and open /Admin/staff-registration.html to create a separate staff password.`});notificationSent=!notificationError;}
    await log('assign_staff_role','profile',userId,{role:staffRole,username:target.username,staff_id:staffId,notification_sent:notificationSent});
    result={ok:true,role:staffRole,staff_id:staffId,status:existing?.status||'pending',password_setup_required:!existing?.password_hash,notification_sent:notificationSent,user:{id:target.id,username:target.username,display_name:target.display_name}};break;
   }
   case 'remove_admin':{
    if(!owner)throw new Error('Only the platform owner can remove administrator or moderator roles.');
    const userId=String(body.user_id||'');if(!userId||userId===actor)throw new Error('You cannot remove your own owner access.');
    const {data:target,error}=await admin.from('profiles').select('id,username,role').eq('id',userId).maybeSingle();if(error)throw error;if(!target||!['admin','moderator'].includes(target.role))throw new Error('Only an assigned administrator or moderator can be removed here.');
    const {error:profileError}=await admin.from('profiles').update({role:'member'}).eq('id',userId);if(profileError)throw profileError;
    const {error:sessionError}=await admin.from('admin_staff_sessions').delete().eq('user_id',userId);if(sessionError)throw sessionError;
    const {error:staffError}=await admin.from('admin_staff_accounts').delete().eq('user_id',userId);if(staffError)throw staffError;
    await log('remove_staff_role','profile',userId,{username:target.username,previous_role:target.role});result={ok:true};break;
   }
   case 'dashboard_summary':{
    const [members,posts,open_reports,rooms,activity,pages,market_listings,market_boost_requests]=await Promise.all([count('profiles'),count('posts',[['status','eq','published']]),count('reports',[['status','in','(open,reviewing)']]),count('rooms',[['status','eq','active']]),count('site_activity_logs'),count('frnxup_pages',[['status','eq','active']]),count('market_listings',[['status','eq','published']]),count('market_boosts',[['status','eq','pending_review']])]);
    const {data:boostLedger}=await admin.from('market_boosts').select('amount_ngn,status');const market_boost_revenue=(boostLedger||[]).filter(x=>['active','expired'].includes(x.status)).reduce((sum,x)=>sum+Number(x.amount_ngn||0),0);const market_boost_pending=(boostLedger||[]).filter(x=>x.status==='pending_review').reduce((sum,x)=>sum+Number(x.amount_ngn||0),0);
    const {data:recent_members}=await admin.from('profiles').select('id,username,display_name,role,account_status,created_at').order('created_at',{ascending:false}).limit(7);
    const {data:recent_reports}=await admin.from('reports').select('id,target_type,reason,status,created_at').order('created_at',{ascending:false}).limit(7);
    const {data:settings}=await admin.from('site_settings').select('key,value');const map=Object.fromEntries((settings||[]).map(x=>[x.key,x.value]));const {data:recent_activity}=await admin.from('site_activity_logs').select('id,actor_id,action,entity_type,entity_id,details,created_at,profile:profiles!site_activity_logs_actor_id_fkey(username,display_name)').order('created_at',{ascending:false}).limit(8);result={members,posts,open_reports,rooms,activity,pages,market_listings,market_boost_requests,market_boost_revenue,market_boost_pending,recent_members,recent_reports,recent_activity,settings:map};break;
   }
   case 'list_members':{
    if(!canManage)throw new Error('Member account management is restricted to admins and the owner.');
    let q=admin.from('profiles').select('id,username,display_name,role,account_status,created_at').order('created_at',{ascending:false}).limit(100);
    if(body.q){const term=String(body.q).replace(/[(),.%]/g,'').slice(0,60);if(term)q=q.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`);}const {data,error}=await q;if(error)throw error;
    const items=[];for(const p of data||[]){const {data:u}=await admin.auth.admin.getUserById(p.id);items.push({...p,email:u?.user?.email||null,phone:u?.user?.phone||null})}result={items};break;
   }
   case 'set_member_status':{
    if(!canManage)throw new Error('Only admins and owners can suspend accounts.');
    const {data:target,error:targetError}=await admin.from('profiles').select('id,role,account_status').eq('id',body.user_id).maybeSingle();
    if(targetError)throw targetError;
    if(!target||target.role==='owner'||(!owner&&target.role!=='member'))throw new Error('You do not have permission to change this account.');
    if(!['active','suspended'].includes(body.status))throw new Error('Invalid account status');
    const {error:updateError}=await admin.from('profiles').update({account_status:body.status}).eq('id',body.user_id);
    if(updateError)throw updateError;
    await log('set_member_status','profile',body.user_id,{status:body.status});
    result={ok:true,status:body.status};break;
   }
   case 'set_member_role':{
    if(!owner)throw new Error('Only the platform owner can change member roles.');
    if(body.role!=='member')throw new Error('Use the owner-only Staff Management page to assign administrator or moderator roles and issue a staff ID.');
    const {data:target}=await admin.from('profiles').select('role').eq('id',body.user_id).single();if(!target)throw new Error('Member not found');if(target.role==='owner')throw new Error('The owner account cannot be changed here.');
    const {error}=await admin.from('profiles').update({role:'member'}).eq('id',body.user_id);if(error)throw error;
    await admin.from('admin_staff_sessions').delete().eq('user_id',body.user_id);await admin.from('admin_staff_accounts').delete().eq('user_id',body.user_id);
    await log('set_member_role','profile',body.user_id,{role:'member'});result={ok:true};break;
   }
   case 'delete_member':{
    if(!canManage)throw new Error('Only admins and owners can delete member accounts.');
    if(body.user_id===actor)throw new Error('You cannot delete the currently signed-in account.');
    const {data:target,error:targetError}=await admin.from('profiles').select('id,username,role,account_status').eq('id',body.user_id).maybeSingle();
    if(targetError)throw targetError;
    if(!target||target.role==='owner'||(!owner&&target.role!=='member'))throw new Error('You do not have permission to delete this account. Only the owner can remove privileged accounts.')
    const {error:deleteError}=await admin.auth.admin.deleteUser(body.user_id);
    if(deleteError)throw deleteError;
    await log('delete_member','profile',body.user_id,{username:target.username});
    result={ok:true};break;
   }
   case 'list_posts':{let q=admin.from('posts').select('id,user_id,body,visibility,status,created_at,profiles!posts_user_id_fkey(username,display_name)').order('created_at',{ascending:false}).limit(100);if(!canModerate)q=q.eq('visibility','public').eq('status','published');if(body.q)q=q.ilike('body',`%${String(body.q).slice(0,80)}%`);const {data,error}=await q;if(error)throw error;result={items:data||[]};break}
   case 'moderate_post':{if(!canModerate)throw new Error('Moderator role is required.');if(!['hidden','deleted','published'].includes(body.status))throw new Error('Invalid moderation status');if(body.status==='deleted'&&!canManage)throw new Error('Only admins and the owner can permanently delete posts.');const {error}=await admin.from('posts').update({status:body.status}).eq('id',body.post_id);if(error)throw error;await log('moderate_post','post',body.post_id,{status:body.status});result={ok:true};break}
   case 'list_comments':{let q=admin.from('post_comments').select('id,user_id,post_id,body,status,created_at,profiles!post_comments_user_id_fkey(username,display_name),posts!inner(visibility,status)').order('created_at',{ascending:false}).limit(150);if(!canModerate)q=q.eq('posts.visibility','public').eq('posts.status','published').eq('status','published');if(body.q)q=q.ilike('body',`%${String(body.q).slice(0,80)}%`);const {data,error}=await q;if(error)throw error;result={items:(data||[]).map(({posts,...comment})=>comment)};break}
   case 'moderate_comment':{if(!canModerate)throw new Error('Moderator role is required.');if(!['hidden','deleted','published'].includes(body.status))throw new Error('Invalid moderation status');if(body.status==='deleted'&&!canManage)throw new Error('Only admins and the owner can permanently delete comments.');const {error}=await admin.from('post_comments').update({status:body.status}).eq('id',body.comment_id);if(error)throw error;await log('moderate_comment','comment',body.comment_id,{status:body.status});result={ok:true};break}
   case 'list_groups':{let q=admin.from('conversations').select('id,title,created_by,status,created_at,conversation_members(count)').eq('kind','group').order('created_at',{ascending:false}).limit(100);if(body.q)q=q.ilike('title',`%${body.q}%`);const {data,error}=await q;if(error)throw error;result={items:(data||[]).map(g=>({...g,member_count:g.conversation_members?.[0]?.count||0}))};break}
   case 'set_group_status':{if(!canManage)throw new Error('Admin role required.');const {error}=await admin.from('conversations').update({status:body.status}).eq('id',body.conversation_id).eq('kind','group');if(error)throw error;await log('set_group_status','conversation',body.conversation_id,{status:body.status});result={ok:true};break}
   case 'list_pages':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role is required to inspect Pages.');
    let q=admin.from('frnxup_pages').select('id,owner_user_id,name,slug,category,status,follower_count_visible,created_at,profiles!frnxup_pages_owner_user_id_fkey(username,display_name)').order('created_at',{ascending:false}).limit(200);
    if(body.q){const term=String(body.q).replace(/[(),.%]/g,'').slice(0,70);if(term)q=q.or(`name.ilike.%${term}%,slug.ilike.%${term}%`);}
    const {data,error}=await q;if(error)throw error;const items=[];for(const page of data||[]){const {count}=await admin.from('frnxup_page_followers').select('*',{count:'exact',head:true}).eq('page_id',page.id);items.push({...page,follower_count:count||0});}result={items};break;
   }
   case 'set_page_status':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role is required.');
    if(!['active','suspended','removed'].includes(body.status))throw new Error('Invalid Page status.');
    const {error}=await admin.from('frnxup_pages').update({status:body.status,updated_at:new Date().toISOString()}).eq('id',body.page_id);if(error)throw error;await log('set_page_status','frnxup_page',body.page_id,{status:body.status});result={ok:true};break;
   }
   case 'list_rooms':{let q=admin.from('rooms').select('*').order('created_at',{ascending:false}).limit(100);if(body.q)q=q.ilike('name',`%${String(body.q).slice(0,80)}%`);const {data,error}=await q;if(error)throw error;result={items:data||[]};break}
   case 'create_room':{if(!canManage)throw new Error('Admin role required to create official rooms.');const {data,error}=await admin.from('rooms').insert({name:body.name,description:body.description||'',category:body.category||'General',visibility:body.visibility||'public',created_by:actor}).select().single();if(error)throw error;await log('create_room','room',data.id,{name:data.name});result={room:data};break}
   case 'update_room':{if(!canManage)throw new Error('Admin role required.');const {error}=await admin.from('rooms').update({name:body.name}).eq('id',body.room_id);if(error)throw error;await log('update_room','room',body.room_id,{name:body.name});result={ok:true};break}
   case 'set_room_status':{if(!canManage)throw new Error('Admin role required.');const {data:r}=await admin.from('rooms').select('status').eq('id',body.room_id).single();const status=r?.status==='active'?'suspended':'active';const {error}=await admin.from('rooms').update({status}).eq('id',body.room_id);if(error)throw error;await log('set_room_status','room',body.room_id,{status});result={status};break}
   case 'inspect_report':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role is required.');
    const {data:r,error:re}=await admin.from('reports').select('id,target_type,target_id,reason,status').eq('id',body.report_id).single();if(re||!r)throw new Error('Report not found.');
    let target:any={target_type:r.target_type,target_id:r.target_id};
    if(r.target_type==='post') {const {data}=await admin.from('posts').select('id,user_id,body,visibility,media_type,status,created_at').eq('id',r.target_id).maybeSingle();target={...target,content:data};}
    else if(r.target_type==='comment') {const {data}=await admin.from('post_comments').select('id,user_id,post_id,body,status,created_at').eq('id',r.target_id).maybeSingle();target={...target,content:data};}
    else if(r.target_type==='room') {const {data}=await admin.from('rooms').select('id,name,description,category,visibility,status,created_by,created_at').eq('id',r.target_id).maybeSingle();target={...target,content:data};}
    else if(r.target_type==='group') {const {data}=await admin.from('conversations').select('id,title,created_by,status,created_at').eq('id',r.target_id).eq('kind','group').maybeSingle();target={...target,content:data};}
    else if(r.target_type==='user') {const {data}=await admin.from('profiles').select('id,username,display_name,account_status,role,created_at').eq('id',r.target_id).maybeSingle();target={...target,content:data};}
    else if(r.target_type==='message') {target={...target,content:{notice:'Private message content is not exposed in the routine administrator review. The report may be assessed using the reporter’s explanation and relevant account or conversation controls.'}};}
    await log('inspect_report_target','report',r.id,{target_type:r.target_type,target_id:r.target_id});
    result={report:{id:r.id,reason:r.reason,status:r.status,target_type:r.target_type},target};break;
   }
   case 'list_reports':{let q=admin.from('reports').select('*').order('created_at',{ascending:false}).limit(150);if(body.q)q=q.ilike('reason',`%${body.q}%`);const {data,error}=await q;if(error)throw error;result={items:data||[]};break}
   case 'resolve_report':{if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role required.');if(!['resolved','dismissed','reviewing'].includes(body.status))throw new Error('Invalid report status');const {error}=await admin.from('reports').update({status:body.status,reviewed_by:actor,updated_at:new Date().toISOString()}).eq('id',body.report_id);if(error)throw error;await log('resolve_report','report',body.report_id,{status:body.status});result={ok:true};break}
   case 'list_verifications':{if(!canManage)throw new Error('Verification records are restricted to admins and the owner.');const {data,error}=await admin.from('verification_requests').select('*').order('created_at',{ascending:false}).limit(100);if(error)throw error;result={items:data||[]};break}
   case 'update_verification':{if(!canManage)throw new Error('Admin role required.');if(!['approved','rejected'].includes(body.status))throw new Error('Invalid verification status.');const {error}=await admin.from('verification_requests').update({status:body.status,reviewed_by:actor,updated_at:new Date().toISOString()}).eq('id',body.verification_id);if(error)throw error;if(body.status==='approved'){const {data:v}=await admin.from('verification_requests').select('user_id').eq('id',body.verification_id).single();if(v)await admin.from('profiles').update({is_verified:true}).eq('id',v.user_id)}await log('update_verification','verification_request',body.verification_id,{status:body.status});result={ok:true};break}
   case 'list_appeals':{if(!canManage)throw new Error('Appeal records are restricted to admins and the owner.');const {data,error}=await admin.from('account_appeals').select('*').order('created_at',{ascending:false}).limit(100);if(error)throw error;result={items:data||[]};break}
   case 'update_appeal':{if(!canManage)throw new Error('Admin role required.');if(!['upheld','reinstated'].includes(body.status))throw new Error('Invalid appeal status.');const {data:a}=await admin.from('account_appeals').select('user_id').eq('id',body.appeal_id).single();const {error}=await admin.from('account_appeals').update({status:body.status,reviewed_by:actor,updated_at:new Date().toISOString()}).eq('id',body.appeal_id);if(error)throw error;if(body.status==='reinstated'&&a)await admin.from('profiles').update({account_status:'active'}).eq('id',a.user_id);await log('update_appeal','account_appeal',body.appeal_id,{status:body.status});result={ok:true};break}
   case 'list_admins':{
    if(!owner)throw new Error('Only the platform owner can view staff role management.');
    const {data,error}=await admin.from('profiles').select('id,username,display_name,role,account_status,created_at').in('role',['owner','admin','moderator']).order('created_at',{ascending:true});if(error)throw error;
    const items=[];for(const p of data||[]){const {data:staff}=await admin.from('admin_staff_accounts').select('staff_id,status,registered_at').eq('user_id',p.id).maybeSingle();items.push({...p,staff_id:staff?.staff_id||null,staff_status:staff?.status||'not enrolled',staff_registered_at:staff?.registered_at||null});}
    result={items};break;
   }
   case 'promote_admin':{throw new Error('The old quick-promotion action is disabled. Use the separate Staff Management page to find a Frnxup user, assign a role and generate their staff ID.');}
   case 'get_settings':{if(!canManage)throw new Error('Site settings are restricted to admins and the owner.');const {data,error}=await admin.from('site_settings').select('key,value');if(error)throw error;result={settings:Object.fromEntries((data||[]).map(x=>[x.key,x.value]))};break}
   case 'set_setting':{if(!owner)throw new Error('Only the platform owner can change global site switches.');const allowed=['registration_enabled','posting_enabled','comments_enabled','reactions_enabled','polls_enabled','statuses_enabled','friend_requests_enabled','messaging_enabled','groups_enabled','rooms_enabled','uploads_enabled','market_enabled','market_boosts_enabled','maintenance_mode'];if(!allowed.includes(body.key))throw new Error('Unknown site setting.');if(typeof body.value!=='boolean')throw new Error('Site switch values must be true or false.');const {error}=await admin.from('site_settings').upsert({key:body.key,value:body.value,updated_by:actor,updated_at:new Date().toISOString()});if(error)throw error;await log('set_setting','site_setting',null,{key:body.key,value:body.value});result={ok:true};break}
   case 'list_market_listings':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role required to manage Marketplace listings.');
    let q=admin.from('market_listings').select('id,seller_id,title,category,price,condition,location_name,status,featured_until,created_at,view_count').order('created_at',{ascending:false}).limit(200);
    if(body.q){const term=String(body.q).replace(/[(),.%]/g,' ').slice(0,70);if(term)q=q.or(`title.ilike.%${term}%,category.ilike.%${term}%,location_name.ilike.%${term}%`);}
    const {data,error}=await q;if(error)throw error;
    const items=[];for(const listing of data||[]){const {data:seller}=await admin.from('profiles').select('username,display_name').eq('id',listing.seller_id).maybeSingle();items.push({...listing,seller});}
    result={items};break;
   }
   case 'set_market_listing_status':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role required.');
    if(!['published','sold','hidden','removed'].includes(body.status))throw new Error('Invalid Marketplace listing status.');
    const {error}=await admin.from('market_listings').update({status:body.status}).eq('id',body.listing_id);if(error)throw error;
    await log('set_market_listing_status','market_listing',body.listing_id,{status:body.status});result={ok:true};break;
   }
   case 'list_market_boosts':{
    if(!canManage)throw new Error('Marketplace boost payment records are restricted to admins and the owner.');
    let q=admin.from('market_boosts').select('*').order('created_at',{ascending:false}).limit(200);
    if(body.q){const term=String(body.q).replace(/[(),.%]/g,' ').slice(0,70);if(term)q=q.ilike('payment_reference',`%${term}%`);}
    const {data,error}=await q;if(error)throw error;const items=[];
    for(const boost of data||[]){const [{data:listing},{data:payer}]=await Promise.all([admin.from('market_listings').select('id,title,seller_id,status').eq('id',boost.listing_id).maybeSingle(),admin.from('profiles').select('id,username,display_name').eq('id',boost.payer_id).maybeSingle()]);items.push({...boost,listing,payer});}
    result={items};break;
   }
   case 'list_market_payments':{
    if(!canManage)throw new Error('Marketplace payment records are restricted to admins and the owner.');
    let q=admin.from('market_boosts').select('*').order('created_at',{ascending:false}).limit(250);
    if(body.q){const term=String(body.q).replace(/[(),.%]/g,' ').slice(0,70);if(term)q=q.ilike('payment_reference',`%${term}%`);}
    const {data,error}=await q;if(error)throw error;const {data:allPayments,error:summaryError}=await admin.from('market_boosts').select('amount_ngn,status');if(summaryError)throw summaryError;const items=[];
    for(const payment of data||[]){const [{data:listing},{data:payer},{data:reviewer}]=await Promise.all([
      admin.from('market_listings').select('id,title,seller_id,status').eq('id',payment.listing_id).maybeSingle(),
      admin.from('profiles').select('id,username,display_name').eq('id',payment.payer_id).maybeSingle(),
      payment.reviewed_by?admin.from('profiles').select('id,username,display_name').eq('id',payment.reviewed_by).maybeSingle():Promise.resolve({data:null})
    ]);items.push({...payment,listing,payer,reviewer});}
    const confirmed=(allPayments||[]).filter(x=>['active','expired'].includes(x.status));const pending=(allPayments||[]).filter(x=>x.status==='pending_review');
    result={items,summary:{received_ngn:confirmed.reduce((sum,x)=>sum+Number(x.amount_ngn||0),0),pending_ngn:pending.reduce((sum,x)=>sum+Number(x.amount_ngn||0),0),received_count:confirmed.length,pending_count:pending.length,rejected_count:(allPayments||[]).filter(x=>x.status==='rejected').length}};break;
   }
   case 'review_market_boost':{
    if(!canManage)throw new Error('Only admins and the owner can verify boost payments.');
    if(!['active','rejected'].includes(body.status))throw new Error('Invalid boost review status.');
    const {data:boost,error:be}=await admin.from('market_boosts').select('id,listing_id,payer_id,duration_weeks,status').eq('id',body.boost_id).single();if(be||!boost)throw new Error('Boost request not found.');
    if(boost.status!=='pending_review')throw new Error('This boost request has already been reviewed.');
    const reviewNote=String(body.review_note||'').slice(0,500);
    if(body.status==='active'){
      const {data:listing,error:le}=await admin.from('market_listings').select('id,status,featured_until').eq('id',boost.listing_id).single();if(le||!listing||listing.status!=='published')throw new Error('Only a published listing can be boosted.');
      const now=new Date();const currentEnd=listing.featured_until?new Date(listing.featured_until):now;const start=currentEnd>now?currentEnd:now;const end=new Date(start.getTime()+boost.duration_weeks*7*24*60*60*1000);
      const {error}=await admin.from('market_boosts').update({status:'active',starts_at:start.toISOString(),ends_at:end.toISOString(),reviewed_by:actor,review_note:reviewNote}).eq('id',boost.id);if(error)throw error;
      const {error:listingError}=await admin.from('market_listings').update({featured_until:end.toISOString()}).eq('id',boost.listing_id);if(listingError)throw listingError;
    }else{const {error}=await admin.from('market_boosts').update({status:'rejected',reviewed_by:actor,review_note:reviewNote}).eq('id',boost.id);if(error)throw error;}
    await log('review_market_boost','market_boost',boost.id,{status:body.status,listing_id:boost.listing_id,duration_weeks:boost.duration_weeks});result={ok:true};break;
   }
   case 'list_market_reports':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role required.');
    let q=admin.from('market_reports').select('*').order('created_at',{ascending:false}).limit(200);
    if(body.q){const term=String(body.q).replace(/[(),.%]/g,' ').slice(0,70);if(term)q=q.ilike('reason',`%${term}%`);}
    const {data,error}=await q;if(error)throw error;const items=[];
    for(const report of data||[]){const [{data:listing},{data:reporter}]=await Promise.all([admin.from('market_listings').select('id,title').eq('id',report.listing_id).maybeSingle(),admin.from('profiles').select('id,username,display_name').eq('id',report.reporter_id).maybeSingle()]);items.push({...report,listing,reporter});}
    result={items};break;
   }
   case 'review_market_report':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role required.');
    if(!['resolved','dismissed'].includes(body.status))throw new Error('Invalid report resolution.');
    const {error}=await admin.from('market_reports').update({status:body.status,reviewed_by:actor,resolution_note:String(body.resolution_note||'').slice(0,1000)}).eq('id',body.report_id);if(error)throw error;
    await log('review_market_report','market_report',body.report_id,{status:body.status});result={ok:true};break;
   }
   case 'list_site_activity':{
    if(!['owner','admin','moderator'].includes(actorProfile.role))throw new Error('Moderator role is required to inspect site activity.');
    let q=admin.from('site_activity_logs').select('id,actor_id,action,entity_type,entity_id,details,created_at,profile:profiles!site_activity_logs_actor_id_fkey(username,display_name)').order('created_at',{ascending:false}).limit(250);
    if(body.q){const term=String(body.q).replace(/[^a-zA-Z0-9_:/ -]/g,'').slice(0,70);if(term)q=q.or(`action.ilike.%${term}%,entity_type.ilike.%${term}%,entity_id.ilike.%${term}%`);}
    const {data,error}=await q;if(error)throw error;
    result={items:data||[]};break;
   }
   case 'list_audit_logs':{if(!canManage)throw new Error('Audit records are restricted to admins and the owner.');const {data,error}=await admin.from('admin_audit_logs').select('*').order('created_at',{ascending:false}).limit(200);if(error)throw error;result={items:data||[]};break}
   default:return json({error:'Unsupported administrator action'},400);
  }
  return json(result);
 }catch(e){
  // Supabase PostgREST errors are not guaranteed to be native Error instances.
  // Preserve their safe message/code/details so the admin UI never masks them
  // behind the generic "Administrator request failed" text.
  const value=(e&&typeof e==='object')?e as Record<string,unknown>:{};
  const message=typeof e==='string'?e:(typeof value.message==='string'?value.message:(typeof value.error==='string'?value.error:'The administrator action failed for an unspecified reason.'));
  const code=typeof value.code==='string'?value.code:null;
  const details=typeof value.details==='string'?value.details:null;
  const hint=typeof value.hint==='string'?value.hint:null;
  const status=typeof value.status==='number'&&value.status>=400&&value.status<600?value.status:400;
  return json({error:message,code,details,hint,action:actionName},status);
 }
});
