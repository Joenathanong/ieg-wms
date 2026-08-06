# WMS LITE — Warehouse Management System (SAP S/4HANA Style)

Aplikasi Full-Stack WMS Lightweight berbasis web yang mengadopsi logika **SAP S/4HANA Modul WM/IM**
dengan tampilan visual **SAP GUI 8.0 Theme Quartz Dark / Dark Crystal**.

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
> (RCE, CVSS 10.0) — Vercel menolak deployment dengan versi tersebut.
> SheetJS diambil dari **CDN resmi SheetJS** (`cdn.sheetjs.com`), bukan npm registry,
> karena versi npm (0.18.5) sudah tidak di-maintain dan punya 2 advisory terbuka.
> Kalau CDN tidak bisa diakses dari jaringan Anda, ganti baris `xlsx` di `package.json`
> menjadi `"xlsx": "^0.18.5"` — fungsional sama, tapi `npm audit` akan kembali menandai 2 high.

---

## 2. Instalasi Lokal

```bash
npm install

# salin & isi environment variable
cp .env.example .env

# buat tabel di database
npx prisma db push

# (opsional) isi data contoh + user ADMIN
npm run db:seed

npm run dev          # http://localhost:3000
```

Login pertama: **ADMIN / admin123** (dibuat otomatis saat login pertama jika tabel user masih kosong).
Segera ubah password lewat transaksi **SU01**.

### Environment Variable

```env
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/wms?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.neon.tech/wms?sslmode=require"
AUTH_SECRET="random-string-minimal-32-karakter"
```

* **Neon.tech** — `DATABASE_URL` pakai host `-pooler`, `DIRECT_URL` pakai host tanpa `-pooler`.
* **Supabase** — `DATABASE_URL` pakai port `6543` (pooler), `DIRECT_URL` pakai port `5432`.

---

## 3. Deploy ke Vercel

1. Push repo ini ke GitHub.
2. Di Vercel: **New Project** → pilih repo.
3. Isi Environment Variables: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`.
4. Deploy. Script `build` sudah menjalankan `prisma generate` otomatis.
5. Jalankan sekali dari komputer lokal (dengan `.env` produksi): `npx prisma db push`.

Semua API route sudah `dynamic = 'force-dynamic'` dan memakai koneksi pooled,
sehingga aman untuk lingkungan serverless.

---

## 4. Daftar T-Code

Ketik T-Code pada **Command Field** di pojok kiri atas lalu tekan **Enter**
(shortcut fokus: `Ctrl + /`, format `/nMIGO` juga didukung).

### Transactions

| T-Code | Fungsi |
|---|---|
| `MIGO` | Goods Movement — 101 GR, 201 GI, 551/701/702 Adjustment (multi line item) |
| `LT01` | Create Transfer Order — single bin to bin (301) |
| `LT10` | Mass Bin Transfer (301) — banyak baris sekaligus |
| `LI01N` | Create Physical Inventory Document — **freeze bin** |
| `LI11N` | Enter Count Result → posting selisih via 701 / 702 |

### Reports

| T-Code | Fungsi |
|---|---|
| `MB52` | Global Stock Summary (level IM) + indikator safety stock & konsistensi IM vs WM |
| `LX02` | Stock per Storage Bin (level WM) — Bin, Batch, Mfg/Exp Date, FEFO alert |
| `MB51` | Material Document History — filter range tanggal, material, movement type, bin, batch, user |
| `LS04` | Empty Bin List |

### Master Data

| T-Code | Fungsi |
|---|---|
| `MM01` / `MM02` | Create / Change Material Master |
| `LS01N` / `LS02N` | Create / Change Storage Bin (+ mass generate Aisle-Rack-Level) |
| `LS06` | Block / Unblock Storage Bin |
| `ZUPLOAD` | Upload Center — Master Material, Master Bin, Initial Stock |

### Administration

| T-Code | Fungsi |
|---|---|
| `SU01` | User Maintenance — hanya role **ADMIN** |

---

## 5. Logika Transaksi (ACID)

Semua perubahan stok dibungkus `prisma.$transaction()` — bila satu baris gagal,
seluruh dokumen di-rollback.

| Movement | Stock IM | Stock WM | Bin Status | Log |
|---|---|---|---|---|
| **101** Goods Receipt | `+` | `+` di target bin | target → `OCCUPIED` | `101_GR` |
| **201** Goods Issue | `−` | `−` di source bin | source → `EMPTY` bila qty 0 | `201_GI` |
| **301** Bin Transfer | **tidak berubah** | `−` source, `+` target | source & target di-refresh | `301_TR_BIN` |
| **551** Scrapping | `−` | `−` | source → `EMPTY` bila qty 0 | `551_ADJ_MIN` |
| **561** Initial Stock | `+` | `+` | target → `OCCUPIED` | `561_INIT_STOCK` |
| **701** Phys. Inv. (+) | `+` | `+` | di-refresh | `701_ADJ_PLUS` |
| **702** Phys. Inv. (−) | `−` | `−` | di-refresh | `702_ADJ_MIN` |

Validasi yang diberlakukan:

* Material & bin harus ada di master data.
* Bin berstatus `BLOCKED` tidak menerima pergerakan stok.
* Material batch-managed **wajib** isi nomor batch; yang non-batch **wajib** kosong.
* Stok tidak boleh negatif (level IM maupun level quant bin/batch).
* Nomor dokumen dibuat atomik lewat tabel `document_counters` (number range object).

### Alur Stock Opname

```
LI01N  → pilih bin → dokumen dibuat, snapshot book qty, bin di-set BLOCKED
LI11N  → input counted qty (boleh menambah item yang tidak tercatat sistem)
       → Post Difference → selisih (+) posting 701, selisih (−) posting 702
       → bin di-release kembali ke OCCUPIED / EMPTY
