-- Add the seventh reaction choice to post likes.
-- Existing users' reactions are preserved.
begin;

do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.post_reactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reaction%'
  loop
    execute format('alter table public.post_reactions drop constraint %I', constraint_row.conname);
  end loop;
end $$;

alter table public.post_reactions
  add constraint frnxup_post_reactions_reaction_check
  check (reaction in ('like','love','laugh','wow','sad','angry','support'));

commit;
