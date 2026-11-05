import { UserService } from '@ghostfolio/client/services/user/user.service';
import { DataService } from '@ghostfolio/ui/services';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { of } from 'rxjs';

import { GfAboutOverviewPageComponent } from './about-overview-page.component';

jest.mock('@ionic/angular/standalone', () => ({
  IonIcon: class {}
}));

jest.mock('ionicons', () => ({
  addIcons: jest.fn()
}));

jest.mock('ionicons/icons', () => ({
  logoGithub: 'logo-github',
  logoLinkedin: 'logo-linkedin',
  logoSlack: 'logo-slack',
  logoX: 'logo-x',
  mail: 'mail'
}));

describe('GfAboutOverviewPageComponent', () => {
  let fixture: ComponentFixture<GfAboutOverviewPageComponent>;
  let isGhostfolioNg: boolean;
  let ghostfolioNgBuildInfo: unknown;

  beforeEach(async () => {
    isGhostfolioNg = false;
    ghostfolioNgBuildInfo = { upstreamVersion: '3.97.0' };

    await TestBed.configureTestingModule({
      imports: [GfAboutOverviewPageComponent],
      providers: [
        {
          provide: DataService,
          useValue: {
            fetchInfo: () => ({
              globalPermissions: [],
              isGhostfolioNg,
              ghostfolioNgBuildInfo
            })
          }
        },
        {
          provide: UserService,
          useValue: {
            stateChanged: of(null)
          }
        },
        provideRouter([])
      ]
    })
      .overrideComponent(GfAboutOverviewPageComponent, {
        remove: {
          imports: [IonIcon]
        }
      })
      .compileComponents();
  });

  function createComponent() {
    fixture = TestBed.createComponent(GfAboutOverviewPageComponent);
    fixture.detectChanges();
  }

  it('should not display Ghostfolio NG information for the standard distribution', () => {
    isGhostfolioNg = false;

    createComponent();

    expect(fixture.nativeElement.textContent).not.toContain('Ghostfolio NG');
    expect(
      fixture.nativeElement.querySelector(
        'a[href="https://github.com/piggei/ghostfolio"]'
      )
    ).toBeNull();
  });

  it('should display Ghostfolio NG information for the enhanced distribution', () => {
    isGhostfolioNg = true;

    createComponent();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Ghostfolio NG');
    expect(text).toContain(
      'An enhanced version of the open-source Ghostfolio project'
    );
    expect(text).toContain('not an official release');
    expect(text).toContain('The original authors are not responsible');
    expect(text).toContain('please visit our');

    const link = fixture.nativeElement.querySelector(
      'a[href="https://github.com/piggei/ghostfolio"]'
    );

    expect(link).not.toBeNull();
    expect(link.textContent).toContain('GitHub repository');
    expect(link.getAttribute('target')).toBe('_blank');
  });
  it('renders exactly one image build line before the FAQ button', () => {
    isGhostfolioNg = true;
    ghostfolioNgBuildInfo = { buildNumber: '17', upstreamVersion: '3.97.0' };
    createComponent();
    const lines = fixture.nativeElement.querySelectorAll(
      '[data-testid="ghostfolio-ng-version"]'
    );
    expect(lines.length).toBe(1);
    expect(lines[0].textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Ghostfolio-NG version: Build 17 — based on Ghostfolio 3.97.0'
    );
    const section = lines[0].closest('section');
    expect(section.textContent).toContain('please visit our');
    const faq = Array.from(fixture.nativeElement.querySelectorAll('a')).find(
      (a: HTMLAnchorElement) => a.textContent.includes('Frequently Asked')
    ) as HTMLAnchorElement;
    expect(lines[0].compareDocumentPosition(faq)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it.each([undefined, '', '0', '01', '-1', '17.1', '17\n', null, 17])(
    'omits invalid/missing build %s while retaining upstream version',
    (buildNumber) => {
      isGhostfolioNg = true;
      ghostfolioNgBuildInfo = { buildNumber, upstreamVersion: '3.97.0' };
      createComponent();
      const line = fixture.nativeElement.querySelector(
        '[data-testid="ghostfolio-ng-version"]'
      );
      expect(line.textContent.replace(/\s+/g, ' ').trim()).toBe(
        'Ghostfolio-NG version: based on Ghostfolio 3.97.0'
      );
    }
  );

  it.each([
    undefined,
    null,
    {},
    { upstreamVersion: 'dev' },
    { upstreamVersion: '3.97.0\n' }
  ])(
    'does not render placeholders for invalid version metadata %s',
    (metadata) => {
      isGhostfolioNg = true;
      ghostfolioNgBuildInfo = metadata;
      createComponent();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="ghostfolio-ng-version"]'
        )
      ).toBeNull();
      expect(fixture.nativeElement.textContent).not.toMatch(/undefined|null/);
    }
  );

  it('never displays NG build metadata in the original distribution', () => {
    ghostfolioNgBuildInfo = { buildNumber: '17', upstreamVersion: '3.97.0' };
    createComponent();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="ghostfolio-ng-version"]'
      )
    ).toBeNull();
  });
});
