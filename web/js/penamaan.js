// Logika penamaan folder & file bukti dukung.
// Dipakai di browser (ekspor ZIP / Drive) DAN di server (sinkron harian Netlify), supaya hasilnya selalu sama.
import { namaFolderIki } from './util.js';

export const BELUM = { id: null, kode: '0', nama: 'Belum dikategorikan', rk_nomor: 0, rk_nama: '-' };

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
const urutFoto = arr => [...(arr || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));

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
      for (const f of urutFoto(k.foto)) {
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

