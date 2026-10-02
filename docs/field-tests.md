# Field tests — Phase 3 positioning

Goal (from the build plan): **walking, the dot stays within ≈ 3 m; right after a marker scan it is within ≈ 0.5 m; the laptop dashboard mirrors it live.**
These numbers can only be measured with the phone in the office. Fill the tables below and copy the summary into `docs/PROGRESS.md` ("Phase 3 field results").

## 0. Before you start

- [ ] Spikes S1–S5 are still blank in PROGRESS.md. Run at least **S1/S2/S5** first: if S5 (tracking under a full-screen overlay) fails, test with `?pose=pdr`; if S2-A (camera-access) fails, XR cannot see markers and the app falls back to step counting automatically only if you switch (see "Use step counting instead" on the locate screen).
- [ ] `npm run certs` done, `npm run dev:lan` running, phone and laptop on the same Wi-Fi (docs/https-on-phone.md).
- [ ] Markers printed at 100 % scale and **measured** (the black square must equal `sizeM` in the editor, default 0.12 m). Stick them at the heights/facings recorded in the venue (`z` = 1.4 m by default, `normal` = the way the sticker faces).
  - Synthetic tests (tests/positioning-markers.test.ts) show a 12 cm marker is reliable to about **1.5 m**; beyond ~2.5 m the app ignores it. A bigger marker (A4, 17 cm; set `sizeM` accordingly) roughly halves the position error at the same distance. If scans at 1–2 m are poor, print bigger before blaming the maths.
- [ ] Phone: `https://<laptop-ip>:8080/nav` (**no** `?demo=1`) for AR, or `…/nav?pose=pdr` to force step counting. Add `&debug=1` to see fps, tracking state, reprojection error, rejected-detection reason and the particle cloud.
- [ ] Laptop: `https://<laptop-ip>:8080/dashboard`. The pill must say "Live — phone connected" and "server link: open".
- [ ] Phone held the way a visitor holds it while navigating (tilted, looking at the map). Don't hold it flat.

## 1. How to take a measurement

1. Tape a cross on the floor at every checkpoint (coordinates below, measured from the wall/marker with the laser meter; the venue frame is x east, y south, in metres).
2. Stand with the **phone's camera at the tape** (the dot is the phone's position, not your feet). Stand still for 2 s.
3. Read the dot from the dashboard ("Position (m)") or the debug overlay. **Error = distance between the dot and the tape coordinates** (`√(Δx² + Δy²)`).
4. Note the source badge (XR / PDR / MARKER), the accuracy radius the app claims, and whether a marker was scanned in the last 10 s ("after scan").
5. Do each route twice; start each from a fresh scan of the first marker.

