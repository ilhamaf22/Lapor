// Stamp foto: tanggal & jam, titik lokasi, dan kegiatan — kecil di kanan bawah (seperti aplikasi kamera timestamp).
// Semua diproses di HP, jadi tetap jalan offline. Nama tempat hanya ditambahkan bila ada sinyal.

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function zonaWaktu(d = new Date()) {
  const off = -d.getTimezoneOffset() / 60;
  return off === 7 ? 'WIB' : off === 8 ? 'WITA' : off === 9 ? 'WIT' : `GMT${off >= 0 ? '+' : ''}${off}`;
}
export function teksWaktu(d) {
  const p = n => String(n).padStart(2, '0');
  return `${HARI[d.getDay()]}, ${p(d.getDate())} ${BLN[d.getMonth()]} ${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())} ${zonaWaktu(d)}`;
}
export function teksKoordinat(lat, lng, akurasi) {
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;
  return `${f(lat, 'LU', 'LS')}, ${f(lng, 'BT', 'BB')}${akurasi ? ` (±${Math.round(akurasi)} m)` : ''}`;
}

// ---------------- EXIF (waktu & GPS dari foto galeri) ----------------
export async function bacaExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return {};
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return parseTiff(v, o + 10);
      if ((marker & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
  } catch {}
  return {};
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
  const ifd = off => {
    const out = {}; const n = u16(t + off);
    for (let i = 0; i < n; i++) {
      const e = t + off + 2 + i * 12;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
    }
    return out;
  };
  const valOff = en => (en.type === 2 && en.count <= 4) || (en.type === 3 && en.count <= 2) ? en.at : t + u32(en.at);
  const ascii = en => { let s = ''; const o = valOff(en); for (let i = 0; i < en.count - 1; i++) s += String.fromCharCode(v.getUint8(o + i)); return s; };
  const rats = en => { const o = t + u32(en.at); return Array.from({ length: en.count }, (_, i) => u32(o + i * 8) / (u32(o + i * 8 + 4) || 1)); };
  const res = {};
  const ifd0 = ifd(u32(t + 4));
  const exifPtr = ifd0[0x8769], gpsPtr = ifd0[0x8825];
  let dt = null;
  if (exifPtr) { const ex = ifd(u32(exifPtr.at)); if (ex[0x9003]) dt = ascii(ex[0x9003]); }
  if (!dt && ifd0[0x0132]) dt = ascii(ifd0[0x0132]);
  if (dt) {
    const m = dt.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) res.waktu = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  if (gpsPtr) {
    const g = ifd(u32(gpsPtr.at));
    if (g[2] && g[4]) {
      const dms = a => a[0] + a[1] / 60 + a[2] / 3600;
      const ref = en => en ? String.fromCharCode(v.getUint8(valOff(en))) : '';
      let lat = dms(rats(g[2])), lng = dms(rats(g[4]));
      if (ref(g[1]) === 'S') lat = -lat;
      if (ref(g[3]) === 'W') lng = -lng;
      if (lat || lng) Object.assign(res, { lat, lng });
    }
  }
  return res;
}

// ---------------- Lokasi ----------------
let _lokasi = null, _janji = null;
export function lokasiTerakhir() { return _lokasi; }

