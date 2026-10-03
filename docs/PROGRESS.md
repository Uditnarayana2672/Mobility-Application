# PROGRESS

Read this first; update it at the end of every session.

Target: Indore Spaces office demo. Phone: **POCO X5 Pro**, Chrome on Android. Plan: `docs/03-build-plan.md` (revised). UI spec + reference logic: `docs/mock-ui/`.

## Phase checklist

- [ ] **Phase 0 – foundation + risk spikes** (session 1) — code done 2026-10-02; **waiting on physical spike results (table below)**
  - [x] CLAUDE.md, docs/ copied into the repo, strict TS config, Vitest, `npm run typecheck`
  - [x] One-origin server (Vite plugin + `server/index.ts`), mkcert script, `dev:lan` + QR, docs/https-on-phone.md
  - [x] Routes: `/spikes/*`, placeholders, `/legacy-editor`
  - [x] Spike pages S1–S5 + `POST /api/spikes/:name` → `docs/spikes/<name>.json`
  - [ ] Spikes tested by hand on the POCO X5 Pro (you)
- [ ] **Phase 1 – venue schema v2, core engine port, editor, marker sheet** (session 2) — code done 2026-10-02; **waiting on your by-hand pass (checklist below)**
  - [x] `src/core`: schema v2 (zod), engine ported to strict TS (A* on a binary heap), golden tests vs the mock's `engine.js`
  - [x] `public/venues/office-hq/{venue,campaigns}.json` generated from the mock (`npm run convert:mock`)
  - [x] Server: draft/publish/versions/uploads REST (`server/api.ts`, `server/store.ts`)
  - [x] `src/ui/map` shared SVG map component
  - [x] `/editor`: tools, panels, photo upload + calibration, autosave, validation, publish (also covered by a real-browser e2e test)
  - [x] `/markers`: real ArUco images at true size, A6/A5/A4
  - [x] `/owner` (optional): status + version history
  - [ ] Your by-hand pass: trace your real office, print a marker and measure it
- [ ] **Phase 2 – 2D navigator + laptop simulation + dashboard** (session 3) — code done 2026-10-02; **waiting on your by-hand run of the demo script (checklist below)**
  - [x] `/nav`: mobile-first full screen, phone frame + demo panel on desktop; city → locate → map → search → place → preview (stairs vs lift, Avoid stairs) → nav → floor prompt → arrived; hash deep links `#map #search #voice #place #preview #nav #navf2` (`#arturn #arad #arf2` = AR stub)
  - [x] Map: floor switcher, labels by zoom, dot + heading cone + accuracy ring (grey when stale), route solid / dashed on other floors, lift/stairs pills, Explore (north-up) vs Navigate (heading-up, eased), recentre
  - [x] `src/navigator/session.ts` pure state machine + synthetic-trace tests (15 m / 3 m announcements, floor prompt, arrival ≤3 m, off-route >5 m for 3 s)
  - [x] Voice out (`speech.ts`: queue, en/hi/te, captions always, caption-only without a voice); voice in behind `IntentResolver` + text fallback (Phase 5 now supplies the rules-first hybrid)
  - [x] `PoseSource` + `SimPoseSource` (1.3 m/s, ×1/×3, play/pause, WASD+QE manual, marker scans, floor-change pause, lose tracking, wrong turn); `?demo=1` panel with Reset
  - [x] `src/bus`: `Bus` + `BroadcastChannelBus` (pose / route / event, payloads as in the mock); WebSocketBus stays Phase 3
  - [x] `/dashboard`: connection pill, follow / trail / markers, stats, route progress (route re-computed from `{from, target, via}`), event log, built-in demo feed
  - [x] Venue from `/api/venues/:id`, bundled fixture fallback
  - [x] Playwright smoke (`tests/e2e/nav.e2e.ts`): scan → "Cafeteria kahan hai?" → stairs vs lift → walk to F2 → "You have arrived at Cafeteria", dashboard mirrors it
  - [ ] Your by-hand pass on the laptop + a phone-width window (see "Phase 2 hand-test")
- [ ] **Phase 3 – real positioning on the phone + live dashboard over WebSocket** (session 4) — code done 2026-10-02; **waiting on your field tests (`docs/field-tests.md`) and the S1–S5 spikes**
  - [x] `src/positioning/markers.ts`: detect → id → venue lookup → refined pose from marker size + intrinsics → device pose in the venue frame; gate on reprojection error, obliquity and distance; synthetic-projection tests (`tests/positioning-markers.test.ts`)
  - [x] `corrector.ts` `PoseSmoother`: snap if > 1.5 m, else ease over 0.5 s
  - [x] `XrPoseSource` (immersive-ar + dom-overlay, camera-access marker detection, `mapPose = markerTransform × xrPose`, heading from XR orientation, floor from marker + > 2.5 m vertical rule, tracking lost → stale + "scan a marker")
  - [x] `PdrPoseSource` (getUserMedia marker scan, `StepDetector` + `HeadingIntegrator`, 300-particle filter on corridors + room doors, floor prompt by tap or lobby marker)
  - [x] Off-route / reroute: live poses go through the same `NavController.onPose` → session → `computeRoute` path as the simulator
  - [x] `WebSocketBus` (+ `CompositeBus`), server hub: roles, replay for late dashboards, heartbeat, "venue / campaigns published" push, JSONL walk recording, `GET /api/sessions/:venue[/last]`
  - [x] Dashboard: server-link pill, source badge, last anchor (+ age), accuracy circle (already in the map), trail, multi-phone selector, "⏪ Replay last walk", "map published" banner
  - [x] Phone `?debug=1` overlay (fps, tracking, reprojection error, reject reason, particle cloud mini-map); `?pose=sim|xr|pdr`, `?bus=bc|ws|both`
  - [x] `docs/field-tests.md` (4 routes, tape checkpoints, tables)
  - [ ] Your field tests on the POCO X5 Pro (numbers go in "Phase 3 field results" below)
