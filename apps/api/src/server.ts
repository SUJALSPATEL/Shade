import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { ERROR_MESSAGES, type ApiErrorBody } from '@shade/shared';
import { config, describeConfig } from './config/env.js';
import { registerAuth } from './auth/plugin.js';
import { ApiError } from './http/errors.js';
import { registerRoutes, type AppDeps } from './routes/index.js';

/**
 * The HTTP server.
 *
 * Two things are set up here and nowhere else: the plugins every route assumes
 * (cookies, CORS), and the single error handler that turns any thrown value
 * into the shared error envelope. Routes therefore never construct an error
 * response themselves, and the frontend never has to handle a second shape.
 */

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Trust the proxy for `request.ip` and protocol, since a real deployment
    // terminates TLS in front of this process.
    trustProxy: true,
    // A ceiling for parsed JSON bodies. The raw upload path enforces its own
    // limit while streaming, so this only bounds ordinary API payloads.
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.api.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  /**
   * The direct-upload route consumes `request.raw` itself, with a byte ceiling
   * applied as chunks arrive. Letting Fastify buffer the body first would
   * defeat that — an oversized upload would be fully read into memory before
   * anyone could reject it.
   */
  app.addContentTypeParser(
    ['application/pdf', 'application/octet-stream'],
    (_request, _payload, done) => {
      done(null, undefined);
    },
  );

  registerAuth(app);

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiError) {
      // 4xx is the caller's problem and is logged at info; 5xx is ours.
      if (error.status >= 500) request.log.error({ err: error }, error.message);
      else request.log.info({ code: error.code }, error.message);

      const body: ApiErrorBody = error.toBody(request.id);
      return reply.code(error.status).send({ error: body });
    }

    // Fastify's own schema/parse failures, which never carry field detail in
    // the shape our clients expect.
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      const body: ApiErrorBody = {
        code: 'VALIDATION_ERROR',
        message: error.message,
        requestId: request.id,
      };
      return reply.code(error.statusCode).send({ error: body });
    }

    // Anything else is a bug. Log it in full, but return nothing about it: an
    // internal message or stack trace in a response body is an information leak.
    request.log.error({ err: error }, 'Unhandled error');
    const body: ApiErrorBody = {
      code: 'INTERNAL_ERROR',
      message: ERROR_MESSAGES.INTERNAL_ERROR,
      requestId: request.id,
    };
    return reply.code(500).send({ error: body });
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = {
      code: 'NOT_FOUND',
      message: `No route for ${request.method} ${request.url}.`,
      requestId: request.id,
    };
    return reply.code(404).send({ error: body });
  });

  await registerRoutes(app, deps);

  app.log.info({ config: describeConfig() }, 'Shade API configured');

  return app;
}
