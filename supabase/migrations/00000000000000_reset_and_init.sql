-- ROSHNI — FULL RESET + REBUILD
-- Destroys any existing tables/policies/triggers in this project, then rebuilds
-- everything deliberately. Run this via Supabase Dashboard → SQL Editor → New Query → Run.
-- ONLY run this on the new project under your own account — it is destructive.

-- =========================================================
-- STEP 0 — TEARDOWN
-- =========================================================

-- Drop the signup trigger + function first (depends on nothing else)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Drop tables — CASCADE removes their policies and foreign-key dependents automatically
DROP TABLE IF EXISTS mcqs CASCADE;
DROP TABLE IF EXISTS chapters CASCADE;
DROP TABLE IF EXISTS quiz_attempts CASCADE;
DROP TABLE IF EXISTS user_progress CASCADE;
DROP TABLE IF EXISTS past_papers CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- NOTE on storage buckets: don't delete these via SQL. Go to Dashboard → Storage,
-- and delete any buckets there manually (one click each). Deleting bucket rows via
-- raw SQL can leave orphaned files behind in the storage backend — the dashboard
-- delete button cleans it up properly. If no buckets exist yet, nothing to do here.

-- =========================================================
-- STEP 1 — REBUILD: PROFILES
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  class_level TEXT,
  board TEXT NOT NULL DEFAULT 'balochistan',
  district TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  xp INTEGER NOT NULL DEFAULT 0,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_study_date DATE,
  mcq_used_today INTEGER NOT NULL DEFAULT 0,
  ai_used_today INTEGER NOT NULL DEFAULT 0,
  mcq_reset_date DATE,
  ai_reset_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, name, board, mcq_reset_date, ai_reset_date)
  VALUES (new.id, '', '', 'balochistan', CURRENT_DATE, CURRENT_DATE)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- STEP 2 — SUBJECTS
-- =========================================================
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  emoji TEXT,
  color_class TEXT NOT NULL,
  class_level TEXT NOT NULL,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  mcq_count INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subjects_select_all" ON subjects FOR SELECT TO authenticated USING (true);
-- Deliberately no write policy — only you write this, via SQL editor / dashboard.

-- =========================================================
-- STEP 3 — CHAPTERS
-- =========================================================
CREATE TABLE chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  mcq_count INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT true,
  summary TEXT,
  key_points TEXT[],
  important_topics TEXT[]
);
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chapters_select_all" ON chapters FOR SELECT TO authenticated USING (true);

-- =========================================================
-- STEP 4 — MCQS
-- =========================================================
CREATE TABLE mcqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID REFERENCES chapters(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT NOT NULL,
  explanation TEXT,
  difficulty TEXT NOT NULL DEFAULT 'easy',
  mcq_type TEXT NOT NULL DEFAULT 'easy',
  year_tag INTEGER,
  is_repeated BOOLEAN NOT NULL DEFAULT false,
  is_free BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE mcqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcqs_select_all" ON mcqs FOR SELECT TO authenticated USING (true);

-- =========================================================
-- STEP 5 — QUIZ ATTEMPTS (private, per-user)
-- =========================================================
CREATE TABLE quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  time_taken INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  answers JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quiz_attempts_own" ON quiz_attempts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================================
-- STEP 6 — USER PROGRESS (private, per-user)
-- =========================================================
CREATE TABLE user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  chapter_id UUID REFERENCES chapters(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  completion_pct INTEGER NOT NULL DEFAULT 0,
  notes_read BOOLEAN NOT NULL DEFAULT false,
  mcqs_attempted INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, chapter_id)
);
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_progress_own" ON user_progress FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================================
-- STEP 7 — PAST PAPERS (read-only to students, you write via dashboard)
-- =========================================================
CREATE TABLE past_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  board TEXT NOT NULL DEFAULT 'balochistan',
  title TEXT NOT NULL,
  is_free BOOLEAN NOT NULL DEFAULT false,
  is_predicted BOOLEAN NOT NULL DEFAULT false,
  mcq_count INTEGER NOT NULL DEFAULT 75
);
ALTER TABLE past_papers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "past_papers_select_all" ON past_papers FOR SELECT TO authenticated USING (true);

-- =========================================================
-- STEP 8 — GRANTS (table-level access; RLS above is the real gatekeeper)
-- =========================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- =========================================================
-- STEP 9 — SEED: Class 9 Balochistan Board subjects
-- =========================================================
INSERT INTO subjects (name, emoji, color_class, class_level, chapter_count, mcq_count) VALUES
  ('Biology',     '🧬', 'bio',  'Class 9', 7, 16),
  ('Chemistry',   '⚗️', 'chem', 'Class 9', 0, 0),
  ('Physics',     '⚡', 'phy',  'Class 9', 0, 0),
  ('Mathematics', '📐', 'math', 'Class 9', 0, 0),
  ('English',     '📖', 'eng',  'Class 9', 0, 0),
  ('Urdu',        '🖊️', 'urdu', 'Class 9', 0, 0);

