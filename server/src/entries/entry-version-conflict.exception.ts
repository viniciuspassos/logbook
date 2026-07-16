import { ConflictException } from '@nestjs/common'
import type { Entry } from './entry.entity'

/**
 * Thrown when a PATCH's `version` doesn't match the entry's current version
 * — the optimistic-concurrency conflict case from #24. No write happens
 * when this is thrown (see EntriesRepository.update): the entry passed here
 * is the row exactly as it stood before this request, untouched.
 *
 * Carries that current entry state in the response body so the client can
 * resolve the conflict (e.g. auto-resolve to the newest edit while
 * preserving its own losing draft as `supersededEdit` on a follow-up PATCH,
 * see UpdateEntryDto) without a second round-trip to re-fetch the entry.
 *
 * Response shape: `getResponse()` returns `{ message: string, currentEntry:
 * Entry }`. The running app (main.ts) registers the global
 * AllExceptionsFilter (common/filters/http-exception.filter.ts), which nests
 * that object under a top-level `message` key like every other HttpException
 * in this app — so a real client reads the current entry at
 * `response.body.message.currentEntry`. The e2e suites in this app
 * deliberately don't register that filter (see entries.e2e.test.ts's
 * module setup), so in tests the same object appears one level up, at
 * `response.body.currentEntry`.
 */
export class EntryVersionConflictException extends ConflictException {
  constructor(currentEntry: Entry) {
    super({
      message: 'Entry has been modified since the version this update was based on',
      currentEntry,
    })
  }
}
