import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AppRole } from '../models/domain';

/** Requiere sesión y perfil activo. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  if (!auth.isActive()) return router.parseUrl('/cuenta-pendiente');
  return true;
};

/** Solo para usuarios sin sesión (login/registro). */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return true;
  return router.parseUrl(auth.isActive() ? auth.homeUrl() : '/cuenta-pendiente');
};

/** Restringe por rol usando `data: { roles: [...] }`. Es UX; RLS es la seguridad real. */
export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const roles = (route.data['roles'] as readonly AppRole[] | undefined) ?? [];
  if (roles.length === 0 || auth.hasRole(...roles)) return true;
  return router.parseUrl(auth.homeUrl());
};

/** Redirige "/" a la página inicial del rol. */
export const homeRedirectGuard: CanActivateFn = () => inject(Router).parseUrl(inject(AuthService).homeUrl());
