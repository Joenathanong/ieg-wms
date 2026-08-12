# WMS LITE — Warehouse Management System (SAP S/4HANA Style)

Aplikasi Full-Stack WMS Lightweight berbasis web yang mengadopsi logika **SAP S/4HANA Modul WM/IM**
dengan dua tema visual: **Quartz Dark / Dark Crystal** (default) dan **SAP Morning Horizon** (light).
Toggle tema ada di top bar (ikon matahari/bulan); preferensi disimpan per browser.

Siap deploy gratis di **Vercel** (Serverless Next.js) + **Neon.tech / Supabase** (PostgreSQL).

---

## 1. Stack Teknis

| Layer | Teknologi |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS + Lucide Icons |
| Excel Parser | SheetJS (`xlsx`) — dijalankan **di browser** |
| ORM | Prisma ORM |
| Database | PostgreSQL (Neon.tech / Supabase) |
| Auth | JWT (jose) di HttpOnly cookie + bcryptjs |

> **Catatan keamanan dependensi.** `npm audit` = **0 vulnerabilities**.
> Next.js dinaikkan ke 16.x karena Next 15.1.6 terkena **CVE-2025-66478 / React2Shell**
> (RCE, CVSS 10.0). SheetJS diambil dari **CDN resmi SheetJS** (`cdn.sheetjs.com`), bukan npm registry,
> karena versi npm (0.18.5) sudah tidak di-maintain. Kalau CDN tidak bisa diakses dari jaringan Anda,
> ganti baris `xlsx` di `package.json` menjadi `"xlsx": "^0.18.5"`.

---

## 2. Konsep Inti — Pemisahan Level IM dan WM (2-step)

Ini perbedaan terbesar dibanding WMS sederhana: **MIGO tidak pernah menyentuh rak.**

```
INBOUND
  MIGO 101 ──► IM +qty, WM +qty di bin interim TRANSIT-IN
           └─► Transfer Requirement PUTAWAY (sudah dipecah per pallet)
  LB10 ─────► antrean pekerjaan gudang
  LB12 ─────► operator isi rak tujuan  ──► movement 301  TRANSIT-IN → rak final
              (atau ZRF02 di perangkat PDT)

OUTBOUND  (3 langkah)
  1. MIGO 201  mode "Buat permintaan picking"
               ──► hanya membuat Transfer Requirement PICK. Stok belum berkurang.
                   Ditolak bila stok masih menunggu put-away di TRANSIT-IN.
  2. LB12 / ZRF03
               ──► operator pilih rak asal (saran FEFO) ──► 301  rak → TRANSIT-OUT
                   Stock IM masih TETAP. Barang sudah siap kirim di GI zone.
  3. MIGO 201  mode "Post goods issue dari GI zone"
               ──► IM − dan WM − dari TRANSIT-OUT. Dokumen 201 terbit di sini.

KOREKSI
  551 / 701 / 702 ──► tetap menunjuk bin langsung (sifatnya penyesuaian)
```

Konsekuensi praktis: stok tidak bisa "hilang" di antara dokumen dan lantai gudang —
selalu ada bin interim yang menahannya dan Transfer Requirement yang mencatat siapa
yang belum menyelesaikan pekerjaan.

---

## 3. Instalasi Lokal

```bash
npm install

cp .env.example .env      # isi kredensial Neon / Supabase
npx prisma db push        # buat tabel
npm run db:seed           # data contoh + user + konfigurasi awal

npm run dev               # http://localhost:3000
```

User hasil seed:

| User | Password | Role | PDT |
|---|---|---|---|
| `ADMIN` | `admin123` | ADMIN | aktif |
| `WHOPR01` | `operator123` | OPERATOR | aktif |
| `WHOPR02` | `operator123` | OPERATOR | nonaktif |

Kalau tabel user masih kosong, `ADMIN / admin123` dibuat otomatis saat login pertama.

### Environment Variable

```env
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.neon.tech/wms?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.neon.tech/wms?sslmode=require"
AUTH_SECRET="random-string-minimal-32-karakter"
```

* **Neon.tech** — `DATABASE_URL` pakai host `-pooler`, `DIRECT_URL` tanpa `-pooler`.
* **Supabase** — `DATABASE_URL` port `6543`, `DIRECT_URL` port `5432`.

