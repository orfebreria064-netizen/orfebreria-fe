import { ApplicationConfig, LOCALE_ID, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeEsPe from '@angular/common/locales/es-PE';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService, MessageService } from 'primeng/api';

import { routes } from './app.routes';
import { AurumPreset } from './theme';
import { AuthService } from './core/auth/auth.service';
import { apiInterceptor } from './core/auth/api.interceptor';
import { PRIMENG_ES } from './core/models/primeng-es';

registerLocaleData(localeEsPe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideHttpClient(withInterceptors([apiInterceptor])),
    providePrimeNG({
      theme: { preset: AurumPreset, options: { darkModeSelector: '.app-dark', cssLayer: false } },
      translation: PRIMENG_ES,
    }),
    { provide: LOCALE_ID, useValue: 'es-PE' },
    MessageService,
    ConfirmationService,
    provideAppInitializer(() => inject(AuthService).init()),
  ],
};
