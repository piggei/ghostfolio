import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject
} from '@angular/core';
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
export class GfGhostfolioNgPageComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  protected scrollToFragment(fragment: string): void {
    const container = this.elementRef.nativeElement as HTMLElement;
    const target = container.querySelector(
      `#${fragment}`
    ) as HTMLElement | null;

    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}
