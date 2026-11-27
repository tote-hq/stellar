'use client';

import { use, useEffect, useRef, useState } from 'react';

import { viewerConnectMessage, viewerReadyFromFrame } from '../../../../lib/admin/viewer-connect.ts';

/** A little longer than the server's viewer fetch, so a slow sandbox still answers. */
const VIEWER_OPEN_MS = 8_000;

function viewerNote(reason: string | undefined, failed: boolean): string {
  if (!failed && reason === 'closed') return 'La pantalla ya no está abierta.';
  return 'La pantalla no respondió. Probá de nuevo.';
}

export default function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [csrf, setCsrf] = useState('');
  const [label, setLabel] = useState('');
  const [src, setSrc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [screenNote, setScreenNote] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef<{ url: string; jobId: string; ticket: string } | null>(null);

  useEffect(() => {
    void fetch('/api/admin/session', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { csrf?: string } | null) => {
        if (body?.csrf) setCsrf(body.csrf);
      });
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const waiting = pending.current;
      if (!waiting) return;
      if (!viewerReadyFromFrame(event, frame.current?.contentWindow ?? null, waiting.url)) return;
      const { origin, message } = viewerConnectMessage(waiting.url, waiting.jobId, waiting.ticket);
      frame.current?.contentWindow?.postMessage(message, origin);
      pending.current = null;
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function openViewer() {
    setScreenNote(null);
    void fetch(`/api/admin/orders/${id}/viewer`, { cache: 'no-store', signal: AbortSignal.timeout(VIEWER_OPEN_MS) })
      .then(async (res) => {
        if (!res.ok) return { failed: true as const, body: null };
        const body = (await res.json()) as { url?: string | null; ticket?: string; jobId?: string; reason?: string };
        return { failed: false as const, body };
      })
      .then((got) => {
        const body = got.body;
        if (got.failed || !body?.url || !body.ticket || !body.jobId) {
          pending.current = null;
          setSrc('');
          setScreenNote(viewerNote(body?.reason, got.failed));
          return;
        }
        setScreenNote(null);
        const next = { url: body.url, jobId: body.jobId, ticket: body.ticket };
        const live = frame.current?.contentWindow;
        if (src && src === body.url && live && pending.current === null) {
          const { origin, message } = viewerConnectMessage(body.url, body.jobId, body.ticket);
          live.postMessage(message, origin);
          return;
        }
        pending.current = next;
        if (src !== body.url) setSrc(body.url);
      })
      .catch(() => {
        pending.current = null;
        setSrc('');
        setScreenNote('La pantalla no respondió. Probá de nuevo.');
      });
  }

  return (
    <main data-testid="admin-order" style={{ maxWidth: 40 * 16, margin: '2rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Pedido</h1>
      <p>{id}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void fetch(`/api/admin/orders/${id}/prompt`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify({ label }),
          }).then(async (res) => {
            if (res.status === 409) setError('Ya hay una pregunta pendiente.');
            else if (!res.ok) setError('No pudimos enviar la pregunta.');
            else setLabel('');
          });
        }}
      >
        <label htmlFor="admin-ask">Pregunta</label>
        <input
          id="admin-ask"
          data-testid="admin-request-field"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          style={{ minHeight: 44 }}
        />
        <button type="submit" style={{ minHeight: 44, minWidth: 44 }}>
          Enviar pregunta
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        data-testid="admin-open-viewer"
        style={{ minHeight: 44, minWidth: 44 }}
        onClick={openViewer}
      >
        Abrir la pantalla
      </button>
      {screenNote ? (
        <p role="status" data-testid="admin-viewer-status">
          {screenNote}
        </p>
      ) : null}
      {src ? (
        <iframe
          ref={frame}
          src={src}
          title="Pantalla de Coto"
          data-testid="admin-coto-viewer"
          referrerPolicy="origin"
          sandbox="allow-scripts allow-same-origin"
          style={{ width: '100%', height: 'min(70dvh, 760px)', minHeight: 380, border: '1px solid #64748b' }}
        />
      ) : (
        <p>La pantalla solo se abre mientras la firma sigue adentro de 60 segundos.</p>
      )}
    </main>
  );
}
