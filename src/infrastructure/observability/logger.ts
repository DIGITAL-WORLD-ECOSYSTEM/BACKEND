export class Logger {
  private readonly context: string;

  constructor(context: string) {
    this.context = context;
  }

  info(message: string, meta?: Record<string, any>) {
    this.log('INFO', message, meta);
  }

  warn(message: string, meta?: Record<string, any>) {
    this.log('WARN', message, meta);
  }

  error(message: string, error?: any, meta?: Record<string, any>) {
    const errorDetails =
      error instanceof Error ? { message: error.message, stack: error.stack } : error;
    this.log('ERROR', message, { ...meta, error: errorDetails });
  }

  private log(level: string, message: string, meta?: Record<string, any>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...meta,
    };
    console.log(JSON.stringify(logEntry));
  }
}