### Deploy ke Vercel

Push ke GitHub → import di Vercel → isi 3 environment variable di atas untuk scope
Production/Preview/Development → Deploy. Script `build` sudah menjalankan `prisma generate`.
Jalankan `npx prisma db push` sekali dari lokal dengan `.env` produksi.

---

## 4. Daftar T-Code

Ketik pada **Command Field** di pojok kiri atas lalu Enter (shortcut `Ctrl + /`, format `/nMIGO` juga didukung).

### Transactions — level Inventory Management

| T-Code | Fungsi |
|---|---|
| `MIGO` | Goods Movement — 101 GR, 201 GI (2 mode: request picking / post goods issue), 551/701/702 koreksi, **mode Cancellation 102/202/552/562/711/712** (input no. dokumen asal, data auto terisi & terkunci). Multi line item. |
| `LI01N` | Create Physical Inventory Document — **multi-bin** (zona / daftar bin / seluruh gudang) |
| `LI11N` | Enter Count Result **multi-line** → posting seluruh selisih 701/702 sekaligus |

### Warehouse — level bin

| T-Code | Fungsi |
|---|---|
| `LB10` | Transfer Requirement List — antrean kerja gudang, filter tipe/status/material |
| `LB12` | Process Transfer Requirement — put-away & picking, konfirmasi parsial diperbolehkan |
| `LT01` | Create Transfer Order — single bin to bin (301) |
| `LT10` | Mass Bin Transfer (301) |

### Reports

| T-Code | Fungsi |
|---|---|
| `MB52` | Global Stock Summary (IM) + indikator safety stock & konsistensi IM vs WM |
| `LX02` | Stock per Storage Bin — Bin, Batch, Mfg/Exp, **GR Date**, alert FEFO (alias `LX01`) |
| `MB51` | Material Document History — filter tanggal, material, movement, bin, batch, user + **kolom deskripsi movement type** & penanda dokumen dibatalkan |
| `LS04` | Empty Bin List |

### Master Data

| T-Code | Fungsi |
|---|---|
| `MM01` / `MM02` | Material Master **+ tabel palletization per kelompok gudang** + **Barcode B-POM, Barcode Produk (EAN), Kode OCS, Fix Bin** |
| `LS01N` / `LS02N` / `LS06` | Storage Bin: create / change / block, plus mass generate |
| `ZUPLOAD` | Upload Center — 5 tipe file |

### PDT Terminal (operator)

| T-Code | Fungsi |
|---|---|
| `ZRF` | Menu utama PDT (badge jumlah pekerjaan terbuka) |
| `ZRF01` | Goods Receipt (101) |
| `ZRF02` | Put-away — proses TR PUTAWAY |
| `ZRF03` | Picking — proses TR PICK |
| `ZRF04` | Bin to Bin Transfer (301) |
| `ZRF05` | Stock Count — input hasil opname per bin |
| `ZRF06` | Inquiry — cek isi rak / lokasi material |
| `ZRF07` | Goods Issue — keluarkan barang dari transit-out (201) |
| `ZRF08` | **Replenishment** — scan bin ATAU material → list stok urut **FEFO** (ED terdekat paling atas) → pilih → qty + S-Bin tujuan (saran otomatis dari **Fix Bin** material, tetap bisa diganti) → posting 301 |

> **Barcode PDT.** Field scan material di ZRF01 / ZRF06 / ZRF08 mendukung:
> (1) barcode compound `material;batch;...` (mis. `1228050306;D26153;CTN;36.00000;PCS;...`) —
> field 1 = material, field 2 = batch, langsung terisi;
> (2) barcode EAN polos (mis. `8998824551223`) — di-lookup ke master data lewat
> **Barcode B-POM / Barcode Produk** di MM01.

### System

| T-Code | Fungsi |
|---|---|
| `SU01` | User Maintenance (ADMIN) — flag **Akses PDT** per user + **assign Role T-Code (PFCG)** |
| `PFCG` | Role Maintenance (ADMIN) — buat role berisi daftar T-Code yang diizinkan (termasuk per-ZRF01–08), lalu assign ke user di SU01. User tanpa role = akses penuh sesuai role dasar; ADMIN tidak pernah dibatasi. Berlaku pada login berikutnya. |
| `ZSET` | System Configuration (ADMIN) — master switch PDT, **toggle per T-Code ZRF01–ZRF08**, bin transit, auto-split pallet |

