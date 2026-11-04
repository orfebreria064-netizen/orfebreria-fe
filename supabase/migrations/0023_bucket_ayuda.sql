-- =====================================================================
-- 0023 · Bucket público "ayuda": videos tutoriales de cada opción del menú
-- Rutas: videos/{modulo}.mp4 (p. ej. videos/customers.mp4)
-- Lectura pública (el reproductor de la ayuda usa la URL pública);
-- solo ADMIN sube, reemplaza o borra.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ayuda', 'ayuda', true, 52428800, array['video/mp4'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ayuda_insert_admin" on storage.objects;
create policy "ayuda_insert_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ayuda' and public.has_role('ADMIN'));

drop policy if exists "ayuda_update_admin" on storage.objects;
create policy "ayuda_update_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'ayuda' and public.has_role('ADMIN'))
  with check (bucket_id = 'ayuda' and public.has_role('ADMIN'));

drop policy if exists "ayuda_delete_admin" on storage.objects;
create policy "ayuda_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'ayuda' and public.has_role('ADMIN'));

-- Upsert de supabase-js necesita poder leer el objeto existente
drop policy if exists "ayuda_select_admin" on storage.objects;
create policy "ayuda_select_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'ayuda' and public.has_role('ADMIN'));
