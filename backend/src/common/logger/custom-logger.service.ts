import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

@Injectable()
export class CustomLogger extends ConsoleLogger {
  private readonly isProd = process.env.NODE_ENV === 'production';

  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    if (this.isProd) {
      return (
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: logLevel,
          context: this.context ?? contextMessage.replace(/[[\]]/g, '').trim(),
          message,
        }) + '\n'
      );
    }
    return super.formatMessage(
      logLevel,
      message,
      pidMessage,
      formattedLogLevel,
      contextMessage,
      timestampDiff,
    );
  }
}