-- Biology chapters — first 3 free, matches your pricing doc
WITH bio AS (SELECT id FROM subjects WHERE name='Biology' AND class_level='Class 9' LIMIT 1)
INSERT INTO chapters (subject_id, number, title, mcq_count, is_locked, summary, key_points, important_topics) VALUES
  ((SELECT id FROM bio), 1, 'Introduction to Biology',     45, false,
   'Biology is the scientific study of life and living organisms. It covers the diversity, structure, function, growth, origin, evolution, and distribution of living organisms.',
   ARRAY['Biology is the study of life','Branches include botany, zoology, microbiology','Scientific method is used in biology','Biologists use observation and experimentation'],
   ARRAY['Definition of Biology','Branches of Biology','Scientific Method','Importance of Biology']),
  ((SELECT id FROM bio), 2, 'Solving a Biological Problem', 52, false,
   'This chapter covers the scientific method and how biologists solve problems through observation, hypothesis, experimentation and conclusion.',
   ARRAY['Hypothesis must be testable','Control group vs experimental group','Data must be recorded accurately','Conclusion based on data only'],
   ARRAY['Scientific Method Steps','Hypothesis Formation','Controlled Experiments','Data Analysis']),
  ((SELECT id FROM bio), 3, 'Biodiversity',                68, false,
   'Biodiversity refers to the variety of life on Earth. This chapter covers classification systems and the importance of species diversity.',
   ARRAY['5 Kingdoms: Monera, Protista, Fungi, Plantae, Animalia','Binomial nomenclature by Linnaeus','Pakistan has high biodiversity','Threats to biodiversity: habitat loss, pollution'],
   ARRAY['5 Kingdom Classification','Binomial Nomenclature','Endangered Species','Conservation']),
  ((SELECT id FROM bio), 4, 'Cells and Cell Organelles',   72, true,
   'The cell is the basic unit of life. This chapter explains prokaryotic and eukaryotic cells and the function of each organelle.',
   ARRAY['Cell is the basic unit of life','Prokaryotic cells have no nucleus','Eukaryotic cells have membrane-bound nucleus','Mitochondria produces ATP energy'],
   ARRAY['Cell Theory','Prokaryote vs Eukaryote','Mitochondria function','Ribosome function','Golgi apparatus']),
  ((SELECT id FROM bio), 5, 'Cell Cycle',                  60, true,
   'The cell cycle is the series of events by which a cell grows and divides. It includes Interphase and the Mitotic phase.',
   ARRAY['Cell cycle: Interphase + Mitotic phase','DNA replication occurs in S phase','Mitosis produces 2 identical daughter cells','Checkpoints ensure accuracy'],
   ARRAY['Phases of Cell Cycle','Interphase sub-phases','Mitosis stages','Checkpoints']),
  ((SELECT id FROM bio), 6, 'Enzymes',                     55, true,
   'Enzymes are biological catalysts that speed up chemical reactions. They are specific to their substrates.',
   ARRAY['Enzymes are proteins','Lock and key model','Enzymes are not consumed in reactions','Temperature and pH affect enzyme activity'],
   ARRAY['Enzyme definition','Lock and Key model','Factors affecting enzymes','Enzyme denaturation']),
  ((SELECT id FROM bio), 7, 'Bioenergetics',               64, true,
   'Bioenergetics covers how living organisms obtain and use energy. Photosynthesis and respiration are the key processes.',
   ARRAY['Photosynthesis: 6CO2 + 6H2O → C6H12O6 + 6O2','Respiration releases energy as ATP','Aerobic respiration needs oxygen','Anaerobic occurs without oxygen'],
   ARRAY['Photosynthesis equation','Respiration types','ATP structure','Light and dark reactions']);

-- MCQs for Biology Ch1
WITH ch1 AS (
  SELECT ch.id as chapter_id, s.id as subject_id
  FROM chapters ch JOIN subjects s ON ch.subject_id=s.id
  WHERE s.name='Biology' AND s.class_level='Class 9' AND ch.number=1 LIMIT 1
)
INSERT INTO mcqs (chapter_id, subject_id, question, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, mcq_type, is_free)
SELECT chapter_id, subject_id, q.question, q.a, q.b, q.c, q.d, q.correct, q.explanation, q.difficulty, q.mcq_type, true
FROM ch1, (VALUES
  ('Biology is the study of', 'Plants only', 'Animals only', 'Life and living organisms', 'Microorganisms only', 'C', 'Biology comes from Greek: bios (life) + logos (study). It covers all living organisms.', 'easy', 'easy'),
  ('Which of the following is NOT a branch of biology?', 'Botany', 'Zoology', 'Geology', 'Microbiology', 'C', 'Geology is the study of Earth, not a branch of biology. The main branches are botany, zoology and microbiology.', 'easy', 'easy'),
  ('The basic unit of life is the', 'Tissue', 'Organ', 'Cell', 'Organism', 'C', 'The cell theory states that the cell is the basic structural and functional unit of all living organisms.', 'easy', 'easy'),
  ('Binomial nomenclature was introduced by', 'Darwin', 'Mendel', 'Linnaeus', 'Pasteur', 'C', 'Carl Linnaeus developed the two-name (genus + species) system for naming organisms.', 'easy', 'board'),
  ('Which level of organization is just above the organ?', 'Tissue', 'Organ system', 'Cell', 'Organism', 'B', 'The hierarchy is: Cell → Tissue → Organ → Organ System → Organism.', 'medium', 'easy'),
  ('DNA stands for', 'Deoxyribose Nucleic Acid', 'Deoxyribonucleic Acid', 'Dinitrogen Acid', 'Double Nitrogen Acid', 'B', 'DNA = Deoxyribonucleic Acid. It carries genetic information in all living organisms.', 'easy', 'easy'),
  ('The study of heredity and variation is called', 'Ecology', 'Physiology', 'Genetics', 'Taxonomy', 'C', 'Genetics is the branch of biology that studies heredity (how traits pass from parents to offspring) and variation.', 'easy', 'easy'),
  ('Which kingdom contains organisms that are prokaryotic?', 'Protista', 'Fungi', 'Monera', 'Plantae', 'C', 'Monera (now Bacteria and Archaea) contains prokaryotes — organisms without a true nucleus.', 'medium', 'board')
) AS q(question, a, b, c, d, correct, explanation, difficulty, mcq_type);

