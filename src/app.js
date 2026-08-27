// Entry point: owns the current dex + filter state and wires events to render.

import { loadIndex, loadDex } from './data.js'
import {
  dexSets, commit, clearDex, exportJson, importJson, isEphemeral, onExternalChange,
} from './state.js'
import {
  renderPicker, renderGrid, renderMeters, paintCard, refreshBoxCount, setStatus, toast,
} from './render.js'

const DEFAULT_SLUG = 'lumiose-city'   // what Jeff is playing
const LAST_DEX_KEY = 'pokedex-tracker:last-dex'
const BOX_VIEW_KEY = 'pokedex-tracker:box-view'

const els = {
  select: document.getElementById('dex-select'),
  search: document.getElementById('search'),
  filters: document.querySelector('.filters'),
  shinyMode: document.getElementById('shiny-mode'),
  boxView: document.getElementById('box-view'),
  grid: document.getElementById('grid'),
  export: document.getElementById('export'),
  import: document.getElementById('import'),
  importFile: document.getElementById('import-file'),
  reset: document.getElementById('reset'),
}

const view = {
  dex: null,            // { slug, name, game, entries }
  sets: null,           // { caught:Set, shiny:Set }
  byId: new Map(),      // id -> entry, for cheap card lookups
  filter: 'all',
  query: '',
  shinyMode: false,
  boxed: false,        // lay the dex out as 6 x 5 PC boxes
}

const rememberDex = (slug) => { try { localStorage.setItem(LAST_DEX_KEY, slug) } catch {} }
const lastDex = () => { try { return localStorage.getItem(LAST_DEX_KEY) } catch { return null } }
const rememberBoxView = (on) => { try { localStorage.setItem(BOX_VIEW_KEY, on ? '1' : '0') } catch {} }
const lastBoxView = () => { try { return localStorage.getItem(BOX_VIEW_KEY) === '1' } catch { return false } }

/** Entries passing the active search + filter. */
function visibleEntries() {
  const q = view.query.trim().toLowerCase()
  return view.dex.entries.filter((e) => {
    if (view.filter === 'caught' && !view.sets.caught.has(e.id)) return false
    if (view.filter === 'missing' && view.sets.caught.has(e.id)) return false
    if (view.filter === 'shiny' && !view.sets.shiny.has(e.id)) return false
    if (!q) return true
    return (
      e.name.toLowerCase().includes(q) ||
      String(e.n) === q ||
      String(e.id) === q ||
      String(e.n).padStart(3, '0') === q ||
      String(e.id).padStart(3, '0') === q
    )
  })
}

function refreshGrid() {
  const entries = visibleEntries()
  const regrouped = view.filter !== 'all' || view.query.trim() !== ''
  renderGrid(entries, view.sets, { boxed: view.boxed, regrouped })
  setStatus(entries.length ? '' : 'No Pokémon match that search or filter.')
}

function refreshMeters() {
  renderMeters(view.sets, view.dex.entries.length)
}

async function selectDex(slug) {
  setStatus('Loading…')
  els.grid.replaceChildren()
  try {
    const dex = await loadDex(slug)
    view.dex = dex
    view.sets = dexSets(slug)
    view.byId = new Map(dex.entries.map((e) => [e.id, e]))
    rememberDex(slug)
    document.title = `${dex.game} — Pokédex Tracker`
    refreshMeters()
    refreshGrid()
  } catch (err) {
    setStatus(err.message)
  }
}

/** Toggle one Pokémon and repaint just its card. */
function toggle(id, kind) {
  const entry = view.byId.get(id)
  if (!entry) return
  const set = view.sets[kind]
  set.has(id) ? set.delete(id) : set.add(id)
  // Marking something shiny implies you have it.
  if (kind === 'shiny' && set.has(id)) view.sets.caught.add(id)

  commit(view.dex.slug, view.sets)
  refreshMeters()

  // Under a filter the card may no longer belong; otherwise repaint in place.
  const stillVisible =
    view.filter === 'all' ||
    (view.filter === 'caught' && view.sets.caught.has(id)) ||
    (view.filter === 'missing' && !view.sets.caught.has(id)) ||
    (view.filter === 'shiny' && view.sets.shiny.has(id))

  if (!stillVisible) { refreshGrid(); return }
  const el = els.grid.querySelector(`.card[data-id="${id}"]`)
  if (!el) return
  paintCard(el, entry, view.sets)
  refreshBoxCount(el)
}

