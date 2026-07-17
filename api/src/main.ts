// Load .env before anything else reads process.env
// (JWT_SECRET, SMS_ENABLED, TWILIO_*, ...).
import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // In production set CORS_ORIGIN to a comma-separated list of allowed
  // origins (e.g. "https://attendance.marfields.com"). When unset (local
  // development), all origins are allowed as before.
  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((o) => o.trim())
      : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Azure App Service injects PORT; default 3000 locally.
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();