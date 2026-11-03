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

  beforeEach(async () => {
    isGhostfolioNg = false;

    await TestBed.configureTestingModule({
      imports: [GfAboutOverviewPageComponent],
      providers: [
        {
          provide: DataService,
          useValue: {
            fetchInfo: () => ({
              globalPermissions: [],
              isGhostfolioNg
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
});
