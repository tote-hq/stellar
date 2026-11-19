import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { placeToSet, shopperPlace } from '../shopper-location.ts';

describe('shopperPlace', () => {
  it('reads a postal code and a store the shopper already typed', () => {
    assert.deepEqual(shopperPlace(['Armá un desayuno', '1181', 'dia']), {
      retailer: 'dia',
      postalCode: '1181',
      namedStore: true,
    });
    assert.deepEqual(shopperPlace(['1181']), { retailer: 'dia', postalCode: '1181', namedStore: false });
    assert.deepEqual(shopperPlace(['cp 1425', 'jumbo']), { retailer: 'jumbo', postalCode: '1425', namedStore: true });
    assert.deepEqual(shopperPlace(['C1414ABC']), {
      retailer: 'dia',
      postalCode: 'C1414ABC',
      namedStore: false,
    });
    assert.deepEqual(shopperPlace(['es 1181']), { retailer: 'dia', postalCode: '1181', namedStore: false });
    assert.deepEqual(shopperPlace(['1181 día']), { retailer: 'dia', postalCode: '1181', namedStore: true });
  });

  it('does not treat a price inside a sentence as a postal code', () => {
    assert.equal(shopperPlace(['leche a $1181']), null);
    assert.equal(shopperPlace(['dia']), null);
  });

  it('replaces a postal code already on the session and keeps the store', () => {
    assert.deepEqual(placeToSet({ retailer: 'dia', postalCode: '1425' }, ['1181']), {
      retailer: 'dia',
      postalCode: '1181',
    });
    assert.equal(placeToSet({ retailer: 'dia', postalCode: '1181' }, ['1181']), null);
    assert.deepEqual(placeToSet({ retailer: 'jumbo', postalCode: '1414' }, ['1181']), {
      retailer: 'jumbo',
      postalCode: '1181',
    });
    assert.deepEqual(placeToSet({ retailer: 'dia', postalCode: '1425' }, ['jumbo 1602']), {
      retailer: 'jumbo',
      postalCode: '1602',
    });
  });
});
