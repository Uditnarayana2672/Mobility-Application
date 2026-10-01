# Indore Spaces: decisions so far, venue-mapping plan, and how positioning works

Date: 2026-10-02 · Follows `01-codebase-analysis-and-plan.md`

---

## 1. Decisions recorded

| # | Topic | Decision |
|---|---|---|
| 1 | Demo setup | **Both.** Laptop-only simulation mode, plus a live mode where an Android phone does AR and the laptop serves the app and shows a live tracking dashboard |
| 2 | Platform | **Android only** |
| 3 | Demo venue | **Your office** first. Venue types in scope: malls, office spaces / tech parks, airports, railway stations, bus stands |
| 4 | Existing floor plans | **None available** |
| 5 | Markers | *Explained below (§4). Answer still needed* |
| 6 | Target accuracy | **~2 m** |
| 7 | Ads | Images **and** videos, placeholder brands |
| 8 | Voice | **Two-way**: English, Hinglish, Telugu |
| 9 | `artifacts/` | Documents only |
| 10 | Existing bugs | Fix when coding starts, not now |
| 11 | Timeline | No hard deadline |
| 12 | Platform | **Web app (Chrome on Android)**, WebXR for AR. No PWA/service worker for the demo (see doc 03). Floor changes confirmed with one tap or a lobby marker |
| 13 | Positioning | **Markers** approach accepted (still get Admin/Security OK) |
| 14 | Office | 4 floors, **access to 2**. Has **lift + stairs** (no escalator) |
| 15 | Connectivity | Internet reliable in office |
| 16 | AI provider | Deferred |

New venue type to add to the editor: **office / tech park** (work bays, meeting rooms, cabins, cafeteria, pantry, reception, server room (restricted), washrooms, lift lobby, fire exits, parking).

---

## 2. Venue mapping plan

### Is mapping your own office the right start? Yes.
- You have unlimited access to walk, measure, re-test and fix.
- You can put markers on walls and test AR ads on real walls.
- An office has multiple floors, lifts and stairs, so it exercises the hardest problem (floor changes).
- **Check first:** many Indian IT offices restrict photography/camera use and wall stickers. Get written OK from Admin/Facilities/Security before you scan or stick anything.

