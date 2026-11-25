// EDU-AFRIKA AI Question Production Centre.
// Supports 20 server-side AI provider integrations; free/trial access differs by provider.
// Provider API keys are encrypted at rest with EDU_AI_KEYS_ENCRYPTION_SECRET.
// Only the authenticated Frnxup admin can manage providers or generate drafts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Provider = {
  code: string; name: string; baseUrl: string; model: string; protocol: 'openai' | 'cloudflare';
  keyUrl: string; website: string; accessLabel: string; freeAccess: string; docsUrl: string; domains: string[];
};

const PROVIDERS: Provider[] = [
  { code:'gemini', name:'Google Gemini API', baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai', model:'gemini-3.8-flash', protocol:'openai', keyUrl:'https://aistudio.google.com/app/apikey', website:'https://ai.google.dev/', accessLabel:'Limited free API tier', freeAccess:'Free access covers selected Gemini API models and is rate-limited. Important: prompts and responses on the free tier may be used to improve Google products; review Google’s data-use terms before sending exam content.', docsUrl:'https://ai.google.dev/gemini-api/docs/pricing', domains:['generativelanguage.googleapis.com'] },
  { code:'groq', name:'GroqCloud', baseUrl:'https://api.groq.com/openai/v1', model:'openai/gpt-oss-120b', protocol:'openai', keyUrl:'https://console.groq.com/keys', website:'https://groq.com/', accessLabel:'Rate-limited developer access', freeAccess:'Developer access is rate-limited and model availability/pricing can vary by account. Check the live model list and organization limits before bulk generation.', docsUrl:'https://console.groq.com/docs/rate-limits', domains:['api.groq.com'] },
  { code:'openrouter', name:'OpenRouter', baseUrl:'https://openrouter.ai/api/v1', model:'openrouter/free', protocol:'openai', keyUrl:'https://openrouter.ai/settings/keys', website:'https://openrouter.ai/', accessLabel:'Free model pool · request cap', freeAccess:'Select a model ending in :free or use openrouter/free. Free variants currently have a 20 requests/minute and 50 requests/day cap; failed calls count toward the daily limit. Limits can change.', docsUrl:'https://openrouter.ai/collections/free-models', domains:['openrouter.ai'] },
  { code:'cloudflare', name:'Cloudflare Workers AI', baseUrl:'https://api.cloudflare.com/client/v4', model:'@cf/google/gemma-4-26b-a4b-it', protocol:'cloudflare', keyUrl:'https://dash.cloudflare.com/profile/api-tokens', website:'https://developers.cloudflare.com/workers-ai/', accessLabel:'10,000 free Neurons / day', freeAccess:'Workers AI Free currently includes 10,000 Neurons per day. Some frontier models require a paid plan or prepaid credits; check the model catalogue before selecting a model.', docsUrl:'https://developers.cloudflare.com/workers-ai/platform/pricing/', domains:['api.cloudflare.com'] },
  { code:'cohere', name:'Cohere', baseUrl:'https://api.cohere.ai/compatibility/v1', model:'command-r7b-12-2024', protocol:'openai', keyUrl:'https://dashboard.cohere.com/api-keys', website:'https://cohere.com/', accessLabel:'Free evaluation key · capped', freeAccess:'Evaluation keys are free but limited. Trial chat keys currently allow up to 1,000 calls/month. Review evaluation data-use and production restrictions.', docsUrl:'https://docs.cohere.com/docs/rate-limits', domains:['api.cohere.ai'] },
  { code:'mistral', name:'Mistral AI', baseUrl:'https://api.mistral.ai/v1', model:'mistral-small-latest', protocol:'openai', keyUrl:'https://console.mistral.ai/api-keys/', website:'https://mistral.ai/', accessLabel:'API billing may apply', freeAccess:'Mistral’s free Studio/Vibe plan does not automatically make API calls free. The API is token-priced; only use a model/key with an explicit API trial or free allowance shown in your workspace.', docsUrl:'https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key', domains:['api.mistral.ai'] },
  { code:'zai', name:'Z.AI / GLM', baseUrl:'https://api.z.ai/api/paas/v4', model:'glm-4.7-flash', protocol:'openai', keyUrl:'https://z.ai/manage-apikey/apikey-list', website:'https://z.ai/', accessLabel:'Selected free-model quotas', freeAccess:'Selected GLM Flash model variants may have free API quotas. Confirm that the chosen model is marked free in your Z.AI console; other models may be paid.', docsUrl:'https://docs.z.ai/', domains:['api.z.ai'] },
  { code:'alibaba', name:'Alibaba Cloud Model Studio', baseUrl:'https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', model:'qwen-plus', protocol:'openai', keyUrl:'https://bailian.console.aliyun.com/', website:'https://www.alibabacloud.com/product/modelstudio', accessLabel:'Eligible new-user free quota', freeAccess:'Eligible new accounts receive model-specific trial quotas (often for 90 days; region and model dependent). Use the provider’s Free Quota Only / safe-quota setting where available so generation stops instead of switching to paid usage.', docsUrl:'https://www.alibabacloud.com/help/en/model-studio/new-free-quota', domains:['maas.aliyuncs.com','dashscope-intl.aliyuncs.com','dashscope.aliyuncs.com'] },
  { code:'aion', name:'Aion Labs', baseUrl:'https://api.aionlabs.ai/v1', model:'aion-labs/aion-3.5', protocol:'openai', keyUrl:'https://www.aionlabs.ai/', website:'https://www.aionlabs.ai/', accessLabel:'Daily free API allowance', freeAccess:'Aion’s pricing page lists a free API tier with a daily credit allowance; request/token caps still apply. Check the account dashboard for current quota before bulk generation.', docsUrl:'https://www.aionlabs.ai/docs/rate-limits/', domains:['api.aionlabs.ai'] },
  { code:'tencent', name:'Tencent Cloud TokenHub', baseUrl:'https://tokenhub-intl.tencentcloudmaas.com/v1', model:'hy3', protocol:'openai', keyUrl:'https://console.cloud.tencent.com/', website:'https://www.tencentcloud.com/', accessLabel:'New-user token promotion', freeAccess:'Tencent Cloud has advertised up to 1 million free TokenHub tokens for eligible new accounts through 31 December 2026. This is a time-limited promotion, not a permanent free tier; claim it in the console and confirm the selected model quota.', docsUrl:'https://intl.cloud.tencent.com/document/product/1300/78941', domains:['tokenhub-intl.tencentcloudmaas.com','tokenhub.tencentcloudmaas.com','tokenhub-us.tencentcloudmaas.tech'] },
  { code:'volcengine', name:'Volcengine Ark', baseUrl:'https://ark.cn-beijing.volces.com/api/v3', model:'doubao-seed-2-1-lite-260915', protocol:'openai', keyUrl:'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', website:'https://www.volcengine.com/product/ark', accessLabel:'New-account model quota', freeAccess:'New accounts may receive per-model free inference quota. Use Volcengine’s safe-trial/free-only mode where available; exhausted quota should stop requests rather than silently become paid usage.', docsUrl:'https://docs.volcengine.com/docs/ark/free-inference-quota', domains:['ark.cn-beijing.volces.com','ark.ap-southeast.bytepluses.com','ark.us-east-1.volces.com'] },
  { code:'sensenova', name:'SenseNova', baseUrl:'https://api.sensenova.cn/compatible-mode/v1', model:'SenseNova-6.8-Flash-Lite', protocol:'openai', keyUrl:'https://platform.sensenova.cn/', website:'https://www.sensenova.ai/', accessLabel:'Free public-beta quota', freeAccess:'SenseNova public beta currently lists 1,500 calls per 5 hours per eligible model. Special models are excluded and the quota/offer may change.', docsUrl:'https://www.sensenova.ai/token-plan', domains:['api.sensenova.cn','api.sensenova.com'] },
  { code:'siliconflow', name:'SiliconFlow', baseUrl:'https://api.siliconflow.com/v1', model:'Qwen/Qwen3-8B', protocol:'openai', keyUrl:'https://cloud.siliconflow.cn/account/ak', website:'https://siliconflow.com/', accessLabel:'Trial / promotional credits', freeAccess:'New-account credits or free-model promotions may be available for eligible accounts; this is not a guaranteed permanent free tier. Check the model price and remaining credits in the console.', docsUrl:'https://docs.siliconflow.cn/docs/userguide/quickstart', domains:['api.siliconflow.com','api.siliconflow.cn'] },
  { code:'cerebras', name:'Cerebras Inference', baseUrl:'https://api.cerebras.ai/v1', model:'gpt-oss-120b', protocol:'openai', keyUrl:'https://cloud.cerebras.ai/platform', website:'https://cerebras.ai/', accessLabel:'One-time $5 developer credit', freeAccess:'Cerebras currently advertises a one-time $5 developer credit after adding a valid payment method. It expires after 30 days; usage pauses when exhausted/expired unless separate paid credits are purchased.', docsUrl:'https://inference-docs.cerebras.ai/', domains:['api.cerebras.ai'] },
  { code:'nvidia', name:'NVIDIA NIM API Catalog', baseUrl:'https://integrate.api.nvidia.com/v1', model:'deepseek-ai/deepseek-v4-flash', protocol:'openai', keyUrl:'https://build.nvidia.com/', website:'https://build.nvidia.com/', accessLabel:'Limited hosted-model trial', freeAccess:'NVIDIA’s API Catalog offers limited hosted-model developer/prototyping access for selected models. Model access, rate limits and production terms differ; check the current model page.', docsUrl:'https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html', domains:['integrate.api.nvidia.com'] },
  { code:'baichuan', name:'Baichuan AI', baseUrl:'https://api.baichuan-ai.com/v1', model:'Baichuan2-Turbo', protocol:'openai', keyUrl:'https://platform.baichuan-ai.com/', website:'https://www.baichuan-ai.com/', accessLabel:'Recharge / paid API', freeAccess:'Baichuan’s API documentation requires real-name verification and account recharge before API calls. Treat this as a paid fallback, not a guaranteed free API tier.', docsUrl:'https://platform.baichuan-ai.com/docs/', domains:['api.baichuan-ai.com'] },
  { code:'fireworks', name:'Fireworks AI', baseUrl:'https://api.fireworks.ai/inference/v1', model:'accounts/fireworks/models/llama-v3p1-8b-instruct', protocol:'openai', keyUrl:'https://fireworks.ai/account/api-keys', website:'https://fireworks.ai/', accessLabel:'Free developer quota may vary', freeAccess:'Fireworks advertises developer/free access for selected models, but account and model quotas can change. Check the current console usage cap before bulk generation; paid usage may apply beyond free quota.', docsUrl:'https://docs.fireworks.ai/', domains:['api.fireworks.ai'] },
  { code:'ai21', name:'AI21 Labs', baseUrl:'https://api.ai21.com/studio/v1', model:'jamba-mini', protocol:'openai', keyUrl:'https://studio.ai21.com/', website:'https://www.ai21.com/', accessLabel:'API pay-as-you-go / trial varies', freeAccess:'AI21 API access is usage-priced; a free Studio subscription is not the same as free API inference. Only rely on trial credit if it is explicitly displayed in your account.', docsUrl:'https://docs.ai21.com/', domains:['api.ai21.com'] },
  { code:'deepinfra', name:'DeepInfra', baseUrl:'https://api.deepinfra.com/v1/openai', model:'zai-org/GLM-5.3-Flash', protocol:'openai', keyUrl:'https://deepinfra.com/dash/api_keys', website:'https://deepinfra.com/', accessLabel:'Usage-based API billing', freeAccess:'DeepInfra uses model-specific usage pricing; do not assume a permanent free tier. It is included as a paid-compatible alternative with no long-term commitment.', docsUrl:'https://deepinfra.com/docs', domains:['api.deepinfra.com'] },
  { code:'amazon_bedrock', name:'Amazon Bedrock', baseUrl:'https://bedrock-mantle.us-east-1.api.aws/v1', model:'Enter a Bedrock Mantle model ID', protocol:'openai', keyUrl:'https://console.aws.amazon.com/bedrock/', website:'https://aws.amazon.com/bedrock/', accessLabel:'AWS promotional credits only', freeAccess:'Eligible AWS promotional credits may cover Bedrock usage, but Bedrock is not a permanent free API tier. Confirm region, model pricing, and AWS billing before use.', docsUrl:'https://docs.aws.amazon.com/bedrock/latest/userguide/', domains:['bedrock-mantle.us-east-1.api.aws','bedrock-mantle.us-west-2.api.aws','bedrock-mantle.eu-west-1.api.aws'] },
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

async function cryptoKey(secret: string, usage: KeyUsage[]) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}
async function encryptApiKey(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cryptoKey(secret, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return { ciphertext: b64(new Uint8Array(encrypted)), iv: b64(iv) };
}
async function decryptApiKey(ciphertext: string, iv: string, secret: string) {
  const key = await cryptoKey(secret, ['decrypt']);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext));
  return new TextDecoder().decode(clear);
}

