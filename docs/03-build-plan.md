# Indore Spaces: build plan (web app, office demo)

Date: 2026-10-02 (revised after architecture review) · Builds on `01-…` and `02-…`

> **Revision note.** This version supersedes the first draft in six places: port the mock engine instead of rebuilding it; build the editor from the mock (Blueprint goes to `/legacy-editor`); a real server for sync; one origin and one certificate; AR-session positioning as the primary path; two extra routes. It deliberately overrides the earlier "fix B1–B8 in Blueprint" step.

## Demo scenario we're building towards
> On the laptop screen, the office map shows Floor A. A colleague holding an Android phone scans the marker at reception. A blue dot appears on the laptop at reception, pointing the right way. They say *"cafeteria kahan hai?"* The phone answers and draws a route: walk → stairs (or lift) → Floor B → cafeteria. In AR, floor chevrons lead down the corridor. A turn arrow appears at the junction and a video ad plays on a blank wall. On the stairs the app asks "On Floor B now?". The lobby marker confirms it and navigation continues to "You have arrived". The laptop dashboard shows the whole walk live.
>
> The same route also runs as **laptop-only simulation**, the backup if anything fails on stage.

Scope: **2 accessible office floors**, lift + stairs. The other 2 floors are out of scope; the floor list allows adding them later.

---

## Architecture (revised)

One Vite + React + TS app (the existing repo). `mock-ui/js/engine.js` **is** `src/core` already, so we port it, not redesign it.

```
Mobility-Application/
├─ src/core/        ← strict-TS port of mock-ui/js/engine.js (+ data.js schema): venue schema v2, geometry, A*, instructions, search, intents, validation
├─ src/bus/         ← Bus interface; BroadcastChannelBus (simulation) and WebSocketBus (live)
├─ src/editor/      ← built from mock-ui editor.html/editor.js                  → /editor
├─ src/navigator/   ← mobile web app: 2D map, search, nav, marker scan, AR, voice → /nav
├─ src/dashboard/   ← laptop live view of the phone(s)                          → /dashboard
├─ src/markers/     ← printable marker sheets                                   → /markers
├─ src/ads/         ← advertiser portal: campaigns, pause/resume                → /ads
├─ src/owner/       ← venue-owner wizard (optional polish)                      → /owner
├─ src/legacy/      ← existing Blueprint editor, untouched                      → /legacy-editor
├─ server/          ← Vite dev-server plugin: REST + WebSocket on the same origin
├─ tests/golden/    ← mock engine vs TS port, identical-output tests
└─ data/venues/office-hq/  ← venue + campaign JSON on disk (served by the plugin), marker sheet, ad media
```

| Concern | Choice |
|---|---|
| Core | Port `engine.js` to strict TS. **Golden tests** run the mock engine and the TS port on the same inputs (routes, instructions in en/hi/te, search, intents, validation) and require identical output. Fixtures come from the mock's placeholder venue plus the real venue once surveyed |
| Editor | Built from the mock editor (metric scale, walk path, markers, ad slots, validate, publish). Blueprint (DOM rectangles, broken connection tool, no metric scale) is moved to `/legacy-editor` and left alone. Bugs B1–B8 are **not** fixed for the demo |
| Sync / bus | One `Bus` interface, two implementations: `BroadcastChannelBus` (laptop-only simulation, same browser) and `WebSocketBus` (phone ↔ laptop). The mock's localStorage + BroadcastChannel only works inside one browser, so live mode needs the server |
| Server | Runs **inside the Vite dev server as a plugin**: a small REST API for venue and campaign JSON stored on disk (`GET/PUT /api/venues/:id`, `GET/PUT /api/campaigns`, impression/tap counters) plus a WebSocket at `/ws` relaying pose, route and events. Same origin, same port, same certificate |
| HTTPS on LAN | **mkcert**, one cert for the laptop's LAN IP/hostname, with the mkcert root CA installed on the phone. Not `basic-ssl`: a self-signed cert has to be accepted per origin, and a second port would trigger a second prompt |
| Offline / PWA | **No service worker for the demo.** It adds caching problems and isn't needed. Revisit after the demo |
| AR | three.js + WebXR `immersive-ar` (`hit-test`, `anchors`, `dom-overlay`, `camera-access`) |
| Marker detection | ArUco (js-aruco2 or OpenCV.js) on camera frames. In AR via WebXR raw camera access, in 2D mode via `getUserMedia`. Fallback: WebXR image-tracking (Chrome flag, fine for our own demo phone) |
| Positioning (primary) | **2D map mode runs inside an `immersive-ar` session**, with the map drawn as the DOM overlay. ARCore visual tracking supplies the pose, so the blue dot follows real movement. Marker scans re-anchor it |
| Positioning (fallback) | `DeviceMotion`/`DeviceOrientation` step detection + gyro heading, particle filter on the walk network. Used only if immersive-ar is unavailable or tracking is lost |
| 2D map | SVG, own pan/zoom/rotate (heading-up), reusing the mock's `mapview.js` |
| Search | The mock's fuzzy search (or Fuse.js): offline, handles Hinglish spellings via aliases |
| Voice out | `speechSynthesis` (`en-IN`, `hi-IN`, `te-IN`) |
| Voice in | Chrome `SpeechRecognition` (`en-IN`/`hi-IN`/`te-IN`) → deterministic intent matcher first, LLM later (provider TBD) |
| LLM key | **Lives on the server only**, behind an `/api/ask` endpoint that calls the same search/route functions as tools. Never shipped to the browser |
| Tests | Vitest: unit tests for `src/core` plus the golden tests above |

