import { useCallback, useEffect, useRef } from "react";

export type SseTerminal = "image" | "text";

export type SseCallbacks = {
  onToken: (text: string) => void;
  onText: (text: string) => void;
  onImageProgress: (step: number, total: number) => void;
  onError: (message: string) => void;
  onDone: () => void;
};

export function useSse() {
  const sourceRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (jobId: string, terminal: SseTerminal, callbacks: SseCallbacks) => {
      stop();
      const source = new EventSource(`/generate/posts/${jobId}/events`);
      sourceRef.current = source;
      let settled = false;

      const close = () => {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        close();
        callbacks.onDone();
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        close();
        callbacks.onError(message);
      };

      source.addEventListener("token", (event) => {
        const data = readData(event);
        if (typeof data?.text === "string") callbacks.onToken(data.text);
      });

      source.addEventListener("text_done", (event) => {
        const data = readData(event);
        if (typeof data?.text === "string") callbacks.onText(data.text);
        if (terminal === "text") succeed();
      });

      source.addEventListener("image_progress", (event) => {
        const data = readData(event);
        if (typeof data?.step === "number" && typeof data.total === "number") {
          callbacks.onImageProgress(data.step, data.total);
        }
      });

      source.addEventListener("image_done", () => {
        if (terminal === "image") succeed();
      });

      source.addEventListener("status", (event) => {
        const data = readData(event);
        if (data?.phase === "done") succeed();
      });

      source.addEventListener("error", (event) => {
        if (!(event instanceof MessageEvent)) return;
        const data = readData(event);
        const message = typeof data?.message === "string" ? data.message : "ошибка генерации";
        fail(message);
      });
    },
    [stop],
  );

  return { start, stop };
}

function readData(event: Event): Record<string, unknown> | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  try {
    const value = JSON.parse(event.data) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}