---

## 5. Palletization (MM01)

Tabel **material × SU type × kelompok gudang** — satu produk boleh punya cara simpan
berbeda di Gudang Besar dan Gudang Kecil.

```
material  pack_code     su_type  zone_group  qty_per_unit  default
FG-0001   PAL-GB        PAL      BESAR       1000          X
FG-0001   PAL-GB-HALF   PAL      BESAR        500
FG-0001   BOX-GK        BINBOX   KECIL        100          X
SP-1001   PAL-GB        PAL      (kosong)     500          X
```

`zone_group` kosong berarti berlaku untuk semua gudang. Boleh ada satu baris default
**per kelompok gudang**.

Di MIGO 101 ada dropdown **Gudang Tujuan**; baris palletization dipilih otomatis dari situ:

| Input | Hasil auto-split |
|---|---|
| FG-0001 2500 PC → Gudang Besar | 3 line: **1000 / 1000 / 500** (PAL-GB) |
| FG-0001 250 PC → Gudang Kecil | 3 line: **100 / 100 / 50** (BOX-GK) |

Sisa selalu menjadi baris tersendiri. Operator tinggal mengisi rak tiap line di LB12 atau ZRF02.
Material tanpa baris palletization tidak dipecah (1 line utuh).
Auto-split bisa dimatikan global lewat `AUTO_SPLIT_PALLET` di ZSET.

---

## 6. Zona Gudang & Penamaan Bin

Skema: **prefix gudang + tipe penyimpanan**, sehingga kode bin sendiri sudah
menjelaskan lokasi fisiknya tanpa perlu melihat kolom zona.

| Zone ID | Keterangan | Format bin | Contoh |
|---|---|---|---|
| `GB-HDR` | Gudang Besar — Heavy Duty Racking | `GB-<Aisle>-<Rack>-<Level>-<Posisi>` | `GB-A-01-02-1` |
| `GB-PICK` | Gudang Besar — Pick Bin | `GB-PICK-<Aisle>-<NN>` | `GB-PICK-A-01` |
| `GK-BIN` | Gudang Kecil — Bin Box | `GK-<Aisle>-<Rack>-<Level>-<Box>` | `GK-B-03-01-2` |
| `GK-PICK` | Gudang Kecil — Pick Bin | `GK-PICK-<Aisle>-<NN>` | `GK-PICK-B-03` |
| `TRANSIT-IN` | Transit penerimaan (hasil MIGO 101) | `TRN-IN-<NN>` | `TRN-IN-01` |
| `TRANSIT-OUT` | Transit pengeluaran (siap goods issue) | `TRN-OUT-<NN>` | `TRN-OUT-01` |
| `STAGING` / `REJECT` / `QUARANTINE` | Area pendukung | — | `STG-01` |
| `RACK-FAST` / `RACK-SLOW` / `RACK-BULK` | Zona lama, tetap didukung | — | `A-01-02-1` |

Bin di zona `TRANSIT-IN` / `TRANSIT-OUT` otomatis ditandai **interim**: tidak boleh jadi
tujuan put-away, tidak boleh jadi sumber picking, dan tidak pernah ikut dihitung saat stock opname.

LS01N punya **mass generate** dengan kolom prefix gudang, jadi membuat 24 bin `GB-A-01-01-1`
sampai `GB-B-04-03-1` cukup sekali klik.

---

## 7. Stock Opname Multi-Line (LI01N / LI11N)

Satu nomor dokumen mencakup **banyak bin dan banyak baris**:

1. **LI01N** — pilih cakupan: satu zona, daftar bin manual, atau seluruh gudang.
   Semua bin di-set `BLOCKED`, snapshot stok direkam sebagai book quantity.
2. **ZRF05** (opsional) — operator input hasil hitung per bin lewat PDT.
3. **LI11N** — admin melengkapi/mengoreksi seluruh baris, bisa menambah item yang
   ditemukan fisik tapi tidak tercatat sistem. Ada tombol "isi sisa = book qty".
4. **Post All Differences** — selisih (+) jadi **701**, selisih (−) jadi **702**,
   semuanya dalam satu database transaction, lalu seluruh bin dilepas kembali.

