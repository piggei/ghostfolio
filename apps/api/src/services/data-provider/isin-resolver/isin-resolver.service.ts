import { parseSymbol } from '@ghostfolio/common/helper';

import { Injectable } from '@nestjs/common';

import {
  IsinListingVerification,
  IsinProviderInterface
} from './interfaces/isin-provider.interface';
import {
  IsinCandidate,
  IsinResolution,
  IsinResolutionRequest,
  IsinResolveResult
} from './isin-resolver.interface';

@Injectable()
export class IsinResolverService {
  public resolveExisting({
    isin
  }: IsinResolutionRequest): IsinResolution | undefined {
    if (!isin || !this.isValidIsin(isin)) {
      return undefined;
    }

    return {
      isin: isin.toUpperCase(),
      source: 'SYMBOL_PROFILE',
      valid: true,
      verified: false
    };
  }

  public resolveCandidates({
    candidates,
    symbol
  }: {
    candidates: IsinCandidate[];
    symbol: string;
  }): IsinResolution | undefined {
    const matches = candidates.filter((candidate) => {
      return candidate.symbol === symbol && this.isValidIsin(candidate.isin);
    });

    const uniqueIsins = [
      ...new Set(matches.map(({ isin }) => isin.toUpperCase()))
    ];

    if (uniqueIsins.length !== 1) {
      return undefined;
    }

    return {
      isin: uniqueIsins[0],
      source: matches[0].source,
      valid: true,
      verified: false
    };
  }

  public resolveVerifiedListings({
    listings,
    symbol
  }: {
    listings: IsinListingVerification[];
    symbol: string;
  }): IsinResolution | undefined {
    const expected = parseSymbol({
      dataSource: 'YAHOO',
      symbol
    });

    const matches = listings.filter((listing) => {
      return (
        listing.verified === true &&
        listing.symbol === symbol &&
        listing.exchange === expected.exchange &&
        this.isValidIsin(listing.isin)
      );
    });

    const uniqueIsins = [
      ...new Set(matches.map(({ isin }) => isin.toUpperCase()))
    ];

    if (uniqueIsins.length !== 1) {
      return undefined;
    }

    return {
      isin: uniqueIsins[0],
      source: 'VERIFIED_LISTING',
      valid: true,
      verified: true
    };
  }

  public async resolve({
    provider,
    request
  }: {
    provider: IsinProviderInterface;
    request: IsinResolutionRequest;
  }): Promise<IsinResolveResult> {
    const existing = this.resolveExisting(request);

    if (existing) {
      return {
        status: 'RESOLVED',
        resolution: existing
      };
    }

    // An existing but invalid ISIN must not be overwritten.
    if (request.isin) {
      return { status: 'UNAVAILABLE' };
    }

    try {
      const search = await provider.search(request);

      if (search.status === 'UNAVAILABLE') {
        return { status: 'UNAVAILABLE' };
      }

      if (search.status === 'NOT_FOUND') {
        return { status: 'NOT_FOUND' };
      }

      if (search.candidates.length === 0 || search.candidates.length > 10) {
        return { status: 'UNAVAILABLE' };
      }

      const uniqueCandidates = new Set(
        search.candidates.map(({ isin }) => isin.toUpperCase())
      );

      if (
        uniqueCandidates.size !== search.candidates.length ||
        [...uniqueCandidates].some((isin) => !this.isValidIsin(isin))
      ) {
        return { status: 'UNAVAILABLE' };
      }

      const verifiedListings: IsinListingVerification[] = [];

      for (const candidate of search.candidates) {
        const result = await provider.verifyListing({
          candidate,
          request
        });

        if (result.status === 'UNAVAILABLE') {
          return { status: 'UNAVAILABLE' };
        }

        if (result.status === 'NOT_MATCHED') {
          continue;
        }

        const expected = parseSymbol(request);

        if (
          result.listing.verified !== true ||
          result.listing.isin.toUpperCase() !== candidate.isin.toUpperCase() ||
          result.listing.symbol !== request.symbol ||
          result.listing.exchange !== expected.exchange
        ) {
          return { status: 'UNAVAILABLE' };
        }

        verifiedListings.push(result.listing);
      }

      const uniqueVerifiedIsins = new Set(
        verifiedListings.map(({ isin }) => isin.toUpperCase())
      );

      if (uniqueVerifiedIsins.size > 1) {
        return { status: 'AMBIGUOUS' };
      }

      if (uniqueVerifiedIsins.size === 0) {
        return { status: 'NOT_FOUND' };
      }

      const resolution = this.resolveVerifiedListings({
        listings: verifiedListings,
        symbol: request.symbol
      });

      if (!resolution) {
        return { status: 'UNAVAILABLE' };
      }

      return {
        status: 'RESOLVED',
        resolution: {
          ...resolution,
          source: provider.getName()
        }
      };
    } catch {
      return { status: 'UNAVAILABLE' };
    }
  }

  private isValidIsin(isin: string): boolean {
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin.toUpperCase())) {
      return false;
    }

    const expanded = isin
      .toUpperCase()
      .split('')
      .map((character) => {
        if (/[A-Z]/.test(character)) {
          return String(character.charCodeAt(0) - 55);
        }

        return character;
      })
      .join('');

    let sum = 0;
    let doubleDigit = false;

    for (let index = expanded.length - 1; index >= 0; index--) {
      let digit = Number(expanded[index]);

      if (doubleDigit) {
        digit *= 2;

        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      doubleDigit = !doubleDigit;
    }

    return sum % 10 === 0;
  }
}
