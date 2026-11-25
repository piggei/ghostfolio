import { IsinProviderInterface } from './interfaces/isin-provider.interface';
import { IsinResolutionRequest } from './isin-resolver.interface';
import { IsinResolverService } from './isin-resolver.service';

const XMME = 'IE00BTJRMP35';
const XAIX = 'IE00BGV5VN51';

const request: IsinResolutionRequest = {
  dataSource: 'YAHOO',
  symbol: 'XMME.MI'
};

function createProvider({
  candidates = [XMME],
  outcomes = {},
  searchStatus = 'FOUND'
}: {
  candidates?: string[];
  outcomes?: Record<string, 'VERIFIED' | 'NOT_MATCHED' | 'UNAVAILABLE'>;
  searchStatus?: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';
} = {}) {
  const calls: string[] = [];

  const provider: IsinProviderInterface = {
    getName: () => 'MOCK',

    search: async () => {
      calls.push('search');

      if (searchStatus === 'NOT_FOUND') {
        return { status: 'NOT_FOUND' };
      }

      if (searchStatus === 'UNAVAILABLE') {
        return { status: 'UNAVAILABLE' };
      }

      return {
        status: 'FOUND',
        candidates: candidates.map((isin) => ({ isin }))
      };
    },

    verifyListing: async ({ candidate }) => {
      calls.push(candidate.isin);

      const status = outcomes[candidate.isin] ?? 'VERIFIED';

      if (status === 'NOT_MATCHED') {
        return { status: 'NOT_MATCHED' };
      }

      if (status === 'UNAVAILABLE') {
        return { status: 'UNAVAILABLE' };
      }

      return {
        status: 'VERIFIED',
        listing: {
          isin: candidate.isin,
          symbol: request.symbol,
          exchange: 'MI',
          verified: true
        }
      };
    }
  };

  return { provider, calls };
}

describe('ISIN resolver orchestration', () => {
  const service = new IsinResolverService();

  it('resolves a unique verified ISIN', async () => {
    const { provider, calls } = createProvider();

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({
      status: 'RESOLVED',
      resolution: {
        isin: XMME,
        source: 'MOCK',
        valid: true,
        verified: true
      }
    });

    expect(calls).toEqual(['search', XMME]);
  });

  it('preserves an existing valid ISIN', async () => {
    const { provider, calls } = createProvider();

    const result = await service.resolve({
      provider,
      request: { ...request, isin: XMME }
    });

    expect(result).toEqual({
      status: 'RESOLVED',
      resolution: {
        isin: XMME,
        source: 'SYMBOL_PROFILE',
        valid: true,
        verified: false
      }
    });

    expect(calls).toEqual([]);
  });

  it('does not overwrite an invalid existing ISIN', async () => {
    const { provider, calls } = createProvider();

    await expect(
      service.resolve({
        provider,
        request: { ...request, isin: 'INVALID' }
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });

    expect(calls).toEqual([]);
  });

  it('returns NOT_FOUND when search has no results', async () => {
    const { provider } = createProvider({
      searchStatus: 'NOT_FOUND'
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'NOT_FOUND' });
  });

  it('returns UNAVAILABLE when search fails', async () => {
    const { provider } = createProvider({
      searchStatus: 'UNAVAILABLE'
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects ambiguous verified candidates', async () => {
    const { provider, calls } = createProvider({
      candidates: [XMME, XAIX]
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'AMBIGUOUS' });

    expect(calls).toEqual(['search', XMME, XAIX]);
  });

  it('does not hide unavailable candidate verification', async () => {
    const { provider, calls } = createProvider({
      candidates: [XMME, XAIX],
      outcomes: {
        [XAIX]: 'UNAVAILABLE'
      }
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });

    expect(calls).toEqual(['search', XMME, XAIX]);
  });

  it('returns NOT_FOUND when all candidates do not match', async () => {
    const { provider } = createProvider({
      outcomes: {
        [XMME]: 'NOT_MATCHED'
      }
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'NOT_FOUND' });
  });

  it('rejects duplicate candidates', async () => {
    const { provider } = createProvider({
      candidates: [XMME, XMME]
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects an empty FOUND response', async () => {
    const { provider } = createProvider({
      candidates: []
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects an invalid candidate ISIN', async () => {
    const { provider } = createProvider({
      candidates: ['IE00BTJRMP36']
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects a verification for another ISIN', async () => {
    const { provider } = createProvider();

    provider.verifyListing = async () => ({
      status: 'VERIFIED',
      listing: {
        isin: XAIX,
        symbol: request.symbol,
        exchange: 'MI',
        verified: true
      }
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('handles provider exceptions', async () => {
    const { provider } = createProvider();

    provider.search = async () => {
      throw new Error('Provider unavailable');
    };

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects a verified listing with a different symbol', async () => {
    const { provider } = createProvider();

    provider.verifyListing = async ({ candidate }) => ({
      status: 'VERIFIED',
      listing: {
        isin: candidate.isin,
        symbol: 'XMME.L',
        exchange: 'MI',
        verified: true
      }
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('rejects a verified listing with a different exchange', async () => {
    const { provider } = createProvider();

    provider.verifyListing = async ({ candidate }) => ({
      status: 'VERIFIED',
      listing: {
        isin: candidate.isin,
        symbol: 'XMME.MI',
        exchange: 'L',
        verified: true
      }
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
  });

  it('resolves one matching candidate among several', async () => {
    const { provider, calls } = createProvider({
      candidates: [XMME, XAIX],
      outcomes: {
        [XAIX]: 'NOT_MATCHED'
      }
    });

    await expect(
      service.resolve({
        provider,
        request
      })
    ).resolves.toEqual({
      status: 'RESOLVED',
      resolution: {
        isin: XMME,
        source: 'MOCK',
        valid: true,
        verified: true
      }
    });

    expect(calls).toEqual(['search', XMME, XAIX]);
  });
});
