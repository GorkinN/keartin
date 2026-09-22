import { Global, Module } from "@nestjs/common";
import { PythonClient } from "./python.client";

@Global()
@Module({
  providers: [PythonClient],
  exports: [PythonClient],
})
export class AiModule {}
