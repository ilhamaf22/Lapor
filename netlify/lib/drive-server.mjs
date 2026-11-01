// Logika server sinkron Google Drive (dipakai fungsi Netlify).
// Tanpa dependensi npm: semua lewat fetch ke REST Supabase & Google.
import { daftarFileFoto } from '../../web/js/penamaan.js';
import { namaBulan, akhirBulan } from '../../web/js/util.js';

const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
export function cfg() {
  const c = {
    SB: (env('SUPABASE_URL') || '').replace(/\/$/, ''),
    SR: env('SUPABASE_SERVICE_ROLE_KEY'),
    GID: env('GOOGLE_CLIENT_ID'),
    GSEC: env('GOOGLE_CLIENT_SECRET'),
  };
  const kurang = Object.entries({ SUPABASE_URL: c.SB, SUPABASE_SERVICE_ROLE_KEY: c.SR, GOOGLE_CLIENT_ID: c.GID, GOOGLE_CLIENT_SECRET: c.GSEC })
    .filter(([, v]) => !v).map(([k]) => k);
  if (kurang.length) throw new Error('Environment variable Netlify belum diisi: ' + kurang.join(', '));
  return c;
}
export const NAMA_FOLDER_UTAMA = 'Lapor Kinerja - Bukti Dukung';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';

