import { EntryCard } from '../components/EntryCard.tsx'
import { PhotoPlaceholder } from '../components/PhotoPlaceholder.tsx'
import { ShapeGlyph } from '../components/ShapeGlyph.tsx'
import { cx } from '../lib/cx.ts'
import type { Entry } from '../types/entry.ts'
import type { TimelineView } from '../hooks/useNavigation.ts'
import { groupEntriesByDate } from './timelineGrouping.ts'
import './TimelineScreen.css'

interface TimelineScreenProps {
  entries: Entry[]
  timelineView: TimelineView
  onChangeView: (view: TimelineView) => void
  onOpenEntry: (id: number) => void
}

export function TimelineScreen({
  entries,
  timelineView,
  onChangeView,
  onOpenEntry,
}: TimelineScreenProps) {
  return (
    <div className="timeline-screen">
      <h1 className="timeline-screen__title">Logbook</h1>
      <div className="timeline-screen__sync">
        <span className="timeline-screen__sync-dot" />
        <span>Saved locally · not synced</span>
      </div>

      <div className="timeline-screen__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={timelineView === 'list'}
          className={cx('timeline-screen__tab', timelineView === 'list' && 'is-active')}
          onClick={() => onChangeView('list')}
        >
          List
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={timelineView === 'map'}
          className={cx('timeline-screen__tab', timelineView === 'map' && 'is-active')}
          onClick={() => onChangeView('map')}
        >
          Map
        </button>
      </div>

      {timelineView === 'list' ? (
        <div className="timeline-screen__list">
          {/* Desktop-only ledger margin rule — hidden below 960px
           *  (TimelineScreen.css). Grouping always runs (it's a cheap pure
           *  function) so the date headers it feeds are equally available;
           *  they're just visually hidden on mobile too. */}
          <div className="timeline-screen__ledger-rule" aria-hidden="true" />
          {groupEntriesByDate(entries).map((group, index) => (
            <div key={`${group.date}-${index}`} className="timeline-screen__date-group">
              <div className="timeline-screen__date-header">{group.date}</div>
              {group.entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} onOpen={() => onOpenEntry(entry.id)} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="timeline-screen__map">
          <div className="timeline-screen__map-area">
            <PhotoPlaceholder hint="world map — drop a map screenshot" shape="rect" />
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="timeline-screen__pin"
                style={{ left: `${entry.mapX}%`, top: `${entry.mapY}%` }}
                onClick={() => onOpenEntry(entry.id)}
                aria-label={entry.title}
              >
                <span className="timeline-screen__pin-shape">
                  <span className="timeline-screen__pin-glyph">
                    <ShapeGlyph shape={entry.shape} />
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="timeline-screen__strip">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="timeline-screen__strip-card"
                onClick={() => onOpenEntry(entry.id)}
              >
                <div className="timeline-screen__strip-photo">
                  <PhotoPlaceholder hint={entry.photoHint} shape="rect" />
                </div>
                <div className="timeline-screen__strip-title">{entry.title}</div>
                <div className="timeline-screen__strip-location">{entry.location}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
