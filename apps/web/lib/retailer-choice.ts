/**
 * When a Pedir en {store} click has to confirm, and the messages those clicks send.
 *
 * No imports: the chat tests load this file by stripping types.
 * Cancel sends nothing. Confirm and a first choice are ordinary chat messages,
 * so the model calls `choose_retailer` only after the shopper has named the store.
 */
export type Chain = 'dia' | 'coto';

export function needsSwitchConfirm(
  current: { retailer: string; lines: number } | null,
  next: Chain,
): boolean {
  if (!current || current.lines <= 0) return false;
  if (current.retailer !== 'dia' && current.retailer !== 'coto') return false;
  return current.retailer !== next;
}

export function choiceMessage(retailer: Chain): string {
  return retailer === 'dia' ? 'Quiero pedir en Día.' : 'Quiero pedir en Coto.';
}

export function confirmSwitchMessage(from: Chain, to: Chain): string {
  const name = (chain: Chain) => (chain === 'dia' ? 'Día' : 'Coto');
  return `Sí, confirmá el cambio: reemplazá el changuito de ${name(from)} por uno de ${name(to)}.`;
}

export function substituteMessage(item: string, retailer: Chain): string {
  const store = retailer === 'dia' ? 'Día' : 'Coto';
  return `Sustituí «${item}» en ${store}.`;
}

export function dropMessage(item: string): string {
  return `Sacá «${item}» del pedido.`;
}