### Routes

| Route | Purpose | Mock page |
|---|---|---|
| `/nav` | Visitor app (phone) | `nav.html` |
| `/editor` | Map editor | `editor.html` |
| `/dashboard` | Laptop live view | `dashboard.html` |
| `/markers` | Printable marker stickers (needed to print) | `markers.html` |
| `/ads` | Advertiser portal (needed for the pause-ad moment) | `ads.html` |
| `/owner` | Venue-owner wizard, optional polish | `owner.html` |
| `/legacy-editor` | Old Blueprint editor, frozen | none |

The mock has 7 pages (including the hub `index.html`); the first draft had 3 routes. A simple `/` hub can stay for the demo.

### Repo hygiene
If Lovable still syncs this repo, Claude Code's commits will show up there. Disconnect Lovable, or work on a branch it doesn't track, before coding starts.

---

## Phases

### Phase 0: risk spikes (do first; each one is about a day)
These decide whether the plan works on *your* phone, before we invest.

| Spike | Pass criteria |
|---|---|
| S1 WebXR on phone over LAN HTTPS | mkcert root CA installed on the phone; phone opens `https://<laptop-ip>:8080` with no warning, AR session starts, cube stays put on the floor while walking; a `wss://` connection to the same origin works |
| S2 Marker → AR anchor | Printed ArUco marker detected inside the AR session; a virtual object lands on the marker within about 10 cm. After walking 20 m and back, the error is under 1 m |
| S3 Voice | TTS speaks English, Hindi and Telugu sentences; recognition returns text for Hinglish and Telugu phrases |
| S4 Motion sensors (fallback path only) | Step count within ±5% over 50 steps; gyro heading drift under 10° per minute |
| S5 2D map inside immersive-ar | A DOM overlay map shows a dot that follows real walking over 30 m using only the ARCore pose, and stays correct after a marker re-anchor. **This is the critical spike for Phase 3** |

If S5 fails, Phase 3 falls back to the step-counting + particle filter path (S4). If S2 fails via raw camera access, switch to the image-tracking fallback. If both fail, AR uses a "tap the marker on screen" alignment.

### Phase 1: core port, data and editor
- **Port `engine.js` and the `data.js` schema to strict TS** in `src/core`, with golden tests against the mock engine (identical output required)
- Move Blueprint to `/legacy-editor` and leave it alone
- **Venue schema v2:** metres, floor heights, polygons, walk network (nodes/edges), markers, ad placements, venue metadata kept on save/export
- **Editor from the mock:** background image underlay + "draw line, enter metres" scale calibration, walk-network tool, vertical links (lift = all floors, stairs = adjacent floors), validation, publish
- Office type set (work bay, meeting room, cabin, cafeteria, pantry, reception, washroom, lift lobby, fire exit, server room)
- Marker element + **`/markers` printable sheet** (PDF, ID + floor + arrow printed under each code)
- Ad placement element (wall quad)
- **Server plugin v1:** REST for venue and campaign JSON on disk; Publish in `/editor` writes there
- **Map the 2 floors** (field work below)

