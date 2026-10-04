# Plan: pick your start, say it in one sentence, arrows in the air

What was asked: (1) the office map updated from the new sketch; (2) entrances ("gates") selectable as a place to start, as well as rooms; (3) say "I am near the lift lobby and I want to go to the pantry" in one sentence and have the app find both places and the fastest path; (4) arrows floating in the camera view telling where to turn; (5) camera-based position identification; (6) use an Anthropic API key for reasoning and for looking at the camera picture.

## What was wrong, and the fix

| Problem | Cause found in the code | Fix |
|---|---|---|
| AR arrows / camera position do not work on the phone | On a phone whose Chrome has WebXR the app started in the **WebXR** mode by default. That mode needs Google Play Services for AR and was never proven on your phone. Also: a printed marker sticker is the only thing that gave a position and **compass direction**, and the office has none. | Phones now start in the **camera + step counting** mode (real camera picture behind the arrows). WebXR stays available with `?pose=xr`. New **Align** button and **Look around (AI)** give the position and the direction without stickers. A small **AR check** panel shows what is wrong (camera blocked, sensors blocked, no compass, not secure). |
| Only rooms can be chosen as the start | The "choose manually" list showed rooms | Entrances (A, C, D, E, K and every entrance point) are listed first, then rooms. The route preview has **Change start**. |
| One sentence with start and destination is not understood | The intent set knew only "go to X" | New **journey** intent: "I am near X and I want to go to Y", "from X to Y", "I'm at X, take me to Y", also in Hinglish. |
| No AI | The server only knew an OpenAI key | An **Anthropic** client on the server (`ANTHROPIC_API_KEY`): understands free-form sentences and looks at a camera picture. The key never reaches the phone. Without a key everything still works with rules. |

## How it works

1. **Rules first, AI second.** The phone parses the sentence itself (`src/core/journey.ts`). Only when that is unsure does it ask the server, where Claude turns the sentence into a start place and a destination from THIS venue's list of places. The server checks that both exist: the AI can never invent a place or a route. The route itself (fastest path, lifts, stairs) is always computed by the deterministic router.
2. **Start placed on the map.** The start place gives the position (just outside its door, or at the entrance point). Its facing is the direction of the first part of the route, so the first arrow is "straight ahead" when you stand the way you will walk; **Align** fixes it for any other facing.
3. **Look around (AI).** The camera picture (JPEG, about 640 px) goes to the server, Claude is told the places of the venue and which signs and doors it can see, and answers: the place you are nearest to, and which known places are ahead / left / right. That gives the position and the facing, so the compass learns the map's north (no sticker needed). Names on doors and signs make it reliable; a blank corridor does not, and it then says so.
4. **Arrows.** Camera view with the arrows drawn over it, a big turn arrow always on, floor arrows when the position is sure enough (the existing AR director rules).

## Steps

1. Phones default to the camera mode. Test updated.
2. Office map: lift lobby J, entrances C, D, E, K, A (`scripts/make-office.ts`).
3. Journey intent, parser, controller, tests.
4. Start from entrances; **Change start**; locate screen shortcuts.
5. Anthropic on the server: journey interpretation, look-around, status; tests with a fake API.
6. Phone: **Look around (AI)**, **Align**, **AR check**, automatic AR after a spoken journey; end-to-end tests; docs.

## Limits (honest)
- The position from a start place is "near that place" (about 3-4 m), not exact; step counting then follows you. Printed marker stickers remain the exact way.
- Claude's picture reading needs readable names or distinctive things in the picture; it can be wrong, so it reports a confidence and the app only accepts a medium or high one.
- The compass inside steel buildings can be off; Align and Look around correct it.
- Everything about the real phone (heading drift, how well arrows line up with the corridor) can only be judged by walking it.

## How to use it (what was built)

**1. Turn the AI on (optional, the rest works without it).** In the `Mobility-Application` folder create a file named `.env` (it is git-ignored, so it is never uploaded) with one line:
```
ANTHROPIC_API_KEY=sk-ant-...your key...
```
Restart the server (`npm run dev:lan`). Never paste the key into the app, a chat or a commit. `GET /api/ai/status` says whether the server sees a key (it never shows the key). Models: `claude-sonnet-5-5` looks at the camera picture, `claude-haiku-4-5-20251001` reads the sentence; change them with `ANTHROPIC_MODEL` / `ANTHROPIC_FAST_MODEL`.

**2. Start where you are.** Three ways, in the order of how exact they are: scan a marker sticker; **say it** ("I am near the lift lobby and I want to go to the pantry"); pick a start (**Entrances** are listed first, then places; also **Change start** in the route preview). **Look around (AI)** reads signs and doors from the camera picture.

**3. The sentence.** Works with or without a key for ordinary sentences (English, "from X to Y", Hinglish "main lift lobby ke paas hoon aur pantry jaana hai"). Free-form or unusual wording goes to Claude when a key is set. On a phone it opens the camera view with the arrows at once; on the laptop simulator it shows the route preview.

**4. In the camera view.** Big arrow + floor arrows; **Align** (stand facing the way you will walk, tap it: the arrows and the compass take that as the way); **Look (AI)** (position and facing from the picture); **AR check** (what is wrong if nothing works: page not secure, camera blocked, sensors blocked, no compass, map north unknown, no position, AI off).

**5. If the camera or sensors are blocked.** Chrome only gives the camera and motion sensors to a secure page. With a certificate that the phone does not trust you get "Your connection is not secure" and these can be blocked. Install the mkcert root certificate on the phone once (`docs/https-on-phone.md`), or use the GitHub Pages address (real HTTPS, but no laptop features).
