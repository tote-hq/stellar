'use client';

import { useEffect, useState } from 'react';

interface Note {
  id: string;
  kind: string;
  orderId: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
  buyer?: string | null;
}

const NOTE_TIME = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function noteTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return NOTE_TIME.format(date);
}

export default function AdminDesk() {
  const [csrf, setCsrf] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      const session = await fetch('/api/admin/session', { cache: 'no-store' });
      if (!session.ok) return;
      const token = (await session.json()) as { csrf?: string };
      if (!stop && token.csrf) setCsrf(token.csrf);
      const res = await fetch('/api/admin/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { notifications?: Note[] };
      if (!stop) setNotes(body.notifications ?? []);
    };
    void pull();
    const timer = setInterval(() => void pull(), 3000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main data-testid="admin-notifications" style={{ maxWidth: 40 * 16, margin: '2rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Pedidos</h1>
      <ul>
        {notes.map((note) => (
          <li key={note.id} data-testid="admin-notification" style={{ margin: '0 0 1rem', color: 'inherit' }}>
            {note.orderId ? <a href={`/orders/${note.orderId}`}>{note.body}</a> : <span>{note.body}</span>}
            {note.orderId ? (
              <p
                data-testid="admin-notification-order"
                style={{ fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere', margin: '0.25rem 0' }}
              >
                Pedido {note.orderId}
              </p>
            ) : null}
            {note.buyer ? (
              <p data-testid="admin-notification-client" style={{ margin: '0.25rem 0' }}>
                Cliente {note.buyer}
              </p>
            ) : null}
            <time data-testid="admin-notification-time" dateTime={note.createdAt} style={{ display: 'block' }}>
              {noteTime(note.createdAt)}
            </time>
            {note.readAt ? null : (
              <button
                type="button"
                data-testid="admin-notification-read"
                style={{ minHeight: 44, minWidth: 44 }}
                onClick={() => {
                  void fetch(`/api/admin/notifications/${note.id}/read`, {
                    method: 'POST',
                    headers: { 'x-csrf-token': csrf },
                  });
                }}
              >
                Listo
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
