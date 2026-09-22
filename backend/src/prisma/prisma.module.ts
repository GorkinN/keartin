import { Global, Module } from "@nestjs/common";
import { AppEnv } from "../config/env";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [AppEnv, PrismaService],
  exports: [AppEnv, PrismaService],
})
export class PrismaModule {}
