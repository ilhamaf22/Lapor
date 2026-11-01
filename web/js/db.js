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

// =====================================================================
//  AUTENTIKASI: Masuk · Daftar · Lupa kata sandi · Atur kata sandi baru
// =====================================================================
const LINKEDIN = 'https://www.linkedin.com/in/ilham-alifian-firmansyah-58513915a/';
const EMAIL_RX = /^\S+@\S+\.\S+$/;
const urlKembali = () => location.origin + location.pathname;
const aman = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pesanAuth(e) {
  const m = String(e?.message || e);
  if (/anonymous/i.test(m)) return 'Email dan kata sandi wajib diisi.';
  if (/signups? (are|is) (not allowed|disabled)/i.test(m)) return 'Pendaftaran sedang ditutup oleh admin aplikasi.';
  if (/Invalid login credentials/i.test(m)) return 'Email atau kata sandi salah. Belum punya akun? Klik Daftar.';
  if (/Email not confirmed/i.test(m)) return 'Email belum dikonfirmasi. Buka email dari Lapor Kinerja dan klik link konfirmasinya.';
  if (/already (registered|been registered)|User already/i.test(m)) return 'Email ini sudah terdaftar. Silakan masuk, atau pakai "Lupa kata sandi".';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.';
  if (/should be at least|Password should/i.test(m)) return 'Kata sandi terlalu pendek (minimal 6 karakter).';
  if (/same.*password|different from the old/i.test(m)) return 'Kata sandi baru harus berbeda dari yang lama.';
  if (/expired|invalid.*(token|link)|otp/i.test(m)) return 'Link sudah kedaluwarsa atau sudah dipakai. Minta link baru.';
  if (/fetch|network/i.test(m)) return 'Tidak ada koneksi internet. Coba lagi saat ada sinyal.';
  return m;
}

const mata = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const inputSandi = (id, label, ac) => `<label>${label}<span class="pw-wrap"><input id="${id}" type="password" autocomplete="${ac}"><button type="button" class="pw-eye" data-eye="${id}" aria-label="Tampilkan kata sandi">${mata}</button></span></label>`;

