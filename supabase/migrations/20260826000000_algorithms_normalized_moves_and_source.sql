-- Normalized move projection + provenance link (S-04, FR-015)
--
-- `moves` stays display-verbatim (parentheses and the learner's spacing are
-- preserved, matching the seeded rows). `moves_normalized` is the derived
-- comparison column FR-015 duplicate detection queries, so an equality
-- predicate on it is index-backed.
--
-- CONTRACT: this expression must produce byte-identical output to
-- `normalizeMoves` in src/lib/notation/moveGrammar.ts. The two definitions live
-- in different languages and cannot be shared; the parity test in
-- src/test/integration/normalization.int.test.ts is what pins them together.
-- If the normalization rule changes, both sides and that test change together.
--
-- The mapping, in order: parentheses → a space, U+2019 (’) → ASCII apostrophe,
-- whitespace runs → one space, then trim.
--
-- Parens map to a SPACE, not to nothing: deleting them fuses tokens across an
-- unspaced group boundary, so `(R U)(R' U)` would become `R UR' U` and `UR'` is
-- not a token the app can ever dispatch. JS and SQL would agree on that
-- corruption, keeping the parity test green while the learner got a
-- bewildering error.
--
-- `translate` pairs `from` and `to` POSITIONALLY and deletes any `from`
-- character with no `to` counterpart, so the `to` argument is exactly three
-- characters — space, space, apostrophe — written as the literal '  '''.
-- Verified: select translate('(R U’)', '()’', '  ''') → ' R U'' '.
--
-- translate / regexp_replace / btrim are all IMMUTABLE, which a generated
-- column requires.
ALTER TABLE public.algorithms
    ADD COLUMN moves_normalized text
        GENERATED ALWAYS AS (btrim(regexp_replace(translate(moves, '()’', '  '''), '\s+', ' ', 'g'))) STORED;

CREATE INDEX algorithms_moves_normalized_idx ON public.algorithms (moves_normalized);

-- Superseded by algorithms_moves_normalized_idx. algorithms_moves_idx was built
-- for byte-exact matching on raw `moves`; after this migration no query filters
-- on raw `moves` at all, so it only costs a write per insert and points the next
-- reader at the wrong index for FR-015.
DROP INDEX public.algorithms_moves_idx;

-- Provenance: where a copied algorithm came from (the FR-015 "add this one to my
-- list" branch inserts a copy rather than sharing a row, since algorithms.list_id
-- is NOT NULL — one row is one list membership).
--
-- ON DELETE SET NULL, never CASCADE: deleting an original must not delete a
-- learner's copy. Nullable, so every pre-existing seeded row is valid without a
-- backfill.
ALTER TABLE public.algorithms
    ADD COLUMN source_algorithm_id uuid NULL REFERENCES public.algorithms(id) ON DELETE SET NULL;
