import { fetchVanguardHoldings, VANGUARD_PAGE_LIMIT } from './vanguard.client';

function holding(weight: number) {
  return {
    bloombergIsoCountry: 'US',
    gicsSectorDescription: 'Information Technology',
    marketValuePercentage: weight,
    securityType: 'EQ.STOCK'
  };
}

function page({
  count,
  cursor,
  total,
  weight = 0.1
}: {
  count: number;
  cursor: string | null;
  total: number;
  weight?: number;
}) {
  return {
    data: {
      borHoldings: [
        {
          holdings: {
            items: Array.from({ length: count }, () => holding(weight)),
            totalHoldings: total,
            lastItemKey: cursor
          }
        }
      ]
    }
  };
}

describe('Vanguard holdings client', () => {
  it('retrieves all 3934 holdings across three pages', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(
        page({
          count: 1500,
          total: 3934,
          cursor: 'cursor-1'
        })
      )
      .mockResolvedValueOnce(
        page({
          count: 1500,
          total: 3934,
          cursor: 'cursor-2'
        })
      )
      .mockResolvedValueOnce(
        page({
          count: 934,
          total: 3934,
          cursor: null
        })
      );

    const result = await fetchVanguardHoldings({
      fetchPage,
      portId: '9679'
    });

    expect(result).toHaveLength(3934);
    expect(fetchPage).toHaveBeenCalledTimes(3);

    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      portId: '9679',
      limit: VANGUARD_PAGE_LIMIT,
      lastItemKey: null
    });

    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      portId: '9679',
      limit: VANGUARD_PAGE_LIMIT,
      lastItemKey: 'cursor-1'
    });

    expect(fetchPage).toHaveBeenNthCalledWith(3, {
      portId: '9679',
      limit: VANGUARD_PAGE_LIMIT,
      lastItemKey: 'cursor-2'
    });
  });

  it('preserves negative holdings', async () => {
    const fetchPage = jest.fn().mockResolvedValue(
      page({
        count: 1,
        total: 1,
        cursor: null,
        weight: -0.00006
      })
    );

    const result = await fetchVanguardHoldings({
      fetchPage,
      portId: '9679'
    });

    expect(result[0].weight).toBe(-0.0000006);
  });

  it('rejects a changing declared total', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(
        page({
          count: 1,
          total: 3,
          cursor: 'next'
        })
      )
      .mockResolvedValueOnce(
        page({
          count: 1,
          total: 4,
          cursor: null
        })
      );

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow('Vanguard holdings total changed');
  });

  it('rejects repeated cursors', async () => {
    const fetchPage = jest.fn().mockResolvedValue(
      page({
        count: 1,
        total: 4,
        cursor: 'same'
      })
    );

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow('Repeated Vanguard pagination cursor');
  });

  it('rejects incomplete pagination', async () => {
    const fetchPage = jest.fn().mockResolvedValue(
      page({
        count: 1,
        total: 2,
        cursor: null
      })
    );

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow('Missing Vanguard pagination cursor');
  });

  it('rejects an empty page before completion', async () => {
    const fetchPage = jest.fn().mockResolvedValue(
      page({
        count: 0,
        total: 2,
        cursor: 'next'
      })
    );

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow('Empty Vanguard holdings page');
  });

  it('rejects pages exceeding the requested limit', async () => {
    const fetchPage = jest.fn().mockResolvedValue(
      page({
        count: 1501,
        total: 2000,
        cursor: 'next'
      })
    );

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow('Vanguard page exceeds requested limit');
  });

  it('rejects more holdings than declared', async () => {
    const fetchPage = jest.fn().mockResolvedValue(
      page({
        count: 2,
        total: 1,
        cursor: null
      })
    );

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow('Vanguard holdings exceed declared total');
  });

  it('rejects empty portfolios', async () => {
    const fetchPage = jest.fn().mockResolvedValue(
      page({
        count: 0,
        total: 0,
        cursor: null
      })
    );

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow('Empty Vanguard portfolio');
  });

  it('rejects invalid portfolio identifiers', async () => {
    const fetchPage = jest.fn();

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: ' ' })
    ).rejects.toThrow('Invalid Vanguard portfolio ID');

    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('propagates GraphQL errors', async () => {
    const fetchPage = jest.fn().mockResolvedValue({
      errors: [{ message: 'Unavailable' }],
      data: null
    });

    await expect(
      fetchVanguardHoldings({ fetchPage, portId: '9679' })
    ).rejects.toThrow();

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
