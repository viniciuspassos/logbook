import './StatsScreen.css'

interface StatTile {
  label: string
  value: string
}

interface ActivityBreakdown {
  label: string
  count: number
  percent: number
}

// Demo figures, same as the rest of the app's data — real computation
// arrives once entries are actually persisted and tagged with an activity.
const STAT_TILES: StatTile[] = [
  { label: 'Adventures', value: '5' },
  { label: 'Days out', value: '14' },
  { label: 'Countries', value: '4' },
  { label: 'Highest point', value: '4,000m' },
]

const ACTIVITY_BREAKDOWN: ActivityBreakdown[] = [
  { label: 'Climbing', count: 2, percent: 40 },
  { label: 'Trekking', count: 1, percent: 20 },
  { label: 'Hiking', count: 1, percent: 20 },
  { label: 'Skydiving', count: 1, percent: 20 },
]

export function StatsScreen() {
  return (
    <div className="stats-screen">
      <h1 className="stats-screen__title">Stats</h1>

      <div className="stats-screen__grid">
        {STAT_TILES.map((tile) => (
          <div key={tile.label} className="stats-screen__tile">
            <div className="stats-screen__tile-value">{tile.value}</div>
            <div className="stats-screen__tile-label">{tile.label}</div>
          </div>
        ))}
      </div>

      <div className="stats-screen__section-label">By activity</div>
      <div className="stats-screen__breakdown">
        {ACTIVITY_BREAKDOWN.map((activity) => (
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
    </div>
  )
}
