/**
 * The running version, shown in the admin and compared with the latest release.
 *
 * A literal rather than an import of package.json: every build path (esbuild
 * bundles, tsx, the Vercel function) gets it without bundling or tracing JSON.
 * tests/unit/version.test.ts keeps it equal to package.json.
 */
export const VERSION = '10.1.0';
