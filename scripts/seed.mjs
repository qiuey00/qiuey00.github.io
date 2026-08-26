#!/usr/bin/env node
// One-time (re-runnable) seed: pulls every Pokedex from PokeAPI and writes
// static JSON + sprites into the repo so the site makes zero network calls.
//
//   node scripts/seed.mjs
//
// Raw API responses are cached under scripts/.cache/ so re-runs are near-instant
// and we stay well inside PokeAPI's fair-use policy.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, 'scripts', '.cache')
const DATA = path.join(ROOT, 'data')
const DEX_DIR = path.join(DATA, 'dex')
const SPRITES = path.join(ROOT, 'sprites')

const API = 'https://pokeapi.co/api/v2'
const SPRITE_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
const CONCURRENCY = 8

// PokeAPI's own dex names are terse ("Hyperspace", "Updated Johto") and its
// version-group slugs are unfriendly ("legends-za"), so name the games here.
// group = how the picker is sectioned; game = the subtitle under the dex name.
const DEX_LABELS = {
  national:          { game: 'All games',                        group: 'National' },
  kanto:             { game: 'Red · Blue · Yellow',              group: 'Generation I' },
  'letsgo-kanto':    { game: "Let's Go Pikachu · Eevee",         group: 'Generation VII' },
  'original-johto':  { game: 'Gold · Silver · Crystal',          group: 'Generation II' },
  'updated-johto':   { game: 'HeartGold · SoulSilver',           group: 'Generation IV' },
  hoenn:             { game: 'Ruby · Sapphire · Emerald',        group: 'Generation III' },
  'updated-hoenn':   { game: 'Omega Ruby · Alpha Sapphire',      group: 'Generation VI' },
  'original-sinnoh': { game: 'Diamond · Pearl',                  group: 'Generation IV' },
  'extended-sinnoh': { game: 'Platinum',                         group: 'Generation IV' },
  'original-unova':  { game: 'Black · White',                    group: 'Generation V' },
  'updated-unova':   { game: 'Black 2 · White 2',                group: 'Generation V' },
  'conquest-gallery':{ game: 'Pokémon Conquest',                 group: 'Spin-offs' },
  'kalos-central':   { game: 'X · Y — Central',                  group: 'Generation VI' },
  'kalos-coastal':   { game: 'X · Y — Coastal',                  group: 'Generation VI' },
  'kalos-mountain':  { game: 'X · Y — Mountain',                 group: 'Generation VI' },
  'original-alola':  { game: 'Sun · Moon',                       group: 'Generation VII' },
  'original-melemele':{ game: 'Sun · Moon — Melemele',           group: 'Generation VII' },
  'original-akala':  { game: 'Sun · Moon — Akala',               group: 'Generation VII' },
  'original-ulaula': { game: 'Sun · Moon — Ula’ula',        group: 'Generation VII' },
  'original-poni':   { game: 'Sun · Moon — Poni',                group: 'Generation VII' },
  'updated-alola':   { game: 'Ultra Sun · Ultra Moon',           group: 'Generation VII' },
  'updated-melemele':{ game: 'Ultra Sun · Moon — Melemele',      group: 'Generation VII' },
  'updated-akala':   { game: 'Ultra Sun · Moon — Akala',         group: 'Generation VII' },
  'updated-ulaula':  { game: 'Ultra Sun · Moon — Ula’ula',  group: 'Generation VII' },
  'updated-poni':    { game: 'Ultra Sun · Moon — Poni',          group: 'Generation VII' },
  galar:             { game: 'Sword · Shield',                   group: 'Generation VIII' },
  'isle-of-armor':   { game: 'Sword · Shield — Isle of Armor',   group: 'Generation VIII' },
  'crown-tundra':    { game: 'Sword · Shield — Crown Tundra',    group: 'Generation VIII' },
  hisui:             { game: 'Legends: Arceus',                  group: 'Generation VIII' },
  paldea:            { game: 'Scarlet · Violet',                 group: 'Generation IX' },
  kitakami:          { game: 'Scarlet · Violet — Teal Mask',     group: 'Generation IX' },
  blueberry:         { game: 'Scarlet · Violet — Indigo Disk',   group: 'Generation IX' },
  'lumiose-city':    { game: 'Legends: Z-A',                     group: 'Generation IX' },
  hyperspace:        { game: 'Legends: Z-A — Mega Dimension',    group: 'Generation IX' },
  champions:         { game: 'Pokémon Champions',                group: 'Generation IX' },
}

