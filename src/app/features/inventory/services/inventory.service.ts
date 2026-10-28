import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Currency, Option, TagSeverity } from '../../../core/models/domain';
import { AppError, emptyToNull, toAppError, unwrap } from '../../../shared/utils/db';

const options = <T extends string>(labels: Record<T, string>): Option<T>[] =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

// ---------------------------------------------------------------- Joyas
export type ProductCategory =
  | 'ANILLO'
  | 'ARO_COMPROMISO'
  | 'ARETES'
  | 'COLLAR'
  | 'CADENA'
  | 'DIJE'
  | 'PULSERA'
  | 'BRAZALETE'
  | 'GEMELOS'
  | 'PRENDEDOR'
  | 'RELOJ'
  | 'OTRO';
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  ANILLO: 'Anillo',
  ARO_COMPROMISO: 'Aro de compromiso',
  ARETES: 'Aretes',
  COLLAR: 'Collar',
  CADENA: 'Cadena',
  DIJE: 'Dije',
  PULSERA: 'Pulsera',
  BRAZALETE: 'Brazalete',
  GEMELOS: 'Gemelos',
  PRENDEDOR: 'Prendedor',
  RELOJ: 'Reloj',
  OTRO: 'Otro',
};
export const PRODUCT_CATEGORY_OPTIONS = options(PRODUCT_CATEGORY_LABELS);

export type MetalColor = 'AMARILLO' | 'BLANCO' | 'ROSADO' | 'BICOLOR' | 'TRICOLOR';
export const METAL_COLOR_LABELS: Record<MetalColor, string> = {
  AMARILLO: 'Amarillo',
  BLANCO: 'Blanco',
  ROSADO: 'Rosado',
  BICOLOR: 'Bicolor',
  TRICOLOR: 'Tricolor',
};
export const METAL_COLOR_OPTIONS = options(METAL_COLOR_LABELS);

export type PieceStatus = 'STOCK' | 'RESERVADO' | 'RESERVADA' | 'VENDIDO' | 'VENDIDA' | 'MONTADA' | 'DEVUELTA' | 'BAJA';
export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  STOCK: 'En stock',
  RESERVADO: 'Reservada',
  RESERVADA: 'Reservada',
  VENDIDO: 'Vendida',
  VENDIDA: 'Vendida',
  MONTADA: 'Montada en joya',
  DEVUELTA: 'Devuelta al cliente',
  BAJA: 'De baja',
};
export const PIECE_STATUS_SEVERITY: Record<PieceStatus, TagSeverity> = {
  STOCK: 'success',
  RESERVADO: 'warn',
  RESERVADA: 'warn',
  VENDIDO: 'secondary',
  VENDIDA: 'secondary',
  MONTADA: 'info',
  DEVUELTA: 'secondary',
  BAJA: 'danger',
};

export interface ProductGem {
  id?: string;
  gem_id: string | null;
  role: 'CENTRAL' | 'LATERAL' | 'PAVE' | 'OTRA';
  description: string | null;
  quantity: number;
  total_carat: number | null;
  gem?: Gem | null;
}
export const GEM_ROLE_LABELS: Record<ProductGem['role'], string> = { CENTRAL: 'Central', LATERAL: 'Lateral', PAVE: 'Pavé', OTRA: 'Otra' };
export const GEM_ROLE_OPTIONS = options(GEM_ROLE_LABELS);

export interface Product {
  id: string;
  code: string;
  name: string;
  category: ProductCategory;
  material_id: string | null;
  metal: string | null;
  metal_color: MetalColor | null;
  weight_g: number | null;
  size: string | null;
  description: string | null;
  cost: number;
  price: number;
  currency: Currency;
  photo_path: string | null;
  status: PieceStatus;
  order_id: string | null;
  sold_at: string | null;
  notes: string | null;
  created_at: string;
  gems?: ProductGem[];
  order?: { id: string; number: string } | null;
  photo_url?: string;
}

export type ProductInput = Pick<
  Product,
  'code' | 'name' | 'category' | 'material_id' | 'metal' | 'metal_color' | 'weight_g' | 'size' | 'description' | 'cost' | 'price' | 'currency' | 'notes'
>;

// ---------------------------------------------------------------- Piedras (escala GIA)
export type GemType = 'DIAMANTE' | 'ESMERALDA' | 'RUBI' | 'ZAFIRO' | 'TANZANITA' | 'AMATISTA' | 'TOPACIO' | 'AGUAMARINA' | 'PERLA' | 'OTRA';
export const GEM_TYPE_LABELS: Record<GemType, string> = {
  DIAMANTE: 'Diamante',
  ESMERALDA: 'Esmeralda',
  RUBI: 'Rubí',
  ZAFIRO: 'Zafiro',
  TANZANITA: 'Tanzanita',
  AMATISTA: 'Amatista',
  TOPACIO: 'Topacio',
  AGUAMARINA: 'Aguamarina',
  PERLA: 'Perla',
  OTRA: 'Otra',
};
export const GEM_TYPE_OPTIONS = options(GEM_TYPE_LABELS);

