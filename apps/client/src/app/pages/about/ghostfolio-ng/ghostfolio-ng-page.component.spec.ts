import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { publicRoutes } from '@ghostfolio/common/routes/routes';
import { GfPageTabsComponent } from '@ghostfolio/ui/page-tabs';
import { DataService } from '@ghostfolio/ui/services';

import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IonIcon } from '@ionic/angular/standalone';
import { DeviceDetectorService } from 'ngx-device-detector';
import { of } from 'rxjs';

import { AboutPageComponent } from '../about-page.component';
import { routes } from '../about-page.routes';
import { GfGhostfolioNgPageComponent } from './ghostfolio-ng-page.component';

jest.mock('@ionic/angular/standalone', () => ({ IonIcon: class {} }));
jest.mock('ionicons', () => ({ addIcons: jest.fn() }));
jest.mock('ionicons/icons', () => ({
  bookOutline: 'book-outline',
  documentTextOutline: 'document-text-outline',
  happyOutline: 'happy-outline',
  informationCircleOutline: 'information-circle-outline',
  openOutline: 'open-outline',
  ribbonOutline: 'ribbon-outline',
  shieldCheckmarkOutline: 'shield-checkmark-outline',
  sparklesOutline: 'sparkles-outline'
}));

@Component({ template: '<p data-testid="unavailable">Unavailable</p>' })
class UnavailableComponent {}

const guideRoute = routes[0].children.find(
  ({ path }) => path === publicRoutes.about.subRoutes.ghostfolioNg.path
);
const chapterIds = [
  'team',
  'cash-management',
  'tax-management',
  'pnl-calendar',
  'financial-returns',
  'other-improvements'
];

