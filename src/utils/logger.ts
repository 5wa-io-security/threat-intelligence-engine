/**
 * Simple structured logger for the Threat Intelligence Engine.
 * Outputs JSON-formatted log lines for easy parsing in CI/CD environments.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, module: string, message: string, meta?: Record<string, unknown>): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    module,
    message,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  };
  return JSON.stringify(entry);
}

export function createLogger(module: string) {
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        console.log(formatMessage('debug', module, message, meta));
      }
    },

    info(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('info')) {
        console.log(formatMessage('info', module, message, meta));
      }
    },

    warn(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', module, message, meta));
      }
    },

    error(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('error')) {
        console.error(formatMessage('error', module, message, meta));
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
