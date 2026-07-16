import { Controller, Get } from '@nestjs/common'

export interface HealthStatus {
  status: 'ok'
  timestamp: string
  uptimeSeconds: number
}

/**
 * Liveness check for the process itself, deliberately independent of the
 * database — a healthy-but-DB-down state should still report here so a
 * container orchestrator can distinguish "process is up" from "DB reachable"
 * if a separate readiness check is added later.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
    }
  }
}
