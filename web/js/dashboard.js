// Dashboard web: rekap bulanan per RK/IKI, input manual, ekspor, pengaturan RK/IKI per tahun
import { siapkan, user, sb, keluar, pengaturan, simpanPengaturan, daftarPeriode, daftarIki, buatPeriodeDariSkp,
  kegiatanRentang, simpanKegiatan, ubahKegiatan, hapusKegiatan, hapusFoto, urlFoto, unggahFoto, tandaiDiekspor, hapusFotoServer } from './db.js';
import { $, $$, esc, toast, salin, hariIni, bulanIni, akhirBulan, namaBulan, tglPendek, tglPanjang, warnaRk, chipIki } from './util.js';
import { klasifikasi, klasifikasiKataKunci, saranKataKunci, aiKataKunci } from './klasifikasi.js';
import { SKP_2026 } from './skp-default.js';
import { parseSkpRows } from './skp-parser.js';
import { teksLaporan, bukuExcel, excelBlob, unduhBlob, buatZip, kirimKeDrive, daftarFileFoto } from './ekspor.js';
import { I } from './icons.js';

const root = document.getElementById('app');
const S = {
  view: 'rekap', bulan: localStorage.getItem('lapor-bulan') || bulanIni(),
  periode: [], per: null, rk: [], flat: [], ikiMap: {}, items: [], urls: {}, peng: {}, perEdit: null, draf: []
};

(async function mulai() {
  if (!(await siapkan(root))) return;
  kerangka();
  S.peng = await pengaturan();
  await muatPeriode();
  const h = location.hash.replace('#', '');
  buka(['rekap', 'input', 'pengaturan'].includes(h) ? h : (S.periode.length ? 'rekap' : 'pengaturan'));
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace('#', '');
    if (['rekap', 'input', 'pengaturan'].includes(v) && v !== S.view) buka(v);
  });
})();

function kerangka() {
  root.innerHTML = `
  <div class="d-shell">
    <aside class="d-side">
      <div class="brand"><span class="logo">LK</span><div><b>Lapor Kinerja</b><small>Bukti dukung & IKI</small></div></div>
      <button class="nav-btn" data-v="rekap">${I.grid} Rekap Bulanan</button>
      <button class="nav-btn" data-v="input">${I.edit} Input Manual</button>
      <button class="nav-btn" data-v="pengaturan">${I.settings} RK, IKI & Pengaturan</button>
      <a class="nav-btn" href="index.html" style="text-decoration:none">${I.camera} Mode HP</a>
      <div class="spacer"></div>
      <div class="who">${esc(user.email)}</div>
      <button class="nav-btn" id="b-out">${I.logout} Keluar</button>
    </aside>
    <main class="d-main" id="main"></main>
  </div>`;
  $$('.nav-btn[data-v]').forEach(b => b.onclick = () => buka(b.dataset.v));
  $('#b-out').onclick = keluar;
}

