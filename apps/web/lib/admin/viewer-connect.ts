/** What the admin page posts into the Coto viewer frame. The origin is never '*'. */

export interface ViewerConnect {
  origin: string;
  message: {
    type: 'changuito-viewer-connect';
    jobId: string;
    ticket: string;
    lang: 'es';
  };
}

export function viewerConnectMessage(url: string, jobId: string, ticket: string): ViewerConnect {
  const origin = new URL(url).origin;
  return {
    origin,
    message: { type: 'changuito-viewer-connect', jobId, ticket, lang: 'es' },
  };
}

export function viewerReadyFromFrame(
  event: { source: unknown; origin: string; data?: { type?: unknown } | null },
  frameWindow: unknown,
  viewerUrl: string,
): boolean {
  if (frameWindow == null) return false;
  let origin = '';
  try {
    origin = new URL(viewerUrl).origin;
  } catch {
    return false;
  }
  return event.source === frameWindow && event.origin === origin && event.data?.type === 'changuito-viewer-ready';
}

export type AdminViewerReason = 'closed' | 'unreachable';

export function adminViewerBody(
  viewer: { url: string; ticket: string; jobId: string } | null,
  reason?: AdminViewerReason,
): { url: null; reason?: AdminViewerReason } | { url: string; ticket: string; jobId: string } {
  if (!viewer) return reason ? { url: null, reason } : { url: null };
  return { url: viewer.url, ticket: viewer.ticket, jobId: viewer.jobId };
}
