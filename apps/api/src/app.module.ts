import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Config } from './config';
import type { Db } from './db/client';
import type { Lifecycle } from './common/lifecycle';
import { CONFIG, DB, LIFECYCLE, POOL } from './common/tokens';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { RateLimitService } from './auth/rate-limit.service';
import { SessionService } from './auth/session.service';

export type AppDeps = { config: Config; db: Db; pool: Pool; lifecycle: Lifecycle };

@Global()
@Module({})
export class AppModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController],
      providers: [
        SessionService,
        RateLimitService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: CONFIG, useValue: deps.config },
        { provide: DB, useValue: deps.db },
        { provide: POOL, useValue: deps.pool },
        { provide: LIFECYCLE, useValue: deps.lifecycle },
      ],
      exports: [CONFIG, DB, POOL, LIFECYCLE],
    };
  }
}
