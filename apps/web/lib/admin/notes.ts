/**
 * Buyer names for the Pedidos list. No imports: the lookup is passed in, so
 * this file stays loadable under type-stripping and does not pull the store.
 */

export interface NoteOrder {
  orderId: string | null;
}

export interface BuyerLookup {
  buyer?: string;
}

export async function withBuyers<T extends NoteOrder>(
  notes: readonly T[],
  lookup: (orderId: string) => Promise<BuyerLookup | undefined>,
): Promise<Array<T & { buyer: string | null }>> {
  const ids = [...new Set(notes.flatMap((note) => (note.orderId ? [note.orderId] : [])))];
  const found = new Map<string, string | null>();
  await Promise.all(
    ids.map(async (orderId) => {
      try {
        const record = await lookup(orderId);
        const buyer = record?.buyer;
        found.set(orderId, typeof buyer === 'string' && buyer !== '' ? buyer : null);
      } catch {
        found.set(orderId, null);
      }
    }),
  );
  return notes.map((note) => ({
    ...note,
    buyer: note.orderId ? (found.get(note.orderId) ?? null) : null,
  }));
}
