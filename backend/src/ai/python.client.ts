import { Injectable, Logger } from "@nestjs/common";
import { AppEnv } from "../config/env";
import { consumeSse, flushSse, type SseEvent } from "./sse";

export class PythonRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export type IndexAccepted = {
  job_id: string;
  book_id: string;
  status: string;
};

export type GpuStatus = {
  locked: boolean;
  tenant: string | null;
  ollama_models: string[];
  vram_used_mb: number | null;
};

export type IndexStatus = {
  job_id: string;
  book_id: string;
  status: string;
  source_name: string;
  chunks_total: number;
  chunks_done: number;
  error: string | null;
};

@Injectable()
export class PythonClient {
  private readonly logger = new Logger(PythonClient.name);

  constructor(private readonly env: AppEnv) {}

  async reachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.env.aiServiceUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async indexBook(path: string, bookId: string, sourceName: string): Promise<IndexAccepted> {
    return this.json<IndexAccepted>("/rag/index", {
      method: "POST",
      body: { path, book_id: bookId, source_name: sourceName },
      timeoutMs: 30_000,
    });
  }

  async indexStatus(jobId: string): Promise<IndexStatus | null> {
    const response = await this.request(`/rag/index/${encodeURIComponent(jobId)}`, {
      method: "GET",
      timeoutMs: 10_000,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new PythonRequestError(await readError(response), response.status);
    }
    return (await response.json()) as IndexStatus;
  }

  async gpuStatus(): Promise<GpuStatus> {
    return this.json<GpuStatus>("/gpu/status", { method: "GET", timeoutMs: 10_000 });
  }

  async cancelPipeline(jobId: string): Promise<void> {
    await this.json(`/pipeline/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      timeoutMs: 10_000,
    });
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.json(`/rag/books/${encodeURIComponent(bookId)}`, {
      method: "DELETE",
      timeoutMs: 30_000,
    });
  }

  async stream(
    path: string,
    body: unknown,
    onEvent: (event: SseEvent) => Promise<void>,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.env.aiServiceUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed";
      throw new PythonRequestError(`AI-сервис недоступен: ${message}`, 502);
    }
    if (!response.ok) {
      throw new PythonRequestError(await readError(response), response.status);
    }
    if (!response.body) {
      throw new PythonRequestError("пустой поток AI-сервиса", 502);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const parsed = consumeSse(pending);
      pending = parsed.rest;
      for (const event of parsed.events) {
        await onEvent(event);
      }
    }
    pending += decoder.decode();
    for (const event of flushSse(pending)) {
      await onEvent(event);
    }
  }

  private async json<T>(
    path: string,
    options: { method: string; body?: unknown; timeoutMs: number },
  ): Promise<T> {
    const response = await this.request(path, options);
    if (!response.ok) {
      throw new PythonRequestError(await readError(response), response.status);
    }
    return (await response.json()) as T;
  }

  private async request(
    path: string,
    options: { method: string; body?: unknown; timeoutMs: number },
  ): Promise<Response> {
    try {
      return await fetch(`${this.env.aiServiceUrl}${path}`, {
        method: options.method,
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed";
      this.logger.warn(`${options.method} ${path} failed: ${message}`);
      throw new PythonRequestError("AI-сервис недоступен", 502);
    }
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
    if (body.detail !== undefined) return JSON.stringify(body.detail);
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  } catch {
    return text || response.statusText;
  }
  return text || response.statusText;
}
