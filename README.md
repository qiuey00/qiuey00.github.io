# Pokédex Tracker

A checklist for tracking Pokédex progress, with each game's dex in its own in-game order.
35 dexes, from Kanto through Legends: Z-A and its Mega Dimension DLC.

- Every Pokémon shows its **in-game dex number, sprite, and name**, so you know what you're
  ticking off before you tick it.
- Tap a card to mark it **caught**; tap the star (or turn on **Shiny mode**) to mark it **shiny**.
- Search by name or by either number, and filter to Missing / Caught / Shiny.
- Progress is tracked **per dex** — catching Chikorita in Z-A doesn't tick it in the Johto dex.

## Running it locally

The page loads its data with `fetch`, which browsers block over `file://`. Serve the folder:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## How progress is saved

In `localStorage`, under `pokedex-tracker:v1` — so it lives in **that browser on that device**.
Your phone and your computer track separately.

**Export progress** downloads a JSON backup. **Import progress** merges a backup back in — it
unions rather than overwrites, so importing a phone backup onto your computer never drops
progress made on either one. That's also how you move progress between devices.

Clearing site data for the page wipes progress, so export a backup before you do.

## Re-seeding the data

`data/` and `sprites/` are generated from [PokéAPI](https://pokeapi.co) and committed, so the
site makes **zero network calls at runtime** — it loads instantly, works offline, and doesn't
break if PokéAPI is down. To pull in a new game's dex once PokéAPI adds it:

```sh
node scripts/seed.mjs
```

Raw API responses are cached in `scripts/.cache/` (gitignored), so re-runs only fetch what's new.
When a genuinely new dex appears, add a label for it to `DEX_LABELS` in `scripts/seed.mjs` —
otherwise it shows up under an "Other" group with its raw slug.

## Layout

```
index.html          page shell
styles.css
src/app.js          state + events
src/data.js         loads data/index.json, lazy-loads each dex
src/state.js        localStorage, export/import
src/render.js       picker, meters, card grid
data/index.json     dex list for the picker
data/dex/*.json     35 dexes, entries in in-game order
sprites/*.png       1025 sprites, 96px, ~4 MB
scripts/seed.mjs    PokéAPI → data/ + sprites/
```

Plain HTML + CSS + ES modules. No build step and no dependencies — GitHub Pages serves the
repo root as-is.

## Deploying to GitHub Pages

This lives in `qiuey00/qiuey00.github.io`, a **user Pages site**, so it serves from the
repo root at <https://qiuey00.github.io/> — no subpath. Pages builds from a workflow
(`.github/workflows/pages.yml`), which uploads the repo root as-is and deploys it, so
deploying is just a push to `main`:

```sh
git push
```

The workflow also has a `workflow_dispatch` trigger, so you can redeploy the current
`main` without a commit:

```sh
gh workflow run "Deploy Pages"
```

Build logs are under the repo's Actions tab. `.nojekyll` is not needed on this path —
the workflow never runs Jekyll — but it is kept so a fall back to a legacy branch build
still serves the files as-is.

Your progress never leaves your browser; only the *page* is published.
