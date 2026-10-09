/**
 * Catálogos de dominio: valores que coinciden con los CHECK de PostgreSQL,
 * sus etiquetas en español y la severidad visual (p-tag) de cada estado.
 */
export type TagSeverity = 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast';

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

function toOptions<T extends string>(labels: Record<T, string>): Option<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

// ---------------------------------------------------------------- Roles
export type AppRole = 'ADMIN' | 'GERENTE' | 'VENDEDOR' | 'ORFEBRE' | 'SUPERVISOR';
export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  VENDEDOR: 'Vendedor',
  ORFEBRE: 'Orfebre',
  SUPERVISOR: 'Supervisor',
};
export const ROLE_OPTIONS = toOptions(ROLE_LABELS);

// ---------------------------------------------------------------- Clientes
export type PersonType = 'NATURAL' | 'EMPRESA';
export const PERSON_TYPE_LABELS: Record<PersonType, string> = { NATURAL: 'Persona natural', EMPRESA: 'Empresa' };
export const PERSON_TYPE_OPTIONS = toOptions(PERSON_TYPE_LABELS);

export type DocumentType = 'DNI' | 'RUC' | 'CE' | 'PASAPORTE' | 'OTRO';
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  DNI: 'DNI',
  RUC: 'RUC',
  CE: 'Carné de extranjería',
  PASAPORTE: 'Pasaporte',
  OTRO: 'Otro',
};
export const DOCUMENT_TYPE_OPTIONS = toOptions(DOCUMENT_TYPE_LABELS);

// ---------------------------------------------------------------- Cotizaciones
export type QuotationStatus = 'BORRADOR' | 'ENVIADA' | 'APROBADA' | 'RECHAZADA' | 'VENCIDA' | 'CANCELADA';
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
};
export const QUOTATION_STATUS_SEVERITY: Record<QuotationStatus, TagSeverity> = {
  BORRADOR: 'secondary',
  ENVIADA: 'info',
  APROBADA: 'success',
  RECHAZADA: 'danger',
  VENCIDA: 'warn',
  CANCELADA: 'contrast',
};
export const QUOTATION_STATUS_OPTIONS = toOptions(QUOTATION_STATUS_LABELS);

// ---------------------------------------------------------------- Pedidos
export type OrderStatus =
  | 'SOLICITUD'
  | 'COTIZADO'
  | 'APROBADO'
  | 'DISENO'
  | 'PRODUCCION'
  | 'CONTROL_CALIDAD'
  | 'LISTO_ENTREGA'
  | 'ENTREGADO'
  | 'CERRADO'
  | 'PAUSADO'
  | 'CANCELADO';
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  SOLICITUD: 'Solicitud',
  COTIZADO: 'Cotizado',
  APROBADO: 'Aprobado',
  DISENO: 'Diseño',
  PRODUCCION: 'Producción',
  CONTROL_CALIDAD: 'Control de calidad',
  LISTO_ENTREGA: 'Listo para entregar',
  ENTREGADO: 'Entregado',
  CERRADO: 'Cerrado',
  PAUSADO: 'Pausado',
  CANCELADO: 'Cancelado',
};
export const ORDER_STATUS_SEVERITY: Record<OrderStatus, TagSeverity> = {
  SOLICITUD: 'secondary',
  COTIZADO: 'secondary',
  APROBADO: 'info',
  DISENO: 'info',
  PRODUCCION: 'warn',
  CONTROL_CALIDAD: 'warn',
  LISTO_ENTREGA: 'success',
  ENTREGADO: 'success',
  CERRADO: 'contrast',
  PAUSADO: 'secondary',
  CANCELADO: 'danger',
};
export const ORDER_STATUS_OPTIONS = toOptions(ORDER_STATUS_LABELS);
/** Estados que cuentan como "pedido activo". */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'SOLICITUD',
  'COTIZADO',
  'APROBADO',
  'DISENO',
  'PRODUCCION',
  'CONTROL_CALIDAD',
  'LISTO_ENTREGA',
  'PAUSADO',
];

export type Priority = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';
export const PRIORITY_LABELS: Record<Priority, string> = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', URGENTE: 'Urgente' };
export const PRIORITY_SEVERITY: Record<Priority, TagSeverity> = {
  BAJA: 'secondary',
  MEDIA: 'info',
  ALTA: 'warn',
  URGENTE: 'danger',
};
export const PRIORITY_OPTIONS = toOptions(PRIORITY_LABELS);

export type PaymentStatus = 'PENDIENTE' | 'PARCIAL' | 'PAGADO';
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDIENTE: 'Pendiente',
  PARCIAL: 'Parcial',
  PAGADO: 'Pagado',
};
export const PAYMENT_STATUS_SEVERITY: Record<PaymentStatus, TagSeverity> = {
  PENDIENTE: 'danger',
  PARCIAL: 'warn',
  PAGADO: 'success',
};

