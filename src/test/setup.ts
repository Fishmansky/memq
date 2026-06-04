// Global Vitest setup: register jest-dom matchers for component specs.
// Testing Library auto-cleanup runs via Vitest globals (afterEach).
// No app / Supabase / astro:env imports here.
import "@testing-library/jest-dom/vitest";
