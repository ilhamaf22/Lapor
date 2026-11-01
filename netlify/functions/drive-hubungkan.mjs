// POST /.netlify/functions/drive-hubungkan   (Authorization: Bearer <token login Supabase>)
//   { aksi: 'konfig' }                                  → client id & scope untuk membuka login Google
//   { aksi: 'hubungkan', code, redirectUri, zona, jam } → tukar kode → simpan refresh token (hanya di server)
//   { aksi: 'sinkron' }                                 → sinkron sekarang (±8 dtk per panggilan; panggil ulang bila belum selesai)
//   { aksi: 'putus' }                                   → cabut izin Google & hapus koneksi
import { cfg, sb, penggunaDariJwt, tukarKode, cabutToken, emailDariIdToken, jalankan, SCOPE } from '../lib/drive-server.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Gunakan POST' }, 405);
  let c;
  try { c = cfg(); } catch (e) { return json({ error: e.message }, 500); }
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = jwt && await penggunaDariJwt(jwt);
  if (!user?.id) return json({ error: 'Sesi login habis, silakan masuk lagi' }, 401);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.aksi === 'konfig') return json({ clientId: c.GID, scope: SCOPE });

    if (body.aksi === 'hubungkan') {
      const ru = String(body.redirectUri || '');
      if (!/^(https:\/\/[^/]+|http:\/\/localhost(:\d+)?)\/oauth\.html$/.test(ru)) return json({ error: 'redirectUri tidak valid' }, 400);
      const t = await tukarKode(body.code, ru);
      if (!t.refresh_token) return json({ error: 'Google tidak memberi izin offline. Buka myaccount.google.com/permissions, hapus akses "Lapor Kinerja", lalu hubungkan lagi.' }, 400);
      const jam = Number.isInteger(body.jam) && body.jam >= 0 && body.jam <= 23 ? body.jam : 16;
      const lama = (await sb(`drive_koneksi?select=refresh_token&user_id=eq.${user.id}`))?.[0];
      if (lama?.refresh_token && lama.refresh_token !== t.refresh_token) await cabutToken(lama.refresh_token);
      await sb('drive_koneksi', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: user.id, refresh_token: t.refresh_token, email: emailDariIdToken(t.id_token), zona: body.zona || 'Asia/Makassar', jam, aktif: true, terakhir_hasil: 'Terhubung' })
      });
      return json({ ok: true, email: emailDariIdToken(t.id_token) });
    }

    const kon = (await sb(`drive_koneksi?select=*&user_id=eq.${user.id}`))?.[0];
    if (!kon) return json({ error: 'Google Drive belum dihubungkan' }, 400);

    if (body.aksi === 'sinkron') {
      // Fungsi biasa dibatasi ±10 detik → kerjakan 8 detik, pemanggil mengulang bila selesai=false
      const r = await jalankan({ ...kon, aktif: true }, Date.now() + 8000, { tandaiHarian: false });
      return json(r);
    }

    if (body.aksi === 'putus') {
      await cabutToken(kon.refresh_token);
      await sb(`drive_koneksi?user_id=eq.${user.id}`, { method: 'DELETE' });
      return json({ ok: true });
    }
    return json({ error: 'Aksi tidak dikenal' }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
