import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  GfNgGuideCalendarComponent,
  GfNgGuideCashComponent,
  GfNgGuideImprovementsComponent,
  GfNgGuideReturnsComponent,
  GfNgGuideTaxComponent,
  GfNgGuideTeamComponent
} from './chapters/ghostfolio-ng-chapters';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    GfNgGuideTeamComponent,
    GfNgGuideCashComponent,
    GfNgGuideTaxComponent,
    GfNgGuideCalendarComponent,
    GfNgGuideReturnsComponent,
    GfNgGuideImprovementsComponent
  ],
  selector: 'gf-ghostfolio-ng-page',
  styleUrls: ['./ghostfolio-ng-page.scss'],
  templateUrl: './ghostfolio-ng-page.html'
})
export class GfGhostfolioNgPageComponent {}