---

## 8. ZUPLOAD — Upload Excel

Pembacaan file `.xlsx` / `.csv` dilakukan **100% di browser** memakai SheetJS, lalu dikirim
ke API secara **ter-chunk (25–100 baris per request)** agar tidak kena batas waktu Serverless
Function. Tombol **Download Sample Excel Template** tersedia untuk kelima tipe.

**Urutan yang benar: Material → Pallet → Storage Bin → Initial Stock → Safety Stock.**

| # | File | Kolom |
|---|---|---|
| 1 | `master_materials.xlsx` | material_code, description, uom, is_batch_managed, min_safety_stock |
| 2 | `master_packaging.xlsx` | material_code, pack_code, su_type, zone_group, description, qty_per_unit, is_default |
| 3 | `master_storage_bins.xlsx` | bin_code, zone_id, max_weight_kg, status |
| 4 | `initial_stock.xlsx` | material_code, bin_code, batch_number, mfg_date, exp_date, qty |
| 5 | `safety_stock.xlsx` | material_code, min_safety_stock |

* **Initial stock** punya mode `ADD` (tambah) dan `SET` (samakan dengan file, sistem posting selisih).
* **Safety stock** bersifat **replace**: hanya material yang tercantum di file yang diubah,
  material lain tidak tersentuh. Cocok untuk mengubah banyak baris sekaligus.
* Baris yang gagal tidak membatalkan baris lain — log per baris bisa diekspor ke Excel.

---

## 9. Terminal PDT (ZRF)

Layar khusus perangkat genggam: font besar, tombol tinggi, input siap barcode scanner,
sidebar otomatis disembunyikan. Semua posting dari PDT ditandai `via_pdt` sehingga bisa
dibedakan dari posting admin.

### Kontrol aktif/nonaktif

Admin mengatur semuanya di **ZSET**:

| Setting | Efek |
|---|---|
| `PDT_ENABLED` | Master switch — mematikan seluruh modul PDT sekaligus |
| `PDT_ZRF01` … `PDT_ZRF07` | Toggle **per T-Code**, bisa dimatikan satu per satu |

Modul yang dimatikan langsung terkunci **tanpa perlu login ulang**: di menu ZRF entri-nya
tampil abu-abu dengan ikon gembok, dan bila route-nya dibuka langsung akan muncul layar
*Transaction is locked*.

Sebagai lapisan tambahan (opsional), setiap user punya flag **Akses PDT** di `SU01`.
Biarkan menyala untuk semua operator kalau Anda hanya ingin memakai kontrol per T-Code.
Flag per user disematkan di token session sehingga perubahannya berlaku pada login berikutnya.

---

## 10. Logika Transaksi (ACID)

Semua perubahan stok dibungkus `prisma.$transaction()` — bila satu baris gagal,
seluruh dokumen di-rollback.

| Movement | Stock IM | Stock WM | Bin Status | Dipicu oleh |
|---|---|---|---|---|
| **101** Goods Receipt | `+` | `+` di TRANSIT-IN | TRANSIT-IN → `OCCUPIED` | MIGO / ZRF01 |
| **301** Bin Transfer | **tidak berubah** | `−` source, `+` target | keduanya di-refresh | LB12 / LT01 / LT10 / ZRF02-04 |
| **201** Goods Issue | `−` | `−` di TRANSIT-OUT | TRANSIT-OUT → `EMPTY` bila 0 | MIGO 201 mode ISSUE |
| **551** Scrapping | `−` | `−` | source → `EMPTY` bila 0 | MIGO |
| **561** Initial Stock | `+` | `+` | target → `OCCUPIED` | ZUPLOAD |
| **701 / 702** Phys. Inv. | `+` / `−` | `+` / `−` | di-refresh | LI11N |

Validasi yang diberlakukan:

* Material & bin harus ada di master data.
* Bin `BLOCKED` tidak menerima pergerakan stok.
* Bin interim tidak boleh jadi tujuan put-away maupun sumber picking.
* Material batch-managed **wajib** isi batch; non-batch **wajib** kosong.
* Stok tidak boleh negatif (level IM maupun level quant bin/batch).
* MIGO 201 menolak permintaan melebihi stok yang tersedia di rak.
* Nomor dokumen atomik lewat tabel `document_counters` (number range object).

