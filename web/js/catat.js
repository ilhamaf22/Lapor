// Halaman HP — offline-first.
// Buka: tampil dari cache perangkat dulu (instan), lalu diperbarui dari server bila ada sinyal.
// Simpan: selalu ke HP dulu (instan), lalu dikirim otomatis saat ada jaringan.
import { siapkan, user, periodeUntukTanggal, daftarIki, ikiTersimpan, kegiatanRentang, urlFoto, hapusKegiatan, ubahKegiatan,
  pengaturan, catatLokal, ubahLokal, hapusLokal, daftarLokal, sinkron, dengarSinkron, statusSinkron, mintaPenyimpananTetap } from './db.js';
import { $, $$, esc, hariIni, tglPanjang, toast, salin, chipIki } from './util.js';
import { klasifikasiKataKunci } from './klasifikasi.js';
import { I } from './icons.js';

const root = document.getElementById('app');
const state = {
  tanggal: hariIni(), files: [], iki: [], ikiMap: {}, override: '',
  server: [], lokal: [], urls: {}, blobUrls: new Map()
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'sinkron') jalankanSinkron(); });
}

(async function mulai() {
  if (!(await siapkan(root))) return;
  render();
  pakaiIkiTersimpan();
  bacaCacheHari();
  await tampilkan();                       // ← layar penuh sudah muncul di sini, tanpa menunggu jaringan
  mintaPenyimpananTetap();
  dengarSinkron(renderStatus);
  jalankanSinkron();
  segarkanDariServer();                    // latar belakang
  window.addEventListener('online', () => { renderStatus(); jalankanSinkron(); segarkanDariServer(); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { jalankanSinkron(); segarkanDariServer(); } });
  setInterval(() => { if (state.lokal.length && navigator.onLine) jalankanSinkron(); }, 20000);
})();

function sapaan() {
  const h = new Date().getHours();
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}

function render() {
  const nama = (user.email || '').split('@')[0];
  root.innerHTML = `
  <div class="m-app">
    <header class="m-head">
      <div class="row">
        <div><div class="hello">${sapaan()}, ${esc(nama)}</div><h1 id="judul-tgl"></h1></div>
        <a class="icon-btn" href="dashboard.html" title="Buka dashboard web">${I.web}</a>
      </div>
      <button class="sync-pill" id="sync"></button>
      <div class="m-stats">
        <div><b id="st-keg">0</b><small>kegiatan</small></div>
        <div><b id="st-foto">0</b><small>foto</small></div>
        <div><b id="st-q">0</b><small>belum terkirim</small></div>
      </div>
    </header>

    <main class="m-body">
      <section class="card m-form">
        <h2>Catat kegiatan</h2>
        <div class="cam-row">
          <button class="btn cam" id="b-kamera">${I.camera} Kamera</button>
          <button class="btn" id="b-galeri">${I.image} Galeri</button>
        </div>
        <input type="file" id="in-kamera" accept="image/*" capture="environment" hidden>
        <input type="file" id="in-galeri" accept="image/*" multiple hidden>
        <div class="shots" id="shots"></div>

        <label>Keterangan kegiatan
          <textarea id="ket" placeholder="mis. Membuat desain spanduk SE2026 untuk Kantor Gubernur"></textarea>
        </label>
        <div class="preview-kat" id="prev-kat"></div>

        <div class="form-foot">
          <label>Tanggal<input type="date" id="tgl"></label>
          <label>Kategori IKI<select id="ovr"><option value="">Otomatis</option></select></label>
        </div>
        <button class="btn primary block" id="b-simpan" style="margin-top:14px;padding:14px">${I.save} Simpan kegiatan</button>
      </section>

      <div class="today-head">
        <div><h3 id="judul-list">Kegiatan hari ini</h3><div class="sub" id="sub-list"></div></div>
      </div>
      <div class="feed" id="feed"></div>
    </main>

    <div class="dock">
      <button class="btn accent" id="b-salin">${I.copy} <span id="lbl-salin">Salin kegiatan hari ini</span></button>
      <button class="btn" id="b-refresh" title="Sinkronkan sekarang">↻</button>
    </div>
  </div>`;

  $('#tgl').value = state.tanggal;
  $('#b-kamera').onclick = () => $('#in-kamera').click();
  $('#b-galeri').onclick = () => $('#in-galeri').click();
  $('#in-kamera').onchange = e => tambahFile(e.target.files);
  $('#in-galeri').onchange = e => tambahFile(e.target.files);
  $('#ket').oninput = previewKategori;
  $('#ovr').onchange = e => { state.override = e.target.value; previewKategori(); };
  $('#tgl').onchange = async e => {
    state.tanggal = e.target.value || hariIni();
    pakaiIkiTersimpan(); bacaCacheHari(); await tampilkan(); segarkanDariServer();
  };
  $('#b-simpan').onclick = simpan;
  $('#b-salin').onclick = bukaSalin;
  $('#b-refresh').onclick = async () => {
    if (navigator.onLine === false) return toast('Sedang offline — akan terkirim otomatis saat ada sinyal');
    await jalankanSinkron(); await segarkanDariServer(); toast('Diperbarui');
  };
  $('#sync').onclick = () => $('#b-refresh').click();
  renderShots();
  renderStatus();
}

