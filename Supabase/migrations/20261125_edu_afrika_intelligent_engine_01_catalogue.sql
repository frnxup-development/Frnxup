-- EDU-AFRIKA intelligent engine migration Part 1/7: exam catalogue and course-combination records.
-- Run after the previous numbered migration. Execute this file by itself.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Catalogue configuration
-- -----------------------------------------------------------------------------
alter table public.edu_exam_types
  add column if not exists requires_course_selection boolean not null default false,
  add column if not exists course_selection_label text not null default 'Course / programme combination';

update public.edu_exam_types
set requires_course_selection = true,
    course_selection_label = case
      when code='JAMB' then 'Select your intended course / programme'
      when code='WAEC' then 'Select your subject combination / stream'
      when code='NECO' then 'Select your course / subject combination'
      when code='NABTEB' then 'Select your trade / programme combination'
      when code='POST_UTME' then 'Select your intended course / programme'
      else course_selection_label end
where code in ('JAMB','WAEC','NECO','NABTEB','POST_UTME');

insert into public.edu_subjects(code,name,category,sort_order) values
 ('MARKETING','Marketing','Commercial',41),
 ('PHYSICAL_EDUCATION','Physical Education','Sciences',42),
 ('HEALTH_EDUCATION','Health Education','Sciences',43),
 ('NIGERIAN_HISTORY','Nigerian History','Arts & Humanities',44),
 ('ISLAMIC_STUDIES','Islamic Studies','Religious Studies',45),
 ('ARABIC','Arabic','Languages',46),
 ('MUSIC','Music','Arts & Humanities',47),
 ('VISUAL_ART','Visual Art','Arts & Humanities',48),
 ('HOME_MANAGEMENT','Home Management','Technical',49),
 ('CATERING_CRAFT','Catering Craft Practice','Technical',50),
 ('FASHION_DESIGN','Fashion Design and Garment Making','Technical',51),
 ('LIVESTOCK_FARMING','Livestock Farming','Technical',52),
 ('BEAUTY_COSMETOLOGY','Beauty and Cosmetology','Technical',53),
 ('COMPUTER_HARDWARE','Computer Hardware and GSM Repairs','Technology',54),
 ('SOLAR_PV','Solar Photovoltaic Installation and Maintenance','Technical',55),
 ('HORTICULTURE','Horticulture and Crop Production','Technical',56),
 ('PHYSICAL_SCIENCE','Physical Science','Sciences',57),
 ('GENERAL_SCIENCE','General Science','Sciences',58),
 ('TRADE_STUDIES','Trade Studies','Technical',59),
 ('FINANCIAL_MANAGEMENT','Financial Management','Professional',60),
 ('AUDIT','Audit','Professional',61),
 ('TAX','Taxation','Professional',62),
 ('LAW','Law','Professional',63),
 ('CLINICAL_SCIENCES','Clinical Sciences','Professional',64),
 ('ANATOMY','Anatomy','Professional',65),
 ('PHARMACOLOGY','Pharmacology','Professional',66),
 ('NURSING','Nursing','Professional',67)
on conflict (code) do update set name=excluded.name,category=excluded.category,sort_order=excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Course / programme / subject-combination catalogue
-- Admins may configure course tracks for every examination, including institution-
-- specific JAMB and Post-UTME combinations and module-based international exams.
-- A student can only see combinations that are both active and verified.
-- -----------------------------------------------------------------------------
create table if not exists public.edu_exam_programmes (
  id uuid primary key default gen_random_uuid(),
  exam_code text not null references public.edu_exam_types(code) on delete cascade,
  programme_code text not null,
  programme_name text not null,
  programme_type text not null default 'course'
    check (programme_type in ('course','stream','trade','module','level','specialization','track')),
  institution_name text not null default '',
  syllabus_year integer,
  required_subject_codes text[] not null default '{}',
  allowed_subject_codes text[] not null default '{}',
  min_subject_count integer not null default 1 check (min_subject_count between 1 and 12),
  max_subject_count integer not null default 8 check (max_subject_count between 1 and 12),
  instructions text not null default '',
  selection_rules jsonb not null default '{"groups":[]}'::jsonb,
  source_url text not null default '',
  verification_note text not null default '',
  is_verified boolean not null default false,
  is_active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint edu_exam_programmes_natural_key unique(exam_code,programme_code,institution_name),
  constraint edu_exam_programmes_subject_count_order check (min_subject_count <= max_subject_count),
  constraint edu_exam_programmes_required_is_allowed check (required_subject_codes <@ allowed_subject_codes)
);
alter table public.edu_exam_programmes add column if not exists selection_rules jsonb not null default '{"groups":[]}'::jsonb;
alter table public.edu_exam_programmes drop constraint if exists edu_exam_programmes_active_verified_check;
alter table public.edu_exam_programmes add constraint edu_exam_programmes_active_verified_check
  check (not is_active or is_verified);