// Order the picker sections roughly newest-first; Z-A is what Jeff is playing.
const GROUP_ORDER = [
  'Generation IX', 'Generation VIII', 'Generation VII', 'Generation VI',
  'Generation V', 'Generation IV', 'Generation III', 'Generation II',
  'Generation I', 'Spin-offs', 'National',
]

const GEN_NUM = {
  'generation-i': 1, 'generation-ii': 2, 'generation-iii': 3, 'generation-iv': 4,
  'generation-v': 5, 'generation-vi': 6, 'generation-vii': 7, 'generation-viii': 8,
  'generation-ix': 9,
}

const exists = (p) => access(p).then(() => true, () => false)
const idFromUrl = (url) => Number(url.replace(/\/$/, '').split('/').pop())
const english = (arr) => arr?.find((e) => e.language?.name === 'en')

let fetched = 0

/** GET json, memoised on disk under scripts/.cache/<key>.json */
async function getJson(url, key) {
  const file = path.join(CACHE, `${key}.json`)
  if (await exists(file)) return JSON.parse(await readFile(file, 'utf8'))

  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  const json = await res.json()
  await writeFile(file, JSON.stringify(json))
  fetched++
  return json
}

/** Run `worker` over `items`, at most CONCURRENCY in flight. */
async function mapLimit(items, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

async function downloadSprite(id) {
  const dest = path.join(SPRITES, `${id}.png`)
  if (await exists(dest)) return false
  const res = await fetch(`${SPRITE_BASE}/${id}.png`)
  if (!res.ok) {
    console.warn(`  ! no sprite for #${id} (${res.status})`)
    return false
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  return true
}

async function main() {
  await mkdir(CACHE, { recursive: true })
  await mkdir(DEX_DIR, { recursive: true })
  await mkdir(SPRITES, { recursive: true })

  console.log('· fetching dex list')
  const list = await getJson(`${API}/pokedex/?limit=100`, 'pokedex-list')

  console.log(`· fetching ${list.results.length} dexes`)
  const dexes = await mapLimit(list.results, (r) =>
    getJson(r.url, `pokedex-${r.name}`))

  // Union of every species referenced by any dex — this is what we need details for.
  const speciesIds = [...new Set(
    dexes.flatMap((d) => d.pokemon_entries.map((e) => idFromUrl(e.pokemon_species.url)))
  )].sort((a, b) => a - b)

  console.log(`· fetching details for ${speciesIds.length} species`)
  const species = new Map()
  await mapLimit(speciesIds, async (id) => {
    // species -> display name + generation; pokemon -> types (species has no types)
    const s = await getJson(`${API}/pokemon-species/${id}/`, `species-${id}`)
    let types = []
    try {
      const p = await getJson(`${API}/pokemon/${id}/`, `pokemon-${id}`)
      types = p.types.map((t) => t.type.name)
    } catch {
      // A handful of species ids have no default-form pokemon at the same id.
      // Types are decorative here, so an empty list is fine.
    }
    species.set(id, {
      name: english(s.names)?.name ?? s.name,
      gen: GEN_NUM[s.generation?.name] ?? 0,
      types,
    })
  })

  console.log(`· downloading sprites (${speciesIds.length} species)`)
  let newSprites = 0
  await mapLimit(speciesIds, async (id) => {
    if (await downloadSprite(id)) newSprites++
  })
  console.log(`  ${newSprites} new, ${speciesIds.length - newSprites} already present`)

  console.log('· writing data files')
  const index = []
  for (const dex of dexes) {
    const label = DEX_LABELS[dex.name] ?? { game: dex.name, group: 'Other' }
    const name = english(dex.names)?.name ?? dex.name

    const entries = dex.pokemon_entries
      .map((e) => {
        const id = idFromUrl(e.pokemon_species.url)
        const s = species.get(id)
        return { n: e.entry_number, id, name: s.name, types: s.types, gen: s.gen }
      })
      .sort((a, b) => a.n - b.n)

    await writeFile(
      path.join(DEX_DIR, `${dex.name}.json`),
      JSON.stringify({ slug: dex.name, name, game: label.game, entries }, null, 0)
    )
    index.push({
      slug: dex.name, name, game: label.game, group: label.group, count: entries.length,
    })
  }

  index.sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    return g !== 0 ? g : a.name.localeCompare(b.name)
  })
  await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 2))

  console.log(`\n✓ ${index.length} dexes, ${speciesIds.length} species, ${fetched} new API calls`)
}

main().catch((err) => {
  console.error('\n✗ seed failed:', err.message)
  process.exit(1)
})
