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
import {
  fetchAmundiProduct,
  fetchInvescoScope,
  invescoUrl,
  parseAmundiAllocation,
  parseInvescoAllocation,
  IssuerRequest
} from './issuer-api.client';

abstract class IssuerApiDataEnhancerService implements DataEnhancerInterface {
  private readonly logger = new Logger(IssuerApiDataEnhancerService.name);

  public constructor(
    protected readonly configurationService: ConfigurationService,
    protected readonly fetchService: FetchService
  ) {}
  public abstract getName(): 'INVESCO' | 'AMUNDI';
  public abstract getTestSymbol(): string;

  public async enhance({
    requestTimeout = this.configurationService.get('REQUEST_TIMEOUT'),
    response,
    symbol
  }: {
    requestTimeout?: number;
    response: Partial<SymbolProfile>;
    symbol: string;
  }): Promise<Partial<SymbolProfile>> {
    if (response.assetClass !== 'EQUITY' || response.assetSubClass !== 'ETF')
      return response;
    const dimensions = (['countries', 'sectors'] as const).filter((dimension) =>
      needsComposition(response[dimension], dimension)
    );
    if (!dimensions.length) return response;
    try {
      const fund = await getEtfCompositionDiscovery(this.fetchService).discover(
        this.getName(),
        response,
        symbol,
        requestTimeout
      );
      if (!fund) return response;
      const request: IssuerRequest = async (url, init) => {
        const result = await this.fetchService.fetch(url, {
          ...init,
          signal: AbortSignal.timeout(requestTimeout)
        });
        if (!result.ok) throw new Error('Issuer HTTP ' + result.status);
        return result;
      };
      const amundi =
        this.getName() === 'AMUNDI'
          ? await fetchAmundiProduct(request, fund.isin)
          : undefined;
      const scope = amundi
        ? undefined
        : await fetchInvescoScope(request, fund.isin);
      // Treat dimensions independently: one missing/stale endpoint must not
      // suppress valid exposure data from the other endpoint.
      for (const dimension of dimensions) {
        try {
          const composition = amundi
            ? parseAmundiAllocation(amundi, fund.isin, dimension)
            : parseInvescoAllocation(
                await (
                  await request(
                    invescoUrl(fund.isin) +
                      '/weightedHoldings/' +
                      scope +
                      '?idType=isin&breakdown=' +
                      (dimension === 'countries' ? 'country' : 'sector') +
                      '&audienceType=Institutional&productCode=ETF&replicationMethod=' +
                      (scope === 'index' ? 'Synthetic' : 'Physical') +
                      '&assetType=Equity'
                  )
                ).json(),
                fund.isin,
                dimension
              );
          if (!response.isin) response.isin = fund.isin;
          const coverage =
            dimension === 'countries'
              ? composition.countryCoverage +
                composition.unclassifiedCountryWeight
              : composition.sectorCoverage;
          if (
            coverage >= 0.95 &&
            improvesComposition(
              response[dimension],
              composition[dimension],
              dimension
            )
          )
            response[dimension] = composition[
              dimension
            ] as unknown as Prisma.JsonArray;
        } catch (error) {
          this.logger.warn(
            'Could not enhance ' +
              symbol +
              ' ' +
              dimension +
              ': ' +
              String(error)
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        'Could not enhance ' +
          symbol +
          ' from ' +
          this.getName() +
          ': ' +
          String(error)
      );
    }
    return response;
  }
}

@Injectable()
export class InvescoDataEnhancerService extends IssuerApiDataEnhancerService {
  public constructor(
    configurationService: ConfigurationService,
    fetchService: FetchService
  ) {
    super(configurationService, fetchService);
  }
  public getName(): 'INVESCO' {
    return 'INVESCO';
  }
  public getTestSymbol(): string {
    return 'SPXS.MI';
  }
}

@Injectable()
export class AmundiDataEnhancerService extends IssuerApiDataEnhancerService {
  public constructor(
    configurationService: ConfigurationService,
    fetchService: FetchService
  ) {
    super(configurationService, fetchService);
  }
  public getName(): 'AMUNDI' {
    return 'AMUNDI';
  }
  public getTestSymbol(): string {
    return 'MEUD.MI';
  }
}
