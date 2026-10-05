# Dora.AI: indoor maps and camera-guided wayfinding

> ## 👉 Use the app here: **https://uditnarayana2672.github.io/Mobility-Application/**
>
> Open the link (on an Android phone in Chrome for the best experience). No installation, no account.
> Quick start: tap **Indore Maps**, pick a place (airport, mall, bus stand, office), then search for where you want to go.

GPS stops working at the door, and then you are on your own in malls, airports, bus stands and office parks. **Dora.AI is "Google Maps for the inside of a building."** Say or type where you want to go, and the app shows the route on a floor plan. Through the phone camera it overlays arrows on the real corridor.

It is a web app (React + TypeScript). Nothing needs to be installed from an app store.

---

## What it does

| For | Feature |
|---|---|
| **Visitors** | Indoor 2D map with floors, search, and turn-by-turn directions. Routes can use the lift or the stairs, with an **Avoid stairs** option. |
| | **Voice in English, Hinglish and Telugu**: "Cafeteria kahan hai?", "I want a coffee". Directions are spoken back. |
| | **AR view**: chevrons and turn arrows on the live camera feed, with the destination marked. Falls back to the 2D map if tracking is lost. |
| | **Finds where you are** from printed ArUco markers, WebXR tracking, step counting and compass, and optionally recognising places by sight. |
| **Venue owners** | A **map editor** to draw floors, rooms, doors, walk paths, lifts and stairs, or trace over a photo or blueprint. It validates the map and publishes it, with version history. |
| | A **marker sheet** generator that prints ArUco position markers at true size (A6, A5, A4). |
| **Advertisers** | An **ads portal** to place image or video campaigns on approved wall slots. They show in AR, can be paused live, and report impressions and taps. |
| **Demo / operators** | A **live laptop dashboard** that mirrors a phone's position, route and events in real time. It can replay a recorded walk. |
| | A **preflight** page that checks HTTPS, sensors, WebXR, voices, server and live marker detection before a demo. |

### Designed to be predictable

- **Routes and positions are computed by deterministic code.** A* path search runs on a venue graph and is covered by unit and golden tests. AI never computes a route or a position.
- **AI is optional and limited to language and vision.** It handles free-form requests that the rules can't match ("I am near the lift lobby and want the pantry"). It can also help recognise places from camera pictures. Without an API key, search, navigation and voice rules still work, and misses get local "Did you mean…" suggestions.
- **Secrets stay on the server.** API keys are never shipped to the browser.

---

## Try it

| Page | URL path | What it is |
|---|---|---|
| Home | `/` | Choose **Designer** or **Indore Maps** |
| Visitor app | `/nav?venue=airport` | The navigator. Venues: `airport`, `phoenix-citadel`, `majestic-bus-stand`, `my-office` |
| Designer | `/designer` | The original blueprint designer on an empty sheet |
| All tools | `/maps` | A list of every page in the app |

The hosted site is a **static build**, so some things that need the laptop server are switched off.

| Works on the hosted site | Needs the local server |
|---|---|
| Maps, search, routing, "I want a coffee" word matching | Saving or publishing from the editor, uploads |
| Camera view, marker scan, step counting, AR arrows | Local Whisper/Piper speech (the phone's own voice and the browser's recogniser are used instead) |
| Spoken directions with the phone's voice | Live dashboard across devices, ads, owner page, place recognition by sight |

Details are in [docs/06-github-pages.md](docs/06-github-pages.md).

---

## How it works

```
 Venue owner                   Server (local, one origin)                 Visitor phone
┌────────────┐  publish   ┌──────────────────────────────┐  venue JSON  ┌───────────────────┐
│ /editor    │ ─────────▶ │ REST: venues, drafts, media  │ ───────────▶ │ /nav              │
│ /markers   │            │ WebSocket hub (live poses)   │ ◀─────────── │  2D map · voice   │
│ /ads       │            │ Local STT/TTS/embeddings     │  pose, route │  AR · positioning │
└────────────┘            │ Optional LLM (server-side)   │   events     └───────────────────┘
                          └──────────────┬───────────────┘
                                         ▼
                                  /dashboard (laptop mirror)
```

**Positioning.** The phone camera detects printed ArUco markers (a custom 4×4 dictionary), which give an exact position and heading. Between markers it keeps going with WebXR tracking or, as a fallback, step detection with a compass and a particle filter constrained to corridors. Positions are corrected gently, so the dot eases rather than jumps.

**Navigation.** A venue is a graph of corridors, doors, lifts and stairs, with units in metres. The route uses A* (a path search over that graph). A state machine announces turns at 15 m and 3 m, prompts for floor changes, detects arrival and re-routes when you leave the route.

