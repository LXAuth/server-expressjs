import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { logger } from './logger.js';

/**
 * The Prisma client, as a singleton.
 *
 * A client per request would open a new connection pool per request, and the
 * pool would only close when the garbage collector got around to it — which in
 * dev is often never, and in production exhausts the database's connection
 * limit. One client for the process, closed explicitly at shutdown.
 */

const globalForPrisma = globalThis as unknown as {
  lxauthPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.lxauthPrisma ??
  new PrismaClient({
    log:
      config.prod
        ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
  });

prisma.$on('warn' as never, (event: { message: string }) => {
  logger.warn('Prisma warning', { message: event.message });
});

prisma.$on('error' as never, (event: { message: string }) => {
  logger.error('Prisma error', { message: event.message });
});

if (!config.prod) {
  // `tsx watch` re-evaluates this module on every save. Without the global, each
  // reload would add another client and another pool until dev ran out of
  // connections.
  globalForPrisma.lxauthPrisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Turns a Prisma error into the shape the error handler understands, so a
 * unique-constraint violation surfaces as a 409 rather than a 500.
 *
 * `P2002` is a unique violation, `P2025` is "record required but not found",
 * `P2003` is a foreign key violation. Prisma error codes are stable across
 * versions, which is why this matches on them rather than on message text.
 */
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export const PRISMA_ERRORS = {
  uniqueViolation: 'P2002',
  recordNotFound: 'P2025',
  foreignKeyViolation: 'P2003',
} as const;
