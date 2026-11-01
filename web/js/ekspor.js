// Ekspor bulanan: Excel, teks laporan, ZIP foto per IKI, dan unggah ke Google Drive.
// Library global (dimuat di dashboard.html): XLSX (xlsx-js-style), JSZip, google (GIS)
import { tglPendek, tglPanjang, namaBulan, namaFolderIki, slug, paralel } from './util.js';
import { unduhFoto } from './db.js';

const BELUM = { id: null, kode: '0', nama: 'Belum dikategorikan', rk_nomor: 0, rk_nama: '-' };

/** Kelompokkan kegiatan: [{rk, iki:[{iki, items}]}] + kelompok belum terkategori */
export function kelompokkan(items, rkList) {
  const perIki = new Map();
  for (const k of items) {
    const key = k.iki_id || '_';
    if (!perIki.has(key)) perIki.set(key, []);
    perIki.get(key).push(k);
  }
  const grup = rkList.map(rk => ({
    rk,
    iki: rk.iki.map(i => ({ iki: { ...i, rk_nomor: rk.nomor, rk_nama: rk.nama }, items: perIki.get(i.id) || [] }))
  }));
  const dikenal = new Set(rkList.flatMap(r => r.iki.map(i => i.id)));
  const lepas = items.filter(k => !k.iki_id || !dikenal.has(k.iki_id));
  return { grup, belum: lepas };
}

/** Nama kegiatan aman untuk nama file (Windows/Drive/ZIP) */
function namaAman(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 90).trim().replace(/[. ]+$/, '') || 'Kegiatan';
}
/** Format: [nomor].[nama kegiatan]_[kode IKI].jpg — mis. 01.Membuat desain spanduk SE2026_4.2.jpg */
function namaFile(nomor, lebar, k, iki, path) {
  const ext = /\.png$/i.test(path) ? 'png' : 'jpg';
  const kode = iki.id ? iki.kode : 'tanpa IKI';
  return `${String(nomor).padStart(lebar, '0')}.${namaAman(k.keterangan)}_${kode}.${ext}`;
}

/**
 * Daftar file foto yang akan diekspor: [{id, folder, nama, path, iki}]
 * Foto yang sudah dihapus dari server (diarsip) dilewati. Penomoran nama file tetap memakai urutan asli,
 * jadi nama file tidak berubah antar-ekspor (penting agar Drive tidak menduplikat).
 */
export function daftarFileFoto(items, rkList) {
  const { grup, belum } = kelompokkan(items, rkList);
  const out = [];
  // Nomor urut per folder IKI, urut tanggal lalu waktu catat. Foto terarsip tetap dihitung agar nomor stabil.
  const tambah = (iki, list) => {
    const urut = [...list].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || String(a.created_at).localeCompare(String(b.created_at)));
    const total = urut.reduce((s, k) => s + (k.foto?.length || 0), 0);
    const lebar = Math.max(2, String(total).length);
    let n = 0;
    for (const k of urut) {
      for (const f of k.foto || []) {
        n++;
        if (f.dihapus_at) continue;
        out.push({ id: f.id, folder: namaFolderIki(iki), nama: namaFile(n, lebar, k, iki, f.path), path: f.path, iki });
      }
    }
  };
  grup.forEach(g => g.iki.forEach(x => tambah(x.iki, x.items)));
  tambah(BELUM, belum);
  return out;
}

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
let _token = null, _tokenExp = 0;

export function mintaToken(clientId) {
  return new Promise((res, rej) => {
    if (_token && Date.now() < _tokenExp) return res(_token);
    if (!window.google?.accounts?.oauth2) return rej(new Error('Library Google belum termuat, coba muat ulang halaman'));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        _token = r.access_token; _tokenExp = Date.now() + (r.expires_in - 60) * 1000; res(_token);
      },
      error_callback: e => rej(new Error(e?.message || 'Login Google dibatalkan'))
    });
    tc.requestAccessToken({ prompt: _token ? '' : 'consent' });
  });
}

