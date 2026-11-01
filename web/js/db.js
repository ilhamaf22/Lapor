// Koneksi Supabase, login, dan operasi data
// Library Supabase dimuat dari vendor/supabase.js (lokal, ikut tersimpan di cache → bisa dibuka offline)
import { $, toast, kompresFoto, slug, antrianSemua, antrianHapus, antrianTambah } from './util.js';
import { klasifikasi, klasifikasiKataKunci } from './klasifikasi.js';

/** fetch dengan batas waktu: sinyal lemah tidak membuat aplikasi menggantung selamanya */
function fetchBatas(input, init = {}) {
  const ms = init.method && init.method !== 'GET' ? 90000 : 20000;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (init.signal) init.signal.addEventListener('abort', () => ctl.abort());
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(t));
}
const tunggu = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Ambil sesi tersimpan langsung dari perangkat (dipakai saat offline / token kedaluwarsa tanpa sinyal) */
function sesiTersimpan() {
  try {
    const k = Object.keys(localStorage).find(k => /^sb-.+-auth-token$/.test(k));
    const s = k && JSON.parse(localStorage.getItem(k));
    return s?.user ? s : null;
  } catch { return null; }
}

// ---------- Konfigurasi ----------
function bacaConfig() {
  const c = window.LAPOR_CONFIG || {};
  let url = c.SUPABASE_URL, key = c.SUPABASE_ANON_KEY;
  if (!url || !key) {
    try { const s = JSON.parse(localStorage.getItem('lapor-config') || '{}'); url = url || s.url; key = key || s.key; } catch {}
  }
  return url && key ? { url, key } : null;
}

export let sb = null;
export let user = null;

function layarSetup(root) {
  root.innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="brand-big"><span class="logo">LK</span><div><b>Lapor Kinerja</b><small>Hubungkan ke Supabase</small></div></div>
    <p class="muted">Isi sekali saja. Ambil dari Supabase → <b>Project Settings → API</b>.</p>
    <label>Project URL<input id="cfg-url" placeholder="https://xxxx.supabase.co"></label>
    <label>Anon / publishable key<input id="cfg-key" placeholder="eyJhbGciOi..."></label>
    <button class="btn primary block" id="cfg-simpan">Simpan & lanjut</button>
  </div></div>`;
  $('#cfg-simpan').onclick = () => {
    const url = $('#cfg-url').value.trim(), key = $('#cfg-key').value.trim();
    if (!url || !key) return toast('Isi keduanya', 'err');
    localStorage.setItem('lapor-config', JSON.stringify({ url, key }));
    location.reload();
  };
}

function layarLogin(root) {
  root.innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="brand-big"><span class="logo">LK</span><div><b>Lapor Kinerja</b><small>Catat kegiatan · bukti dukung · IKI</small></div></div>
    <label>Email<input id="lg-email" type="email" autocomplete="email"></label>
    <label>Kata sandi<input id="lg-pass" type="password" autocomplete="current-password"></label>
    <button class="btn primary block" id="lg-masuk">Masuk</button>
    <button class="btn ghost block" id="lg-daftar">Belum punya akun? Daftar</button>
    <p class="muted tiny">Login sekali, setelah itu aplikasi mengingatmu.</p>
  </div></div>`;
  const ambil = () => ({ email: $('#lg-email').value.trim(), password: $('#lg-pass').value });
  $('#lg-masuk').onclick = async () => {
    const { error } = await sb.auth.signInWithPassword(ambil());
    if (error) toast(error.message, 'err'); else location.reload();
  };
  $('#lg-daftar').onclick = async () => {
    const { data, error } = await sb.auth.signUp(ambil());
    if (error) return toast(error.message, 'err');
    if (data.session) location.reload();
    else toast('Cek email untuk konfirmasi, lalu masuk.', 'ok');
  };
}

/** Pastikan sudah terhubung & login. Mengembalikan true jika siap. */
export async function siapkan(root) {
  const cfg = bacaConfig();
  if (!cfg) { layarSetup(root); return false; }
  sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: fetchBatas }
  });
  // Sesi yang sudah tersimpan di HP langsung dipakai (instan, juga offline). Pembaruan token berjalan di latar belakang.
  let sesi = sesiTersimpan();
  if (sesi) sb.auth.getSession().catch(() => {});
  else { try { sesi = (await tunggu(sb.auth.getSession(), 8000)).data?.session; } catch {} }
  if (!sesi) { layarLogin(root); return false; }
  user = sesi.user;
  return true;
}

export async function keluar() { await sb.auth.signOut(); location.reload(); }

