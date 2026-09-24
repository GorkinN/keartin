import { Controller, Get } from "@nestjs/common";
import { GenerateService } from "./generate.service";

@Controller()
export class GpuController {
  constructor(private readonly generate: GenerateService) {}

  @Get("gpu/status")
  status() {
    return this.generate.gpuStatus();
  }
}
