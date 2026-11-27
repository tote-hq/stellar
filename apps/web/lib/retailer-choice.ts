/**
 * When a Seguir en {store} or Armar carrito click has to confirm, and the
 * messages those clicks send.
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
  return retailer === 'dia' ? 'Quiero seguir en Día.' : 'Quiero seguir en Coto.';
}

/** Armar carrito in one section. Names the chain so the model cannot pick the other. */
export function buildCartMessage(chain: Chain): string {
  const store = chain === 'dia' ? 'Día' : 'Coto';
  return `Armá el carrito de ${store} con lo que charlamos y mostrame el pedido listo para pagar.`;
}

/**
 * The shopper asked to build the cart from what was already discussed.
 * Matches `buildCartMessage` for both chains and the es/en Armar ask, after trim.
 * Those ask strings are also `buildCartAsk` in `ui-copy.ts`. This file stays
 * import-free so the chat tests can load it by stripping types.
 */
export function isBuildCartMessage(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed === buildCartMessage('dia') ||
    trimmed === buildCartMessage('coto') ||
    trimmed === 'Armá el carrito con lo que charlamos y mostrame el pedido listo para pagar.' ||
    trimmed === 'Build the cart from what we discussed and show me the order ready to pay.'
  );
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