- [ ] **Phase 4 – AR guidance + wall ads + `/ads`** (session 5) — code done 2026-10-02; **waiting on the POCO X5 Pro wall/route measurements below**
  - [x] `src/ar/sceneModel.ts`: pure map-coordinate scene (1.5 m chevrons / 20 m look-ahead, turn arrows ≤15 m, destination/floor-change cues, 2 m lift/stair exclusion, visible wall ads ≤10 m) + unit tests
  - [x] Same-session WebXR three.js renderer (map ↔ AR only toggles the content group) + mock-style canvas renderer for simulation/PDR
  - [x] Marker camera readback throttled to 4 Hz; marker corrections ease over 0.5 s; optional vertical-plane snap within 0.3 m
  - [x] Image/video wall textures (`VideoTexture`, muted/playsinline, AR-enter playback, generated poster fallback), raycast/polygon tap → offer sheet → Route to
  - [x] Impression (≥1 s in view) and tap persistence + phone session KPIs/event log on `/dashboard`
  - [x] `/ads`: campaign list/editor, approved wall slots, media upload to `data/media`, pause/resume, performance KPIs; campaign publish pushes over WebSocket
  - [x] Safety: 20 s look-up nudge; no ads/chevrons within 2 m of lift/stair doors; tracking lost automatically returns to 2D
  - [x] Automated: 340 unit/golden tests + 30 real-browser tests; pause → phone ad hidden measured **1,065 ms** (target <2 s)
  - [ ] Physical: arrow error along demo route ≤2 m and wall-ad registration ≈0.3 m on the POCO X5 Pro
- [ ] **Phase 5 – two-way voice + AI + demo hardening** (session 6) — code done 2026-10-02; **waiting on the POCO X5 Pro preflight/full-scenario pass**
  - [x] Rules first: confidence-aware matcher for goto, where-am-I, nearest, repeat, stop, AR/map, avoid-stairs and how-long; English, romanised Hinglish, Telugu script + romanised Telugu; 72-row table corpus
  - [x] Low-confidence-only `/api/assistant`: swappable provider interface + OpenAI Responses implementation; server-only `.env`; 6 s budget; text-only JSONL logs; offline/timeout “Did you mean…” suggestions
  - [x] Assistant tools `search_places`, `get_route`, `where_am_i`, `place_info` call pure `src/core/assistantTools.ts`; model never computes routes or positions
  - [x] Voice sheet: press-and-hold mic, partial transcript, listening pulse, release-to-send, TTS barge-in cancellation; text/example fallback remains
  - [x] `/preflight`: secure context, motion permission, immersive WebXR, en/hi/te voices, server health, venue version, local live marker detection at 4 Hz
  - [x] One-click reset clears phone + dashboard + server replay state over WebSocket; historical JSONL walk files are retained
  - [x] `docs/demo-runbook.md`: complete stage scenario and a recovery for every hand-off, ending in laptop simulation
  - [x] Automated: typecheck + production build; **421 unit/golden tests and 32 real-browser tests**
  - [ ] Physical: `/preflight` 7/7 green and full runbook completed on the phone with the laptop dashboard

## Decisions log

| Date | Decision |
|---|---|
| 2026-10-02 | New code is strict TS (`tsconfig.strict.json`: src/core, src/bus, src/shared, src/spikes, server, tests). Legacy code stays non-strict (`tsconfig.app.json`). `npm run typecheck` runs both. |
| 2026-10-02 | B6 fixed (deleted dead `handleAddCustomPoi` in Blueprint.tsx) instead of excluding legacy files. No other legacy change. |
| 2026-10-02 | Units metres; frame x east, y south, bearing 0 = north clockwise (`src/shared/frame.ts`); floors have elevation in metres. |
| 2026-10-02 | One origin: `server/` = Vite plugin (`configureServer`) attaching REST (`server/api.ts`) + `ws` relay at `/ws?room=` (`server/ws.ts`) to Vite's HTTPS server. `npm run serve` = same handlers over HTTPS for `dist/`. |
| 2026-10-02 | HTTPS via mkcert (`npm run certs`, certs/ gitignored); falls back to `@vitejs/plugin-basic-ssl` when certs are missing. |
| 2026-10-02 | No PWA / service worker. |
| 2026-10-02 | Vitest pinned to **2.x**: Vitest ≥3/5 needs Vite ≥6, the repo is on Vite 5. |
| 2026-10-02 | Marker dictionary: **custom generated "IND_4X4_50"** (4x4 data cells + 1 black border cell, 50 ids, min Hamming distance 3 across rotations; `src/spikes/aruco/dict.ts`). 4x4 = big cells at A5 size, robust to blur/low-res camera frames. Not OpenCV's table (can't be verified offline; we print our own markers). Black square 120 mm (`src/spikes/aruco/print.ts`). **Measured (tests/aruco.test.ts): min Hamming distance between any two codes over all 4 rotations = 3 (need ≥ 3); min distance of a code to its own 90/180/270 rotations = 4 (no code is rotation-ambiguous). No regeneration needed.** |
| 2026-10-02 | S2 fallback B FOV: "Calibrate at 1 m" computes hFOV from the detected square (face-on marker, exactly 1.00 m) and stores it in localStorage (`indore.s2.hfov`); default 65° until calibrated. |
| 2026-10-02 | Real-photo regression: put `id<NN>_<note>.jpg/png` in `tests/fixtures/markers-real/`; `tests/real-markers.test.ts` runs the detector on each (640 px wide) and expects that id. Empty for now. |
| 2026-10-02 | Own small TS detector (adaptive threshold → blobs → 4 corners → grid decode) instead of OpenCV.js (≈8 MB) / js-aruco2. Pose = planar homography decomposition with intrinsics from the XR projection matrix. **No Gauss-Newton refinement yet** (add if S2 distance error is large). |
| 2026-10-02 | **Blueprint stays untouched at `/legacy-editor`** (only B6 fixed in Phase 0). The new `/editor` is built from the mock editor, not from Blueprint. Bugs B1–B5, B7–B10 will not be fixed. |
| 2026-10-02 | Typecheck uses **project references** (`tsc -b tsconfig.app.json`): legacy files are checked non-strict, everything listed in `tsconfig.strict.json` (src/core, bus, shared, spikes, ui, editor, markers, owner, server, tests, scripts) strictly. A plain non-strict compile of new code breaks zod's inferred types, hence the split. |
| 2026-10-02 | **Marker `id` is the numeric ArUco id (0–49)**; `name` is the location label. Mock ids `M01…M08` convert to `1…8`. Validation: unique, integer, `< DICT_SIZE` (`src/core/aruco/dict.ts`, moved from `src/spikes/aruco`). `sizeM` (default 0.12) is the printed black-square side. |
| 2026-10-02 | **Coordinates are always metres; scale lives on the floor photo.** Calibrating = draw a line over the photo, enter its real length → the PHOTO is rescaled about the first point (`floor.background.transform.scale` = m per image pixel). Drawn geometry is never rescaled. `venue.scale.calibrated` = every floor that has a photo is calibrated (floors without a photo are metric by construction). Hand-editing the photo scale clears the calibration. |
| 2026-10-02 | **A* tie rule:** heap ordered by (f, insertion order); heuristic = straight-line walking time on the goal's floor, 0 on other floors (admissible, not consistent, so stale heap entries are skipped and nodes may be re-opened). Golden tests assert identical route output to the mock's Dijkstra on 19 route cases and equal travel time on ~1000 room pairs × 3 preferences. |
| 2026-10-02 | The mock's hard-coded geometry was generalised in the port: doors on any side (N/S/E/W), reachability starts at the entrance POI (else the first corridor node), ad-wall/door overlap uses point-to-segment distance, marker-far-from-corridor uses distance to the nearest walk edge. Results are identical on mock-shaped data (golden test). Extra checks: ≥1 marker per floor (fail), marker id range, vertical-link sanity (stairs adjacent floors only), every lift/stairs room linked, per-floor photo calibration. |
| 2026-10-02 | Lift links join every picked floor pairwise, time = 30 s + 14 s × floors (mock: 44 s for one floor); stairs only adjacent floors, 18 s up / 12 s down per floor. |
| 2026-10-02 | Server data lives in `data/` (gitignored): `data/venues/<id>/{published.json,draft.json,versions/vN.json}`, `…/campaigns/…`, `data/uploads/<sha>.<ext>`. Seeds in `public/venues/<id>/`. Publish: zod parse + `validate()`; any `fail` → HTTP 422 `{results}`; keeps the last 5 versions. |
| 2026-10-02 | Polygon rooms deferred: `room.polygon` is in the schema (optional, not edited or rendered). |
| 2026-10-02 | Print rule: each marker prints on its own page at its true `sizeM`; quiet zone ≥ 0.7 cell. A5 fits ≤ 120 mm, A6 ≤ ~84 mm, A4 ≤ ~170 mm; sizes that don't fit are disabled. A 100 mm ruler bar is printed on every sheet. |
| 2026-10-02 | Detector fix found by the print test: the adaptive threshold flattened borders thicker than its window, so a marker filling the frame was missed. Now three windows (w/24, w/8, w/3) plus a 2× downscaled pass. |
| 2026-10-02 | Docs 01–03 and mock-ui were outside the repo (`Indore map/artifacts/`); copied to `docs/`. The originals in `artifacts/` are untouched. |

