import { CAP_UNITS, CHUNK_UNITS, faucetMint } from './faucet-policy.ts';
import { DEFAULT_LANG, INTL_LOCALE, type Lang } from './lang.ts';

/**
 * What the "Cargar USDC" confirmation says.
 *
 * Amounts come from the policy the faucet route enforces, so the copy cannot
 * promise a grant the server will not make. Offer while balance < CAP; the
 * button names the clipped amount (950 → "Cargar 50,00 USDC").
 */

const SCALE = 10_000_000n;

/**
 * Token units as money: 1_000_000_000n -> "100,00", or "100.00" for an English
 * reader. Only the separators follow the language; the figure never does.
 *
 * Built by hand rather than through `Intl` because the input is a bigint and
 * going through a Number to format it is the one thing a token amount must not
 * do. The whole part still goes through `toLocaleString` — that is where the
 * thousands separator comes from, and it is the half that actually differs.
 */
export function usdcAmount(units: bigint, lang: Lang = DEFAULT_LANG): string {
  const whole = units / SCALE;
  const cents = ((units % SCALE) * 100n) / SCALE;
  const point = lang === 'en' ? '.' : ',';
  return `${whole.toLocaleString(INTL_LOCALE[lang])}${point}${cents.toString().padStart(2, '0')}`;
}

export interface FaucetConfirmCopy {
  title: string;
  body: string;
  /** Absent when there is nothing to confirm: the wallet is already at the cap. */
  confirm?: string;
  dismiss: string;
}

/**
 * `lang` is optional and defaults to Spanish. `chunks` defaults to 1; the
 * confirm label uses the clipped mint amount for this balance.
 */
export function faucetConfirmCopy(
  balanceUnits: bigint | null,
  lang: Lang = DEFAULT_LANG,
  chunks = 1,
): FaucetConfirmCopy {
  const balance = balanceUnits ?? 0n;
  const amount = faucetMint(balance, chunks);
  const grant = usdcAmount(amount > 0n ? amount : CHUNK_UNITS, lang);
  const cap = usdcAmount(CAP_UNITS, lang);
  const chunk = usdcAmount(CHUNK_UNITS, lang);

  if (balanceUnits !== null && balanceUnits >= CAP_UNITS) {
    if (lang === 'en') {
      return {
        title: 'You already have a practice balance',
        body: `You have ${usdcAmount(balanceUnits, lang)} practice USDC, the maximum for this demo (${cap} USDC). Topping up switches back on after you spend some.`,
        dismiss: 'Got it',
      };
    }
    return {
      title: 'Ya tenés saldo de prueba',
      body: `Tenés ${usdcAmount(balanceUnits)} USDC de prueba, el máximo de esta demo (${cap} USDC). La carga se habilita otra vez cuando gastás un poco.`,
      dismiss: 'Entendido',
    };
  }

  if (lang === 'en') {
    return {
      title: 'Add practice USDC',
      body: `We'll add ${grant} practice USDC to your account so you can try the payment. It isn't real money and it cannot be withdrawn. You can add ${chunk} at a time up to ${cap} USDC.`,
      confirm: `Add ${grant} USDC`,
      dismiss: 'Cancel',
    };
  }

  return {
    title: 'Cargar USDC de prueba',
    body: `Vamos a sumar ${grant} USDC de prueba a tu billetera para que pruebes el pago. No es plata real y no se puede retirar. Podés cargar de a ${chunk} hasta llegar a ${cap} USDC.`,
    confirm: `Cargar ${grant} USDC`,
    dismiss: 'Cancelar',
  };
}
