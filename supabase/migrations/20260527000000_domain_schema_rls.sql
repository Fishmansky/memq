-- MemQ domain schema + RLS (F-01)
-- Tables: algorithm_lists, algorithms, practice_sessions, algorithm_mastery

-- algorithm_lists
-- is_system=true rows are pre-built content (user_id NULL); is_system=false are user-owned
CREATE TABLE public.algorithm_lists (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
    is_system   boolean     NOT NULL DEFAULT false,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT algorithm_lists_ownership_check
        CHECK (
            (is_system = true  AND user_id IS NULL) OR
            (is_system = false AND user_id IS NOT NULL)
        )
);

-- algorithms
CREATE TABLE public.algorithms (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id     uuid        NOT NULL REFERENCES public.algorithm_lists(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    moves       text        NOT NULL,
    position    integer     NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
-- btree index on moves enables O(1) exact-match duplicate detection (FR-015)
CREATE INDEX algorithms_moves_idx ON public.algorithms (moves);

-- practice_sessions: append-only; no UPDATE policy by design
CREATE TABLE public.practice_sessions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    algorithm_id  uuid        NOT NULL REFERENCES public.algorithms(id) ON DELETE CASCADE,
    is_clean      boolean     NOT NULL,
    error_count   integer     NOT NULL DEFAULT 0,
    completed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX practice_sessions_user_algorithm_idx
    ON public.practice_sessions (user_id, algorithm_id);

-- algorithm_mastery: UNIQUE (user_id, algorithm_id) enables UPSERT on session completion (S-02)
CREATE TABLE public.algorithm_mastery (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    algorithm_id      uuid        NOT NULL REFERENCES public.algorithms(id) ON DELETE CASCADE,
    consecutive_clean integer     NOT NULL DEFAULT 0,
    mastery_reached   boolean     NOT NULL DEFAULT false,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT algorithm_mastery_user_algorithm_unique UNIQUE (user_id, algorithm_id)
);

-- Enable RLS on all domain tables
ALTER TABLE public.algorithm_lists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.algorithms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.algorithm_mastery  ENABLE ROW LEVEL SECURITY;

-- algorithm_lists policies (4)
CREATE POLICY "al_select" ON public.algorithm_lists
    FOR SELECT TO authenticated
    USING (is_system = true OR user_id = auth.uid());

CREATE POLICY "al_insert" ON public.algorithm_lists
    FOR INSERT TO authenticated
    WITH CHECK (is_system = false AND user_id = auth.uid());

CREATE POLICY "al_update" ON public.algorithm_lists
    FOR UPDATE TO authenticated
    USING  (user_id = auth.uid() AND is_system = false)
    WITH CHECK (user_id = auth.uid() AND is_system = false);

CREATE POLICY "al_delete" ON public.algorithm_lists
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() AND is_system = false);

-- algorithms policies — access flows from owning list (4)
CREATE POLICY "alg_select" ON public.algorithms
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND (l.is_system = true OR l.user_id = auth.uid())
        )
    );

CREATE POLICY "alg_insert" ON public.algorithms
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    );

CREATE POLICY "alg_update" ON public.algorithms
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    );

CREATE POLICY "alg_delete" ON public.algorithms
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.algorithm_lists l
            WHERE l.id = algorithms.list_id
              AND l.user_id = auth.uid()
              AND l.is_system = false
        )
    );

-- practice_sessions policies — append-only; no UPDATE (2)
CREATE POLICY "ps_select" ON public.practice_sessions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "ps_insert" ON public.practice_sessions
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- algorithm_mastery policies (3)
CREATE POLICY "am_select" ON public.algorithm_mastery
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "am_insert" ON public.algorithm_mastery
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "am_update" ON public.algorithm_mastery
    FOR UPDATE TO authenticated
    USING  (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
