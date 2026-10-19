import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TokenService } from './token.service';

/** Endpoints públicos: un 401 aquí es un error de credenciales, no una sesión vencida. */
const PUBLIC = ['/Login/validausuario', '/Login/aceptarinvitacion', '/Login/restablecerclave', '/Login/invitacion/'];

/** Agrega el JWT a las llamadas a la API y cierra la sesión si la API responde 401. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const tokens = inject(TokenService);
  const router = inject(Router);
  const token = tokens.token();
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && token && !PUBLIC.some((p) => req.url.includes(p))) {
        tokens.clear();
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
