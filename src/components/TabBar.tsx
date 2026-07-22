import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import type { Tab } from '../hooks/useNavigation.ts'
import './TabBar.css'

interface TabBarProps {
  active: Tab
  onSelect: (tab: Tab) => void
  onNewEntry: () => void
}

interface TabConfig {
  id: Tab
  label: string
  icon: (isActive: boolean) => ReactNode
}

const TAB_CONFIG: TabConfig[] = [
  {
    id: 'timeline',
    label: 'Timeline',
    icon: (isActive) => (
      <span className={cx('tab-bar__icon-square', isActive && 'is-active')} />
    ),
  },
  {
    id: 'search',
    label: 'Search',
    icon: (isActive) => (
      <span className={cx('tab-bar__icon-ring', isActive && 'is-active')} />
    ),
  },
  {
    id: 'stats',
    label: 'Stats',
    icon: (isActive) => (
      <span className={cx('tab-bar__icon-bars', isActive && 'is-active')}>
        <span />
        <span />
        <span />
      </span>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (isActive) => (
      <span className={cx('tab-bar__icon-dial', isActive && 'is-active')} />
    ),
  },
]

interface TabButtonProps {
  label: string
  isActive: boolean
  onClick: () => void
  children: ReactNode
}

function TabButton({ label, isActive, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      className="tab-bar__button"
      aria-current={isActive ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
      <span className="tab-bar__label">{label}</span>
    </button>
  )
}

export function TabBar({ active, onSelect, onNewEntry }: TabBarProps) {
  const [timeline, search, stats, settings] = TAB_CONFIG

  function renderTab(tab: TabConfig) {
    const isActive = active === tab.id
    return (
      <TabButton
        key={tab.id}
        label={tab.label}
        isActive={isActive}
        onClick={() => onSelect(tab.id)}
      >
        {tab.icon(isActive)}
      </TabButton>
    )
  }

  return (
    <nav className="tab-bar" aria-label="Primary">
      {/* Desktop-only rail wordmark, a single glyph in the display face — purely
       *  decorative, hidden on mobile via CSS (TabBar.css), so it needs no
       *  accessible name of its own. */}
      <span className="tab-bar__mark" aria-hidden="true">
        L
      </span>
      {renderTab(timeline)}
      {renderTab(search)}

      <button
        type="button"
        className="tab-bar__add"
        onClick={onNewEntry}
        aria-label="New entry"
      >
        <span className="tab-bar__add-dot" />
      </button>

      {renderTab(stats)}
      {renderTab(settings)}
    </nav>
  )
}
