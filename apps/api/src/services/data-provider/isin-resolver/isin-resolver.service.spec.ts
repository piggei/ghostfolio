import { IsinResolverService } from './isin-resolver.service';

describe('ISIN resolver', () => {
  let service: IsinResolverService;

  beforeEach(() => {
    service = new IsinResolverService();
  });

  it('accepts an existing valid ISIN', () => {
    expect(
      service.resolveExisting({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI',
        isin: 'IE00BTJRMP35'
      })
    ).toEqual({
      isin: 'IE00BTJRMP35',
      source: 'SYMBOL_PROFILE',
      valid: true,
      verified: false
    });
  });

  it('rejects an invalid ISIN checksum', () => {
    expect(
      service.resolveExisting({
        dataSource: 'YAHOO',
        symbol: 'XMME.MI',
        isin: 'IE00BTJRMP36'
      })
    ).toBeUndefined();
  });

  it('resolves a unique verified candidate', () => {
    expect(
      service.resolveCandidates({
        symbol: 'XAIX.MI',
        candidates: [
          {
            isin: 'IE00BGV5VN51',
            symbol: 'XAIX.MI',
            source: 'JUSTETF'
          }
        ]
      })
    ).toEqual({
      isin: 'IE00BGV5VN51',
      source: 'JUSTETF',
      valid: true,
      verified: false
    });
  });

  it('rejects ambiguous candidates', () => {
    expect(
      service.resolveCandidates({
        symbol: 'XAIX.MI',
        candidates: [
          {
            isin: 'IE00BGV5VN51',
            symbol: 'XAIX.MI',
            source: 'JUSTETF'
          },
          {
            isin: 'IE00BTJRMP35',
            symbol: 'XAIX.MI',
            source: 'JUSTETF'
          }
        ]
      })
    ).toBeUndefined();
  });

  it('rejects a different market symbol', () => {
    expect(
      service.resolveCandidates({
        symbol: 'XMME.MI',
        candidates: [
          {
            isin: 'IE00BTJRMP35',
            symbol: 'XMME.L',
            source: 'JUSTETF'
          }
        ]
      })
    ).toBeUndefined();
  });

  it('rejects missing candidates', () => {
    expect(
      service.resolveCandidates({
        symbol: 'XMME.MI',
        candidates: []
      })
    ).toBeUndefined();
  });
  it('accepts a verified listing', () => {
    expect(
      service.resolveVerifiedListings({
        symbol: 'XMME.MI',
        listings: [
          {
            isin: 'IE00BTJRMP35',
            symbol: 'XMME.MI',
            exchange: 'MI',
            verified: true
          }
        ]
      })
    ).toEqual({
      isin: 'IE00BTJRMP35',
      source: 'VERIFIED_LISTING',
      valid: true,
      verified: true
    });
  });

  it('rejects an unverified listing', () => {
    expect(
      service.resolveVerifiedListings({
        symbol: 'XMME.MI',
        listings: [
          {
            isin: 'IE00BTJRMP35',
            symbol: 'XMME.MI',
            exchange: 'MI',
            verified: false
          }
        ]
      })
    ).toBeUndefined();
  });

  it('rejects ambiguous verified listings', () => {
    expect(
      service.resolveVerifiedListings({
        symbol: 'XAIX.MI',
        listings: [
          {
            isin: 'IE00BGV5VN51',
            symbol: 'XAIX.MI',
            exchange: 'MI',
            verified: true
          },
          {
            isin: 'IE00BTJRMP35',
            symbol: 'XAIX.MI',
            exchange: 'MI',
            verified: true
          }
        ]
      })
    ).toBeUndefined();
  });

  it('rejects a listing from another exchange', () => {
    expect(
      service.resolveVerifiedListings({
        symbol: 'XMME.MI',
        listings: [
          {
            isin: 'IE00BTJRMP35',
            symbol: 'XMME.MI',
            exchange: 'L',
            verified: true
          }
        ]
      })
    ).toBeUndefined();
  });
});
