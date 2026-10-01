# Indore Spaces — Indoor Maps + AR Wayfinding
## Codebase analysis, gaps, tracking strategy, and open questions

Date: 2026-10-02 · Source analysed: `Mobility-Application/` (commit `ab27e98 "added kia map"`)

---

## 1. What the current codebase actually is

It's a **floor-plan authoring tool, not a navigation app**. It's a Lovable/gpt-engineer scaffold (Vite + React 18 + TypeScript + shadcn/ui + Tailwind), with an airport-specific data model added in the last commit.

| Area | What exists | Where |
|---|---|---|
| App shell | One route `/` → the editor page | `src/App.tsx`, `src/pages/Index.tsx` |
| Canvas | DOM `<div>`s for areas plus an SVG layer for edges and grid, with pan/zoom by CSS transform | `src/components/Blueprint/*` |
| Element model | Axis-aligned **rectangles** `{id,type,name,floor,x,y,width,height,...attrs}` and POIs (circles) | `src/hooks/useDrawing.ts`, `src/lib/elementTypes.ts` |
| Domain types | 11 airport area types (check-in, security, gate, lounge, shop, eatery, toilet, elevator, escalator, baggage, restricted), 10 airport POIs, typed attribute schemas per type | `src/lib/elementTypes.ts` |
| Graph | `connections[]` = edges between **element centroids**, with `distance`, `travel_time`, `directed`, `wheelchair_accessible`, `pathType` | `src/hooks/useConnections.ts` |
| Multi-floor | `floors[]`, `currentFloor`. Lifts/escalators are separate per-floor elements at the same x/y, joined by cross-floor edges | `scripts/generate-blr-t2.mjs` |
| Sample data | Generated, illustrative BLR T2 map: 3 floors, 325 elements, 214 edges, `metadata.scale.metersPerUnit = 0.5` | `public/maps/blr-kia-t2.json` |
| Persistence | `localStorage` and JSON import/export only. No backend | `Index.tsx` |
| Georeference | Per-element lat/lng dialog and a true-north dialog (both unreachable, see bugs) | `Blueprint.tsx` |

**Not present:** routing/pathfinding, a user-facing map viewer, search, a location "blue dot", any sensor or camera code, AR, 3D, voice, a backend, auth, tests, or mobile layout.

### Reusable as-is
- The JSON venue format (floors + typed elements + graph) is a reasonable starting point.
- The typed-attribute pattern (`TYPE_FIELDS`) extends well to mall, railway, and bus types.
- The generator-script approach (`generate-blr-t2.mjs`) is the quickest way to build Indore demo maps.

---

## 2. Bugs and defects found (from reading the code and running `tsc` + `vite build`)

`vite build` succeeds. `tsc --noEmit` **fails** (3 errors). Vite doesn't type-check, so this has gone unnoticed.

