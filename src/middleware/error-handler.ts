import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { ApiError, isApiError, validationFailed } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Tags every request with an id, so a client error report and a server log
 * line can be tied to the same request without guessing from timestamps.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new ApiError(404, 'not_found', `No route matches ${req.method} ${req.path}.`, {
      details: { method: req.method, path: req.path },
    }),
  );
}

/**
 * The single place an error becomes a response. Everything above it throws;
 * nothing above it writes a status code.
 *
 * Express identifies error middleware by arity, so all four parameters are
 * required even though `next` is unused — dropping it would silently turn this
 * into ordinary middleware that never runs.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    // The response is already streaming; the only honest thing left is to stop.
    logger.error('Error raised after headers were sent', {
      requestId: res.locals.requestId,
      path: req.path,
      method: req.method,
      error,
    });
    next(error);
    return;
  }

  const requestId = (res.locals.requestId as string | undefined) ?? 'unknown';
  const context = { requestId, path: req.path, method: req.method };

  // A validation failure is the caller's problem and safe to describe fully.
  if (error instanceof ZodError) {
    const apiError = validationFailed(
      error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
        code: issue.code,
      })),
    );
    res.status(apiError.status).json({
      error: { code: apiError.code, message: apiError.message, details: apiError.details },
    });
    return;
  }

  if (isApiError(error)) {
    // 5xx is our fault and gets logged with a stack; 4xx is the caller's and
    // does not, so a scanner probing for free accounts cannot flood the log.
    if (error.status >= 500) {
      logger.error(error.message, { ...context, error, code: error.code });
    } else {
      logger.debug(error.message, { ...context, code: error.code });
    }

    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  // Anything unrecognised is a bug. The cause goes to the log; the caller gets
  // a request id and nothing else, because the cause may carry internals.
  logger.error('Unhandled error', { ...context, error });

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred.',
      requestId,
    },
  });
}
