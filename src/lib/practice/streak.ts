// Single source of truth for the consecutive-clean streak rule.
// Extracted (behavior-neutral) from the inlined compute in
// src/pages/api/practice/complete.ts so it is unit-testable and reusable.

export interface StreakResult {
  newConsecutiveClean: number;
  newMasteryReached: boolean;
}

/**
 * Compute the next streak state from the current mastery row + this session.
 *
 * - `currentClean`: consecutive_clean from the existing mastery row (caller
 *   supplies `?? 0` when the row is missing — first-clean session → 1).
 * - `alreadyMastered`: mastery_reached from the existing row (sticky).
 * - `isClean`: whether this session had zero errors.
 *
 * A clean run increments the count by 1; any non-clean run resets it to 0.
 * Mastery is reached at 3 consecutive clean runs (`>= 3`) and, once reached,
 * stays reached.
 */
export function computeStreak(currentClean: number, alreadyMastered: boolean, isClean: boolean): StreakResult {
  const newConsecutiveClean = isClean ? currentClean + 1 : 0;
  const newMasteryReached = alreadyMastered || newConsecutiveClean >= 3;
  return { newConsecutiveClean, newMasteryReached };
}
