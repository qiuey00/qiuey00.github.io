// Static data loading. index.json is tiny and always loaded; individual dex
// files are fetched on demand and cached, so switching back is instant.
// Paths are relative so the site works from a GitHub Pages subpath.

const cache = new Map()

export async function loadIndex() {
  const res = await fetch('data/index.json')
  if (!res.ok) throw new Error(`Could not load dex list (${res.status})`)
  return res.json()
}

export async function loadDex(slug) {
  if (cache.has(slug)) return cache.get(slug)

  const promise = fetch(`data/dex/${slug}.json`).then((res) => {
    if (!res.ok) throw new Error(`Could not load "${slug}" (${res.status})`)
    return res.json()
  })
  // Cache the promise, not the result: two rapid switches share one request.
  cache.set(slug, promise)

  try {
    return await promise
  } catch (err) {
    cache.delete(slug)
    throw err
  }
}
