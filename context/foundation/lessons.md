# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Run independent Supabase queries concurrently with Promise.all

**Context:** src/pages/sets/[id]/[algoId].astro — server-rendered Astro pages with multiple independent data fetches

**Problem:** When two Supabase queries don't depend on each other's results, awaiting them sequentially adds a full round-trip of unnecessary latency to every page load.

**Rule:** When a page needs data from two independent queries, use Promise.all([query1, query2]) instead of sequential awaits.

**Applies to:** All Astro server pages that fetch from multiple Supabase tables where query 2 doesn't depend on query 1's result.
