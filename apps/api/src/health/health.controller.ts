import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { Public } from '../auth/public.decorator';
import { LIFECYCLE, POOL } from '../common/tokens';
import type { Lifecycle } from '../common/lifecycle';

@Public()
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(LIFECYCLE) private readonly lifecycle: Lifecycle,
  ) {}

  /** Liveness: the process is up. Never touches the database. */
  @Get('health')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return { status: 'ok' };
  }

  /** Readiness: can serve traffic (DB reachable, not shutting down). */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async ready(@Res({ passthrough: true }) res: Response) {
    if (this.lifecycle.shuttingDown) {
      res.status(503);
      return { status: 'shutting_down' };
    }
    try {
      await Promise.race([
        this.pool.query('select 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout')), 2_000).unref()),
      ]);
      return { status: 'ready' };
    } catch {
      res.status(503);
      return { status: 'db_unavailable' };
    }
  }
}