export type GemShape = 'REDONDO' | 'PRINCESA' | 'OVALO' | 'PERA' | 'ESMERALDA' | 'CORAZON' | 'MARQUISE' | 'COJIN' | 'RADIANT' | 'ASSCHER' | 'BAGUETTE' | 'TRILLION' | 'OTRA';
export const GEM_SHAPE_LABELS: Record<GemShape, string> = {
  REDONDO: 'Redondo (brillante)',
  PRINCESA: 'Princesa',
  OVALO: 'Óvalo',
  PERA: 'Pera',
  ESMERALDA: 'Esmeralda',
  CORAZON: 'Corazón',
  MARQUISE: 'Marquesa',
  COJIN: 'Cojín',
  RADIANT: 'Radiant',
  ASSCHER: 'Asscher',
  BAGUETTE: 'Baguette',
  TRILLION: 'Trillion',
  OTRA: 'Otra',
};
export const GEM_SHAPE_OPTIONS = options(GEM_SHAPE_LABELS);

/** Escala de color GIA: D–F incoloro, G–J casi incoloro, K–M tenue, N–R muy claro, S–Z claro. */
export const DIAMOND_COLORS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export function colorGroup(c: string | null): string {
  if (!c || !/^[D-Z]$/.test(c)) return '';
  if (c <= 'F') return 'Incoloro';
  if (c <= 'J') return 'Casi incoloro';
  if (c <= 'M') return 'Tenue';
  if (c <= 'R') return 'Muy claro';
  return 'Claro';
}
export const DIAMOND_COLOR_OPTIONS: Option[] = DIAMOND_COLORS.map((c) => ({ value: c, label: `${c} · ${colorGroup(c)}` }));

export type Clarity = 'FL' | 'IF' | 'VVS1' | 'VVS2' | 'VS1' | 'VS2' | 'SI1' | 'SI2' | 'I1' | 'I2' | 'I3';
export const CLARITY_LABELS: Record<Clarity, string> = {
  FL: 'FL · Flawless',
  IF: 'IF · Internally Flawless',
  VVS1: 'VVS1 · Very Very Slightly Included',
  VVS2: 'VVS2 · Very Very Slightly Included',
  VS1: 'VS1 · Very Slightly Included',
  VS2: 'VS2 · Very Slightly Included',
  SI1: 'SI1 · Slightly Included',
  SI2: 'SI2 · Slightly Included',
  I1: 'I1 · Included',
  I2: 'I2 · Included',
  I3: 'I3 · Included',
};
export const CLARITY_OPTIONS = options(CLARITY_LABELS);

export type Grade = 'EXCELENTE' | 'MUY_BUENA' | 'BUENA' | 'REGULAR' | 'POBRE';
export const GRADE_LABELS: Record<Grade, string> = {
  EXCELENTE: 'Excelente (Excellent)',
  MUY_BUENA: 'Muy buena (Very Good)',
  BUENA: 'Buena (Good)',
  REGULAR: 'Regular (Fair)',
  POBRE: 'Pobre (Poor)',
};
export const GRADE_SHORT: Record<Grade, string> = { EXCELENTE: 'EX', MUY_BUENA: 'VG', BUENA: 'G', REGULAR: 'F', POBRE: 'P' };
export const GRADE_OPTIONS = options(GRADE_LABELS);

export type Fluorescence = 'NINGUNA' | 'DEBIL' | 'MEDIA' | 'FUERTE' | 'MUY_FUERTE';
export const FLUORESCENCE_LABELS: Record<Fluorescence, string> = {
  NINGUNA: 'Ninguna',
  DEBIL: 'Débil',
  MEDIA: 'Media',
  FUERTE: 'Fuerte',
  MUY_FUERTE: 'Muy fuerte',
};
export const FLUORESCENCE_OPTIONS = options(FLUORESCENCE_LABELS);

export const LAB_OPTIONS: Option[] = ['GIA', 'IGI', 'HRD', 'AGS', 'GCAL', 'OTRO'].map((v) => ({ value: v, label: v === 'OTRO' ? 'Otro' : v }));

export interface Gem {
  id: string;
  code: string;
  gem_type: GemType;
  shape: GemShape;
  carat: number;
  color: string | null;
  clarity: Clarity | null;
  cut_grade: Grade | null;
  polish: Grade | null;
  symmetry: Grade | null;
  fluorescence: Fluorescence | null;
  length_mm: number | null;
  width_mm: number | null;
  depth_mm: number | null;
  lab: string | null;
  certificate_number: string | null;
  origin: 'EMPRESA' | 'CLIENTE';
  customer_id: string | null;
  cost: number;
  price: number;
  currency: Currency;
  photo_path: string | null;
  status: PieceStatus;
  product_id: string | null;
  order_id: string | null;
  notes: string | null;
  product?: { id: string; code: string; name: string } | null;
  order?: { id: string; number: string } | null;
  customer?: { id: string; full_name: string } | null;
}

export type GemInput = Omit<Gem, 'id' | 'status' | 'product_id' | 'order_id' | 'photo_path' | 'product' | 'order' | 'customer'>;

