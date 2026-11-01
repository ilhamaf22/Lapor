# Lapor Kinerja

Catat kegiatan harian dari HP (foto bukti dukung + keterangan), lalu sebulan sekali tarik rekapnya di web —
sudah terpilah otomatis per **Rencana Kinerja → IKI**, dengan foto tersusun **satu folder per IKI** di Google Drive.

```
laporan-kinerja/
├── supabase/schema.sql      ← jalankan sekali di Supabase
└── web/                     ← folder yang di-deploy ke Netlify
    ├── index.html           ← aplikasi HP (PWA): foto, keterangan, salin kegiatan hari ini
    ├── dashboard.html       ← web bulanan: rekap per RK/IKI, input manual, ekspor, pengaturan
    ├── config.js            ← (opsional) URL & key Supabase
    ├── vendor/supabase.js   ← library Supabase lokal (agar bisa offline)
    └── js/ css/ icons/ manifest.webmanifest sw.js
```

---

## 1. Siapkan Supabase (±5 menit)

1. Buat project baru di supabase.com (region Singapore paling dekat).
2. **SQL Editor → New query** → tempel isi `supabase/schema.sql` → **Run**. (Aman dijalankan ulang; jalankan lagi setiap ada versi baru skema.)
   Ini membuat tabel, keamanan per akun (RLS), dan bucket foto privat `bukti`.
3. **Authentication → Sign In / Providers → Email**: matikan *Confirm email* supaya bisa langsung masuk setelah daftar
   (atau biarkan aktif dan klik link konfirmasi di email).
4. **Project Settings → API**: catat *Project URL* dan *anon/publishable key*.
   Isi ke `web/config.js`, atau biarkan kosong — aplikasi akan menanyakannya saat pertama dibuka.

## 2. Deploy ke Netlify

Cara paling cepat: buka app.netlify.com → **Add new site → Deploy manually** → seret folder **`web`**.
Tidak perlu build. (Kalau pakai Git, set *publish directory* = `web`.)

## 3. Pertama kali dibuka

1. Buka `https://<situsmu>.netlify.app/dashboard.html` → **Daftar** dengan email & kata sandi.
2. Menu **RK, IKI & Pengaturan** → klik **Pakai SKP 2026 bawaan**. RK & IKI dari file SKP-mu langsung terpasang,
   lengkap dengan kata kunci awal dan link folder bukti dukung Drive dari SKP.
3. Isi **API key Gemini** (gratis di aistudio.google.com → *Get API key*) → **Simpan** → **Tes klasifikasi**.

## 4. Pasang di HP Android

Buka `https://<situsmu>.netlify.app` di Chrome Android → menu ⋮ → **Tambahkan ke layar utama / Install app**.
Ikon *Lapor Kinerja* muncul seperti aplikasi biasa. Login sekali saja.

- **Kamera / Galeri** → foto otomatis dikecilkan (maks 1600 px) agar cepat terunggah dan hemat kuota.
- Saat mengetik keterangan, kategori IKI langsung terlihat kalau cocok dengan kata kunci (juga saat offline).
- **Salin kegiatan hari ini** → teks rapi siap tempel (opsi penomoran & kode IKI), termasuk kegiatan yang belum terkirim.
- Ganti tanggal di form untuk mencatat/menyalin kegiatan hari lain.

### Stamp waktu & lokasi di foto

Setiap foto langsung diberi stamp kecil di kanan bawah: hari, tanggal, jam (WIB/WITA/WIT), titik koordinat,
dan nama tempat (bila ada sinyal). Bisa dimatikan lewat sakelar **Stamp waktu & lokasi** di bawah foto (pilihan diingat).

- Izinkan akses lokasi saat diminta. GPS tetap bekerja tanpa sinyal data; tanpa sinyal stamp hanya berisi koordinat.
- Foto dari galeri: waktu diambil dari data foto (EXIF). Titik diambil dari GPS di foto bila ada; bila tidak ada,
  lokasi saat ini dipakai hanya jika fotonya diambil dalam 1 jam terakhir (foto lama tidak diberi titik agar tidak keliru).
