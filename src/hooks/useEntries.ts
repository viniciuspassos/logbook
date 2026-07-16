import { useEffect, useRef, useState } from 'react'
import {
  getAllEntries,
  isPersistenceSupported,
  putEntries,
  putEntry,
  replaceAllEntries,
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
  replaceEntries: (entries: Entry[]) => Promise<void>
} {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loaded, setLoaded] = useState(false)
  // Set once the user's own action (a backup restore) has authored the list.
  // The mount-time load must never overwrite that, even if it resolves later.
  const supersededRef = useRef(false)

  useEffect(() => {
    let active = true
    const live = () => active && !supersededRef.current

    async function load() {
      if (!isPersistenceSupported()) {
        if (live()) {
          setEntries(byNewest(seed))
          setLoaded(true)
        }
        return
      }
      try {
        const stored = await getAllEntries()
        if (stored.length === 0) {
          // Re-check before seeding: a restore may have written real entries
          // while this read was in flight, and seeding over them would both
          // resurrect the samples and lose the user's data.
          if (live()) {
            await putEntries(seed)
            if (live()) setEntries(byNewest(seed))
          }
        } else if (live()) {
          setEntries(stored)
        }
      } catch {
        // A storage failure must never blank the app: fall back to the seed.
        if (live()) setEntries(byNewest(seed))
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

  /**
   * Swap the whole list, e.g. when restoring a backup. Unlike `addEntry` this
   * awaits the write and lets failures propagate, so the caller can tell the
   * user the restore didn't stick rather than showing entries that vanish on
   * the next reload.
   */
  async function replaceEntries(next: Entry[]) {
    supersededRef.current = true
    if (isPersistenceSupported()) {
      await replaceAllEntries(next)
    }
    setEntries(byNewest(next))
  }

  return { entries, loaded, addEntry, replaceEntries }
}
