/**
 * Binds the Worker execution context to the request so a stats refresh can
 * outlive the response via waitUntil. Absent on `next dev`; the refresh
 * still starts, and the isolate keeps it only as long as the request does.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

const storage = new AsyncLocalStorage<WaitUntil>();

function readWaitUntil(ctx: unknown): WaitUntil['waitUntil'] | null {
  if (!ctx || typeof ctx !== 'object' || !('waitUntil' in ctx)) return null;
  const method = (ctx as { waitUntil?: unknown }).waitUntil;
  if (typeof method !== 'function') return null;
  return (promise) => {
    method.call(ctx, promise);
  };
}

export function runWithStatsContext<T>(ctx: unknown, fn: () => T): T {
  const waitUntil = readWaitUntil(ctx);
  if (!waitUntil) return fn();
  return storage.run({ waitUntil }, fn);
}

/** Schedule work that must not block the response. Failures are logged, not thrown. */
export function deferStatsWork(work: Promise<unknown>): void {
  const guarded = work.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('[stats] background work failed:', message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 80));
  });
  const ctx = storage.getStore();
  if (ctx) ctx.waitUntil(guarded);
}