function judul() {
  const today = state.tanggal === hariIni();
  $('#judul-tgl').textContent = tglPanjang(state.tanggal);
  $('#judul-list').textContent = today ? 'Kegiatan hari ini' : 'Kegiatan ' + tglPanjang(state.tanggal);
  $('#lbl-salin').textContent = today ? 'Salin kegiatan hari ini' : 'Salin kegiatan tanggal ini';
}

// ---------- Status sinkron ----------
function renderStatus(st = statusSinkron) {
  const el = $('#sync'); if (!el) return;
  const n = state.lokal.length;
  let cls = 'ok', teks = 'Online · semua tersimpan di server';
  if (navigator.onLine === false) { cls = 'off'; teks = n ? `Offline · ${n} kegiatan disimpan di HP` : 'Offline · catatan tetap bisa disimpan'; }
  else if (st.jalan) { cls = 'run'; teks = `Mengirim ${Math.min(st.selesai + 1, st.total)}/${st.total}…`; }
  else if (n) { cls = 'wait'; teks = `${n} kegiatan menunggu dikirim${st.galat ? ' · ketuk untuk coba lagi' : ''}`; }
  el.className = 'sync-pill ' + cls;
  el.innerHTML = `<i></i>${esc(teks)}`;
}

async function jalankanSinkron() {
  if (!(await daftarLokal()).length) return;
  const r = await sinkron().catch(() => null);
  if (r?.terkirim) {
    toast(`${r.terkirim} kegiatan terkirim ke server`);
    await segarkanDariServer();
  } else await tampilkan();
}

// ---------- Foto ----------
function tambahFile(list) {
  for (const f of list) state.files.push({ file: f, url: URL.createObjectURL(f) });
  renderShots();
  $('#in-kamera').value = ''; $('#in-galeri').value = '';
}
function renderShots() {
  const el = $('#shots');
  el.innerHTML = state.files.map((f, i) => `<div class="shot"><img src="${f.url}" alt=""><button data-i="${i}" aria-label="Hapus">×</button></div>`).join('')
    + `<button class="add-shot" id="add-more">${I.plus}${state.files.length ? 'Tambah' : 'Foto bukti'}</button>`;
  $$('.shot button', el).forEach(b => b.onclick = () => { URL.revokeObjectURL(state.files[b.dataset.i].url); state.files.splice(b.dataset.i, 1); renderShots(); });
  $('#add-more').onclick = () => $('#in-galeri').click();
}

// ---------- IKI ----------
function setIki(flat) {
  state.iki = flat || [];
  state.ikiMap = Object.fromEntries(state.iki.map(i => [i.id, i]));
  const pilih = $('#ovr').value;
  $('#ovr').innerHTML = `<option value="">Otomatis</option>` + state.iki.map(i => `<option value="${i.id}">${esc(i.kode)} · ${esc(i.nama.slice(0, 60))}</option>`).join('');
  $('#ovr').value = state.ikiMap[pilih] ? pilih : '';
  state.override = $('#ovr').value;
}
function pakaiIkiTersimpan() {
  const c = ikiTersimpan(state.tanggal);
  setIki(c?.flat || []);
}
async function muatIkiServer() {
  const per = await periodeUntukTanggal(state.tanggal);
  if (!per) {
    setIki([]);
    $('#prev-kat').innerHTML = `<span class="muted tiny">Belum ada RK/IKI. Atur dulu di <a href="dashboard.html#pengaturan">dashboard → Pengaturan</a>.</span>`;
    return;
  }
  setIki((await daftarIki(per.id)).flat);
}

let tPrev;
function previewKategori() {
  clearTimeout(tPrev);
  tPrev = setTimeout(() => {
    const el = $('#prev-kat');
    const teks = $('#ket').value.trim();
    if (state.override) { el.innerHTML = chipIki(state.ikiMap[state.override]) + '<span class="src">dipilih manual</span>'; return; }
    if (!teks || !state.iki.length) { el.innerHTML = ''; return; }
    const k = klasifikasiKataKunci(teks, state.iki);
    if (k.status === 'pasti') el.innerHTML = chipIki(state.ikiMap[k.iki_id]) + '<span class="src">kata kunci</span>';
    else el.innerHTML = `<span class="src">✦ AI akan menentukan IKI saat terkirim ke server</span>`;
  }, 150);
}

