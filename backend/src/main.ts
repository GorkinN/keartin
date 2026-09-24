import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import type { Server } from "node:http";
import { ignoreLocalProxy } from "./config/env";
import { JsonLogger } from "./logging";
import { UploadExceptionFilter } from "./upload.filter";

loadDotenv({ path: resolve(__dirname, "../../.env") });
ignoreLocalProxy();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.useGlobalFilters(new UploadExceptionFilter());
  app.enableShutdownHooks();
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 0;
  const port = Number(process.env.NEST_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
