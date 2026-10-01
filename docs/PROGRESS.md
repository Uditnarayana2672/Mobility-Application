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
- [ ] Phase 1 – core port (engine.js → src/core, golden tests), venue schema v2, editor from mock, `/markers`, server REST for venues
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
| 2026-10-02 | Marker dictionary: **custom generated "IND_4X4_50"** (4x4 data cells + 1 black border cell, 50 ids, min Hamming distance 3 across rotations; `src/spikes/aruco/dict.ts`). 4x4 = big cells at A5 size, robust to blur/low-res camera frames. Not OpenCV's table (can't be verified offline; we print our own markers). Black square 120 mm (`src/spikes/aruco/print.ts`). |
| 2026-10-02 | Own small TS detector (adaptive threshold → blobs → 4 corners → grid decode) instead of OpenCV.js (≈8 MB) / js-aruco2. Pose = planar homography decomposition with intrinsics from the XR projection matrix. **No Gauss-Newton refinement yet** (add if S2 distance error is large). |
| 2026-10-02 | Docs 01–03 and mock-ui were outside the repo (`Indore map/artifacts/`); copied to `docs/`. The originals in `artifacts/` are untouched. |

## Known issues

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
npm test             # vitest
```

## Spike hand-test (do these on the POCO X5 Pro)

Setup once: follow `docs/https-on-phone.md`, run `npm run dev:lan`, open the URL on the phone → `/spikes`. Page must say "Secure context". For each spike press **Save results** at the end
(writes `docs/spikes/<name>.json` on the laptop), then copy the numbers into the table below.
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
5. If A fails (no camera-access / no detections), use **B · camera outside XR** and record samples the same way (B uses an assumed 65° FOV, so expect a scale error; the point is whether detection works at all). Report which path works and the "first detection after … ms" log line.

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
