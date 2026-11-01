// Ekspor bulanan: Excel, teks laporan, ZIP foto per IKI, dan unggah ke Google Drive.
// Library global (dimuat di dashboard.html): XLSX (xlsx-js-style), JSZip, google (GIS)
import { tglPendek, tglPanjang, namaBulan, namaFolderIki, paralel } from './util.js';
import { BELUM, kelompokkan, daftarFileFoto } from './penamaan.js';
export { kelompokkan, daftarFileFoto };
import { unduhFoto } from './db.js';

// ---------------- Teks laporan ----------------
export function teksLaporan(bulan, items, rkList) {
  const { grup, belum } = kelompokkan(items, rkList);
  const L = [`LAPORAN KEGIATAN ${namaBulan(bulan).toUpperCase()}`, ''];
  for (const g of grup) {
    const total = g.iki.reduce((s, x) => s + x.items.length, 0);
    if (!total) continue;
    L.push(`${g.rk.nomor}. ${g.rk.nama}`);
    for (const x of g.iki) {
      if (!x.items.length) continue;
      L.push(`   IKI ${x.iki.kode} — ${x.iki.nama}`);
      x.items.forEach(k => L.push(`   • ${tglPendek(k.tanggal)}: ${k.keterangan}`));
    }
    L.push('');
  }
  if (belum.length) {
    L.push('Belum dikategorikan');
    belum.forEach(k => L.push(`   • ${tglPendek(k.tanggal)}: ${k.keterangan}`));
  }
  return L.join('\n').trim();
}

// ---------------- Excel ----------------
const H = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0F2A47' } }, alignment: { vertical: 'center', wrapText: true },
  border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } };
const WRAP = { alignment: { vertical: 'top', wrapText: true } };
const RKROW = { font: { bold: true }, fill: { fgColor: { rgb: 'FDF0DC' } }, alignment: { wrapText: true, vertical: 'top' } };

function sheet(rows, widths, gaya = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map(w => ({ wch: w }));
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = r === 0 ? H : (gaya[r] || WRAP);
    }
  }
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}

export function bukuExcel(bulan, items, rkList, nama = '') {
  const { grup, belum } = kelompokkan(items, rkList);
  const wb = XLSX.utils.book_new();
  const sumber = s => s === 'ai' ? 'AI' : s === 'manual' ? 'Manual' : s === 'kata_kunci' ? 'Kata kunci' : '-';

  // Ringkasan
  const r1 = [['No RK', 'Rencana Kinerja', 'Kode IKI', 'Indikator Kinerja Individu', 'Jumlah Kegiatan', 'Jumlah Foto', 'Folder Bukti Dukung']];
  for (const g of grup) for (const x of g.iki) {
    r1.push([g.rk.nomor, g.rk.nama, x.iki.kode, x.iki.nama, x.items.length, x.items.reduce((s, k) => s + (k.foto?.length || 0), 0), namaFolderIki(x.iki)]);
  }
  if (belum.length) r1.push(['-', '-', '0', 'Belum dikategorikan', belum.length, belum.reduce((s, k) => s + (k.foto?.length || 0), 0), namaFolderIki(BELUM)]);
  r1.push([], ['', `Rekap kegiatan ${namaBulan(bulan)}${nama ? ' — ' + nama : ''}`, '', 'TOTAL', items.length, items.reduce((s, k) => s + (k.foto?.length || 0), 0), '']);
  XLSX.utils.book_append_sheet(wb, sheet(r1, [7, 46, 9, 56, 10, 10, 40]), 'Ringkasan');

  // Per IKI
  const r2 = [['No', 'Kode IKI', 'Indikator Kinerja Individu', 'Tanggal', 'Uraian Kegiatan', 'Foto', 'Dikategorikan oleh']];
  const gaya2 = {};
  let no = 0;
  for (const g of grup) {
    if (!g.iki.some(x => x.items.length)) continue;
    gaya2[r2.length] = RKROW;
    r2.push(['', `RK ${g.rk.nomor}`, g.rk.nama, '', '', '', '']);
    for (const x of g.iki) for (const k of x.items) {
      r2.push([++no, x.iki.kode, x.iki.nama, tglPanjang(k.tanggal), k.keterangan, k.foto?.length || 0, sumber(k.sumber_kategori)]);
    }
  }
  if (belum.length) {
    gaya2[r2.length] = RKROW;
    r2.push(['', '-', 'Belum dikategorikan', '', '', '', '']);
    belum.forEach(k => r2.push([++no, '-', '-', tglPanjang(k.tanggal), k.keterangan, k.foto?.length || 0, '-']));
  }
  XLSX.utils.book_append_sheet(wb, sheet(r2, [5, 9, 44, 26, 60, 6, 16], gaya2), 'Kegiatan per IKI');

  // Kronologis
  const ikiMap = Object.fromEntries(rkList.flatMap(r => r.iki.map(i => [i.id, i])));
  const r3 = [['No', 'Tanggal', 'Uraian Kegiatan', 'Kode IKI', 'Foto']];
  [...items].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.created_at.localeCompare(b.created_at))
    .forEach((k, i) => r3.push([i + 1, tglPanjang(k.tanggal), k.keterangan, ikiMap[k.iki_id]?.kode || '-', k.foto?.length || 0]));
  XLSX.utils.book_append_sheet(wb, sheet(r3, [5, 26, 70, 9, 6]), 'Kronologis');
  return wb;
}

