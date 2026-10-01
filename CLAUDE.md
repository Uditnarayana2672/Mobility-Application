# Indore Spaces

Indoor maps + AR wayfinding web app (demo in an office). Venue owners draw maps in an editor; visitors navigate on a phone (2D map, voice, WebXR AR);
a laptop dashboard mirrors the phone live; advertisers place image/video ads on wall slots.

**Always read `docs/PROGRESS.md` first. Update it at the end of every session** (checklist, decisions log, known issues, spike results).

## Docs
- `docs/01-…` codebase analysis · `docs/02-…` decisions · `docs/03-build-plan.md` phases and architecture (revised, authoritative)
- `docs/mock-ui/` clickable HTML mock = UI spec; `docs/mock-ui/js/engine.js` = reference logic to port to `src/core` (Phase 1, with golden tests)
- `docs/https-on-phone.md` · `docs/spikes/*.json` spike results saved from the phone

## Folder map
```
src/core/      pure strict TS (steps, heading; Phase 1 adds the engine.js port)
src/shared/    frame helpers, Hub, Placeholder
src/spikes/    Phase 0 spike pages (S1–S5), ArUco detector/pose (aruco/), AR + camera helpers
src/bus/       (Phase 2/3) Bus interface: BroadcastChannel + WebSocket
src/pages, src/components, src/hooks, src/lib   LEGACY Blueprint editor (route /legacy-editor), non-strict, frozen
server/        REST (api.ts) + ws relay (ws.ts) + Vite plugin (vite-plugin.ts) + prod server (index.ts)
tests/         Vitest
scripts/       make-certs.mjs (mkcert), dev-lan.mjs
certs/         mkcert output, gitignored
data/venues/   venue JSON written by the API (Phase 1+)
```
Routes: `/` hub, `/editor /nav /dashboard /markers /ads` (placeholders until their phase), `/spikes/*`, `/legacy-editor`.

## Commands
`npm run dev` · `npm run dev:lan` (phone URL + QR) · `npm run certs` · `npm run build && npm run serve` · `npm run typecheck` · `npm test`

## Conventions
- All NEW code is strict TS and lives in paths listed in `tsconfig.strict.json`. Do not loosen it; do not touch the legacy editor beyond necessity.
- Units are **metres**. Frame: **x east, y south (screen-down), bearing 0 = north/up, clockwise**. Floors have an elevation in metres. (Same as the mock.)
- One origin for page + REST + WebSocket (Vite plugin in dev, `server/index.ts` in prod). Never add a second port.
- No PWA / service worker. HTTPS everywhere (WebXR, camera, sensors need it).
- Secrets (LLM key) live on the server only, never in the browser bundle.
- Core logic is deterministic and unit-tested; AI never computes routes or positions.
- Commit in small steps; commit messages end with the Co-Authored-By line from the session.
- Vitest is pinned to 2.x (repo is on Vite 5).
