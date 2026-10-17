/** A SEP-53 wallet proof signed by a throwaway keypair, the way Pollar's wallet signs one. */
import { createHash } from 'node:crypto';

import type { Keypair } from '@stellar/stellar-sdk';

import { walletProofMessage, type WalletIntent } from '../../wallet-proof.ts';

export function signedProof(kp: Keypair, intent: WalletIntent, ref?: string, now = Date.now(), address = kp.publicKey()) {
  const message = walletProofMessage(intent, address, now, ref);
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return { message, signature: Buffer.from(kp.sign(digest)).toString('base64') };
}
