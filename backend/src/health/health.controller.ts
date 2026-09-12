import { Controller, Post, Inject, HttpCode, ServiceUnavailableException } from '@nestjs/common'
import { DatabaseService } from '../database/database.service.js'
import { Public } from '../auth/auth.guard.js'

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @HttpCode(200)
  @Post('live')
  live() {
    return { status: 'ok' }
  }

  @HttpCode(200)
  @Post('ready')
  async ready() {
    try {
      await this.database.ping()
      return { status: 'ok' }
    } catch {
      throw new ServiceUnavailableException('Database unavailable')
    }
  }
}
