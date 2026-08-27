// Rendering: dex picker, meters, and the card grid.

const grid = document.getElementById('grid')
const statusEl = document.getElementById('status')

const pad = (n) => String(n).padStart(3, '0')

// Every storage box since Generation III is 6 wide by 5 tall — 30 slots. (The
// Gen I/II PC held 20 per box, but those dexes are played through remakes here.)
const BOX_COLUMNS = 6
const BOX_ROWS = 5
const BOX_SIZE = BOX_COLUMNS * BOX_ROWS

/** Build the picker, sectioned by generation. */
export function renderPicker(select, index, activeSlug) {
  const groups = new Map()
  for (const dex of index) {
    if (!groups.has(dex.group)) groups.set(dex.group, [])
    groups.get(dex.group).push(dex)
  }

  const frag = document.createDocumentFragment()
  for (const [label, dexes] of groups) {
    const optgroup = document.createElement('optgroup')
    optgroup.label = label
    for (const dex of dexes) {
      const opt = document.createElement('option')
      opt.value = dex.slug
      // `game` is how you'd actually name it ("Legends: Z-A"); `name` is
      // PokeAPI's terser region label ("Lumiose").
      opt.textContent = `${dex.game} — ${dex.count}`
      opt.selected = dex.slug === activeSlug
      optgroup.append(opt)
    }
    frag.append(optgroup)
  }
  select.replaceChildren(frag)
}

export function renderMeters(sets, total) {
  for (const [id, set, key] of [
    ['meter-caught', sets.caught, 'caught'],
    ['meter-shiny', sets.shiny, 'shiny'],
  ]) {
    const el = document.getElementById(id)
    const n = set.size
    const pct = total ? Math.round((n / total) * 100) : 0
    el.querySelector('.meter-value').textContent = `${n} / ${total} · ${pct}%`
    el.querySelector('.meter-fill').style.width = `${pct}%`
    el.querySelector('.meter-fill').setAttribute('data-key', key)
  }
}

function card(entry, sets) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'card'
  el.dataset.id = String(entry.id)
  if (entry.types?.[0]) el.classList.add(`t-${entry.types[0]}`)

  const num = document.createElement('span')
  num.className = 'num'
  num.textContent = `#${pad(entry.n)}`

  const img = document.createElement('img')
  img.className = 'sprite'
  img.src = `sprites/${entry.id}.png`
  img.alt = ''
  img.loading = 'lazy'
  img.decoding = 'async'
  img.width = 96
  img.height = 96

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = entry.name

  const meta = document.createElement('span')
  meta.className = 'meta'
  meta.textContent = `#${pad(entry.id)} · ${entry.types?.join(' / ') || '—'}`

  const star = document.createElement('span')
  star.className = 'star'
  star.dataset.star = '1'
  star.setAttribute('role', 'button')
  star.setAttribute('tabindex', '0')
  star.textContent = '✦'

  el.append(num, img, name, meta, star)
  paintCard(el, entry, sets)
  return el
}

/** Sync one card's visual + a11y state to the sets. */
export function paintCard(el, entry, sets) {
  const caught = sets.caught.has(entry.id)
  const shiny = sets.shiny.has(entry.id)
  el.classList.toggle('is-caught', caught)
  el.classList.toggle('is-shiny', shiny)
  el.setAttribute('aria-pressed', String(caught))
  el.setAttribute(
    'aria-label',
    `#${pad(entry.n)} ${entry.name}, ${caught ? 'caught' : 'not caught'}${shiny ? ', shiny' : ''}`
  )
  const star = el.querySelector('.star')
  star.setAttribute('aria-pressed', String(shiny))
  star.setAttribute('aria-label', `Mark ${entry.name} shiny`)
}

/** One box: a heading with its caught tally, then up to 30 cards, 6 across. */
function box(index, entries, sets) {
  const section = document.createElement('section')
  section.className = 'box'

  const title = document.createElement('h2')
  title.className = 'box-title'
  title.textContent = `Box ${index + 1}`

  const count = document.createElement('span')
  count.className = 'box-count'
  count.textContent = `${entries.filter((e) => sets.caught.has(e.id)).length} / ${entries.length}`

  const head = document.createElement('div')
  head.className = 'box-head'
  head.append(title, count)

  const slots = document.createElement('div')
  slots.className = 'box-grid'
  for (const entry of entries) slots.append(card(entry, sets))

  section.append(head, slots)
  return section
}

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.boxed]     group into 6 x 5 boxes instead of one flat grid
 * @param {boolean} [opts.regrouped] a search/filter is narrowing the list, so the
 *                                   boxes no longer line up with the in-game ones
 */
export function renderGrid(entries, sets, { boxed = false, regrouped = false } = {}) {
  grid.classList.toggle('is-boxed', boxed)

  const frag = document.createDocumentFragment()
  if (boxed) {
    if (regrouped && entries.length) {
      const note = document.createElement('p')
      note.className = 'box-note'
      note.textContent =
        'Boxes repack as you search or filter — clear both to see true in-game box order.'
      frag.append(note)
    }
    for (let i = 0; i < entries.length; i += BOX_SIZE) {
      frag.append(box(i / BOX_SIZE, entries.slice(i, i + BOX_SIZE), sets))
    }
  } else {
    for (const entry of entries) frag.append(card(entry, sets))
  }
  grid.replaceChildren(frag)
}

/** Re-tally the box a just-repainted card sits in. No-op in flat grid view. */
export function refreshBoxCount(cardEl) {
  const section = cardEl.closest('.box')
  if (!section) return
  const total = section.querySelectorAll('.card').length
  const caught = section.querySelectorAll('.card.is-caught').length
  section.querySelector('.box-count').textContent = `${caught} / ${total}`
}

export function setStatus(message) {
  statusEl.textContent = message ?? ''
  statusEl.hidden = !message
}

let toastTimer = null
export function toast(message) {
  const el = document.getElementById('toast')
  el.textContent = message
  el.classList.add('is-visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600)
}
