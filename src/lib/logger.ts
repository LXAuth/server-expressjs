import { config } from '../config.js';

/**
 * Structured logger. One JSON object per line, so a log shipper can index the
 * fields without regex-parsing prose. A human-readable line in a log that is
 * meant to be queried is a field that cannot be aggregated.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const threshold = LEVEL_ORDER[config.log.level as LogLevel] ?? LEVEL_ORDER.info;

export interface LogFields {
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < threshold) return;

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    env: config.env,
    message,
  };

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      // An Error serialises to {} otherwise, which loses the message that
      // mattered. Prefer the parts a query can filter on.
      if (value instanceof Error) {
        entry[key] = {
          name: value.name,
          message: value.message,
          ...(config.prod ? {} : { stack: value.stack }),
        };
      } else {
        entry[key] = value;
      }
    }
  }

  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
