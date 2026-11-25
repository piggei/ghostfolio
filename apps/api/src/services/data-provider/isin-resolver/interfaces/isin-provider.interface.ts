import { IsinResolutionRequest } from '../isin-resolver.interface';

export interface IsinProviderCandidate {
  isin: string;
  name?: string;
}

export interface IsinListingVerification {
  isin: string;
  symbol: string;
  exchange: string;
  verified: boolean;
}

export type IsinSearchResult =
  | {
      status: 'FOUND';
      candidates: IsinProviderCandidate[];
    }
  | {
      status: 'NOT_FOUND';
    }
  | {
      status: 'UNAVAILABLE';
    };

export type IsinVerificationResult =
  | {
      status: 'VERIFIED';
      listing: IsinListingVerification;
    }
  | {
      status: 'NOT_MATCHED';
    }
  | {
      status: 'UNAVAILABLE';
    };

export interface IsinProviderInterface {
  getName(): string;

  search(request: IsinResolutionRequest): Promise<IsinSearchResult>;

  verifyListing({
    candidate,
    request
  }: {
    candidate: IsinProviderCandidate;
    request: IsinResolutionRequest;
  }): Promise<IsinVerificationResult>;
}
