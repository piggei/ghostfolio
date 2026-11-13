import { Big } from 'big.js';

export type NgBenchmarkMethod = 'MWR' | 'TWR';
export interface NgBenchmarkObservation {
  date: string;
  status:
    | 'BASELINE'
    | 'CALCULATED'
    | 'NO_APPLICABLE_INVESTMENT'
    | 'INSUFFICIENT_CASH_FLOWS'
    | 'UNDEFINED';
  returnFraction?: Big;
}