// ---------------------------------------------------------------- Producción
export type StageStatus = 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETADO' | 'BLOQUEADO';
export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  COMPLETADO: 'Completado',
  BLOQUEADO: 'Bloqueado',
};
export const STAGE_STATUS_SEVERITY: Record<StageStatus, TagSeverity> = {
  PENDIENTE: 'secondary',
  EN_PROCESO: 'warn',
  COMPLETADO: 'success',
  BLOQUEADO: 'danger',
};
export const STAGE_STATUS_OPTIONS = toOptions(STAGE_STATUS_LABELS);

// ---------------------------------------------------------------- Materiales
export type MaterialType = 'ORO' | 'PLATA' | 'PLATINO' | 'PIEDRA_PRECIOSA' | 'PIEDRA_SEMIPRECIOSA' | 'OTRO';
export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  ORO: 'Oro',
  PLATA: 'Plata',
  PLATINO: 'Platino',
  PIEDRA_PRECIOSA: 'Piedra preciosa',
  PIEDRA_SEMIPRECIOSA: 'Piedra semipreciosa',
  OTRO: 'Otro',
};
export const MATERIAL_TYPE_OPTIONS = toOptions(MATERIAL_TYPE_LABELS);
export const METAL_TYPES: MaterialType[] = ['ORO', 'PLATA', 'PLATINO'];

export type MaterialUnit = 'g' | 'ct' | 'und';
export const MATERIAL_UNIT_LABELS: Record<MaterialUnit, string> = { g: 'Gramos (g)', ct: 'Quilates (ct)', und: 'Unidades' };
export const MATERIAL_UNIT_OPTIONS = toOptions(MATERIAL_UNIT_LABELS);

export type MovementType = 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'CONSUMO' | 'DEVOLUCION';
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  AJUSTE: 'Ajuste',
  CONSUMO: 'Consumo en pedido',
  DEVOLUCION: 'Devolución',
};
export const MOVEMENT_TYPE_SEVERITY: Record<MovementType, TagSeverity> = {
  ENTRADA: 'success',
  SALIDA: 'warn',
  AJUSTE: 'info',
  CONSUMO: 'warn',
  DEVOLUCION: 'secondary',
};
export const MOVEMENT_TYPE_OPTIONS = toOptions(MOVEMENT_TYPE_LABELS);

export type MaterialOwnership = 'EMPRESA' | 'CLIENTE';
export const OWNERSHIP_LABELS: Record<MaterialOwnership, string> = { EMPRESA: 'Empresa', CLIENTE: 'Cliente' };
export const OWNERSHIP_OPTIONS = toOptions(OWNERSHIP_LABELS);

// ---------------------------------------------------------------- Pagos
export type PaymentMethod = 'EFECTIVO' | 'YAPE' | 'PLIN' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  EFECTIVO: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};
export const PAYMENT_METHOD_OPTIONS = toOptions(PAYMENT_METHOD_LABELS);

// ---------------------------------------------------------------- Entregas
export type DeliveryStatus = 'PENDIENTE' | 'LISTA' | 'ENTREGADA' | 'NO_ENTREGADA';
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDIENTE: 'Pendiente',
  LISTA: 'Lista',
  ENTREGADA: 'Entregada',
  NO_ENTREGADA: 'No entregada',
};
export const DELIVERY_STATUS_SEVERITY: Record<DeliveryStatus, TagSeverity> = {
  PENDIENTE: 'secondary',
  LISTA: 'info',
  ENTREGADA: 'success',
  NO_ENTREGADA: 'danger',
};
export const DELIVERY_STATUS_OPTIONS = toOptions(DELIVERY_STATUS_LABELS);

// ---------------------------------------------------------------- Archivos
export type AttachmentCategory = 'FOTO' | 'DISENO' | 'BOCETO' | 'DOCUMENTO' | 'EVIDENCIA';
export const ATTACHMENT_CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  FOTO: 'Fotografía',
  DISENO: 'Diseño',
  BOCETO: 'Boceto',
  DOCUMENTO: 'Documento',
  EVIDENCIA: 'Evidencia de producción',
};
export const ATTACHMENT_CATEGORY_OPTIONS = toOptions(ATTACHMENT_CATEGORY_LABELS);

// ---------------------------------------------------------------- Historial
export type HistoryEventType =
  | 'CREACION'
  | 'MODIFICACION'
  | 'ESTADO'
  | 'RESPONSABLE'
  | 'PRODUCCION'
  | 'PAGO'
  | 'MATERIAL'
  | 'ARCHIVO'
  | 'ENTREGA'
  | 'CIERRE';
export const HISTORY_EVENT_ICONS: Record<HistoryEventType, string> = {
  CREACION: 'pi pi-plus-circle',
  MODIFICACION: 'pi pi-pencil',
  ESTADO: 'pi pi-sync',
  RESPONSABLE: 'pi pi-user',
  PRODUCCION: 'pi pi-cog',
  PAGO: 'pi pi-wallet',
  MATERIAL: 'pi pi-box',
  ARCHIVO: 'pi pi-paperclip',
  ENTREGA: 'pi pi-truck',
  CIERRE: 'pi pi-lock',
};
