import type { ReactNode } from 'react'
import type { Tab } from '../hooks/useLogbookApp.ts'
import './TabBar.css'

interface TabBarProps {
  active: Tab
  onSelect: (tab: Tab) => void
  onNewEntry: () => void
}

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
  return (
    <nav className="tab-bar" aria-label="Primary">
      <TabButton
        label="Timeline"
        isActive={active === 'timeline'}
        onClick={() => onSelect('timeline')}
      >
        <span
          className={`tab-bar__icon-square${active === 'timeline' ? ' is-active' : ''}`}
        />
      </TabButton>

      <TabButton
        label="Search"
        isActive={active === 'search'}
        onClick={() => onSelect('search')}
      >
        <span className={`tab-bar__icon-ring${active === 'search' ? ' is-active' : ''}`} />
      </TabButton>

      <button
        type="button"
        className="tab-bar__add"
        onClick={onNewEntry}
        aria-label="New entry"
      >
        <span className="tab-bar__add-dot" />
      </button>

      <TabButton
        label="Stats"
        isActive={active === 'stats'}
        onClick={() => onSelect('stats')}
      >
        <span className={`tab-bar__icon-bars${active === 'stats' ? ' is-active' : ''}`}>
          <span />
          <span />
          <span />
        </span>
      </TabButton>

      <TabButton
        label="Settings"
        isActive={active === 'settings'}
        onClick={() => onSelect('settings')}
      >
        <span
          className={`tab-bar__icon-dial${active === 'settings' ? ' is-active' : ''}`}
        />
      </TabButton>
    </nav>
  )
}