describe('Ghostfolio-NG guide', () => {
  let isGhostfolioNg: unknown;
  let deviceType: string;

  beforeEach(async () => {
    isGhostfolioNg = true;
    deviceType = 'desktop';
    await TestBed.configureTestingModule({
      imports: [AboutPageComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([
          {
            path: 'about',
            children: [
              guideRoute,
              { path: '**', component: UnavailableComponent }
            ]
          }
        ]),
        {
          provide: DataService,
          useValue: {
            fetchInfo: () => ({ isGhostfolioNg, globalPermissions: [] })
          }
        },
        { provide: UserService, useValue: { stateChanged: of(null) } },
        {
          provide: DeviceDetectorService,
          useValue: { getDeviceInfo: () => ({ deviceType }) }
        }
      ]
    })
      .overrideComponent(GfPageTabsComponent, {
        remove: { imports: [IonIcon] },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] }
      })
      .compileComponents();
  });

  async function renderGuide() {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(
      '/about/ghostfolio-ng',
      GfGhostfolioNgPageComponent
    );
    return { harness, page: harness.routeNativeElement };
  }

  it('retains the parent authentication convention and uses an NG-only route gate', () => {
    expect(routes[0].canActivate).toContain(AuthGuard);
    expect(guideRoute.canMatch).toHaveLength(1);
    expect(guideRoute.title).toBe('Ghostfolio-NG');
  });

  it.each([false, undefined, null, 'true'])(
    'blocks direct navigation for flag %s',
    async (flag) => {
      isGhostfolioNg = flag;
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/about/ghostfolio-ng', UnavailableComponent);
      expect(harness.routeNativeElement.querySelector('img')).toBeNull();
      expect(harness.routeNativeElement.textContent).toContain('Unavailable');
    }
  );

  it('renders all six complete chapters in the required order', async () => {
    const { page } = await renderGuide();
    const sections = Array.from(page.querySelectorAll('section'));
    expect(sections.map(({ id }) => id)).toEqual(chapterIds);
    expect(page.querySelector('h1').textContent).toBe('Ghostfolio-NG');
    for (const section of sections) {
      expect(section.querySelectorAll('p, li').length).toBeGreaterThanOrEqual(
        4
      );
      expect(
        page.querySelector('#' + section.getAttribute('aria-labelledby'))
      ).not.toBeNull();
      expect(section.getAttribute('tabindex')).toBe('-1');
    }
    expect(page.textContent).not.toMatch(/TODO|Coming soon|placeholder/i);
  });

  it('provides working chapter fragments and return links on the same route', async () => {
    const { page, harness } = await renderGuide();
    const links = Array.from(
      page.querySelectorAll<HTMLAnchorElement>('a[href*="#"]')
    );
    expect(links).toHaveLength(12);
    for (const link of links) {
      expect(link.pathname).toBe('/about/ghostfolio-ng');
      expect(page.querySelector(link.hash)).not.toBeNull();
    }
    const cash =
      page.querySelector<HTMLAnchorElement>(
        'nav a[fragment="cash-management"]'
      ) ??
      page.querySelector<HTMLAnchorElement>('nav a[href$="#cash-management"]');
    cash.click();
    await harness.fixture.whenStable();
    expect(
      harness.routeNativeElement.querySelector('#cash-management')
    ).not.toBeNull();
    const ids = Array.from(page.querySelectorAll('[id]')).map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses the approved responsive team image and identifies both AI assistants', async () => {
    const { page } = await renderGuide();
    const image = page.querySelector('img');
    expect(image.getAttribute('src')).toBe(
      '../assets/images/ghostfolio-ng-team.webp'
    );
    expect(image.width).toBe(1535);
    expect(image.height).toBe(1024);
    expect(image.classList.contains('img-fluid')).toBe(true);
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.alt).toContain('PJ on his shirt');
    expect(image.alt).toContain('AI assistants');
    expect(page.textContent).toContain('not human contributors');
    expect(page.querySelectorAll('.chapter-index a')).toHaveLength(6);
  });

  it('contains only the verified external attribution links with safe new-tab attributes', async () => {
    const { page } = await renderGuide();
    const links = Array.from(
      page.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')
    );
    expect(links.map((link) => link.href)).toEqual([
      'https://github.com/ghostfolio/ghostfolio',
      'https://github.com/piggei/ghostfolio'
    ]);
    for (const link of links) expect(link.rel).toContain('noopener');
  });

  it('explains cash import, tax and return limitations rather than promising unsupported behavior', async () => {
    const { page } = await renderGuide();
    expect(page.querySelector('pre').textContent).toContain(
      '2026-10-03;RECONCILIATION;880;EUR;0;3;balance-1'
    );
    expect(page.textContent).toContain(
      'no separate source-fee or destination-fee fields'
    );
    expect(page.textContent).toContain('only when ROAI is selected');
    expect(page.textContent).toContain(
      'not a substitute for professional tax advice'
    );
    expect(page.textContent).toContain('no explicit tax adjustment');
    expect(
      page.querySelector('#tax-management').textContent.replace(/\s+/g, ' ')
    ).toContain(
      'Changing Tax to 20 updates the same linked movement to 80 EUR'
    );
    expect(page.textContent).toContain('annualized MWR');
  });

  it('leaves the original distribution tab inventory unchanged', () => {
    isGhostfolioNg = false;
    const fixture = TestBed.createComponent(AboutPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.tabs.map(({ label }) => label)).toEqual([
      publicRoutes.about.title,
      publicRoutes.about.subRoutes.changelog.title,
      publicRoutes.about.subRoutes.license.title,
      publicRoutes.about.subRoutes.ossFriends.title
    ]);
    expect(
      fixture.nativeElement.querySelector('a[href$="/ghostfolio-ng"]')
    ).toBeNull();
  });

  it.each(['desktop', 'mobile'])(
    'adds one identifiable guide tab on %s',
    (device) => {
      deviceType = device;
      const fixture = TestBed.createComponent(AboutPageComponent);
      fixture.detectChanges();
      const tabs = fixture.componentInstance.tabs.filter(
        ({ label }) => label === 'Ghostfolio-NG'
      );
      expect(tabs).toHaveLength(1);
      expect(tabs[0].iconName).toBe('book-outline');
      const link = fixture.nativeElement.querySelector(
        'a[href="/about/ghostfolio-ng"]'
      );
      expect(link.getAttribute('aria-label')).toBe('Ghostfolio-NG');
    }
  );
});