function kartuAuth(root, isi) {
  root.innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="brand-big"><span class="logo">LK</span><div><b>Lapor Kinerja</b><small>Catat kegiatan · bukti dukung · IKI</small></div></div>
    ${isi}
    <a class="credit-mini" href="${LINKEDIN}" target="_blank" rel="noopener">Dibuat oleh <b>Ilham Alifian Firmansyah</b> · LinkedIn ↗</a>
  </div></div>`;
  root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
    const inp = document.getElementById(b.dataset.eye);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.classList.toggle('on', inp.type === 'text');
  });
  root.querySelectorAll('[data-ke]').forEach(a => a.onclick = e => {
    e.preventDefault();
    const email = root.querySelector('input[type=email]')?.value.trim();
    layarAuth(root, a.dataset.ke, { email });
  });
  const form = root.querySelector('form');
  if (form) form.onsubmit = e => e.preventDefault();
}

function info(root, html, jenis = 'ok') {
  const el = root.querySelector('.auth-info');
  if (!el) return;
  el.className = 'auth-info ' + jenis;
  el.innerHTML = html;
}
async function sibuk(btn, teks, fn) {
  const asli = btn.innerHTML; btn.disabled = true; btn.innerHTML = teks;
  try { return await fn(); }
  catch (e) { info(btn.closest('.auth-card').parentElement.parentElement, pesanAuth(e), 'err'); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = asli; } }
}

function layarAuth(root, mode = 'masuk', ekstra = {}) {
  const em = aman(ekstra.email);

  if (mode === 'masuk') {
    kartuAuth(root, `
      <h2 class="auth-h">Masuk</h2>
      <div class="auth-info hidden"></div>
      <form>
        <label>Email<input id="lg-email" type="email" autocomplete="email" value="${em}"></label>
        ${inputSandi('lg-pass', 'Kata sandi', 'current-password')}
        <div class="auth-row"><a href="#" data-ke="lupa">Lupa kata sandi?</a></div>
        <button class="btn primary block" id="lg-masuk" type="submit">Masuk</button>
      </form>
      <p class="auth-alt">Belum punya akun? <a href="#" data-ke="daftar">Daftar di sini</a></p>`);
    if (ekstra.pesan) info(root, ekstra.pesan, ekstra.jenis || 'ok');
    $('#lg-masuk').onclick = () => sibuk($('#lg-masuk'), 'Memeriksa…', async () => {
      const email = $('#lg-email').value.trim(), password = $('#lg-pass').value;
      if (!EMAIL_RX.test(email)) return info(root, 'Isi email yang valid.', 'err');
      if (!password) return info(root, 'Isi kata sandi.', 'err');
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return info(root, pesanAuth(error), 'err');
      location.reload();
    });
  }

  if (mode === 'daftar') {
    kartuAuth(root, `
      <h2 class="auth-h">Buat akun</h2>
      <p class="auth-sub">Gratis. Kegiatan & foto hanya bisa diakses oleh akunmu sendiri.</p>
      <div class="auth-info hidden"></div>
      <form>
        <label>Nama lengkap<input id="rg-nama" autocomplete="name" placeholder="Nama sesuai SKP"></label>
        <label>Email<input id="rg-email" type="email" autocomplete="email" value="${em}"></label>
        ${inputSandi('rg-pass', 'Kata sandi (min. 6 karakter)', 'new-password')}
        <div class="pw-meter"><span id="rg-meter"></span></div>
        ${inputSandi('rg-pass2', 'Ulangi kata sandi', 'new-password')}
        <button class="btn primary block" id="rg-ok" type="submit">Daftar</button>
      </form>
      <p class="auth-alt">Sudah punya akun? <a href="#" data-ke="masuk">Masuk</a></p>`);
    $('#rg-pass').oninput = () => {
      const v = $('#rg-pass').value;
      const skor = (v.length >= 6) + (v.length >= 10) + /[A-Z]/.test(v) + /\d/.test(v) + /[^A-Za-z0-9]/.test(v);
      const el = $('#rg-meter');
      el.style.width = Math.min(100, skor * 20) + '%';
      el.style.background = skor <= 1 ? 'var(--err)' : skor <= 3 ? 'var(--accent)' : 'var(--ok)';
    };
    $('#rg-ok').onclick = () => sibuk($('#rg-ok'), 'Membuat akun…', async () => {
      const nama = $('#rg-nama').value.trim(), email = $('#rg-email').value.trim();
      const password = $('#rg-pass').value, ulang = $('#rg-pass2').value;
      if (!nama) return info(root, 'Isi nama lengkap.', 'err');
      if (!EMAIL_RX.test(email)) return info(root, 'Isi email yang valid.', 'err');
      if (password.length < 6) return info(root, 'Kata sandi minimal 6 karakter.', 'err');
      if (password !== ulang) return info(root, 'Kedua kata sandi tidak sama.', 'err');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nama }, emailRedirectTo: urlKembali() } });
      if (error) return info(root, pesanAuth(error), 'err');
      // Supabase tidak memberi galat bila email sudah terdaftar & terkonfirmasi: identities kosong
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
        return info(root, pesanAuth('already registered'), 'err');
      if (data.session) {
        try { await sb.from('pengaturan').upsert({ user_id: data.session.user.id, nama_pegawai: nama }); } catch {}
        location.reload();
        return;
      }
      kartuAuth(root, `
        <div class="auth-done"><div class="ic-big">✉️</div>
          <h2 class="auth-h">Cek emailmu</h2>
          <p class="auth-sub">Link konfirmasi sudah dikirim ke <b>${aman(email)}</b>. Klik link itu, lalu kamu otomatis masuk.</p>
          <p class="muted tiny">Tidak ada di kotak masuk? Cek folder Spam/Promosi. Email bisa butuh 1–2 menit.</p>
        </div>
        <div class="auth-info hidden"></div>
        <button class="btn block" id="rg-ulang">Kirim ulang email</button>
        <p class="auth-alt"><a href="#" data-ke="masuk">Kembali ke halaman masuk</a></p>`);
      $('#rg-ulang').onclick = () => sibuk($('#rg-ulang'), 'Mengirim…', async () => {
        const { error: e2 } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: urlKembali() } });
        info(root, e2 ? pesanAuth(e2) : 'Email konfirmasi sudah dikirim ulang.', e2 ? 'err' : 'ok');
      });
    });
  }

  if (mode === 'lupa') {
    kartuAuth(root, `
      <h2 class="auth-h">Lupa kata sandi</h2>
      <p class="auth-sub">Masukkan email akunmu. Kami kirim link untuk membuat kata sandi baru.</p>
      <div class="auth-info hidden"></div>
      <form>
        <label>Email<input id="lp-email" type="email" autocomplete="email" value="${em}"></label>
        <button class="btn primary block" id="lp-ok" type="submit">Kirim link reset</button>
      </form>
      <p class="auth-alt"><a href="#" data-ke="masuk">← Kembali ke halaman masuk</a></p>`);
    if (ekstra.pesan) info(root, ekstra.pesan, ekstra.jenis || 'ok');
    $('#lp-ok').onclick = () => sibuk($('#lp-ok'), 'Mengirim…', async () => {
      const email = $('#lp-email').value.trim();
      if (!EMAIL_RX.test(email)) return info(root, 'Isi email yang valid.', 'err');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: urlKembali() });
      if (error) return info(root, pesanAuth(error), 'err');
      info(root, `Bila <b>${aman(email)}</b> terdaftar, link reset sudah dikirim. Buka email itu dan klik linknya — sebaiknya di perangkat ini. Cek juga folder Spam.`, 'ok');
    });
  }

  if (mode === 'baru') {
    kartuAuth(root, `
      <h2 class="auth-h">Buat kata sandi baru</h2>
      <p class="auth-sub">Untuk akun <b>${em}</b></p>
      <div class="auth-info hidden"></div>
      <form>
        ${inputSandi('nb-pass', 'Kata sandi baru (min. 6 karakter)', 'new-password')}
        ${inputSandi('nb-pass2', 'Ulangi kata sandi baru', 'new-password')}
        <button class="btn primary block" id="nb-ok" type="submit">Simpan kata sandi</button>
      </form>`);
    $('#nb-ok').onclick = () => sibuk($('#nb-ok'), 'Menyimpan…', async () => {
      const a = $('#nb-pass').value, b = $('#nb-pass2').value;
      if (a.length < 6) return info(root, 'Kata sandi minimal 6 karakter.', 'err');
      if (a !== b) return info(root, 'Kedua kata sandi tidak sama.', 'err');
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) return info(root, pesanAuth(error), 'err');
      info(root, 'Kata sandi berhasil diperbarui. Membuka aplikasi…', 'ok');
      setTimeout(() => location.reload(), 900);
    });
  }
}

/** Pastikan sudah terhubung & login. Mengembalikan true jika siap. */
export async function siapkan(root) {
  const cfg = bacaConfig();
  if (!cfg) { layarSetup(root); return false; }
  sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: fetchBatas }
  });
  // Kembali dari link email (konfirmasi daftar / reset kata sandi)?
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const dariEmail = hash.has('access_token') || hash.has('error_description') || query.has('code') || query.has('error_description');
  if (dariEmail) {
    const galat = hash.get('error_description') || query.get('error_description');
    const jenis = hash.get('type') || query.get('type');
    let sesiBaru = null;
    try { sesiBaru = (await tunggu(sb.auth.getSession(), 10000)).data?.session; } catch {}
    history.replaceState(null, '', location.pathname);
    if (galat || !sesiBaru) {
      layarAuth(root, jenis === 'recovery' ? 'lupa' : 'masuk', { pesan: pesanAuth(galat || 'link expired'), jenis: 'err' });
      return false;
    }
    if (jenis === 'recovery') { layarAuth(root, 'baru', { email: sesiBaru.user.email }); return false; }
    // Konfirmasi pendaftaran berhasil → simpan nama ke pengaturan
    const nama = sesiBaru.user.user_metadata?.nama;
    if (nama) { try { await sb.from('pengaturan').upsert({ user_id: sesiBaru.user.id, nama_pegawai: nama }); } catch {} }
    toast('Email terkonfirmasi. Selamat datang!');
  }
  // Sesi yang sudah tersimpan di HP langsung dipakai (instan, juga offline). Pembaruan token berjalan di latar belakang.
  let sesi = sesiTersimpan();
  if (sesi) sb.auth.getSession().catch(() => {});
  else { try { sesi = (await tunggu(sb.auth.getSession(), 8000)).data?.session; } catch {} }
  if (!sesi) { layarAuth(root, 'masuk'); return false; }
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
    // Foto yang sudah diberi stamp sudah dikecilkan & berupa JPEG → tidak dikompres ulang
    const blob = f instanceof File ? await kompresFoto(f) : f;
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