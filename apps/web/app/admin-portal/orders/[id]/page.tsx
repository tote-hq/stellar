'use client';

import { use, useEffect, useState } from 'react';

export default function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [csrf, setCsrf] = useState('');
  const [label, setLabel] = useState('');
  const [viewer, setViewer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/admin/session', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { csrf?: string } | null) => {
        if (body?.csrf) setCsrf(body.csrf);
      });
  }, []);

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
        onClick={() => {
          void fetch(`/api/admin/orders/${id}/viewer`, { cache: 'no-store' })
            .then((res) => (res.ok ? res.json() : null))
            .then((body: { url?: string | null } | null) => {
              setViewer(body?.url ?? null);
              if (body?.url) {
                const link = document.createElement('a');
                link.href = body.url;
                link.target = '_blank';
                link.rel = 'noopener';
                link.click();
              }
            });
        }}
      >
        Abrir la pantalla
      </button>
      {viewer ? null : <p>La pantalla solo se abre mientras la firma sigue adentro de 60 segundos.</p>}
    </main>
  );
}