### Manual vs. AI: recommendation
| Approach | Verdict |
|---|---|
| **A. Manual tracing in the editor over a reference image, with measured scale** | ✅ **Do this now.** Accurate, deterministic, 1–2 days per office floor |
| **B. "Walk-to-map" recorder**: walk the corridors with the phone in AR mode, and the app records your exact path in metres; tap to drop doors, lifts, POIs | ✅ **Build this next.** Best long-term tool. It produces the walkable network in the same coordinate system the AR uses, so it's more accurate for AR than any drawing |
| **C. AI drafting assistant**: upload a photo of the fire-evacuation plan; a vision model proposes rooms and corridors as editor elements (via the editor's own tools); a human corrects and approves | 🟡 **Later, nice-to-have.** Saves tracing time; never trusted without review |
| **D. Autonomous AI agent that "looks at the space" and builds the plan** | ❌ **Not recommended.** Camera images alone don't give reliable metric dimensions. At a 2 m accuracy target it will produce maps that look right but are metres off, and you won't know where. Also non-deterministic |

### Step-by-step for the office (approach A)
1. **Get a reference image.** Every Indian office floor must display a **fire-evacuation plan** (National Building Code), usually near lift lobbies and exits. Photograph it straight-on. Also ask Facilities for a CAD/PDF; they almost always have one for interiors/HVAC.
2. **Measure 3–5 reference distances** per floor (one long corridor end-to-end, a room width, lift lobby width) with a laser distance meter (~₹1.5–3k) or tape. This fixes the scale.
3. **Note floor-to-floor height** (count stair steps × riser height, usually ~3.5–4.2 m).
4. **In the editor** (needs new features, see §6): set the image as a background underlay → draw a line over the measured corridor and enter "42 m" → scale is set → trace rooms (polygons), walls, doors.
5. **Draw the walkable network**: corridor centrelines, door nodes, lift/stairs/escalator nodes per floor with vertical links.
6. **Add POIs and metadata**: names, categories, room numbers, opening hours, accessibility.
7. **Place markers and ad placements** (§4, §7) at their surveyed spots.
8. **Walk-verify**: walk every route with the phone in AR mode and compare. Fix anything off by more than 1 m.

---

## 3. How the app decides "turn now" in AR (no AI, no billboard reading)

Turns are **computed from geometry before you take your first step**, not "seen" by the camera.

1. Route = A* over the walkable network → a polyline in metres, e.g. `Desk 14 → (0,0) → (18,0) → (18,12) → Cafeteria`.
2. At each polyline vertex, compute the angle change. Above 30° it becomes a **manoeuvre point** with a fixed map coordinate: "turn left at (18,0)".
3. The phrasing uses the nearest **named landmark from the map data** within ~8 m: "turn left after Meeting Room Everest".
4. Live tracking gives your position every frame. The app measures **distance to the next manoeuvre point**:
   - 15 m: voice says "In 15 metres, turn left after Everest"
   - 3 m: big 3D turn arrow is placed *at that coordinate* in AR, plus voice "Turn left now"
   - passed the point and heading matches the new segment → next manoeuvre
   - more than 5 m from the route for 3 s → reroute
5. **Billboards / signs (OCR):** not used for decisions. Text recognition is unreliable (angle, glare, motion), and signs change. Markers do the "where am I exactly" job deterministically. Sign recognition could later be an *extra* re-localization hint, never the primary signal.

---

## 4. Markers explained (question 5)

**What:** a printed square code (QR or ArUco), about A5–A4 size, stuck on a wall at roughly eye level (~1.4 m). Each one encodes an ID like `office-hq / Floor-1 / M07`.

**What the app knows about each marker (stored in the map):** exact x, y in metres, **floor**, height on the wall, and which direction it faces.

**What happens when the phone sees it:**
- The app looks up M07 and knows **which floor** you're on (Floor 1) and where you are.
- From the square's size and skew in the camera image, it computes your distance and angle to the marker. So it gets your **exact position (±20–30 cm) and the direction you're facing**, without GPS or compass.
- From then on, AR tracking follows your movement. Every time another marker comes into view (even passively), small drift is corrected.

**Where to put them in an office:** at the entrance/reception, inside every lift lobby (one per floor, which is critical for floor detection), at stair doors on every floor, at main corridor junctions, near cafeteria entries. Roughly 6–12 per floor.

**Why they're needed:** without them, a phone indoors has no reliable way to know its absolute position or floor (GPS doesn't work indoors; compass is distorted). Markers are the cheapest deterministic "you are here" stickers.

**Alternatives if stickers are not allowed:** use existing permanent signage (room nameplates, company logo on reception wall) as **image targets**: photograph them during mapping, record their position. Works, but is less robust than a purpose-made code. Or the manual "Tap where you are" fallback.

---

## 5. How the 2D map should look

**Google-Maps-style indoor map, not an architectural blueprint.** Blueprints (grids, dimensions, hatching, thin lines) are for the editor. Visitors need a clean, readable map.

- Flat, softly coloured room shapes **by category** (food = orange, meeting rooms = blue, washrooms = teal, restricted = grey hatched); light-grey corridors; thin dark walls.
- Icons and labels that appear by zoom level (big areas first, small POIs when zoomed in).
- **Floor switcher** on the right edge (G / 1 / 2 …), current floor highlighted.
- **User marker:** blue dot with a **heading cone** (flashlight beam) that points where the phone faces. A narrow cone means confident heading; a wide cone means uncertain. A grey dot means the position is stale, which prompts "scan a marker".
- **Accuracy circle** around the dot, from the tracker's uncertainty.
- **Route:** thick blue line on the current floor; dashed on other floors; a pill at lifts/stairs: "Take lift to Floor 2".
- **Two modes:** *Explore* = north-up, free pan. *Navigate* = **heading-up**: the map rotates so your arrow always points up, like Google Maps driving mode. A recentre button.
- **Bottom sheet:** search, next instruction ("In 12 m turn right"), ETA, "Switch to AR".

---

## 6. Floor detection and choosing lift / stairs / escalator

### Without camera (2D map mode)
In a **web app (Chrome PWA)** there's no barometer and no Wi-Fi scanning, so floor must be inferred:
1. **Starting floor is known**: from the marker scanned at entry, or the user picks "I'm at Desk 14" / "Reception", which belong to a floor.
2. **Floor changes are expected**: the route says "take Lift B to Floor 2". Step-tracking sees you reach the lift lobby, steps stop (lift) or a stair-climbing step pattern appears (stairs).
3. The app asks one tap: **"Are you on Floor 2 now?"**, or auto-confirms if a lobby marker is seen.
4. Unplanned floor changes (user wanders off and takes the stairs) can't be detected reliably in a web app. The user taps the floor switcher.

