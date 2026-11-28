'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

type Source = 'mock' | 'circle';
type Key = 'usdc_source_guest' | 'usdc_source_signed_in';

interface Row {
  value: unknown;
  updatedAt: string;
}

interface Payload {
  usdc_source_guest: Row | null;
  usdc_source_signed_in: Row | null;
}

type Phase = 'loading' | 'ready' | 'error';

interface Card {
  phase: Phase;
  saved: Source;
  draft: Source;
  updatedAt: string | null;
  saving: boolean;
  flash: boolean;
  writeError: boolean;
}

const WHEN = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const TARGET: CSSProperties = { minHeight: 44, minWidth: 44 };
const ROW: CSSProperties = {
  ...TARGET,
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  cursor: 'pointer',
};

function asSource(value: unknown): Source {
  return value === 'circle' ? 'circle' : 'mock';
}

function loadingCard(): Card {
  return { phase: 'loading', saved: 'mock', draft: 'mock', updatedAt: null, saving: false, flash: false, writeError: false };
}

function errorCard(): Card {
  return { phase: 'error', saved: 'mock', draft: 'mock', updatedAt: null, saving: false, flash: false, writeError: false };
}

function cardFrom(row: Row | null): Card {
  return {
    phase: 'ready',
    saved: asSource(row?.value),
    draft: asSource(row?.value),
    updatedAt: row?.updatedAt ?? null,
    saving: false,
    flash: false,
    writeError: false,
  };
}

function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return WHEN.format(date);
}

export default function UsdcSourcePage() {
  const [csrf, setCsrf] = useState('');
  const [expired, setExpired] = useState(false);
  const [guest, setGuest] = useState<Card>(loadingCard);
  const [signedIn, setSignedIn] = useState<Card>(loadingCard);

  const load = useCallback(async () => {
    setGuest(loadingCard());
    setSignedIn(loadingCard());
    const session = await fetch('/api/admin/session', { cache: 'no-store' });
    if (session.status === 401) {
      setExpired(true);
      return;
    }
    if (!session.ok) {
      setGuest(errorCard());
      setSignedIn(errorCard());
      return;
    }
    const token = (await session.json()) as { csrf?: string };
    if (token.csrf) setCsrf(token.csrf);
    const res = await fetch('/api/admin/usdc-source', { cache: 'no-store' });
    if (res.status === 401) {
      setExpired(true);
      return;
    }
    if (!res.ok) {
      setGuest(errorCard());
      setSignedIn(errorCard());
      return;
    }
    const body = (await res.json()) as Payload;
    setExpired(false);
    setGuest(cardFrom(body.usdc_source_guest));
    setSignedIn(cardFrom(body.usdc_source_signed_in));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(key: Key) {
    const current = key === 'usdc_source_guest' ? guest : signedIn;
    const set = key === 'usdc_source_guest' ? setGuest : setSignedIn;
    if (current.phase !== 'ready' || current.draft === current.saved || current.saving) return;
    set((card) => ({ ...card, saving: true, writeError: false, flash: false }));
    const res = await fetch('/api/admin/usdc-source', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ key, value: current.draft }),
    });
    if (res.status === 401) {
      setExpired(true);
      set((card) => ({ ...card, saving: false }));
      return;
    }
    if (!res.ok) {
      set((card) => ({ ...card, saving: false, writeError: true, flash: false }));
      return;
    }
    const body = (await res.json()) as { updatedAt?: string; value?: unknown };
    set((card) => ({
      ...card,
      saving: false,
      writeError: false,
      flash: true,
      saved: asSource(body.value),
      draft: asSource(body.value),
      updatedAt: body.updatedAt ?? card.updatedAt,
    }));
  }

  return (
    <main
      data-testid="admin-usdc"
      style={{
        padding: '1.5rem 2rem',
        color: 'var(--chg-espresso)',
        background: 'var(--chg-offwhite)',
        minHeight: '100dvh',
        colorScheme: 'light',
      }}
    >
      <header style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', margin: '0 0 1.5rem' }}>
        <a href="/orders" style={{ ...TARGET, display: 'inline-flex', alignItems: 'center' }}>
          Pedidos
        </a>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Moneda de prueba</h1>
      </header>

      <p style={{ margin: '0 0 0.25rem' }}>Elegí qué USDC ve cada tipo de sesión en testnet.</p>
      <p style={{ margin: '0 0 1.5rem' }}>El pago sigue usando el USDC de prueba de changuito.</p>

      {expired ? (
        <p role="alert" style={{ color: 'var(--warn-ink)' }}>
          Tu sesión de operador venció.{' '}
          <a href="/" style={{ ...TARGET, display: 'inline-flex', alignItems: 'center' }}>
            Volvé a entrar
          </a>
        </p>
      ) : (
        <>
      <SourceCard
        legend="Sesión sin iniciar"
        name="usdc-guest"
        testId="admin-usdc-guest"
        card={guest}
        onDraft={(draft) => setGuest((card) => ({ ...card, draft, flash: false }))}
        onSave={() => void save('usdc_source_guest')}
        onRetry={() => void load()}
      />
      <SourceCard
        legend="Sesión iniciada"
        name="usdc-signed-in"
        testId="admin-usdc-signed-in"
        card={signedIn}
        onDraft={(draft) => setSignedIn((card) => ({ ...card, draft, flash: false }))}
        onSave={() => void save('usdc_source_signed_in')}
        onRetry={() => void load()}
      />
        </>
      )}
    </main>
  );
}

