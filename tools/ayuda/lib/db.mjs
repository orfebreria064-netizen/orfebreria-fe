// Cliente de Supabase con la sesión del usuario de demostración (misma URL y clave pública que la app).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export async function conectar() {
  const env = await readFile(path.join(raiz, 'src/environments/environment.ts'), 'utf8');
  const db = createClient(/supabaseUrl:\s*'([^']+)'/.exec(env)[1], /supabaseKey:\s*'([^']+)'/.exec(env)[1], {
    auth: { persistSession: false },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email: process.env.AYUDA_EMAIL ?? '',
    password: process.env.AYUDA_PASSWORD ?? '',
  });
  if (error) throw new Error(`No se pudo iniciar sesión en Supabase: ${error.message}`);
  db.usuarioId = data.user.id;
  return db;
}

/** Lanza el error de Supabase si lo hay; devuelve los datos. */
export function ok({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/** Cliente demo activo más reciente (lo crea el guion de Clientes). */
export async function clienteDemo(db) {
  const c = ok(
    await db.from('customers').select('id, full_name').like('email', '%@ejemplo.pe').eq('active', true)
      .order('created_at', { ascending: false }).limit(1),
  )[0];
  if (!c) throw new Error('No hay cliente de demostración activo: grabe primero "customers".');
  return c;
}

/** Pedido demo más reciente que cumpla el filtro. */
export async function pedidoDemo(db, filtro = (q) => q) {
  const cliente = await clienteDemo(db);
  const p = ok(
    await filtro(db.from('orders').select('id, number, title, status, balance, total').eq('customer_id', cliente.id))
      .order('created_at', { ascending: false }).limit(1),
  )[0];
  if (!p) throw new Error('No hay pedido de demostración: grabe primero "quotations" y "orders".');
  return p;
}