| # | Severity | Issue | Location |
|---|---|---|---|
| B1 | **High (navigation)** | Edges join **area centroids**, so distances are wrong and routes cut through walls. Example: `Forecourt → Entry 1` is stored as **368 m** (≈4.7 min) because the forecourt centroid is 735 units away at the middle of a 1680-wide strip. Navigation needs a walkable path network (corridor centrelines plus door nodes), not a room-adjacency graph. | `scripts/generate-blr-t2.mjs:38-55` |
| B2 | **High** | Export, Save and Import **drop `metadata.scale` and the venue name/location**. After one round trip through the editor, the metres-per-unit scale is lost, so all metric distances break. | `Index.tsx` `handleExport` / `handleSave` / `handleImportJson` |
| B3 | **High** | `trueNorth` lives in local state in `Blueprint.tsx` and is never written to `blueprintData`, so it's lost on save. AR alignment needs it. | `Blueprint.tsx:58` |
| B4 | High (editor) | Straight, path and bent connections look impossible to create from the UI: `startConnection` never sets `drawing=true`, but `handleMouseUp` only finishes a connection `if (drawing ...)`. Multi-point connections only complete if the last bend point falls inside the target, yet clicking on an element is swallowed. (Found by reading the code; I haven't verified it in a browser.) The BLR map only works because a script generated it. | `Blueprint.tsx:98-188` |
| B5 | Medium | The `coordinates` and `true-north` tools exist in `Blueprint.tsx`, but no sidebar button selects them, so they can't be reached. The `draw-polygon` and `draw-line` buttons exist but do nothing. | `LeftSidebar.tsx` |
| B6 | Medium | `tsc` errors: `customPois` and `setCustomPois` are undefined (dead copy-paste `handleAddCustomPoi`). | `Blueprint.tsx:276-282` |
| B7 | Medium | Undo/Redo buttons in the top bar have no `onClick` (only the keyboard shortcuts work). Every mouse-move during a drag pushes a full deep-copy history entry. The `isUndoRedoAction` flag skips the *next* edit, not the undo itself. | `TopNavBar.tsx`, `Index.tsx` |
| B8 | Low | Delete is handled twice (`Index.tsx` and `Blueprint.tsx` both listen on `keydown`). | |
| B9 | Low | Rectangles only, with no rotation and no polygons. Malls and stations have curved and irregular shapes. Walls are drawn but don't constrain routing. | `useDrawing.ts` |
| B10 | Low | `strict: false` with `any` everywhere, no tests, ~45 unused shadcn components, and a 504 KB single bundle. The README is still the Lovable boilerplate. | |

---

## 3. Things your brief doesn't cover yet

Grouped. Each item has a proposed solution.

### A. Product and scope
1. **Two apps, not one.** You need (a) an **authoring/admin tool**, which is the current repo extended, and (b) a **consumer navigator app**: search → route → blue dot → AR. The current code is only (a).
2. **City layer.** "Google Maps for Indore spaces" implies an outdoor map of Indore listing venues, and an outdoor-to-indoor handoff ("navigate to Phoenix Citadel, then inside to PVR"). Solution: MapLibre GL + OpenStreetMap tiles for the city view, with venue pins that open the indoor map. Outdoor turn-by-turn is out of scope; hand off to Google Maps with a deep link.
3. **Venue-specific semantics.** Airport (check-in, security, gates, airside/landside), railway (platforms, foot-over-bridges, coach position, PNR/train number lookup, 1st-class waiting room), bus stand (bays/platforms per route, ticket counters), mall (shops by category, food court, parking levels, cinema). The type system is airport-only today.
4. **Parking.** "Where did I park?" (save the car's position on parking level P2) is the most-loved indoor-maps feature and is cheap to build.

### B. Map data (the biggest real-world bottleneck)
5. **No Indore maps exist yet.** You need floor plans for each demo venue. Options: official CAD/PDF from venue management (best), mall directory boards plus manual tracing, or a walk-through survey with a phone LiDAR scan or measuring. For a demo: **1–2 venues, traced from public directory photos, scale-calibrated with one measured corridor.**
6. **Scale and units.** Every coordinate must resolve to metres, and AR is unforgiving here: a 10% scale error is a 10 m arrow error over 100 m.
7. **Floor heights** (metres) are needed for AR and for floor-change logic.
8. **Walkable network.** Corridor centrelines, door/portal nodes on room boundaries, one-way rules, stairs vs. lift vs. escalator vs. ramp, accessibility, opening hours, access zones (airside needs a boarding pass, a railway platform needs a ticket).
9. **AR anchors.** The physical location (x, y, floor, height, facing) of every QR/image marker you print.
10. **Ad placements.** Wall surfaces as **pre-surveyed 3D quads** (floor, wall segment, bottom height, width × height, facing normal). See §5.
11. **Data versioning.** Shops change monthly. You need versioned venue packages so a phone running map v12 can't receive v13 anchors.

### C. Navigation engine (all deterministic)
12. **Pathfinding.** A* over the walk graph with cost = distance, plus penalties (stairs, crowd, escalator direction) and per-user filters (wheelchair → lifts only; stroller; no airside access).
13. **Turn-by-turn instructions.** Compute from the path polyline: angle change > 30° gives "turn left/right", landmark lookup within 10 m gives "after Starbucks, turn left", and floor change gives "take Lift EL-3 to Level 2".
14. **Off-route detection and reroute.** If the user is more than 5 m from the path for 3 s, recompute.
15. **Arrival detection.** Within 3 m of the destination portal, show "You have arrived".
16. **Multi-stop routes.** For example, check-in → security → gate.
17. **ETA**, using a walking speed of 1.2–1.3 m/s plus a fixed cost per lift wait.

### D. Positioning (see §4)
18. Not addressed in the brief at all, and it's the hardest part.

### E. AR
19. **Platform reality.** WebXR `immersive-ar` works in **Chrome on ARCore-supported Android phones only**. As far as I know, iOS Safari still has no WebXR AR. iPhone support would need a native app (ARKit) or a commercial web-AR SDK. Please confirm which phones the demo uses.
20. **HTTPS is mandatory** for the camera, motion sensors and WebXR. A laptop dev server on plain `http://192.168.x.x` won't work on the phone. Use `mkcert` or `vite-plugin-basic-ssl`, or a tunnel.
21. **Occlusion.** People walking in front of an AR ad or arrow won't hide it unless the device supports the WebXR Depth API. That's acceptable for a demo; say so up front.
22. **Safety.** Users walking while looking at the camera. Add a "look up" warning after N seconds, never render over emergency exits or escalator mouths, and auto-dim AR on stairs and escalators.
23. **Lighting and visual-tracking loss.** Plain white mall walls and glass storefronts are bad for visual tracking (no texture), which ironically makes empty walls hard to track. Pre-surveyed placements plus re-anchoring solve this (§5).

### F. Ads
24. **Ad inventory model:** advertiser, creative (image/video/3D), placement IDs, schedule, targeting (floor, zone, time of day, proximity), frequency cap.
25. **Impression and engagement metrics** (seen ≥1 s within 8 m and in view), tap-through to the shop, and route to the shop.
26. **Brand safety and policy:** no ads over signage, exits or fire equipment, and venue-owner approval. Do you need consent from the mall (the wall owner) for AR ads on their walls?

### G. Voice and AI (keep it minimal, as you want)
27. **Speaking instructions doesn't need AI.** Browser `speechSynthesis` (Web Speech API) is deterministic and free, and supports `en-IN` and `hi-IN` voices on Android Chrome.
28. **AI is only worth it for:** (a) free-text and voice queries ("kahan milega chai near gate 5?") → an LLM with tool-calling into the deterministic search and route API; (b) optional conversational help. The LLM never computes routes or positions.
29. **Speech-to-text:** Web Speech API recognition (Chrome, online) or Whisper. Language choice: Hindi, English, Hinglish?

### H. Platform and engineering
30. **Backend.** A static JSON venue package is fine for a demo. Live ads, analytics and multi-venue editing need one (Supabase is already connected to your Claude account and would fit).
31. **Offline and poor connectivity** in basements and parking. Make the viewer a PWA and cache the venue package.
32. **Privacy and the DPDP Act 2023.** Camera frames and indoor location traces are personal data. Keep everything on-device for the demo and state it.
33. **Accessibility:** screen reader, high-contrast mode, haptic turn cues, and wheelchair routing.
34. **Testing:** pathfinding and instruction generation are pure functions, so unit-test them (Vitest).
35. **Code quality:** turn on TS strict for new modules and add proper `Venue`, `Element` and `Edge` types.

---

## 4. Tracking the user: where they are and where they're moving

### Why the obvious options fail indoors
| Technique | Verdict |
|---|---|
| GPS | 10–50 m error indoors, no floor information. Use it only to pick the venue. |
| Wi-Fi fingerprinting / RTT | Browsers can't scan Wi-Fi. Native Android only, and it needs a site survey. |
| BLE beacons | Web Bluetooth scanning is not generally available. Needs a native app plus beacon hardware ($$, installation permission). |
| Magnetometer compass | Badly distorted indoors (steel structure, escalators, electrical). Don't trust it for heading. |
| Commercial indoor VPS (Immersal, Niantic/8th Wall-style, MultiSet) | Works well, but means scanning each venue, an SDK licence and vendor lock-in. Good for phase 2. |

### Recommended approach: "anchor + visual-inertial odometry + map-matching"
Fully deterministic, no extra hardware, works in a browser on Android:

1. **Absolute fix (where am I?).** Small **QR/ArUco markers** at known surveyed positions (entrances, lift lobbies, every major junction; roughly every 30–50 m). The user scans one, or one is auto-detected in AR. The marker encodes `venue/floor/markerId`, and we know its exact x, y, height and facing. Detecting the marker's pose in the camera gives the device's full 6-DoF pose in map coordinates: position *and* heading, with no compass.
   - Fallback without markers: the user taps "I'm at Shop X" from a list, or picks a spot on the map.
2. **Relative motion (where am I moving?).**
   - **In AR mode:** WebXR/ARCore already does visual-inertial odometry (VIO) and reports the phone's pose every frame with roughly 1–2% drift. Map pose = `markerTransform × xrPose`.
   - **In 2D map mode (phone in pocket or hand, camera off):** **pedestrian dead reckoning (PDR)** with step detection from the accelerometer, step length of about 0.7 m (calibratable), and heading from the gyroscope integrated from the last known heading (`DeviceMotion` / `DeviceOrientation` or the Generic Sensor API).
3. **Map-matching (keep it honest).** Snap the estimate onto the walkable network and forbid crossing walls. A small **particle filter** (around 300 particles, constrained by walls and corridors) on the 2D floor plan works well, and is fully deterministic given the sensor inputs.
4. **Re-anchoring.** Every marker seen (deliberately or incidentally in AR) resets the drift. Drift between markers stays within 1–3 m in AR and 3–8 m with PDR.
5. **Floor changes.** When the route goes through lift EL-3 and the user stops for more than 10 s inside the lift polygon, ask "Arrived at Level 2?" and confirm with the marker in the lift lobby. Browsers have no barometer API.

### For the laptop demo specifically
A laptop has no rear camera, no IMU and no GPS, so it can't experience AR walking itself. I propose three demo modes:

| Mode | Device | Use |
|---|---|---|
| **Simulation** | Laptop only | The blue dot walks the route (auto-play, or WASD/joystick). The "AR view" is a **pre-recorded walkthrough video** of the venue, with arrows and ads composited from the same route data. Always works on stage. |
| **Live phone + laptop mirror** | Android phone does AR; laptop is the server and **live "control room"** | The laptop serves the app over HTTPS on LAN. The phone streams its pose over WebSocket. The laptop shows the blue dot moving on the big screen. Most impressive. |
| **Webcam marker demo** | Laptop webcam | Hold a printed marker in front of the webcam to show localization snapping the dot to that marker. Proves the anchor concept without a phone. |

---

## 5. AR rendering design (deterministic)

- **Stack:** React viewer + **three.js** (or react-three-fiber) + **WebXR** (`immersive-ar` with `hit-test`, `anchors`, `dom-overlay`; optionally `plane-detection` and `depth-sensing` where available).
- **Route arrows:** take the computed path polyline (metres, map frame), convert it to XR world space through the anchor transform, then render chevrons on the floor every 1–2 m plus a large 3D turn arrow at each manoeuvre point (from §3 C13). Show only the next ~20 m to hide drift.
- **"Ad on an empty wall":** don't detect empty walls live. That's non-deterministic, and blank walls are exactly what visual tracking handles worst. Instead:
  1. Ad placements are **surveyed in the editor** as wall quads (new `adPlacement` element type).
  2. When the user is localized and the placement is within N m and in the camera frustum, render a textured plane (image/video) at that exact pose.
  3. Optionally, if `plane-detection` finds a vertical plane within 0.3 m of the surveyed one, snap to it for a tighter fit.
- **Mode switch (Map ↔ AR):** the same position estimate feeds both views. On entering AR, prompt "Point at the nearest marker" if the last fix is too old or uncertain.

---

## 6. Proposed architecture

```
artifacts/ (or new app folder)
├─ editor/   ← current Mobility-Application, fixed + extended
│   └─ new types: mall/rail/bus, polygons, walk-network tool, markers, ad placements, scale calibration
├─ venue-packages/  ← versioned JSON per venue (geometry + graph + markers + ads)
├─ navigator/ (PWA, mobile-first)
│   ├─ city map (MapLibre + OSM)        ├─ indoor 2D map (SVG/Canvas, heading-up)
│   ├─ search (Fuse.js fuzzy, offline)  ├─ routing (A*), instructions, reroute
│   ├─ positioning (markers, PDR, particle filter, XR pose fusion)
│   ├─ AR (three.js + WebXR): arrows, ads
│   └─ voice (speechSynthesis; optional LLM for free-text queries)
└─ demo-server/ ← HTTPS + WebSocket pose relay + laptop control-room view
```

### Suggested phasing
1. **P0: foundations.** Fix B1–B7. Add a metric scale, a walk-network editor and polygon support. Build one Indore venue map.
2. **P1: 2D navigator.** Search → A* route → instructions → simulated blue dot → TTS. Laptop simulation demo works end to end.
3. **P2: positioning.** QR markers, PDR, particle filter, live phone → laptop mirror.
4. **P3: AR.** WebXR arrows, then surveyed ad placements.
5. **P4: AI.** Voice/free-text query via an LLM with tool-calling into the deterministic search and route API.

---

## 7. Questions for you

### Scope and demo
1. Who is the demo audience (investors, the venue owner such as a mall or the AAI, a hackathon jury, an internal team)? What must they *feel*: "wow AR", or "this could be deployed"?
2. When you say "we will use it on a laptop", which do you mean: (a) everything runs on the laptop (simulation), (b) the laptop is the server or presenter and a phone does the AR, or (c) both?
3. Demo date or deadline? How much time per week can you put in, and who else is on the team? (The last commit is by Swaroop Padala; are they involved?)
4. Will the demo happen **physically inside an Indore venue**, or in a room or office?
5. If in a room: is it acceptable to build a **mock venue in your office**, with the map of the office posing as a mall, so the live AR walk is real?
6. Which venues are in scope for the demo: one, or all four kinds (mall, airport, railway, bus)? Which specific ones (e.g. Phoenix Citadel, C21, Treasure Island, Malhar Mega Mall, DAHI Airport, Indore Junction, Sarwate / Naya ISBT)?
7. Is the city-level outdoor map of Indore (venue pins) needed for the demo, or do we start directly inside one venue?

### Devices and platform
8. Which phone(s) will run the AR? Android (model?) or iPhone? This decides WebXR vs. native.
9. Are you open to a **native app** (Unity AR Foundation, or React Native) if iPhone support is required, or must it stay a web app?
10. Is it acceptable to require Chrome on Android for AR, with iPhone users getting the 2D map only?
11. Will there be Wi-Fi or mobile internet at the demo location?

### Map data
12. Do you have floor plans (CAD/PDF/images) for any Indore venue? Do you have permission to use them?
13. Is an **approximate or illustrative** map acceptable, like the BLR one, or must it be accurate?
14. How many floors per venue, and is parking included?
15. Who will maintain maps later: you, venue staff, or both? Does the editor need logins and roles?
16. Should I keep building maps with generator scripts (fast, as was done for BLR), or fix the editor so maps can be drawn by hand? Or both?
17. Should the editor become polygon-based (much better for malls), even though that means reworking the rectangle model?

### Positioning
18. Is **printing and sticking QR markers** at the venue acceptable? If not at a real venue, then in the office mock?
19. Is buying BLE beacons ever an option, later or now?
20. Is a "tap where you are" manual fallback acceptable in the demo?
21. What accuracy is "good enough" for you: within 2 m, 5 m, or just the correct corridor?
22. Should the laptop show a **live tracking dashboard** of the phone (or several phones)?

### Navigation
23. Which routing preferences matter: wheelchair/lift-only, avoid stairs, shortest vs. fewest floor changes, stroller?
24. Do access rules matter (airside needs a boarding pass, platforms need tickets, staff-only areas)?
25. Multi-stop routes (check-in → security → gate)?
26. Heading-up map rotation like Google Maps, or north-up?
27. Real-time data: flight status, train platform/delay (NTES), bus timings? Or static only?

### AR
28. AR features beyond turn arrows and wall ads: floating destination pin, shop labels on storefronts, distance-remaining HUD, "follow the line" floor path?
29. Should ads be static images, videos, or 3D models? Clickable?
30. Who supplies ad creatives for the demo? Should I make placeholder brands, or use real Indore brands (that needs permission)?
31. Should ads be targeted (by floor, by proximity, by the user's destination, time-based), or just a fixed placement?
32. Do you need ad analytics (impressions, dwell time) in the demo?
33. AR when the phone loses tracking: fall back to the 2D map automatically?

### Voice and AI
34. Should voice be one-way (spoken instructions) or two-way ("Hey, take me to the food court")?
35. Which languages: English, Hindi, Hinglish? Marathi?
36. Which AI provider for the "few AI cases": Claude, OpenAI, a local model? Is there a budget or API key?
37. Is internet guaranteed during the demo? If not, AI must be optional and degrade gracefully.

### Engineering and repo
38. "Create a folder named artifacts outside the repo": did you mean (a) a place for docs and outputs like this file, or (b) the new application lives there and the existing repo stays untouched? Should the new navigator app go *inside* `Mobility-Application` (a monorepo) or alongside it?
39. Can I fix the bugs in the existing editor (§2), or should I leave the repo as-is?
40. Do you still use Lovable to edit this project? (Changes I push would sync there.)
41. Is a backend wanted for the demo (Supabase), or are static JSON files fine?
42. Where should the demo be hosted (laptop only, Vercel/Netlify, or Lovable)?
43. Any branding, name, or design language for the app?

### Business, legal and safety (to note, maybe not for the demo)
44. Have any venue owners been approached? Do they need to approve AR ads on their walls?
45. Data and privacy stance: no data leaves the phone, or anonymous analytics?
46. Safety requirements: walking warnings, restrictions on AR near escalators and stairs?
