-- EDU-AFRIKA Student Challenge Arena
-- Run once in Supabase SQL Editor after the EDU-AFRIKA catalogue, question-bank,
-- student-account, and programme migrations have been installed.
-- Challenge answer keys stay server-side. Students receive only the question text/options.

create table if not exists public.edu_challenges (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  creator_id uuid not null references public.edu_students(user_id) on delete cascade,
  opponent_id uuid references public.edu_students(user_id) on delete set null,
  exam_code text not null references public.edu_exam_types(code),
  programme_id uuid references public.edu_exam_programmes(id) on delete set null,
  subject_codes text[] not null,
  question_count integer not null check (question_count in (30,50,100,150,200,300)),
  duration_minutes integer not null check (duration_minutes in (15,30,45,60,90,120)),
  status text not null default 'waiting' check (status in ('waiting','active','completed','forfeited','expired','cancelled')),
  result_kind text check (result_kind in ('score','time_up','forfeit','draw')),
  creator_score numeric(10,2),
  opponent_score numeric(10,2),
  winner_id uuid references public.edu_students(user_id) on delete set null,
  loser_id uuid references public.edu_students(user_id) on delete set null,
  forfeit_by uuid references public.edu_students(user_id) on delete set null,
  creator_submitted_at timestamptz,
  opponent_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  accepted_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  completed_at timestamptz,
  constraint edu_challenges_distinct_players check (opponent_id is null or opponent_id <> creator_id),
  constraint edu_challenges_subjects_count check (cardinality(subject_codes) between 1 and 12)
);
create index if not exists edu_challenges_creator_recent_idx on public.edu_challenges(creator_id,created_at desc);
create index if not exists edu_challenges_opponent_recent_idx on public.edu_challenges(opponent_id,created_at desc);
create index if not exists edu_challenges_status_expiry_idx on public.edu_challenges(status,expires_at,ends_at);

create table if not exists public.edu_challenge_code_attempts (
  user_id uuid primary key references public.edu_students(user_id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  blocked_until timestamptz
);

create table if not exists public.edu_challenge_questions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.edu_challenges(id) on delete cascade,
  source_question_id uuid references public.edu_questions(id) on delete set null,
  question_order integer not null,
  question_text text not null,
  subject_code text not null,
  question_type text not null check (question_type in ('mcq','fill_gap')),
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  accepted_answers text[] not null default '{}',
  explanation text not null default '',
  marks numeric(6,2) not null default 1 check (marks > 0),
  unique(challenge_id,question_order)
);
create index if not exists edu_challenge_questions_order_idx on public.edu_challenge_questions(challenge_id,question_order);

create table if not exists public.edu_challenge_answers (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.edu_challenges(id) on delete cascade,
  challenge_question_id uuid not null references public.edu_challenge_questions(id) on delete cascade,
  student_id uuid not null references public.edu_students(user_id) on delete cascade,
  answer_text text not null default '',
  answered_at timestamptz not null default now(),
  unique(challenge_question_id,student_id)
);
create index if not exists edu_challenge_answers_player_idx on public.edu_challenge_answers(challenge_id,student_id);

