import { AppRole } from '../models/domain';

/**
 * Permisos de navegación por módulo (solo UX). La autorización real está en las políticas RLS
 * de Supabase (supabase/migrations/0008_rls_storage.sql); mantener ambas matrices alineadas.
 */
export const MODULE_ROLES = {
  dashboard: ['ADMIN', 'GERENTE'],
  customers: ['ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'],
  customersWrite: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  quotations: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  orders: ['ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR', 'ORFEBRE'],
  ordersWrite: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  ordersStatus: ['ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'],
  production: ['ADMIN', 'GERENTE', 'SUPERVISOR', 'ORFEBRE'],
  productionManage: ['ADMIN', 'GERENTE', 'SUPERVISOR'],
  materials: ['ADMIN', 'GERENTE', 'SUPERVISOR'],
  materialsWrite: ['ADMIN', 'GERENTE'],
  payments: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  paymentsVoid: ['ADMIN', 'GERENTE'],
  deliveries: ['ADMIN', 'GERENTE', 'VENDEDOR', 'SUPERVISOR'],
  settings: ['ADMIN'],
} as const satisfies Record<string, readonly AppRole[]>;

export type ModuleKey = keyof typeof MODULE_ROLES;
