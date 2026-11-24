import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataEnhancerInterface } from '@ghostfolio/api/services/data-provider/interfaces/data-enhancer.interface';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SymbolProfile } from '@prisma/client';

import { aggregateVanguardHoldings } from './vanguard.aggregator';
import { fetchVanguardHoldings } from './vanguard.client';

const GRAPHQL_URL = 'https://www.ie.vanguard/gpx/graphql';

const FUND = {
  isin: 'IE00BK5BQT80',
  portId: '9679',
  symbols: ['VWCE.MI', 'VWCE.DE', 'VWCE.AS', 'VWRA.L', 'VWRP.L']
};

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
          securityType
          bloombergIsoCountry
          gicsSectorDescription
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
      const holdings = await fetchVanguardHoldings({
        portId: FUND.portId,
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

          return result.json();
        }
      });

      const { composition } = aggregateVanguardHoldings(holdings);

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
