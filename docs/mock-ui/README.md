# Indore Spaces — clickable mock UI

A static HTML/CSS/JS mock of the whole demo. **This is the UI spec the real implementation follows.**
No build step, no dependencies. Open `index.html` in Chrome or Edge (double-click works; `npx serve .` also works).

## Pages

| File | Role | What to try |
|---|---|---|
| `index.html` | Hub | Role cards, 2-minute demo script, mock → real mapping |
| `nav.html` | Visitor app (phone frame on laptop, full-screen on Android) | Scan marker → search → directions → navigate → AR → arrive; voice in EN / Hinglish / తెలుగు |
| `owner.html` | Venue owner portal | “Add a new space” wizard (basics → plan → scale → finish), publish status, versions |
| `editor.html` | Map editor | Draw rooms, walk path, markers, ad slots, scale; validate; **Publish** |
| `ads.html` | Advertiser portal | Image / video campaigns, wall slots, pause / resume |
| `markers.html` | Printable marker stickers | Per floor, A6 / A5 / A4 |
| `dashboard.html` | Laptop control room | Live dot, route, trail, events mirrored from the phone tab |

## How the pages talk to each other (all in the same browser)

> In the mock this only works inside one browser (localStorage + BroadcastChannel). The real app puts a `Bus` interface in front of it: BroadcastChannel for simulation, WebSocket via the Vite server plugin for phone ↔ laptop. See doc 03.

- **Editor → Visitor app:** Publish writes the venue package to local storage; reload `nav.html` and search / routes use it.
- **Ads → AR view:** pause a campaign and its ad disappears from AR; impressions and taps are counted back.
- **Visitor app → Dashboard:** pose, route and events are broadcast (BroadcastChannel + storage events). The dashboard re-computes the same route with the same engine.
- Everything resets with the **Reset demo** button in the visitor app’s demo panel.

## Deep links (for demos and screenshots)

`nav.html#map` · `#search` · `#voice` · `#place` · `#preview` · `#nav` · `#navf2` · `#arturn` · `#arad` · `#arf2`

## What is real vs simulated

Real, deterministic code (no AI): A* routing with time costs (stairs vs lift), turn instructions in 3 languages,
fuzzy search with Hinglish / Telugu aliases, voice-intent matching, map validation, the AR scene built from the map geometry.

Simulated for the laptop: the walker (1.3 m/s virtual), the camera feed, marker scanning (buttons), phone sensors / drift,
speech recognition (needs Chrome). Telugu / Hindi speech output needs matching OS voices; captions always show.

## Code map

```
css/app.css, css/phone.css     styles
js/data.js      placeholder venue (2 floors, 20 rooms, 8 markers, 3 ad walls), storage, bus
js/engine.js    graph, A*, instructions (en/hi/te), search, intents, validation
js/mapview.js   SVG indoor map (pan/zoom/heading-up, route, user dot)
js/ar.js        pinhole-camera AR scene on canvas
js/nav.js       visitor app logic       js/editor.js   map editor logic
```

All venue data (rooms, names, brands, numbers) is **placeholder** until the real office is surveyed.