- Ketuk thumbnail untuk melihat foto berstamp ukuran penuh.
- Foto yang ditambahkan lewat dashboard web tidak diberi stamp.

### Cepat dibuka & bisa offline

- Tampilan aplikasi (termasuk library Supabase) tersimpan di HP, jadi aplikasi terbuka **instan**, baik saat online,
  sinyal lemah, maupun offline. Versi baru otomatis terpakai pada pembukaan berikutnya.
- **Setiap kegiatan disimpan di HP dulu**, baru dikirim ke server di latar belakang. Tombol simpan tidak pernah menunggu sinyal.
- Status di bagian atas: *Online · semua tersimpan* / *Offline · n kegiatan disimpan di HP* / *Mengirim 1/3…*.
- Pengiriman berjalan otomatis saat sinyal kembali, saat aplikasi dibuka, atau ketuk ↻.
  Kalau putus di tengah jalan, pengiriman diulang **tanpa duplikat**.
- Kegiatan yang tidak cocok kata kunci akan dikategorikan AI begitu terkirim.
- Login cukup sekali; aplikasi tetap terbuka offline walaupun sesi perlu diperbarui.
- Catatan: pengiriman terjadi saat aplikasi terbuka atau dibuka lagi. Kalau aplikasi ditutup sebelum ada sinyal,
  data tetap aman di HP dan terkirim saat aplikasi dibuka berikutnya.
- Pastikan aplikasi pernah dibuka sekali saat online (setelah install) agar tampilan dan daftar IKI tersimpan di HP.

## 5. Cara pemilahan otomatis

1. Keterangan dicocokkan dengan **kata kunci** tiap IKI. Frasa lebih panjang dianggap lebih spesifik
   ("desain poster" lebih kuat daripada "poster").
2. Ada satu IKI yang paling cocok → langsung dipakai, **tanpa AI**.
3. Tidak ada yang cocok, atau beberapa IKI sama kuat → **Gemini** yang memilih (sekali panggil untuk banyak kegiatan).
4. Kategori yang kamu ubah sendiri ditandai *manual* dan tidak akan ditimpa saat *Kategorikan ulang*.

Kalau ada kegiatan yang sering salah masuk, tambahkan kata kuncinya di Pengaturan, lalu
**Rekap Bulanan → Kategorikan ulang → Semua kecuali yang manual**.

## 6. Rekap bulanan di web

**Rekap Bulanan** → pilih bulan. Kegiatan tampil per RK → IKI. Di sini bisa: ubah IKI, edit keterangan (klik teksnya),
tambah/hapus foto, hapus kegiatan.

| Tombol | Hasil |
|---|---|
| Salin teks laporan | Teks laporan bulanan dikelompokkan per RK/IKI |
| Excel | 3 sheet: Ringkasan per IKI, Kegiatan per IKI, Kronologis |
| ZIP foto per IKI | `Bukti Dukung <Bulan>/<kode IKI nama>/01.Nama kegiatan_4.2.jpg` + Excel + teks. Ekstrak lalu seret foldernya ke Drive |
| Kirim ke Google Drive | Unggah langsung, struktur folder sama; file yang sudah ada tidak diunggah ulang |

### Menghapus foto dari server setelah diunduh

Supaya storage Supabase tidak penuh, foto yang sudah aman tersalin bisa dihapus dari server:

1. Unduh lewat **ZIP foto per IKI** atau **Kirim ke Google Drive**. Foto yang berhasil otomatis ditandai ✓ (sudah diunduh).
2. Setelah ekspor selesai muncul tawaran **Hapus foto periode ini dari server…**, atau klik tombol **Hapus foto server** kapan saja.
3. Pilih rentang tanggal (bawaan: bulan yang sedang dibuka). Ringkasan menunjukkan berapa foto akan dihapus,
   berapa yang belum pernah diunduh (**tidak** ikut dihapus), dan berapa yang sudah dihapus sebelumnya.
4. Ketik `HAPUS` untuk konfirmasi.

