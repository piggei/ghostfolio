import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataEnhancerInterface } from '@ghostfolio/api/services/data-provider/interfaces/data-enhancer.interface';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SymbolProfile } from '@prisma/client';

import { assertFreshEtfDate } from '../etf-composition.date';
import { getEtfCompositionDiscovery } from '../etf-composition.discovery';
import {
  improvesComposition,
  needsComposition
} from '../etf-composition.quality';
import { aggregateVanguardHoldings } from './vanguard.aggregator';
import { fetchVanguardHoldings } from './vanguard.client';

const GRAPHQL_URL = 'https://www.ie.vanguard/gpx/graphql';

const MINIMUM_COVERAGE = 0.95;

const QUERY = `
  query FundsHoldingsQuery(
    $portIds: [String!]
    $limit: Float
    $lastItemKey: String
  ) {
    borHoldings(portIds: $portIds) {
      holdings(limit: $limit, lastItemKey: $lastItemKey) {
        totalHoldings
        lastItemKey
        items {
          effectiveDate
          sedol1
          securityType
          bloombergIsoCountry
          gicsSectorDescription
          icbIndustryDescription
          marketValuePercentage
        }
      }
    }
  }
`;

@Injectable()
export class VanguardDataEnhancerService implements DataEnhancerInterface {
  private readonly logger = new Logger(VanguardDataEnhancerService.name);

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly fetchService: FetchService
  ) {}

  public getName(): string {
    return 'VANGUARD';
  }

  public getTestSymbol(): string {
    return 'VWCE.DE';
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
        this.getName() as 'VANGUARD',
        response,
        symbol,
        requestTimeout
      );
      if (!fund) return response;

      let holdingsDate: string | undefined;
      const holdings = await fetchVanguardHoldings({
        portId: fund.portfolioId!,
        fetchPage: async ({ portId, limit, lastItemKey }) => {
          const result = await this.fetchService.fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-consumer-id': 'ie0'
            },
            body: JSON.stringify({
              query: QUERY,
              variables: {
                portIds: [portId],
                limit,
                lastItemKey
              }
            }),
            signal: AbortSignal.timeout(requestTimeout)
          });

          if (!result.ok) {
            throw new Error(`HTTP status ${result.status}`);
          }

          const data = await result.json();
          const items = data.data?.borHoldings?.[0]?.holdings?.items;
          if (!Array.isArray(items) || !items.length)
            throw new Error('Missing Vanguard holdings');
          const dates = [
            ...new Set(
              items.map(
                (item: { effectiveDate?: string }) => item.effectiveDate
              )
            )
          ];
          if (dates.length !== 1)
            throw new Error('Inconsistent Vanguard holdings dates');
          assertFreshEtfDate(dates[0]);
          if (holdingsDate && holdingsDate !== dates[0])
            throw new Error('Vanguard holdings date changed during pagination');
          holdingsDate = dates[0];
          return data;
        }
      });

      const { composition } = aggregateVanguardHoldings(holdings);

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
        this.logger.warn('Insufficient Vanguard composition coverage');
      }
    } catch (error) {
      this.logger.warn(
        `Could not enhance ${symbol} from Vanguard: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return response;
  }
}
