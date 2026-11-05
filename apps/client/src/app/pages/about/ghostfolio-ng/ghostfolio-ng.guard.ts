import { DataService } from '@ghostfolio/ui/services';

import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';

export const ghostfolioNgGuard: CanMatchFn = () => {
  return inject(DataService).fetchInfo().isGhostfolioNg === true;
};