Checkpoints below use the bundled `office-hq` demo geometry. **Your real office was traced in Phase 1: re-pick the coordinates from your own venue** (marker positions in the editor's Properties panel, corridor centre-lines from the walk path) and overwrite the "true" columns. Keep corridor checkpoints on the centre-line (y = 17 in the demo venue).

## 2. The four routes

### R1 — Straight corridor, Floor 1 (AR drift / step counting on a plain walk)
Scan marker 1 (Reception, 3,15). Walk east along the corridor centre-line, stopping at each tape. Markers 2 (11,19), 3 (21,19) and 4 (45,15) are on the way: **do not point the camera at them** except at the rows marked "scan".

| # | Checkpoint (floor, x, y) | Note | Dot x,y | Error (m) | Claimed ± (m) | Source | After scan? |
|---|---|---|---|---|---|---|---|
| 1 | F1, 3.0, 17.0 | right after scanning marker 1 | | | | | yes |
| 2 | F1, 10.0, 17.0 | 7 m walked | | | | | no |
| 3 | F1, 20.0, 17.0 | 17 m | | | | | no |
| 4 | F1, 30.0, 17.0 | 27 m | | | | | no |
| 5 | F1, 43.0, 17.0 | 40 m, before marker 4 | | | | | no |
| 6 | F1, 45.0, 17.0 | right after scanning marker 4 (re-anchor) | | | | | yes |

### R2 — Turns and a room (step counting must respect doors)
Scan marker 1, walk east to the Pantry door (32,19), enter 3 m, come back, continue east to marker 4.

| # | Checkpoint | Note | Dot x,y | Error (m) | Claimed ± (m) | Source | After scan? |
|---|---|---|---|---|---|---|---|
| 1 | F1, 3.0, 17.0 | after scan of marker 1 | | | | | yes |
| 2 | F1, 32.0, 17.0 | corridor, in front of the Pantry door | | | | | no |
| 3 | F1, 32.0, 22.0 | inside the Pantry (turned 90° twice) | | | | | no |
| 4 | F1, 32.0, 17.0 | back in the corridor | | | | | no |
| 5 | F1, 45.0, 17.0 | after scanning marker 4 | | | | | yes |

### R3 — Stairs F1 → F2 (floor change by stairs)
Scan marker 3 (Stairs door F1, 21,19), navigate to **Cafeteria** choosing **stairs**, climb. Note when the app says "Are you on Floor 2 now?" (XR: after ≈ 2.5 m of climb; PDR: as soon as you reach the stairs). Tap **Yes** or look at marker 5 (Stairs door F2, 21,19) at the top.

| # | Checkpoint | Note | Dot x,y | Error (m) | Claimed ± (m) | Source | After scan? |
|---|---|---|---|---|---|---|---|
| 1 | F1, 23.0, 17.0 | foot of the stairs | | | | | no |
| 2 | F2, 23.0, 17.0 | top of the stairs, **before** looking at marker 5 | | | | | no |
| 3 | F2, 23.0, 17.0 | after scanning marker 5 (lobby marker confirms the floor) | | | | | yes |

Record: floor prompt appeared? ☐ yes ☐ no · was the **floor shown correct** at the top before the prompt? ☐ yes ☐ no · confirmed by ☐ tap ☐ marker.

### R4 — Lift F1 → F2 and a long walk (lift pauses tracking; marker re-localises)
Scan marker 2 (Lift lobby F1, 11,19), navigate to Cafeteria choosing **lift**. Ride it. On Floor 2 look at marker 6 (11,19), then walk east to the Cafeteria entrance marker 7 (29,15) and on to marker 8 (45,15).

| # | Checkpoint | Note | Dot x,y | Error (m) | Claimed ± (m) | Source | After scan? |
|---|---|---|---|---|---|---|---|
| 1 | F2, 12.0, 17.0 | on leaving the lift, **before** scanning marker 6 | | | | | no |
| 2 | F2, 12.0, 17.0 | after scanning marker 6 | | | | | yes |
| 3 | F2, 27.0, 17.0 | 15 m walk, in front of the Cafeteria door | | | | | no |
| 4 | F2, 45.0, 17.0 | after scanning marker 8 | | | | | yes |

Record: tracking lost/limited while in the lift? ☐ yes ☐ no · the app asked to "scan a marker"? ☐ yes ☐ no.

## 3. Other things to check on the way

| Check | Result |
|---|---|
| Walk off the route by ≥ 6 m for 3 s → "off route" + new route | ☐ ok ☐ not triggered ☐ false alarm |
| Cover the camera / run into a featureless wall (tracking lost) → dot grey, "scan a marker" toast, no reroute | ☐ ok |
| Dashboard latency: scan a marker, count seconds until the dashboard log shows it | ___ s |
| Switch the phone's Wi-Fi off 10 s and on again → dashboard shows "Phone offline", then live again without reloading the phone | ☐ ok |
| Dashboard "⏪ Replay last walk" replays the route you just walked | ☐ ok |
| Publish a change in `/editor` while the phone is on the map → phone toast "Map updated (vN)" and the dashboard banner | ☐ ok |
| Phone `?debug=1`: fps / reprojection error plausible (≤ 2.5 px accepted); rejections are "oblique"/"too-far" when expected | ☐ ok |
| Battery drain over 10 min of AR (start / end %) | ___ % → ___ % |

## 4. Summary to copy into PROGRESS.md

| Metric | Target | Measured |
|---|---|---|
| Median walking error (rows "after scan = no") | ≤ 3 m | ___ m |
| Worst walking error | — | ___ m |
| Median error right after a scan (rows "after scan = yes") | ≤ 0.5 m | ___ m |
| Worst error right after a scan | — | ___ m |
| Distance from which a scan reliably works (marker size ___ cm) | ≥ 1.5 m | ___ m |
| Floor change detected / confirmed correctly (R3, R4) | 4 of 4 | ___ of 4 |
| Source used (XR / PDR) and why | | |
