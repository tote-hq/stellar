/**
 * Which Coto pay control to show.
 *
 * Paid, then read-only, then the comparison, then admission, then the total.
 * `pay` is the button. Every other name is a phrase and not a button.
 * No relative imports: the test loads this file under strip-types.
 */

export type CotoAdmission = 'pending' | 'failed' | 'allowed' | 'denied';

export type CotoPayGateName =
  | 'pay'
  | 'waiting'
  | 'fetch_failed'
  | 'not_admitted'
  | 'paid'
  | 'read_only'
  | 'dual_checkout'
  | 'no_total';

export interface CotoPayCart {
  lines: readonly { available: boolean; quantity: number }[];
  total: { centavos: number };
}

export function cotoPayGate(args: {
  admission: CotoAdmission;
  orderState: string;
  readOnly: boolean;
  dualCheckout: boolean;
  cart: CotoPayCart | null | undefined;
}): CotoPayGateName {
  if (args.orderState === 'paid') return 'paid';
  if (args.readOnly) return 'read_only';
  if (args.dualCheckout) return 'dual_checkout';
  if (args.admission === 'pending') return 'waiting';
  if (args.admission === 'failed') return 'fetch_failed';
  if (args.admission !== 'allowed') return 'not_admitted';
  const cart = args.cart;
  const payable = Boolean(
    cart && cart.lines.some((line) => line.available && line.quantity > 0) && cart.total.centavos > 0,
  );
  if (!payable) return 'no_total';
  return 'pay';
}
