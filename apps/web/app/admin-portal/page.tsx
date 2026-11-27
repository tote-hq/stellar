'use client';

import { useEffect, useState, type CSSProperties } from 'react';

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

const HEAD: CSSProperties = {
  position: 'sticky',
  top: 0,
  background: 'var(--surface)',
  textAlign: 'left',
  zIndex: 1,
  padding: '0.5rem 0.75rem',
};

function noteTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return NOTE_TIME.format(date);
}

function statusBorder(readAt: string | null): string {
  return readAt ? '2px solid var(--ok)' : '2px solid var(--chg-sunflower)';
}

// The separate border model does not paint a border set on tr. The same
// status string is drawn on the outer cell edges so the row frame shows.
function cellEdges(border: string, place: 'start' | 'middle' | 'end'): CSSProperties {
  return {
    borderTop: border,
    borderBottom: border,
    borderLeft: place === 'start' ? border : '0',
    borderRight: place === 'end' ? border : '0',
    padding: '0.5rem 0.75rem',
    verticalAlign: 'top',
  };
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
    <main data-testid="admin-notifications" style={{ padding: '1.5rem 2rem', color: 'var(--text)' }}>
      <h1 id="admin-pedidos-title" style={{ margin: '0 0 1rem' }}>Pedidos</h1>
      <div data-testid="admin-notifications-scroll" style={{ overflowY: 'auto', maxHeight: 'calc(100dvh - 8rem)' }}>
        <table
          style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' }}
          aria-labelledby="admin-pedidos-title"
        >
          <thead>
            <tr>
              <th scope="col" style={HEAD}>Estado</th>
              <th scope="col" style={HEAD}>Pedido</th>
              <th scope="col" style={HEAD}>Cliente</th>
              <th scope="col" style={HEAD}>Hora</th>
              <th scope="col" style={HEAD}>Listo</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => {
              const border = statusBorder(note.readAt);
              return (
                <tr key={note.id} data-testid="admin-notification" style={{ border }}>
                  <td style={cellEdges(border, 'start')}>
                    {note.orderId ? <a href={`/orders/${note.orderId}`}>{note.body}</a> : <span>{note.body}</span>}
                  </td>
                  <td
                    data-testid="admin-notification-order"
                    style={{ ...cellEdges(border, 'middle'), overflowWrap: 'anywhere' }}
                  >
                    {note.orderId}
                  </td>
                  <td data-testid="admin-notification-client" style={cellEdges(border, 'middle')}>
                    {note.buyer ? note.buyer : null}
                  </td>
                  <td style={cellEdges(border, 'middle')}>
                    <time data-testid="admin-notification-time" dateTime={note.createdAt}>
                      {noteTime(note.createdAt)}
                    </time>
                  </td>
                  <td style={cellEdges(border, 'end')}>
                    <button
                      type="button"
                      data-testid="admin-notification-read"
                      style={{ minHeight: 44, minWidth: 44 }}
                      aria-pressed={note.readAt !== null}
                      onClick={() => {
                        if (note.readAt !== null) return;
                        void fetch(`/api/admin/notifications/${note.id}/read`, {
                          method: 'POST',
                          headers: { 'x-csrf-token': csrf },
                        })
                          .then((res) => {
                            if (!res.ok) return;
                            setNotes((current) =>
                              current.map((row) =>
                                row.id === note.id ? { ...row, readAt: new Date().toISOString() } : row,
                              ),
                            );
                          })
                          .catch(() => undefined);
                      }}
                    >
                      Listo
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