alter table public.edu_exam_programmes drop constraint if exists edu_exam_programmes_selection_rules_check;
alter table public.edu_exam_programmes add constraint edu_exam_programmes_selection_rules_check
  check (jsonb_typeof(selection_rules)='object' and (not (selection_rules ? 'groups') or jsonb_typeof(selection_rules->'groups')='array'));
alter table public.edu_exam_programmes drop constraint if exists edu_exam_programmes_verified_source_check;
alter table public.edu_exam_programmes add constraint edu_exam_programmes_verified_source_check
  check (not is_verified or (btrim(source_url)<>'' and btrim(verification_note)<>''));
alter table public.edu_exam_programmes drop constraint if exists edu_exam_programmes_verified_institution_check;
alter table public.edu_exam_programmes add constraint edu_exam_programmes_verified_institution_check
  check (not (is_verified and exam_code in ('JAMB','POST_UTME')) or btrim(institution_name)<>'');
alter table public.edu_exam_programmes drop constraint if exists edu_exam_programmes_verified_year_check;
alter table public.edu_exam_programmes add constraint edu_exam_programmes_verified_year_check
  check (not (is_verified and exam_code in ('JAMB','WAEC','NECO','NABTEB')) or syllabus_year is not null);

create index if not exists edu_exam_programmes_exam_active_idx
  on public.edu_exam_programmes(exam_code,is_active,is_verified);

alter table public.edu_exam_programmes enable row level security;
drop policy if exists edu_exam_programmes_student_read on public.edu_exam_programmes;
create policy edu_exam_programmes_student_read on public.edu_exam_programmes
  for select to authenticated using (is_active and is_verified);
drop policy if exists edu_exam_programmes_admin_all on public.edu_exam_programmes;
create policy edu_exam_programmes_admin_all on public.edu_exam_programmes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.edu_exam_programmes from anon,authenticated;
grant select,insert,update,delete on public.edu_exam_programmes to authenticated;

-- JAMB examples are intentionally seeded as unverified drafts. JAMB states that the
-- appropriate UTME combination is programme/institution-specific and directs users
-- to IBASS. Admins must verify each record against the selected institution in IBASS
-- before making it visible to students.
insert into public.edu_exam_programmes
  (exam_code,programme_code,programme_name,programme_type,required_subject_codes,allowed_subject_codes,min_subject_count,max_subject_count,source_url,verification_note,is_verified,is_active)
