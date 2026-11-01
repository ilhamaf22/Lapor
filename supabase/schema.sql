-- =====================================================================
--  LAPOR KINERJA — skema database Supabase
--  Jalankan sekali di Supabase: SQL Editor → New query → tempel → Run
-- =====================================================================

-- ---------- Tahun / periode kinerja (agar bisa dipakai tiap tahun) ----------
create table if not exists public.periode (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tahun       int  not null,
  label       text not null,                 -- mis. "SKP 2026"
  aktif       boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, tahun)
);

-- ---------- Rencana Kinerja ----------
create table if not exists public.rencana_kinerja (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  periode_id  uuid not null references public.periode(id) on delete cascade,
  nomor       int  not null,
  nama        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- Indikator Kinerja Individu ----------
create table if not exists public.iki (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rk_id       uuid not null references public.rencana_kinerja(id) on delete cascade,
  kode        text not null,                 -- mis. "4.2"
  nama        text not null,
  kata_kunci  text[] not null default '{}',  -- dipakai klasifikasi tanpa AI
  folder_drive text,                         -- opsional: link folder Drive tujuan
  created_at  timestamptz not null default now()
);

-- ---------- Kegiatan ----------
create table if not exists public.kegiatan (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tanggal     date not null default (now() at time zone 'Asia/Makassar')::date,
  keterangan  text not null,
  iki_id      uuid references public.iki(id) on delete set null,
  sumber_kategori text check (sumber_kategori in ('kata_kunci','ai','manual')),
  alasan_kategori text,
  asal        text not null default 'hp' check (asal in ('hp','web')),
  created_at  timestamptz not null default now()
);
create index if not exists kegiatan_user_tanggal on public.kegiatan(user_id, tanggal);

-- ---------- Foto bukti dukung ----------
create table if not exists public.foto (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kegiatan_id uuid not null references public.kegiatan(id) on delete cascade,
  path        text not null,                 -- path di bucket "bukti"
  created_at  timestamptz not null default now()
);
create index if not exists foto_kegiatan on public.foto(kegiatan_id);
-- Arsip: foto yang sudah diunduh (ZIP/Drive) boleh dihapus dari server; barisnya tetap disimpan
alter table public.foto add column if not exists diekspor_at timestamptz;
alter table public.foto add column if not exists dihapus_at  timestamptz;

-- ---------- Pengaturan pribadi ----------
create table if not exists public.pengaturan (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  gemini_api_key  text,
  gemini_model    text default 'gemini-3.5-flash-lite',
  google_client_id text,
  drive_parent_id text,                      -- opsional: folder induk di Drive
  nama_pegawai    text,
  updated_at      timestamptz not null default now()
);

-- ---------- Row Level Security: tiap user hanya melihat datanya sendiri ----------
do $$
declare t text;
begin
  foreach t in array array['periode','rencana_kinerja','iki','kegiatan','foto','pengaturan'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "pemilik" on public.%I', t);
    execute format('create policy "pemilik" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- Storage bucket foto (privat) ----------
insert into storage.buckets (id, name, public)
values ('bukti', 'bukti', false)
on conflict (id) do nothing;

drop policy if exists "bukti milik sendiri - baca"  on storage.objects;
drop policy if exists "bukti milik sendiri - tulis" on storage.objects;
drop policy if exists "bukti milik sendiri - hapus" on storage.objects;
drop policy if exists "bukti milik sendiri - ubah"  on storage.objects;

create policy "bukti milik sendiri - baca" on storage.objects for select
  using (bucket_id = 'bukti' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bukti milik sendiri - tulis" on storage.objects for insert
  with check (bucket_id = 'bukti' and (storage.foldername(name))[1] = auth.uid()::text);
-- "ubah" diperlukan agar pengiriman ulang dari HP (setelah sinyal putus) menimpa foto yang sama, bukan menduplikat
create policy "bukti milik sendiri - ubah" on storage.objects for update
  using (bucket_id = 'bukti' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bukti milik sendiri - hapus" on storage.objects for delete
  using (bucket_id = 'bukti' and (storage.foldername(name))[1] = auth.uid()::text);
