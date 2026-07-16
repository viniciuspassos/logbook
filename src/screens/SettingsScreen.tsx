import type { ReactNode } from 'react'
import type { ExportActions } from '../hooks/useExportActions.ts'
import { entryCountLabel } from '../lib/export/exportHeader.ts'
import { cx } from '../lib/cx.ts'
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

interface SettingsActionRowProps {
  label: string
  hint?: string
  disabled?: boolean
  onClick: () => void
}

/** A row that does something — a real button, so it's keyboard-reachable. */
function SettingsActionRow({ label, hint, disabled, onClick }: SettingsActionRowProps) {
  return (
    <button
      type="button"
      className="settings-screen__row settings-screen__row--action"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="settings-screen__row-label">{label}</span>
      <span className="settings-screen__row-value">
        {hint && <span className="settings-screen__row-hint">{hint}</span>}
        <span aria-hidden="true">›</span>
      </span>
    </button>
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

interface SettingsScreenProps {
  entryCount: number
  exports: ExportActions
}

export function SettingsScreen({ entryCount, exports }: SettingsScreenProps) {
  const { status, busy } = exports

  return (
    <div className="settings-screen">
      <h1 className="settings-screen__title">Settings</h1>

      <SettingsGroup label="Data">
        <SettingsRow label="Local storage" value={entryCountLabel(entryCount)} />
        <SettingsActionRow label="Backup to file" onClick={exports.backupToFile} disabled={busy} />
        <SettingsActionRow
          label="Restore from backup"
          hint="replaces all entries"
          onClick={exports.restoreFromFile}
          disabled={busy}
        />
        <SettingsActionRow
          label="Export as Markdown"
          onClick={exports.exportLogbookMarkdown}
          disabled={busy}
        />
        <SettingsActionRow
          label="Export as PDF"
          onClick={exports.exportLogbookPdf}
          disabled={busy}
        />
      </SettingsGroup>

      {/* Announces the outcome of an export the user just triggered. */}
      <div className="settings-screen__status" role="status" aria-live="polite">
        {status && (
          <span
            className={cx(
              'settings-screen__status-text',
              status.tone === 'error' && 'settings-screen__status-text--error',
            )}
          >
            {status.message}
          </span>
        )}
      </div>

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
