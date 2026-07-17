import { isUnexpectedMigrationGenerateFailure, NO_DRIFT_MESSAGE } from './migration-drift.util'

describe('isUnexpectedMigrationGenerateFailure', () => {
  it('is not unexpected when migration:generate exits 0 (drift written)', () => {
    expect(isUnexpectedMigrationGenerateFailure(0, 'Migration DriftCheck1234567890 has been generated successfully.')).toBe(
      false,
    )
  })

  it('is not unexpected when migration:generate exits 0 even if output happens to mention drift', () => {
    expect(isUnexpectedMigrationGenerateFailure(0, `some unrelated log line, not the ${NO_DRIFT_MESSAGE} case`)).toBe(
      false,
    )
  })

  it('is not unexpected for the documented "no drift" case: non-zero exit with the known message', () => {
    expect(isUnexpectedMigrationGenerateFailure(1, `${NO_DRIFT_MESSAGE} in DriftCheck`)).toBe(false)
  })

  it('is unexpected for a non-zero exit without the known "no drift" message', () => {
    expect(isUnexpectedMigrationGenerateFailure(1, 'Error: connection terminated unexpectedly')).toBe(true)
  })

  it('is unexpected for a non-zero exit with empty output', () => {
    expect(isUnexpectedMigrationGenerateFailure(127, '')).toBe(true)
  })

  it('is unexpected for any non-zero exit code, not just 1, when the message is absent', () => {
    expect(isUnexpectedMigrationGenerateFailure(2, 'command not found: typeorm')).toBe(true)
  })
})