/** Minta posisi GPS (bekerja tanpa sinyal data; di dalam gedung bisa lebih lama). */
export function ambilLokasi() {
  if (!navigator.geolocation) return Promise.resolve(null);
  if (_lokasi && Date.now() - _lokasi.t < 120000) return Promise.resolve(_lokasi);
  if (_janji) return _janji;
  _janji = new Promise(res => {
    navigator.geolocation.getCurrentPosition(
      p => { _lokasi = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: p.coords.accuracy, t: Date.now() }; res(_lokasi); },
      e => { _lokasi = _lokasi || null; res(e.code === 1 ? { ditolak: true } : null); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  }).finally(() => { _janji = null; });
  return _janji;
}

/** Nama tempat dari OpenStreetMap (hanya saat online, hasil disimpan di HP). */
export async function namaTempat(lat, lng) {
  const kunci = `lapor-tempat-${lat.toFixed(3)},${lng.toFixed(3)}`;
  try { const c = localStorage.getItem(kunci); if (c) return c; } catch {}
  if (navigator.onLine === false) return null;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=id&lat=${lat}&lon=${lng}`, { signal: ctl.signal });
    clearTimeout(tm);
    if (!r.ok) return null;
    const j = await r.json(); const a = j.address || {};
    const tempat = j.name || a.amenity || a.building || a.office || a.road;
    const area = a.village || a.suburb || a.neighbourhood || a.city_district;
    const kota = a.city || a.town || a.county || a.municipality || a.state;
    const nama = [...new Set([tempat, area, kota].filter(Boolean))].join(', ');
    if (nama) try { localStorage.setItem(kunci, nama); } catch {}
    return nama || null;
  } catch { return null; }
}

// ---------------- Menggambar stamp ----------------
function bungkus(ctx, teks, lebar, maksBaris) {
  const kata = String(teks).split(/\s+/); const baris = []; let cur = '';
  for (const k of kata) {
    const coba = cur ? cur + ' ' + k : k;
    if (ctx.measureText(coba).width <= lebar) cur = coba;
    else { if (cur) baris.push(cur); cur = k; if (baris.length === maksBaris) break; }
  }
  if (baris.length < maksBaris && cur) baris.push(cur);
  if (baris.length === maksBaris && kata.join(' ').length > baris.join(' ').length) {
    let b = baris[maksBaris - 1];
    while (b && ctx.measureText(b + '…').width > lebar) b = b.slice(0, -1);
    baris[maksBaris - 1] = b.trimEnd() + '…';
  }
  return baris;
}

/**
 * Kecilkan foto (maks 1600 px) lalu tempel stamp di kanan bawah.
 * info: { waktu: Date, lokasi: {lat,lng,akurasi}|null, tempat: string|null, kegiatan: string }
 */
export async function stampFoto(file, info, maks = 1600, kualitas = 0.85) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const skala = Math.min(1, maks / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * skala), H = Math.round(bmp.height * skala);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();

  const fs = Math.max(13, Math.round(Math.max(W, H) * 0.015));
  const font = (w, s = fs) => `${w} ${s}px "Plus Jakarta Sans", Roboto, "Segoe UI", system-ui, sans-serif`;
  const pad = Math.round(fs * 0.75), gap = Math.round(fs * 0.32), margin = Math.round(fs * 0.9);
  const maksLebar = Math.round(W * (W > H ? 0.55 : 0.7));

  const baris = [{ t: teksWaktu(info.waktu || new Date()), f: font(700, Math.round(fs * 1.06)) }];
  if (info.tempat) baris.push({ t: info.tempat, f: font(600), pin: true });
  if (info.lokasi?.lat != null) baris.push({ t: teksKoordinat(info.lokasi.lat, info.lokasi.lng, info.lokasi.akurasi), f: font(500, Math.round(fs * 0.9)), pin: !info.tempat, redup: !!info.tempat });
  if (info.kegiatan) {
    ctx.font = font(500);
    bungkus(ctx, info.kegiatan, maksLebar, 2).forEach(t => baris.push({ t, f: font(500), keg: true }));
  }

  // Ukur
  const tinggi = baris.map(b => parseInt(b.f.match(/(\d+)px/)[1], 10));
  const pinW = Math.round(fs * 0.95);
  let lebar = 0;
  baris.forEach(b => { ctx.font = b.f; lebar = Math.max(lebar, Math.min(maksLebar, ctx.measureText(b.t).width + (b.pin ? pinW : 0))); });
  const garis = info.kegiatan ? Math.round(fs * 0.55) : 0;
  const boxW = Math.ceil(lebar + pad * 2);
  const boxH = Math.ceil(tinggi.reduce((s, h) => s + h * 1.18, 0) + gap * (baris.length - 1) + pad * 2 + garis);
  const x = W - margin - boxW, y = H - margin - boxH;

  // Kotak
  ctx.save();
  ctx.fillStyle = 'rgba(10, 18, 30, 0.55)';
  const r = Math.round(fs * 0.55);
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, boxW, boxH, r) : ctx.rect(x, y, boxW, boxH); ctx.fill();
  ctx.fillStyle = '#f2a33a';
  ctx.fillRect(x + boxW - Math.round(fs * 0.22), y + r, Math.round(fs * 0.22), boxH - r * 2);
  ctx.restore();

  // Teks (rata kanan)
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = Math.round(fs * 0.15);
  const kanan = x + boxW - pad - Math.round(fs * 0.25);
  let cy = y + pad;
  baris.forEach((b, i) => {
    if (b.keg && !baris[i - 1]?.keg && garis) {
      ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(kanan - Math.min(lebar, fs * 6), cy + garis * 0.25, Math.min(lebar, fs * 6), Math.max(1, Math.round(fs * 0.06)));
      ctx.restore(); cy += garis;
    }
    ctx.font = b.f;
    ctx.fillStyle = b.redup ? 'rgba(255,255,255,.78)' : '#fff';
    let t = b.t;
    while (ctx.measureText(t).width > maksLebar - (b.pin ? pinW : 0) && t.length > 4) t = t.slice(0, -2) + '…';
    ctx.fillText(t, kanan, cy);
    if (b.pin) {
      const tw = ctx.measureText(t).width, h = tinggi[i];
      const px = kanan - tw - pinW * 0.55, py = cy + h * 0.5;
      ctx.save(); ctx.fillStyle = '#f2a33a'; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(px, py - h * 0.12, h * 0.26, Math.PI, 0); ctx.lineTo(px, py + h * 0.38); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(10,18,30,.8)'; ctx.beginPath(); ctx.arc(px, py - h * 0.12, h * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    cy += tinggi[i] * 1.18 + gap;
  });

  return await new Promise(res => c.toBlob(res, 'image/jpeg', kualitas));
}