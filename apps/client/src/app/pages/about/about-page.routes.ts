import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { publicRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { AboutPageComponent } from './about-page.component';
import { ghostfolioNgGuard } from './ghostfolio-ng/ghostfolio-ng.guard';

export const routes: Routes = [
  {
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        loadChildren: () =>
          import('./overview/about-overview-page.routes').then((m) => m.routes)
      },
      {
        path: publicRoutes.about.subRoutes.changelog.path,
        loadChildren: () =>
          import('./changelog/changelog-page.routes').then((m) => m.routes)
      },
      {
        canMatch: [ghostfolioNgGuard],
        path: publicRoutes.about.subRoutes.ghostfolioNg.path,
        loadComponent: () =>
          import('./ghostfolio-ng/ghostfolio-ng-page.component').then(
            (m) => m.GfGhostfolioNgPageComponent
          ),
        title: publicRoutes.about.subRoutes.ghostfolioNg.title
      },
      {
        path: publicRoutes.about.subRoutes.license.path,
        loadChildren: () =>
          import('./license/license-page.routes').then((m) => m.routes)
      },
      {
        path: publicRoutes.about.subRoutes.ossFriends.path,
        loadChildren: () =>
          import('./oss-friends/oss-friends-page.routes').then((m) => m.routes)
      },
      {
        path: publicRoutes.about.subRoutes.privacyPolicy.path,
        loadChildren: () =>
          import('./privacy-policy/privacy-policy-page.routes').then(
            (m) => m.routes
          )
      },
      {
        path: publicRoutes.about.subRoutes.termsOfService.path,
        loadChildren: () =>
          import('./terms-of-service/terms-of-service-page.routes').then(
            (m) => m.routes
          )
      }
    ],
    component: AboutPageComponent,
    path: '',
    title: publicRoutes.about.title
  }
];