---

## 11. Struktur Project

```
prisma/
  schema.prisma            # 12 model
  seed.ts                  # user, setting, material+pallet, bin, saldo awal
src/
  lib/
    prisma.ts              # singleton Prisma Client
    wms.ts                 # CORE ENGINE — stok, bin status, Transfer Requirement,
                           # split pallet, put-away & picking confirmation, saran FEFO
    settings.ts            # konfigurasi sistem (ZSET)
    zones.ts               # definisi zona & pola penamaan bin
    docnum.ts              # number range (MATDOC / TRDOC / TRREQ / PIDOC)
    movement.ts  api.ts  auth.ts  session.ts  tcodes.ts  client.ts
  components/
    sap/                   # Shell, CommandField, StatusBar, Sidebar, ui, hooks
    pdt/                   # UI terminal PDT + TrScreen (put-away & picking)
  app/
    (sap)/                 # halaman desktop (butuh login)
    (sap)/zrf/             # halaman terminal PDT
    api/                   # route handler backend
  middleware.ts            # proteksi route + guard ADMIN & PDT
```

---

## 12. Role Authorization

| Role | Hak akses |
|---|---|
| `ADMIN` | Semua transaksi + SU01 + ZSET + hapus master data |
| `OPERATOR` | Posting transaksi, master data, upload, laporan |
| `VIEWER` | Hanya laporan (display only) |

Minimal satu ADMIN aktif harus selalu ada; user tidak dapat menghapus atau mengunci dirinya sendiri.

---

## Perawatan Database

| Perintah | Fungsi |
|---|---|
| `npm run db:check` | Diagnosa koneksi + deteksi skema tertinggal. **Jalankan ini dulu bila ada error.** |
| `npm run db:upgrade` | Upgrade skema ke versi terbaru **tanpa menghapus data**. Aman diulang. |
| `npm run db:push` | Sinkronkan skema (hanya untuk database kosong / dev) |
| `npm run db:seed` | Isi data contoh. Tidak menimpa user & password yang sudah ada. |

### Upgrade dari versi lama tanpa kehilangan data

Bila `npx prisma db push` menolak dengan pesan seperti:

```
⚠️ We found changes that cannot be executed:
  • Added the required column `bin_code` to the `phys_inv_doc_items` table
    without a default value. There are 3 rows in this table.
```

**jangan** pakai `--force-reset` (itu menghapus seluruh isi database). Pakai:

```bash
npm run db:upgrade
```

Skrip ini menambah tabel, kolom, index, dan foreign key yang belum ada, lalu mengisi
kolom wajib baru:

- `phys_inv_doc_items.bin_code` — ditebak dari quant yang cocok; bila tidak bisa ditebak
  diberi kode `*MIGRASI*` (dokumen PI lama sebaiknya dibatalkan lalu dibuat ulang di LI01N)
- `storage_bins.is_interim` — bin transit lama (`GR-01`, `GI-01`, zona `GR-ZONE`/`GI-ZONE`)
  otomatis ditandai interim
- `users.pdt_enabled` — semua ADMIN otomatis diaktifkan
- konfigurasi ZSET yang belum ada diisi nilai default

Setelah itu `npx prisma db push` akan bersih dan `npm run db:seed` bisa dijalankan.
Bin dan zona lama tetap berfungsi berdampingan dengan skema `GB-`/`GK-` yang baru.

### Kalau muncul "Can't reach database server" (P1001)

Jalankan `npm run db:check` — ia mencetak host yang dipakai dan penyebab yang paling sering:

1. **Compute Neon suspend atau kuota jam-compute bulan ini habis.** Buka
   [console.neon.tech](https://console.neon.tech) → pilih project → lihat status Compute.
   Ini penyebab paling umum bila sebelumnya koneksi sempat berhasil lalu tiba-tiba gagal.
2. Jaringan kantor memblokir port 5432 keluar.
3. Endpoint berubah setelah branch di-reset — salin ulang connection string ke `.env`.

Catatan: `DATABASE_URL` memakai host `-pooler`, `DIRECT_URL` memakai host tanpa `-pooler`.
Keduanya harus dari project Neon yang sama.

