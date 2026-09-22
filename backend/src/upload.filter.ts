import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { MulterError } from "multer";

@Catch(MulterError)
export class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const message =
      exception.code === "LIMIT_FILE_SIZE" ? "файл больше 200 МБ" : exception.message;
    response.status(400).json({ statusCode: 400, message, error: "Bad Request" });
  }
}
