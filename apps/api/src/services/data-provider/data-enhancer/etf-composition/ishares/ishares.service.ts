import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataEnhancerInterface } from '@ghostfolio/api/services/data-provider/interfaces/data-enhancer.interface';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SymbolProfile } from '@prisma/client';

import { aggregateIsharesHoldings } from './ishares.aggregator';
import { fetchIsharesHoldings } from './ishares.client';

const FUND = {
  isin: 'IE00B4L5Y983',
  portfolioId: '251882',
  symbols: ['SWDA.MI', 'IWDA.AS'],
  pageUrl:
    'https://www.ishares.com/uk/individual/en/products/251882/ishares-core-msci-world-ucits-etf-swda'
};

const MINIMUM_COVERAGE = 0.95;

@Injectable()
export class IsharesDataEnhancerService implements DataEnhancerInterface {
  private readonly logger = new Logger(IsharesDataEnhancerService.name);

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly fetchService: FetchService
  ) {}

  public getName(): string {
    return 'ISHARES';
  }

  public getTestSymbol(): string {
    return 'SWDA.MI';
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

    if (!FUND.symbols.includes(normalizedSymbol)) {
      return response;
    }

    if (response.isin && response.isin !== FUND.isin) {
      return response;
    }

    if (response.isin !== FUND.isin && response.dataSource !== 'YAHOO') {
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
      const document = await fetchIsharesHoldings({
        fetch: (input, init) => this.fetchService.fetch(input, init),
        pageUrl: FUND.pageUrl,
        portfolioId: FUND.portfolioId,
        requestTimeout
      });

      const { composition } = aggregateIsharesHoldings(document.holdings);

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
        this.logger.warn('Insufficient iShares composition coverage');
      }
    } catch (error) {
      this.logger.warn(
        `Could not enhance ${symbol} from iShares: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return response;
  }
}
