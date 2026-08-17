/**
 * Vercel entry point.
 *
 * Deliberately plain JavaScript re-exporting the compiled handler rather than
 * TypeScript importing `../src/http.ts`. Vercel compiles a `.ts` function in
 * place but leaves relative import specifiers untouched, so a `.ts` specifier
 * survives into the deployed bundle and fails at runtime looking for a file
 * that was never shipped. Pointing at `dist/`, which `npm run build` produces
 * before functions are assembled, keeps the resolution unambiguous.
 */

export { default } from '../dist/http.js';
