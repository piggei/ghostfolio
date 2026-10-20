export type CashEventInput = {
  comment?: string | null;
  date: string;
} & (
  { amount: string; type: 'MOVEMENT' } | { balance: string; type: 'CHECKPOINT' }
);

export type ManagedCashEvent = CashEventInput & {
  id: string;
  sequence: number;
  orderId?: string;
  transferId?: string;
};

export interface CashManagementSnapshot {
  accountId: string;
  balances: { date: string; value: string }[];
  currency: string;
  defaultUpdateCash: boolean;
  events: ManagedCashEvent[];
  minimumBalance: { date: string; sequence: number; value: string };
  openingBalance: { balance: string; date: string; sequence: number };
  revision: number;
}

export interface CashManagementExport {
  currency: string;
  defaultUpdateCash: boolean;
  events: ManagedCashEvent[];
  openingBalance: { balance: string; date: string; sequence: number };
  version: 1;
}

export interface CashConfirmation {
  confirmNegativeBalance?: boolean;
  cashRevisions?: Record<string, number>;
}
