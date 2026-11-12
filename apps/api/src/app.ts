import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Config } from './config';
import { AppModule, type AppDeps } from './app.module';
import { AllExceptionsFilter, mapException } from './common/all-exceptions.filter';

/**
 * The largest VALID request is a 1000-change batch of 20 tags x 50 characters: about 1.2 MB in ASCII and about 2.3 MB
 * in Cyrillic (2 bytes a character). 4 MB leaves room for both and still stops a flood of junk early.
 */
export const BODY_LIMIT = '4mb';

/** Builds the Nest app. Shared by main.ts and by tests, which run the *real* HTTP server. */
export const createApp = async (deps: AppDeps): Promise<INestApplication> => {
  const app = await NestFactory.create(AppModule.register(deps), {
    bodyParser: false,
    logger: process.env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  const cfg: Config = deps.config;
  // Slowloris protection: a client must send headers/body in a sane time.
  const server = app.getHttpServer() as import('node:http').Server;
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  const http = app.getHttpAdapter().getInstance() as express.Express;

  http.disable('x-powered-by');
  // 0 hops: ignore X-Forwarded-For entirely, so a client cannot choose its own rate-limit identity.
  http.set('trust proxy', cfg.TRUST_PROXY_HOPS);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader('x-request-id', id);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    next();
  });
  // Express middleware errors never reach Nest's exception filters, so map them here.
  const json = express.json({ limit: BODY_LIMIT, strict: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    json(req, res, (err?: unknown) => {
      if (!err) return next();
      const m = mapException(err);
      res
        .status(m.status)
        .json({ error: { ...m.body, requestId: (req as Request & { id?: string }).id } });
    });
  });
  app.use(cookieParser());
  // CSRF defence in depth (cookies are SameSite=Lax already): state-changing requests that carry an
  // Origin must come from an allowed origin.
  const allowed = new Set(cfg.CORS_ORIGIN.split(','));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && !allowed.has(origin)) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Origin not allowed' } });
      return;
    }
    next();
  });
  app.enableCors({ origin: cfg.CORS_ORIGIN.split(','), credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Catalog editor API')
      .setVersion('1.0')
      .addCookieAuth('sid')
      .build(),
  );
  SwaggerModule.setup('docs', app, doc);
  return app;
};

export const logger = new Logger('api');
