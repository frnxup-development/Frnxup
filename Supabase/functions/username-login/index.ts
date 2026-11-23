import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" }
});

function readServiceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();
    } catch { /* use standard secret names below */ }
  }
  return Deno.env.get("SUPABASE_SECRET_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    || "";
}

function newTicket(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function issueAppealTicket(admin: ReturnType<typeof createClient>, userId: string) {
  const ticket = newTicket();
  const tokenHash = await sha256(ticket);
  const { error: cleanupError } = await admin.from("account_appeal_access_tokens")
    .delete().eq("user_id", userId).is("used_at", null);
  if (cleanupError) throw cleanupError;
  const { error } = await admin.from("account_appeal_access_tokens").insert({
    token_hash: tokenHash,
    user_id: userId,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  });
  if (error) throw error;
  return ticket;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const identifier = String(body?.identifier ?? body?.username ?? "").trim();
    const password = typeof body?.password === "string" ? body.password : "";
    if (!identifier || password.length < 8 || password.length > 512) {
      return json({ error: "Enter your registered email or username and password." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = readServiceKey();
    if (!url || !anonKey || !serviceKey) return json({ error: "Frnxup sign-in service is not configured." }, 503);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let login: { email?: string; phone?: string };
    if (identifier.includes("@")) {
      login = { email: identifier.toLowerCase() };
    } else {
      const username = identifier.replace(/^@/, "").toLowerCase();
      const { data: profile, error: profileLookupError } = await admin
        .from("profiles").select("id").eq("username", username).maybeSingle();
      if (profileLookupError) throw profileLookupError;
      if (!profile) return json({ error: "Invalid username or password." }, 401);
      const { data: authRecord, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
      if (authLookupError || !authRecord?.user) return json({ error: "Invalid username or password." }, 401);
      if (authRecord.user.email) login = { email: authRecord.user.email };
      else if (authRecord.user.phone) login = { phone: authRecord.user.phone };
      else return json({ error: "This account has no verified login method. Contact frnxup@gmail.com." }, 400);
    }

    // Validate the member's real credentials without persisting a browser session.
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authResult, error: authError } = await authClient.auth.signInWithPassword({ ...login, password });
    if (authError || !authResult?.user || !authResult.session) {
      return json({ error: "Invalid login details. Check your email or username and password." }, 401);
    }

    const userId = authResult.user.id;
    const { data: profile, error: statusError } = await admin
      .from("profiles").select("id,username,display_name,account_status,role").eq("id", userId).maybeSingle();
    if (statusError) throw statusError;
    if (!profile) return json({ error: "Frnxup could not verify this account. Contact frnxup@gmail.com." }, 403);

    const restrictedStatus = String(profile.account_status || "").toLowerCase();
    if (["suspended", "banned"].includes(restrictedStatus)) {
      if (["owner", "admin", "moderator"].includes(profile.role)) {
        return json({ error: "This staff account is restricted. Contact the Frnxup platform owner at frnxup@gmail.com.", account_status: restrictedStatus }, 403);
      }
      const appealTicket = await issueAppealTicket(admin, userId);
      const message = restrictedStatus === "banned"
        ? "This account has been banned by Frnxup administrators. Submit an appeal or contact Frnxup-desk's support at frnxup@gmail.com."
        : "This account has been suspended by Frnxup administrators. Submit an appeal or contact Frnxup-desk's support at frnxup@gmail.com.";
      return json({
        restricted: true,
        account_status: restrictedStatus,
        appeal_ticket: appealTicket,
        message
      });
    }

    if (restrictedStatus !== "active") {
      return json({ error: "This account cannot currently access Frnxup. Contact support at frnxup@gmail.com.", account_status: restrictedStatus || "inactive" }, 403);
    }

    // Recheck immediately before returning an active session.
    const { data: latest, error: latestError } = await admin
      .from("profiles").select("account_status").eq("id", userId).maybeSingle();
    if (latestError) throw latestError;
    if (latest?.account_status !== "active") {
      const latestStatus = String(latest?.account_status || "inactive").toLowerCase();
      if (["suspended", "banned"].includes(latestStatus)) {
        const appealTicket = await issueAppealTicket(admin, userId);
        const message = latestStatus === "banned"
          ? "This account has been banned by Frnxup administrators. Submit an appeal or contact Frnxup-desk's support at frnxup@gmail.com."
          : "This account has been suspended by Frnxup administrators. Submit an appeal or contact Frnxup-desk's support at frnxup@gmail.com.";
        return json({ restricted: true, account_status: latestStatus, appeal_ticket: appealTicket, message });
      }
      return json({ error: "This account cannot currently access Frnxup. Contact support at frnxup@gmail.com.", account_status: latestStatus }, 403);
    }

    return json({
      access_token: authResult.session.access_token,
      refresh_token: authResult.session.refresh_token,
      expires_in: authResult.session.expires_in,
      token_type: authResult.session.token_type,
      account_status: "active"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process sign-in.";
    return json({ error: message }, 400);
  }
});
