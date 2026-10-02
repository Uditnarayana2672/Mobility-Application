# Demo runbook

This is the stage sequence from `docs/03-build-plan.md`, with one recovery action at every hand-off. Rehearse it once on the actual LAN and POCO X5 Pro.

## Before the audience arrives

1. Laptop: install/renew the trusted LAN certificate, connect laptop and phone to the same Wi-Fi, then run `npm run dev:lan`. Keep the printed URL/QR visible.
   - Recovery: if the IP changed, stop the server, run `npm run certs`, then restart `npm run dev:lan` and use the newly printed URL.
2. Put `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in the server-only `.env`. Never use a `VITE_` prefix. The deterministic voice demo does not require this key.
   - Recovery: if the provider is unavailable, continue; the app shows local “Did you mean…” suggestions and all scripted intents remain offline.
3. Open `/preflight` on the phone. Tap **Run phone checks**, grant motion/camera access, and show marker 1 until all seven checks are green. Confirm the venue version is the intended published version.
   - Recovery: fix the red item using its message. Missing language voice data is non-fatal because captions remain available; WebXR failure can use PDR; a marker failure can use the manual marker list.
4. Laptop: open `/dashboard` full-screen and `/ads` in a second window. Phone: open `/nav?debug=1`.
   - Recovery: if the dashboard server link is not open, reload both devices on the exact same HTTPS origin and Wi-Fi.
5. Click **Reset entire demo** on `/preflight` (or **Reset demo** on the dashboard). Verify the dashboard has no active phone, route, trail, or events.
   - Recovery: reload `/nav` and `/dashboard`; historical JSONL recordings are intentionally retained, but live replay state is cleared.
6. Place marker 1 at reception, the Floor 2 lobby marker at the exit from the chosen connector, and tape the AR/wall reference points. Start with the scripted campaign active on W01.
   - Recovery: if the physical setup moved, use the surveyed positions, not ad-hoc visual offsets; re-publish corrected venue/campaign data before doors open.

## On-stage scenario

1. Show the laptop map on Floor 1. On the phone choose the office, tap **Start AR tracking**, and scan reception marker 1 from roughly 1–1.5 m.
   - Expected: the phone opens the map; the dashboard dot appears at reception with the correct heading and marker `#1`.
   - Recovery: tap **Scan marker** and retry face-on in better light. If raw XR camera access fails, choose **Use step counting instead** and scan through the normal camera.
2. Hold the voice button, say “cafeteria kahan hai?”, then release.
   - Expected: the partial transcript is visible while speaking; the phone answers in Hinglish and shows the Cafeteria card. Starting to speak while TTS is active stops TTS immediately.
   - Recovery: tap the Hinglish example chip or type the exact phrase. If recognition selected the wrong language, select **Hinglish** first. This phrase is deterministic and never needs internet.
3. Tap **Directions**. Show the stairs and lift choices, toggle **Avoid stairs** once, then select the route required for the rehearsal.
   - Expected: route geometry, ETA, and the same route appear on the dashboard.
   - Recovery: say “avoid stairs” or choose the lift card directly. If position is missing, scan marker 1 again.
4. Tap **Start**, then switch to AR by voice (“switch to AR”) or the camera button.
   - Expected: the existing XR session continues without another permission prompt or re-localisation; floor chevrons lead down the corridor and the turn arrow appears within 15 m.
   - Recovery: say “switch to map” and continue in 2D. If tracking is marked lost, let the automatic 2D return happen and scan the nearest marker.
5. At W01, hold the phone toward the blank wall.
   - Expected: the muted inline video/poster is registered to the surveyed wall; after one second the dashboard impression count increments.
   - Recovery: use the poster fallback if video playback is delayed. If the quad is absent, check that the campaign is active, assigned to W01, on the current floor, and within 10 m.
6. Tap the ad, show the offer sheet, then dismiss it (or use **Route to** only if it is part of that rehearsal).
   - Expected: a tap event and KPI appear on the dashboard.
   - Recovery: if raycast selection is awkward, move closer and aim at the centre of the quad; do not change the surveyed wall during the demo.
7. On the laptop `/ads`, pause the visible campaign while the phone still faces W01.
   - Expected: the ad disappears from the phone within two seconds; resume it if desired.
   - Recovery: confirm the dashboard server link is open, then toggle once more. If the link dropped, continue navigation; campaign state will refresh after WebSocket reconnect.
8. Continue to the stair/lift door.
   - Expected: arrows and ads are suppressed inside the 2 m safety area; the phone asks whether the visitor is on Floor 2.
   - Recovery: if the prompt appears early, stop at the door and use the scripted confirmation only after physically changing floor.
9. On Floor 2, show the lobby marker to the phone.
   - Expected: the marker confirms Floor 2, re-anchors position, and guidance continues toward the Cafeteria.
   - Recovery: tap **Yes** on the floor prompt, then scan the Floor 2 marker from the map as soon as it is in view.
10. Continue until “You have arrived at Cafeteria.” Show the completed trail, scans, impressions, tap, and event log on the laptop.
    - Recovery: if arrival does not trigger, scan marker 7 at the Cafeteria entrance or remain on the route until within 3 m of the destination.

## Voice proof points (after the main route, if time allows)

- English: “Where am I?”, “Nearest washroom”, “How long?”, “Repeat”, “Stop”, “Switch to map.”
- Hinglish: “Main kahan hoon?”, “Sabse paas ka washroom”, “Kitna time baaki hai?”, “Phir se.”
- Telugu: “నేను ఎక్కడ ఉన్నాను?”, “దగ్గర టాయిలెట్”, “ఇంకా ఎంత సేపు?”, “మళ్లీ.”
- Free-form proof: ask a venue-hours question. The server assistant may call core tools; it never calculates position or routes. With internet disabled, show the local suggestion response, then issue a deterministic command successfully.

## Hard fallback

If any phone, certificate, camera, WebXR, sensor, Wi-Fi, voice-recognition, or provider failure cannot be recovered in one attempt: **switch to laptop simulation**.
