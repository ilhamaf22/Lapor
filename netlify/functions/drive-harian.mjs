// Fungsi terjadwal: setiap 15 menit memeriksa pengguna yang jam lokalnya sudah lewat jam sinkron (bawaan 16.00)
// dan belum disinkron hari ini, lalu mengirim foto yang belum ada di Google Drive mereka.
// Batas eksekusi fungsi terjadwal Netlify 30 detik → pekerjaan dibatasi ±24 detik dan dilanjutkan pada jalannya berikutnya.
import { sb, waktuLokal, jalankan } from '../lib/drive-server.mjs';

export default async () => {
  const batas = Date.now() + 24000;
  const semua = await sb('drive_koneksi?select=*&aktif=eq.true&order=terakhir_waktu.asc.nullsfirst') || [];
  const jatuhTempo = semua.filter(k => {
    const w = waktuLokal(k.zona);
    return w.jam >= k.jam && k.terakhir_tanggal !== w.tanggal;
  });
  const log = [];
  for (const k of jatuhTempo) {
    if (Date.now() > batas - 4000) break;
    const r = await jalankan(k, batas);
    log.push(`${k.email || k.user_id}: ${r.terakhir_hasil}`);
  }
  console.log(`drive-harian: ${jatuhTempo.length} jatuh tempo`, log);
  return new Response(JSON.stringify({ jatuhTempo: jatuhTempo.length, log }), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '*/15 * * * *' };
