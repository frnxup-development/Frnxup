import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" }
});
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const ID_TYPES: Record<string, string> = {
  nin: "National Identification Number (NIN) slip/card",
  international_passport: "International passport",
  voters_card: "Voter's card",
  drivers_license: "Driver's licence",
  other_government_id: "Other government-issued identification"
};

type AdminClient = ReturnType<typeof createClient>;
type Grant = { token_hash: string; user_id: string; expires_at: string; used_at: string | null };

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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeReferenceNumber(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const digits = Array.from(bytes, (byte) => String(byte % 10)).join("");
  return `FRN-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

function publicStatus(status: string): string {
  if (status === "pending") return "Pending";
  if (status === "rejected" || status === "upheld") return "Appeal rejected";
  if (status === "approved") return "Appeal approved";
  if (status === "reactivated" || status === "reinstated") return "Frnxup user reactivated";
  return "Under review";
}

async function consumeLookupQuota(admin: AdminClient, key: string): Promise<boolean> {
  const keyHash = await sha256(key);
  const { data, error } = await admin.rpc("consume_account_appeal_lookup_quota", {
    p_key_hash: keyHash,
    p_now: new Date().toISOString()
  });
  if (error) throw error;
  return data === true;
}

async function validateTicket(admin: AdminClient, ticket: string) {
  if (!/^[a-f0-9]{64}$/i.test(ticket)) {
    throw new Error("This appeal page is locked. Return to Frnxup login and sign in with the restricted account to unlock it.");
  }
  const tokenHash = await sha256(ticket);
  const { data: grant, error: grantError } = await admin.from("account_appeal_access_tokens")
    .select("token_hash,user_id,expires_at,used_at").eq("token_hash", tokenHash).maybeSingle();
  if (grantError) throw grantError;
  if (!grant || grant.used_at || new Date(grant.expires_at).getTime() <= Date.now()) {
    throw new Error("Your secure appeal access has expired or has already been used. Return to Frnxup login and verify the restricted account again.");
  }
  const typedGrant = grant as Grant;
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,username,display_name,account_status,role").eq("id", typedGrant.user_id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || !["suspended", "banned"].includes(profile.account_status)) {
    throw new Error("This account is no longer eligible to submit an appeal. Contact frnxup@gmail.com for assistance.");
  }
  if (["owner", "admin", "moderator"].includes(profile.role)) {
    throw new Error("Staff account appeals must be handled directly by the Frnxup platform owner.");
  }
  return { grant: typedGrant, profile };
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "document";
}

async function lookupAppealStatus(admin: AdminClient, body: any, req: Request) {
  const reference = String(body?.reference_number || "").trim().toUpperCase();
  const email = String(body?.email || "").trim().toLowerCase();
  if (!/^FRN-\d{3}-\d{3}-\d{3}$/.test(reference) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid appeal reference number and the registered email address." }, 400);
  }
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80);
  if (!await consumeLookupQuota(admin, `status|${ip}|${email}`)) {
    return json({ error: "Too many status checks. Please wait 15 minutes and try again." }, 429);
  }
  const { data: appeal, error } = await admin.from("account_appeals")
    .select("reference_number,status,created_at,reviewed_at")
    .eq("reference_number", reference).eq("contact_email", email).maybeSingle();
  if (error) throw error;
  if (!appeal) return json({ error: "We could not match that reference number and registered email. Check both details and try again." }, 404);
  return json({ ok: true, reference_number: appeal.reference_number, status: publicStatus(appeal.status), status_code: appeal.status, submitted_at: appeal.created_at, reviewed_at: appeal.reviewed_at || null });
}

async function recoverAppealReference(admin: AdminClient, body: any, req: Request) {
  const email = String(body?.email || "").trim().toLowerCase();
  const username = String(body?.username || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-z0-9_]{3,24}$/.test(username)) {
    return json({ error: "Enter the registered email address and Frnxup username." }, 400);
  }
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80);
  if (!await consumeLookupQuota(admin, `recover|${ip}|${email}`)) {
    return json({ error: "Too many reference recovery attempts. Please wait 15 minutes and try again." }, 429);
  }
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,username").eq("username", username).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return json({ error: "We could not verify those details. Check the registered email and username, then try again." }, 404);
  const { data: authRecord, error: authError } = await admin.auth.admin.getUserById(profile.id);
  if (authError) throw authError;
  const registeredEmail = String(authRecord?.user?.email || "").trim().toLowerCase();
  if (!registeredEmail || registeredEmail !== email) {
    return json({ error: "We could not verify those details. Check the registered email and username, then try again." }, 404);
  }
  const { data: appeal, error } = await admin.from("account_appeals")
    .select("reference_number,status,created_at")
    .eq("user_id", profile.id).not("reference_number", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!appeal?.reference_number) return json({ error: "We could not find an appeal reference for those details. Submit an appeal first or contact frnxup@gmail.com." }, 404);
  return json({ ok: true, reference_number: appeal.reference_number, status: publicStatus(appeal.status), message: "Your existing appeal reference has been recovered. Keep it safe for future status checks." });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let stage = "initialization";
  try {
    stage = "configuration";
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = readServiceKey();
    if (!url || !serviceKey) return json({ error: "The secure appeal service is not configured." }, 503);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    stage = "request-routing";
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body?.action === "check_status") return await lookupAppealStatus(admin, body, req);
      if (body?.action === "recover_reference") return await recoverAppealReference(admin, body, req);

      const ticket = String(body?.appeal_ticket || "");
      if (!ticket) return json({ error: "This appeal page is locked. Return to Frnxup login and verify the restricted account first." }, 401);
      const { grant, profile } = await validateTicket(admin, ticket);
      if (body?.action !== "verify") return json({ error: "Unsupported appeal request." }, 400);
      const { data: history, error: historyError } = await admin.from("account_appeals")
        .select("reference_number,status,review_note,created_at,reviewed_at")
        .eq("user_id", grant.user_id).order("created_at", { ascending: false }).limit(10);
      if (historyError) throw historyError;
      return json({
        ok: true,
        account: { username: profile.username, display_name: profile.display_name, account_status: profile.account_status },
        history: history || []
      });
    }

    if (!contentType.includes("multipart/form-data")) return json({ error: "The appeal form was not submitted in the expected format." }, 400);
    stage = "form-validation";
    const form = await req.formData();
    const ticket = String(form.get("appeal_ticket") || "");
    if (!ticket) return json({ error: "This appeal page is locked. Return to Frnxup login and verify the restricted account first." }, 401);
    stage = "ticket-verification";
    const { grant, profile } = await validateTicket(admin, ticket);
    stage = "form-validation";
    const reason = String(form.get("reason") || "").trim();
    const idType = String(form.get("identity_type") || "");
    if (reason.length < 10 || reason.length > 3000) {
      return json({ error: "Your appeal letter is required and must contain between 10 and 3,000 characters." }, 400);
    }
    if (!ID_TYPES[idType]) return json({ error: "Select the type of government identification you are submitting." }, 400);

    const requiredFiles = [
      { field: "portrait", label: "Portrait photo", imageOnly: true },
      { field: "identity", label: `Government ID — ${ID_TYPES[idType]}`, imageOnly: false },
      { field: "supporting", label: "Additional supporting document", imageOnly: false }
    ];
    const files: Array<{ field: string; label: string; file: File }> = [];
    for (const item of requiredFiles) {
      const value = form.get(item.field);
      if (!(value instanceof File) || value.size <= 0) return json({ error: `${item.label} is required. Please select a file.` }, 400);
      if (value.size > MAX_FILE_BYTES) return json({ error: `${item.label} must be 5 MB or smaller.` }, 400);
      if (!ACCEPTED_TYPES.has(value.type)) return json({ error: `${item.label} must be a JPG, PNG, WEBP or PDF file.` }, 400);
      if (item.imageOnly && !["image/jpeg", "image/png", "image/webp"].includes(value.type)) {
        return json({ error: "Your portrait photo must be a JPG, PNG or WEBP image." }, 400);
      }
      files.push({ field: item.field, label: item.label, file: value });
    }

    const { data: pending, error: pendingError } = await admin.from("account_appeals")
      .select("id").eq("user_id", grant.user_id).eq("status", "pending").limit(1);
    if (pendingError) throw pendingError;
    if (pending?.length) return json({ error: "You already have an appeal awaiting review. Please wait for the Frnxup team to respond." }, 409);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentError } = await admin.from("account_appeals")
      .select("id").eq("user_id", grant.user_id).gte("created_at", since).limit(1);
    if (recentError) throw recentError;
    if (recent?.length) return json({ error: "For fairness and safety, wait 24 hours before submitting another appeal." }, 429);

    const { data: authRecord, error: authError } = await admin.auth.admin.getUserById(grant.user_id);
    if (authError) throw authError;
    const appealId = crypto.randomUUID();
    const bucket = admin.storage.from("account-appeals");
    stage = "document-upload";
    const stored: Array<{ path: string; label: string; original_name: string; mime_type: string }> = [];
    let appealInserted = false;
    let referenceNumber = "";

    try {
      for (const entry of files) {
        const extension = entry.file.type === "application/pdf"
          ? "pdf"
          : entry.file.type.split("/")[1].replace("jpeg", "jpg");
        const path = `${grant.user_id}/${appealId}/${entry.field}-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await bucket.upload(path, entry.file, {
          contentType: entry.file.type,
          cacheControl: "0",
          upsert: false
        });
        if (uploadError) throw uploadError;
        stored.push({
          path,
          label: entry.label,
          original_name: safeFileName(entry.file.name),
          mime_type: entry.file.type
        });
      }

      stage = "appeal-record-insert";
      let insertError: any = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        referenceNumber = makeReferenceNumber();
        const { error } = await admin.from("account_appeals").insert({
          id: appealId,
          user_id: grant.user_id,
          reason,
          status: "pending",
          contact_email: authRecord.user?.email?.toLowerCase() || null,
          evidence_paths: stored,
          reference_number: referenceNumber
        });
        insertError = error;
        if (!error) { appealInserted = true; break; }
        if (error.code !== "23505") break;
      }
      if (!appealInserted) throw insertError || new Error("Could not allocate a unique appeal reference number. Please try again.");

      stage = "appeal-ticket-consumption";
      const { error: consumeError } = await admin.from("account_appeal_access_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("token_hash", grant.token_hash).is("used_at", null);
      if (consumeError) console.error("Appeal grant cleanup warning:", consumeError.message);
    } catch (error) {
      if (!appealInserted && stored.length) await bucket.remove(stored.map((item) => item.path));
      throw error;
    }

    stage = "admin-notification";
    const { data: administrators } = await admin.from("profiles")
      .select("id").in("role", ["admin", "owner"]).eq("account_status", "active");
    if (administrators?.length) {
      await admin.from("notifications").insert(administrators.map((person) => ({
        user_id: person.id,
        actor_id: null,
        type: "account_appeal_submitted",
        title: "New account appeal submitted",
        body: `@${profile.username} submitted appeal ${referenceNumber}. Open Admin → Appeals to review it.`
      })));
    }

    return json({
      ok: true,
      appeal_id: appealId,
      reference_number: referenceNumber,
      message: "Your appeal and all required documents have been submitted securely. Save your reference number to check the appeal status later."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit your appeal.";
    console.error(`account-appeal failure at ${stage}:`, error);
    const status = message.toLowerCase().includes("expired") || message.toLowerCase().includes("locked") ? 401 : 400;
    // The stage label is safe to show; detailed Supabase internals stay in server logs.
    return json({ error: message, stage }, status);
  }
});
