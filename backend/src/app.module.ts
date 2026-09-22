import { Module } from "@nestjs/common";
import { AiModule } from "./ai/ai.module";
import { GenerateModule } from "./generate/generate.module";
import { HealthModule } from "./health/health.module";
import { LibraryModule } from "./library/library.module";
import { PostsModule } from "./posts/posts.module";
import { PresetsModule } from "./presets/presets.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RecoveryService } from "./recovery.service";
import { StorageModule } from "./storage/storage.module";

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AiModule,
    HealthModule,
    LibraryModule,
    PresetsModule,
    GenerateModule,
    PostsModule,
  ],
  providers: [RecoveryService],
})
export class AppModule {}