-- MCQs for Biology Ch5 (Cell Cycle)
WITH ch5 AS (
  SELECT ch.id as chapter_id, s.id as subject_id
  FROM chapters ch JOIN subjects s ON ch.subject_id=s.id
  WHERE s.name='Biology' AND s.class_level='Class 9' AND ch.number=5 LIMIT 1
)
INSERT INTO mcqs (chapter_id, subject_id, question, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, mcq_type, is_free)
SELECT chapter_id, subject_id, q.question, q.a, q.b, q.c, q.d, q.correct, q.explanation, q.difficulty, q.mcq_type, true
FROM ch5, (VALUES
  ('DNA replication occurs in which phase?', 'G1 phase', 'S phase of Interphase', 'G2 phase', 'M phase', 'B', 'DNA synthesis (replication) occurs during the Synthesis (S) sub-phase of Interphase. This doubles the DNA content.', 'easy', 'easy'),
  ('Mitosis produces how many daughter cells?', 'One', 'Two', 'Four', 'Eight', 'B', 'Mitosis produces exactly 2 genetically identical daughter cells with the same chromosome number as the parent.', 'easy', 'easy'),
  ('Plant cells lack which structure during division?', 'Nucleus', 'Centrioles', 'Chromosomes', 'Spindle fibers', 'B', 'Plant cells lack centrioles. Their spindle forms without centrioles, unlike animal cells.', 'medium', 'board'),
  ('The powerhouse of the cell is', 'Ribosome', 'Nucleus', 'Mitochondria', 'Golgi body', 'C', 'Mitochondria produce ATP through cellular respiration, earning the nickname powerhouse of the cell.', 'easy', 'easy'),
  ('Which stage of mitosis involves chromosome alignment at the equator?', 'Prophase', 'Anaphase', 'Metaphase', 'Telophase', 'C', 'During Metaphase, chromosomes align at the metaphase plate (cell equator), maximally condensed.', 'medium', 'easy'),
  ('Meiosis produces how many daughter cells?', 'Two', 'Three', 'Four', 'Eight', 'C', 'Meiosis produces 4 haploid daughter cells — genetically different due to crossing over and independent assortment.', 'easy', 'easy'),
  ('Human body cells contain how many chromosomes?', '23', '46', '48', '92', 'B', 'Human somatic (body) cells are diploid with 46 chromosomes (23 pairs). Gametes have 23 (haploid).', 'easy', 'board'),
  ('The cell cycle checkpoint ensures', 'Cell grows faster', 'DNA errors are corrected before division', 'More ATP is produced', 'Chromosomes are destroyed', 'B', 'Checkpoints are control mechanisms that ensure the cell cycle proceeds only when conditions are right — preventing errors.', 'hard', 'conceptual')
) AS q(question, a, b, c, d, correct, explanation, difficulty, mcq_type);

-- Past papers — last 3 actual years free, matches pricing doc
WITH bio AS (SELECT id FROM subjects WHERE name='Biology' AND class_level='Class 9' LIMIT 1)
INSERT INTO past_papers (subject_id, year, board, title, is_free, is_predicted, mcq_count) VALUES
  ((SELECT id FROM bio), 2025, 'balochistan', 'Biology 2025', true,  false, 75),
  ((SELECT id FROM bio), 2024, 'balochistan', 'Biology 2024', true,  false, 75),
  ((SELECT id FROM bio), 2023, 'balochistan', 'Biology 2023', true,  false, 75),
  ((SELECT id FROM bio), 2022, 'balochistan', 'Biology 2022', false, false, 75),
  ((SELECT id FROM bio), 2021, 'balochistan', 'Biology 2021', false, false, 75),
  ((SELECT id FROM bio), 2026, 'balochistan', 'Most Expected Paper 2026', false, true, 75);
