import { Injectable } from "@nestjs/common";
import type { SseEvent } from "../ai/sse";

type Listener = (event: SseEvent) => void;

@Injectable()
export class JobHub {
  private readonly buffers = new Map<string, SseEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly enders = new Map<string, Set<() => void>>();
  private readonly closed = new Set<string>();

  open(id: string): void {
    if (!this.buffers.has(id)) this.buffers.set(id, []);
  }

  has(id: string): boolean {
    return this.buffers.has(id) || this.closed.has(id);
  }

  publish(id: string, event: SseEvent): void {
    if (this.closed.has(id)) return;
    const buffer = this.buffers.get(id) ?? [];
    buffer.push(event);
    this.buffers.set(id, buffer);
    for (const listener of this.listeners.get(id) ?? []) {
      try {
        listener(event);
      } catch {
        // subscriber already gone
      }
    }
  }

    close(id: string): void {
    if (this.closed.has(id)) return;
    this.closed.add(id);
    for (const end of this.enders.get(id) ?? []) end();
    this.listeners.delete(id);
    this.enders.delete(id);
    const timer = setTimeout(() => {
      this.buffers.delete(id);
      this.closed.delete(id);
    }, 10 * 60 * 1000);
    timer.unref();
  }

  subscribe(id: string, onEvent: Listener, onEnd: () => void): () => void {
    const listeners = this.listeners.get(id) ?? new Set<Listener>();
    listeners.add(onEvent);
    this.listeners.set(id, listeners);
    const enders = this.enders.get(id) ?? new Set<() => void>();
    enders.add(onEnd);
    this.enders.set(id, enders);
    for (const event of this.buffers.get(id) ?? []) {
      try {
        onEvent(event);
      } catch {
        // subscriber already gone
      }
    }
    if (this.closed.has(id)) {
      listeners.delete(onEvent);
      enders.delete(onEnd);
      onEnd();
      return () => undefined;
    }
    return () => {
      listeners.delete(onEvent);
      enders.delete(onEnd);
    };
  }
}