// ---------- Simpan (selalu ke HP dulu → instan) ----------
async function simpan() {
  const keterangan = $('#ket').value.trim();
  if (!keterangan) return toast('Tulis keterangan kegiatannya dulu', 'err');
  const btn = $('#b-simpan');
  btn.disabled = true; btn.innerHTML = 'Menyimpan…';
  try {
    const rec = await catatLokal({
      tanggal: state.tanggal, keterangan, files: state.files.map(f => f.file),
      iki_id: state.override || null, ikiList: state.iki
    });
    state.files.forEach(f => URL.revokeObjectURL(f.url));
    state.files = []; $('#ket').value = ''; $('#prev-kat').innerHTML = '';
    renderShots();
    const kode = state.ikiMap[rec.iki_id]?.kode;
    toast(navigator.onLine === false
      ? `Tersimpan di HP${kode ? ' → IKI ' + kode : ''} · dikirim saat ada sinyal`
      : `Tersimpan${kode ? ' → IKI ' + kode : ''}`);
    await tampilkan();
    daftarkanBackgroundSync();
    jalankanSinkron();
  } catch (e) {
    toast('Gagal menyimpan: ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false; btn.innerHTML = `${I.save} Simpan kegiatan`;
  }
}

async function daftarkanBackgroundSync() {
  try { const reg = await navigator.serviceWorker?.ready; await reg?.sync?.register('lapor-sinkron'); } catch {}
}

// ---------- Data hari ini ----------
const kunciCache = () => 'lapor-hari-' + state.tanggal;
function bacaCacheHari() {
  try { state.server = JSON.parse(localStorage.getItem(kunciCache()) || '[]'); } catch { state.server = []; }
  state.urls = {};
}

async function segarkanDariServer() {
  if (navigator.onLine === false) return;
  try {
    await muatIkiServer();
    pengaturan().catch(() => {});
    const items = await kegiatanRentang(state.tanggal, state.tanggal);
    state.server = items;
    try { localStorage.setItem(kunciCache(), JSON.stringify(items)); } catch {}
    try { state.urls = await urlFoto(items.flatMap(k => (k.foto || []).filter(f => !f.dihapus_at).slice(0, 1).map(f => f.path))); } catch {}
    await tampilkan();
  } catch (e) { console.warn('Gagal memuat dari server', e); }
}

function urlLokal(rec) {
  const f = rec.fotos?.[0]; if (!f) return null;
  if (!state.blobUrls.has(f.id)) state.blobUrls.set(f.id, URL.createObjectURL(f.blob));
  return state.blobUrls.get(f.id);
}

/** Gabungan kegiatan server + yang masih di HP, urut waktu catat */
function gabungan() {
  const idServer = new Set(state.server.map(k => k.id));
  const lokal = state.lokal.filter(k => k.tanggal === state.tanggal && !idServer.has(k.id))
    .map(k => ({ ...k, _lokal: true, waktu: k.dibuat, nFoto: k.fotos?.length || 0 }));
  const srv = state.server.map(k => ({ ...k, waktu: Date.parse(k.created_at) || 0, nFoto: k.foto?.length || 0 }));
  return [...srv, ...lokal].sort((a, b) => a.waktu - b.waktu);
}

async function tampilkan() {
  judul();
  state.lokal = await daftarLokal().catch(() => []);
  renderStatus();
  const items = gabungan();
  $('#st-q').textContent = state.lokal.length;
  $('#st-keg').textContent = items.length;
  $('#st-foto').textContent = items.reduce((s, k) => s + k.nFoto, 0);
  $('#sub-list').textContent = items.length ? `${items.length} kegiatan tercatat` : '';

  const feed = $('#feed');
  if (!items.length) {
    feed.innerHTML = `<div class="card empty-state">${I.calendar}<p>Belum ada kegiatan di tanggal ini.<br>Foto bukti dukungnya, tulis keterangan, simpan.</p></div>`;
    return;
  }
  feed.innerHTML = items.map(k => {
    const fAktif = (k.foto || []).find(f => !f.dihapus_at);
    const url = k._lokal ? urlLokal(k) : (fAktif && state.urls[fAktif.path]);
    const thumb = url
      ? `<div class="thumb" style="background-image:url('${url}')">${k.nFoto > 1 ? `<span class="n">+${k.nFoto - 1}</span>` : ''}</div>`
      : `<div class="thumb empty">${k.nFoto ? `${I.image}<span class="n">${k.nFoto}</span>` : I.image}</div>`;
    const src = k.sumber_kategori ? `<span class="src">${k.sumber_kategori === 'ai' ? '✦ AI' : k.sumber_kategori === 'manual' ? 'manual' : 'kata kunci'}</span>` : '';
    const status = k._lokal ? `<span class="badge-q">${I.cloud} ${navigator.onLine === false ? 'Di HP' : 'Mengirim…'}</span>` : '';
    return `
      <div class="card feed-item ${k._lokal ? 'is-lokal' : ''}">
        ${thumb}
        <div>
          <p>${esc(k.keterangan)}</p>
          <div class="meta">${chipIki(state.ikiMap[k.iki_id])}${src}${status}</div>
          <div class="acts">
            <button class="btn sm ghost" data-kat="${k.id}" data-l="${k._lokal ? 1 : ''}">${I.target} Ubah IKI</button>
            <button class="btn sm ghost danger" data-del="${k.id}" data-l="${k._lokal ? 1 : ''}">${I.trash}</button>
          </div>
        </div>
      </div>`;
  }).join('');

  $$('[data-del]', feed).forEach(b => b.onclick = async () => {
    if (!confirm('Hapus kegiatan ini beserta fotonya?')) return;
    try {
      if (b.dataset.l) await hapusLokal(b.dataset.del);
      else {
        await hapusKegiatan(state.server.find(x => x.id === b.dataset.del));
        state.server = state.server.filter(x => x.id !== b.dataset.del);
        localStorage.setItem(kunciCache(), JSON.stringify(state.server));
      }
      toast('Dihapus'); tampilkan();
    } catch (e) { toast(navigator.onLine === false ? 'Kegiatan yang sudah di server hanya bisa dihapus saat online' : e.message, 'err'); }
  });
  $$('[data-kat]', feed).forEach(b => b.onclick = () => pilihIki(items.find(x => x.id === b.dataset.kat)));
}

function sheet(html) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  bg.onclick = e => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg);
  return bg;
}

