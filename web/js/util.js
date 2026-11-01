// Utilitas umum
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Tanggal hari ini (zona waktu perangkat) dalam format YYYY-MM-DD */
export function hariIni() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function bulanIni() { return hariIni().slice(0, 7); }

function parseTgl(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function tglPanjang(iso) { const d = parseTgl(iso); return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`; }
export function tglPendek(iso) { const d = parseTgl(iso); return `${String(d.getDate()).padStart(2, '0')} ${BLN3[d.getMonth()]}`; }
export function namaBulan(ym) { const [y, m] = ym.split('-').map(Number); return `${BULAN[m - 1]} ${y}`; }
export function akhirBulan(ym) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 0).getDate(); return `${ym}-${String(d).padStart(2, '0')}`; }

/** Kompres foto: sisi terpanjang maks 1600px, JPEG kualitas 0,8 — hemat kuota & cepat diunggah */
export async function kompresFoto(file, maks = 1600, kualitas = 0.8) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const skala = Math.min(1, maks / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * skala), h = Math.round(bmp.height * skala);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', kualitas));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function salin(teks) {
  try { await navigator.clipboard.writeText(teks); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = teks; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

let toastTimer;
export function toast(pesan, jenis = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = 'toast show ' + jenis;
  el.textContent = pesan;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Warna khas tiap Rencana Kinerja */
export const warnaRk = nomor => nomor ? `var(--rk${((Number(nomor) - 1) % 7) + 1})` : 'var(--rk0)';

/** Chip IKI */
export function chipIki(iki, { pendek = true } = {}) {
  if (!iki) return `<span class="chip none"><span class="k">?</span><span class="t">Belum dikategorikan</span></span>`;
  const t = pendek ? namaFolderIki(iki).replace(/^\S+\s/, '') : iki.nama;
  return `<span class="chip" style="--c:${warnaRk(iki.rk_nomor)}" title="${esc(iki.nama)}"><span class="k">${esc(iki.kode)}</span><span class="t">${esc(t)}</span></span>`;
}

export function slug(s, maks = 50) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().slice(0, maks).trim().replace(/ /g, '_') || 'kegiatan';
}

/** Nama folder pendek untuk IKI: "4.2 Desain publisitas pada media cetak" */
export function namaFolderIki(iki) {
  const pendek = String(iki.nama)
    .replace(/^(persentase|presentase|jumlah|tingkat)\s+/i, '')
    .replace(/^(terselenggaranya|terlaksananya|tersedianya|terpenuhinya)\s+/i, '')
    .replace(/\s+sebesar\s+.*$/i, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const kap = pendek.charAt(0).toUpperCase() + pendek.slice(1);
  return `${iki.kode} ${kap}`.slice(0, 90).trim();
}

/** Jalankan fungsi async dengan batas paralel */
export async function paralel(items, n, fn) {
  const hasil = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; hasil[k] = await fn(items[k], k); }
  }));
  return hasil;
}

// ---------- IndexedDB kecil untuk antrean offline ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('lapor-kinerja', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('antrian', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function antrianTambah(item) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('antrian', 'readwrite'); tx.objectStore('antrian').put(item); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function antrianSemua() {
  const db = await idb();
  return new Promise((res, rej) => { const r = db.transaction('antrian').objectStore('antrian').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}
export async function antrianHapus(id) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('antrian', 'readwrite'); tx.objectStore('antrian').delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