function buka(v) {
  S.view = v; location.hash = v;
  $$('.nav-btn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ({ rekap: viewRekap, input: viewInput, pengaturan: viewPengaturan })[v]();
}

async function muatPeriode() {
  S.periode = await daftarPeriode();
}
async function muatIkiUntukBulan() {
  const th = Number(S.bulan.slice(0, 4));
  S.per = S.periode.find(p => p.tahun === th) || S.periode.find(p => p.aktif) || S.periode[0] || null;
  if (S.per) { const r = await daftarIki(S.per.id); S.rk = r.rk; S.flat = r.flat; }
  else { S.rk = []; S.flat = []; }
  S.ikiMap = Object.fromEntries(S.flat.map(i => [i.id, i]));
}

function modal(html, { lebar } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" ${lebar ? `style="width:min(${lebar}px,100%)"` : ''}>${html}</div>`;
  bg.onclick = e => { if (e.target === bg && !bg.dataset.kunci) bg.remove(); };
  document.body.appendChild(bg);
  return bg;
}

const opsiIki = (pilih) => `<option value="">— Belum dikategorikan —</option>` + S.rk.map(r =>
  `<optgroup label="RK ${r.nomor}. ${esc(r.nama.slice(0, 70))}">` +
  r.iki.map(i => `<option value="${i.id}" ${i.id === pilih ? 'selected' : ''}>${esc(i.kode)} · ${esc(i.nama.slice(0, 80))}</option>`).join('') + `</optgroup>`
).join('');

const labelSumber = s => s === 'ai' ? '✦ AI' : s === 'manual' ? 'manual' : s === 'kata_kunci' ? 'kata kunci' : '';

// =====================================================================
// REKAP BULANAN
// =====================================================================
async function viewRekap() {
  const m = $('#main');
  m.innerHTML = `
    <div class="d-top">
      <div><div class="eyebrow">Rekap bulanan</div><h1 id="r-judul">${namaBulan(S.bulan)}</h1></div>
      <div class="d-controls">
        <input type="month" id="r-bulan" value="${S.bulan}">
        <button class="btn" id="r-muat">↻</button>
      </div>
    </div>
    <div id="r-isi"><p class="muted">Memuat…</p></div>`;
  $('#r-bulan').onchange = e => { S.bulan = e.target.value || bulanIni(); localStorage.setItem('lapor-bulan', S.bulan); viewRekap(); };
  $('#r-muat').onclick = viewRekap;

  await muatIkiUntukBulan();
  S.items = await kegiatanRentang(S.bulan + '-01', akhirBulan(S.bulan));
  try { S.urls = await urlFoto(S.items.flatMap(k => (k.foto || []).filter(f => !f.dihapus_at).map(f => f.path))); } catch { S.urls = {}; }
  renderRekap();
}

function renderRekap() {
  const isi = $('#r-isi');
  if (!S.per) {
    isi.innerHTML = `<div class="panel"><h2>Belum ada RK & IKI</h2><p class="lead">Siapkan Rencana Kinerja dan IKI dulu supaya kegiatan bisa dipilah otomatis.</p>
      <button class="btn primary" onclick="location.hash='pengaturan'">${I.settings} Buka pengaturan</button></div>`;
    return;
  }
  const items = S.items;
  const semuaFoto = items.flatMap(k => k.foto || []);
  const foto = semuaFoto.length;
  const nArsip = semuaFoto.filter(f => f.dihapus_at).length;
  const nSiapHapus = semuaFoto.filter(f => f.diekspor_at && !f.dihapus_at).length;
  const belum = items.filter(k => !k.iki_id || !S.ikiMap[k.iki_id]);
  const terisi = new Set(items.map(k => k.iki_id).filter(id => S.ikiMap[id])).size;

  const perRk = S.rk.map(r => ({ r, n: items.filter(k => S.ikiMap[k.iki_id]?.rk_id === r.id).length }));
  const total = items.length || 1;

  isi.innerHTML = `
    <div class="kpis">
      <div class="kpi" style="--k:var(--rk1)"><b>${items.length}</b><span>Kegiatan</span></div>
      <div class="kpi" style="--k:var(--rk5)"><b>${foto}</b><span>Foto bukti dukung${nArsip ? ` · ${nArsip} diarsip` : ''}</span></div>
      <div class="kpi" style="--k:var(--accent)"><b>${terisi}<small style="font-size:16px;color:var(--muted)">/${S.flat.length}</small></b><span>IKI punya kegiatan</span></div>
      <div class="kpi ${belum.length ? 'warn' : ''}" style="--k:var(--err)"><b>${belum.length}</b><span>Belum dikategorikan</span></div>
    </div>
    <div class="dist">${perRk.filter(x => x.n).map(x => `<span style="width:${x.n / total * 100}%;background:${warnaRk(x.r.nomor)}" title="RK ${x.r.nomor}: ${x.n}"></span>`).join('')}
      ${belum.length ? `<span style="width:${belum.length / total * 100}%;background:var(--rk0)"></span>` : ''}</div>
    <div class="dist-legend">${perRk.map(x => `<span><i style="background:${warnaRk(x.r.nomor)}"></i>RK ${x.r.nomor} · ${x.n}</span>`).join('')}</div>

    <div class="toolbar">
      <button class="btn" id="t-kat">${I.magic} Kategorikan ulang</button>
      <button class="btn" id="t-teks">${I.copy} Salin teks laporan</button>
      <span class="sep"></span>
      <button class="btn" id="t-xls">${I.excel} Excel</button>
      <button class="btn" id="t-zip">${I.zip} ZIP foto per IKI</button>
      <button class="btn accent" id="t-drive">${I.drive} Kirim ke Google Drive</button>
      <button class="btn danger" id="t-arsip" title="Hapus foto yang sudah diunduh dari server">${I.trash} Hapus foto server${nSiapHapus ? ` <span class="pill" style="background:var(--err)">${nSiapHapus}</span>` : ''}</button>
    </div>

    ${belum.length ? blokBelum(belum) : ''}
    ${S.rk.map(blokRk).join('')}
    ${!items.length ? `<div class="panel" style="text-align:center"><p class="muted">Belum ada kegiatan di ${namaBulan(S.bulan)}. Catat dari HP atau lewat <a href="#input">Input Manual</a>.</p></div>` : ''}
  `;
  pasangAksiKegiatan(isi);
  $('#t-kat').onclick = kategorikanUlang;
  $('#t-teks').onclick = async () => { (await salin(teksLaporan(S.bulan, S.items, S.rk))) ? toast('Teks laporan tersalin') : toast('Gagal menyalin', 'err'); };
  $('#t-xls').onclick = () => unduhBlob(excelBlob(bukuExcel(S.bulan, S.items, S.rk, S.peng.nama_pegawai)), `Rekap Kegiatan ${namaBulan(S.bulan)}.xlsx`);
  $('#t-zip').onclick = eksporZip;
  $('#t-drive').onclick = eksporDrive;
  $('#t-arsip').onclick = () => bukaHapusPeriode();
}

function barisKegiatan(k, c) {
  const pics = (k.foto || []).map(f => f.dihapus_at
    ? `<span class="pic arsip" title="Sudah diunduh & dihapus dari server (${tglPendek(f.dihapus_at.slice(0, 10))})">${I.archive}</span>`
    : `<span class="pic" style="background-image:url('${S.urls[f.path] || ''}')">
      <a href="${S.urls[f.path] || '#'}" target="_blank" style="position:absolute;inset:0"></a>
      ${f.diekspor_at ? `<span class="ok" title="Sudah diunduh/dikirim ke Drive">✓</span>` : ''}
      <button class="x" data-hf="${f.id}" data-k="${k.id}" title="Hapus foto">×</button></span>`).join('');
  return `
    <div class="act" data-id="${k.id}">
      <div class="date">${tglPendek(k.tanggal)}</div>
      <div class="txt">
        <div contenteditable="true" spellcheck="false" data-edit="${k.id}">${esc(k.keterangan)}</div>
        ${k.alasan_kategori ? `<div class="why">${esc(k.alasan_kategori)}</div>` : ''}
        <div class="pics">${pics}<label class="addpic" title="Tambah foto">${I.plus}<input type="file" accept="image/*" multiple hidden data-addf="${k.id}"></label></div>
      </div>
      <div class="side">
        <select data-iki="${k.id}" style="border-color:color-mix(in srgb, ${c} 40%, var(--line))">${opsiIki(S.ikiMap[k.iki_id] ? k.iki_id : '')}</select>
        <div style="display:flex;gap:6px;align-items:center"><span class="src">${labelSumber(k.sumber_kategori)}</span>
          <button class="btn sm ghost danger" data-del="${k.id}" title="Hapus kegiatan">${I.trash}</button></div>
      </div>
    </div>`;
}

function blokBelum(list) {
  return `<section class="rk-block unc" style="--c:var(--err)">
    <div class="rk-head"><div class="rk-no">?</div><h3>Belum dikategorikan</h3><span class="cnt">${list.length} kegiatan</span></div>
    <div class="iki-block">${list.map(k => barisKegiatan(k, 'var(--err)')).join('')}</div></section>`;
}

function blokRk(r) {
  const c = warnaRk(r.nomor);
  const n = S.items.filter(k => S.ikiMap[k.iki_id]?.rk_id === r.id).length;
  return `<section class="rk-block" style="--c:${c}">
    <div class="rk-head"><div class="rk-no">${r.nomor}</div><h3>${esc(r.nama)}</h3><span class="cnt">${n} kegiatan</span></div>
    ${r.iki.map(i => {
      const list = S.items.filter(k => k.iki_id === i.id);
      const nf = list.reduce((s, k) => s + (k.foto?.length || 0), 0);
      return `<div class="iki-block">
        <div class="iki-title"><span class="k">${esc(i.kode)}</span><span class="n">${esc(i.nama)}</span><span class="c">${list.length} kegiatan · ${nf} foto</span></div>
        ${list.length ? list.map(k => barisKegiatan(k, c)).join('') : `<div class="iki-empty">Belum ada kegiatan bulan ini</div>`}
      </div>`;
    }).join('')}
  </section>`;
}

function cariItem(id) { return S.items.find(k => k.id === id); }

function pasangAksiKegiatan(el) {
  $$('[data-iki]', el).forEach(s => s.onchange = async () => {
    const v = s.value || null;
    await ubahKegiatan(s.dataset.iki, { iki_id: v, sumber_kategori: v ? 'manual' : null, alasan_kategori: null });
    Object.assign(cariItem(s.dataset.iki), { iki_id: v, sumber_kategori: v ? 'manual' : null, alasan_kategori: null });
    toast('Kategori diperbarui'); renderRekap();
  });
  $$('[data-edit]', el).forEach(d => {
    d.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); d.blur(); } };
    d.onblur = async () => {
      const k = cariItem(d.dataset.edit); const teks = d.innerText.trim();
      if (!teks || teks === k.keterangan) { d.textContent = k.keterangan; return; }
      const patch = { keterangan: teks };
      if (k.sumber_kategori !== 'manual') {
        const h = (await klasifikasi([{ id: k.id, teks }], S.flat, S.peng)).get(k.id);
        Object.assign(patch, { iki_id: h?.iki_id || null, sumber_kategori: h?.sumber || null, alasan_kategori: h?.alasan || null });
      }
      await ubahKegiatan(k.id, patch); Object.assign(k, patch);
      toast('Keterangan disimpan'); renderRekap();
    };
  });
  $$('[data-del]', el).forEach(b => b.onclick = async () => {
    if (!confirm('Hapus kegiatan ini beserta fotonya?')) return;
    const k = cariItem(b.dataset.del);
    await hapusKegiatan(k); S.items = S.items.filter(x => x !== k); toast('Dihapus'); renderRekap();
  });
  $$('[data-hf]', el).forEach(b => b.onclick = async e => {
    e.stopPropagation();
    if (!confirm('Hapus foto ini?')) return;
    const k = cariItem(b.dataset.k); const f = k.foto.find(x => x.id === b.dataset.hf);
    await hapusFoto(f); k.foto = k.foto.filter(x => x !== f); toast('Foto dihapus'); renderRekap();
  });
  $$('[data-addf]', el).forEach(inp => inp.onchange = async () => {
    const k = cariItem(inp.dataset.addf);
    toast('Mengunggah foto…');
    try { await unggahFoto(k.id, k.tanggal, [...inp.files], k.keterangan); toast('Foto ditambahkan'); viewRekap(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

async function kategorikanUlang() {
  const bg = modal(`
    <h3>Kategorikan ulang otomatis</h3>
    <p class="muted" style="margin:0">Kata kunci dulu, sisanya oleh AI.</p>
    <label class="opt"><input type="radio" name="ku" value="belum" checked><div><b>Hanya yang belum dikategorikan</b><span class="muted tiny">Aman, tidak menyentuh yang sudah ada</span></div></label>
    <label class="opt"><input type="radio" name="ku" value="auto"><div><b>Semua kecuali yang dipilih manual</b><span class="muted tiny">Pakai ini setelah mengubah kata kunci</span></div></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn ghost" id="ku-batal">Batal</button><button class="btn primary" id="ku-ok">${I.magic} Jalankan</button></div>`);
  $('#ku-batal', bg).onclick = () => bg.remove();
  $('#ku-ok', bg).onclick = async () => {
    const mode = $('input[name=ku]:checked', bg).value;
    const target = S.items.filter(k => mode === 'belum' ? (!k.iki_id || !S.ikiMap[k.iki_id]) : k.sumber_kategori !== 'manual');
    if (!target.length) { bg.remove(); return toast('Tidak ada yang perlu dikategorikan'); }
    $('#ku-ok', bg).disabled = true; $('#ku-ok', bg).textContent = `Memproses ${target.length}…`;
    try {
      const h = await klasifikasi(target.map(k => ({ id: k.id, teks: k.keterangan })), S.flat, S.peng);
      let n = 0;
      for (const k of target) {
        const r = h.get(k.id);
        const patch = { iki_id: r?.iki_id || null, sumber_kategori: r?.sumber || null, alasan_kategori: r?.alasan || null };
        if (patch.iki_id !== k.iki_id || patch.alasan_kategori !== k.alasan_kategori) { await ubahKegiatan(k.id, patch); Object.assign(k, patch); n++; }
      }
      bg.remove(); toast(`${n} kegiatan diperbarui`); renderRekap();
    } catch (e) { toast(e.message, 'err'); bg.remove(); }
  };
}

function modalProgres(judul) {
  const bg = modal(`<h3>${judul}</h3><div class="progress"><span id="pg"></span></div><div class="muted tiny" id="pg-t">Menyiapkan…</div><div class="log hidden" id="pg-log"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn hidden" id="pg-tutup">Tutup</button></div>`);
  bg.dataset.kunci = '1';
  return {
    bg,
    set(n, tot, nama) { $('#pg', bg).style.width = (tot ? n / tot * 100 : 100) + '%'; $('#pg-t', bg).textContent = `${n}/${tot} · ${nama || ''}`; },
    log(t) { const l = $('#pg-log', bg); l.classList.remove('hidden'); l.textContent += t + '\n'; l.scrollTop = l.scrollHeight; },
    selesai(html) { $('#pg-t', bg).innerHTML = html; const b = $('#pg-tutup', bg); b.classList.remove('hidden'); b.onclick = () => bg.remove(); delete bg.dataset.kunci; }
  };
}

async function eksporZip() {
  const n = daftarFileFoto(S.items, S.rk).length;
  const p = modalProgres(`Menyiapkan ZIP · ${n} foto`);
  try {
    const { blob, fotoIds } = await buatZip(S.bulan, S.items, S.rk, (a, b, nm) => p.set(a, b, nm));
    unduhBlob(blob, `Bukti Dukung ${namaBulan(S.bulan)}.zip`);
    await catatEkspor(fotoIds);
    p.selesai(`ZIP siap (${(blob.size / 1048576).toFixed(1)} MB). Ekstrak, lalu seret foldernya ke Google Drive — struktur folder per IKI ikut terbawa.`
      + tawaranHapus(fotoIds.length, 'Pastikan file ZIP sudah tersimpan dengan baik sebelum menghapus.'));
    pasangTawaran(p.bg);
  } catch (e) { p.log('Gagal: ' + e.message); p.selesai('Terjadi kesalahan.'); }
}

async function eksporDrive() {
  if (!S.peng.google_client_id) {
    return modal(`<h3>Hubungkan Google Drive</h3>
      <p>Untuk mengunggah langsung ke Drive, isi <b>Google OAuth Client ID</b> di menu Pengaturan (panduan ada di README).</p>
      <p class="muted">Sementara itu, pakai <b>ZIP foto per IKI</b>: ekstrak lalu seret foldernya ke Google Drive.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="this.closest('.modal-bg').remove()">Nanti</button>
      <button class="btn primary" onclick="this.closest('.modal-bg').remove();location.hash='pengaturan'">Ke Pengaturan</button></div>`);
  }
  const adaSkp = S.flat.some(i => i.folder_drive);
  const bg = modal(`
    <h3>Kirim ke Google Drive · ${namaBulan(S.bulan)}</h3>
    <p class="muted" style="margin:0">${daftarFileFoto(S.items, S.rk).length} foto. File yang sudah ada tidak diunggah ulang.</p>
    <label class="opt"><input type="radio" name="dm" value="baru" checked><div><b>Folder baru per bulan</b>
      <span class="muted tiny">Bukti Dukung ${namaBulan(S.bulan)} / [kode IKI nama] / foto${S.peng.drive_parent_id ? ' — di dalam folder induk pilihanmu' : ' — di My Drive'}</span></div></label>
    <label class="opt" ${adaSkp ? '' : 'style="opacity:.5"'}><input type="radio" name="dm" value="skp" ${adaSkp ? '' : 'disabled'}><div><b>Langsung ke folder bukti dukung SKP</b>
      <span class="muted tiny">[folder IKI di SKP] / ${namaBulan(S.bulan)} / [kode IKI nama] / foto. Rekap Excel tetap di folder Bukti Dukung ${namaBulan(S.bulan)}.</span></div></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn ghost" id="dm-batal">Batal</button><button class="btn accent" id="dm-ok">${I.drive} Mulai</button></div>`);
  $('#dm-batal', bg).onclick = () => bg.remove();
  $('#dm-ok', bg).onclick = async () => {
    const mode = $('input[name=dm]:checked', bg).value; bg.remove();
    const p = modalProgres('Mengunggah ke Google Drive');
    try {
      const { idFolderDariUrl } = await import('./ekspor.js');
      const r = await kirimKeDrive({
        bulan: S.bulan, items: S.items, rkList: S.rk, clientId: S.peng.google_client_id, mode,
        indukId: idFolderDariUrl(S.peng.drive_parent_id || '') || null,
        log: t => p.log(t), progres: (a, b, nm) => p.set(a, b, nm)
      });
      await catatEkspor(r.fotoIds);
      p.selesai(`Selesai. <a href="${r.akarUrl}" target="_blank">Buka folder di Drive ↗</a>`
        + tawaranHapus(r.fotoIds.length, r.gagal ? `${r.gagal} foto gagal terkirim — foto itu tidak akan ikut dihapus.` : 'Cek dulu foldernya di Drive bila perlu.'));
      pasangTawaran(p.bg);
    } catch (e) { p.log('Gagal: ' + e.message); p.selesai('Terjadi kesalahan — cek Client ID & izin akses.'); }
  };
}

// =====================================================================
// INPUT MANUAL
// =====================================================================
const RX_TGL = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\s*[|:–—-]?\s+(.+)$/;
function parseBaris(teks, tglDefault) {
  const th = tglDefault.slice(0, 4);
  return teks.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    l = l.replace(/^([-•*·]|\d{1,3}[.)])\s+/, '');
    let tanggal = tglDefault, ket = l;
    const m = l.match(RX_TGL);
    if (m) {
      const t = m[1];
      if (/^\d{4}-/.test(t)) { const [y, mo, d] = t.split('-'); tanggal = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
      else { const [d, mo, y] = t.split(/[\/.\-]/); const yy = y ? (y.length === 2 ? '20' + y : y) : th; tanggal = `${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
      ket = m[2];
      if (isNaN(new Date(tanggal))) { tanggal = tglDefault; ket = l; }
    }
    return { id: crypto.randomUUID(), tanggal, teks: ket.trim() };
  }).filter(x => x.teks);
}

async function viewInput() {
  const m = $('#main');
  m.innerHTML = `
    <div class="d-top"><div><div class="eyebrow">Input manual</div><h1>Tulis daftar kegiatan</h1></div></div>
    <div class="grid-2">
      <section class="panel">
        <h2>Daftar kegiatan</h2>
        <p class="lead">Satu baris = satu kegiatan. Tanggal di awal baris boleh ditulis (mis. <span class="mono">05/10</span> atau <span class="mono">2026-10-05</span>), kalau tidak, pakai tanggal default.</p>
        <label>Tanggal default<input type="date" id="in-tgl" value="${hariIni()}"></label>
        <label>Kegiatan<textarea id="in-teks" style="min-height:220px" placeholder="05/10 Rilis BRS inflasi September bersama awak media
06/10 Membuat desain spanduk SE2026
Mengunggah reels sensus ekonomi ke Instagram
Mengisi LKE ZI komponen pengungkit"></textarea></label>
        <button class="btn primary" id="in-proses" style="margin-top:14px">${I.magic} Kategorikan otomatis</button>
      </section>
      <section class="panel">
        <h2>Cara pemilahan</h2>
        <p class="lead">Setiap kegiatan dicocokkan dengan kata kunci tiap IKI. Kalau ada satu IKI paling cocok, langsung dipakai tanpa AI. Kalau tidak ada yang cocok atau beberapa IKI sama kuat, Gemini yang memutuskan.</p>
        <div id="in-ringkas"></div>
      </section>
    </div>
    <section class="panel hidden" id="in-hasil" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h2 style="margin:0">Pratinjau</h2>
        <button class="btn primary" id="in-simpan">${I.save} Simpan semua</button>
      </div>
      <div style="overflow:auto;margin-top:10px"><table class="tbl"><thead><tr><th style="width:150px">Tanggal</th><th>Kegiatan</th><th style="width:280px">IKI</th><th style="width:90px">Oleh</th><th></th></tr></thead><tbody id="in-rows"></tbody></table></div>
    </section>`;
  await muatIkiUntukBulan();
  $('#in-ringkas').innerHTML = S.flat.length
    ? `<div style="display:flex;flex-direction:column;gap:6px">${S.flat.map(i => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">${chipIki(i)}<span class="muted tiny">${(i.kata_kunci || []).length} kata kunci</span></div>`).join('')}</div>`
    : `<p class="muted">Belum ada IKI. Atur di menu Pengaturan.</p>`;
  if (!S.peng.gemini_api_key) $('#in-ringkas').insertAdjacentHTML('beforeend', `<p class="tiny" style="color:var(--err)">API key Gemini belum diisi — kegiatan tanpa kata kunci yang cocok akan tetap "belum dikategorikan".</p>`);

  $('#in-proses').onclick = async () => {
    const baris = parseBaris($('#in-teks').value, $('#in-tgl').value || hariIni());
    if (!baris.length) return toast('Tulis minimal satu kegiatan', 'err');
    const b = $('#in-proses'); b.disabled = true; b.textContent = 'Memproses…';
    try {
      // IKI bisa beda tahun bila tanggalnya beda tahun; untuk kesederhanaan pakai periode tanggal pertama
      const th = Number(baris[0].tanggal.slice(0, 4));
      const per = S.periode.find(p => p.tahun === th) || S.per;
      if (per && per.id !== S.per?.id) { const r = await daftarIki(per.id); S.rk = r.rk; S.flat = r.flat; S.ikiMap = Object.fromEntries(S.flat.map(i => [i.id, i])); }
      const h = await klasifikasi(baris, S.flat, S.peng);
      S.draf = baris.map(x => ({ ...x, iki_id: h.get(x.id)?.iki_id || '', sumber: h.get(x.id)?.sumber || '', alasan: h.get(x.id)?.alasan || '' }));
      renderDraf();
    } catch (e) { toast(e.message, 'err'); }
    b.disabled = false; b.innerHTML = `${I.magic} Kategorikan otomatis`;
  };
  $('#in-simpan').onclick = simpanDraf;
}

function renderDraf() {
  $('#in-hasil').classList.remove('hidden');
  $('#in-rows').innerHTML = S.draf.map(d => `
    <tr data-d="${d.id}">
      <td><input type="date" value="${d.tanggal}" data-f="tanggal"></td>
      <td><input value="${esc(d.teks)}" data-f="teks"><div class="muted tiny" style="margin-top:4px">${esc(d.alasan)}</div></td>
      <td><select data-f="iki_id">${opsiIki(d.iki_id)}</select></td>
      <td><span class="src">${labelSumber(d.sumber)}</span></td>
      <td><button class="btn sm ghost danger" data-x="${d.id}">${I.trash}</button></td>
    </tr>`).join('');
  $('#in-simpan').innerHTML = `${I.save} Simpan semua (${S.draf.length})`;
  $$('#in-rows [data-f]').forEach(inp => inp.onchange = () => {
    const d = S.draf.find(x => x.id === inp.closest('tr').dataset.d);
    d[inp.dataset.f] = inp.value;
    if (inp.dataset.f === 'iki_id') { d.sumber = inp.value ? 'manual' : ''; d.alasan = ''; renderDraf(); }
  });
  $$('#in-rows [data-x]').forEach(b => b.onclick = () => { S.draf = S.draf.filter(x => x.id !== b.dataset.x); renderDraf(); });
}

async function simpanDraf() {
  if (!S.draf.length) return;
  const b = $('#in-simpan'); b.disabled = true;
  let n = 0;
  try {
    for (const d of S.draf) {
      await simpanKegiatan({ tanggal: d.tanggal, keterangan: d.teks, asal: 'web', iki_id: d.iki_id || null, sumber: d.iki_id ? (d.sumber || 'manual') : null, alasan: d.sumber === 'manual' ? null : (d.alasan || null) });
      n++; b.textContent = `Menyimpan ${n}/${S.draf.length}…`;
    }
    toast(`${n} kegiatan tersimpan`);
    S.draf = []; $('#in-teks').value = ''; $('#in-hasil').classList.add('hidden');
  } catch (e) { toast(`Tersimpan ${n}, gagal: ${e.message}`, 'err'); S.draf = S.draf.slice(n); renderDraf(); }
  b.disabled = false; b.innerHTML = `${I.save} Simpan semua`;
}

// =====================================================================
// PENGATURAN: periode, RK/IKI, akun
// =====================================================================
async function viewPengaturan() {
  await muatPeriode();
  if (!S.perEdit || !S.periode.find(p => p.id === S.perEdit)) S.perEdit = (S.periode.find(p => p.aktif) || S.periode[0])?.id || null;
  const m = $('#main');
  m.innerHTML = `
    <div class="d-top"><div><div class="eyebrow">Pengaturan</div><h1>RK, IKI & akun</h1></div></div>
    <div class="grid-2">
      <div>
        <section class="panel">
          <h2>Tahun / periode SKP</h2>
          <p class="lead">Setiap tahun punya RK & IKI sendiri. Kegiatan otomatis memakai periode sesuai tahun tanggalnya.</p>
          <div class="per-list" id="per-list"></div>
          <div class="toolbar" style="margin:14px 0 0">
            <button class="btn primary" id="p-impor">${I.upload} Tahun baru dari file SKP</button>
            <button class="btn" id="p-salin">${I.copy} Salin dari tahun lain</button>
            ${S.periode.some(p => p.tahun === 2026) ? '' : `<button class="btn accent" id="p-2026">${I.magic} Pakai SKP 2026 bawaan</button>`}
            <button class="btn ghost" id="p-kosong">${I.plus} Kosong</button>
          </div>
          <input type="file" id="p-file" accept=".xlsx,.xls" hidden>
        </section>
        <section class="panel" style="margin-top:18px" id="rk-editor"></section>
      </div>
      <section class="panel" id="akun"></section>
    </div>`;
  renderPeriode();
  renderEditor();
  renderAkun();
  $('#p-impor').onclick = () => $('#p-file').click();
  $('#p-file').onchange = e => imporSkp(e.target.files[0]);
  $('#p-salin').onclick = salinPeriode;
  $('#p-kosong').onclick = async () => {
    const th = Number(prompt('Tahun periode baru?', new Date().getFullYear() + 1));
    if (!th) return;
    try { const p = await buatPeriodeDariSkp({ tahun: th, label: `SKP ${th}`, rk: [] }); S.perEdit = p.id; viewPengaturan(); } catch (e) { toast(e.message, 'err'); }
  };
  if ($('#p-2026')) $('#p-2026').onclick = async () => {
    try { const p = await buatPeriodeDariSkp(SKP_2026); S.perEdit = p.id; toast('SKP 2026 terpasang'); viewPengaturan(); } catch (e) { toast(e.message, 'err'); }
  };
}

function renderPeriode() {
  const el = $('#per-list');
  if (!S.periode.length) { el.innerHTML = `<div class="muted">Belum ada periode. Klik <b>Pakai SKP 2026 bawaan</b> untuk mulai cepat.</div>`; return; }
  el.innerHTML = S.periode.map(p => `
    <div class="per-item ${p.id === S.perEdit ? 'on' : ''}" data-p="${p.id}">
      <b class="mono">${p.tahun}</b><span>${esc(p.label)}</span>${p.aktif ? '<span class="pill">aktif</span>' : ''}
      <span style="flex:1"></span>
      ${p.aktif ? '' : `<button class="btn sm" data-akt="${p.id}">Jadikan aktif</button>`}
      <button class="btn sm ghost danger" data-hp="${p.id}" title="Hapus periode">${I.trash}</button>
    </div>`).join('');
  $$('[data-p]', el).forEach(d => d.onclick = e => { if (e.target.closest('button')) return; S.perEdit = d.dataset.p; renderPeriode(); renderEditor(); });
  $$('[data-akt]', el).forEach(b => b.onclick = async () => {
    await sb.from('periode').update({ aktif: false }).eq('user_id', user.id);
    await sb.from('periode').update({ aktif: true }).eq('id', b.dataset.akt);
    toast('Periode aktif diubah'); viewPengaturan();
  });
  $$('[data-hp]', el).forEach(b => b.onclick = async () => {
    const p = S.periode.find(x => x.id === b.dataset.hp);
    if (!confirm(`Hapus periode ${p.tahun} beserta RK & IKI-nya?\nKegiatan tetap ada, tapi kategorinya terlepas.`)) return;
    await sb.from('periode').delete().eq('id', p.id); toast('Periode dihapus'); viewPengaturan();
  });
}

async function renderEditor() {
  const el = $('#rk-editor');
  if (!S.perEdit) { el.innerHTML = `<h2>RK & IKI</h2><p class="muted">Pilih atau buat periode dulu.</p>`; return; }
  const per = S.periode.find(p => p.id === S.perEdit);
  const { rk } = await daftarIki(S.perEdit);
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div><h2>RK & IKI ${per.tahun}</h2><p class="lead" style="margin:0">Perubahan tersimpan otomatis. Kata kunci dipisah koma.</p></div>
      <button class="btn sm" id="kk-ai">${I.magic} Sarankan kata kunci (AI)</button>
    </div>
    <div style="margin-top:14px">
    ${rk.map(r => `
      <div class="rk-edit" style="--c:${warnaRk(r.nomor)}">
        <div class="row">
          <input class="nomor" type="number" value="${r.nomor}" data-rk="${r.id}" data-f="nomor">
          <input value="${esc(r.nama)}" data-rk="${r.id}" data-f="nama">
          <button class="btn sm ghost danger" data-hrk="${r.id}" title="Hapus RK">${I.trash}</button>
        </div>
        ${r.iki.map(i => `
          <div class="iki-edit">
            <div class="row" style="display:flex;gap:8px;align-items:center">
              <input class="kode" value="${esc(i.kode)}" data-ik="${i.id}" data-f="kode">
              <input value="${esc(i.nama)}" data-ik="${i.id}" data-f="nama">
              <button class="btn sm ghost danger" data-hik="${i.id}" title="Hapus IKI">${I.trash}</button>
            </div>
            <label>Kata kunci (${(i.kata_kunci || []).length})<textarea data-ik="${i.id}" data-f="kata_kunci">${esc((i.kata_kunci || []).join(', '))}</textarea></label>
            <label>Folder bukti dukung di Drive (opsional)<input value="${esc(i.folder_drive || '')}" placeholder="https://drive.google.com/drive/folders/…" data-ik="${i.id}" data-f="folder_drive"></label>
          </div>`).join('')}
        <button class="btn sm ghost" data-tik="${r.id}" data-no="${r.nomor}" data-n="${r.iki.length}" style="margin:10px 0 0 22px">${I.plus} Tambah IKI</button>
      </div>`).join('')}
    </div>
    <button class="btn" id="t-rk">${I.plus} Tambah Rencana Kinerja</button>`;

  $$('[data-rk]', el).forEach(inp => inp.onchange = async () => {
    const v = inp.dataset.f === 'nomor' ? Number(inp.value) : inp.value.trim();
    const { error } = await sb.from('rencana_kinerja').update({ [inp.dataset.f]: v }).eq('id', inp.dataset.rk);
    error ? toast(error.message, 'err') : toast('Tersimpan');
  });
  $$('[data-ik]', el).forEach(inp => inp.onchange = async () => {
    let v = inp.value.trim();
    if (inp.dataset.f === 'kata_kunci') v = [...new Set(v.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))];
    if (inp.dataset.f === 'folder_drive' && !v) v = null;
    const { error } = await sb.from('iki').update({ [inp.dataset.f]: v }).eq('id', inp.dataset.ik);
    error ? toast(error.message, 'err') : toast('Tersimpan');
  });
  $$('[data-hrk]', el).forEach(b => b.onclick = async () => {
    if (!confirm('Hapus RK ini beserta IKI-nya?')) return;
    await sb.from('rencana_kinerja').delete().eq('id', b.dataset.hrk); renderEditor();
  });
  $$('[data-hik]', el).forEach(b => b.onclick = async () => {
    if (!confirm('Hapus IKI ini?')) return;
    await sb.from('iki').delete().eq('id', b.dataset.hik); renderEditor();
  });
  $$('[data-tik]', el).forEach(b => b.onclick = async () => {
    await sb.from('iki').insert({ rk_id: b.dataset.tik, kode: `${b.dataset.no}.${Number(b.dataset.n) + 1}`, nama: 'IKI baru', kata_kunci: [] });
    renderEditor();
  });
  $('#t-rk').onclick = async () => {
    await sb.from('rencana_kinerja').insert({ periode_id: S.perEdit, nomor: rk.length + 1, nama: 'Rencana Kinerja baru' });
    renderEditor();
  };
  $('#kk-ai').onclick = async () => {
    const flat = rk.flatMap(r => r.iki.map(i => ({ ...i, rk_nama: r.nama })));
    const kosong = flat.filter(i => (i.kata_kunci || []).length < 5);
    const target = kosong.length ? kosong : flat;
    if (!confirm(kosong.length ? `Isi kata kunci untuk ${kosong.length} IKI yang masih sedikit kata kuncinya?` : `Semua IKI sudah punya kata kunci. Tambahkan saran AI ke semua ${flat.length} IKI?`)) return;
    try {
      toast('Meminta saran AI…');
      const hasil = await aiKataKunci(target, S.peng);
      for (const i of target) {
        const baru = hasil[i.kode]; if (!baru?.length) continue;
        await sb.from('iki').update({ kata_kunci: [...new Set([...(i.kata_kunci || []), ...baru])] }).eq('id', i.id);
      }
      toast('Kata kunci ditambahkan — silakan periksa'); renderEditor();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function renderAkun() {
  const p = S.peng;
  const el = $('#akun');
  el.innerHTML = `
    <h2>Akun & integrasi</h2>
    <p class="lead">Tersimpan di databasemu sendiri, hanya bisa dibaca oleh akunmu.</p>
    <label>Nama pegawai (untuk judul rekap)<input id="a-nama" value="${esc(p.nama_pegawai || '')}"></label>
    <h3 style="margin:22px 0 0;font-size:15px">✦ Gemini (AI)</h3>
    <label>API key Gemini<input id="a-key" type="password" value="${esc(p.gemini_api_key || '')}" placeholder="AIza…"></label>
    <label>Model<input id="a-model" value="${esc(p.gemini_model || 'gemini-3.5-flash-lite')}"></label>
    <p class="muted tiny">Ambil key gratis di aistudio.google.com → Get API key.</p>
    <h3 style="margin:22px 0 0;font-size:15px">${I.drive.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} Google Drive</h3>
    <label>Google OAuth Client ID<input id="a-gcid" value="${esc(p.google_client_id || '')}" placeholder="xxxx.apps.googleusercontent.com"></label>
    <label>Folder induk (opsional, link atau ID)<input id="a-parent" value="${esc(p.drive_parent_id || '')}" placeholder="https://drive.google.com/drive/folders/…"></label>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="btn primary" id="a-simpan">${I.save} Simpan</button>
      <button class="btn" id="a-tes">${I.magic} Tes klasifikasi</button>
    </div>
    <div id="a-hasil" class="log hidden" style="margin-top:12px"></div>`;
  $('#a-simpan').onclick = async () => {
    try {
      S.peng = await simpanPengaturan({
        nama_pegawai: $('#a-nama').value.trim() || null, gemini_api_key: $('#a-key').value.trim() || null,
        gemini_model: $('#a-model').value.trim() || 'gemini-3.5-flash-lite', google_client_id: $('#a-gcid').value.trim() || null,
        drive_parent_id: $('#a-parent').value.trim() || null
      });
      toast('Pengaturan tersimpan');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#a-tes').onclick = async () => {
    const teks = prompt('Tulis contoh kegiatan:', 'Mendampingi kunjungan mahasiswa Unsrat ke PST');
    if (!teks) return;
    const out = $('#a-hasil'); out.classList.remove('hidden'); out.textContent = 'Memproses…';
    await muatIkiUntukBulan();
    const kk = klasifikasiKataKunci(teks, S.flat);
    const peng = { ...S.peng, gemini_api_key: $('#a-key').value.trim(), gemini_model: $('#a-model').value.trim() };
    try {
      const h = (await klasifikasi([{ id: 'x', teks }], S.flat, peng)).get('x');
      out.textContent = `Kata kunci: ${kk.status}${kk.kandidat?.length ? ' → ' + kk.kandidat.map(k => S.ikiMap[k.iki_id]?.kode + ' (' + k.cocok.join(', ') + ')').join('; ') : ''}\n`
        + `Hasil akhir: ${h ? S.ikiMap[h.iki_id]?.kode + ' — ' + S.ikiMap[h.iki_id]?.nama : 'tidak terkategori'}\n${h?.alasan || ''}`;
    } catch (e) { out.textContent = 'Gagal: ' + e.message; }
  };
}

// ---------- Impor SKP dari Excel ----------
async function imporSkp(file) {
  if (!file) return;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    let hasil = null;
    for (const nm of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '' });
      const r = parseSkpRows(rows);
      if (r.rk.length) { hasil = r; break; }
    }
    $('#p-file').value = '';
    if (!hasil) return toast('Tidak menemukan RK/IKI di file ini', 'err');
    // Bawa kata kunci dari tahun lain untuk IKI yang namanya sama
    const lama = {};
    for (const p of S.periode) {
      const { flat } = await daftarIki(p.id);
      flat.forEach(i => { const k = i.nama.toLowerCase().trim(); if (!lama[k] && i.kata_kunci?.length) lama[k] = i.kata_kunci; });
    }
    const totalIki = hasil.rk.reduce((s, r) => s + r.iki.length, 0);
    const bg = modal(`
      <h3>Impor SKP</h3>
      <p class="muted" style="margin:0">${hasil.rk.length} Rencana Kinerja · ${totalIki} IKI ditemukan${hasil.nama_pegawai ? ' · ' + esc(hasil.nama_pegawai) : ''}</p>
      <label>Tahun periode<input type="number" id="im-th" value="${hasil.tahun || new Date().getFullYear()}"></label>
      <div style="max-height:280px;overflow:auto;margin-top:12px;font-size:13px">
        ${hasil.rk.map(r => `<div style="margin-bottom:10px"><b>${r.nomor}. ${esc(r.nama)}</b>${r.iki.map(i => `<div style="margin-left:14px" class="muted">${i.kode} ${esc(i.nama)}${lama[i.nama.toLowerCase()] ? ' <span class="pill" style="background:var(--rk5)">kata kunci lama</span>' : ''}</div>`).join('')}</div>`).join('')}
      </div>
      <label class="opt"><input type="radio" name="kk" value="ai" ${S.peng.gemini_api_key ? 'checked' : 'disabled'}><div><b>Susun kata kunci dengan AI</b><span class="muted tiny">Paling akurat. IKI yang sama dengan tahun lalu tetap memakai kata kunci lama.</span></div></label>
      <label class="opt"><input type="radio" name="kk" value="dasar" ${S.peng.gemini_api_key ? '' : 'checked'}><div><b>Dari nama IKI saja</b><span class="muted tiny">Cepat, tanpa AI — bisa disempurnakan nanti.</span></div></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" id="im-batal">Batal</button><button class="btn primary" id="im-ok">${I.upload} Impor</button></div>`, { lebar: 620 });
    $('#im-batal', bg).onclick = () => bg.remove();
    $('#im-ok', bg).onclick = async () => {
      const b = $('#im-ok', bg); b.disabled = true; b.textContent = 'Mengimpor…';
      try {
        hasil.tahun = Number($('#im-th', bg).value);
        hasil.label = `SKP ${hasil.tahun}`;
        const pakaiAI = $('input[name=kk]:checked', bg)?.value === 'ai';
        const flat = hasil.rk.flatMap(r => r.iki.map(i => ({ ...i, rk_nama: r.nama })));
        let ai = {};
        if (pakaiAI) {
          const perlu = flat.filter(i => !lama[i.nama.toLowerCase()]);
          if (perlu.length) { try { ai = await aiKataKunci(perlu, S.peng); } catch (e) { toast('AI gagal, pakai kata kunci dasar', 'err'); } }
        }
        hasil.rk.forEach(r => r.iki.forEach(i => {
          i.kata_kunci = lama[i.nama.toLowerCase()] || ai[i.kode] || saranKataKunci(i.nama);
        }));
        const p = await buatPeriodeDariSkp(hasil);
        S.perEdit = p.id; bg.remove(); toast(`SKP ${hasil.tahun} diimpor`); viewPengaturan();
      } catch (e) { toast(e.message, 'err'); b.disabled = false; b.textContent = 'Impor'; }
    };
  } catch (e) { toast('Gagal membaca file: ' + e.message, 'err'); }
}

async function salinPeriode() {
  if (!S.periode.length) return toast('Belum ada periode untuk disalin', 'err');
  const dari = S.periode.find(p => p.id === S.perEdit) || S.periode[0];
  const th = Number(prompt(`Salin RK & IKI dari ${dari.tahun} ke tahun berapa?`, dari.tahun + 1));
  if (!th) return;
  try {
    const { rk } = await daftarIki(dari.id);
    const p = await buatPeriodeDariSkp({ tahun: th, label: `SKP ${th}`, rk: rk.map(r => ({ nomor: r.nomor, nama: r.nama, iki: r.iki.map(i => ({ kode: i.kode, nama: i.nama, kata_kunci: i.kata_kunci, folder_drive: i.folder_drive })) })) });
    S.perEdit = p.id; toast(`Periode ${th} dibuat — sesuaikan RK/IKI-nya`); viewPengaturan();
  } catch (e) { toast(e.message, 'err'); }
}


// =====================================================================
// ARSIP: hapus foto server untuk satu periode (hanya yang sudah diunduh)
// =====================================================================
async function catatEkspor(ids) {
  if (!ids?.length) return;
  try {
    const waktu = await tandaiDiekspor(ids);
    const set = new Set(ids);
    S.items.forEach(k => (k.foto || []).forEach(f => { if (set.has(f.id) && !f.diekspor_at) f.diekspor_at = waktu; }));
    renderRekap();
  } catch (e) { console.warn('Gagal menandai foto terunduh', e); }
}

function tawaranHapus(n, catatan) {
  if (!n) return '';
  return `<div class="tawar">
    <b>${n} foto sudah aman tersalin.</b> Ingin menghemat ruang server?
    <div class="muted tiny" style="margin:2px 0 8px">${esc(catatan)}</div>
    <button class="btn sm danger" data-tawar="1">${I.trash} Hapus foto periode ini dari server…</button></div>`;
}
function pasangTawaran(bg) {
  const b = bg.querySelector('[data-tawar]');
  if (b) b.onclick = () => { bg.remove(); bukaHapusPeriode(); };
}

async function bukaHapusPeriode(dari = S.bulan + '-01', sampai = akhirBulan(S.bulan)) {
  const bg = modal(`
    <h3>Hapus foto dari server</h3>
    <p class="muted" style="margin:0 0 4px">Hanya <b>file foto</b> yang dihapus. Kegiatan, keterangan, kategori IKI, dan jumlah foto di rekap tetap tersimpan.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label>Dari tanggal<input type="date" id="hp-dari" value="${dari}"></label>
      <label>Sampai tanggal<input type="date" id="hp-sampai" value="${sampai}"></label>
    </div>
    <div id="hp-ringkas" class="arsip-ringkas"><p class="muted">Menghitung…</p></div>
    <label>Ketik <span class="mono" style="color:var(--err)">HAPUS</span> untuk konfirmasi<input id="hp-konf" autocomplete="off" placeholder="HAPUS"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn ghost" id="hp-batal">Batal</button>
      <button class="btn danger-solid" id="hp-ok" disabled>${I.trash} Hapus foto</button>
    </div>`, { lebar: 560 });
  let data = { aman: [], belum: [], arsip: [] };

  const hitung = async () => {
    const d = $('#hp-dari', bg).value, t = $('#hp-sampai', bg).value;
    const el = $('#hp-ringkas', bg);
    if (!d || !t || d > t) { el.innerHTML = `<p style="color:var(--err)">Rentang tanggal tidak valid.</p>`; return; }
    el.innerHTML = `<p class="muted">Menghitung…</p>`;
    try {
      const items = await kegiatanRentang(d, t);
      const fotos = items.flatMap(k => (k.foto || []).map(f => ({ ...f, tanggal: k.tanggal, keterangan: k.keterangan })));
      data = {
        aman: fotos.filter(f => f.diekspor_at && !f.dihapus_at),
        belum: fotos.filter(f => !f.diekspor_at && !f.dihapus_at),
        arsip: fotos.filter(f => f.dihapus_at)
      };
      const rentang = d === t ? tglPanjang(d) : `${tglPanjang(d)} – ${tglPanjang(t)}`;
      el.innerHTML = `
        <div class="muted tiny" style="margin-bottom:8px">${rentang} · ${items.length} kegiatan</div>
        <div class="baris-arsip del"><b>${data.aman.length}</b><span>foto sudah diunduh / ada di Drive → <b>akan dihapus</b></span></div>
        <div class="baris-arsip keep"><b>${data.belum.length}</b><span>foto belum pernah diunduh → <b>tidak dihapus</b>${data.belum.length ? '. Unduh dulu lewat ZIP atau Kirim ke Drive bila ingin menghapusnya.' : ''}</span></div>
        <div class="baris-arsip done"><b>${data.arsip.length}</b><span>foto sudah dihapus sebelumnya</span></div>
        ${data.belum.length ? `<details class="tiny" style="margin-top:6px"><summary>Lihat foto yang belum diunduh</summary>
          <ul style="margin:6px 0 0;padding-left:18px">${[...new Map(data.belum.map(f => [f.tanggal + f.keterangan, f])).values()].slice(0, 30)
            .map(f => `<li>${tglPendek(f.tanggal)} · ${esc(f.keterangan)}</li>`).join('')}</ul></details>` : ''}`;
    } catch (e) { el.innerHTML = `<p style="color:var(--err)">Gagal memuat: ${esc(e.message)}</p>`; }
    cekTombol();
  };
  const cekTombol = () => {
    const ok = data.aman.length && $('#hp-konf', bg).value.trim().toUpperCase() === 'HAPUS';
    $('#hp-ok', bg).disabled = !ok;
    $('#hp-ok', bg).innerHTML = `${I.trash} Hapus ${data.aman.length} foto`;
  };
  $('#hp-dari', bg).onchange = hitung; $('#hp-sampai', bg).onchange = hitung;
  $('#hp-konf', bg).oninput = cekTombol;
  $('#hp-batal', bg).onclick = () => bg.remove();
  $('#hp-ok', bg).onclick = async () => {
    const target = data.aman;
    bg.remove();
    const p = modalProgres(`Menghapus ${target.length} foto dari server`);
    try {
      const n = await hapusFotoServer(target, (a, b) => p.set(a, b, 'foto'));
      p.selesai(`${n} foto dihapus dari server. Kegiatan & rekapnya tetap ada.`);
      viewRekap();
    } catch (e) { p.log('Gagal: ' + e.message); p.selesai('Sebagian mungkin sudah terhapus — buka lagi untuk melanjutkan.'); viewRekap(); }
  };
  hitung();
}
