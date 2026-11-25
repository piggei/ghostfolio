import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataEnhancerInterface } from '@ghostfolio/api/services/data-provider/interfaces/data-enhancer.interface';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SymbolProfile } from '@prisma/client';

import { getEtfCompositionDiscovery } from '../etf-composition.discovery';
import {
  improvesComposition,
  needsComposition
} from '../etf-composition.quality';
import { aggregateIsharesHoldings } from './ishares.aggregator';
import { fetchIsharesHoldings } from './ishares.client';

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

    const needsCountries = needsComposition(response.countries, 'countries');

    const needsSectors = needsComposition(response.sectors, 'sectors');

    if (!needsCountries && !needsSectors) {
      return response;
    }

    try {
      const fund = await getEtfCompositionDiscovery(this.fetchService).discover(
        this.getName() as 'ISHARES',
        response,
        symbol,
        requestTimeout
      );
      if (!fund) return response;

      const document = await fetchIsharesHoldings({
        fetch: (input, init) => this.fetchService.fetch(input, init),
        pageUrl: fund.pageUrl!,
        portfolioId: fund.portfolioId!,
        requestTimeout
      });

      const { composition } = aggregateIsharesHoldings(document.holdings);

      if (!response.isin) response.isin = fund.isin;

      const hasCountryCoverage =
        composition.countryCoverage + composition.unclassifiedCountryWeight >=
          MINIMUM_COVERAGE && composition.countryCoverage > 0;

      const hasSectorCoverage =
        composition.sectorCoverage >= MINIMUM_COVERAGE &&
        composition.classifiedSectorCoverage > 0;

      if (
        needsCountries &&
        hasCountryCoverage &&
        improvesComposition(
          response.countries,
          composition.countries,
          'countries'
        )
      ) {
        response.countries =
          composition.countries as unknown as Prisma.JsonArray;
      }

      if (
        needsSectors &&
        hasSectorCoverage &&
        improvesComposition(response.sectors, composition.sectors, 'sectors')
      ) {
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
