// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// GitHub Pages serves this repo from a subfolder and cannot run a server, so
// that build prerenders to static HTML. Lovable's own build is untouched.
const pagesBase = process.env["GH_PAGES_BASE"];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // crawlLinks follows the real links between pages; the entry page also moves
    // on by script, so every route is named outright rather than left to the crawl.
    ...(pagesBase
      ? { prerender: { enabled: true, crawlLinks: true, routes: ["/", "/landing", "/lab"] } }
      : {}),
  },
  ...(pagesBase ? { vite: { base: pagesBase } } : {}),
});