// ---------- Pengaturan ----------
let _peng = null;
export async function pengaturan(force = false) {
  if (_peng && !force) return _peng;
  const { data } = await sb.from('pengaturan').select('*').maybeSingle();
  _peng = data || { gemini_model: 'gemini-3.5-flash-lite' };
  try { localStorage.setItem('lapor-peng', JSON.stringify(_peng)); } catch {}
  return _peng;
}
export function pengaturanCache() {
  try { return JSON.parse(localStorage.getItem('lapor-peng') || 'null'); } catch { return null; }
}
export async function simpanPengaturan(p) {
  const { error } = await sb.from('pengaturan').upsert({ ...p, user_id: user.id, updated_at: new Date().toISOString() });
  if (error) throw error;
  _peng = null;
  return pengaturan(true);
}

// ---------- Periode, RK, IKI ----------
export async function daftarPeriode() {
  const { data, error } = await sb.from('periode').select('*').order('tahun', { ascending: false });
  if (error) throw error;
  try { localStorage.setItem('lapor-periode', JSON.stringify(data)); } catch {}
  return data;
}

/** RK/IKI dari cache perangkat — instan & bisa offline. null bila belum pernah dimuat. */
export function ikiTersimpan(tanggal) {
  try {
    const semua = JSON.parse(localStorage.getItem('lapor-periode') || '[]');
    const th = Number(String(tanggal).slice(0, 4));
    const per = semua.find(p => p.tahun === th) || semua.find(p => p.aktif) || semua[0];
    if (!per) return null;
    const c = JSON.parse(localStorage.getItem('lapor-iki-' + per.id) || 'null');
    return c ? { per, ...c } : null;
  } catch { return null; }
}

export async function periodeUntukTanggal(tanggal) {
  const semua = await daftarPeriode();
  const th = Number(String(tanggal).slice(0, 4));
  return semua.find(p => p.tahun === th) || semua.find(p => p.aktif) || semua[0] || null;
}

/** Daftar IKI (flat) beserta info RK untuk satu periode */
export async function daftarIki(periodeId) {
  const { data, error } = await sb.from('rencana_kinerja')
    .select('id,nomor,nama,iki(id,kode,nama,kata_kunci,folder_drive)')
    .eq('periode_id', periodeId).order('nomor');
  if (error) throw error;
  const rk = data.map(r => ({ ...r, iki: (r.iki || []).sort((a, b) => a.kode.localeCompare(b.kode, undefined, { numeric: true })) }));
  const flat = rk.flatMap(r => r.iki.map(i => ({ ...i, rk_id: r.id, rk_nomor: r.nomor, rk_nama: r.nama })));
  try { localStorage.setItem('lapor-iki-' + periodeId, JSON.stringify({ rk, flat })); } catch {}
  return { rk, flat };
}

/** Buat periode baru + RK + IKI dari objek SKP {tahun,label,rk:[{nomor,nama,iki:[...]}]} */
export async function buatPeriodeDariSkp(skp, { aktif = true } = {}) {
  const { data: ada } = await sb.from('periode').select('id').eq('tahun', skp.tahun).maybeSingle();
  if (ada) throw new Error(`Periode ${skp.tahun} sudah ada. Hapus dulu atau ubah tahunnya.`);
  if (aktif) await sb.from('periode').update({ aktif: false }).eq('user_id', user.id);
  const { data: per, error } = await sb.from('periode')
    .insert({ tahun: skp.tahun, label: skp.label || `SKP ${skp.tahun}`, aktif }).select().single();
  if (error) throw error;
  for (const rk of skp.rk) {
    const { data: r, error: e1 } = await sb.from('rencana_kinerja')
      .insert({ periode_id: per.id, nomor: rk.nomor, nama: rk.nama }).select().single();
    if (e1) throw e1;
    if (rk.iki?.length) {
      const { error: e2 } = await sb.from('iki').insert(rk.iki.map(i => ({
        rk_id: r.id, kode: i.kode, nama: i.nama, kata_kunci: i.kata_kunci || [], folder_drive: i.folder_drive || null
      })));
      if (e2) throw e2;
    }
  }
  return per;
}

// ---------- Kegiatan ----------
export async function kegiatanRentang(dari, sampai) {
  const { data, error } = await sb.from('kegiatan')
    .select('*, foto(id,path,diekspor_at,dihapus_at)')
    .gte('tanggal', dari).lte('tanggal', sampai)
    .order('tanggal').order('created_at');
  if (error) throw error;
  return data;
}

async function unggahFoto(kegiatanId, tanggal, files, keterangan) {
  const baris = [];
  let n = 0;
  for (const f of files) {
    n++;
    const blob = f instanceof Blob ? await kompresFoto(f) : f;
    const ext = (blob.type || '').includes('png') ? 'png' : 'jpg';
    const path = `${user.id}/${tanggal.slice(0, 7)}/${kegiatanId}/${Date.now()}_${n}_${slug(keterangan, 30)}.${ext}`;
    const { error } = await sb.storage.from('bukti').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) throw error;
    baris.push({ kegiatan_id: kegiatanId, path });
  }
  if (baris.length) {
    const { error } = await sb.from('foto').insert(baris);
    if (error) throw error;
  }
}
export { unggahFoto };