// ---------- Supabase (service role) ----------
export async function sb(path, opt = {}) {
  const { SB, SR } = cfg();
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opt, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(opt.headers || {}) }
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
export async function penggunaDariJwt(jwt) {
  const { SB, SR } = cfg();
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SR, Authorization: `Bearer ${jwt}` } });
  if (!r.ok) return null;
  return r.json();
}
async function unduhStorage(path) {
  const { SB, SR } = cfg();
  const r = await fetch(`${SB}/storage/v1/object/bukti/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!r.ok) throw new Error(`Foto tidak ditemukan di server (${r.status})`);
  return new Blob([await r.arrayBuffer()], { type: r.headers.get('content-type') || 'image/jpeg' });
}

// ---------- Google OAuth ----------
async function oauth(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || `Google ${r.status}`); e.kode = j.error; throw e; }
  return j;
}
export function tukarKode(code, redirectUri) {
  const { GID, GSEC } = cfg();
  return oauth({ code, client_id: GID, client_secret: GSEC, redirect_uri: redirectUri, grant_type: 'authorization_code' });
}
export async function aksesDariRefresh(refreshToken) {
  const { GID, GSEC } = cfg();
  return (await oauth({ refresh_token: refreshToken, client_id: GID, client_secret: GSEC, grant_type: 'refresh_token' })).access_token;
}
export async function cabutToken(token) {
  try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }); } catch {}
}
export function emailDariIdToken(idToken) {
  try { return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).email || null; } catch { return null; }
}

/** Tanggal & jam lokal pengguna di zona waktunya */
export function waktuLokal(zona, now = new Date()) {
  let parts;
  try { parts = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now); }
  catch { parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now); }
  const g = t => parts.find(p => p.type === t)?.value;
  return { tanggal: `${g('year')}-${g('month')}-${g('day')}`, jam: Number(g('hour')) };
}

// ---------- Google Drive ----------
function drive(token) {
  return async (path, opt = {}) => {
    const r = await fetch('https://www.googleapis.com/' + path, { ...opt, headers: { Authorization: 'Bearer ' + token, ...(opt.headers || {}) } });
    if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  };
}
const qs = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

/**
 * Sinkronkan semua foto yang belum ada di Drive milik satu pengguna.
 * Berhenti rapi saat mendekati batas waktu (selesai:false) — dilanjutkan pada jalannya fungsi berikutnya.
 */
export async function sinkronPengguna(kon, batas) {
  const uid = kon.user_id;
  const g = drive(await aksesDariRefresh(kon.refresh_token));
  const hasil = { selesai: true, baru: 0, diubah: 0, gagal: 0 };

  const pending = await sb(`kegiatan?select=tanggal,foto!inner(id)&user_id=eq.${uid}&foto.diekspor_at=is.null&foto.dihapus_at=is.null`);
  const bulanList = [...new Set((pending || []).map(k => k.tanggal.slice(0, 7)))].sort();
  if (!bulanList.length) return hasil;

  // Folder utama (boleh dipindah pengguna; id-nya disimpan di pengaturan)
  const peng = (await sb(`pengaturan?select=drive_parent_id&user_id=eq.${uid}`))?.[0];
  let utama = null;
  if (peng?.drive_parent_id) {
    try { const f = await g(`drive/v3/files/${peng.drive_parent_id}?fields=id,trashed&supportsAllDrives=true`); if (!f.trashed) utama = f.id; } catch {}
  }
  if (!utama) {
    utama = (await g('drive/v3/files?supportsAllDrives=true&fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NAMA_FOLDER_UTAMA, mimeType: 'application/vnd.google-apps.folder' }) })).id;
    await sb('pengaturan', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: uid, drive_parent_id: utama }) });
  }

  const cache = new Map();
  async function folder(nama, parent) {
    const key = parent + '/' + nama;
    if (cache.has(key)) return cache.get(key);
    const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${qs(nama)}' and '${parent}' in parents`;
    let id = (await g(`drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${ALL}`)).files?.[0]?.id;
    if (!id) id = (await g('drive/v3/files?supportsAllDrives=true&fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nama, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) })).id;
    cache.set(key, id);
    return id;
  }
  const periode = await sb(`periode?select=id,tahun,aktif&user_id=eq.${uid}`) || [];

  for (const bulan of bulanList) {
    const items = await sb(`kegiatan?select=*,foto(id,path,created_at,diekspor_at,dihapus_at)&user_id=eq.${uid}&tanggal=gte.${bulan}-01&tanggal=lte.${akhirBulan(bulan)}&order=tanggal,created_at`);
    const th = Number(bulan.slice(0, 4));
    const per = periode.find(p => p.tahun === th) || periode.find(p => p.aktif) || periode[0];
    const rk = per ? (await sb(`rencana_kinerja?select=id,nomor,nama,iki(id,kode,nama)&periode_id=eq.${per.id}&order=nomor`))
      .map(r => ({ ...r, iki: (r.iki || []).sort((a, b) => a.kode.localeCompare(b.kode, undefined, { numeric: true })) })) : [];
    const files = daftarFileFoto(items, rk);
    const akar = await folder(`Bukti Dukung ${namaBulan(bulan)}`, utama);

    // Foto bulan ini yang sudah ada di Drive (ditandai appProperties saat diunggah)
    const peta = new Map(); let tok = '';
    do {
      const q = `appProperties has { key='laporBulan' and value='${bulan}' } and trashed=false`;
      const r = await g(`drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,parents,appProperties)&pageSize=1000&${ALL}${tok ? '&pageToken=' + tok : ''}`);
      (r.files || []).forEach(f => f.appProperties?.laporFotoId && peta.set(f.appProperties.laporFotoId, f));
      tok = r.nextPageToken;
    } while (tok);

    const tandai = [];
    const simpanTanda = async () => {
      if (!tandai.length) return;
      const ids = tandai.splice(0);
      await sb(`foto?id=in.(${ids.join(',')})&diekspor_at=is.null`, { method: 'PATCH', body: JSON.stringify({ diekspor_at: new Date().toISOString() }) });
    };
    for (const f of files) {
      if (Date.now() > batas) { await simpanTanda(); hasil.selesai = false; return hasil; }
      try {
        const parent = await folder(f.folder, akar);
        const lama = peta.get(f.id);
        if (lama) {
          const pindah = !(lama.parents || []).includes(parent);
          if (pindah || lama.name !== f.nama) {
            const qp = pindah ? `&addParents=${parent}&removeParents=${(lama.parents || []).join(',')}` : '';
            await g(`drive/v3/files/${lama.id}?supportsAllDrives=true${qp}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.nama }) });
            hasil.diubah++;
          }
        } else {
          const blob = await unduhStorage(f.path);
          const form = new FormData();
          form.append('metadata', new Blob([JSON.stringify({ name: f.nama, parents: [parent], appProperties: { laporFotoId: f.id, laporBulan: bulan } })], { type: 'application/json' }));
          form.append('file', blob, f.nama);
          await g('upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', { method: 'POST', body: form });
          hasil.baru++;
        }
        tandai.push(f.id);
        if (tandai.length >= 15) await simpanTanda();
      } catch (e) { hasil.gagal++; console.warn('foto gagal', f.nama, e.message); }
    }
    await simpanTanda();
  }
  return hasil;
}

/** Jalankan sinkron satu pengguna + catat hasilnya. tandaiHarian: isi terakhir_tanggal bila selesai. */
export async function jalankan(kon, batas, { tandaiHarian = true } = {}) {
  const now = new Date();
  const lokal = waktuLokal(kon.zona, now);
  let patch, hasil = null;
  try {
    hasil = await sinkronPengguna(kon, batas);
    const ringkas = hasil.baru || hasil.diubah ? `${hasil.baru} foto terkirim${hasil.diubah ? `, ${hasil.diubah} dirapikan` : ''}` : 'Tidak ada foto baru';
    patch = {
      terakhir_waktu: now.toISOString(),
      terakhir_hasil: hasil.selesai ? ringkas + (hasil.gagal ? ` · ${hasil.gagal} gagal` : '') : `Sebagian terkirim (${hasil.baru}), dilanjutkan otomatis`,
      ...(hasil.selesai && tandaiHarian ? { terakhir_tanggal: lokal.tanggal } : {})
    };
  } catch (e) {
    const dicabut = e.kode === 'invalid_grant';
    patch = { terakhir_waktu: now.toISOString(), terakhir_hasil: dicabut ? 'Izin Google dicabut — hubungkan ulang' : 'Gagal: ' + e.message.slice(0, 120), ...(dicabut ? { aktif: false } : {}) };
    hasil = { selesai: false, galat: patch.terakhir_hasil, dicabut };
  }
  await sb(`drive_koneksi?user_id=eq.${kon.user_id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return { ...hasil, ...patch };
}
