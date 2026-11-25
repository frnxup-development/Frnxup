// EDU-AFRIKA AI draft generator.
// Requires Supabase secrets: OPENAI_API_KEY and OPENAI_MODEL.
// OPENAI_MODEL is deliberately configurable; select a model enabled for your API project.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function extractText(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Sign in as a Frnxup administrator.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const apiKey = Deno.env.get('OPENAI_API_KEY') || '';
  const model = Deno.env.get('OPENAI_MODEL') || '';
  if (!supabaseUrl || !anonKey) return json({ error: 'Supabase function environment is incomplete.' }, 500);
  if (!apiKey || !model) return json({ error: 'AI question generation is not configured. Add OPENAI_API_KEY and OPENAI_MODEL as Supabase Edge Function secrets.' }, 503);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Your Frnxup session is invalid. Sign in again.' }, 401);
  const { error: adminError } = await userClient.rpc('edu_admin_summary');
  if (adminError) return json({ error: 'Only authorized Frnxup administrators can generate question drafts.' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  const examCode = String(body?.exam_code || '').trim().toUpperCase();
  const subjectCode = String(body?.subject_code || '').trim().toUpperCase();
  const subjectName = String(body?.subject_name || subjectCode).trim();
  const examName = String(body?.exam_name || examCode).trim();
  const topicCode = String(body?.topic_code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  const topic = String(body?.topic_name || body?.topic || '').trim();
  const programmeId = String(body?.programme_id || '').trim();
  const programmeName = String(body?.programme_name || '').trim();
  const difficulty = String(body?.difficulty || 'mixed').toLowerCase();
  const format = String(body?.format || 'mixed').toLowerCase();
  const count = Number(body?.count || 10);
  const syllabusYear = Number(body?.syllabus_year || 0) || null;

  if (!examCode || !subjectCode || !examName || !subjectName) return json({ error: 'Choose an examination and subject.' }, 400);
  if (!Number.isInteger(count) || count < 1 || count > 100) return json({ error: 'Generate between 1 and 100 drafts per request.' }, 400);
  if (!['easy', 'medium', 'hard', 'mixed'].includes(difficulty)) return json({ error: 'Choose a valid difficulty.' }, 400);
  if (!['mcq', 'fill_gap', 'mixed'].includes(format)) return json({ error: 'Choose a valid question format.' }, 400);
  if (topic.length > 180) return json({ error: 'Topic name is too long.' }, 400);
  if (programmeId) {
    const { data: programme, error: programmeError } = await userClient.from('edu_exam_programmes').select('id,exam_code,programme_name').eq('id', programmeId).eq('exam_code', examCode).maybeSingle();
    if (programmeError || !programme) return json({ error: 'The selected course combination is not available for this examination.' }, 400);
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['question_text', 'question_type', 'options', 'correct_answer', 'accepted_answers', 'explanation', 'marks', 'difficulty', 'topic_code'],
          properties: {
            question_text: { type: 'string' },
            question_type: { type: 'string', enum: ['mcq', 'fill_gap'] },
            options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, text: { type: 'string' } } } },
            correct_answer: { type: 'string' },
            accepted_answers: { type: 'array', items: { type: 'string' } },
            explanation: { type: 'string' },
            marks: { type: 'number' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            topic_code: { type: 'string' },
          },
        },
      },
    },
  };

  const instruction = [
    'You are an examination practice-content author for EDU-AFRIKA.',
    'Create original practice questions only. Do not claim that any generated question is an authentic past question or an official examination question.',
    'Follow the subject and topic accurately. If a syllabus year is supplied, keep content appropriate to that year; do not invent official syllabus facts.',
    'Each MCQ must have exactly four distinct options A, B, C and D, with exactly one correct option; correct_answer must be the option key.',
    'Each fill_gap must contain a meaningful blank and a concise correct_answer; accepted_answers may include spelling variants only.',
    'Write clear, unambiguous questions, use correct grammar and maths notation, and include a concise explanation.',
    'Do not repeat the same question in the batch. Do not include copyrighted text from real past papers.',
    `Return exactly ${count} question objects matching the supplied JSON schema.`,
  ].join('\n');
  const requestInput = [
    `Examination: ${examName} (${examCode})`,
    `Subject: ${subjectName} (${subjectCode})`,
    ...(programmeName ? [`Course / programme combination: ${programmeName}. Tailor original practice questions to this study path while remaining within the selected subject.`] : []),
    `Topic: ${topic || 'Balanced coverage of the subject'}`,
    ...(topicCode ? [`Topic code: ${topicCode}. Every generated question must use this exact topic_code value.`] : []),
    `Difficulty: ${difficulty}`,
    `Format: ${format}`,
    `Syllabus year: ${syllabusYear || 'Do not assume a specific year'}`,
    'Make these suitable as original revision and practice content, not a representation of official examination content.',
  ].join('\n');

  const aiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: instruction,
      input: requestInput,
      text: { format: { type: 'json_schema', name: 'edu_afrika_question_batch', strict: true, schema } },
      max_output_tokens: Math.min(24000, 1200 + count * 220),
    }),
  });
  const payload = await aiResponse.json().catch(() => ({}));
  if (!aiResponse.ok) return json({ error: payload?.error?.message || `AI provider returned HTTP ${aiResponse.status}.` }, 502);

  let parsed: any;
  try { parsed = JSON.parse(extractText(payload)); } catch { return json({ error: 'The AI provider did not return valid structured question data.' }, 502); }
  const rows = Array.isArray(parsed?.questions) ? parsed.questions : [];
  if (rows.length !== count) return json({ error: `The AI provider returned ${rows.length} questions; ${count} were requested. Please retry with a smaller batch.` }, 502);

  const normalized: any[] = [];
  for (const row of rows) {
    const type = row.question_type;
    const question = String(row.question_text || '').trim();
    const options = Array.isArray(row.options) ? row.options : [];
    const correct = String(row.correct_answer || '').trim();
    if (question.length < 5 || question.length > 5000 || !['mcq', 'fill_gap'].includes(type) || !correct) continue;
    if (type === 'mcq') {
      const keys = options.map((o: any) => String(o.key || '').toUpperCase());
      if (keys.length !== 4 || ['A','B','C','D'].some(k => !keys.includes(k)) || !keys.includes(correct.toUpperCase())) continue;
    } else if (options.length !== 0) continue;
    normalized.push({
      question_text: question,
      question_type: type,
      options: type === 'mcq' ? options.map((o: any) => ({ key: String(o.key).toUpperCase(), text: String(o.text || '').trim() })) : [],
      correct_answer: correct,
      accepted_answers: Array.isArray(row.accepted_answers) ? row.accepted_answers.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12) : [],
      explanation: String(row.explanation || '').slice(0, 3000),
      marks: Math.min(100, Math.max(0.25, Number(row.marks) || 1)),
      difficulty: ['easy','medium','hard'].includes(row.difficulty) ? row.difficulty : 'medium',
      topic_code: topicCode || String(row.topic_code || topic).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80),
    });
  }
  if (normalized.length !== count) return json({ error: 'Some generated items failed validation. Try again or use a smaller batch.' }, 502);
  return json({ ok: true, model, exam_code: examCode, subject_code: subjectCode, programme_id: programmeId || null, questions: normalized, moderation_status: 'review' });
});