/**
 * Simpan satu kegiatan (+foto) lalu kategorikan.
 * Kata kunci → langsung; kalau perlu AI → simpan dulu, AI menyusul (agar terasa cepat).
 */
export async function simpanKegiatan({ tanggal, keterangan, files = [], asal = 'hp', iki_id = undefined, sumber = undefined, alasan = null }) {
  const per = await periodeUntukTanggal(tanggal);
  const ikiList = per ? (await daftarIki(per.id)).flat : [];
  let kat = null;
  if (iki_id !== undefined) kat = iki_id ? { iki_id, sumber: sumber || 'manual', alasan } : null;

  const { data: keg, error } = await sb.from('kegiatan').insert({
    tanggal, keterangan, asal,
    iki_id: kat?.iki_id || null, sumber_kategori: kat?.sumber || null, alasan_kategori: kat?.alasan || null
  }).select().single();
  if (error) throw error;

  await unggahFoto(keg.id, tanggal, files, keterangan);

  if (iki_id === undefined && ikiList.length) {
    const peng = await pengaturan();
    const h = (await klasifikasi([{ id: keg.id, teks: keterangan }], ikiList, peng)).get(keg.id);
    if (h) {
      await sb.from('kegiatan').update({ iki_id: h.iki_id, sumber_kategori: h.sumber, alasan_kategori: h.alasan }).eq('id', keg.id);
      Object.assign(keg, { iki_id: h.iki_id, sumber_kategori: h.sumber, alasan_kategori: h.alasan });
    }
  }
  return keg;
}

export async function ubahKegiatan(id, patch) {
  const { error } = await sb.from('kegiatan').update(patch).eq('id', id);
  if (error) throw error;
}

export async function hapusKegiatan(keg) {
  const paths = (keg.foto || []).map(f => f.path);
  if (paths.length) await sb.storage.from('bukti').remove(paths);
  const { error } = await sb.from('kegiatan').delete().eq('id', keg.id);
  if (error) throw error;
}

export async function hapusFoto(foto) {
  await sb.storage.from('bukti').remove([foto.path]);
  await sb.from('foto').delete().eq('id', foto.id);
}

// ---------- Arsip foto: tandai sudah diunduh, lalu hapus dari server ----------
const potong = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Tandai foto sudah diunduh (ZIP) atau sudah ada di Google Drive */
export async function tandaiDiekspor(ids) {
  const waktu = new Date().toISOString();
  for (const bag of potong([...new Set(ids)].filter(Boolean), 200)) {
    const { error } = await sb.from('foto').update({ diekspor_at: waktu }).in('id', bag).is('diekspor_at', null);
    if (error) throw error;
  }
  return waktu;
}

/**
 * Hapus file foto dari storage server. HANYA foto yang sudah pernah diunduh/dikirim ke Drive.
 * Baris foto tetap disimpan (ditandai dihapus_at) agar jumlah foto di rekap tetap benar.
 */
export async function hapusFotoServer(fotos, progres = () => {}) {
  const aman = fotos.filter(f => f.diekspor_at && !f.dihapus_at);
  let selesai = 0;
  for (const bag of potong(aman, 100)) {
    const { error } = await sb.storage.from('bukti').remove(bag.map(f => f.path));
    if (error) throw error;
    const { error: e2 } = await sb.from('foto').update({ dihapus_at: new Date().toISOString() }).in('id', bag.map(f => f.id));
    if (e2) throw e2;
    selesai += bag.length; progres(selesai, aman.length);
  }
  return selesai;
}

export async function urlFoto(paths, detik = 3600) {
  if (!paths.length) return {};
  const { data, error } = await sb.storage.from('bukti').createSignedUrls(paths, detik);
  if (error) throw error;
  return Object.fromEntries(data.map(d => [d.path, d.signedUrl]));
}

export async function unduhFoto(path) {
  const { data, error } = await sb.storage.from('bukti').download(path);
  if (error) throw error;
  return data;
}

// =====================================================================
//  OFFLINE-FIRST (HP)
//  Setiap kegiatan disimpan dulu di HP (IndexedDB) → langsung tampil, tanpa menunggu sinyal.
//  Lalu dikirim ke server di latar belakang. Pengiriman idempotent: id kegiatan & foto dibuat di HP,
//  jadi kalau terputus di tengah jalan lalu diulang, data tidak dobel.
// =====================================================================