/* ---- events ------------------------------------------------------------- */

els.select.addEventListener('change', (e) => selectDex(e.target.value))

els.grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card')
  if (!card) return
  const id = Number(card.dataset.id)
  const hitStar = e.target.closest('[data-star]')
  toggle(id, hitStar || view.shinyMode ? 'shiny' : 'caught')
})

// The star is inside the card button, so it needs its own keyboard handling.
els.grid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const star = e.target.closest('[data-star]')
  if (!star) return
  e.preventDefault()
  e.stopPropagation()
  toggle(Number(star.closest('.card').dataset.id), 'shiny')
})

let searchTimer = null
els.search.addEventListener('input', (e) => {
  const value = e.target.value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { view.query = value; refreshGrid() }, 120)
})

els.filters.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip')
  if (!chip) return
  view.filter = chip.dataset.filter
  for (const c of els.filters.querySelectorAll('.chip')) {
    c.classList.toggle('is-active', c === chip)
  }
  refreshGrid()
})

els.shinyMode.addEventListener('click', () => {
  view.shinyMode = !view.shinyMode
  els.shinyMode.setAttribute('aria-pressed', String(view.shinyMode))
})

els.boxView.addEventListener('click', () => {
  view.boxed = !view.boxed
  els.boxView.setAttribute('aria-pressed', String(view.boxed))
  rememberBoxView(view.boxed)
  refreshGrid()
})

// `/` jumps to search, the way you'd expect while scanning a long list.
addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
    e.preventDefault()
    els.search.focus()
  }
})

els.export.addEventListener('click', () => {
  const blob = new Blob([exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pokedex-progress-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast('Progress exported')
})

els.import.addEventListener('click', () => els.importFile.click())

els.importFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const { dexes, caught } = importJson(await file.text())
    view.sets = dexSets(view.dex.slug)
    refreshMeters()
    refreshGrid()
    toast(`Merged ${caught} caught across ${dexes} ${dexes === 1 ? 'dex' : 'dexes'}`)
  } catch (err) {
    toast(`Import failed: ${err.message}`)
  } finally {
    e.target.value = ''   // let the same file be picked again
  }
})

els.reset.addEventListener('click', () => {
  const label = view.dex.game
  if (!confirm(`Clear all caught and shiny marks for ${label}?\n\nThis can't be undone — export a backup first if you're unsure.`)) return
  clearDex(view.dex.slug)
  view.sets = dexSets(view.dex.slug)
  refreshMeters()
  refreshGrid()
  toast(`${label} reset`)
})

// Another tab (or window) saved progress — pick up its version of this dex.
onExternalChange(() => {
  if (!view.dex) return
  view.sets = dexSets(view.dex.slug)
  refreshMeters()
  refreshGrid()
})

/* ---- boot --------------------------------------------------------------- */

async function boot() {
  view.boxed = lastBoxView()
  els.boxView.setAttribute('aria-pressed', String(view.boxed))
  try {
    const index = await loadIndex()
    const known = new Set(index.map((d) => d.slug))
    const slug = [lastDex(), DEFAULT_SLUG, index[0]?.slug].find((s) => s && known.has(s))
    renderPicker(els.select, index, slug)
    await selectDex(slug)
    if (isEphemeral()) {
      toast("This browser blocks saved data — progress won't persist")
    }
  } catch (err) {
    setStatus(`${err.message} — if you opened this file directly, run it through a local server instead (see README).`)
  }
}

boot()
