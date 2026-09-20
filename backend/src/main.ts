import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(__dirname, "../../.env") });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.NEST_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
