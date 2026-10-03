# Using the v2 features (what was built and how to run it)

Plan: `04-architecture-v2.md`. This file is the practical side: commands, screens, and what is still unmeasured.

## 1. One-time setup (local AI, no cloud)

```
npm install
npm run setup:speech          # Piper voices (English, Hindi, Telugu) + the piper program, about 250 MB, into data/models/piper
npm run dev:lan               # or: npm run build && npm run serve
```

The first time a model is needed the server downloads it into `data/models/hf` and never calls a cloud service afterwards:

| Model | Used for | Size | Where it runs |
|---|---|---|---|
| Whisper small (q8) | speech to text | ~250 MB | the server (4 CPU threads) |
| Piper (en / hi / te voices) | text to speech | ~60 MB per voice | the server |
| MiniLM multilingual | free-form sentence → place | ~120 MB | the server |
| DINOv2-small (q8) | recognising places by sight | ~25 MB | the server (index) and the phone (WebAssembly) |

Settings: `STT_MODEL` (e.g. `onnx-community/whisper-base` for speed), `STT_THREADS`, `EMBED_MODEL`, `LOCAL_AI_WARM=0` (do not load models at server start). Everything falls back: no Piper voice → the phone's own voice; no Whisper → the browser's recogniser; no index → markers and manual choice.

## 2. What you can do now

| You want | Do this |
|---|---|
| The Blueprint look | automatic: the visitor map, editor and dashboard use it. Editor layer **Sizes** shows room dimensions. |
| Use your Blueprint export | `/editor` → **⋯ → Import a Blueprint file…** → pick the .json → check the **scale** line ("the drawing is 15.8 m × 9.5 m": a door is about 1 m) → read the review list → **Import and replace**. Then rename unnamed rooms, draw the walk paths it asked for, Validate, Publish. |
| The phone finds the building by itself | editor, nothing selected, right panel → **Where is it?** → *Use my location* while standing inside, or paste the building corners from Google Maps (one `latitude, longitude` per line). Publish. On a phone, `/nav` (no `?venue=`) now opens that building; if GPS is off it uses the last venue or asks. |
| No more "where are you?" first | the camera opens by itself; a marker locks on at once; after 5 s with nothing it shows **"Are you near … ?"** (one tap) and **Continue where I left off**. |
| Say "I want a coffee" | works with the mic (hold) or typing; tag rooms under **Good for** (coffee, food, water, washroom, rest, meeting, work, print, balcony, exit). Untagged rooms still match by name/category. |
| Arrows on the camera | AR view (📷): destination chips + **🎤 Say it**; the big arrow always works; floor arrows appear when the position is within ~1.5 m. |
| Recognise places by sight | `/survey?venue=<id>` on the phone (or editor **⋯ → Survey walk**): start the camera, start from a marker or a room, **Start recording**, walk every corridor in both directions, **Build index**. The page shows the self-test; phones use the index automatically only when it passes (≥ 90 % right, ≤ 2 m typical error, ≤ 3 % wrong confident answers, ≥ 20 pictures). `?vpr=1` forces it on, `?vpr=0` off. |

## 3. Tests

`npm test` (608), `npm run e2e` (49), `npm run typecheck` is `tsc -b tsconfig.app.json`; the strict code is checked with `npx tsc --noEmit -p tsconfig.strict.json`.
Real-model checks (slow, need the models): `SPEECH_REAL=1 npx vitest run tests/speech-local.test.ts tests/semantic.test.ts tests/survey-api.test.ts`.

## 4. What is NOT proven yet (needs your phone and your buildings)

- **Arrow alignment on the real corridor** and heading drift over a long walk. The compass learns the map's north from marker fixes (stored per venue on the phone); indoors steel can disturb it, so it only nudges the gyro while steady.
- **Place recognition accuracy.** It is verified on synthetic places and with the real model, and the survey page measures itself, but no real building has been surveyed. Repetitive corridors and bare white walls are its weak spot (the self-test refuses to switch it on then).
- **Telugu speech to text.** Whisper-small is weak in Telugu (English and Hindi are good; Telugu text input and Telugu spoken replies work). Telugu mic input is experimental.
- **Phone speed.** The image model takes ~1.2 s per picture on this laptop; a phone will be slower (the app drops pictures while busy).
- Floor/obstacle detection with a vision model is not built; the AR director uses geometry and the phone tilt instead (`src/ar/director.ts`).
- The native-app route (Bluetooth beacons, Wi-Fi ranging, barometer) was not started; it is only needed if sight + markers are not accurate enough.

Fill the measured numbers into the field-results table in `PROGRESS.md` / `field-tests.md`.
