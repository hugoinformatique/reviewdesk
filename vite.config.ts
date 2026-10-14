import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * The admin SPA. It is built into public/ so every host that already serves
 * public/ (Fastify, Vercel, the Docker and local kits) serves it unchanged.
 * Until the cut-over it lives under /next/, next to the legacy admin, on the
 * same origin: one session cookie for both.
 *
 * Production runs under `script-src 'self'; style-src 'self'`: no inline
 * script or <style> may be emitted. React's style props go through the CSSOM,
 * which that policy allows.
 */
/**
 * Two dependencies append a <style> element at runtime, which `style-src
 * 'self'` blocks (and reports). Their rules ship in our own stylesheet
 * instead (admin/src/styles.css), so the injection is switched off at build.
 */
function noRuntimeStyleTags(): Plugin {
  const patches: [RegExp, string, string][] = [
    [/react-style-singleton[\\/]dist[\\/]es2015[\\/]singleton\.js$/, 'if (!document)\n        return null;', 'return null;'],
    [/sonner[\\/]dist[\\/]index\.mjs$/, "if (!code || typeof document == 'undefined') return", 'return'],
  ];
  return {
    name: 'reviewdesk:no-runtime-style-tags',
    apply: 'build',
    transform(code, id) {
      for (const [file, from, to] of patches) {
        if (!file.test(id)) continue;
        if (!code.includes(from)) this.error(`Patch CSP introuvable dans ${id} : la dépendance a changé.`);
        return code.replace(from, to);
      }
      return null;
    },
  };
}

const base = process.env.ADMIN_BASE ?? '/next/';
const api = process.env.REVIEWDESK_API ?? 'http://127.0.0.1:4390';

export default defineConfig({
  root: fileURLToPath(new URL('./admin', import.meta.url)),
  base,
  publicDir: false,
  plugins: [react(), tailwindcss(), noRuntimeStyleTags()],
  resolve: { alias: { '@': fileURLToPath(new URL('./admin/src', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL(`./public${base}`, import.meta.url)),
    emptyOutDir: base !== '/',
    assetsDir: 'assets',
    sourcemap: false,
    // Fonts stay files: a data: URI would need `font-src data:`.
    assetsInlineLimit: 0,
  },
  server: {
    host: process.env.ADMIN_HOST ?? '127.0.0.1',
    port: Number(process.env.ADMIN_PORT ?? 5173),
    strictPort: true,
    // Same-origin in development too: the API sees the dev server's origin
    // rewritten to its own, as the CSRF check expects.
    proxy: Object.fromEntries(
      ['/api', '/widget.js', '/theme.js', '/fonts', '/favicon.svg', '/demo.html', '/demo.js', '/demo.css', '/relecture.html', '/integrations'].map((path) => [
        path,
        { target: api, changeOrigin: true, headers: { origin: api } },
      ]),
    ),
  },
});
