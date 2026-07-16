import { useEffect, useState } from 'react'
import {
  getAllEntries,
  isPersistenceSupported,
  putEntries,
  putEntry,
} from '../lib/db/entriesStore.ts'
import type { Entry } from '../types/entry.ts'

/** Newest-first, matching what {@link getAllEntries} returns on reload. */
function byNewest(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => b.id - a.id)
}

/**
 * Owns the persisted entries list. On mount it loads from IndexedDB, seeding
 * the store from `seed` on first run; when persistence is unavailable it falls
 * back to an in-memory copy of the seed so the app still works. `addEntry`
 * updates state immediately and writes through to the store in the background.
 */
export function useEntries(seed: Entry[]): {
  entries: Entry[]
  loaded: boolean
  addEntry: (entry: Entry) => void
} {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      if (!isPersistenceSupported()) {
        if (active) {
          setEntries(byNewest(seed))
          setLoaded(true)
        }
        return
      }
      try {
        const stored = await getAllEntries()
        if (stored.length === 0) {
          await putEntries(seed)
          if (active) setEntries(byNewest(seed))
        } else if (active) {
          setEntries(stored)
        }
      } catch {
        // A storage failure must never blank the app: fall back to the seed.
        if (active) setEntries(byNewest(seed))
      } finally {
        if (active) setLoaded(true)
      }
    }

    void load()
    return () => {
      active = false
    }
    // Seed is a one-time bootstrap; re-running on identity changes would wipe
    // user-added entries, so this intentionally runs only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addEntry(entry: Entry) {
    setEntries((prev) => [entry, ...prev])
    if (isPersistenceSupported()) {
      // Fire-and-forget write-through; state already reflects the new entry.
      void putEntry(entry).catch(() => {})
    }
  }

  return { entries, loaded, addEntry }
}
