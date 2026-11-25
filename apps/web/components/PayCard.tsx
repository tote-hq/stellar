'use client';

/**
 * One pay control under the Día vs Coto card.
 * The heading names the basket. The button's accessible name says which lines
 * the click locks. Prices stay off this control: the quote is what gets locked.
 */
export interface PayCardLine {
  key: string;
  name: string;
  quantity: number;
}

const COPY = {
  dia: {
    title: 'Changuito de Día',
    titleId: 'pay-card-dia-title',
    testId: 'pay-card-dia',
    label: 'Pagar el changuito completo de Día',
  },
  coto: {
    title: 'Alternativas de Coto',
    titleId: 'pay-card-coto-title',
    testId: 'pay-card-coto',
    label: 'Pagar las alternativas aceptadas de Coto',
  },
} as const;

export function PayCard({
  which,
  lines,
  enabled,
  busy,
  onPay,
}: {
  which: 'dia' | 'coto';
  lines: PayCardLine[];
  /** A read-only or already-paid chat renders the card with no pay control. */
  enabled: boolean;
  /** The other pay is in progress, or this one already opened the escrow. */
  busy: boolean;
  onPay: () => void;
}) {
  const copy = COPY[which];
  return (
    <section className="pay-card" data-testid={copy.testId} aria-labelledby={copy.titleId}>
      <h3 id={copy.titleId}>{copy.title}</h3>
      <ul className="pay-card-lines">
        {lines.map((line) => (
          <li key={line.key}>
            {line.quantity} × {line.name}
          </li>
        ))}
      </ul>
      {enabled ? (
        <button type="button" className="btn btn-pay" aria-label={copy.label} disabled={busy} onClick={onPay}>
          Pagar
        </button>
      ) : null}
    </section>
  );
}