/** Resumen de una piedra: "Diamante redondo 0.50 ct · G · VS1 · EX". */
export function gemSummary(g: Pick<Gem, 'gem_type' | 'shape' | 'carat' | 'color' | 'clarity' | 'cut_grade'>): string {
  const parts = [`${GEM_TYPE_LABELS[g.gem_type]} ${GEM_SHAPE_LABELS[g.shape].split(' ')[0].toLowerCase()} ${Number(g.carat).toFixed(2)} ct`];
  if (g.color) parts.push(g.color);
  if (g.clarity) parts.push(g.clarity);
  if (g.cut_grade) parts.push(GRADE_SHORT[g.cut_grade]);
  return parts.join(' · ');
}

const BUCKET = 'products';
const PRODUCT_SELECT = '*, order:orders(id, number), gems:product_gems(*, gem:gems(*))';
const GEM_SELECT = '*, product:products!gems_product_id_fkey(id, code, name), order:orders(id, number), customer:customers(id, full_name)';

/** Joyas de vitrina y piedras registradas (0020_vitrina_joyas_piedras.sql). */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly db = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  // ------------------------------------------------------------ Joyas
  async products(filters: { status?: string | null; category?: string | null } = {}): Promise<Product[]> {
    let query = this.db.from('products').select(PRODUCT_SELECT).order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.category) query = query.eq('category', filters.category);
    return this.withPhotos(unwrap(await query) as Product[]);
  }

  async saveProduct(id: string | null, input: ProductInput, gems: ProductGem[]): Promise<string> {
    const data = emptyToNull(input);
    const row = id
      ? (unwrap(await this.db.from('products').update(data).eq('id', id).select('id').single()) as { id: string })
      : (unwrap(await this.db.from('products').insert(data).select('id').single()) as { id: string });
    // Piedras: se reemplazan todas (los triggers montan y desmontan las registradas).
    unwrap(await this.db.from('product_gems').delete().eq('product_id', row.id));
    if (gems.length) {
      unwrap(
        await this.db.from('product_gems').insert(
          gems.map((g) => ({
            product_id: row.id,
            gem_id: g.gem_id,
            role: g.role,
            description: g.description?.trim() || null,
            quantity: g.quantity,
            total_carat: g.total_carat,
          })),
        ),
      );
    }
    return row.id;
  }

  async setProductStatus(id: string, status: 'STOCK' | 'BAJA'): Promise<void> {
    unwrap(await this.db.from('products').update({ status }).eq('id', id));
  }

  // ------------------------------------------------------------ Piedras
  async gems(filters: { status?: string | null; type?: string | null } = {}): Promise<Gem[]> {
    let query = this.db.from('gems').select(GEM_SELECT).order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('gem_type', filters.type);
    return unwrap(await query) as Gem[];
  }

  async saveGem(id: string | null, input: GemInput): Promise<string> {
    const data = emptyToNull(input);
    const row = id
      ? (unwrap(await this.db.from('gems').update(data).eq('id', id).select('id').single()) as { id: string })
      : (unwrap(await this.db.from('gems').insert(data).select('id').single()) as { id: string });
    return row.id;
  }

  async setGemStatus(id: string, status: 'STOCK' | 'BAJA'): Promise<void> {
    unwrap(await this.db.from('gems').update({ status }).eq('id', id));
  }

  /** Piezas disponibles para vender en un pedido (joyas en stock y piedras sueltas en stock). */
  async available(): Promise<{ products: Product[]; gems: Gem[] }> {
    const [products, gems] = await Promise.all([
      this.db.from('products').select(PRODUCT_SELECT).eq('status', 'STOCK').order('name'),
      this.db.from('gems').select(GEM_SELECT).eq('status', 'STOCK').eq('origin', 'EMPRESA').order('carat', { ascending: false }),
    ]);
    return { products: await this.withPhotos(unwrap(products) as Product[]), gems: unwrap(gems) as Gem[] };
  }

  // ------------------------------------------------------------ Fotos
  async uploadPhoto(table: 'products' | 'gems', id: string, file: File, previous: string | null): Promise<void> {
    if (file.size > 5 * 1024 * 1024) throw new AppError('La foto supera el tamaño máximo de 5 MB.');
    const orgId = this.auth.profile()?.org_id;
    if (!orgId) throw new AppError('No se encontró la empresa del usuario.');
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${orgId}/${table}/${id}-${Date.now()}.${ext}`;
    const { error } = await this.db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw toAppError(error);
    unwrap(await this.db.from(table).update({ photo_path: path }).eq('id', id));
    if (previous) await this.db.storage.from(BUCKET).remove([previous]);
  }

  async photoUrl(path: string | null): Promise<string | undefined> {
    if (!path) return undefined;
    const { data } = await this.db.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    return data?.signedUrl;
  }

  private async withPhotos(rows: Product[]): Promise<Product[]> {
    const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
    if (!paths.length) return rows;
    const { data } = await this.db.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
    const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
    return rows.map((r) => ({ ...r, photo_url: (r.photo_path && urls.get(r.photo_path)) || undefined }));
  }
}
