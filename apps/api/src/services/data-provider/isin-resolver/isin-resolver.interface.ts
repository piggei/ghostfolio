import { DataSource } from '@prisma/client';

export interface IsinResolutionRequest {
  dataSource: DataSource;
  symbol: string;
  isin?: string | null;
  name?: string;
}

export interface IsinCandidate {
  isin: string;
  symbol: string;
  source: string;
}

export interface IsinResolution {
  isin: string;
  source: string;
  valid: boolean;
  verified: boolean;
}

export type IsinResolveResult =
  | {
      status: 'RESOLVED';
      resolution: IsinResolution;
    }
  | {
      status: 'NOT_FOUND';
    }
  | {
      status: 'AMBIGUOUS';
    }
  | {
      status: 'UNAVAILABLE';
    };
