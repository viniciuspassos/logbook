import { computeStats } from '../lib/computeStats.ts'
import type { Entry } from '../types/entry.ts'
import './StatsScreen.css'

interface StatsScreenProps {
  entries: Entry[]
}

export function StatsScreen({ entries }: StatsScreenProps) {
  const { tiles, breakdown } = computeStats(entries)

  return (
    <div className="stats-screen">
      <h1 className="stats-screen__title">Stats</h1>

      <div className="stats-screen__grid">
        {tiles.map((tile) => (
          <div key={tile.label} className="stats-screen__tile">
            <div className="stats-screen__tile-value">{tile.value}</div>
            <div className="stats-screen__tile-label">{tile.label}</div>
          </div>
        ))}
      </div>

      <div className="stats-screen__section-label">By activity</div>
      {breakdown.length === 0 ? (
        <p className="stats-screen__empty">No adventures logged yet.</p>
      ) : (
        <div className="stats-screen__breakdown">
          {breakdown.map((activity) => (
            <div key={activity.label} className="stats-screen__row">
              <div className="stats-screen__row-header">
                <span>{activity.label}</span>
                <span>{activity.count}</span>
              </div>
              <div className="stats-screen__bar-track">
                <div
                  className="stats-screen__bar-fill"
                  style={{ width: `${activity.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