```

---

## 6. ZUPLOAD — Upload Excel

Pembacaan file `.xlsx` / `.csv` dilakukan **100% di browser** menggunakan SheetJS,
lalu dikirim ke API secara **ter-chunk (25–100 baris per request)** sehingga tidak
terkena batas waktu eksekusi Serverless Function di Vercel.

Tombol **Download Sample Excel Template** tersedia untuk ketiga tipe file.

**Urutan upload yang benar: Material → Storage Bin → Initial Stock.**

### `master_materials.xlsx`

| material_code | description | uom | is_batch_managed | min_safety_stock |
|---|---|---|---|---|
| FG-0001 | Sabun Cair Botol 500ml | PC | TRUE | 100 |

### `master_storage_bins.xlsx`

| bin_code | zone_id | max_weight_kg | status |
|---|---|---|---|
| A-01-01-1 | RACK-FAST | 1200 | EMPTY |

### `initial_stock.xlsx`

| material_code | bin_code | batch_number | mfg_date | exp_date | qty |
|---|---|---|---|---|---|
| FG-0001 | A-01-01-1 | B2608A | 01.08.2026 | 01.08.2028 | 480 |

Mode posting:

* **ADD** — kuantitas di file ditambahkan ke stok yang ada (default).
* **SET** — stok disamakan dengan nilai di file, sistem memposting selisihnya.

Baris yang gagal tidak membatalkan baris lain — log per baris bisa diekspor ke Excel.

---

## 7. Struktur Project

```
prisma/
  schema.prisma            # 9 model: materials, storage_bins, stock_im, stock_wm,
                           # migo_logs, document_counters, phys_inv_docs, items, users
  seed.ts                  # data contoh + user ADMIN
src/
  lib/
    prisma.ts              # singleton Prisma Client
    wms.ts                 # CORE ENGINE — applyStockIM / applyStockWM /
                           # refreshBinStatus / postGoodsMovement / postBinTransfer
    docnum.ts              # number range object (nomor dokumen atomik)
    movement.ts            # mapping movement type & arah stok
    api.ts                 # helper response ala SAP + parser tanggal Excel
    auth.ts / session.ts   # JWT session, role guard (ADMIN / OPERATOR / VIEWER)
    tcodes.ts              # registry T-Code → route
    client.ts              # fetch wrapper sisi browser
  components/sap/
    Shell.tsx              # layout utama (top bar + sidebar + status bar)
    CommandField.tsx       # command field T-Code dengan autocomplete
    StatusBar.tsx          # status bar bawah layar (hijau / merah ala SAP)
    Sidebar.tsx  ui.tsx  hooks.ts
  app/
    (sap)/                 # semua halaman transaksi (butuh login)
    api/                   # route handler backend
  middleware.ts            # proteksi route + API
```

---

## 8. Role Authorization

| Role | Hak akses |
|---|---|
| `ADMIN` | Semua transaksi + SU01 (manajemen user) + hapus master data |
| `OPERATOR` | Posting transaksi, master data, upload, laporan |
| `VIEWER` | Hanya laporan (display only) |

Minimal satu ADMIN aktif harus selalu ada; user tidak dapat menghapus atau mengunci dirinya sendiri.
