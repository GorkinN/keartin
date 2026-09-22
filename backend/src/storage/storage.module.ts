import { Global, Injectable, Module, OnModuleInit } from "@nestjs/common";
import { AppEnv } from "../config/env";
import { LocalFsProvider } from "./local-fs.provider";
import { S3Provider } from "./s3.provider";
import { StorageProvider } from "./storage.provider";

@Injectable()
class StorageInit implements OnModuleInit {
  constructor(private readonly storage: StorageProvider) {}

  async onModuleInit(): Promise<void> {
    await this.storage.init();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: StorageProvider,
      useFactory: (env: AppEnv) =>
        env.storageDriver === "s3" ? new S3Provider(env) : new LocalFsProvider(env),
      inject: [AppEnv],
    },
    StorageInit,
  ],
  exports: [StorageProvider],
})
export class StorageModule {}
