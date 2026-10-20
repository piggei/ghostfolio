import type { Account, Platform, Tag } from '@ghostfolio/prisma/browser';

export type AccountWithPlatform = Account & {
  cashManagement?: { defaultUpdateCash: boolean; openingDate: string };
  platform?: Platform;
  tags?: Tag[];
};