/** Simpan kegiatan ke HP. Foto dikompres sekarang (hemat ruang & kuota). Kategori kata kunci dihitung offline. */
export async function catatLokal({ tanggal, keterangan, files = [], iki_id = null, ikiList = [] }) {
  const fotos = [];
  for (const f of files) {
    const blob = await kompresFoto(f);
    fotos.push({ id: crypto.randomUUID(), blob, type: blob.type || 'image/jpeg' });
  }
  let kat = { iki_id: null, sumber: null, alasan: null };
  if (iki_id) kat = { iki_id, sumber: 'manual', alasan: null };
  else if (ikiList.length) {
    const k = klasifikasiKataKunci(keterangan, ikiList);
    if (k.status === 'pasti') kat = { iki_id: k.iki_id, sumber: 'kata_kunci', alasan: k.alasan };
  }
  const rec = {
    id: crypto.randomUUID(), tanggal, keterangan, fotos, dibuat: Date.now(), percobaan: 0,
    iki_id: kat.iki_id, sumber_kategori: kat.sumber, alasan_kategori: kat.alasan
  };
  await antrianTambah(rec);
  return rec;
}

export async function ubahLokal(id, patch) {
  const semua = await antrianSemua();
  const r = semua.find(x => x.id === id);
  if (r) await antrianTambah({ ...r, ...patch });
}
export const hapusLokal = id => antrianHapus(id);
export const daftarLokal = () => antrianSemua();

const errJaringan = e => /fetch|network|timeout|abort|offline|Failed to/i.test(String(e?.message || e));

async function kirimSatu(it) {
  const { error } = await sb.from('kegiatan').upsert({
    id: it.id, user_id: user.id, tanggal: it.tanggal, keterangan: it.keterangan, asal: 'hp',
    iki_id: it.iki_id, sumber_kategori: it.sumber_kategori, alasan_kategori: it.alasan_kategori
  }, { onConflict: 'id' });
  if (error) throw error;
  const baris = [];
  for (const f of it.fotos || []) {
    const ext = f.type.includes('png') ? 'png' : 'jpg';
    const path = `${user.id}/${it.tanggal.slice(0, 7)}/${it.id}/${f.id}.${ext}`;
    const up = await sb.storage.from('bukti').upload(path, f.blob, { contentType: f.type, upsert: true });
    if (up.error) throw up.error;
    baris.push({ id: f.id, user_id: user.id, kegiatan_id: it.id, path });
  }
  if (baris.length) {
    const { error: e2 } = await sb.from('foto').upsert(baris, { onConflict: 'id' });
    if (e2) throw e2;
  }
}

let _sync = null;
const pendengar = new Set();
export const statusSinkron = { jalan: false, selesai: 0, total: 0, galat: null };
export function dengarSinkron(fn) { pendengar.add(fn); return () => pendengar.delete(fn); }
const kabari = () => pendengar.forEach(fn => { try { fn({ ...statusSinkron }); } catch {} });

/** Kirim semua antrean. Aman dipanggil berkali-kali (hanya satu proses berjalan). */
export function sinkron() {
  if (!_sync) _sync = _sinkron().finally(() => { _sync = null; statusSinkron.jalan = false; kabari(); });
  return _sync;
}

async function _sinkron() {
  const semua = (await antrianSemua()).sort((a, b) => a.dibuat - b.dibuat);
  if (!semua.length || navigator.onLine === false) return { terkirim: 0, sisa: semua.length };
  Object.assign(statusSinkron, { jalan: true, selesai: 0, total: semua.length, galat: null }); kabari();
  const terkirim = [];
  for (const it of semua) {
    try {
      await kirimSatu(it);
      await antrianHapus(it.id);
      terkirim.push(it);
      statusSinkron.selesai++; kabari();
    } catch (e) {
      statusSinkron.galat = String(e?.message || e);
      await antrianTambah({ ...it, percobaan: (it.percobaan || 0) + 1, galat: statusSinkron.galat }).catch(() => {});
      if (errJaringan(e)) break; // sinyal putus → coba lagi nanti
    }
  }
  // Kegiatan yang belum terkategori kata kunci → AI (sekali panggil untuk semua)
  const belum = terkirim.filter(k => !k.iki_id);
  if (belum.length) {
    try {
      const per = await periodeUntukTanggal(belum[0].tanggal);
      const ikiList = per ? (await daftarIki(per.id)).flat : [];
      const peng = await pengaturan();
      if (ikiList.length) {
        const h = await klasifikasi(belum.map(k => ({ id: k.id, teks: k.keterangan })), ikiList, peng);
        for (const k of belum) {
          const r = h.get(k.id);
          if (r) await sb.from('kegiatan').update({ iki_id: r.iki_id, sumber_kategori: r.sumber, alasan_kategori: r.alasan }).eq('id', k.id);
        }
      }
    } catch (e) { console.warn('Kategorisasi AI ditunda', e); }
  }
  return { terkirim: terkirim.length, sisa: (await antrianSemua()).length };
}

/** Minta browser tidak menghapus data antrean saat memori HP penuh */
export async function mintaPenyimpananTetap() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
