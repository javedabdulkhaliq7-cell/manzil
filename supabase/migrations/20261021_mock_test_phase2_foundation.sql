-- Phase 2 foundation for Mock Test persistence and server creation flow.
-- This migration creates the saved-test tables, recipe tables, print-event table,
-- and the server-side creation helpers needed before the in-app and print flows
-- can be fully wired up.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. Mock test persistence
-- =========================================================
CREATE TABLE IF NOT EXISTS public.mock_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'chapter', 'multi', 'subject_mix', 'all_mix',
    'exercise_student', 'exercise_teacher'
  )),
  chapter_ids UUID[] NOT NULL DEFAULT '{}',
  recipe JSONB NOT NULL DEFAULT '{}',
  questions JSONB NOT NULL DEFAULT '[]',
  total_marks INTEGER NOT NULL DEFAULT 0,
  time_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mock_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mock_tests_select_own"
  ON public.mock_tests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "mock_tests_no_client_write"
  ON public.mock_tests
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "mock_tests_no_client_update"
  ON public.mock_tests
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "mock_tests_no_client_delete"
  ON public.mock_tests
  FOR DELETE
  TO authenticated
  USING (false);

CREATE TABLE IF NOT EXISTS public.mock_test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mock_test_id UUID NOT NULL REFERENCES public.mock_tests(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  time_taken INTEGER NOT NULL DEFAULT 0,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mock_test_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mock_test_attempts_select_own"
  ON public.mock_test_attempts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "mock_test_attempts_no_client_write"
  ON public.mock_test_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "mock_test_attempts_no_client_update"
  ON public.mock_test_attempts
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "mock_test_attempts_no_client_delete"
  ON public.mock_test_attempts
  FOR DELETE
  TO authenticated
  USING (false);

-- =========================================================
-- 2. Recipe + type-map tables
-- =========================================================
CREATE TABLE IF NOT EXISTS public.subject_type_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  normalized_type TEXT NOT NULL,
  is_drawn BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.subject_type_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subject_type_map_select_authenticated"
  ON public.subject_type_map
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "subject_type_map_no_client_write"
  ON public.subject_type_map
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.test_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mock_test', 'exercise_student', 'exercise_teacher')),
  section_name TEXT NOT NULL,
  recipe_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  marks INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  min_pool INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.test_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "test_recipes_select_authenticated"
  ON public.test_recipes
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "test_recipes_no_client_write"
  ON public.test_recipes
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================================================
-- 3. Print activity tracking
-- =========================================================
CREATE TABLE IF NOT EXISTS public.print_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mock_test_id UUID REFERENCES public.mock_tests(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('question_paper', 'answer_key')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.print_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "print_events_select_own"
  ON public.print_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "print_events_no_client_write"
  ON public.print_events
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "print_events_no_client_update"
  ON public.print_events
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "print_events_no_client_delete"
  ON public.print_events
  FOR DELETE
  TO authenticated
  USING (false);

-- =========================================================
-- 4. Server-side creation helpers
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_mock_test(
  p_subject_id UUID,
  p_kind TEXT,
  p_chapter_ids UUID[] DEFAULT '{}',
  p_recipe JSONB DEFAULT '{}',
  p_questions JSONB DEFAULT '[]',
  p_total_marks INTEGER DEFAULT 0,
  p_time_minutes INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_kind NOT IN ('chapter', 'multi', 'subject_mix', 'all_mix', 'exercise_student', 'exercise_teacher') THEN
    RAISE EXCEPTION 'Invalid mock test kind';
  END IF;

  IF jsonb_typeof(COALESCE(p_questions, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_questions, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Questions are required';
  END IF;

  INSERT INTO public.mock_tests (
    user_id,
    subject_id,
    kind,
    chapter_ids,
    recipe,
    questions,
    total_marks,
    time_minutes
  ) VALUES (
    v_user_id,
    p_subject_id,
    p_kind,
    COALESCE(p_chapter_ids, '{}'),
    COALESCE(p_recipe, '{}'::jsonb),
    COALESCE(p_questions, '[]'::jsonb),
    COALESCE(p_total_marks, 0),
    COALESCE(p_time_minutes, 0)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_mock_test(UUID, TEXT, UUID[], JSONB, JSONB, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mock_test(UUID, TEXT, UUID[], JSONB, JSONB, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_print(
  p_kind TEXT,
  p_mock_test_id UUID DEFAULT NULL,
  p_subject_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_kind NOT IN ('question_paper', 'answer_key') THEN
    RAISE EXCEPTION 'Invalid print kind';
  END IF;

  INSERT INTO public.print_events (
    user_id,
    mock_test_id,
    subject_id,
    kind
  ) VALUES (
    v_user_id,
    p_mock_test_id,
    p_subject_id,
    p_kind
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_print(TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_print(TEXT, UUID, UUID) TO authenticated;

-- =========================================================
-- 5. Default mock-test recipe seed (data-driven default)
-- =========================================================
INSERT INTO public.test_recipes (subject_id, kind, section_name, recipe_count, attempt_count, marks, order_index, min_pool)
VALUES
  (NULL, 'mock_test', 'mcq', 10, 10, 1, 1, 3),
  (NULL, 'mock_test', 'fill_blank', 5, 5, 1, 2, 3),
  (NULL, 'mock_test', 'short', 6, 5, 2, 3, 3),
  (NULL, 'mock_test', 'long', 2, 1, 5, 4, 1),
  (NULL, 'mock_test', 'numerical', 2, 1, 4, 5, 1),
  (NULL, 'mock_test', 'tf', 5, 5, 1, 6, 3),
  (NULL, 'mock_test', 'translation', 5, 5, 1, 7, 3)
ON CONFLICT DO NOTHING;

-- =========================================================
-- 6. Grant table usage to authenticated for the server-side access path
-- =========================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.mock_tests TO authenticated;
GRANT SELECT ON TABLE public.mock_test_attempts TO authenticated;
GRANT SELECT ON TABLE public.test_recipes TO authenticated;
GRANT SELECT ON TABLE public.subject_type_map TO authenticated;
GRANT SELECT ON TABLE public.print_events TO authenticated;

-- End of migration.
