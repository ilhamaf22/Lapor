// Parser file SKP (Excel hasil unduhan e-Kinerja BKN / evaluasi kinerja BPS)
// Input: rows = array of array (hasil XLSX.utils.sheet_to_json(ws, {header:1, defval:''}))
// Output: { tahun, nama_pegawai, rk: [{nomor, nama, iki:[{kode, nama, folder_drive, kata_kunci:[]}]}] }

const bersih = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function pecahBullet(teks) {
  return bersih(teks).split('•').map(bersih).filter(Boolean);
}

export function parseSkpRows(rows) {
  const out = { tahun: null, nama_pegawai: null, rk: [] };
  let mulai = false;
  let tambahan = false;
  let rkAktif = null;

  for (const raw of rows) {
    const cells = raw.map(bersih);
    const gabung = cells.filter(Boolean).join(' | ');
    if (!gabung) continue;

    // Info umum
    const mTahun = gabung.match(/(\d{1,2}\s+\w+\s+(20\d{2}))|\b(20\d{2})\b/);
    if (!out.tahun && /periode/i.test(gabung) && mTahun) out.tahun = Number(mTahun[2] || mTahun[3]);
    if (!out.nama_pegawai && cells.some(c => c === 'Nama')) {
      const i = cells.indexOf('Nama');
      out.nama_pegawai = cells.slice(i + 1).find(Boolean) || null;
    }

    if (/^A\.\s*Utama/i.test(cells.find(Boolean) || '')) { mulai = true; continue; }
    if (!mulai) continue;
    if (/^B\.\s*Tambahan/i.test(cells.find(Boolean) || '')) { tambahan = true; continue; }
    if (/Rating Hasil Kerja|Perilaku Kerja/i.test(gabung)) break;

    // Baris indikator
    const sel = cells.find(c => /Ukuran keberhasilan/i.test(c));
    if (sel && rkAktif) {
      const isi = sel.replace(/^.*?Target\s*:?\s*/i, '');
      const daftar = pecahBullet(isi);
      daftar.forEach(nama => {
        if (!rkAktif.iki.some(x => x.nama.toLowerCase() === nama.toLowerCase())) {
          rkAktif.iki.push({ kode: '', nama, folder_drive: rkAktif._link[nama.toLowerCase()] || rkAktif._linkUmum || null, kata_kunci: [] });
        }
      });
      continue;
    }

    // Baris rencana kinerja: sel angka diikuti nama
    const idxNo = cells.findIndex(c => /^\d{1,3}$/.test(c));
    if (idxNo >= 0) {
      const nama = cells.slice(idxNo + 1).find(Boolean);
      if (!nama) continue;
      const nomor = out.rk.length + 1;
      rkAktif = { nomor, nama, tambahan, iki: [], _link: {}, _linkUmum: null };
      // Kolom realisasi berisi "• indikator (Bukti dukung: URL)"
      const realisasi = cells.find(c => /Bukti dukung/i.test(c));
      if (realisasi) {
        for (const b of pecahBullet(realisasi)) {
          const m = b.match(/^(.*?)\s*\(Bukti dukung:\s*(https?:\/\/\S+?)\)?\s*$/i);
          if (m) {
            rkAktif._link[bersih(m[1]).toLowerCase()] = m[2].replace(/\)$/, '');
            rkAktif._linkUmum = rkAktif._linkUmum || m[2].replace(/\)$/, '');
          }
        }
      }
      out.rk.push(rkAktif);
    }
  }

  out.rk.forEach(rk => {
    rk.iki.forEach((iki, i) => {
      iki.kode = `${rk.nomor}.${i + 1}`;
      if (!iki.folder_drive) iki.folder_drive = rk._link[iki.nama.toLowerCase()] || rk._linkUmum || null;
    });
    delete rk._link; delete rk._linkUmum;
  });
  out.rk = out.rk.filter(rk => rk.iki.length || rk.nama);
  return out;
}