In a **native Android app**, floor detection becomes automatic:
- **Barometer:** most mid/high-range Android phones have one. One floor ≈ 3.5–4 m ≈ 0.4–0.5 hPa change, which is clearly detectable as a *relative* change (absolute pressure drifts with weather, so calibrate at each marker).
- **Wi-Fi scan:** the office has Wi-Fi access points on every floor. During mapping, record which APs are strongest per floor. At runtime, the strongest APs tell you the floor with high reliability. Android throttles scans to 4 per 2 min in the foreground, which is enough for floor detection.
- This is the main argument for native over web. See the open question below.

### With camera (AR mode)
- **AR tracking alone does not know the floor or the absolute position.** It only knows how the phone moved since the session started, in its own local coordinates.
- The **first marker seen** ties AR coordinates to the map (position + facing + floor).
- After that, AR tracking measures vertical movement too. Going up stairs or an escalator shows a ~+4 m change in height, so the floor change is detected automatically. Lifts are a problem: the camera sees a closed box and tracking often pauses, so the app re-localizes from the **lift-lobby marker** when the doors open.
- Visual recognition without markers (commercial "visual positioning systems") struggles in offices because **floors often look identical**. Markers with a floor ID, or Wi-Fi in native, settle that.

### Lift vs. stairs vs. escalator: deterministic choice
The routing graph contains every lift, staircase and escalator. A* optimises **time**, not raw distance:

| Connector | Cost model (tunable defaults) |
|---|---|
| Walk | distance ÷ 1.3 m/s |
| Stairs | ~15 s per floor up, ~10 s down (+ penalty if > 2 floors up) |
| Escalator | ~20 s per floor, direction respected |
| Lift | ~40 s average wait + ~4 s per floor |

**Example.** You're at Desk 14 on Floor 1, going to the cafeteria on Floor 2.
- Via Stairs S1: walk 25 m + 1 floor up + walk 30 m ≈ **1 min 0 s**
- Via Lift B: walk 40 m + wait + ride + walk 10 m ≈ **1 min 30 s**

The app shows **"Fastest: Stairs S1 · 1 min"** with an alternative chip **"Lift B · 1 min 30 s"**.

**Preferences:** wheelchair/stroller allows lifts only; "avoid stairs" increases the stairs cost.

**Instructions:** "Walk 25 m, turn right to Stairs S1 → Go up 1 floor → Exit, turn left, cafeteria in 30 m."

In AR, the arrow leads to the stair door. On the new floor, the stair-landing marker re-localizes and the route continues.

---

## 7. Editor features this plan adds (for when coding starts)
- Background image underlay with opacity, per floor
- Scale calibration ("draw a line, enter metres")
- Polygon rooms + rotation
- Walkable-network tool (centrelines, door nodes) replacing centroid-to-centroid edges
- Floor height per floor
- Marker element (id, x, y, height, facing, floor) + printable marker sheet export
- Ad placement element (wall quad: position, width, height, bottom height, facing)
- Wi-Fi fingerprint survey layer (native app only)
- Office / tech-park type set
- Later: walk-to-map recorder (phone), AI drafting from fire-plan image

---

## 8. Open questions from this round
1. **Web (Chrome PWA) or native Android?**
   - **Web:** reuses this React code, fastest to build, AR via WebXR works. But floor changes need a one-tap confirm, and no Wi-Fi/barometer.
   - **Native** (Kotlin + ARCore, or Unity AR Foundation): automatic floor detection (barometer + Wi-Fi), stronger AR (ARCore Cloud Anchors, image tracking), but a new codebase.
   - Middle path: web for the demo, native later.
2. Is sticking markers allowed in your office? If not, are existing nameplates/logos OK as image targets?
3. How many floors does your office have, and which floors can you access?
4. Lifts, stairs, escalators in your office: which exist?
5. Is a laser distance meter purchase OK (~₹2k)?
6. Telugu voice: Android's TTS does Telugu (`te-IN`) reasonably. Is that enough, or do you want a more natural voice (cloud TTS, needs internet)?
7. For the two-way voice AI: is internet available in the office demo, and which AI provider/budget?
