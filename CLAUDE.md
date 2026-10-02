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
src/core/      pure strict TS: schema v2 (zod), engine port (graph, A*, instructions, search, intent, validate), steps/heading, aruco/dict
src/shared/    frame helpers, Hub, Placeholder
src/spikes/    Phase 0 spike pages (S1–S5), ArUco detector/pose (aruco/), AR + camera helpers
src/bus/       Bus interface + BroadcastChannelBus (pose/route/event payloads as in the mock); WebSocketBus = Phase 3
src/navigator/ /nav: NavController (all logic, no React), session.ts (pure state machine), SimPoseSource, speech, intent resolver, React screens
src/dashboard/ /dashboard: laptop live view (mirrors /nav over the bus)
src/ui/map/    reusable SVG map component (editor now; /nav and /dashboard later)
src/editor/    /editor: ops.ts (pure venue edits), store.ts (history), tools.ts (state machines), components/, EditorPage.tsx
src/markers/   /markers printable ArUco sheets
src/owner/     /owner status + version history
src/pages, src/components, src/hooks, src/lib   LEGACY Blueprint editor (route /legacy-editor), non-strict, frozen
server/        REST (api.ts, store.ts) + ws relay (ws.ts) + Vite plugin (vite-plugin.ts) + prod server (index.ts)
tests/         Vitest unit + golden (tests/golden vs the docs/mock-ui engine); tests/e2e = real-browser tests (npm run e2e)
scripts/       make-certs.mjs (mkcert), dev-lan.mjs
certs/         mkcert output, gitignored
data/          runtime files written by the server (drafts, published versions, uploads), gitignored
public/venues/ seed venue + campaigns (office-hq), generated from the mock by `npm run convert:mock`
```
Routes: `/` hub, `/nav` (`?demo=1`, hash deep links), `/dashboard`, `/editor`, `/owner`, `/markers`, `/spikes/*`, `/legacy-editor`; `/ads` is a placeholder until Phase 4.

## Commands
`npm run dev` · `npm run dev:lan` (phone URL + QR) · `npm run certs` · `npm run build && npm run serve` · `npm run typecheck` (tsc -b, project references) · `npm test` · `npm run e2e` · `npm run convert:mock`

## Conventions
- All NEW code is strict TS and lives in paths listed in `tsconfig.strict.json` (add new folders there). Do not loosen it; do not touch the legacy editor beyond necessity.
- Venue edits are pure functions in `src/editor/ops.ts` returning a new venue; one committed action = one undo step (drags use preview + commitPending). Marker `id` = numeric ArUco id; coordinates are metres, photo scale is per floor (`floor.background`).
- The TS engine must keep matching the mock's `engine.js` (golden tests). Change behaviour on purpose only, and update the golden expectation in the same commit.
- Units are **metres**. Frame: **x east, y south (screen-down), bearing 0 = north/up, clockwise**. Floors have an elevation in metres. (Same as the mock.)
- One origin for page + REST + WebSocket (Vite plugin in dev, `server/index.ts` in prod). Never add a second port.
- No PWA / service worker. HTTPS everywhere (WebXR, camera, sensors need it).
- Secrets (LLM key) live on the server only, never in the browser bundle.
- Core logic is deterministic and unit-tested; AI never computes routes or positions.
- Navigator logic lives in `NavController` / `session.ts`, not in components; time enters only through `tick(dt)` and the pose stream (tests drive it with a fake clock). Anything that must keep running in a background tab uses `startTicker` (Worker), not rAF or main-thread `setInterval`.
- Commit in small steps; commit messages end with the Co-Authored-By line from the session.
- Vitest is pinned to 2.x (repo is on Vite 5).
