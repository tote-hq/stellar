'use client';

import { useEffect, useState } from 'react';

interface Note {
  id: string;
  kind: string;
  orderId: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
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
          <li key={note.id}>
            <a href={`/orders/${note.orderId ?? ''}`}>{note.body}</a>
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
