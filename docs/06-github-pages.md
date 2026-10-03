# Putting the app on GitHub Pages

Live address (after the one-time setup below): `https://uditnarayana2672.github.io/Mobility-Application/`

GitHub Pages only hosts files. It cannot run `npm run serve`, so the site is a **static build**: the maps are the ones in `public/venues/`, and everything that needs the laptop server is switched off.

## Pages of the site
| Address | What it is |
|---|---|
| `/` | First page: **Designer** or **Indore Maps** |
| `/designer` | The original Blueprint designer on an empty sheet (it has an **Indore Maps** button; the old `/legacy-editor` address redirects here) |
| `/nav?venue=airport` | What **Indore Maps** opens: the airport visitor map (on a laptop with `&demo=1`, the demo controls and walker) |
| `/maps` | The list of every tool (`/nav`, `/editor`, `/dashboard`, …), linked from inside the app |

## One-time setup (about 2 minutes, in the GitHub website)
1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repo → **Settings → Environments → github-pages → Deployment branches** → add `enhancements` (or merge `enhancements` into `main`, which is already allowed).
3. Repo → **Actions** → *Deploy to GitHub Pages* → **Run workflow** (or just push). The first run takes about 3 minutes.

GitHub Pages on a free account needs the repository to be **public**.

## What works there
| Works | Does not (needs the laptop server) |
|---|---|
| Visitor map, search, routing, typed destinations, "I want a coffee" word matching | Editor Publish, drafts, uploads (`/editor` can open but not save) |
| Camera view, marker scan, step counting, AR arrows (HTTPS is provided by Pages) | Local Whisper / Piper (the phone's own voice and the browser's recogniser are used instead) |
| Phone's own voice for directions | Live dashboard from other phones (`/ws`), ads, owner page |
| Venues: `airport`, `office-hq` (demo), `pg-home` | Place recognition by sight (needs a survey index from the server) |

Open a venue directly: `…/Mobility-Application/nav?venue=airport` (then tap the blue pin). Use `?auto=0` if the location prompt gets in the way.

## Keeping the live maps current
The site shows what is in `public/venues/<id>/venue.json`, **not** what you published on your laptop (that lives in the git-ignored `data/` folder). After publishing in the editor:

```
npm run export:venues -- <id>   # copies data/venues/<id>/published.json -> public/venues/<id>/venue.json (nothing is exported unless you name it)
git add public/venues && git commit -m "Update venues" && git push
```

Everything in `public/venues` becomes public on the website (room names and sizes; there is no GPS position unless you set one under "Where is it?"). Remove a folder from `public/venues` to take a venue off the site.

## How it is built
`.github/workflows/pages.yml` runs `npm run build` with `VITE_STATIC=1` and `BASE_PATH=/<repo>/`, copies `index.html` to `404.html` (so links like `/nav?venue=my-pg` open directly), and deploys `dist/`. In that build `src/shared/staticHost.ts` answers `/api/...` calls immediately with "no server", so the app falls back exactly as it does when the laptop is off. Normal builds (`npm run build`, `npm run dev:lan`) are unchanged.

For the full app (editor, local voice, dashboard, place recognition) keep using `npm run dev:lan` or `npm run build && npm run serve` on the laptop, or any machine that can run Node.

## The airport venue
`public/venues/airport/venue.json` is made from the Blueprint drawing in `public/maps/blr-kia-t2.json` by `npm run convert:airport` (drawing scale 1 px = 0.5 m, as the file says). It keeps what a passenger looks for and leaves out the rest:

| Kept as places | Not imported one by one |
|---|---|
| 24 gates, 6 check-in islands + ticketing + bag drop, security / emigration / immigration / customs zones, baggage reclaim halls, 5 lounges, 12 eateries, 16 shops, 30 toilets (named by where they are), lifts and escalators (linked between floors), 29 points of interest and 14 entrances (ATM, currency, info, taxi, prayer, baby care, charging, trolleys, water, medical) | 84 check-in counters, 16 security lanes, 24 immigration / emigration counters, baggage belts (their numbers are search words of the reclaim hall), staff-only areas, the separation wall |

The drawing's own connection list is used to join corridors (check-in hall to security to the airside plaza; the departure entries join the forecourt to the hall). Security and reclaim halls can be walked through; every other place is a destination only. To change the airport, edit the drawing in the designer, save it over `public/maps/blr-kia-t2.json`, run `npm run convert:airport`, and push.