export function excelBlob(wb) {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function unduhBlob(blob, nama) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nama;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------- ZIP ----------------
export async function buatZip(bulan, items, rkList, progres = () => {}) {
  const zip = new JSZip();
  const akar = `Bukti Dukung ${namaBulan(bulan)}`;
  const files = daftarFileFoto(items, rkList);
  let selesai = 0;
  await paralel(files, 5, async f => {
    const blob = await unduhFoto(f.path);
    zip.file(`${akar}/${f.folder}/${f.nama}`, blob);
    progres(++selesai, files.length, f.nama);
  });
  zip.file(`${akar}/Rekap Kegiatan ${namaBulan(bulan)}.xlsx`, excelBlob(bukuExcel(bulan, items, rkList)));
  zip.file(`${akar}/Laporan ${namaBulan(bulan)}.txt`, teksLaporan(bulan, items, rkList));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, fotoIds: files.map(f => f.id) };
}

// ---------------- Google Drive ----------------
// drive.file: aplikasi hanya bisa melihat & mengubah folder/file yang ia buat sendiri.
// Scope non-sensitif → aplikasi bisa dipakai siapa pun tanpa verifikasi Google yang berat.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const KUNCI_TOKEN = 'lapor-gtoken';
let _token = null, _tokenExp = 0, _pernahIzin = false;
try {
  const t = JSON.parse(localStorage.getItem(KUNCI_TOKEN) || 'null');
  if (t && t.exp > Date.now()) { _token = t.tok; _tokenExp = t.exp; }
  _pernahIzin = !!t;
} catch {}

/** Token Google masih berlaku (±1 jam sejak login)? */
export const tokenBerlaku = () => !!_token && Date.now() < _tokenExp;
export const pernahTerhubung = () => _pernahIzin;
export function putuskanDrive() {
  try { if (_token) google?.accounts?.oauth2?.revoke?.(_token); } catch {}
  _token = null; _tokenExp = 0; _pernahIzin = false;
  try { localStorage.removeItem(KUNCI_TOKEN); } catch {}
}

/** Muat library login Google bila belum ada (dipakai di halaman HP) */
export function muatGoogle() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const ada = document.querySelector('script[data-gsi]');
    const sc = ada || Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    sc.dataset.gsi = '1';
    sc.addEventListener('load', () => res());
    sc.addEventListener('error', () => rej(new Error('Gagal memuat login Google (cek koneksi)')));
    if (!ada) document.head.appendChild(sc);
  });
}

/**
 * Minta token. HARUS dipanggil langsung dari ketukan pengguna (tanpa await sebelumnya),
 * karena Google membuka jendela pop-up.
 */
export function mintaToken(clientId) {
  return new Promise((res, rej) => {
    if (tokenBerlaku()) return res(_token);
    if (!window.google?.accounts?.oauth2) return rej(new Error('Library Google belum termuat, coba muat ulang halaman'));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        _token = r.access_token; _tokenExp = Date.now() + (Number(r.expires_in || 3600) - 120) * 1000; _pernahIzin = true;
        try { localStorage.setItem(KUNCI_TOKEN, JSON.stringify({ tok: _token, exp: _tokenExp })); } catch {}
        res(_token);
      },
      error_callback: e => rej(new Error(e?.type === 'popup_closed' ? 'Login Google dibatalkan' : e?.type === 'popup_failed_to_open' ? 'Pop-up login Google diblokir browser' : (e?.message || 'Login Google gagal')))
    });
    tc.requestAccessToken({ prompt: _pernahIzin ? '' : 'consent' });
  });
}

