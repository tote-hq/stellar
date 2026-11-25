import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { retailerSearch } from '../config.ts';

describe('retailerSearch', () => {
  it('defaults to Día then Coto, both enabled', () => {
    assert.deepEqual(retailerSearch({}), {
      order: ['dia', 'coto'],
      enabled: { dia: true, coto: true },
    });
  });

  it('honours order and enabled from the config row', () => {
    assert.deepEqual(
      retailerSearch({
        retailer_search: { order: ['coto', 'dia'], enabled: { dia: true, coto: false } },
      }),
      { order: ['coto', 'dia'], enabled: { dia: true, coto: false } },
    );
  });
});
