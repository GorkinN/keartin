import { ConsoleLogger, type LogLevel } from "@nestjs/common";

export class JsonLogger extends ConsoleLogger {
  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    _pidMessage: string,
    _formattedLogLevel: string,
    contextMessage: string,
    _timestampDiff: string,
  ): string {
    const logger = contextMessage.replace(/[[\]]/g, "").trim() || "nest";
    const payload = {
      ts: new Date().toISOString(),
      level: logLevel,
      logger,
      msg: typeof message === "string" ? message : JSON.stringify(message),
    };
    return `${JSON.stringify(payload)}\n`;
  }
}
