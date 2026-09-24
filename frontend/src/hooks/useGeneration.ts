import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import type { JobStart, Post } from "@/api/types";
import { useSse } from "@/hooks/useSse";

export type GenerationKind = "full" | "text" | "image";

export function useGeneration(onPost: (post: Post) => void) {
  const queryClient = useQueryClient();
  const { start } = useSse();
  const onPostRef = useRef(onPost);
  onPostRef.current = onPost;
  const [liveText, setLiveText] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const [running, setRunning] = useState<GenerationKind | null>(null);
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

  const run = useCallback(
    async (kind: GenerationKind, path: string, body?: unknown) => {
      setError(null);
      setNotice(null);
      setCancelling(false);
      setRunning(kind);
      if (kind !== "image") setLiveText("");
      setProgress(kind === "image" ? { step: 0, total: 0 } : null);
      try {
        const started = await api<JobStart>(path, {
          method: "POST",
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        setJobId(started.jobId);
        start(started.jobId, kind === "text" ? "text" : "image", {
          onToken: (chunk) => {
            if (kind === "image") return;
            setLiveText((current) => (current ?? "") + chunk);
          },
          onText: (text) => {
            if (kind === "image") return;
            setLiveText(text);
          },
          onImageProgress: (step, total) => setProgress({ step, total }),
          onError: (message) => {
            setError(message);
            setCancelling(false);
            setRunning(null);
            setJobId(null);
            setProgress(null);
            void refreshPost(started.postId);
          },
          onCancelled: () => {
            setNotice("Отменено");
            setCancelling(false);
            setRunning(null);
            setJobId(null);
            setProgress(null);
            void refreshPost(started.postId);
          },
          onDone: () => {
            setCancelling(false);
            setRunning(null);
            setJobId(null);
            setProgress(null);
            void refreshPost(started.postId);
          },
        });
      } catch (caught) {
        setCancelling(false);
        setRunning(null);
        setJobId(null);
        setProgress(null);
        setError(errorMessage(caught));
      }
    },
    [refreshPost, start],
  );

  const cancel = useCallback(async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await api(`/generate/posts/${jobId}/cancel`, { method: "POST" });
    } catch (caught) {
      setCancelling(false);
      setError(errorMessage(caught));
    }
  }, [cancelling, jobId]);

  return { liveText, progress, running, jobId, cancelling, notice, error, run, cancel };
}