function SourceCard({
  legend,
  name,
  testId,
  card,
  onDraft,
  onSave,
  onRetry,
}: {
  legend: string;
  name: string;
  testId: string;
  card: Card;
  onDraft: (source: Source) => void;
  onSave: () => void;
  onRetry: () => void;
}) {
  const dirty = card.phase === 'ready' && card.draft !== card.saved;
  const canSave = dirty && !card.saving;
  return (
    <fieldset
      data-testid={testId}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 14,
        background: '#fff',
        padding: '1rem 1.25rem',
        margin: '0 0 1rem',
      }}
    >
      <legend style={{ fontWeight: 700, padding: '0 0.25rem' }}>{legend}</legend>
      {card.phase === 'loading' ? (
        <p data-testid={`${testId}-loading`}>Cargando…</p>
      ) : card.phase === 'error' ? (
        <p role="alert" data-testid={`${testId}-error`} style={{ color: 'var(--warn-ink)' }}>
          No se pudo leer la configuración. Se usa el USDC de prueba.{' '}
          <button type="button" data-testid={`${testId}-retry`} style={TARGET} onClick={onRetry}>
            Reintentar
          </button>
        </p>
      ) : (
        <>
      <label style={ROW}>
        <input
          type="radio"
          name={name}
          value="mock"
          checked={card.draft === 'mock'}
          onChange={() => onDraft('mock')}
        />
        <span>USDC de prueba (changuito)</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>predeterminado</span>
      </label>
      <label style={ROW}>
        <input
          type="radio"
          name={name}
          value="circle"
          checked={card.draft === 'circle'}
          aria-describedby={`${testId}-mismatch`}
          onChange={() => onDraft('circle')}
        />
        <span>USDC de testnet de Circle</span>
      </label>
      <p id={`${testId}-mismatch`} style={{ margin: '0.25rem 0 1rem', color: 'var(--warn-ink)' }}>
        El saldo muestra USDC de Circle, pero el pago todavía usa el USDC de prueba.
      </p>
        </>
      )}
      <button
        type="button"
        data-testid={`${testId}-save`}
        disabled={!canSave}
        onClick={onSave}
        style={{
          ...TARGET,
          padding: '0 1rem',
          border: 0,
          borderRadius: 8,
          background: 'var(--chg-sunflower)',
          color: 'var(--chg-espresso)',
          font: 'inherit',
          fontWeight: 700,
          cursor: canSave ? 'pointer' : 'default',
        }}
      >
        {card.saving ? 'Guardando…' : 'Guardar'}
      </button>
      {card.flash ? (
        <p role="status" style={{ color: 'var(--ok)', margin: '0.75rem 0 0' }}>
          Guardado. Las sesiones nuevas lo ven en unos 15 segundos.
        </p>
      ) : null}
      {card.writeError ? (
        <p role="alert" style={{ color: 'var(--warn-ink)', margin: '0.75rem 0 0' }}>
          No se guardó. El valor anterior sigue activo.
        </p>
      ) : null}
      {card.phase === 'ready' && card.saved === 'mock' && !dirty ? (
        <p style={{ margin: '0.75rem 0 0', color: 'var(--muted)' }}>Sin cambios: usa el predeterminado</p>
      ) : card.updatedAt ? (
        <p style={{ margin: '0.75rem 0 0', color: 'var(--muted)' }}>
          Última modificación: {when(card.updatedAt)}
        </p>
      ) : null}
    </fieldset>
  );
}
