import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AppRole } from '../models/domain';

/** Requiere sesión, perfil activo y empresa no suspendida. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  if (!auth.isActive()) return router.parseUrl('/cuenta-pendiente');
  if (auth.isBlocked()) return router.parseUrl('/cuenta-suspendida');
  return true;
};

/** Solo para usuarios sin sesión (login/solicitud de acceso). */
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

/** Panel de plataforma: solo superadministradores (las RPC lo vuelven a verificar). */
export const platformGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isPlatformAdmin() || inject(Router).parseUrl(auth.homeUrl());
};

/** Redirige "/" a la página inicial del rol. */
export const homeRedirectGuard: CanActivateFn = () => inject(Router).parseUrl(inject(AuthService).homeUrl());
