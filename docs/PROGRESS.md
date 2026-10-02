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
- [ ] Phase 2 – 2D navigator + laptop simulation
- [ ] Phase 3 – real positioning (2D map inside immersive-ar; marker re-anchor; WebSocket dashboard)
- [ ] Phase 4 – AR (chevrons, arrows, ads on walls, `/ads`)
- [ ] Phase 5 – two-way voice + AI (LLM key on the server only)

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

## Known issues

- Editor is verified in headless Edge, not on a phone/touch screen. Touch gestures on the map (pinch/pan) are implemented but untested on real hardware.
- Large phone photos (up to 10 MB) are stored as uploaded; no client-side downscale. Very large PNGs can make the editor sluggish.
- Autosave sends the whole venue on every committed change (fine for a 2-floor office; revisit for big venues).
- Campaign publish exists in the API only; the `/ads` portal arrives in Phase 4.
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

Routes: `/` hub · `/editor` · `/owner` · `/markers` (`?id=N`, `?draft=1`, `?venue=ID`) · `/legacy-editor` · `/spikes/*` · `/nav` `/dashboard` `/ads` (placeholders).
REST: `GET /api/venues/:id` · `GET|PUT /api/venues/:id/draft` · `POST /api/venues/:id/publish` · `GET /api/venues/:id/versions` · same under `/api/campaigns/:id` · `POST /api/uploads` (raw image body) · `GET /uploads/<file>`.

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