values
 ('JAMB','MEDICINE_SURGERY','Medicine and Surgery','course',array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for each institution before publishing.',false,false),
 ('JAMB','PHARMACY','Pharmacy','course',array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for each institution before publishing.',false,false),
 ('JAMB','NURSING','Nursing Science','course',array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for each institution before publishing.',false,false),
 ('JAMB','DENTISTRY','Dentistry','course',array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for each institution before publishing.',false,false),
 ('JAMB','MEDICAL_LAB','Medical Laboratory Science','course',array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],array['ENGLISH','BIOLOGY','CHEMISTRY','PHYSICS'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for each institution before publishing.',false,false),
 ('JAMB','ENGINEERING','Engineering','course',array['ENGLISH','MATHEMATICS','PHYSICS','CHEMISTRY'],array['ENGLISH','MATHEMATICS','PHYSICS','CHEMISTRY'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS and the exact engineering programme/institution.',false,false),
 ('JAMB','COMPUTER_SCIENCE','Computer Science','course',array['ENGLISH','MATHEMATICS','PHYSICS','CHEMISTRY'],array['ENGLISH','MATHEMATICS','PHYSICS','CHEMISTRY'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for the selected institution.',false,false),
 ('JAMB','ACCOUNTING','Accounting','course',array['ENGLISH','MATHEMATICS','ECONOMICS','ACCOUNTING'],array['ENGLISH','MATHEMATICS','ECONOMICS','ACCOUNTING'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for the selected institution.',false,false),
 ('JAMB','ECONOMICS','Economics','course',array['ENGLISH','MATHEMATICS','ECONOMICS','GOVERNMENT'],array['ENGLISH','MATHEMATICS','ECONOMICS','GOVERNMENT'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for the selected institution.',false,false),
 ('JAMB','LAW','Law','course',array['ENGLISH','LITERATURE','GOVERNMENT','CRS'],array['ENGLISH','LITERATURE','GOVERNMENT','CRS'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify the fourth subject and institution requirements in IBASS.',false,false),
 ('JAMB','MASS_COMMUNICATION','Mass Communication','course',array['ENGLISH','LITERATURE','GOVERNMENT','ECONOMICS'],array['ENGLISH','LITERATURE','GOVERNMENT','ECONOMICS'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for the selected institution.',false,false),
 ('JAMB','AGRICULTURE','Agriculture','course',array['ENGLISH','BIOLOGY','CHEMISTRY','AGRIC_SCIENCE'],array['ENGLISH','BIOLOGY','CHEMISTRY','AGRIC_SCIENCE'],4,4,'https://eligibility.jamb.gov.ng/','Draft common combination. Verify against IBASS for the selected institution.',false,false)
on conflict (exam_code,programme_code,institution_name) do nothing;

-- WAEC Nigeria confirms that for 2026 and 2027 the current core subjects are English
-- Language and General Mathematics; candidates select six or seven further subjects
-- to make eight or nine. The new curriculum subjects are not examined until 2028.
-- These four records provide guided study streams, not admission eligibility advice.
insert into public.edu_exam_programmes
  (exam_code,programme_code,programme_name,programme_type,syllabus_year,required_subject_codes,allowed_subject_codes,min_subject_count,max_subject_count,instructions,source_url,verification_note,is_verified,is_active)
values
 ('WAEC','SCIENCE_2026_2027','Science stream · WASSCE 2026–2027','stream',2026,array['ENGLISH','MATHEMATICS'],array['ENGLISH','MATHEMATICS','BIOLOGY','CHEMISTRY','PHYSICS','AGRIC_SCIENCE','FURTHER_MATHS','PHYSICAL_EDUCATION','HEALTH_EDUCATION','FOOD_NUTRITION','GEOGRAPHY','TECH_DRAWING','COMPUTER_STUDIES'],8,9,'Select English Language and General Mathematics, then choose six or seven other approved subjects for practice. Confirm your final registration choices with WAEC.','https://www.waecnigeria.org/node/102','Seeded from WAEC Nigeria entry regulations for 2026–2027. Recheck the official rules when the examination year changes.',false,false),
 ('WAEC','BUSINESS_2026_2027','Business / Commercial stream · WASSCE 2026–2027','stream',2026,array['ENGLISH','MATHEMATICS'],array['ENGLISH','MATHEMATICS','ACCOUNTING','COMMERCE','ECONOMICS','MARKETING','GOVERNMENT','GEOGRAPHY','LITERATURE','HISTORY','NIGERIAN_HISTORY','COMPUTER_STUDIES','FOOD_NUTRITION'],8,9,'Select English Language and General Mathematics, then choose six or seven other approved subjects. Confirm your final registration choices with WAEC.','https://www.waecnigeria.org/node/102','Seeded from WAEC Nigeria entry regulations for 2026–2027; subject choices are a practice pathway.',false,false),
 ('WAEC','HUMANITIES_2026_2027','Humanities / Arts stream · WASSCE 2026–2027','stream',2026,array['ENGLISH','MATHEMATICS'],array['ENGLISH','MATHEMATICS','NIGERIAN_HISTORY','GOVERNMENT','CRS','ISLAMIC_STUDIES','YORUBA','IGBO','HAUSA','FRENCH','ARABIC','VISUAL_ART','MUSIC','LITERATURE','GEOGRAPHY','ECONOMICS','HOME_MANAGEMENT','CATERING_CRAFT'],8,9,'Select English Language and General Mathematics, then choose six or seven other approved subjects. Confirm your final registration choices with WAEC.','https://www.waecnigeria.org/node/102','Seeded from WAEC Nigeria entry regulations for 2026–2027; subject choices are a practice pathway.',false,false),
 ('WAEC','TRADE_2026_2027','Technical / Trade stream · WASSCE 2026–2027','stream',2026,array['ENGLISH','MATHEMATICS'],array['ENGLISH','MATHEMATICS','TECH_DRAWING','COMPUTER_HARDWARE','SOLAR_PV','FASHION_DESIGN','LIVESTOCK_FARMING','BEAUTY_COSMETOLOGY','HORTICULTURE','AGRIC_SCIENCE','COMMERCE','ACCOUNTING','PHYSICS','CHEMISTRY','GEOGRAPHY'],8,9,'Select English Language and General Mathematics, then choose six or seven other approved subjects. Confirm your final registration choices with WAEC.','https://www.waecnigeria.org/node/102','Seeded from WAEC Nigeria entry regulations for 2026–2027; subject choices are a practice pathway.',false,false)
on conflict (exam_code,programme_code,institution_name) do nothing;

-- WAEC 2026–2027 subject groups: English + Mathematics are fixed core subjects;
-- candidates choose six or seven more from the pathway's listed options.
update public.edu_exam_programmes p
set selection_rules=jsonb_build_object(
  'total_min',8,'total_max',9,
  'groups',jsonb_build_array(
    jsonb_build_object('key','core','label','Core subjects','subject_codes',jsonb_build_array('ENGLISH','MATHEMATICS'),'min_select',2,'max_select',2),
    jsonb_build_object('key','additional','label','Additional registered subjects','subject_codes',to_jsonb(array_remove(array_remove(p.allowed_subject_codes,'ENGLISH'),'MATHEMATICS')),'min_select',6,'max_select',7)
  )
)
where p.exam_code='WAEC' and p.programme_code in ('SCIENCE_2026_2027','BUSINESS_2026_2027','HUMANITIES_2026_2027','TRADE_2026_2027');

-- NECO and NABTEB options are seeded as drafts. For NECO 2027 the official guide
-- says candidates take four cross-cutting compulsory subjects, 3-4 from their area
-- of specialization and one elective outside that field (8-9 total). The exact four
-- core subjects and each candidate's field choices must be confirmed from the live
-- official 2027 registration guide before an admin verifies these paths.
-- NABTEB's trade subject structures are trade-code-specific; use the current official
-- trade structure and verify each trade before publication.
insert into public.edu_exam_programmes
  (exam_code,programme_code,programme_name,programme_type,syllabus_year,required_subject_codes,allowed_subject_codes,min_subject_count,max_subject_count,instructions,source_url,verification_note,is_verified,is_active)
values
 ('NECO','SCIENCE_TRACK_2027','Science / Mathematics specialization · NECO 2027','stream',2027,'{}',array['ENGLISH','MATHEMATICS','CIVIC_EDUCATION','BIOLOGY','CHEMISTRY','PHYSICS','AGRIC_SCIENCE','FURTHER_MATHS','GEOGRAPHY','TECH_DRAWING','COMPUTER_STUDIES','FOOD_NUTRITION','GENERAL_SCIENCE','PHYSICAL_EDUCATION','HEALTH_EDUCATION'],8,9,'Draft 2027 practice pathway only. The current NECO guide requires four cross-cutting compulsory subjects, 3–4 subjects from the candidate''s specialization and one elective outside the field (8–9 total). Confirm the exact core subjects and eligible field/elective subjects in the current official registration guide before publishing.','https://neco.gov.ng/exams/ssce-internal','Draft only. Exact 2027 core/field subject codes must be checked against the current official NECO registration guide.',false,false),
 ('NECO','BUSINESS_TRACK_2027','Business specialization · NECO 2027','stream',2027,'{}',array['ENGLISH','MATHEMATICS','CIVIC_EDUCATION','ACCOUNTING','COMMERCE','ECONOMICS','MARKETING','BUSINESS_STUDIES','GOVERNMENT','GEOGRAPHY','COMPUTER_STUDIES','LITERATURE','GENERAL_PAPER'],8,9,'Draft 2027 practice pathway only. Follow the NECO structure: four cross-cutting compulsory subjects, 3–4 from specialization and one outside-field elective. Exact subjects must be verified from the current official guide.','https://neco.gov.ng/exams/ssce-internal','Draft only. Verify the exact 2027 subject structure before publishing.',false,false),
 ('NECO','ARTS_TRACK_2027','Arts / Humanities specialization · NECO 2027','stream',2027,'{}',array['ENGLISH','MATHEMATICS','CIVIC_EDUCATION','LITERATURE','GOVERNMENT','HISTORY','NIGERIAN_HISTORY','CRS','IRS','ISLAMIC_STUDIES','YORUBA','IGBO','HAUSA','FRENCH','ARABIC','GEOGRAPHY','ECONOMICS','MUSIC','VISUAL_ART','HOME_MANAGEMENT'],8,9,'Draft 2027 practice pathway only. Follow the NECO structure: four cross-cutting compulsory subjects, 3–4 from specialization and one outside-field elective. Exact subjects must be verified from the current official guide.','https://neco.gov.ng/exams/ssce-internal','Draft only. Verify the exact 2027 subject structure before publishing.',false,false),
 ('NABTEB','SCIENCE_TECHNICAL','Science and Technical trade pathway','trade',null,'{}',array['ENGLISH','MATHEMATICS','BIOLOGY','CHEMISTRY','PHYSICS','AGRIC_SCIENCE','TECH_DRAWING','COMPUTER_STUDIES','COMPUTER_HARDWARE','SOLAR_PV','TRADE_STUDIES'],7,9,'Draft practice pathway. NABTEB packages are trade-code-specific and include General Education, Trade Related, Trade Group and Elective components. Configure the exact trade code and subjects from the current NABTEB structure before publishing.','https://novdec.nabteb.gov.ng/docs/EntryStructureO.pdf','Draft only. Verify current trade code and component subjects against the current NABTEB structure for the selected examination session.',false,false),
 ('NABTEB','BUSINESS_TRADE','Business Studies trade pathway','trade',null,'{}',array['ENGLISH','MATHEMATICS','ACCOUNTING','COMMERCE','ECONOMICS','MARKETING','BUSINESS_STUDIES','TRADE_STUDIES'],7,9,'Draft practice pathway. Configure the exact trade code, General Education, Trade Related, Trade Group and Elective subjects before publishing.','https://novdec.nabteb.gov.ng/docs/EntryStructureO.pdf','Draft only. Verify current trade code and component subjects against the current NABTEB structure for the selected examination session.',false,false),
 ('NABTEB','VOCATIONAL_TRADE','Vocational / Trade pathway','trade',null,'{}',array['ENGLISH','MATHEMATICS','FASHION_DESIGN','LIVESTOCK_FARMING','BEAUTY_COSMETOLOGY','COMPUTER_HARDWARE','SOLAR_PV','HORTICULTURE','HOME_MANAGEMENT','CATERING_CRAFT','TRADE_STUDIES'],7,9,'Draft practice pathway. Configure the exact trade code, General Education, Trade Related, Trade Group and Elective subjects before publishing.','https://novdec.nabteb.gov.ng/docs/EntryStructureO.pdf','Draft only. Verify current trade code and component subjects against the current NABTEB structure for the selected examination session.',false,false)
on conflict (exam_code,programme_code,institution_name) do nothing;

-- -----------------------------------------------------------------------------