**Voice.** Rules come first: a confidence-aware matcher for "go to", "where am I", "nearest", "repeat", "stop", "avoid stairs" and "how long". It understands English, romanised Hinglish and Telugu. A language model is only consulted when the rules are not confident.

**Frame conventions.** Units are metres. x points east and y points south. Bearing 0 is north, clockwise. Floors have an elevation in metres.

---

## Run it locally

Requirements: Node.js and npm. The GitHub Pages workflow builds with Node 22.

```sh
git clone https://github.com/Uditnarayana2672/Mobility-Application.git
cd Mobility-Application
npm install
npm run dev          # opens on port 8080 (HTTPS)
```

To try it **on a phone** (camera, sensors and WebXR need HTTPS):

```sh
npm run certs        # one time: local HTTPS certificates (mkcert)
npm run dev:lan      # prints a phone URL and a QR code
```

See [docs/https-on-phone.md](docs/https-on-phone.md) for trusting the certificate on Android.

**Production-style run** (serves the built app, REST and WebSocket from one origin):

```sh
npm run build && npm run serve
```

**Optional local AI** (speech and place recognition, about 250 MB, no cloud):

```sh
npm run setup:speech
```

**Optional assistant key.** Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. These variables are read by the server only and `.env` is git-ignored. Never prefix them with `VITE_`.

### Commands

| Command | Does |
|---|---|
| `npm run dev` / `npm run dev:lan` | Dev server / dev server with phone URL and QR |
| `npm run build` / `npm run serve` | Production build / serve it over HTTPS with the API |
| `npm test` | Unit and golden tests (Vitest) |
| `npm run e2e` | Real-browser end-to-end tests |
| `npm run typecheck` | TypeScript project check |
| `npm run lint` | ESLint |
| `npm run export:venues -- <id>` | Copy a published venue into `public/venues` for the hosted site |

---

## Project layout

```
src/core/         Pure strict TypeScript: venue schema (zod), graph, A*, instructions, search, intent matching, validation
src/navigator/    /nav: NavController (all logic, no React), session state machine, speech, screens
src/positioning/  Marker pose, WebXR and step-count position sources, particle filter, compass
src/ar/           AR scene model, WebXR three.js renderer, canvas simulation renderer, ad campaigns
src/editor/       /editor: pure venue edit operations, undo history, tools
src/dashboard/    /dashboard: live laptop view
src/ads/          /ads: campaign editor and KPIs
src/markers/      /markers: printable ArUco sheets
src/preflight/    /preflight: pre-demo checks
src/speech/ src/vision/ src/survey/   Local speech, place recognition and the survey walk page
src/bus/          Phone ↔ server ↔ dashboard messaging (BroadcastChannel + WebSocket)
server/           REST, WebSocket hub, assistant providers, speech and vision, Vite plugin and production server
public/venues/    Bundled maps: airport, mall, bus stand, offices
tests/            Unit, golden (against the original mock engine) and end-to-end tests
docs/             Plans, decisions, runbook, field tests, GitHub Pages notes
```

**Built with** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, three.js (WebXR), Zod, Vitest and Playwright. Node, `ws` and ONNX/Transformers models power the server and local AI.

---

## Status and limits

The software side is built and tested. Field accuracy still has to be proven with real phones in real buildings.

- **Done:** venue schema and editor, marker sheets, 2D navigator, simulation and dashboard, live positioning code, AR guidance, ads portal, two-way voice, preflight and demo runbook.
- **Still to measure on a phone:** arrow alignment along a real corridor, heading drift over long walks, wall-ad registration, and place-recognition accuracy in a real building. The numbers go in [docs/field-tests.md](docs/field-tests.md) and [docs/PROGRESS.md](docs/PROGRESS.md).
- **Known limits:** Telugu speech-to-text is experimental (Telugu typing and spoken replies work). Android and Chrome are the supported target. Repetitive corridors and bare white walls are hard for place recognition.

## Documentation

| Doc | Read it for |
|---|---|
| [docs/PROGRESS.md](docs/PROGRESS.md) | Current status, decisions log, known issues |
| [docs/03-build-plan.md](docs/03-build-plan.md) | Phases and architecture |
| [docs/04-architecture-v2.md](docs/04-architecture-v2.md) / [docs/05-using-architecture-v2.md](docs/05-using-architecture-v2.md) | The v2 design and how to use its features |
| [docs/demo-runbook.md](docs/demo-runbook.md) | A step-by-step demo script with recovery moves |
| [docs/field-tests.md](docs/field-tests.md) | Field test routes and result tables |
| [docs/06-github-pages.md](docs/06-github-pages.md) | Deploying to GitHub Pages |

## Contributing

New code is strict TypeScript. Add new folders to `tsconfig.strict.json`, keep core logic deterministic and unit-tested, and keep the TypeScript engine matching the reference mock through the golden tests. Run `npm run typecheck` and `npm test` before opening a pull request.
