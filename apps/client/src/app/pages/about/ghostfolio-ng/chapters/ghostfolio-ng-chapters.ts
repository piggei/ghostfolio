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
  styleUrls: ['./screenshot.chapter.scss'],
  templateUrl: './cash.chapter.html'
})
export class GfNgGuideCashComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-tax',
  styleUrls: ['./screenshot.chapter.scss'],
  templateUrl: './tax.chapter.html'
})
export class GfNgGuideTaxComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-calendar',
  styleUrls: ['./screenshot.chapter.scss'],
  templateUrl: './calendar.chapter.html'
})
export class GfNgGuideCalendarComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-returns',
  styleUrls: ['./screenshot.chapter.scss'],
  templateUrl: './returns.chapter.html'
})
export class GfNgGuideReturnsComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-improvements',
  templateUrl: './improvements.chapter.html'
})
export class GfNgGuideImprovementsComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gf-ng-guide-targets',
  styleUrls: ['./screenshot.chapter.scss'],
  templateUrl: './targets.chapter.html'
})
export class GfNgGuideTargetsComponent {}
