import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataEnhancerInterface } from '@ghostfolio/api/services/data-provider/interfaces/data-enhancer.interface';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SymbolProfile } from '@prisma/client';

import { fetchWisdomtreeFactsheet } from './wisdomtree.client';
import { parseWisdomtreePdf } from './wisdomtree.parser';

const FUND_ISIN = 'IE00BZ56SW52';
const MINIMUM_COUNTRY_COVERAGE = 0.9; // Top 10 only, not a full composition
const MINIMUM_SECTOR_COVERAGE = 0.95;
const MAX_DOCUMENT_AGE_DAYS = 75;

@Injectable()
export class WisdomtreeDataEnhancerService implements DataEnhancerInterface {
  private readonly logger = new Logger(WisdomtreeDataEnhancerService.name);

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly fetchService: FetchService
  ) {}

  public getName(): string {
    return 'WISDOMTREE';
  }

  public getTestSymbol(): string {
    return 'GGRA.MI';
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
    if (symbol.toUpperCase() !== 'GGRA.MI') {
      return response;
    }
    if (response.isin && response.isin !== FUND_ISIN) {
      return response;
    }
    if (response.isin !== FUND_ISIN && response.dataSource !== 'YAHOO') {
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
      const bytes = await fetchWisdomtreeFactsheet({
        fetchService: this.fetchService,
        requestTimeout
      });
      const composition = await parseWisdomtreePdf(bytes);
      if (composition.isin !== FUND_ISIN) {
        throw new Error('Unexpected WisdomTree ISIN');
      }
      const timestamp = Date.parse(`${composition.asOfDate}T00:00:00Z`);
      const ageDays = (Date.now() - timestamp) / 86400000;
      if (
        !Number.isFinite(ageDays) ||
        ageDays < 0 ||
        ageDays > MAX_DOCUMENT_AGE_DAYS
      ) {
        throw new Error('Stale or invalid WisdomTree factsheet');
      }

      // Keep the ten published country weights unchanged; the remainder is unknown.
      if (
        needsCountries &&
        composition.countries.length === 10 &&
        composition.countryCoverage >= MINIMUM_COUNTRY_COVERAGE &&
        composition.countryCoverage <= 1
      ) {
        response.countries =
          composition.countries as unknown as Prisma.JsonArray;
      }
      if (
        needsSectors &&
        composition.sectors.length === 10 &&
        composition.sectorCoverage >= MINIMUM_SECTOR_COVERAGE &&
        composition.sectorCoverage <= 1
      ) {
        response.sectors = composition.sectors as unknown as Prisma.JsonArray;
      }
    } catch (error) {
      this.logger.warn(
        `Could not enhance ${symbol} from WisdomTree: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return response;
  }
}
