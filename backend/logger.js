import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';

const logDir = path.resolve(process.cwd(), 'logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const isCloudEnvironment = Boolean(process.env.VERCEL || process.env.RENDER);
const useFileLogs = !isCloudEnvironment && process.env.NODE_ENV !== 'production';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const extra = Object.keys(meta).length ? JSON.stringify(meta) : '';
      const stackText = stack ? `\n${stack}` : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${stackText}${extra ? ` ${extra}` : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    ...(useFileLogs ? [
      new winston.transports.File({ filename: path.join(logDir, 'app.log') }),
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
      }),
    ] : []),
  ],
});

export default logger;
