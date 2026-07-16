import { HealthController } from './health.controller'

describe('HealthController', () => {
  it('reports ok status with an ISO timestamp and process uptime', () => {
    const controller = new HealthController()

    const result = controller.check()

    expect(result.status).toBe('ok')
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow()
    expect(typeof result.uptimeSeconds).toBe('number')
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })
})