async function gapi(path, opt = {}) {
  const res = await fetch('https://www.googleapis.com/' + path, { ...opt, headers: { Authorization: 'Bearer ' + _token, ...(opt.headers || {}) } });
  if (res.status === 401) { _token = null; _tokenExp = 0; try { localStorage.removeItem(KUNCI_TOKEN); localStorage.setItem(KUNCI_TOKEN, JSON.stringify({ tok: null, exp: 0 })); } catch {} }
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 180)}`);
  return res.json();
}

export function idFolderDariUrl(url) {
  if (!url) return null;
  const m = String(url).match(/folders\/([a-zA-Z0-9_-]{10,})/) || String(url).match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim()) ? url.trim() : null);
}

const qs = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const cacheFolder = new Map();
async function folder(nama, parent) {
  const key = parent + '/' + nama;
  if (cacheFolder.has(key)) return cacheFolder.get(key);
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${qs(nama)}' and '${parent}' in parents`;
  const ada = await gapi(`drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  let id = ada.files?.[0]?.id;
  if (!id) {
    const baru = await gapi('drive/v3/files?supportsAllDrives=true&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nama, mimeType: 'application/vnd.google-apps.folder', parents: [parent] })
    });
    id = baru.id;
  }
  cacheFolder.set(key, id);
  return id;
}

/** Semua foto bulan ini yang sudah pernah diunggah aplikasi: id foto → {id, name, parents} */
async function petaFotoBulan(bulan) {
  const peta = new Map(); let token = '';
  do {
    const q = `appProperties has { key='laporBulan' and value='${bulan}' } and trashed=false`;
    const r = await gapi(`drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,parents,appProperties)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? '&pageToken=' + token : ''}`);
    (r.files || []).forEach(f => { const fid = f.appProperties?.laporFotoId; if (fid) peta.set(fid, f); });
    token = r.nextPageToken;
  } while (token);
  return peta;
}

async function unggah(blob, nama, parent, props) {
  const meta = { name: nama, parents: [parent], ...(props ? { appProperties: props } : {}) };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob, nama);
  const r = await gapi('upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', { method: 'POST', body: form });
  return r.id;
}

export const NAMA_FOLDER_UTAMA = 'Lapor Kinerja - Bukti Dukung';

/** Pastikan folder utama milik aplikasi ada (boleh dipindah pengguna ke mana pun di Drive-nya). */
async function folderUtama(idTersimpan, simpan) {
  if (idTersimpan) {
    try {
      const f = await gapi(`drive/v3/files/${idTersimpan}?fields=id,trashed&supportsAllDrives=true`);
      if (f && !f.trashed) return f.id;
    } catch {}
  }
  const baru = await gapi('drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAMA_FOLDER_UTAMA, mimeType: 'application/vnd.google-apps.folder' })
  });
  await simpan?.(baru.id);
  return baru.id;
}

/**
 * Sinkronkan foto satu bulan ke Drive pengguna:
 *   Lapor Kinerja - Bukti Dukung / Bukti Dukung <Bulan Tahun> / <kode IKI nama> / 01.Nama kegiatan_4.2.jpg
 * - Foto baru diunggah; foto yang sudah ada tidak diunggah ulang.
 * - Bila IKI kegiatan diubah atau nomor urut bergeser, file di Drive dipindah/diganti nama.
 * - ambilBlob: sumber foto alternatif (mis. foto yang masih di memori HP) agar tidak perlu unduh ulang.
 */
export async function kirimKeDrive({ bulan, items, rkList, clientId, folderUtamaId = null, simpanFolderUtama,
  excel = true, ambilBlob = null, log = () => {}, progres = () => {} }) {
  await mintaToken(clientId);
  cacheFolder.clear();
  const judulBulan = namaBulan(bulan);
  const utamaId = await folderUtama(folderUtamaId, simpanFolderUtama);
  const akarId = await folder(`Bukti Dukung ${judulBulan}`, utamaId);
  const peta = await petaFotoBulan(bulan);

  const files = daftarFileFoto(items, rkList);
  log(`${files.length} foto akan diproses…`);
  let selesai = 0, baru = 0, dilewati = 0, gagal = 0, diubah = 0;
  const berhasil = [];
  for (const f of files) f._parent = await folder(f.folder, akarId);   // folder dibuat berurutan agar tidak dobel
  await paralel(files, 4, async f => {
    try {
      const lama = peta.get(f.id);
      if (lama) {
        const pindah = !(lama.parents || []).includes(f._parent);
        if (pindah || lama.name !== f.nama) {
          const qp = pindah ? `&addParents=${f._parent}&removeParents=${(lama.parents || []).join(',')}` : '';
          await gapi(`drive/v3/files/${lama.id}?supportsAllDrives=true${qp}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.nama }) });
          diubah++;
        } else dilewati++;
      } else {
        const blob = (ambilBlob && await ambilBlob(f)) || await unduhFoto(f.path);
        await unggah(blob, f.nama, f._parent, { laporFotoId: f.id, laporBulan: bulan });
        baru++;
      }
      berhasil.push(f.id);
    } catch (e) { gagal++; log('✗ ' + f.nama + ' — ' + e.message); }
    progres(++selesai, files.length, f.nama);
  });

  if (excel) {
    const namaX = `Rekap Kegiatan ${judulBulan}.xlsx`;
    const q = `name='${qs(namaX)}' and '${akarId}' in parents and trashed=false`;
    const ada = await gapi(`drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    const blobX = excelBlob(bukuExcel(bulan, items, rkList));
    if (ada.files?.[0]) {
      await gapi(`upload/drive/v3/files/${ada.files[0].id}?uploadType=media&supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': blobX.type }, body: blobX });
    } else await unggah(blobX, namaX, akarId);
  }
  log(`Selesai: ${baru} diunggah, ${dilewati} sudah ada, ${diubah} dipindah/diganti nama, ${gagal} gagal.`);
  return {
    akarUrl: `https://drive.google.com/drive/folders/${akarId}`, utamaUrl: `https://drive.google.com/drive/folders/${utamaId}`,
    gagal, baru, fotoIds: berhasil
  };
}