import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Config } from './config';
import type { Db } from './db/client';
import type { Lifecycle } from './common/lifecycle';
import { CONFIG, DB, LIFECYCLE, POOL } from './common/tokens';
import { HealthController } from './health/health.controller';

export type AppDeps = { config: Config; db: Db; pool: Pool; lifecycle: Lifecycle };

@Global()
@Module({})
export class AppModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: deps.config },
        { provide: DB, useValue: deps.db },
        { provide: POOL, useValue: deps.pool },
        { provide: LIFECYCLE, useValue: deps.lifecycle },
      ],
      exports: [CONFIG, DB, POOL, LIFECYCLE],
    };
  }
}