create table if not exists public.edu_challenge_ratings (
  user_id uuid primary key references public.edu_students(user_id) on delete cascade,
  rating integer not null default 1000 check (rating >= 100),
  total_xp bigint not null default 0 check (total_xp >= 0),
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  win_streak integer not null default 0,
  best_win_streak integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.edu_challenge_rewards (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.edu_challenges(id) on delete cascade,
  student_id uuid not null references public.edu_students(user_id) on delete cascade,
  xp_delta integer not null default 0,
  rating_delta integer not null default 0,
  correct_count integer not null default 0,
  badge_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(challenge_id,student_id)
);
create index if not exists edu_challenge_rewards_player_idx on public.edu_challenge_rewards(student_id,created_at desc);

create table if not exists public.edu_challenge_badges (
  user_id uuid not null references public.edu_students(user_id) on delete cascade,
  badge_code text not null,
  unlocked_at timestamptz not null default now(),
  primary key(user_id,badge_code)
);

-- Never expose challenge tables directly. All student operations go through the
-- password-checked SECURITY DEFINER RPCs below.
alter table public.edu_challenges enable row level security;
alter table public.edu_challenge_code_attempts enable row level security;
alter table public.edu_challenge_questions enable row level security;
alter table public.edu_challenge_answers enable row level security;
alter table public.edu_challenge_ratings enable row level security;
alter table public.edu_challenge_rewards enable row level security;
alter table public.edu_challenge_badges enable row level security;
revoke all on public.edu_challenges,public.edu_challenge_code_attempts,public.edu_challenge_questions,public.edu_challenge_answers,
  public.edu_challenge_ratings,public.edu_challenge_rewards,public.edu_challenge_badges from public,anon,authenticated;

-- Internal credential check. Never returns the password hash.
create or replace function public.edu_challenge_assert_access(p_password text)
returns uuid language plpgsql security definer set search_path=public,auth,extensions as $$
declare v_user uuid:=auth.uid(); v_hash text;
begin
  if v_user is null then raise exception 'Sign in to your Frnxup account to continue.'; end if;
  if not public.edu_is_active_frnxup_member() then raise exception 'Your Frnxup account is not active.'; end if;
  select password_hash into v_hash from public.edu_students where user_id=v_user;
  if v_hash is null or crypt(coalesce(p_password,''),v_hash)<>v_hash then
    raise exception 'Enter your correct EDU-AFRIKA password.';
  end if;
  return v_user;
end;
$$;
revoke all on function public.edu_challenge_assert_access(text) from public,anon,authenticated;

-- Calculate one player's score without returning any answer key to the browser.
create or replace function public.edu_challenge_calculate_score(p_challenge_id uuid,p_student_id uuid)
returns table(score numeric,correct_count integer)
language sql stable security definer set search_path=public,auth as $$
  select
    coalesce(sum(case when
      (q.question_type='mcq' and upper(btrim(coalesce(a.answer_text,'')))=upper(btrim(q.correct_answer)))
      or (q.question_type='fill_gap' and (
        lower(regexp_replace(btrim(coalesce(a.answer_text,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(q.correct_answer),'\s+',' ','g'))
        or exists(select 1 from unnest(q.accepted_answers) accepted where
          lower(regexp_replace(btrim(accepted),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(a.answer_text,'')),'\s+',' ','g')))
      )) then q.marks else 0 end),0)::numeric,
    count(*) filter(where
      (q.question_type='mcq' and upper(btrim(coalesce(a.answer_text,'')))=upper(btrim(q.correct_answer)))
      or (q.question_type='fill_gap' and (
        lower(regexp_replace(btrim(coalesce(a.answer_text,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(q.correct_answer),'\s+',' ','g'))
        or exists(select 1 from unnest(q.accepted_answers) accepted where
          lower(regexp_replace(btrim(accepted),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(a.answer_text,'')),'\s+',' ','g')))
      )) )::integer
  from public.edu_challenge_questions q
  left join public.edu_challenge_answers a on a.challenge_question_id=q.id and a.student_id=p_student_id
  where q.challenge_id=p_challenge_id;
$$;
revoke all on function public.edu_challenge_calculate_score(uuid,uuid) from public,anon,authenticated;

-- Issue XP, rating changes and milestone badges exactly once per participant.
create or replace function public.edu_challenge_issue_rewards(p_challenge_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare
  v_c public.edu_challenges%rowtype;
  v_creator_correct integer:=0; v_opponent_correct integer:=0;
  v_winner_correct integer:=0; v_winner_xp integer:=0; v_loser_xp integer:=0;
  v_repeat_wins integer:=0; v_wins integer:=0;
  v_winner_rating integer:=1000; v_loser_rating integer:=1000;
  v_winner_badges text[]:='{}'; v_loser uuid;
begin
  select * into v_c from public.edu_challenges where id=p_challenge_id for update;
  if not found or v_c.status not in ('completed','forfeited') then return; end if;
  if exists(select 1 from public.edu_challenge_rewards where challenge_id=v_c.id) then return; end if;
  insert into public.edu_challenge_ratings(user_id) values(v_c.creator_id) on conflict(user_id) do nothing;
  if v_c.opponent_id is not null then insert into public.edu_challenge_ratings(user_id) values(v_c.opponent_id) on conflict(user_id) do nothing; end if;

  select correct_count into v_creator_correct from public.edu_challenge_calculate_score(v_c.id,v_c.creator_id);
  if v_c.opponent_id is not null then
    select correct_count into v_opponent_correct from public.edu_challenge_calculate_score(v_c.id,v_c.opponent_id);
  end if;

  if v_c.result_kind='draw' or v_c.winner_id is null then
    update public.edu_challenge_ratings set total_xp=total_xp+20,draws=draws+1,updated_at=now()
      where user_id in (v_c.creator_id,v_c.opponent_id);
    insert into public.edu_challenge_rewards(challenge_id,student_id,xp_delta,rating_delta,correct_count)
      values(v_c.id,v_c.creator_id,20,0,v_creator_correct)
      on conflict(challenge_id,student_id) do nothing;
    insert into public.edu_challenge_rewards(challenge_id,student_id,xp_delta,rating_delta,correct_count)
      values(v_c.id,v_c.opponent_id,20,0,v_opponent_correct)
      on conflict(challenge_id,student_id) do nothing;
    return;
  end if;

  v_loser:=v_c.loser_id;
  v_winner_correct:=case when v_c.winner_id=v_c.creator_id then v_creator_correct else v_opponent_correct end;
  v_winner_xp:=50+(v_winner_correct*2)+least(50,ceil(v_c.question_count/2.0)::integer);
  v_loser_xp:=case when v_c.result_kind='forfeit' then 0 else 10 end;

  -- Repeated wins against the same opponent still affect rating, but are worth
  -- fewer XP after three victories in a rolling day to discourage point farming.
  select count(*) into v_repeat_wins
  from public.edu_challenge_rewards r
  join public.edu_challenges old on old.id=r.challenge_id
  where r.student_id=v_c.winner_id and r.xp_delta>0 and old.winner_id=v_c.winner_id and r.created_at>=now()-interval '24 hours'
    and (case when old.creator_id=v_c.winner_id then old.opponent_id else old.creator_id end)=v_loser;
  if v_repeat_wins>=3 then v_winner_xp:=least(v_winner_xp,20); end if;

  select rating into v_winner_rating from public.edu_challenge_ratings where user_id=v_c.winner_id for update;
  select rating into v_loser_rating from public.edu_challenge_ratings where user_id=v_loser for update;
  update public.edu_challenge_ratings
    set rating=rating+24,total_xp=total_xp+v_winner_xp,wins=wins+1,
        win_streak=win_streak+1,best_win_streak=greatest(best_win_streak,win_streak+1),updated_at=now()
    where user_id=v_c.winner_id;
  update public.edu_challenge_ratings
    set rating=greatest(100,rating-16),total_xp=total_xp+v_loser_xp,losses=losses+1,win_streak=0,updated_at=now()
    where user_id=v_loser;

  select wins into v_wins from public.edu_challenge_ratings where user_id=v_c.winner_id;
  if v_wins>=1 and not exists(select 1 from public.edu_challenge_badges where user_id=v_c.winner_id and badge_code='FIRST_VICTORY') then v_winner_badges:=array_append(v_winner_badges,'FIRST_VICTORY'); end if;
  if v_wins>=5 and not exists(select 1 from public.edu_challenge_badges where user_id=v_c.winner_id and badge_code='FIVE_VICTORIES') then v_winner_badges:=array_append(v_winner_badges,'FIVE_VICTORIES'); end if;
  if v_wins>=10 and not exists(select 1 from public.edu_challenge_badges where user_id=v_c.winner_id and badge_code='TEN_VICTORIES') then v_winner_badges:=array_append(v_winner_badges,'TEN_VICTORIES'); end if;
  insert into public.edu_challenge_badges(user_id,badge_code)
    select v_c.winner_id,badge from unnest(v_winner_badges) badge on conflict(user_id,badge_code) do nothing;
  insert into public.edu_challenge_rewards(challenge_id,student_id,xp_delta,rating_delta,correct_count,badge_codes)
    values(v_c.id,v_c.winner_id,v_winner_xp,24,v_winner_correct,v_winner_badges)
    on conflict(challenge_id,student_id) do nothing;
  insert into public.edu_challenge_rewards(challenge_id,student_id,xp_delta,rating_delta,correct_count)
    values(v_c.id,v_loser,v_loser_xp,-16,case when v_loser=v_c.creator_id then v_creator_correct else v_opponent_correct end)
    on conflict(challenge_id,student_id) do nothing;
end;
$$;
revoke all on function public.edu_challenge_issue_rewards(uuid) from public,anon,authenticated;

-- Finalize completed or time-expired matches. The match's one shared deadline
-- is authoritative; a browser timer is only a display, never the scoring source.
create or replace function public.edu_challenge_finalize(p_challenge_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare
  v_c public.edu_challenges%rowtype;
  v_creator_score numeric:=0; v_opponent_score numeric:=0;
  v_winner uuid; v_loser uuid; v_kind text;
begin
  select * into v_c from public.edu_challenges where id=p_challenge_id for update;
  if not found or v_c.status<>'active' then return; end if;
  if p_reason='score' and (v_c.creator_submitted_at is null or v_c.opponent_submitted_at is null) then return; end if;
  if p_reason='time_up' and (v_c.ends_at is null or now()<v_c.ends_at) then return; end if;
  select score into v_creator_score from public.edu_challenge_calculate_score(v_c.id,v_c.creator_id);
  select score into v_opponent_score from public.edu_challenge_calculate_score(v_c.id,v_c.opponent_id);
  if v_creator_score>v_opponent_score then v_winner:=v_c.creator_id; v_loser:=v_c.opponent_id;
  elsif v_opponent_score>v_creator_score then v_winner:=v_c.opponent_id; v_loser:=v_c.creator_id;
  else v_winner:=null; v_loser:=null; end if;
  v_kind:=case when v_winner is null then 'draw' else p_reason end;
  update public.edu_challenges set status='completed',result_kind=v_kind,
    creator_score=v_creator_score,opponent_score=v_opponent_score,winner_id=v_winner,loser_id=v_loser,
    completed_at=now() where id=v_c.id;
  perform public.edu_challenge_issue_rewards(v_c.id);
end;
$$;
revoke all on function public.edu_challenge_finalize(uuid,text) from public,anon,authenticated;

-- Create a one-opponent challenge. The random invite token is returned only once;
-- only its SHA-256 hash is stored in the database.
create or replace function public.edu_challenge_create(
  p_password text,p_exam_code text,p_subject_codes text[],p_question_count integer,
  p_duration_minutes integer,p_programme_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  v_user uuid:=public.edu_challenge_assert_access(p_password);
  v_exam public.edu_exam_types%rowtype; v_programme public.edu_exam_programmes%rowtype;
  v_code text; v_token text; v_hash text; v_id uuid; v_available integer; v_inserted integer;
  v_alphabet constant text:='0123456789'; v_i integer; v_j integer;
  v_group jsonb; v_group_subjects text[]; v_seen_group_subjects text[]:='{}';
  v_group_min integer; v_group_max integer; v_group_count integer; v_total_min integer; v_total_max integer; v_subject text;
begin
  perform pg_advisory_xact_lock(hashtextextended('EDU-CHALLENGE-USER:'||v_user::text,0));
  if exists(select 1 from public.edu_challenges where status in ('waiting','active') and (creator_id=v_user or opponent_id=v_user)) then
    raise exception 'Finish or cancel your current challenge before creating another one.';
  end if;
  select * into v_exam from public.edu_exam_types where code=upper(p_exam_code) and is_active;
  if not found then raise exception 'This examination is not currently active.'; end if;
  if p_subject_codes is null or cardinality(p_subject_codes)<1 or cardinality(p_subject_codes)>12 then raise exception 'Choose between 1 and 12 subjects.'; end if;
  if cardinality(p_subject_codes)<>(select count(distinct code) from unnest(p_subject_codes) as selected(code)) then raise exception 'A subject was selected more than once.'; end if;
  if p_question_count is null or p_question_count not in (30,50,100,150,200,300) then raise exception 'Choose 30, 50, 100, 150, 200 or 300 questions.'; end if;
  if p_duration_minutes is null or p_duration_minutes not in (15,30,45,60,90,120) then raise exception 'Choose a valid countdown duration.'; end if;
  if exists(select 1 from unnest(p_subject_codes) as selected(code) where not exists(select 1 from public.edu_subjects sub where sub.code=selected.code and sub.is_active)) then
    raise exception 'One or more selected subjects are unavailable.';
  end if;
  foreach v_subject in array p_subject_codes loop
    if not exists(select 1 from public.edu_questions q where q.is_active and q.review_status='published'
      and v_exam.code=any(q.exam_codes) and q.subject_code=v_subject
      and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))) then
      raise exception 'No approved published questions are available for subject % in this examination yet.',v_subject;
    end if;
  end loop;
  if (coalesce(v_exam.requires_course_selection,false) or exists(select 1 from public.edu_exam_programmes where exam_code=v_exam.code and is_active and is_verified)) and p_programme_id is null then
    raise exception 'Choose an approved course or subject combination for this examination.';
  end if;
  if p_programme_id is not null then
    select * into v_programme from public.edu_exam_programmes where id=p_programme_id and exam_code=v_exam.code and is_active and is_verified;
    if not found then raise exception 'This course or subject combination is not currently approved.'; end if;
    if not (v_programme.required_subject_codes <@ p_subject_codes) or not (p_subject_codes <@ v_programme.allowed_subject_codes) then
      raise exception 'Your selected subjects do not match the approved course combination.';
    end if;
    v_total_min:=coalesce(nullif(v_programme.selection_rules->>'total_min','')::integer,v_programme.min_subject_count);
    v_total_max:=coalesce(nullif(v_programme.selection_rules->>'total_max','')::integer,v_programme.max_subject_count);
    if cardinality(p_subject_codes)<v_total_min or cardinality(p_subject_codes)>v_total_max then
      raise exception 'Select between % and % subjects for this course combination.',v_total_min,v_total_max;
    end if;
    if jsonb_typeof(v_programme.selection_rules->'groups')='array' then
      for v_group in select value from jsonb_array_elements(v_programme.selection_rules->'groups') loop
        v_group_subjects:=array(select jsonb_array_elements_text(coalesce(v_group->'subject_codes','[]'::jsonb)));
        v_group_min:=greatest(0,coalesce(nullif(v_group->>'min_select','')::integer,0));
        v_group_max:=greatest(v_group_min,coalesce(nullif(v_group->>'max_select','')::integer,cardinality(v_group_subjects)));
        if v_group_subjects && v_seen_group_subjects then
          raise exception 'This examination combination has overlapping subject groups. Ask an administrator to correct it.';
        end if;
        if not (v_group_subjects <@ v_programme.allowed_subject_codes) then
          raise exception 'This examination combination contains a subject group outside its allowed subjects. Ask an administrator to correct it.';
        end if;
        select count(*) into v_group_count from unnest(p_subject_codes) selected(code) where selected.code=any(v_group_subjects);
        if v_group_count<v_group_min or v_group_count>v_group_max then
          raise exception 'For %, select between % and % subjects. You currently selected %.',coalesce(v_group->>'label','this subject group'),v_group_min,v_group_max,v_group_count;
        end if;
        if cardinality(v_group_subjects)<>(select count(distinct code) from unnest(v_group_subjects) as g(code)) then
          raise exception 'A subject appears more than once inside a subject group. Ask an administrator to correct the combination.';
        end if;
        v_seen_group_subjects:=v_seen_group_subjects||v_group_subjects;
      end loop;
      if cardinality(v_seen_group_subjects)>0 and cardinality(v_seen_group_subjects)<>cardinality(v_programme.allowed_subject_codes) then
        raise exception 'Every allowed subject must belong to exactly one configured subject group. Ask an administrator to correct the combination.';
      end if;
    end if;
  end if;
  select count(distinct coalesce(q.duplicate_hash,q.id::text)) into v_available from public.edu_questions q
    where q.is_active and q.review_status='published' and v_exam.code=any(q.exam_codes)
      and q.subject_code=any(p_subject_codes)
      and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)));
  if v_available<p_question_count then
    raise exception 'Only % approved questions are available across those subjects. Choose fewer questions or more subjects.',v_available;
  end if;

  -- Retry in the extremely unlikely event of a code-hash collision.
  for v_i in 1..5 loop
    v_token:='';
    for v_j in 1..8 loop
      v_token:=v_token||substr(v_alphabet,1+(get_byte(gen_random_bytes(1),0)%length(v_alphabet)),1);
    end loop;
    v_code:='AFRK-'||substr(v_token,1,4)||'-'||substr(v_token,5,4);
    v_hash:=encode(digest(v_code,'sha256'),'hex');
    exit when not exists(select 1 from public.edu_challenges where code_hash=v_hash);
    v_code:=null;
  end loop;
  if v_code is null then raise exception 'Could not generate a unique challenge code. Please try again.'; end if;
  insert into public.edu_challenges(code_hash,creator_id,exam_code,programme_id,subject_codes,question_count,duration_minutes)
  values(v_hash,v_user,v_exam.code,p_programme_id,p_subject_codes,p_question_count,p_duration_minutes)
  returning id into v_id;

  with candidates as (
    select unique_questions.*,row_number() over(partition by unique_questions.subject_code order by random()) as subject_rank
    from (
      select distinct on (coalesce(q.duplicate_hash,q.id::text)) q.*
      from public.edu_questions q
      where q.is_active and q.review_status='published' and v_exam.code=any(q.exam_codes)
        and q.subject_code=any(p_subject_codes)
        and (cardinality(coalesce(q.programme_ids,'{}'::uuid[]))=0 or (p_programme_id is not null and p_programme_id=any(q.programme_ids)))
      order by coalesce(q.duplicate_hash,q.id::text),random()
    ) unique_questions
  ), picked as (
    select * from candidates order by subject_rank,random() limit p_question_count
  )
  insert into public.edu_challenge_questions(challenge_id,source_question_id,question_order,question_text,subject_code,question_type,options,correct_answer,accepted_answers,explanation,marks)
  select v_id,picked.id,row_number() over(order by random()),picked.question_text,picked.subject_code,picked.question_type,
    picked.options,picked.correct_answer,picked.accepted_answers,picked.explanation,picked.marks
  from picked;
  get diagnostics v_inserted=row_count;
  if v_inserted<>p_question_count then raise exception 'The approved question bank changed while this challenge was being created. Please try again.'; end if;
  return jsonb_build_object('ok',true,'challenge_id',v_id,'challenge_code',v_code,'exam_code',v_exam.code,
    'exam_name',v_exam.name,'question_count',p_question_count,'duration_minutes',p_duration_minutes,
    'expires_in_hours',48,'message','Challenge created. Share this code with one EDU-AFRIKA student.');
end;
$$;
revoke all on function public.edu_challenge_create(text,text,text[],integer,integer,uuid) from public,anon;
grant execute on function public.edu_challenge_create(text,text,text[],integer,integer,uuid) to authenticated;

-- Join by code; the second player starts the shared countdown for both players.
create or replace function public.edu_challenge_join(p_password text,p_challenge_code text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  v_user uuid:=public.edu_challenge_assert_access(p_password);
  v_code text:=upper(regexp_replace(btrim(coalesce(p_challenge_code,'')),'\s','','g'));
  v_hash text; v_c public.edu_challenges%rowtype; v_attempt public.edu_challenge_code_attempts%rowtype;
begin
  if v_code !~ '^AFRK-[0-9]{4}-[0-9]{4}$' then
    return jsonb_build_object('ok',false,'message','Enter the 8 digits in the format AFRK-XXXX-XXXX.');
  end if;
  insert into public.edu_challenge_code_attempts(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_attempt from public.edu_challenge_code_attempts where user_id=v_user for update;
  if v_attempt.blocked_until is not null and v_attempt.blocked_until>clock_timestamp() then
    return jsonb_build_object('ok',false,'message','Too many code attempts. Try again after '||to_char(v_attempt.blocked_until,'HH24:MI')||' server time.');
  end if;
  if v_attempt.window_started_at<clock_timestamp()-interval '10 minutes' then
    update public.edu_challenge_code_attempts set window_started_at=clock_timestamp(),attempt_count=1,blocked_until=null
      where user_id=v_user returning * into v_attempt;
  else
    update public.edu_challenge_code_attempts set attempt_count=attempt_count+1 where user_id=v_user returning * into v_attempt;
  end if;
  if v_attempt.attempt_count>12 then
    update public.edu_challenge_code_attempts set blocked_until=clock_timestamp()+interval '15 minutes'
      where user_id=v_user returning * into v_attempt;
    return jsonb_build_object('ok',false,'message','Too many challenge code attempts. Try again in 15 minutes.');
  end if;
  v_hash:=encode(digest(v_code,'sha256'),'hex');
  select * into v_c from public.edu_challenges where code_hash=v_hash for update;
  if not found then return jsonb_build_object('ok',false,'message','This challenge code is invalid, expired, or has already been used.'); end if;
  if v_c.creator_id=v_user then raise exception 'You cannot accept your own challenge. Share the code with another student.'; end if;
  if not exists(select 1 from public.friendships f where (f.user_a=v_user and f.user_b=v_c.creator_id) or (f.user_a=v_c.creator_id and f.user_b=v_user)) then
    raise exception 'Only an accepted Frnxup friend can accept this private challenge. Add each other as friends first.';
  end if;
  if exists(select 1 from public.user_blocks b where (b.blocker_id=v_user and b.blocked_id=v_c.creator_id) or (b.blocker_id=v_c.creator_id and b.blocked_id=v_user)) then
    raise exception 'This challenge cannot be accepted because one of the accounts has blocked the other.';
  end if;
  if not exists(select 1 from public.profiles p where p.id=v_c.creator_id and p.account_status='active') then
    raise exception 'The challenge creator is no longer an active Frnxup member.';
  end if;
  if v_c.status<>'waiting' then raise exception 'This challenge is no longer accepting an opponent.'; end if;
  if v_c.expires_at<=now() then
    update public.edu_challenges set status='expired',completed_at=now() where id=v_c.id;
    return jsonb_build_object('ok',false,'message','This challenge code has expired. Ask the creator to make a new challenge.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('EDU-CHALLENGE-USER:'||v_user::text,0));
  if exists(select 1 from public.edu_challenges where status in ('waiting','active') and (creator_id=v_user or opponent_id=v_user)) then
    raise exception 'Finish your current challenge before accepting another one.';
  end if;
  if not exists(select 1 from public.edu_students where user_id=v_c.creator_id) then raise exception 'The challenge creator is no longer an active EDU-AFRIKA student.'; end if;
  update public.edu_challenges set opponent_id=v_user,status='active',accepted_at=now(),started_at=now(),ends_at=now()+make_interval(mins=>v_c.duration_minutes)
  where id=v_c.id;
  return jsonb_build_object('ok',true,'challenge_id',v_c.id,'message','Challenge accepted. The shared countdown has started.');
end;
$$;
revoke all on function public.edu_challenge_join(text,text) from public,anon;
grant execute on function public.edu_challenge_join(text,text) to authenticated;

-- Return the current/recent challenge, with this player's saved responses only.
-- Answer keys and the opponent's live score are never sent to the browser.
create or replace function public.edu_challenge_current(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=public.edu_challenge_assert_access(p_password);
  v_c public.edu_challenges%rowtype; v_id uuid; v_questions jsonb:='[]'::jsonb;
  v_opponent_name text; v_my_score numeric:=0; v_opponent_score numeric:=0;
  v_reward jsonb; v_rating jsonb; v_my_submitted boolean:=false;
begin
  update public.edu_challenges set status='expired',completed_at=now()
    where status='waiting' and expires_at<=now() and creator_id=v_user;
  for v_id in select id from public.edu_challenges
    where status='active' and ends_at<=now() and (creator_id=v_user or opponent_id=v_user) loop
    perform public.edu_challenge_finalize(v_id,'time_up');
  end loop;
  select * into v_c from public.edu_challenges
    where creator_id=v_user or opponent_id=v_user
    order by created_at desc limit 1;
  if not found then return jsonb_build_object('active',false,'server_now',clock_timestamp()); end if;
  if v_c.opponent_id is not null then
    select coalesce(display_name,username,'EDU-AFRIKA Student') into v_opponent_name from public.profiles where id=case when v_user=v_c.creator_id then v_c.opponent_id else v_c.creator_id end;
  end if;
  v_my_submitted:=case when v_user=v_c.creator_id then v_c.creator_submitted_at is not null else v_c.opponent_submitted_at is not null end;
  if v_c.status='active' then
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'order',q.question_order,'question',q.question_text,
      'subject_code',q.subject_code,'question_type',q.question_type,'options',q.options,'marks',q.marks,
      'answer',coalesce(a.answer_text,'')) order by q.question_order),'[]'::jsonb)
      into v_questions
      from public.edu_challenge_questions q
      left join public.edu_challenge_answers a on a.challenge_question_id=q.id and a.student_id=v_user
      where q.challenge_id=v_c.id;
    select score into v_my_score from public.edu_challenge_calculate_score(v_c.id,v_user);
  elsif v_c.status in ('completed','forfeited') then
    v_my_score:=case when v_user=v_c.creator_id then coalesce(v_c.creator_score,0) else coalesce(v_c.opponent_score,0) end;
    v_opponent_score:=case when v_user=v_c.creator_id then coalesce(v_c.opponent_score,0) else coalesce(v_c.creator_score,0) end;
  end if;
  select jsonb_build_object('xp_delta',xp_delta,'rating_delta',rating_delta,'correct_count',correct_count,'badge_codes',badge_codes)
    into v_reward from public.edu_challenge_rewards where challenge_id=v_c.id and student_id=v_user;
  select jsonb_build_object('rating',rating,'total_xp',total_xp,'wins',wins,'losses',losses,'draws',draws,
    'win_streak',win_streak,'best_win_streak',best_win_streak) into v_rating
    from public.edu_challenge_ratings where user_id=v_user;
  return jsonb_build_object('active',true,'server_now',clock_timestamp(),'challenge',jsonb_build_object(
    'id',v_c.id,'exam_code',v_c.exam_code,'programme_id',v_c.programme_id,'subject_codes',v_c.subject_codes,
    'question_count',v_c.question_count,'duration_minutes',v_c.duration_minutes,'status',v_c.status,
    'result_kind',v_c.result_kind,'creator_id',v_c.creator_id,'opponent_id',v_c.opponent_id,
    'is_creator',v_user=v_c.creator_id,'opponent_name',coalesce(v_opponent_name,'Waiting for opponent'),
    'created_at',v_c.created_at,'expires_at',v_c.expires_at,'started_at',v_c.started_at,'ends_at',v_c.ends_at,
    'is_me_submitted',v_my_submitted,'creator_submitted',v_c.creator_submitted_at is not null,
    'opponent_submitted',v_c.opponent_submitted_at is not null,
    'my_score',v_my_score,'opponent_score',case when v_c.status in ('completed','forfeited') then v_opponent_score else null end,
    'winner_id',v_c.winner_id,'loser_id',v_c.loser_id,'forfeit_by',v_c.forfeit_by,
    'i_won',v_c.winner_id=v_user,'is_draw',v_c.result_kind='draw',
    'questions',v_questions,'reward',v_reward,'rating',v_rating
  ));
end;
$$;
revoke all on function public.edu_challenge_current(text) from public,anon;
grant execute on function public.edu_challenge_current(text) to authenticated;

-- Save one answer. The question and participant membership are verified server-side.
create or replace function public.edu_challenge_save_answer(p_password text,p_challenge_id uuid,p_question_id uuid,p_answer text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_c public.edu_challenges%rowtype;
begin
  select * into v_c from public.edu_challenges where id=p_challenge_id for update;
  if not found or v_c.status<>'active' then raise exception 'This challenge is no longer active.'; end if;
  if v_user<>v_c.creator_id and (v_c.opponent_id is null or v_user<>v_c.opponent_id) then raise exception 'You are not a participant in this challenge.'; end if;
  if v_c.ends_at<=now() then raise exception 'The challenge countdown has ended. Refresh the result to see the final score.'; end if;
  if (v_user=v_c.creator_id and v_c.creator_submitted_at is not null) or (v_user=v_c.opponent_id and v_c.opponent_submitted_at is not null) then
    raise exception 'You have already submitted your challenge answers.';
  end if;
  if not exists(select 1 from public.edu_challenge_questions where id=p_question_id and challenge_id=v_c.id) then raise exception 'This question does not belong to your challenge.'; end if;
  insert into public.edu_challenge_answers(challenge_id,challenge_question_id,student_id,answer_text,answered_at)
    values(v_c.id,p_question_id,v_user,left(coalesce(p_answer,''),1000),now())
    on conflict(challenge_question_id,student_id) do update set answer_text=excluded.answer_text,answered_at=now();
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.edu_challenge_save_answer(text,uuid,uuid,text) from public,anon;
grant execute on function public.edu_challenge_save_answer(text,uuid,uuid,text) to authenticated;

-- Submit locks this player's answers. When both submit, the server scores and settles.
create or replace function public.edu_challenge_submit(p_password text,p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_c public.edu_challenges%rowtype;
begin
  select * into v_c from public.edu_challenges where id=p_challenge_id for update;
  if not found then raise exception 'Challenge not found.'; end if;
  if v_user<>v_c.creator_id and (v_c.opponent_id is null or v_user<>v_c.opponent_id) then raise exception 'You are not a participant in this challenge.'; end if;
  if v_c.status='waiting' then raise exception 'The challenge has not started. Wait for your opponent to accept the code.'; end if;
  if v_c.status='active' and v_c.ends_at<=now() then perform public.edu_challenge_finalize(v_c.id,'time_up');
  elsif v_c.status='active' then
    if v_user=v_c.creator_id then update public.edu_challenges set creator_submitted_at=coalesce(creator_submitted_at,now()) where id=v_c.id returning * into v_c;
    else update public.edu_challenges set opponent_submitted_at=coalesce(opponent_submitted_at,now()) where id=v_c.id returning * into v_c; end if;
    if v_c.creator_submitted_at is not null and v_c.opponent_submitted_at is not null then perform public.edu_challenge_finalize(v_c.id,'score'); end if;
  end if;
  return public.edu_challenge_current(p_password);
end;
$$;
revoke all on function public.edu_challenge_submit(text,uuid) from public,anon;
grant execute on function public.edu_challenge_submit(text,uuid) to authenticated;

-- Giving up immediately awards the win to the opponent, regardless of points.
create or replace function public.edu_challenge_forfeit(p_password text,p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_c public.edu_challenges%rowtype; v_winner uuid;
  v_creator_score numeric:=0; v_opponent_score numeric:=0;
begin
  select * into v_c from public.edu_challenges where id=p_challenge_id for update;
  if not found or v_c.status<>'active' then raise exception 'This challenge is no longer active.'; end if;
  if v_user<>v_c.creator_id and (v_c.opponent_id is null or v_user<>v_c.opponent_id) then raise exception 'You are not a participant in this challenge.'; end if;
  if v_c.ends_at<=now() then perform public.edu_challenge_finalize(v_c.id,'time_up'); return public.edu_challenge_current(p_password); end if;
  v_winner:=case when v_user=v_c.creator_id then v_c.opponent_id else v_c.creator_id end;
  select score into v_creator_score from public.edu_challenge_calculate_score(v_c.id,v_c.creator_id);
  select score into v_opponent_score from public.edu_challenge_calculate_score(v_c.id,v_c.opponent_id);
  update public.edu_challenges set status='forfeited',result_kind='forfeit',forfeit_by=v_user,winner_id=v_winner,loser_id=v_user,
    creator_score=v_creator_score,opponent_score=v_opponent_score,completed_at=now() where id=v_c.id;
  perform public.edu_challenge_issue_rewards(v_c.id);
  return public.edu_challenge_current(p_password);
end;
$$;
revoke all on function public.edu_challenge_forfeit(text,uuid) from public,anon;
grant execute on function public.edu_challenge_forfeit(text,uuid) to authenticated;


-- Let the creator revoke a waiting invitation if it was shared incorrectly.
create or replace function public.edu_challenge_cancel(p_password text,p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_c public.edu_challenges%rowtype;
begin
  select * into v_c from public.edu_challenges where id=p_challenge_id for update;
  if not found or v_c.creator_id<>v_user then raise exception 'Only the challenge creator can cancel this invitation.'; end if;
  if v_c.status<>'waiting' then raise exception 'Only a challenge that is still waiting for an opponent can be cancelled.'; end if;
  update public.edu_challenges set status='cancelled',completed_at=now() where id=v_c.id;
  return public.edu_challenge_current(p_password);
end;
$$;
revoke all on function public.edu_challenge_cancel(text,uuid) from public,anon;
grant execute on function public.edu_challenge_cancel(text,uuid) to authenticated;

-- Compact top-performer board. Only public display names and gamified statistics appear.
create or replace function public.edu_challenge_leaderboard(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('is_me',r.user_id=v_user,'name',case
      when r.user_id=v_user or p.profile_visibility='public' then coalesce(p.display_name,p.username,'EDU-AFRIKA Student')
      when p.profile_visibility='friends' and exists(select 1 from public.friendships f where (f.user_a=v_user and f.user_b=r.user_id) or (f.user_a=r.user_id and f.user_b=v_user)) then coalesce(p.display_name,p.username,'EDU-AFRIKA Student')
      else 'Private student' end,
    'rating',r.rating,'total_xp',r.total_xp,'wins',r.wins,'losses',r.losses,'draws',r.draws)
    order by r.total_xp desc,r.rating desc,r.wins desc),'[]'::jsonb)
    into v_rows from (select * from public.edu_challenge_ratings order by total_xp desc,rating desc,wins desc limit 10) r
    left join public.profiles p on p.id=r.user_id;
  return v_rows;
end;
$$;
revoke all on function public.edu_challenge_leaderboard(text) from public,anon;
grant execute on function public.edu_challenge_leaderboard(text) to authenticated;

comment on table public.edu_challenges is 'One-to-one EDU-AFRIKA challenge matches. Invite codes are stored only as one-way hashes.';
comment on table public.edu_challenge_questions is 'Server-side challenge question snapshots including private answer keys.';
comment on table public.edu_challenge_rewards is 'Idempotent XP and rating reward ledger for challenge outcomes.';


create or replace function public.edu_challenge_my_stats(p_password text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.edu_challenge_assert_access(p_password); v_result jsonb;
begin
  select jsonb_build_object('rating',rating,'total_xp',total_xp,'wins',wins,'losses',losses,'draws',draws,
    'win_streak',win_streak,'best_win_streak',best_win_streak)
    into v_result from public.edu_challenge_ratings where user_id=v_user;
  return coalesce(v_result,jsonb_build_object('rating',1000,'total_xp',0,'wins',0,'losses',0,'draws',0,'win_streak',0,'best_win_streak',0));
end;
$$;
revoke all on function public.edu_challenge_my_stats(text) from public,anon;
grant execute on function public.edu_challenge_my_stats(text) to authenticated;
