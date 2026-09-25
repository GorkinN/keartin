import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import type { JobStart, Post, QueueItem } from "@/api/types";
import { useSse, type SseCallbacks } from "@/hooks/useSse";

export type GenerationKind = "full" | "text" | "image";

export function useGeneration(onPost: (post: Post) => void) {
  const queryClient = useQueryClient();
  const { start } = useSse();
  const onPostRef = useRef(onPost);
  onPostRef.current = onPost;
  const watchedRef = useRef<string | null>(null);
  const [liveText, setLiveText] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const [running, setRunning] = useState<GenerationKind | null>(null);
  const [queued, setQueued] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshPost = useCallback(
    async (postId: string) => {
      try {
        const next = await api<Post>(`/posts/${postId}`);
        setLiveText(null);
        onPostRef.current(next);
        await queryClient.invalidateQueries({ queryKey: ["posts"] });
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [queryClient],
  );

  const finish = useCallback(() => {
    setCancelling(false);
    setQueued(false);
    setRunning(null);
    setJobId(null);
    setProgress(null);
    void queryClient.invalidateQueries({ queryKey: ["generate-queue"] });
  }, [queryClient]);

  const bind = useCallback(
    (nextJobId: string, postId: string, kind: GenerationKind) => {
      const callbacks: SseCallbacks = {
        onToken: (chunk) => {
          setQueued(false);
          setNotice(null);
          if (kind === "image") return;
          setLiveText((current) => (current ?? "") + chunk);
        },
        onText: (text) => {
          setQueued(false);
          if (kind === "image") return;
          setLiveText(text);
        },
        onImageProgress: (step, total) => {
          setQueued(false);
          setProgress({ step, total });
        },
        onQueued: () => {
          setQueued(true);
          setNotice("В очереди");
        },
        onError: (message) => {
          setError(message);
          finish();
          void refreshPost(postId);
        },
        onCancelled: () => {
          setNotice("Отменено");
          finish();
          void refreshPost(postId);
        },
        onDone: () => {
          finish();
          void refreshPost(postId);
        },
      };
      start(nextJobId, kind === "text" ? "text" : "image", callbacks);
    },
    [finish, refreshPost, start],
  );

  const begin = useCallback((kind: GenerationKind, nextJobId: string) => {
    setError(null);
    setNotice(null);
    setCancelling(false);
    setQueued(false);
    setRunning(kind);
    setJobId(nextJobId);
    if (kind !== "image") setLiveText("");
    setProgress(kind === "image" ? { step: 0, total: 0 } : null);
  }, []);

  const watch = useCallback(
    (item: QueueItem) => {
      if (watchedRef.current === item.jobId) return;
      watchedRef.current = item.jobId;
      begin(item.kind, item.jobId);
      void api<Post>(`/posts/${item.postId}`)
        .then((next) => onPostRef.current(next))
        .catch((caught: unknown) => setError(errorMessage(caught)));
      bind(item.jobId, item.postId, item.kind);
    },
    [begin, bind],
  );

  const run = useCallback(
    async (kind: GenerationKind, path: string, body?: unknown) => {
      begin(kind, "");
      try {
        const started = await api<JobStart>(path, {
          method: "POST",
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        watchedRef.current = started.jobId;
        setJobId(started.jobId);
        bind(started.jobId, started.postId, kind);
      } catch (caught) {
        watchedRef.current = null;
        setCancelling(false);
        setQueued(false);
        setRunning(null);
        setJobId(null);
        setProgress(null);
        setError(errorMessage(caught));
      }
    },
    [begin, bind],
  );

  const cancel = useCallback(async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      if (queued) {
        await api(`/generate/queue/${jobId}`, { method: "DELETE" });
      } else {
        await api(`/generate/posts/${jobId}/cancel`, { method: "POST" });
      }
    } catch (caught) {
      setCancelling(false);
      setError(errorMessage(caught));
    }
  }, [cancelling, jobId, queued]);

  return { liveText, progress, running, queued, jobId, cancelling, notice, error, run, watch, cancel };
}
