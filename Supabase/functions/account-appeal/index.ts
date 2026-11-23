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
const MAX_FILE_BYTES = 5 * 1024 * 1024;
function readServiceKey(): string {
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){try{const parsed=JSON.parse(raw);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim();}catch{}}
  return Deno.env.get('SUPABASE_SECRET_KEY')?.trim()||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()||'';
}
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const jwt = authorization.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Verify your email using the secure appeal link before submitting documents." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = readServiceKey();
    if (!url || !serviceKey) return json({ error: "The secure appeal service is not configured." }, 503);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(jwt);
    const authUser = authData?.user;
    if (authError || !authUser) return json({ error: "Your appeal verification link has expired. Request a new one." }, 401);
    if (!authUser.email || !authUser.email_confirmed_at) return json({ error: "A verified email address is required to submit an account appeal." }, 403);

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,username,display_name,account_status,role")
      .eq("id", authUser.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return json({ error: "This Frnxup account profile could not be found. Contact support at frnxup@gmail.com." }, 404);
    if (!["suspended", "banned"].includes(profile.account_status)) {
      return json({ error: "This account is not suspended or banned, so an account appeal cannot be submitted." }, 409);
    }
    if (["owner", "admin", "moderator"].includes(profile.role)) {
      return json({ error: "Staff account appeals must be handled directly by the Frnxup platform owner." }, 403);
    }

    const form = await req.formData();
    const reason = String(form.get("reason") || "").trim();
    if (reason.length < 10 || reason.length > 3000) {
      return json({ error: "Your appeal letter must contain between 10 and 3,000 characters." }, 400);
    }

    const { data: pendingAppeal, error: pendingError } = await admin.from("account_appeals")
      .select("id").eq("user_id", authUser.id).eq("status", "pending").limit(1);
    if (pendingError) throw pendingError;
    if (pendingAppeal?.length) {
      return json({ error: "You already have an appeal awaiting review. Please wait for the Frnxup team to respond." }, 409);
    }
    const { data: recent, error: recentError } = await admin.from("account_appeals")
      .select("id,created_at").eq("user_id", authUser.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false }).limit(1);
    if (recentError) throw recentError;
    if (recent?.length) return json({ error: "For fairness and safety, wait 24 hours before submitting another appeal." }, 429);

    const buckets = [
      { field: "portrait", label: "Portrait photo" },
      { field: "identity", label: "Government-issued identification" },
      { field: "supporting", label: "Additional supporting document" }
    ];
    const files: Array<{ field: string; label: string; file: File }> = [];
    for (const item of buckets) {
      const value = form.get(item.field);
      if (value instanceof File && value.size > 0) {
        if (value.size > MAX_FILE_BYTES) return json({ error: `${item.label} must be 5 MB or smaller.` }, 400);
        if (!ACCEPTED_TYPES.has(value.type)) return json({ error: `${item.label} must be a JPG, PNG, WEBP or PDF file.` }, 400);
        if (item.field === "portrait" && value.type === "application/pdf") return json({ error: "The portrait photo must be an image file." }, 400);
        files.push({ ...item, file: value });
      }
    }

    const appealId = crypto.randomUUID();
    const stored: Array<{ path: string; label: string; original_name: string; mime_type: string }> = [];
    const bucket = admin.storage.from("account-appeals");

    try {
      for (const entry of files) {
        const extension = entry.file.type === "application/pdf" ? "pdf" : entry.file.type.split("/")[1].replace("jpeg", "jpg");
        const path = `${authUser.id}/${appealId}/${entry.field}-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await bucket.upload(path, entry.file, {
          contentType: entry.file.type,
          cacheControl: "0",
          upsert: false
        });
        if (uploadError) throw uploadError;
        stored.push({ path, label: entry.label, original_name: entry.file.name.slice(0, 140), mime_type: entry.file.type });
      }

      const { error: insertError } = await admin.from("account_appeals").insert({
        id: appealId,
        user_id: authUser.id,
        reason,
        status: "pending",
        contact_email: authUser.email.toLowerCase(),
        evidence_paths: stored
      });
      if (insertError) throw insertError;
    } catch (error) {
      if (stored.length) await bucket.remove(stored.map((item) => item.path));
      throw error;
    }

    // Give admins an internal notification without disclosing the evidence itself.
    const { data: administrators } = await admin.from("profiles").select("id").in("role", ["admin", "owner"]).eq("account_status", "active");
    if (administrators?.length) {
      await admin.from("notifications").insert(administrators.map((person) => ({
        user_id: person.id,
        actor_id: null,
        type: "account_appeal_submitted",
        title: "New account appeal submitted",
        body: `@${profile.username} submitted an account appeal. Open Admin → Appeals to review it.`
      })));
    }

    return json({ ok: true, appeal_id: appealId, message: "Your appeal has been submitted securely. The Frnxup team will review it." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit your appeal.";
    return json({ error: message }, 400);
  }
});
