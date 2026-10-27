// Vercel's entry point. Vercel's builder type-checks .ts entry points with the project's own
// TypeScript, through a JavaScript API that TypeScript 7 doesn't have, so the build fails. A
// .mjs entry skips that check; the builder still bundles vercel.ts and everything it imports.
// Type checking runs in CI and the pre-push check (pnpm typecheck).
export { default } from './vercel.ts';
