import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type ImageProgress = { index: number; step: number; total: number };

function readData(event: Event): Record<string, unknown> | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  try {
    const value = JSON.parse(event.data) as unknown;
    if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

export function useImageJob() {
  const queryClient = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);
  const watchedRef = useRef<string | null>(null);
  const [progress, setProgress] = useState<ImageProgress | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["image-batches"] });
    void queryClient.invalidateQueries({ queryKey: ["image-queue"] });
  }, [queryClient]);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const watch = useCallback(
    (jobId: string) => {
      if (watchedRef.current === jobId && sourceRef.current) return;
      watchedRef.current = jobId;
      stop();
      setError(null);
      setNotice(null);
      setProgress(null);
      setPhase(null);
      const source = new EventSource(`/images/jobs/${jobId}/events`);
      sourceRef.current = source;
      let settled = false;

      const close = () => {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
      };

      const finish = (nextNotice: string | null) => {
        if (settled) return;
        settled = true;
        close();
        setProgress(null);
        setPhase(null);
        setNotice(nextNotice);
        refresh();
      };

      source.addEventListener("image_progress", (event) => {
        const data = readData(event);
        if (typeof data?.index === "number" && typeof data.step === "number" && typeof data.total === "number") {
          setNotice(null);
          setPhase("generate");
          setProgress({ index: data.index, step: data.step, total: data.total });
        }
      });

      source.addEventListener("image_done", () => {
        setProgress(null);
        refresh();
      });

      source.addEventListener("status", (event) => {
        const data = readData(event);
        const next = typeof data?.phase === "string" ? data.phase : null;
        if (next === "queued") setNotice("В очереди");
        else if (next === "done") finish(null);
        else if (next) setPhase(next);
      });

      source.addEventListener("done", () => finish(null));

      source.addEventListener("cancelled", (event) => {
        const data = readData(event);
        const message = typeof data?.message === "string" ? data.message : "отменено";
        finish(message);
      });

      source.addEventListener("error", (event) => {
        if (!(event instanceof MessageEvent)) return;
        const data = readData(event);
        const message = typeof data?.message === "string" ? data.message : "ошибка генерации";
        if (settled) return;
        settled = true;
        close();
        setProgress(null);
        setPhase(null);
        setError(message);
        refresh();
      });
    },
    [refresh, stop],
  );

  return { watch, progress, phase, error, notice };
}