✅ Done when: golden tests pass; both floors are in the editor at the correct scale and every room is reachable on the walk network; Publish in the editor on the laptop is visible in `/nav` on the phone after a reload.

### Phase 2: 2D navigator + laptop simulation
- Google-Maps-style renderer, floor switcher, labels by zoom
- Search with aliases ("canteen", "cafeteria", "khana")
- A* with time-based costs (stairs vs. lift), preferences (avoid stairs)
- Turn instruction generator + ETA; arrival detection
- **Simulation mode:** blue dot walks the route (auto-play or keyboard); TTS speaks instructions
- Heading-up navigation mode
- `Bus` interface with `BroadcastChannelBus`, so `/dashboard` mirrors `/nav` in a second tab

✅ Done when: on the laptop, reception → cafeteria on the other floor plays end-to-end with voice.

### Phase 3: real positioning
- **Primary:** 2D map mode inside an `immersive-ar` session, map drawn as the DOM overlay; the ARCore pose drives the dot
- Marker scan → position + heading + floor, re-anchoring the ARCore pose frame to the venue frame
- Floor change: "On Floor B now?" prompt, auto-confirm by lobby marker
- Off-route detection → reroute
- `WebSocketBus` + server relay + **laptop dashboard** (live dot, route, accuracy circle, event log)
- **Fallback (only if S5 fails or tracking is lost):** step counting + gyro heading + particle filter snapped to the walk network

✅ Done when: walking with the phone in hand, the dot stays within about 3 m. Every marker scan snaps it back to within about 0.5 m. The laptop mirrors it live over the WebSocket. The particle-filter fallback is no longer on the critical path.

### Phase 4: AR
- Enter/exit AR from navigation; reuse the same position estimate
- Floor chevrons for the next ~20 m, 3D turn arrows at manoeuvre points, destination pin
- Automatic correction whenever any marker is in view
- Ads: image and **video** textures on surveyed wall quads, shown within N m and when facing them; tap to see the offer or route to it
- `/ads`: pausing a campaign removes its ad from the AR scene within a few seconds (server push over the bus); impressions and taps are counted back
- Tracking lost → message, fall back to 2D map
- Safety: "look up" nudge, no AR overlays near stairs and lift doors

✅ Done when: the AR arrow is within the 2 m target along the whole demo route, and the ad sits on its wall within about 0.3 m.

### Phase 5: two-way voice + AI
- Deterministic intents first: "take me to X", "where am I", "nearest washroom", "repeat", in English, Hinglish and Telugu
- LLM (provider TBD) only for free-form questions, called **from the server** (key never in the browser), using the same search/route functions as tools

---

## Field work checklist (your 2 floors)
Bring: phone, laser distance meter (or 10 m tape), notebook/phone notes, painter's tape.

1. Admin/Security OK for photos and markers ✍️
2. Photograph the **fire-evacuation plan** on each floor (straight-on, whole sheet)
3. Ask Facilities for CAD/PDF of the interiors
4. Measure per floor: longest corridor, 2 room widths, lift-lobby width, stair landing size
5. Floor-to-floor height (steps × step height)
6. Photograph and list: rooms with names/numbers, cafeteria, washrooms, pantry, reception, lift, stairs, fire exits
7. Choose **marker spots** (~6–12 per floor): reception, lift lobby (each floor), stair doors (each floor), junctions, cafeteria entrance
8. Choose **2–3 blank walls** for ads; measure their width and usable height
9. Note one-way doors, access-card doors, and areas not allowed in the demo

---

## Questions for this phase
1. Which **Android phone** will run the AR (make and model)? It must be on Google's ARCore supported-devices list.
2. Are your 2 accessible floors **adjacent** (e.g. 2 and 3)? Which floors are they, and what's the demo destination (cafeteria? which floor)?
3. **Confirm the override of doc 01/03:** build the editor from the mock and move Blueprint to `/legacy-editor` instead of fixing B1–B8. (This plan assumes yes.)
4. Is Lovable still syncing the repo? If so, disconnect it before coding.
5. Can you install the mkcert root CA on the demo phone?
6. Ready to start Phase 0 spikes now, or do the field work first? (They can run in parallel: spikes need only a printed marker.)