async function gapi(path, opt = {}) {
  const res = await fetch('https://www.googleapis.com/' + path, { ...opt, headers: { Authorization: 'Bearer ' + _token, ...(opt.headers || {}) } });
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
  const key = (parent || 'root') + '/' + nama;
  if (cacheFolder.has(key)) return cacheFolder.get(key);
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${qs(nama)}' and '${parent || 'root'}' in parents`;
  const ada = await gapi(`drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  let id = ada.files?.[0]?.id;
  if (!id) {
    const baru = await gapi('drive/v3/files?supportsAllDrives=true', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nama, mimeType: 'application/vnd.google-apps.folder', parents: [parent || 'root'] })
    });
    id = baru.id;
  }
  cacheFolder.set(key, id);
  return id;
}

const cacheIsi = new Map();
/** Isi folder Drive: nama file + peta id foto → file (dari appProperties), agar tidak menduplikat */
async function isiFolder(parent) {
  if (cacheIsi.has(parent)) return cacheIsi.get(parent);
  const isi = { nama: new Set(), foto: new Map() };
  let token = '';
  do {
    const q = `'${parent}' in parents and trashed=false`;
    const r = await gapi(`drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,appProperties)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? '&pageToken=' + token : ''}`);
    r.files.forEach(f => { isi.nama.add(f.name); const fid = f.appProperties?.laporFotoId; if (fid) isi.foto.set(fid, f); });
    token = r.nextPageToken;
  } while (token);
  cacheIsi.set(parent, isi);
  return isi;
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
 * Struktur di Drive pengguna:
 *   Lapor Kinerja - Bukti Dukung / Bukti Dukung <Bulan Tahun> / <kode IKI nama> / 01.Nama kegiatan_4.2.jpg
 */
export async function kirimKeDrive({ bulan, items, rkList, clientId, folderUtamaId = null, simpanFolderUtama, log = () => {}, progres = () => {} }) {
  await mintaToken(clientId);
  cacheFolder.clear(); cacheIsi.clear();
  const judulBulan = namaBulan(bulan);
  const akarNama = `Bukti Dukung ${judulBulan}`;
  const utamaId = await folderUtama(folderUtamaId, simpanFolderUtama);
  let akarId = null;
  const akar = async () => akarId || (akarId = await folder(akarNama, utamaId));

  const files = daftarFileFoto(items, rkList);
  const tujuan = new Map(); // folder nama + iki → id
  async function folderUntuk(f) {
    const k = f.folder;
    if (tujuan.has(k)) return tujuan.get(k);
    const id = await folder(f.folder, await akar());
    tujuan.set(k, id);
    return id;
  }

  log(`${files.length} foto akan diproses…`);
  let selesai = 0, dilewati = 0, gagal = 0, diganti = 0;
  const berhasil = [];
  // Buat folder berurutan dulu (hindari duplikat), lalu unggah paralel
  for (const f of files) f._parent = await folderUntuk(f);
  await paralel(files, 4, async f => {
    try {
      const isi = await isiFolder(f._parent);
      const lama = isi.foto.get(f.id);
      if (lama) {
        // Foto sudah ada → cukup samakan namanya bila nomor urut berubah
        if (lama.name !== f.nama) {
          await gapi(`drive/v3/files/${lama.id}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.nama }) });
          lama.name = f.nama; diganti++;
        } else dilewati++;
      } else if (isi.nama.has(f.nama)) { dilewati++; }
      else {
        const blob = await unduhFoto(f.path);
        const id = await unggah(blob, f.nama, f._parent, { laporFotoId: f.id });
        isi.nama.add(f.nama); isi.foto.set(f.id, { id, name: f.nama });
      }
      berhasil.push(f.id);
    } catch (e) { gagal++; log('✗ ' + f.nama + ' — ' + e.message); }
    progres(++selesai, files.length, f.nama);
  });

  // Rekap Excel ke folder akar
  const idAkar = await akar();
  const namaX = `Rekap Kegiatan ${judulBulan}.xlsx`;
  const isiAkar = await isiFolder(idAkar);
  if (!isiAkar.nama.has(namaX)) await unggah(excelBlob(bukuExcel(bulan, items, rkList)), namaX, idAkar);
  log(`Selesai: ${files.length - dilewati - gagal - diganti} diunggah, ${dilewati} sudah ada, ${diganti} diganti nama, ${gagal} gagal.`);
  return { akarUrl: `https://drive.google.com/drive/folders/${idAkar}`, utamaUrl: `https://drive.google.com/drive/folders/${utamaId}`, gagal, fotoIds: berhasil };
}