function readDefaultKeyMap(name: string): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
    const first = Object.values(parsed || {}).find((value:any) => typeof value === 'string' && value.trim());
    return typeof first === 'string' ? first.trim() : null;
  } catch (_) { return null; }
}

function providerFor(code: string) { return PROVIDERS.find(p => p.code === code); }
function safeBaseUrl(provider: Provider, value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Provider base URL must use HTTPS.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === '169.254.169.254' || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Private or local provider URLs are not allowed.');
  if (!provider.domains.some(domain => host === domain || host.endsWith('.' + domain))) throw new Error(`This provider base URL must use one of its approved domains: ${provider.domains.join(', ')}.`);
  return url.toString().replace(/\/$/, '');
}
function extractContent(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((x: any) => typeof x?.text === 'string' ? x.text : '').join('\n').trim();
  const gemini = payload?.candidates?.[0]?.content?.parts?.map((x: any) => x.text || '').join('\n');
  if (typeof gemini === 'string' && gemini.trim()) return gemini.trim();
  const cohere = payload?.message?.content?.map?.((x: any) => x.text || '').join('\n');
  if (typeof cohere === 'string' && cohere.trim()) return cohere.trim();
  const cf = payload?.result?.response;
  if (typeof cf === 'string') return cf.trim();
  const anthropic = payload?.content?.map?.((x: any) => x.text || '').join('\n');
  if (typeof anthropic === 'string' && anthropic.trim()) return anthropic.trim();
  return '';
}
function extractUsage(payload: any) {
  const u = payload?.usage || payload?.usage_metadata || payload?.meta?.billed_units || {};
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens ?? u.input_tokens ?? u.tokens?.input ?? u.billed_units?.input_tokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? u.outputTokens ?? u.tokens?.output ?? u.billed_units?.output_tokens ?? 0) || 0;
  return { input, output };
}
async function providerRequest(provider: Provider, config: any, apiKey: string, messages: any[], maxTokens = 1500) {
  const signal = AbortSignal.timeout(60000);
  if (provider.protocol === 'cloudflare') {
    if (!config.account_id) throw new Error('Enter the Cloudflare Account ID in provider configuration.');
    const modelPath = String(config.model).split('/').map((part:string)=>encodeURIComponent(part)).join('/');
    const url = `${config.api_base_url.replace(/\/$/, '')}/accounts/${encodeURIComponent(config.account_id)}/ai/run/${modelPath}`;
    const response = await fetch(url, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0.2 }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.errors?.[0]?.message || payload?.error?.message || `Cloudflare returned HTTP ${response.status}.`);
    return { text: extractContent(payload), usage: extractUsage(payload), model: config.model };
  }

  const url = `${config.api_base_url.replace(/\/$/, '')}/chat/completions`;
  const baseBody = { model: config.model, messages, temperature: 0.2, max_tokens: maxTokens };
  let response = await fetch(url, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(provider.code === 'openrouter' ? { 'HTTP-Referer': 'https://frnxup.com', 'X-Title': 'EDU-AFRIKA' } : {}) },
    body: JSON.stringify({ ...baseBody, response_format: { type: 'json_object' } }),
  });
  let payload = await response.json().catch(() => ({}));
  // A few OpenAI-compatible endpoints do not implement response_format. Retry without it.
  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await fetch(url, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(provider.code === 'openrouter' ? { 'HTTP-Referer': 'https://frnxup.com', 'X-Title': 'EDU-AFRIKA' } : {}) },
      body: JSON.stringify(baseBody),
    });
    payload = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || payload?.detail || `AI provider returned HTTP ${response.status}. Check the model ID, API key, region and account quota.`);
  return { text: extractContent(payload), usage: extractUsage(payload), model: payload?.model || config.model };
}
function parseJsonText(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The provider did not return a JSON object. Try another model or a smaller batch.');
  return JSON.parse(cleaned.slice(start, end + 1));
}
function words(text: string) { return new Set(normalize(text).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(x => x.length > 2)); }
function similarity(a: string, b: string) {
  const x = words(a), y = words(b); if (!x.size || !y.size) return 0;
  let overlap = 0; for (const w of x) if (y.has(w)) overlap++;
  return overlap / (x.size + y.size - overlap);
}
async function fingerprint(text: string) {
  const value = normalize(text).replace(/\s+/g, ' ');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function collectHashes(service: any, table: string, column: string) {
  const set = new Set<string>(); let offset = 0; const pageSize = 1000; const hardLimit = 100000;
  while (offset < hardLimit) {
    const { data, error } = await service.from(table).select(column).not(column, 'is', null).range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data || []) if (row[column]) set.add(String(row[column]));
    if (!data || data.length < pageSize) return set;
    offset += pageSize;
  }
  throw new Error(`The ${table} ledger exceeds the safe duplicate-scan limit. Ask the database administrator to run a server-side duplicate check before generating more questions.`);
}
async function collectRecentQuestionTexts(service: any) {
  const { data, error } = await service.from('edu_questions').select('question_text').order('created_at', { ascending:false }).limit(1500);
  if (error) throw error;
  return (data || []).map((row: any) => String(row.question_text || '')).filter(Boolean);
}
function normalizeQuestion(row: any, defaultTopic: string, allowedTopics: Set<string>, topicMode: string) {
  const type = String(row?.question_type || '').toLowerCase();
  const question = String(row?.question_text || '').trim();
  const correct = String(row?.correct_answer || '').trim();
  const options = Array.isArray(row?.options) ? row.options : [];
  if (question.length < 8 || question.length > 5000) throw new Error('Question text length is invalid.');
  if (!['mcq', 'fill_gap'].includes(type)) throw new Error('Question type must be mcq or fill_gap.');
  if (!correct) throw new Error('Correct answer is missing.');
  let normalizedOptions: any[] = [];
  let correctAnswer = correct;
  if (type === 'mcq') {
    const mapped = options.map((o: any) => ({ key: String(o?.key || '').trim().toUpperCase(), text: String(o?.text || '').trim() }));
    const keys = mapped.map(o => o.key);
    if (mapped.length !== 4 || ['A','B','C','D'].some(k => keys.filter(x => x === k).length !== 1)) throw new Error('MCQ must have exactly one option for A, B, C and D.');
    if (mapped.some(o => o.text.length < 1 || o.text.length > 1000)) throw new Error('Every MCQ option needs valid text.');
    if (new Set(mapped.map(o => normalize(o.text))).size !== 4) throw new Error('MCQ options must be four distinct answers.');
    correctAnswer = correct.toUpperCase();
    if (!['A','B','C','D'].includes(correctAnswer)) throw new Error('MCQ correct_answer must be the option key A, B, C or D.');
    normalizedOptions = mapped;
  } else if (options.length) throw new Error('Fill-in-the-gap questions must not include MCQ options.');
  const topic = String(row?.topic_code || defaultTopic || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  if (topicMode === 'single' && defaultTopic && topic !== defaultTopic) throw new Error('Question topic did not match the selected topic.');
  if (topicMode === 'balanced' && allowedTopics.size && !allowedTopics.has(topic)) throw new Error('AI returned a topic outside the active syllabus topic catalogue.');
  const marks = Number(row?.marks);
  if (!Number.isFinite(marks) || marks < 0.25 || marks > 100) throw new Error('Marks must be between 0.25 and 100.');
  const difficulty = ['easy','medium','hard'].includes(String(row?.difficulty || '').toLowerCase()) ? String(row.difficulty).toLowerCase() : 'medium';
  const accepted = Array.isArray(row?.accepted_answers) ? row.accepted_answers.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 12) : [];
  const flags = ['human_academic_review_required','human_independent_answer_key_verification_required','official_syllabus_alignment_not_independently_verified'];
  return {
    question_text: question, question_type: type, options: normalizedOptions,
    correct_answer: correctAnswer, accepted_answers: type === 'fill_gap' ? accepted : [],
    explanation: String(row?.explanation || '').trim().slice(0, 3000), marks, difficulty,
    topic_code: topic, ai_quality_flags: flags,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sign in as an active Frnxup administrator.' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || readDefaultKeyMap('SUPABASE_PUBLISHABLE_KEYS') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || readDefaultKeyMap('SUPABASE_SECRET_KEYS') || '';
  const encryptionSecret = Deno.env.get('EDU_AI_KEYS_ENCRYPTION_SECRET') || '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Supabase function environment is incomplete. Confirm SUPABASE_URL and the project publishable / secret key environment values are available to this Edge Function.' }, 500);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Your Frnxup session is invalid. Sign in again.' }, 401);
  const { data: isAdmin, error: adminError } = await userClient.rpc('is_admin');
  if (adminError || isAdmin !== true) return json({ error: 'Only active Frnxup admins and the owner can use the EDU-AFRIKA AI Production Centre.' }, 403);
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Match Frnxup's existing admin-control security: the owner is exempt from
  // appointed-staff login; every appointed administrator must also present a
  // current, user-bound staff session. A profiles.role value alone is not enough.
  const { data: actorProfile, error: profileError } = await service.from('profiles')
    .select('role,account_status').eq('id', userData.user.id).maybeSingle();
  if (profileError || !actorProfile || actorProfile.account_status !== 'active') {
    return json({ error: 'Your active Frnxup administrator profile could not be verified.' }, 403);
  }
  const actorRole = String(actorProfile.role || '').toLowerCase();
  if (actorRole === 'admin') {
    const { data: staff, error: staffError } = await service.from('admin_staff_accounts')
      .select('role,status').eq('user_id', userData.user.id).maybeSingle();
    if (staffError || !staff || staff.status !== 'active' || staff.role !== 'admin') {
      return json({ error: 'Your separate Frnxup staff account is not active. Sign in again or contact the platform owner.' }, 403);
    }
    const staffToken = String(body?.staff_session_token || '');
    if (!staffToken) return json({ error: 'Your separate Frnxup staff session is missing. Sign in again through the Admin sign-in page.' }, 403);
    const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(staffToken)))].map(x => x.toString(16).padStart(2,'0')).join('');
    const { data: staffSession, error: sessionError } = await service.from('admin_staff_sessions')
      .select('id').eq('user_id', userData.user.id).eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (sessionError || !staffSession) return json({ error: 'Your separate Frnxup staff session has expired. Sign in again with your staff ID and staff password.' }, 403);
  } else if (actorRole !== 'owner') {
    return json({ error: 'Only the Frnxup platform owner and appointed administrators can use this AI Production Centre.' }, 403);
  }

  const action = String(body?.action || 'generate');

  if (action === 'list') {
    const { data, error } = await service.from('edu_ai_provider_configs').select('provider_code,provider_name,api_base_url,model,account_id,is_enabled,key_last_four,input_cost_per_million,output_cost_per_million,daily_batch_limit,daily_question_limit,last_tested_at,last_test_status,last_test_message,updated_at').order('provider_name');
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, providers: PROVIDERS.map(p => ({ ...p, configured: (data || []).some((x: any) => x.provider_code === p.code), config: (data || []).find((x: any) => x.provider_code === p.code) || null })) });
  }

  if (action === 'save_provider') {
    if (!encryptionSecret || encryptionSecret.length < 32) return json({ error: 'Set the Supabase Edge Function secret EDU_AI_KEYS_ENCRYPTION_SECRET to a unique random value of at least 32 characters before saving API keys.' }, 503);
    const code = String(body?.provider_code || ''); const provider = providerFor(code);
    if (!provider) return json({ error: 'Choose a supported AI provider.' }, 400);
    const model = String(body?.model || '').trim(); const baseUrl = String(body?.api_base_url || provider.baseUrl).trim();
    const accountId = String(body?.account_id || '').trim(); const apiKey = String(body?.api_key || '').trim();
    const parseRate = (value:any, label:string) => { if (value === '' || value === null || value === undefined) return null; const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 100000) throw new Error(`${label} must be a valid non-negative USD price per 1 million tokens.`); return number; };
    let inputRate:number|null, outputRate:number|null;
    const parseDailyLimit = (value:any, label:string) => { if (value === '' || value === null || value === undefined) return null; const number = Number(value); if (!Number.isInteger(number) || number < 1 || number > 1000000) throw new Error(`${label} must be a whole number from 1 to 1,000,000, or leave it blank for no limit.`); return number; };
    let dailyBatchLimit:number|null, dailyQuestionLimit:number|null;
    try {
      inputRate=parseRate(body?.input_cost_per_million,'Input token price');
      outputRate=parseRate(body?.output_cost_per_million,'Output token price');
      dailyBatchLimit=parseDailyLimit(body?.daily_batch_limit,'Daily batch limit');
      dailyQuestionLimit=parseDailyLimit(body?.daily_question_limit,'Daily question limit');
    } catch(error) { return json({error:(error as Error).message},400); }
    if (!model || model.length > 180) return json({ error: 'Enter the exact model ID from the selected provider console.' }, 400);
    if (!baseUrl) return json({ error: 'Provider API base URL is required.' }, 400);
    let safeUrl: string;
    try { safeUrl = safeBaseUrl(provider, baseUrl); } catch (error) { return json({ error: (error as Error).message }, 400); }
    if (provider.protocol === 'cloudflare' && !accountId) return json({ error: 'Cloudflare Workers AI requires your Cloudflare Account ID.' }, 400);
    const { data: existing, error: existingError } = await service.from('edu_ai_provider_configs').select('api_key_ciphertext,api_key_iv,key_last_four').eq('provider_code', code).maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);
    let encrypted = existing ? { ciphertext: existing.api_key_ciphertext, iv: existing.api_key_iv } : null;
    if (apiKey) encrypted = await encryptApiKey(apiKey, encryptionSecret);
    if (!encrypted) return json({ error: 'Enter the provider API key before saving this provider.' }, 400);
    const payload = {
      provider_code: code, provider_name: provider.name, api_base_url: safeUrl, model,
      api_key_ciphertext: encrypted.ciphertext, api_key_iv: encrypted.iv,
      account_id: accountId, is_enabled: body?.is_enabled !== false,
      input_cost_per_million:inputRate, output_cost_per_million:outputRate,
      daily_batch_limit:dailyBatchLimit, daily_question_limit:dailyQuestionLimit,
      key_last_four: apiKey ? apiKey.slice(-4) : (existing?.key_last_four || ''),
      updated_by: userData.user.id, updated_at: new Date().toISOString(),
      ...(existing ? {} : { created_by: userData.user.id }),
    };
    const { error } = await service.from('edu_ai_provider_configs').upsert(payload, { onConflict: 'provider_code' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, message: `${provider.name} configuration saved. The API key is encrypted and will not be shown again.` });
  }

  const providerCode = String(body?.provider_code || '');
  const provider = providerFor(providerCode);
  if (action !== 'generate' && action !== 'test_provider') return json({ error: 'Unsupported action.' }, 400);
  if (!provider) return json({ error: 'Choose a supported AI provider.' }, 400);
  if (!encryptionSecret || encryptionSecret.length < 32) return json({ error: 'Set the Supabase Edge Function secret EDU_AI_KEYS_ENCRYPTION_SECRET before testing or generating.' }, 503);

  const { data: config, error: configError } = await service.from('edu_ai_provider_configs').select('*').eq('provider_code', providerCode).maybeSingle();
  if (configError) return json({ error: configError.message }, 500);
  if (!config || !config.is_enabled) return json({ error: 'This AI provider is not configured or is disabled. Save and enable it first.' }, 400);
  let apiKey = '';
  try { apiKey = await decryptApiKey(config.api_key_ciphertext, config.api_key_iv, encryptionSecret); }
  catch { return json({ error: 'Provider API key could not be decrypted. The encryption secret may have changed. Re-enter and save this key.' }, 500); }

  if (action === 'test_provider') {
    try {
      const result = await providerRequest(provider, config, apiKey, [
        { role: 'system', content: 'You are a connection test. Reply with a short JSON object only.' },
        { role: 'user', content: 'Return exactly {"ok":true,"provider":"connected"}.' },
      ], 100);
      if (!result.text) throw new Error('The provider responded but returned no text. Check whether the selected model supports chat completions.');
      await service.from('edu_ai_provider_configs').update({ last_tested_at: new Date().toISOString(), last_test_status: 'success', last_test_message: 'Connection successful.', updated_at: new Date().toISOString() }).eq('provider_code', providerCode);
      return json({ ok: true, message: `${provider.name} connected successfully.`, model: config.model });
    } catch (error) {
      const message = (error as Error).message || 'Provider test failed.';
      await service.from('edu_ai_provider_configs').update({ last_tested_at: new Date().toISOString(), last_test_status: 'failed', last_test_message: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('provider_code', providerCode);
      return json({ error: message }, 502);
    }
  }

  const examCode = String(body?.exam_code || '').trim().toUpperCase();
  const subjectCode = String(body?.subject_code || '').trim().toUpperCase();
  const examName = String(body?.exam_name || examCode).trim();
  const subjectName = String(body?.subject_name || subjectCode).trim();
  const programmeId = String(body?.programme_id || '').trim();
  let programmeName = String(body?.programme_name || '').trim();
  const defaultTopic = String(body?.topic_code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  const topicMode = defaultTopic ? 'single' : 'balanced';
  const difficulty = String(body?.difficulty || 'mixed').toLowerCase();
  const format = String(body?.format || 'mixed').toLowerCase();
  const count = Number(body?.count || 10);
  const syllabusYear = Number(body?.syllabus_year || 0) || null;
  if (!examCode || !subjectCode || !examName || !subjectName) return json({ error: 'Choose an examination and subject destination.' }, 400);
  if (!Number.isInteger(count) || count < 1 || count > 100) return json({ error: 'Generate between 1 and 100 questions per destination.' }, 400);
  if (!['easy','medium','hard','mixed'].includes(difficulty)) return json({ error: 'Choose a valid difficulty.' }, 400);
  if (!['mcq','fill_gap','mixed'].includes(format)) return json({ error: 'Choose a valid question format.' }, 400);

  const [{ data: examRow, error: examError }, { data: subjectRow, error: subjectError }] = await Promise.all([
    service.from('edu_exam_types').select('code,name,is_active').eq('code', examCode).maybeSingle(),
    service.from('edu_subjects').select('code,name,is_active').eq('code', subjectCode).maybeSingle(),
  ]);
  if (examError || !examRow || !examRow.is_active) {
    const reason = examError?.message || (!examRow ? 'No matching row was returned from the configured Supabase project.' : 'The matching row is marked inactive.');
    return json({ error: `Examination destination check failed for code \`${examCode}\`: ${reason}`, diagnostic: { exam_code: examCode, row_found: Boolean(examRow), is_active: examRow?.is_active ?? null } }, 400);
  }
  if (subjectError || !subjectRow || !subjectRow.is_active) {
    const reason = subjectError?.message || (!subjectRow ? 'No matching subject row was returned from the configured Supabase project.' : 'The matching row is marked inactive.');
    return json({ error: `Subject destination check failed for code \`${subjectCode}\`: ${reason}`, diagnostic: { subject_code: subjectCode, row_found: Boolean(subjectRow), is_active: subjectRow?.is_active ?? null } }, 400);
  }
  if (programmeId) {
    const { data: programme, error } = await service.from('edu_exam_programmes').select('id,exam_code,programme_name,is_verified,is_active,allowed_subject_codes,required_subject_codes').eq('id', programmeId).eq('exam_code', examCode).maybeSingle();
    if (error || !programme || !programme.is_verified || !programme.is_active) return json({ error: 'The selected course / programme destination must be verified and published before AI questions can be assigned to it.' }, 400);
    programmeName = programme.programme_name;
    const permittedSubjects = [...(programme.allowed_subject_codes || []), ...(programme.required_subject_codes || [])].map((x: string) => String(x).toUpperCase());
    if (permittedSubjects.length && !permittedSubjects.includes(subjectCode)) return json({ error: `${subjectCode} is not an allowed subject in ${programme.programme_name}. Choose a matching subject or use the General destination.` }, 400);
  }
  let allowedTopicRows: any[] = [];
  if (defaultTopic) {
    let topicQuery = service.from('edu_subject_topics').select('topic_code,topic_name')
      .eq('subject_code', subjectCode).eq('topic_code', defaultTopic).eq('is_active', true);
    if (syllabusYear) topicQuery = topicQuery.or(`syllabus_year.eq.${syllabusYear},syllabus_year.is.null`);
    const { data, error } = await topicQuery.limit(1);
    if (error || !data?.length) return json({ error: 'The selected topic is not active for this subject and syllabus year.' }, 400);
    allowedTopicRows = data;
  } else {
    let topicQuery = service.from('edu_subject_topics').select('topic_code,topic_name')
      .eq('subject_code', subjectCode).eq('is_active', true);
    if (syllabusYear) topicQuery = topicQuery.or(`syllabus_year.eq.${syllabusYear},syllabus_year.is.null`);
    const { data, error } = await topicQuery.order('topic_name').limit(300);
    if (error) return json({ error: error.message }, 500);
    allowedTopicRows = data || [];
  }
  const allowedTopics = new Set(allowedTopicRows.map(x => String(x.topic_code).toUpperCase()));
  if (!defaultTopic && !allowedTopics.size) return json({ error: `No active syllabus topics are configured for ${subjectName}. Add syllabus topics first so AI questions can be routed to a verified subject destination.` }, 400);

  // Optional provider-specific daily caps reset at 00:00 UTC. The check is
  // based on attempted batch/question volume, so failed provider calls still
  // count toward the daily cap and cannot be retried endlessly for free.
  const utcDayStart = new Date(); utcDayStart.setUTCHours(0,0,0,0);
  const batchLimit = config.daily_batch_limit === null || config.daily_batch_limit === undefined ? null : Number(config.daily_batch_limit);
  const questionLimit = config.daily_question_limit === null || config.daily_question_limit === undefined ? null : Number(config.daily_question_limit);
  if (batchLimit !== null || questionLimit !== null) {
    const { data: dailyBatches, error: dailyUsageError } = await service.from('edu_ai_generation_batches')
      .select('requested_count').eq('provider_code',providerCode).gte('created_at',utcDayStart.toISOString());
    if (dailyUsageError) return json({ error: `Could not check this provider's daily usage limits: ${dailyUsageError.message}` }, 500);
    const batchCount = (dailyBatches || []).length;
    const questionCount = (dailyBatches || []).reduce((sum:any,row:any)=>sum+Number(row.requested_count||0),0);
    if (batchLimit !== null && batchCount >= batchLimit) return json({ error: `${provider.name} has reached its configured daily limit of ${batchLimit} generation batches. The limit resets at 00:00 UTC.` }, 429);
    if (questionLimit !== null && questionCount + count > questionLimit) return json({ error: `${provider.name} has a daily question limit of ${questionLimit}; ${questionCount} question(s) have already been requested today. Reduce this batch or wait until 00:00 UTC.` }, 429);
  }

  const started = Date.now();
  const { data: batch, error: batchError } = await service.from('edu_ai_generation_batches').insert({
    provider_code: providerCode, provider_name: provider.name, model: config.model,
    exam_code: examCode, subject_code: subjectCode, programme_id: programmeId || null,
    topic_code: defaultTopic, syllabus_year: syllabusYear, requested_count: count,
    status: 'generating', created_by: userData.user.id,
  }).select('id').single();
  if (batchError || !batch) return json({ error: batchError?.message || 'Could not create generation history record.' }, 500);

  try {
    const topicDescription = allowedTopicRows.map(x => `${x.topic_code}: ${x.topic_name}`).join('\n');
    const system = [
      'You are EDU-AFRIKA\'s exam-preparation question author. Generate original practice questions only; never claim they are official past questions.',
      'Return one JSON object exactly: {"questions":[...]} and no markdown or prose outside JSON.',
      'Every MCQ has exactly four distinct options with keys A, B, C and D. correct_answer is the one key letter, not the option text.',
      'Fill-gap questions have no options; include one correct_answer and optional accepted_answers spelling variants.',
      'Every question must be clear, unambiguous, original, age-appropriate and within the supplied subject and active topic catalogue.',
      'Do not invent topic codes. For balanced topic distribution, distribute questions as evenly as practical over the listed topics.',
      'Include a concise explanation that demonstrates the answer, especially for mathematics and science.',
      'Do not copy copyrighted text or reproduce real exam papers. Do not claim the content is official.',
      `Return exactly ${count} objects. Fields: question_text, question_type (mcq or fill_gap), options (array), correct_answer, accepted_answers (array), explanation, marks (number), difficulty (easy/medium/hard), topic_code.`,
    ].join('\n');
    const userPrompt = [
      `Examination destination: ${examName} (${examCode})`,
      `Subject destination: ${subjectName} (${subjectCode})`,
      programmeName ? `Course/programme: ${programmeName}. Questions must fit this programme but remain within the selected subject.` : 'Course/programme: General subject pool.',
      `Topic mode: ${defaultTopic ? 'single topic' : 'balanced distribution across active topics'}`,
      defaultTopic ? `Use this exact topic: ${defaultTopic} (${allowedTopicRows[0]?.topic_name || ''}).` : `Allowed active syllabus topics:\n${topicDescription}`,
      `Difficulty: ${difficulty}. Question format: ${format}. Syllabus year: ${syllabusYear || 'not specified'}.`,
      `Requested questions: ${count}. Every result must have a topic_code from the list above.`,
    ].join('\n');
    const response = await providerRequest(provider, config, apiKey, [ { role:'system', content:system }, { role:'user', content:userPrompt } ], Math.min(24000, 1200 + count * 240));
    if (!response.text) throw new Error('The provider returned an empty response. Try another model or a smaller batch.');
    const parsed = parseJsonText(response.text);
    const returned = Array.isArray(parsed?.questions) ? parsed.questions : [];
    if (!returned.length) throw new Error('The provider response did not contain a questions array.');
    let usage = response.usage || { input:0, output:0 };
    const answerChecks = new Map<number, { verdict:string; note:string }>();
    if (body?.second_pass_check === true) {
      try {
        const verifyMessages = [
          { role:'system', content:'Act as a cautious second-pass consistency checker. Re-check each question and compare the proposed answer and explanation, but do not claim independent verification; return JSON only: {"checks":[{"index":0,"verdict":"consistent|incorrect|uncertain","note":"brief reason"}]}. Do not guess. Use uncertain when the question is ambiguous or cannot be verified from the supplied information.' },
          { role:'user', content:JSON.stringify({subject:subjectName,questions:returned.slice(0,count).map((q:any,index:number)=>({index,question_text:q.question_text,question_type:q.question_type,options:q.options,proposed_correct_answer:q.correct_answer,explanation:q.explanation}))}) },
        ];
        const secondPass = await providerRequest(provider, config, apiKey, verifyMessages, Math.min(12000, 600 + count * 120));
        const checkJson = parseJsonText(secondPass.text);
        for (const check of Array.isArray(checkJson?.checks) ? checkJson.checks : []) {
          const index = Number(check.index); const verdict = String(check.verdict || '').toLowerCase();
          if (Number.isInteger(index) && index >= 0 && index < count && ['consistent','incorrect','uncertain'].includes(verdict)) answerChecks.set(index,{verdict,note:String(check.note||'').slice(0,300)});
        }
        usage = { input:(usage.input||0)+(secondPass.usage?.input||0), output:(usage.output||0)+(secondPass.usage?.output||0) };
      } catch (_verificationError) {
        for (let i=0;i<Math.min(returned.length,count);i++) answerChecks.set(i,{verdict:'uncertain',note:'The second-pass verifier could not complete. Check independently.'});
      }
    }

    const existingHashes = await collectHashes(service, 'edu_questions', 'duplicate_hash');
    const deliveredHashes = await collectHashes(service, 'edu_question_deliveries', 'question_fingerprint');
    const aiClaimHashes = await collectHashes(service, 'edu_ai_question_fingerprint_claims', 'question_fingerprint');
    const recentQuestionTexts = await collectRecentQuestionTexts(service);
    const usedHashes = new Set([...existingHashes, ...deliveredHashes, ...aiClaimHashes]);
    let accepted: any[] = []; const rejected: { reason: string; question: string }[] = [];
    const batchTexts: string[] = [];
    let nearDuplicateCount = 0; let verifierFlagCount = 0;
    for (let index=0; index<Math.min(returned.length,count); index++) {
      const row = returned[index];
      let question: any;
      try { question = normalizeQuestion(row, defaultTopic, allowedTopics, topicMode); }
      catch (error) { rejected.push({ reason: (error as Error).message, question: String(row?.question_text || '').slice(0, 180) }); continue; }
      const hash = await fingerprint(question.question_text);
      if (usedHashes.has(hash)) { rejected.push({ reason:'Exact normalized question already exists in the bank, AI-generation fingerprint claims or permanent student-delivery ledger.', question:question.question_text.slice(0,180) }); continue; }
      const nearInBatch = batchTexts.some(text => similarity(text, question.question_text) >= 0.88);
      const nearInBank = recentQuestionTexts.some(text => similarity(text, question.question_text) >= 0.90);
      if (nearInBatch) { question.ai_quality_flags.push('near_duplicate_in_this_batch_check_manually'); nearDuplicateCount++; }
      if (nearInBank) { question.ai_quality_flags.push('similar_to_existing_question_check_manually'); nearDuplicateCount++; }
      const check = answerChecks.get(index);
      if (check?.verdict === 'incorrect') { question.ai_quality_flags.push(`second_pass_verifier_disagreed: ${check.note || 'independent answer check needed'}`); verifierFlagCount++; }
      else if (check?.verdict === 'uncertain' || (body?.second_pass_check === true && !check)) { question.ai_quality_flags.push(`second_pass_verifier_uncertain: ${check?.note || 'independent answer check needed'}`); verifierFlagCount++; }
      else if (check?.verdict === 'consistent') question.ai_quality_flags.push('second_pass_consistency_check_same_provider_not_independent_verification');
      question.ai_quality_flags.push('manual_syllabus_source_alignment_review_required');
      if (/math|physics|chemistry|account|statistics|economics/i.test(`${subjectCode} ${subjectName}`)) question.ai_quality_flags.push('calculation_or_numeric_answer_independent_check_required');
      usedHashes.add(hash); batchTexts.push(question.question_text);
      accepted.push({
        ...question,
        exam_codes:[examCode], subject_code:subjectCode,
        programme_ids:programmeId ? [programmeId] : [],
        source_type:'ai_draft', source_year:syllabusYear,
        source_reference:`AI-generated original practice draft · ${provider.name} · ${config.model}`,
        is_active:false, review_status:'review', created_by:userData.user.id,
        ai_batch_id:batch.id, ai_provider_code:providerCode, ai_model:config.model,
        // No numerical academic score is emitted: a same-model second pass is not
    // an independent answer-key validator. Keep the field NULL until a real,
    // calibrated quality rubric exists.
    ai_quality_score:null,
      });
    }
    if (returned.length !== count) rejected.push({ reason:`Provider returned ${returned.length} questions; ${count} were requested.`, question:'' });

    // A unique database claim serializes concurrent AI batches. The claim remains
    // after a question is removed, protecting the global no-repeat question pool.
    let insertedCount = 0;
    if (accepted.length) {
      const claimRows = await Promise.all(accepted.map(async q => ({ question_fingerprint:await fingerprint(q.question_text), batch_id:batch.id })));
      const { data: claimed, error: claimError } = await service.from('edu_ai_question_fingerprint_claims').upsert(claimRows,{onConflict:'question_fingerprint',ignoreDuplicates:true}).select('question_fingerprint');
      if (claimError) throw new Error(`Global AI duplicate reservation failed: ${claimError.message}`);
      const claimedHashes = new Set((claimed||[]).map((x:any)=>x.question_fingerprint));
      const uniqueAccepted: any[] = [];
      for (let i=0;i<accepted.length;i++) {
        const hash = claimRows[i].question_fingerprint;
        if (claimedHashes.has(hash)) uniqueAccepted.push(accepted[i]);
        else rejected.push({ reason:'Another AI batch reserved this exact question first. It was not added twice.', question:accepted[i].question_text.slice(0,180) });
      }
      accepted = uniqueAccepted;
      if (accepted.length) {
        const { data, error } = await service.from('edu_questions').insert(accepted).select('id');
        if (error) {
          await service.from('edu_ai_question_fingerprint_claims').delete().eq('batch_id',batch.id);
          throw new Error(`Question save failed: ${error.message}`);
        }
        insertedCount = data?.length || 0;
      }
    }
    const duplicateCount = rejected.filter(x => x.reason.startsWith('Exact normalized') || x.reason.startsWith('Another AI batch reserved')).length;
    const invalidCount = rejected.length - duplicateCount;
    const duration = Date.now() - started;
    const finalStatus = insertedCount === count ? 'completed' : insertedCount > 0 ? 'partial' : 'failed';
    const inputRate = config.input_cost_per_million === null || config.input_cost_per_million === undefined ? null : Number(config.input_cost_per_million);
    const outputRate = config.output_cost_per_million === null || config.output_cost_per_million === undefined ? null : Number(config.output_cost_per_million);
    const estimatedCost = inputRate === null || outputRate === null || (usage.input + usage.output) <= 0 ? null : Number(((usage.input/1000000)*inputRate + (usage.output/1000000)*outputRate).toFixed(6));
    const { error: updateError } = await service.from('edu_ai_generation_batches').update({
      generated_count:returned.length, accepted_count:insertedCount,
      duplicate_count:duplicateCount, invalid_count:invalidCount,
      status:finalStatus, input_tokens:usage.input, output_tokens:usage.output,
      total_tokens:usage.input + usage.output, estimated_cost_usd:estimatedCost, duration_ms:duration,
      quality_summary:{ rejected:rejected.slice(0,100), required_human_review:true, topic_codes:[...allowedTopics], near_duplicate_flags:nearDuplicateCount, verifier_flags:verifierFlagCount, second_pass_check:body?.second_pass_check === true },
      error_message: insertedCount ? '' : 'No generated questions passed the structural, topic and global duplicate checks.',
      completed_at:new Date().toISOString(),
    }).eq('id',batch.id);
    if (updateError) throw updateError;
    return json({
      ok:insertedCount>0, batch_id:batch.id, provider:provider.name, model:config.model,
      exam_code:examCode, subject_code:subjectCode, requested:count,
      generated:returned.length, accepted:insertedCount, duplicate_count:duplicateCount,
      invalid_count:invalidCount, input_tokens:usage.input, output_tokens:usage.output,
      duration_ms:duration, status:finalStatus, estimated_cost_usd:estimatedCost,
      questions:accepted.slice(0,5).map(q=>({ question_text:q.question_text, question_type:q.question_type, options:q.options, correct_answer:q.correct_answer, explanation:q.explanation, topic_code:q.topic_code, difficulty:q.difficulty, ai_quality_flags:q.ai_quality_flags })),
      near_duplicate_flags:nearDuplicateCount, verifier_flags:verifierFlagCount, second_pass_check:body?.second_pass_check === true,
      message:`${insertedCount} question(s) saved to the AI review queue. Nothing was published to students.`,
    });
  } catch (error) {
    const message = (error as Error).message || 'AI generation failed.';
    await service.from('edu_ai_generation_batches').update({ status:'failed', error_message:message.slice(0,1000), duration_ms:Date.now()-started, completed_at:new Date().toISOString() }).eq('id',batch.id);
    return json({ error:message, batch_id:batch.id }, 502);
  }
});
