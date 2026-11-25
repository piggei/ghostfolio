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
import { parseXtrackersHoldings } from './xtrackers.parser';

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

    const needsCountries = needsComposition(response.countries, 'countries');
    const needsSectors = needsComposition(response.sectors, 'sectors');

    if (!needsCountries && !needsSectors) {
      return response;
    }

    try {
      const fund = await getEtfCompositionDiscovery(this.fetchService).discover(
        this.getName() as 'XTRACKERS',
        response,
        symbol,
        requestTimeout
      );
      if (!fund) return response;

      const result = await this.fetchService.fetch(fund.holdingsUrl!, {
        signal: AbortSignal.timeout(requestTimeout)
      });

      if (!result.ok) {
        throw new Error(`HTTP status ${result.status}`);
      }

      const data = await result.json();
      const source = data.tables?.[0]?.disclaimers;
      const dates = Array.isArray(source)
        ? source.flatMap((item: { text?: string }) =>
            [
              ...(item.text ?? '').matchAll(
                /Source: DWS (\d{2})\/(\d{2})\/(\d{4})/g
              )
            ].map((match) => match[3] + '-' + match[2] + '-' + match[1])
          )
        : [];
      if (dates.length !== 1)
        throw new Error('Missing or ambiguous Xtrackers holdings date');
      assertFreshEtfDate(dates[0]);
      const links = data.tables?.[0]?.downloadLinks;
      if (
        !Array.isArray(links) ||
        !links.some(
          (link: { href?: string }) =>
            link.href ===
            'https://etf.deutsche-am.com/etfdata/export/GBR/ENG/excel/product/constituent/' +
              fund.isin +
              '/'
        )
      )
        throw new Error('Xtrackers holdings ISIN mismatch');
      const composition = parseXtrackersHoldings(data);

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
