import type { ReactNode } from 'react'
import './SettingsScreen.css'

interface SettingsRowProps {
  label: string
  value: ReactNode
}

function SettingsRow({ label, value }: SettingsRowProps) {
  return (
    <div className="settings-screen__row">
      <span className="settings-screen__row-label">{label}</span>
      <span className="settings-screen__row-value">{value}</span>
    </div>
  )
}

function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="settings-screen__section-label">{label}</div>
      <div className="settings-screen__group">{children}</div>
    </>
  )
}

export function SettingsScreen() {
  return (
    <div className="settings-screen">
      <h1 className="settings-screen__title">Settings</h1>

      <SettingsGroup label="Data">
        <SettingsRow label="Local storage" value="5 entries" />
        <SettingsRow label="Backup to file" value="›" />
        <SettingsRow label="Export as Markdown" value="›" />
        <SettingsRow label="Export as PDF" value="›" />
      </SettingsGroup>

      <SettingsGroup label="Voice & AI">
        <SettingsRow
          label="On-device processing"
          value={<span className="settings-screen__enabled">Enabled</span>}
        />
        <SettingsRow label="Language" value="English" />
      </SettingsGroup>

      <SettingsGroup label="About">
        <SettingsRow label="Version" value="1.0.0" />
      </SettingsGroup>
    </div>
  )
}