| 2026-10-02 | **Phase 2 architecture:** the app logic is a non-React `NavController` (`src/navigator/controller.ts`); React screens are thin views over it (`useSyncExternalStore`). Time only enters through `tick(dtSec)` and the pose stream, so tests drive whole walks deterministically (`tests/controller.test.ts`). |
| 2026-10-02 | **Session = pure reducer** (`advance(state, input) → {state, events}`, no clock/DOM/language). Progress = pose snapped to the route's walk hops on the pose floor, window [-2 m, +15 m] around the current progress, monotonic; falls back to the whole route for forward jumps (marker scans). Events are structured; the controller turns them into text with core `stepSpeech`. Announce 15 m / 3 m once per step; arrive when ≤3 m of route remain on the destination floor; off-route = >5 m from the route (or wrong floor) for 3 s of *pose time*; stale poses are ignored (never reroute while tracking is lost). |
| 2026-10-02 | Floor change: the session waits at the lift/stairs point (`connector` event), the simulator pauses 6 s (lift) / 4.8 s (stairs), divided by the speed multiplier, then flips the floor → `floorPrompt` ("Are you on Floor 2 now?"). The simulator is held until confirmed by tap, by a lobby marker, or auto after 3.4 s (demo switch, on by default). After a floor change the sim accuracy is ~1.4 m until a marker is seen. |
| 2026-10-02 | **Ticker:** the simulation runs from a Worker `setInterval` (50 ms) because background tabs throttle main-thread timers and stop rAF, which froze the walk as soon as you looked at the dashboard tab. Falls back to `setInterval`. dt is wall-clock (capped 1.5 s). |
| 2026-10-02 | Bus payloads copied from the mock. `BroadcastChannelBus` also mirrors the last pose/route to localStorage (best effort) so a dashboard opened late hydrates. The dashboard re-computes the route from `{from, target, via}` with the mock's via→prefs mapping (lift → avoidStairs, stairs → avoidLifts). |
| 2026-10-02 | `RouteLines` draws runs on floors other than the user's floor **dashed and lighter** (the user's floor stays solid, travelled part grey). With no user (editor) everything is solid. `MapCanvas` got `followUser` (rAF-eased centre) and keeps its zoom across floor changes while following. |
| 2026-10-02 | Voice: "Cafeteria kahan hai?" resolves to `show` (place card, then you tap Directions) exactly as in the mock; "take me to the cafeteria" resolves to `goto` (straight to the route preview). Speech is queued (max 2 waiting, urgent lines cancel), voice picked by exact BCP-47 then language prefix, caption always shown; no hi/te voice → caption only. |
| 2026-10-02 | Layout: mobile-first. Below 761 px the app is full screen (safe-area aware, no fake status bar); from 761 px it renders the phone frame next to the demo panel (inverse of the mock's media query). No CSS `zoom`: the frame height is `min(836px, 100vh - 28px)`. On a phone `?demo=1` adds a 🎬 button that opens the panel as a drawer. CSS is scoped under `.is-nav` / `.is-dash` so it cannot leak into other routes. |
| 2026-10-02 | Deep links start from marker 1 like the mock; `#navf2` etc. use `fastForward(s)`, which feeds the session the poses it would have seen (silently) so it does not see a floor mismatch and fire an off-route. |
| 2026-10-02 | **Phase 3 pose sources are chosen at runtime, not by spike result** (S1–S5 were still blank): phone + `navigator.xr` → `XrPoseSource`, phone without it → `PdrPoseSource`, desktop / `?demo=1` → simulator; `?pose=` forces one; "Use step counting instead" on the locate screen switches (the controller is rebuilt, the visitor lands back on the locate screen). Both sources share `LivePoseBase` and the `ControllerPoseSource` interface the controller now depends on (the simulator implements it too). |
| 2026-10-02 | **Marker pose = homography decomposition + Levenberg–Marquardt refinement** (`src/positioning/refine.ts`, also tries the depth-mirrored twin). The plain decomposition was unusable with 1 px corner noise on a small marker (6 px reprojection error, > 1 m position error). Measured on synthetic 12 cm markers with the refinement: 0.3 px noise → median 0.01 m @ 1 m, 0.07 m @ 2 m, 0.25 m @ 3 m (p90 0.8 m @ 2 m: plane-pose ambiguity). So the gate rejects beyond **2.5 m** (≥ 70° oblique, > 2.5 px reprojection also rejected) and the claimed accuracy grows with distance² (`0.2 + 0.12·d²`, 0.25–1.5 m). Bigger markers help directly (A4 17 cm). |
| 2026-10-02 | **XR alignment** = yaw + translation only (ARCore `local` is gravity aligned): `p_world = Rz(θ)·S·p_xr + τ` with `S = (x, −z, y)`, solved from one marker sighting (venue world is right-handed E/N/up; the venue frame y is south). A later marker is accepted only if its claimed accuracy ≤ the current dead-reckoned one (`0.3 + 0.03 m/metre walked`, cap 3 m) or tracking was lost. Same marker re-announced as a scan at most every 3 s. |
| 2026-10-02 | **Floor in XR**: marker floor at anchor; then the nearest floor by height once the phone is > 2.5 m above/below its eye-height reference; a "yes, I'm on Floor N" tap re-bases the height (`forceFloor`). **Floor in PDR**: when the session reaches a lift/stairs the filter jumps to the next floor's connector point (`onConnector`), the session asks "Are you on Floor 2 now?", steps are ignored until answered or a lobby marker is seen. Live phones have `autoConfirm` off. |
| 2026-10-02 | **Particle filter**: 300 particles, each with its own gyro-bias walk; a step that would cross a wall is blocked and the particle penalised (×0.02); corridor ↔ room only within 1.6 m of the room's door; resampling jitter never crosses a wall. Accuracy = `0.6 + 2·spread` (0.8–8 m). Deterministic with a seeded RNG in tests. |
| 2026-10-02 | **Bus**: `Bus.on` callbacks now get `(payload, {deviceId, recvT})`; liveness uses the receive time (phone clocks are not trusted). WebSocket protocol `{type, payload, deviceId, t}` on `/ws?room=<venue>&role=device|viewer&device=<id>`: phones' messages go to viewers (not to other phones), a late dashboard gets each phone's last route / 30 events / pose, 15 s ping/pong heartbeat, server pushes `{type:"venue"|"campaigns"}` after a publish (`ApiOptions.onPublished` → `hub.notify`). Roles absent = plain room relay (old behaviour). Backoff: 0.5 s × 2ⁿ, cap 15 s, ×0.5–1 jitter; offline it keeps the last pose + route + 50 events. |
| 2026-10-02 | **Which bus**: simulator → BroadcastChannel (same-browser dashboard, the stage backup) and a *listen-only* WebSocket (so it still gets "venue published"); a live phone → WebSocket only. Dashboard listens on both. `?bus=bc|ws|both` overrides. |
| 2026-10-02 | **Recording**: every phone message (pose/route/event) is appended to `data/sessions/<venue>/<YYYYMMDDTHHMMSS>-<device>.jsonl` as `{recvT, msg}`; "Replay last walk" plays the latest file that contains a pose, with its original timing. |
| 2026-10-02 | **Venue refresh on publish**: the phone refetches `/api/venues/:id` and calls `NavController.setVenue`: applied at once when idle, deferred until the navigation ends otherwise (the sources keep their alignment/cloud). Phase 4 also consumes `campaigns` notices immediately to refresh AR ads. |
| 2026-10-02 | **Phase 4 scene contract:** `buildSceneModel(route, venue, pose, campaigns)` is the only placement policy. It returns venue/map-frame primitives; both canvas and three.js renderers consume it. Chevrons look 20 m ahead at 1.5 m spacing, turns appear at ≤15 m, ads require active + approved + same floor + ≤10 m + facing/in-view, and chevrons/ads are suppressed within 2 m of a lift/stair door. |
| 2026-10-02 | **Same XR session:** `XrPoseSource` owns the only immersive session. The three.js Phase 4 group subscribes to its frames and is merely hidden on the 2D map; map points are transformed back through the marker-derived XR alignment. Marker image readback is time-throttled to 250 ms (4 Hz), and rendered corrections ease with a 0.5 s time constant. |
| 2026-10-02 | **AR ads:** surveyed wall quads sit 4 cm in front of the wall to avoid z-fighting; an available vertical plane may translate the quad only when its centre is within 0.3 m. Video uses a muted/playsinline `VideoTexture`, primed synchronously by the AR-enter gesture, with the generated campaign poster displayed until media is ready. |
| 2026-10-02 | **Campaign live path:** `/ads` publishes each pause/resume immediately. The existing `campaigns` WebSocket notice makes phones refetch; the real-browser measurement was 1,065 ms click → no ad (target <2 s). Creative files are content-addressed under `data/media`; impression/tap events mutate live counters without creating a campaign content version. |
| 2026-10-02 | **Phase 5 intent boundary:** `matchIntent()` returns an intent plus 0..1 confidence. Rules at confidence ≥0.65 execute locally; only lower-confidence/free-form text reaches `/api/assistant`. The 72-case corpus covers English, romanised Hinglish, Telugu script and romanised Telugu. |
| 2026-10-02 | **Assistant provider:** OpenAI Responses API is the first `AssistantProvider`, configured only by server `.env` (`OPENAI_API_KEY`, `OPENAI_MODEL`; default model `gpt-5.4-mini`). Strict function calls are executed by `src/core/assistantTools.ts`; a single AbortController caps the whole tool loop at 6 s. Disabled/offline/timeout/error paths return the top three local search suggestions. Only text/request metadata are logged under `data/assistant/*.jsonl`. |
| 2026-10-02 | **Stage reset:** `POST /api/demo/reset/:venue` calls `RealtimeHub.reset()`, clears its late-join pose/route/event replay and broadcasts `reset` to phones/dashboards. Clients clear navigation, trails, events and mirrored localStorage. Past JSONL recordings are deliberately retained for audit/replay. |
| 2026-10-02 | **Preflight is gesture-driven:** automatic checks cover HTTPS, server, venue, WebXR and voices; **Run phone checks** requests motion/camera permission and runs the production marker detector locally every 250 ms. Frames never leave the phone. |
| 2026-10-02 | **Free-form editor (after Phase 3, from the user's feedback "I want to design freely like the old layout"):** (1) snapping is a toggle, **off by default** (`ops.setGrid(0)`, key `G`, remembered in localStorage; the ops module keeps a global grid step that defaults to 0.5 so unit tests are unchanged); rooms drag without being selected first (Shift+drag pans), rectangle rooms have 8 resize handles; corridor lines are selectable (new `edge` selection, id `a|b`), the middle dot bends them, Alt+drag moves a whole connected corridor, optional per-line `width` (default 2.4 m, drawn as a strip and used by step counting). (2) **Several doors per room**: `Room.door` stays the main door, `extraDoors[]` adds more, node ids `<room>:door`, `:door2`…; **a second door is not a shortcut**: routing does not walk through a room node unless the room is lift/stairs or `passThrough` is set. (3) **Furniture** (`Venue.objects`, kinds in `core/cats.ts OBJECT_KINDS`): map-only, never used by routing/validation/positioning. (4) **Any-shape rooms**: `Room.polygon` is authoritative when present, `x,y,w,h` are kept as its bounding box so rectangle-only consumers still work; `core/geom.ts` is the single place for point-in-room, distance, label point, outward normals; doors on polygon walls carry a `normal` instead of a `side`. All additions are optional with defaults, so every older venue still parses and routes identically (golden tests unchanged). |

## Known issues

- **Free-form editor** (verified in headless Edge and unit tests, not on a touch screen): handles are small (8–12 px), so on a phone-sized editor window they are fiddly. Furniture has no search / no routing role. Importing the legacy Blueprint data is not supported. Self-crossing room outlines are only a warning. A room with two doors is a dead end for routing unless "People may walk through this room" is ticked.

- `/nav` and `/dashboard` are verified in headless Edge (desktop and a 390 px mobile-emulated context), not on a real phone: touch pan/pinch, real `speechSynthesis` voices for Hindi/Telugu and `SpeechRecognition` are untested. Headless Edge has no voices, so the smoke test exercises the caption-only path.
- **Phase 3 is untested on a real phone.** Everything that needs the device is unverified: WebXR session start with the nav UI as DOM overlay, `camera-access` + camera texture orientation (the XR source toggles `flipY` after 90 frames without a detection), projection-matrix aspect vs camera size, `devicemotion` sign conventions for the step detector / gyro heading (copied from S4), getUserMedia scan and the assumed 65° horizontal FOV (or the S2-B calibrated value in localStorage `indore.s2.hfov`). The maths (marker pose, XR alignment, smoothing, particle filter, floor logic, bus, hub, recording, replay) is covered by unit and real-browser tests with synthetic inputs only.
- Single-marker position error grows quickly with distance for small markers (see the Decisions log); expect ±0.3–0.5 m at 1 m and worse beyond 2 m with 12 cm stickers.
- While the XR session runs the visitor app is the DOM overlay; the 3D canvas three.js adds is invisible behind the opaque map screens. Leaving the AR session (system gesture) stops positioning until "Restart AR".
- A lift ride can leave ARCore with a wrong height; the floor then follows the "yes, I'm on Floor N" tap or the lobby marker, not the height.
- The PDR stride is fixed at 0.7 m (not learned). The particle filter only knows rectangles (corridors, rooms, doors), not walls drawn in the editor.
- Replay of a walk shows only the recorded phone's poses/route/events; the phone's HUD is not reproduced.
- **Phase 4 WebXR visuals are not yet field-tested on the POCO X5 Pro.** The pure placement and XR inverse transform are synthetic-tested (surveyed wall offset 0.04 m; recovered map→XR point error <0.05 m in the fixture), but real arrow-to-floor error and ad-to-wall error still depend on the unmeasured Phase 3 marker/alignment accuracy. Fill the Phase 4 field table below before calling the physical targets done.
- **Phase 5 is not yet field-tested on the POCO X5 Pro.** Headless browser tests verify `/preflight` HTTPS/server/venue checks, but sensor permission, real WebXR, installed voices, live camera detection, speech recognition and the complete runbook still need the phone. The OpenAI path is contract-tested with a fake provider; no real API key/network call was made in automated tests.
- Chrome's `SpeechRecognition` service may itself require internet. If it is unavailable, the typed field and example chips still feed the same offline deterministic matcher; TTS/captions and all routing remain independent of the LLM provider.
- Plane detection is optional and browser-dependent. Without a nearby detected vertical plane, ads stay at the deterministic surveyed wall pose; this is the intended fallback.
- (Phase 3) Position comes from the simulator on a desktop / `?demo=1`, from AR or step counting on a phone; the dashboard listens on BroadcastChannel *and* the WebSocket, so the same-browser simulation still works.
- The manual walker (WASD) has no wall collision; it is clamped to the floor plate only.
- The venue fallback is the bundled `office-hq` only; another `?venue=` id needs the server.

- Editor is verified in headless Edge, not on a phone/touch screen. Touch gestures on the map (pinch/pan) are implemented but untested on real hardware.
- Large phone photos (up to 10 MB) are stored as uploaded; no client-side downscale. Very large PNGs can make the editor sluggish.
- Autosave sends the whole venue on every committed change (fine for a 2-floor office; revisit for big venues).
- Video upload accepts MP4/WebM up to 30 MB and streams from the same origin, but long videos are not transcoded or adaptive-streamed; use short demo loops.
- `npm run e2e` needs Edge or Chrome installed (default paths for Windows/Linux, or `E2E_BROWSER`).
- Legacy editor: B1–B5, B7–B10 from `docs/01-…` are NOT fixed (editor is being rebuilt from the mock; Blueprint is frozen at `/legacy-editor`).
- `npm audit` reports vulnerabilities in the inherited dependency tree; not addressed.
- Lovable may still sync this repo: disconnect before pushing (see doc 03).
- mkcert is not installed on the dev laptop yet (`winget install FiloSottile.mkcert`, then `npm run certs`).
- Spike code is untested on a real phone. Unverified assumptions: camera texture orientation (S2 auto-toggles `flipY`), whether `view.camera` size matches the projection matrix aspect.

## Commands

```
npm run dev          # https://localhost:8080 (Vite + API + WS)
npm run dev:lan      # same, bound to the LAN; prints URL + QR for the phone
npm run certs        # mkcert → certs/
npm run build && npm run serve   # production mode on https://<ip>:8443
npm run typecheck    # legacy (non-strict) + strict configs
npm test             # vitest unit + golden tests (fast, no browser)
npm run e2e          # real-browser tests (starts Vite + headless Edge/Chrome; set E2E_BROWSER to override the path)
npm run convert:mock # regenerate public/venues/office-hq/*.json from docs/mock-ui (a golden test checks they match)
```

Phase 3 URL switches on `/nav`: `?pose=sim|xr|pdr` (force the position source), `?bus=bc|ws|both`, `?debug=1` (overlay). REST also has `GET /api/sessions/:venue` (list), `/last`, `/:file`. Realtime: `wss://<host>/ws?room=<venue>&role=device|viewer&device=<id>`.
Routes: `/` hub · `/nav` (`?demo=1`, `?venue=ID`, `#map|search|voice|place|preview|nav|navf2|arturn|arad|arf2`) · `/dashboard` · `/editor` · `/owner` · `/markers` (`?id=N`, `?draft=1`, `?venue=ID`) · `/ads` · `/preflight` · `/legacy-editor` · `/spikes/*`.
REST: `POST /api/assistant` · `POST /api/demo/reset/:venue` · `GET /api/venues/:id` · `GET|PUT /api/venues/:id/draft` · `POST /api/venues/:id/publish` · `GET /api/venues/:id/versions` · same under `/api/campaigns/:id` · `POST /api/campaigns/:id/events` · `POST /api/uploads` (floor-plan images) · `POST /api/media` (ad image/video) · `GET /uploads/<file>` · `GET /media/<file>`.

## Phase 5 phone result (fill in after `docs/demo-runbook.md`)

| Check | Target | Automated result | Physical result |
|---|---|---|---|
| Deterministic multilingual corpus | ≥60 utterances, all pass | **72/72 pass** | ___ |
| Preflight | 7/7 green | HTTPS/server/venue browser pass; device APIs not emulated | ___/7 |
| Push-to-talk + partial transcript + barge-in | pass | implementation/unit integration pass | pass / fail |
| LLM free-form reply | <6 s or local suggestions | fake-provider + disabled-provider tests pass | ___ s / fallback |
| Internet disconnected | deterministic commands still work | matcher is local; provider failure caught | pass / fail |
| One-click reset | phone + dashboard + server state clear | realtime + browser tests pass | pass / fail |
| Full doc 03 route | arrival + live dashboard + AR ad | component flows pass separately | pass / fail |

## Phase 4 field results (fill in on the POCO X5 Pro)

| Metric | Target | Automated / model result | Physical result |
|---|---|---|---|
| AR arrow error vs taped route checkpoints | ≤ 2 m | 0 m in map geometry; map→XR inverse fixture error < 0.05 m | ___ m median / ___ m worst |
| Ad quad error vs surveyed wall corners | ≈ 0.3 m | 0.04 m intentional wall-normal offset; plane snap capped at 0.3 m | ___ m |
| Pause on laptop → ad absent on phone | < 2 s | **1.065 s** real-browser WebSocket test | ___ s |
| Marker detection cadence during AR | 3–5 Hz | 4 Hz configured | ___ Hz |
| Video starts muted/inline and loops; poster appears first | pass | Browser automation/build pass; real WebXR not emulated | pass / fail |
| Tracking loss returns to 2D with message | pass | controller test pass | pass / fail |
| 20 s look-up nudge | pass | timer implemented | pass / fail |

## Phase 4 hand-test

1. Start `npm run dev:lan`; laptop: `/dashboard` and `/ads`; phone: `/nav?debug=1`. Start AR tracking, scan marker 1, route to Cafeteria, then tap the camera button. Switching **Map ↔ AR** must not reopen the XR permission prompt or require another marker scan.
2. Put tape at three route checkpoints (straight, turn, and the stair/lift door). In AR, measure the floor-arrow centre to each tape mark. Record median/worst above; target ≤2 m. Confirm chevrons and ads disappear inside the 2 m safety circle around lift/stair doors.
3. Measure the four corners of W01, aim the phone from 3–8 m, and measure virtual-quad edge to wall target. Record the worst edge error; target about 0.3 m. Note whether `plane-detection` tightened it or the surveyed-pose fallback was used.
4. Keep AR open for 20 s: the look-up nudge appears. Cover the camera / force tracking loss: the app returns to 2D with the tracking-lost message.
5. In `/ads`, upload a short MP4 and an image, assign W01, and save. Tap the AR ad → offer sheet → **Route to Cafeteria**. After ≥1 s in view, `/dashboard` increments impressions; a tap appears in its event log/tap KPI.
6. While the ad is visible, pause it on the laptop and time until it disappears on the phone; target <2 s. Resume it and verify the reverse. The automated same-origin test measured 1.065 s.

## Phase 3 field results (fill in after `docs/field-tests.md`)

| Metric | Target | Measured |
|---|---|---|
| Median walking error (dot vs tape, no scan in the last 10 s) | ≤ 3 m | ___ m |
| Worst walking error | — | ___ m |
| Median error right after a marker scan | ≤ 0.5 m | ___ m |
| Worst error right after a scan | — | ___ m |
| Reliable scan distance (marker ___ cm) | ≥ 1.5 m | ___ m |
| Floor change detected / confirmed correctly (R3 stairs, R4 lift) | 4 of 4 | ___ of 4 |
| Source used (XR / PDR) | | ___ |
| Dashboard lag (scan → log) | < 1 s | ___ s |
| Battery over 10 min of AR | | ___ % → ___ % |

Synthetic (computer) numbers, for reference: marker fix 0.01 m @ 1 m / 0.07 m @ 2 m median at 0.3 px corner noise; XR alignment recovers yaw within 0.01 rad and translation within 3 cm from one sighting; 50 steps of PDR with a drifting gyro stay inside the corridor.

## Phase 3 hand-test (what the automated tests cannot judge)

Automated: `tests/positioning-*.test.ts` (marker pose maths on synthetic projections, XR core, PDR core, particle filter, smoother), `tests/bus-ws.test.ts`, `tests/realtime.test.ts` (hub, replay, heartbeat, recording, publish notice), `tests/controller-live.test.ts`, `tests/runtime-config.test.ts`, and `tests/e2e/live.e2e.ts` (phone and dashboard in separate browser contexts, so everything travels over `/ws`: live mirror, late join, JSONL replay, venue-published push, live-phone UI).

1. `npm run dev:lan`; laptop → `https://<ip>:8080/dashboard` ("server link: open"). Phone → `https://<ip>:8080/nav?debug=1` → tap the venue → **Start AR tracking** (grant camera) → aim at marker 1 from ~1.2 m: the dot appears, dashboard shows the scan, source badge XR, last anchor #1.
2. Walk. The chip on the map says `AR · AR · ±x m`; the dashboard dot, trail and accuracy circle follow. Look at another marker: the dot eases (≤ 1.5 m) or snaps and the accuracy resets.
3. No WebXR / S5 failed: `…/nav?pose=pdr&debug=1` → **Open camera to scan a marker**; walk (steps counted in the debug line, particle cloud on the mini-map); **📷 Scan marker** on the map re-anchors.
4. Ask for the Cafeteria via stairs: "Are you on Floor 2 now?" → tap Yes (or scan the lobby marker).
5. Dashboard: stop the phone → "Phone offline" → **⏪ Replay last walk**. Publish in `/editor` → phone toast "Map updated (vN)", dashboard banner.

## Phase 2 hand-test (what the automated tests cannot judge)

Automated: session/sim/controller/bus/speech/intent/venue-loader unit tests (all of Reception → Cafeteria incl. the floor change, wrong turn → reroute, tracking lost, every deep link, EN/Hinglish/Telugu captions) and `tests/e2e/nav.e2e.ts` (real browser: `/nav` + `/dashboard` side by side, walk to "You have arrived at Cafeteria").

1. `npm run dev`. Open `https://localhost:8080/dashboard` on the big screen/second window, then `https://localhost:8080/nav?demo=1` in another tab or window of the **same browser**. Keep the dashboard visible: it should say "Waiting for a phone…".
2. Tap the blue pin → marker chip **1** (or demo panel → Scan). Dashboard: "phone connected", dot at Reception, event "scan".
3. Mic 🎤 → type or say "Cafeteria kahan hai?" (try Hinglish and తెలుగు first). Place card → **Directions**: stairs "Fastest" vs lift; toggle **Avoid stairs**.
4. **Start** at ×3: listen for "In 15 metres…", "Now, turn right"; the banner/ETA, the dot turning the map (heading-up), the ◎ button after you pan; floor switcher, dashed route when you view Floor 2. "Taking the stairs…" → "Are you on Floor 2 now?" (auto-confirms in ~3 s) → "You have arrived at Cafeteria".
5. Try: Pause/Play, **Next turn**, **Take wrong turn** (reroute after 3 s), **Lose tracking** (grey dot, no reroute), Manual mode (WASD/QE) wandering off the route, Mute (captions stay), a language with no installed voice (caption only).
6. Resize the window below 761 px (or open on the phone via `npm run dev:lan`): full-screen layout; `?demo=1` shows 🎬 for the demo drawer. **Reset demo** reloads cleanly.
7. Check the voices you actually have: Settings → Languages → Text-to-speech (Hindi/Telugu data may need installing) — that is a device matter, the app falls back to captions.

## Phase 1 hand-test (what the automated tests cannot judge)

Automated: 194 unit/golden tests and 12 real-browser tests (blank venue → photo upload → calibration → two floors → lift + stairs → undo/redo → publish → `GET /api/venues/office-hq`; `/markers` true size, A5 PDF, detector round trip; `/owner`). Not covered: how it feels with your real floor plan and a touch/trackpad.

1. `npm run dev`, open `https://localhost:8080/editor`. ⋯ → **Start a blank venue**. Rename it (Properties tab).
2. **Floor settings** → upload the straight-on photo of the fire-evacuation plan for Floor 1. Press **S**, click both ends of a corridor you measured with the laser meter, enter the real length → "✔ calibrated". Sanity check: draw a room over a room in the photo; its size should read right in the properties panel.
3. Trace Floor 1: **W** walk path down each corridor centre-line (Esc to end a chain); **R** rooms (door appears on the corridor side; fix with **D**); name rooms, set category/aliases (Hinglish/Telugu welcome) and mark lift/stairs rooms (Room type).
4. **+ Floor**, upload its photo, calibrate, trace it. **L** → pick the lift on Floor 1, switch floor, pick it on Floor 2, **Enter**; stairs the same (completes after two picks).
5. **M** markers (lift lobbies and stair doors first), **P** entrance POI, **A** ad walls. Watch the **Checklist** tab until it says "Ready to publish", then **Publish**.
6. `GET https://localhost:8080/api/venues/office-hq` returns the published venue (version bumped, `data/venues/office-hq/versions/` has history).
7. `/markers`: choose A5, print at **100%** (no "fit to page"), measure the black square (should equal the marker's size, 120 mm by default) and the 100 mm ruler bar. If they are off, fix the printer scaling, not the app.
8. Stop `npm run dev`, start it again: the editor reloads your published map; make a change, reload the page: the draft is restored (autosave).

## Spike hand-test (do these on the POCO X5 Pro)

Setup once: follow `docs/https-on-phone.md`, run `npm run dev:lan`, open the URL on the phone → `/spikes`. Page must say "Secure context". For each spike press **Save results** at the end
(writes `docs/spikes/<name>.json` on the laptop), then copy the numbers into the table below.
Optional but useful: photograph each printed marker with the phone (different light/angles/distances) and save as `tests/fixtures/markers-real/id<NN>_<note>.jpg`; `npm test` then checks the detector on them.
Print the markers first: `/spikes/s2/markers` → print on A5 at **100%**, measure the black square with a ruler (must be 120 mm; if not, set `MARKER_SIZE_MM` in `src/spikes/aruco/print.ts`).

**S1 – WebXR (pass: AR starts; cube stays put on the floor while walking)**
1. `/spikes/s1` → Start AR. Note the "features" readout (want hit-test, anchors, dom-overlay).
2. Point at the floor, wait for the green ring, tap: a cube appears. Mark its spot with painter's tape.
3. Walk 10 m away and back; measure how far the cube is from the tape → enter in cm. Repeat once with a 20 m walk.
4. Note tracking lost/limited events and any jitter.

**S2 – marker → pose (pass: virtual axes land on the marker within ≈10 cm; after walking 20 m and back, marker position error < 1 m)**
1. Stick marker 0 on a wall at ~1.4 m height.
2. `/spikes/s2` → "A · AR + camera-access". Check the log for "camera-access" in enabled features. Aim at the marker from ~1 m: the axes should appear on it.
3. At 1 m, 2 m, 3 m (tape measured, camera to marker) enter the tape distance and press **Record sample** → compares estimated vs tape. Pass: error < 10 cm at 1–2 m.
4. Walk 20 m away and back with AR running; look at the marker again; note how far the axes are from it (cm) in Notes.
5. If A fails (no camera-access / no detections), use **B · camera outside XR**: first **Calibrate at 1 m** (marker face-on at exactly 1.00 m from the phone), then record samples the same way (uncalibrated B assumes 65°, so expect a scale error). Report which path works and the "first detection after … ms" log line.

**S3 – voice (pass: TTS speaks en-IN, hi-IN, te-IN; recognition returns text for Hinglish and Telugu phrases)**
1. `/spikes/s3`. Note voice counts per language (installing Google TTS voice data for Hindi/Telugu may be needed: Settings → Languages → Text-to-speech).
2. Speak each sentence, mark "understandable" yes/no. 3. Listen in each language and say: "cafeteria kahan hai" (hi-IN), "washroom ekkada undi" (te-IN), plus an English phrase. Note transcripts quality in Notes.

**S4 – motion (pass: step count within ±5% over 50 steps; gyro heading drift < 10°/min)**
1. `/spikes/s4` → Start sensors (check sample rate ≥ 50 Hz).
2. Reset, walk exactly 50 normal steps holding the phone in front of you, enter 50 → Record. Repeat 3× (also once with the phone in a trouser pocket).
3. Drift: lay the phone flat and still, Start, wait ≥ 60 s (better 3 min), Stop → record. Then hold it upright and turn a full 360° on the spot: heading should come back to ≈ the start.

**S5 – tracking under a full-screen overlay (pass: no or very few tracking-lost events; dot follows you)**
1. `/spikes/s5` → Start. Walk ~30 m for 2 minutes holding the phone as you would while navigating (tilted, looking at the map overlay), then Exit.
2. Record lost / limited events, walked distance. Repeat in a plain corridor and near the real office floor if possible.

## Spike results (fill in after testing)

| Spike | Date | Works? (Y/N/partial) | Key numbers | Pass? | Notes |
|---|---|---|---|---|---|
| S1 WebXR (hit-test, anchors, dom-overlay) | | | cube drift after 10 m: ___ cm; after 20 m: ___ cm; lost events: ___ | | |
| S2-A marker via camera-access | | | detect range: ___ m; error @1 m / 2 m / 3 m: ___ / ___ / ___ cm; walk-back error: ___ cm; first detection: ___ ms; flipY needed: ___ | | |
| S2-B marker via getUserMedia (only if A failed) | | | | | |
| S2-C image-tracking flag (only if A and B failed) | | | | | |
| S3 voice out en-IN / hi-IN / te-IN | | | voices: ___ / ___ / ___; understandable: ___ / ___ / ___ | | |
| S3 voice in en / hi / te | | | "cafeteria kahan hai" → "___"; "washroom ekkada undi" → "___" | | |
| S4 steps (50 steps ×3) | | | errors: ___% / ___% / ___%; sample rate: ___ Hz | | |
| S4 gyro drift | | | ___ °/min over ___ s; 360° return error: ___° | | |
| S5 overlay tracking | | | duration ___ s; walked ___ m; lost events ___; limited ___ | | |

Decision rules (doc 03): S5 pass → Phase 3 uses the 2D map inside immersive-ar as the main positioning mode. S5 fail → step counting + particle filter (needs S4 pass) becomes the main path.
S2-A fail → S2-B; both fail → AR uses "tap the marker on screen" alignment.

## Free-form editor hand-test (what the automated tests cannot judge)

Automated: `tests/geom.test.ts`, `doors.test.ts`, `objects.test.tsx`, `polygon-rooms.test.tsx`, `polygon-consumers.test.tsx`, extended `editor-ops` / `editor-store-tools`, and `tests/e2e/freeform.e2e.ts` (free drawing with snap off, an L-shaped room by clicking corners, a second door, bed + toilet, a bent corridor, publish, `/nav` draws the outline and the furniture and routes into the room).

1. `/editor?venue=<id>` → **Start a blank venue**. The **Snap 0.5 m** box (top left of the map, key `G`) is off: everything you draw keeps its exact position.
2. **W** lays corridor points at any angle. **V**: click a corridor line (it turns blue), drag the white dot in its middle to bend it, **Alt+drag** a line or point to move the whole corridor, set its **Width** in the right panel, **Delete** removes a selected line.
3. **R**: choose **▭ Rectangle** (drag) or **⬠ Free shape** (click each corner, Enter or the first corner closes). Select a room: drag corners, drag the small dots on the walls to add corners, **Shift+click** a corner to remove it, drag the orange dot (or "Rotate by") to rotate. "Make free-shape" turns a rectangle into corners.
4. **D**: click a wall to add a door, click a door to remove it, Shift+click moves the nearest one. Tick "People may walk through this room" for a passage.
5. **F**: pick Bed / Table / Chair / Toilet / Shower… above the map, click to place; drag it, drag a corner square to resize, the orange dot to rotate; label and size in the right panel.
6. Publish, then open `/nav` (or the phone): outlines, doors and furniture show; routes use any door.

## Camera guide on phones without WebXR (step-counting source)
- Cause of "camera AR not working": a phone whose Chrome has `navigator.xr` but no ARCore fell to step counting, and the AR view then drew the *simulated* room (fake sky/floor), never the camera.
- Now: the AR view puts the real rear camera behind a transparent canvas (`see-through` mode in `CanvasArRenderer`), with tilt from `deviceorientation`, floor chevrons / turn arrows / destination pin, and a big compass arrow (`guideFor` in `ArScreen`) that always points to the next ~3 m of the route.
- "Where do you want to go?" lives in the AR view (chips + 🎤). `NavController.guideTo()` plans, starts navigating and stays in AR; a voice "go to X" asked from the AR view does the same (no map preview).
- Choosing a start room by hand on a phone puts the visitor 1.2 m inside it facing its door (heading is only as good as that: stand that way, or scan a marker to correct).
- XR support is detected on the locate screen; without ARCore it switches to the plain camera by itself (not when `?pose=xr` is forced).
- Not measured yet (needs the phone): arrow alignment vs. the real corridor, heading drift over a walk. Fill in under field results.

## Architecture v2 (plan only, 2026-10-03)
- `docs/04-architecture-v2.md`: Blueprint look as a skin + importer (not as the data model), auto venue detection (GPS fence / QR), auto-locate (markers, then image recognition, then one-tap guesses), AI only at the edges (STT, constrained intent, TTS, image embeddings), AR director = rules + perception. Phases P1–P8, effort, acceptance, open questions. No code changed.
