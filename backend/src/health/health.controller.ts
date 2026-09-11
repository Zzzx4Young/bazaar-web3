import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common'
import { DatabaseService } from '../database/database.service.js'

@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('live')
  live() {
    return { status: 'ok' }
  }

  @Get('ready')
  async ready() {
    try {
      await this.database.ping()
      return { status: 'ok' }
    } catch {
      throw new ServiceUnavailableException('Database unavailable')
    }
  }
}
