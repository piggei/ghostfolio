import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataEnhancerInterface } from '@ghostfolio/api/services/data-provider/interfaces/data-enhancer.interface';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SymbolProfile } from '@prisma/client';

import { parseXtrackersHoldings } from './xtrackers.parser';

const FUND = {
  isin: 'IE00BTJRMP35',
  symbols: ['XMME.MI', 'XMME'],
  url: 'https://etf.deutsche-am.com/api/pdp/en-gb/etf/IE00BTJRMP35-msci-emerging-markets-ucits-etf-1c/holdings'
};

const MINIMUM_COVERAGE = 0.95;

@Injectable()
export class XtrackersDataEnhancerService implements DataEnhancerInterface {
  private readonly logger = new Logger(XtrackersDataEnhancerService.name);

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly fetchService: FetchService
  ) {}

  public getName(): string {
    return 'XTRACKERS';
  }

  public getTestSymbol(): string {
    return 'XMME.MI';
  }

  public async enhance({
    requestTimeout = this.configurationService.get('REQUEST_TIMEOUT'),
    response,
    symbol
  }: {
    requestTimeout?: number;
    response: Partial<SymbolProfile>;
    symbol: string;
  }): Promise<Partial<SymbolProfile>> {
    if (response.assetClass !== 'EQUITY' || response.assetSubClass !== 'ETF') {
      return response;
    }

    const normalizedSymbol = symbol.toUpperCase();
    const matchesSymbol = FUND.symbols.includes(normalizedSymbol);

    const isVerifiedYahooSymbol =
      response.dataSource === 'YAHOO' && normalizedSymbol === 'XMME.MI';

    const isVerifiedIsin = response.isin === FUND.isin;

    if (
      !matchesSymbol ||
      (!isVerifiedYahooSymbol && !isVerifiedIsin) ||
      (response.isin && !isVerifiedIsin)
    ) {
      return response;
    }

    const needsCountries =
      !Array.isArray(response.countries) || response.countries.length === 0;
    const needsSectors =
      !Array.isArray(response.sectors) || response.sectors.length === 0;

    if (!needsCountries && !needsSectors) {
      return response;
    }

    try {
      const result = await this.fetchService.fetch(FUND.url, {
        signal: AbortSignal.timeout(requestTimeout)
      });

      if (!result.ok) {
        throw new Error(`HTTP status ${result.status}`);
      }

      const composition = parseXtrackersHoldings(await result.json());

      const hasCountryCoverage =
        composition.countryCoverage + composition.unclassifiedCountryWeight >=
          MINIMUM_COVERAGE && composition.countryCoverage > 0;

      const hasSectorCoverage =
        composition.sectorCoverage >= MINIMUM_COVERAGE &&
        composition.classifiedSectorCoverage > 0;

      if (
        needsCountries &&
        hasCountryCoverage &&
        composition.countries.length > 0
      ) {
        response.countries =
          composition.countries as unknown as Prisma.JsonArray;
      }

      if (needsSectors && hasSectorCoverage && composition.sectors.length > 0) {
        response.sectors = composition.sectors as unknown as Prisma.JsonArray;
      }

      if (
        (needsCountries && !hasCountryCoverage) ||
        (needsSectors && !hasSectorCoverage)
      ) {
        this.logger.warn('Insufficient Xtrackers composition coverage');
      }
    } catch (error) {
      this.logger.warn(
        `Could not enhance ${symbol} from Xtrackers: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return response;
  }
}