function pilihIki(k) {
  const bg = sheet(`
    <h3 style="margin:0 0 4px">Ubah kategori IKI</h3>
    <p class="muted tiny" style="margin:0">${esc(k.keterangan)}</p>
    <label>IKI<select id="sel-iki"><option value="">— Belum dikategorikan —</option>
      ${state.iki.map(i => `<option value="${i.id}" ${i.id === k.iki_id ? 'selected' : ''}>${esc(i.kode)} · ${esc(i.nama)}</option>`).join('')}
    </select></label>
    <button class="btn primary block" id="ok-iki" style="margin-top:14px">Simpan</button>`);
  $('#ok-iki', bg).onclick = async () => {
    const v = $('#sel-iki', bg).value || null;
    const patch = { iki_id: v, sumber_kategori: v ? 'manual' : null, alasan_kategori: null };
    try {
      if (k._lokal) await ubahLokal(k.id, patch);
      else {
        await ubahKegiatan(k.id, patch);
        Object.assign(state.server.find(x => x.id === k.id), patch);
        localStorage.setItem(kunciCache(), JSON.stringify(state.server));
      }
      bg.remove(); toast('Kategori diubah'); tampilkan();
    } catch { toast('Kegiatan yang sudah di server hanya bisa diubah saat online', 'err'); }
  };
}

// ---------- Salin (termasuk yang masih di HP) ----------
function teksSalin({ iki, nomor }) {
  const baris = gabungan().map((k, i) => {
    const pre = nomor ? `${i + 1}. ` : '- ';
    const ik = iki && state.ikiMap[k.iki_id] ? ` [IKI ${state.ikiMap[k.iki_id].kode}]` : '';
    return pre + k.keterangan + ik;
  });
  return `Kegiatan ${tglPanjang(state.tanggal)}:\n` + baris.join('\n');
}

function bukaSalin() {
  if (!gabungan().length) return toast('Belum ada kegiatan untuk disalin', 'err');
  let opsi = { iki: false, nomor: true };
  try { opsi = JSON.parse(localStorage.getItem('lapor-salin')) || opsi; } catch {}
  const bg = sheet(`
    <h3 style="margin:0 0 8px">Salin kegiatan</h3>
    <label class="switch"><input type="checkbox" id="o-nomor" ${opsi.nomor ? 'checked' : ''}> Pakai penomoran</label>
    <label class="switch"><input type="checkbox" id="o-iki" ${opsi.iki ? 'checked' : ''}> Sertakan kode IKI</label>
    <pre id="pv"></pre>
    <button class="btn accent block" id="do-salin" style="padding:14px">${I.copy} Salin ke clipboard</button>`);
  const upd = () => {
    const o = { nomor: $('#o-nomor', bg).checked, iki: $('#o-iki', bg).checked };
    try { localStorage.setItem('lapor-salin', JSON.stringify(o)); } catch {}
    $('#pv', bg).textContent = teksSalin(o);
  };
  $('#o-nomor', bg).onchange = upd; $('#o-iki', bg).onchange = upd; upd();
  $('#do-salin', bg).onclick = async () => {
    if (await salin($('#pv', bg).textContent)) { toast('Tersalin! Tinggal tempel.'); bg.remove(); }
    else toast('Gagal menyalin', 'err');
  };
}