Yang dihapus hanya file fotonya. Kegiatan, keterangan, kategori IKI, dan jumlah foto di rekap/Excel tetap tersimpan;
fotonya tampil sebagai kotak arsip bergaris. Ekspor berikutnya otomatis melewati foto yang sudah diarsip.
Penghapusan tidak bisa dibatalkan, jadi pastikan ZIP sudah tersimpan atau foto sudah ada di Drive.

**Input Manual**: tulis banyak kegiatan sekaligus (satu baris satu kegiatan, boleh diawali `05/10` atau `2026-10-05`),
klik *Kategorikan otomatis*, periksa pratinjau, *Simpan semua*.

## 7. Menghubungkan Google Drive (opsional, ±10 menit, sekali saja)

Tanpa langkah ini tombol ZIP tetap bisa dipakai.

1. console.cloud.google.com → buat project (mis. "Lapor Kinerja").
2. **APIs & Services → Library** → aktifkan **Google Drive API**.
3. **OAuth consent screen / Google Auth Platform**: tipe *External*, isi nama aplikasi & email.
   Di **Audience → Test users**, tambahkan email Google-mu. Biarkan status *Testing*.
4. **Clients → Create client → Web application**.
   *Authorized JavaScript origins*: `https://<situsmu>.netlify.app`.
5. Salin **Client ID** → tempel di Pengaturan → *Google OAuth Client ID* → Simpan.

Saat pertama mengirim, Google menampilkan peringatan "aplikasi belum diverifikasi" — wajar untuk aplikasi pribadi;
klik *Lanjutkan*. Ada dua mode kirim:

- **Folder baru per bulan** → `Bukti Dukung Oktober 2026/4.2 Desain publisitas pada media cetak/…`
  (di My Drive, atau di dalam *Folder induk* yang kamu isi di Pengaturan).
- **Langsung ke folder bukti dukung SKP** → masuk ke folder Drive yang tercantum di SKP tiap IKI,
  dibuatkan subfolder bulan lalu subfolder IKI.

Nama file foto: `[nomor].[nama kegiatan]_[kode IKI].jpg`, misalnya `01.Membuat desain spanduk SE2026_4.2.jpg`.
Nomor urut per folder IKI berdasarkan tanggal kegiatan. Di Google Drive, foto yang sudah pernah dikirim dikenali dari ID-nya,
jadi kalau nomornya bergeser (ada kegiatan bertanggal lebih awal ditambahkan), file cukup diganti nama — tidak diunggah ulang.

Tutorial langkah demi langkah untuk API key Gemini dan OAuth Client ID juga tersedia langsung di aplikasi:
tombol **Lihat tutorial** di menu Pengaturan.

## 8. Tahun depan

Menu **RK, IKI & Pengaturan**:

- **Unduh contoh file** → template Excel sederhana (satu baris = satu IKI, kata kunci & link folder opsional). Isi, lalu unggah.
- **Tahun baru dari file SKP** → unggah Excel SKP tahun baru. RK, IKI, dan link folder bukti dukung terbaca otomatis.
  IKI yang namanya sama dengan tahun sebelumnya mewarisi kata kunci lamanya; sisanya disusun AI (atau dari nama IKI).
- **Salin dari tahun lain** → duplikat RK/IKI lalu sesuaikan.
- Semua RK/IKI bisa diubah, ditambah, dihapus; perubahan tersimpan otomatis.

Kegiatan otomatis memakai RK/IKI dari tahun sesuai tanggalnya, jadi data tahun lalu tetap utuh.

## Catatan

- Kuota gratis Supabase: 500 MB database, 1 GB storage. Dengan kompresi (~250 KB/foto) cukup untuk ±4.000 foto.
  Setelah foto dipindah ke Drive, foto bulan lama boleh dihapus dari rekap agar storage lega.
- Model Gemini bisa diganti di Pengaturan bila model bawaan dihentikan Google.
- API key Gemini & Client ID tersimpan di tabel `pengaturan` milik akunmu (dilindungi RLS).