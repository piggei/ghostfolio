import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-team',
  templateUrl: './team.chapter.html'
})
export class GfNgGuideTeamComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-cash',
  templateUrl: './cash.chapter.html'
})
export class GfNgGuideCashComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-tax',
  templateUrl: './tax.chapter.html'
})
export class GfNgGuideTaxComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-calendar',
  templateUrl: './calendar.chapter.html'
})
export class GfNgGuideCalendarComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-returns',
  templateUrl: './returns.chapter.html'
})
export class GfNgGuideReturnsComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-improvements',
  templateUrl: './improvements.chapter.html'
})
export class GfNgGuideImprovementsComponent {}
