// Klasifikasi kegiatan → IKI
// 1) Cocokkan kata kunci tiap IKI. Kalau ada satu IKI dengan skor tertinggi yang jelas, pakai itu (tanpa AI).
// 2) Kalau tidak ada kata kunci yang cocok, atau skornya seri, tanyakan ke Gemini.
// 3) Kalau Gemini tidak tersedia, pakai kandidat kata kunci teratas (kalau ada) atau biarkan kosong.

export function normalisasi(teks) {
  return ' ' + String(teks || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() + ' ';
}

/** Skor setiap IKI berdasarkan kata kunci. Kata kunci multi-kata dihitung lebih berat (lebih spesifik). */
export function skorKataKunci(teks, daftarIki) {
  const t = normalisasi(teks);
  const hasil = [];
  for (const iki of daftarIki) {
    let skor = 0;
    const cocok = [];
    for (const kw of iki.kata_kunci || []) {
      const k = normalisasi(kw).trim();
      if (!k) continue;
      if (t.includes(' ' + k + ' ')) {
        skor += k.split(' ').length;
        cocok.push(kw);
      }
    }
    if (skor > 0) hasil.push({ iki_id: iki.id, skor, cocok });
  }
  return hasil.sort((a, b) => b.skor - a.skor);
}

export function klasifikasiKataKunci(teks, daftarIki) {
  const skor = skorKataKunci(teks, daftarIki);
  if (!skor.length) return { status: 'kosong', kandidat: [] };
  if (skor.length === 1 || skor[0].skor > skor[1].skor) {
    return {
      status: 'pasti',
      iki_id: skor[0].iki_id,
      sumber: 'kata_kunci',
      alasan: 'Kata kunci: ' + skor[0].cocok.join(', '),
      kandidat: skor
    };
  }
  return { status: 'seri', kandidat: skor };
}

function labelIki(iki) {
  return `${iki.kode} — ${iki.nama}` + (iki.rk_nama ? ` (RK: ${iki.rk_nama})` : '');
}

/** Panggil Gemini untuk sekumpulan kegiatan sekaligus (hemat kuota). */
export async function klasifikasiAI(items, daftarIki, pengaturan) {
  const key = pengaturan?.gemini_api_key;
  if (!key) throw new Error('API key Gemini belum diisi di Pengaturan');
  const model = pengaturan?.gemini_model || 'gemini-3.5-flash-lite';
  const kodeKeId = Object.fromEntries(daftarIki.map(i => [i.kode, i.id]));

  const prompt = `Kamu membantu pegawai BPS memetakan catatan kegiatan harian ke Indikator Kinerja Individu (IKI) pada SKP-nya.

Daftar IKI:
${daftarIki.map(i => '- ' + labelIki(i) + (i.kata_kunci?.length ? `\n  contoh kata kunci: ${i.kata_kunci.slice(0, 12).join(', ')}` : '')).join('\n')}

Untuk setiap kegiatan di bawah, pilih SATU kode IKI yang paling sesuai. Jika benar-benar tidak ada yang cocok, isi kode "-".
Berikan alasan singkat (maks 12 kata, bahasa Indonesia).

Kegiatan:
${items.map((it, n) => `${n + 1}. [id:${it.id}] ${it.teks}${it.kandidat?.length ? `  (kandidat kata kunci: ${it.kandidat.map(k => daftarIki.find(i => i.id === k.iki_id)?.kode).join(', ')})` : ''}`).join('\n')}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            kode: { type: 'STRING' },
            alasan: { type: 'STRING' }
          },
          required: ['id', 'kode', 'alasan']
        }
      }
    }
  };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const teks = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '[]';
  let arr;
  try { arr = JSON.parse(teks); } catch { arr = []; }
  const out = new Map();
  for (const r of arr) {
    const id = kodeKeId[String(r.kode).trim()];
    out.set(String(r.id), id ? { iki_id: id, sumber: 'ai', alasan: 'AI: ' + (r.alasan || '') } : null);
  }
  return out;
}

/**
 * Klasifikasi banyak kegiatan: kata kunci dulu, sisanya ke AI dalam satu panggilan.
 * items: [{id, teks}] → Map id → {iki_id, sumber, alasan} | null
 */
export async function klasifikasi(items, daftarIki, pengaturan) {
  const hasil = new Map();
  const perluAI = [];
  for (const it of items) {
    const k = klasifikasiKataKunci(it.teks, daftarIki);
    if (k.status === 'pasti') hasil.set(it.id, { iki_id: k.iki_id, sumber: k.sumber, alasan: k.alasan });
    else perluAI.push({ ...it, kandidat: k.kandidat });
  }
  if (perluAI.length) {
    let ai = null;
    try {
      if (pengaturan?.gemini_api_key && navigator.onLine !== false) {
        ai = new Map();
        for (let i = 0; i < perluAI.length; i += 40) {
          const part = await klasifikasiAI(perluAI.slice(i, i + 40), daftarIki, pengaturan);
          part.forEach((v, k) => ai.set(k, v));
        }
      }
    } catch (e) {
      console.warn('AI gagal:', e);
      ai = null;
    }
    for (const it of perluAI) {
      const r = ai?.get(String(it.id));
      if (r) hasil.set(it.id, r);
      else if (it.kandidat?.length) {
        hasil.set(it.id, { iki_id: it.kandidat[0].iki_id, sumber: 'kata_kunci', alasan: 'Kata kunci (seri): ' + it.kandidat[0].cocok.join(', ') });
      } else hasil.set(it.id, null);
    }
  }
  return hasil;
}

/** Minta AI menyusun kata kunci untuk tiap IKI (dipakai saat impor SKP tahun baru). ikiList: [{kode,nama,rk_nama}] */
export async function aiKataKunci(ikiList, pengaturan, konteks = '') {
  const key = pengaturan?.gemini_api_key;
  if (!key) throw new Error('API key Gemini belum diisi di Pengaturan');
  const model = pengaturan?.gemini_model || 'gemini-3.5-flash-lite';
  const prompt = `Seorang pegawai BPS (Badan Pusat Statistik) mencatat kegiatan hariannya dengan kalimat singkat, misalnya
"Membuat desain spanduk SE2026", "Rilis BRS inflasi", "Mengunggah reels ke Instagram".
${konteks ? 'Konteks jabatan: ' + konteks + '\n' : ''}
Untuk setiap IKI di bawah, susun 12–20 kata kunci/frasa pendek (huruf kecil, bahasa Indonesia sehari-hari kantor, boleh singkatan umum BPS)
yang kemungkinan muncul di catatan kegiatan untuk IKI tersebut. Hindari kata terlalu umum (mis. "kegiatan", "statistik", "rapat") dan
hindari kata kunci yang sama di dua IKI berbeda.

${ikiList.map(i => `- ${i.kode}: ${i.nama}${i.rk_nama ? ' (RK: ' + i.rk_nama + ')' : ''}`).join('\n')}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4, responseMimeType: 'application/json',
        responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { kode: { type: 'STRING' }, kata_kunci: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['kode', 'kata_kunci'] } }
      }
    })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const arr = JSON.parse(data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '[]');
  return Object.fromEntries(arr.map(r => [String(r.kode).trim(), (r.kata_kunci || []).map(s => String(s).toLowerCase().trim()).filter(Boolean)]));
}

/** Saran kata kunci otomatis dari nama IKI (untuk SKP baru hasil impor). */
const STOP = new Set(('persentase presentase terselenggaranya terlaksananya tersedianya terpenuhinya pemenuhan sebesar persen ' +
  'yang dan atau dengan pada dalam untuk dari di ke oleh serta kegiatan pelaksanaan penyelenggaraan 100 indikator ' +
  'kinerja individu tingkat jumlah nilai target berkualitas efektif berdampak').split(' '));
export function saranKataKunci(nama) {
  const kata = normalisasi(nama).trim().split(' ').filter(w => w.length > 2 && !STOP.has(w));
  const frasa = [];
  for (let i = 0; i < kata.length - 1; i++) frasa.push(kata[i] + ' ' + kata[i + 1]);
  return [...new Set([...frasa, ...kata.filter(w => w.length > 4)])].slice(0, 15);
}
