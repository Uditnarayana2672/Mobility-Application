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
src/core/      pure strict TS: schema v2 (zod), engine port (graph, A*, instructions, search, intent, validate), geom.ts (rectangle + polygon room geometry), doors.ts (several doors per room), steps/heading, aruco/dict
src/shared/    frame helpers, Hub, Placeholder
src/spikes/    Phase 0 spike pages (S1–S5), ArUco detector/pose (aruco/), AR + camera helpers
src/bus/       Bus interface + BroadcastChannelBus (same browser) + WebSocketBus/CompositeBus (phone <-> server <-> dashboards); pose/route/event + venue/campaigns notices
src/navigator/ /nav: NavController (all logic, no React), session.ts (pure state machine), ControllerPoseSource + SimPoseSource, runtimeConfig (?pose/?bus/?debug), speech, intent resolver, React screens, LiveUi (locate/HUD/scan sheet/debug overlay)
src/positioning/ real positioning: markers.ts (marker pose, gate, XR alignment), refine.ts (LM), corrector.ts (snap/ease), particleFilter.ts, xrCore/pdrCore (pure) + XrPoseSource/PdrPoseSource (browser glue), liveBase.ts
src/ar/       pure scene model + canvas simulation renderer + same-session WebXR three.js renderer + campaign metrics/loading
src/dashboard/ /dashboard: laptop live view (mirrors /nav over the bus)
src/ads/      /ads campaign editor, approved wall slots, media upload, live pause/resume and KPIs
src/preflight/ /preflight stage checks: HTTPS, sensors, WebXR, voices, server, venue and live marker detection
src/ui/map/    reusable SVG map component (editor now; /nav and /dashboard later)
src/editor/    /editor: ops.ts (pure venue edits; free drawing by default, snap is a toggle), store.ts (history), tools.ts (state machines + selection handles), components/, EditorPage.tsx
src/markers/   /markers printable ArUco sheets
src/owner/     /owner status + version history
src/pages, src/components, src/hooks, src/lib   LEGACY Blueprint editor (route /legacy-editor), non-strict, frozen
server/        REST + server-only assistant/provider + realtime hub (roles, replay, heartbeat, publish/reset push, JSONL recording) + Vite plugin + prod server
tests/         Vitest unit + golden (tests/golden vs the docs/mock-ui engine); tests/e2e = real-browser tests (npm run e2e)
scripts/       make-certs.mjs (mkcert), dev-lan.mjs
certs/         mkcert output, gitignored
data/          runtime files written by the server (drafts, published versions, uploads, sessions/*.jsonl walk recordings), gitignored
public/venues/ seed venue + campaigns (office-hq), generated from the mock by `npm run convert:mock`
```
Routes: `/` hub, `/nav` (`?demo=1`, hash deep links), `/dashboard`, `/editor`, `/owner`, `/markers`, `/ads`, `/preflight`, `/spikes/*`, `/legacy-editor`.

## Commands
`npm run dev` · `npm run dev:lan` (phone URL + QR) · `npm run certs` · `npm run build && npm run serve` · `npm run typecheck` (tsc -b, project references) · `npm test` · `npm run e2e` · `npm run convert:mock`

Copy `.env.example` to `.env` for the optional free-form assistant (`OPENAI_API_KEY`, `OPENAI_MODEL`). `.env` is server-only and gitignored; never rename these to `VITE_*`. Without a key, rules/search/navigation remain available and assistant misses return local suggestions.

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

New in v2 (see docs/05-using-architecture-v2.md): src/speech (local STT/TTS client), src/vision (place recognition), src/survey (survey walk page), src/core/{needs,geofence}.ts, src/positioning/{compass,locator}.ts, src/ar/director.ts, src/ui/map/blueprintSkin.tsx, src/editor/blueprintImport.ts, server/{speech,vision,semantic}. Models live in data/models (git-ignored; `npm run setup:speech`).
