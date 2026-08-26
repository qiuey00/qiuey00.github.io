// Progress persistence. Scoped per dex so catching Chikorita in Z-A doesn't
// tick it in the Johto dex. Every storage touch is guarded: a private window or
// blocked site data degrades to an in-memory session rather than throwing.
//
// Writes merge at the dex level rather than dumping this tab's whole in-memory
// store. Two tabs open on different dexes would otherwise clobber each other —
// the last one to save would erase the other's dex entirely.

const KEY = 'pokedex-tracker:v1'
const VERSION = 1
const SAVE_DELAY = 200

/** @typedef {{caught:number[], shiny:number[]}} DexProgress */

/** This tab's working copy. May hold only the dexes it has looked at. */
let progress = /** @type {Record<string, DexProgress>} */ ({})
/** Dexes this tab changed and still owes to storage. */
const dirty = new Set()
let storageWorks = true
let saveTimer = null
let externalChange = null

const empty = () => ({ caught: [], shiny: [] })

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.progress === 'object' && parsed.progress
      ? parsed.progress
      : {}
  } catch {
    storageWorks = false
    return {}
  }
}

/** Fold this tab's dirty dexes into whatever is in storage right now. */
function writeStorage() {
  if (!storageWorks || dirty.size === 0) return
  try {
    const merged = readRaw()
    for (const slug of dirty) merged[slug] = progress[slug] ?? empty()
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, progress: merged }))
    dirty.clear()
  } catch {
    storageWorks = false
  }
}

function scheduleSave(slug) {
  dirty.add(slug)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(writeStorage, SAVE_DELAY)
}

progress = readRaw()

// A debounced save can still be pending when the tab goes away.
addEventListener('pagehide', () => { clearTimeout(saveTimer); writeStorage() })

// Another tab saved. Take its version as truth for dexes we don't owe a write on.
addEventListener('storage', (e) => {
  if (e.key !== KEY) return
  const incoming = readRaw()
  for (const [slug, value] of Object.entries(incoming)) {
    if (!dirty.has(slug)) progress[slug] = value
  }
  externalChange?.()
})

/** Register a callback for when another tab changes stored progress. */
export function onExternalChange(fn) { externalChange = fn }

/** True when progress cannot be persisted (private window, blocked site data). */
export const isEphemeral = () => !storageWorks

/**
 * Working sets for one dex.
 * @returns {{caught:Set<number>, shiny:Set<number>}}
 */
export function dexSets(slug) {
  const raw = progress[slug] ?? empty()
  return { caught: new Set(raw.caught), shiny: new Set(raw.shiny) }
}

/** Persist the working sets for one dex. */
export function commit(slug, sets) {
  progress[slug] = {
    caught: [...sets.caught].sort((a, b) => a - b),
    shiny: [...sets.shiny].sort((a, b) => a - b),
  }
  scheduleSave(slug)
}

export function clearDex(slug) {
  progress[slug] = empty()
  scheduleSave(slug)
  writeStorage()
}

/** Snapshot for download — everything in storage, not just this tab's view. */
export function exportJson() {
  const merged = readRaw()
  for (const slug of dirty) merged[slug] = progress[slug] ?? empty()
  return JSON.stringify(
    { version: VERSION, exportedAt: new Date().toISOString(), progress: merged },
    null,
    2
  )
}

/**
 * Merge an exported file back in. Union rather than overwrite, so importing a
 * phone backup onto a desktop never silently drops progress made on either one.
 * @returns {{dexes:number, caught:number, shiny:number}} what came in
 */
export function importJson(text) {
  const parsed = JSON.parse(text)
  const incoming = parsed?.progress
  if (!incoming || typeof incoming !== 'object') {
    throw new Error('not a Pokédex Tracker export')
  }

  let dexes = 0
  let caught = 0
  let shiny = 0

  for (const [slug, value] of Object.entries(incoming)) {
    const inCaught = Array.isArray(value?.caught) ? value.caught.filter(Number.isInteger) : []
    const inShiny = Array.isArray(value?.shiny) ? value.shiny.filter(Number.isInteger) : []
    if (!inCaught.length && !inShiny.length) continue

    const current = progress[slug] ?? empty()
    progress[slug] = {
      caught: [...new Set([...current.caught, ...inCaught])].sort((a, b) => a - b),
      shiny: [...new Set([...current.shiny, ...inShiny])].sort((a, b) => a - b),
    }
    dirty.add(slug)
    dexes++
    caught += inCaught.length
    shiny += inShiny.length
  }

  writeStorage()
  return { dexes, caught, shiny }
}
