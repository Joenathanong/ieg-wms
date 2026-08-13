-- =====================================================================
--  UPGRADE SKEMA TANPA MENGHAPUS DATA
--  Aman dijalankan berkali-kali (idempotent). Membawa database versi
--  lama mana pun ke struktur terbaru.
--
--  Jalankan:  npm run db:upgrade
--
--  Pemisah antar statement adalah baris "-- >>>" (dibaca oleh upgrade.ts).
-- =====================================================================

-- ---------- ENUM: buat bila belum ada ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BinStatus') THEN
    CREATE TYPE "BinStatus" AS ENUM ('EMPTY', 'OCCUPIED', 'BLOCKED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MovementType') THEN
    CREATE TYPE "MovementType" AS ENUM ('101_GR','201_GI','301_TR_BIN','551_ADJ_MIN','561_INIT_STOCK','701_ADJ_PLUS','702_ADJ_MIN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PhysInvStatus') THEN
    CREATE TYPE "PhysInvStatus" AS ENUM ('CREATED', 'FROZEN', 'COUNTED', 'POSTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TrType') THEN
    CREATE TYPE "TrType" AS ENUM ('PUTAWAY', 'PICK', 'INTERNAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TrStatus') THEN
    CREATE TYPE "TrStatus" AS ENUM ('OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED');
  END IF;
END $$;

-- >>>
-- ---------- ENUM: tambah nilai baru pada MovementType ----------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['101_GR','201_GI','301_TR_BIN','551_ADJ_MIN','561_INIT_STOCK','701_ADJ_PLUS','702_ADJ_MIN',
                           '102_GR_CANCEL','202_GI_CANCEL','552_ADJ_CANCEL','562_INIT_CANCEL','711_PI_CANCEL_MIN','712_PI_CANCEL_PLUS']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'MovementType' AND e.enumlabel = v
    ) THEN
      EXECUTE format('ALTER TYPE "MovementType" ADD VALUE %L', v);
    END IF;
  END LOOP;
END $$;

-- >>>
-- ---------- TABEL: materials ----------
CREATE TABLE IF NOT EXISTS "materials" (
  "id" TEXT NOT NULL,
  "material_code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "uom" TEXT NOT NULL DEFAULT 'PC',
  "is_batch_managed" BOOLEAN NOT NULL DEFAULT true,
  "min_safety_stock" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- >>>
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "min_safety_stock" INTEGER NOT NULL DEFAULT 0;

-- >>>
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "barcode_bpom" TEXT;

-- >>>
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "barcode_produk" TEXT;

-- >>>
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "kode_ocs" TEXT;

-- >>>
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "fix_bin" TEXT;

-- >>>
-- ---------- TABEL: packaging_types (palletization) ----------
CREATE TABLE IF NOT EXISTS "packaging_types" (
  "id" TEXT NOT NULL,
  "material_code" TEXT NOT NULL,
  "pack_code" TEXT NOT NULL,
  "su_type" TEXT NOT NULL DEFAULT 'PAL',
  "zone_group" TEXT,
  "description" TEXT NOT NULL DEFAULT '',
  "qty_per_unit" INTEGER NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- >>>
ALTER TABLE "packaging_types" ADD COLUMN IF NOT EXISTS "su_type" TEXT NOT NULL DEFAULT 'PAL';

-- >>>
ALTER TABLE "packaging_types" ADD COLUMN IF NOT EXISTS "zone_group" TEXT;

-- >>>
-- ---------- TABEL: storage_bins ----------
CREATE TABLE IF NOT EXISTS "storage_bins" (
  "id" TEXT NOT NULL,
  "bin_code" TEXT NOT NULL,
  "zone_id" TEXT NOT NULL,
  "max_weight_kg" DOUBLE PRECISION NOT NULL DEFAULT 1000,
  "status" "BinStatus" NOT NULL DEFAULT 'EMPTY',
  "is_interim" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_bins_pkey" PRIMARY KEY ("id")
);

-- >>>
ALTER TABLE "storage_bins" ADD COLUMN IF NOT EXISTS "is_interim" BOOLEAN NOT NULL DEFAULT false;

-- >>>
-- tandai bin transit lama/baru sebagai interim
UPDATE "storage_bins"
   SET "is_interim" = true
 WHERE "is_interim" = false
   AND ("zone_id" IN ('GR-ZONE','GI-ZONE','TRANSIT-IN','TRANSIT-OUT')
        OR "bin_code" IN ('GR-01','GI-01','TRN-IN-01','TRN-IN-02','TRN-OUT-01','TRN-OUT-02'));

-- >>>
-- ---------- TABEL: stock_im / stock_wm ----------
CREATE TABLE IF NOT EXISTS "stock_im" (
  "id" TEXT NOT NULL,
  "material_code" TEXT NOT NULL,
  "total_qty" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_im_pkey" PRIMARY KEY ("id")
);

-- >>>
CREATE TABLE IF NOT EXISTS "stock_wm" (
  "id" TEXT NOT NULL,
  "material_code" TEXT NOT NULL,
  "bin_code" TEXT NOT NULL,
  "batch_number" TEXT,
  "mfg_date" TIMESTAMP(3),
  "exp_date" TIMESTAMP(3),
  "qty" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_wm_pkey" PRIMARY KEY ("id")
);

-- >>>
ALTER TABLE "stock_wm" ADD COLUMN IF NOT EXISTS "mfg_date" TIMESTAMP(3);

-- >>>
ALTER TABLE "stock_wm" ADD COLUMN IF NOT EXISTS "gr_date" TIMESTAMP(3);

-- >>>
-- ---------- TABEL: migo_logs ----------
CREATE TABLE IF NOT EXISTS "migo_logs" (
  "id" TEXT NOT NULL,
  "document_number" TEXT NOT NULL,
  "movement_type" "MovementType" NOT NULL,
  "material_code" TEXT NOT NULL,
  "source_bin" TEXT,
  "target_bin" TEXT,
  "batch_number" TEXT,
  "qty" INTEGER NOT NULL,
  "uom" TEXT NOT NULL DEFAULT 'PC',
  "reference" TEXT,
  "remarks" TEXT,
  "tr_number" TEXT,
  "doc_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "user_id" TEXT NOT NULL,
  "via_pdt" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "migo_logs_pkey" PRIMARY KEY ("id")
);

-- >>>
ALTER TABLE "migo_logs" ADD COLUMN IF NOT EXISTS "tr_number" TEXT;

-- >>>
ALTER TABLE "migo_logs" ADD COLUMN IF NOT EXISTS "via_pdt" BOOLEAN NOT NULL DEFAULT false;

-- >>>
ALTER TABLE "migo_logs" ADD COLUMN IF NOT EXISTS "doc_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- >>>
ALTER TABLE "migo_logs" ADD COLUMN IF NOT EXISTS "uom" TEXT NOT NULL DEFAULT 'PC';

-- >>>
ALTER TABLE "migo_logs" ADD COLUMN IF NOT EXISTS "reversal_of" TEXT;

-- >>>
ALTER TABLE "migo_logs" ADD COLUMN IF NOT EXISTS "reversed_by" TEXT;

-- >>>
-- Backfill stock_wm.gr_date quant lama (best effort): tanggal dokumen 101/561
-- pertama untuk kombinasi material + batch yang sama.
UPDATE "stock_wm" w
   SET "gr_date" = sub.first_gr
  FROM (
    SELECT "material_code", "batch_number", MIN("doc_date") AS first_gr
      FROM "migo_logs"
     WHERE "movement_type" IN ('101_GR','561_INIT_STOCK')
     GROUP BY "material_code", "batch_number"
  ) sub
 WHERE w."gr_date" IS NULL
   AND w."material_code" = sub."material_code"
   AND (w."batch_number" IS NOT DISTINCT FROM sub."batch_number");

-- >>>
-- ---------- TABEL: document_counters ----------
CREATE TABLE IF NOT EXISTS "document_counters" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "last_num" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "document_counters_pkey" PRIMARY KEY ("id")
);

-- >>>
-- ---------- TABEL: transfer_reqs ----------
CREATE TABLE IF NOT EXISTS "transfer_reqs" (
  "id" TEXT NOT NULL,
  "tr_number" TEXT NOT NULL,
  "tr_type" "TrType" NOT NULL,
  "status" "TrStatus" NOT NULL DEFAULT 'OPEN',
  "ref_doc" TEXT,
  "reference" TEXT,
  "remarks" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  CONSTRAINT "transfer_reqs_pkey" PRIMARY KEY ("id")
);

-- >>>
CREATE TABLE IF NOT EXISTS "transfer_req_items" (
  "id" TEXT NOT NULL,
  "tr_id" TEXT NOT NULL,
  "line_no" INTEGER NOT NULL,
  "material_code" TEXT NOT NULL,
  "batch_number" TEXT,
  "mfg_date" TIMESTAMP(3),
  "exp_date" TIMESTAMP(3),
  "pack_code" TEXT,
  "qty" INTEGER NOT NULL,
  "qty_confirmed" INTEGER NOT NULL DEFAULT 0,
  "source_bin" TEXT,
  "target_bin" TEXT,
  "status" "TrStatus" NOT NULL DEFAULT 'OPEN',
  CONSTRAINT "transfer_req_items_pkey" PRIMARY KEY ("id")
);

-- >>>
-- ---------- TABEL: phys_inv_docs ----------
CREATE TABLE IF NOT EXISTS "phys_inv_docs" (
  "id" TEXT NOT NULL,
  "doc_number" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL DEFAULT 'BIN_LIST',
  "scope_value" TEXT NOT NULL DEFAULT '',
  "frozen_bins" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "PhysInvStatus" NOT NULL DEFAULT 'CREATED',
  "planned_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "counted_at" TIMESTAMP(3),
  "posted_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phys_inv_docs_pkey" PRIMARY KEY ("id")
);

-- >>>
ALTER TABLE "phys_inv_docs" ADD COLUMN IF NOT EXISTS "scope_type" TEXT NOT NULL DEFAULT 'BIN_LIST';

-- >>>
ALTER TABLE "phys_inv_docs" ADD COLUMN IF NOT EXISTS "scope_value" TEXT NOT NULL DEFAULT '';

-- >>>
ALTER TABLE "phys_inv_docs" ADD COLUMN IF NOT EXISTS "frozen_bins" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- >>>
-- ---------- TABEL: phys_inv_doc_items ----------
CREATE TABLE IF NOT EXISTS "phys_inv_doc_items" (
  "id" TEXT NOT NULL,
  "doc_id" TEXT NOT NULL,
  "bin_code" TEXT,
  "material_code" TEXT NOT NULL,
  "batch_number" TEXT,
  "book_qty" INTEGER NOT NULL DEFAULT 0,
  "counted_qty" INTEGER,
  "diff_qty" INTEGER NOT NULL DEFAULT 0,
  "posted" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "phys_inv_doc_items_pkey" PRIMARY KEY ("id")
);

-- >>>
-- inilah kolom yang membuat `prisma db push` gagal: ditambah nullable dulu
ALTER TABLE "phys_inv_doc_items" ADD COLUMN IF NOT EXISTS "bin_code" TEXT;

-- >>>
ALTER TABLE "phys_inv_doc_items" ADD COLUMN IF NOT EXISTS "posted" BOOLEAN NOT NULL DEFAULT false;

-- >>>
-- Backfill bin_code baris lama:
--   1) tebak dari quant yang cocok (material + batch) bila hanya ada satu kandidat
UPDATE "phys_inv_doc_items" i
   SET "bin_code" = w."bin_code"
  FROM "stock_wm" w
 WHERE i."bin_code" IS NULL
   AND w."material_code" = i."material_code"
   AND (w."batch_number" IS NOT DISTINCT FROM i."batch_number")
   AND (SELECT COUNT(*) FROM "stock_wm" w2
         WHERE w2."material_code" = i."material_code"
           AND (w2."batch_number" IS NOT DISTINCT FROM i."batch_number")) = 1;

-- >>>
--   2) sisanya diberi penanda supaya kolom bisa dijadikan NOT NULL
UPDATE "phys_inv_doc_items" SET "bin_code" = '*MIGRASI*' WHERE "bin_code" IS NULL;

-- >>>
ALTER TABLE "phys_inv_doc_items" ALTER COLUMN "bin_code" SET NOT NULL;

-- >>>
-- ---------- TABEL: users ----------
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
  "pdt_enabled" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_login" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- >>>
-- ---------- TABEL: auth_roles (role otorisasi T-Code ala PFCG) ----------
CREATE TABLE IF NOT EXISTS "auth_roles" (
  "id" TEXT NOT NULL,
  "role_name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "tcodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_roles_pkey" PRIMARY KEY ("id")
);

-- >>>
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_role_id" TEXT;

-- >>>
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pdt_enabled" BOOLEAN NOT NULL DEFAULT false;

-- >>>
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- >>>
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login" TIMESTAMP(3);

-- >>>
-- ADMIN selalu boleh pakai PDT
UPDATE "users" SET "pdt_enabled" = true WHERE "role" = 'ADMIN';

-- >>>
-- ---------- TABEL: system_settings ----------
CREATE TABLE IF NOT EXISTS "system_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" TEXT NOT NULL DEFAULT 'SYSTEM',
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- >>>
-- perbaiki bila tabel lama sempat dibuat dengan kolom "id" sebagai primary key
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='system_settings' AND column_name='id') THEN
    ALTER TABLE "system_settings" DROP CONSTRAINT IF EXISTS "system_settings_pkey";
    DROP INDEX IF EXISTS "system_settings_key_key";
    ALTER TABLE "system_settings" DROP COLUMN "id";
    ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");
  END IF;
END $$;

-- >>>
-- ---------- INDEX & UNIQUE ----------
CREATE UNIQUE INDEX IF NOT EXISTS "materials_material_code_key" ON "materials"("material_code");
-- >>>
CREATE INDEX IF NOT EXISTS "materials_description_idx" ON "materials"("description");
-- >>>
CREATE INDEX IF NOT EXISTS "packaging_types_material_code_idx" ON "packaging_types"("material_code");
-- >>>
CREATE INDEX IF NOT EXISTS "packaging_types_material_code_zone_group_idx" ON "packaging_types"("material_code","zone_group");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "packaging_types_material_code_pack_code_key" ON "packaging_types"("material_code","pack_code");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "storage_bins_bin_code_key" ON "storage_bins"("bin_code");
-- >>>
CREATE INDEX IF NOT EXISTS "storage_bins_zone_id_idx" ON "storage_bins"("zone_id");
-- >>>
CREATE INDEX IF NOT EXISTS "storage_bins_status_idx" ON "storage_bins"("status");
-- >>>
CREATE INDEX IF NOT EXISTS "storage_bins_is_interim_idx" ON "storage_bins"("is_interim");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "stock_im_material_code_key" ON "stock_im"("material_code");
-- >>>
CREATE INDEX IF NOT EXISTS "stock_wm_material_code_idx" ON "stock_wm"("material_code");
-- >>>
CREATE INDEX IF NOT EXISTS "stock_wm_bin_code_idx" ON "stock_wm"("bin_code");
-- >>>
CREATE INDEX IF NOT EXISTS "stock_wm_exp_date_idx" ON "stock_wm"("exp_date");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "stock_wm_material_code_bin_code_batch_number_key" ON "stock_wm"("material_code","bin_code","batch_number");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "migo_logs_document_number_key" ON "migo_logs"("document_number");
-- >>>
CREATE INDEX IF NOT EXISTS "migo_logs_material_code_idx" ON "migo_logs"("material_code");
-- >>>
CREATE INDEX IF NOT EXISTS "migo_logs_movement_type_idx" ON "migo_logs"("movement_type");
-- >>>
CREATE INDEX IF NOT EXISTS "migo_logs_doc_date_idx" ON "migo_logs"("doc_date");
-- >>>
CREATE INDEX IF NOT EXISTS "migo_logs_created_at_idx" ON "migo_logs"("created_at");
-- >>>
CREATE INDEX IF NOT EXISTS "migo_logs_tr_number_idx" ON "migo_logs"("tr_number");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "document_counters_key_key" ON "document_counters"("key");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "transfer_reqs_tr_number_key" ON "transfer_reqs"("tr_number");
-- >>>
CREATE INDEX IF NOT EXISTS "transfer_reqs_status_idx" ON "transfer_reqs"("status");
-- >>>
CREATE INDEX IF NOT EXISTS "transfer_reqs_tr_type_idx" ON "transfer_reqs"("tr_type");
-- >>>
CREATE INDEX IF NOT EXISTS "transfer_req_items_tr_id_idx" ON "transfer_req_items"("tr_id");
-- >>>
CREATE INDEX IF NOT EXISTS "transfer_req_items_material_code_idx" ON "transfer_req_items"("material_code");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "phys_inv_docs_doc_number_key" ON "phys_inv_docs"("doc_number");
-- >>>
CREATE INDEX IF NOT EXISTS "phys_inv_doc_items_doc_id_idx" ON "phys_inv_doc_items"("doc_id");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");
-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "auth_roles_role_name_key" ON "auth_roles"("role_name");
-- >>>
CREATE INDEX IF NOT EXISTS "users_auth_role_id_idx" ON "users"("auth_role_id");
-- >>>
CREATE INDEX IF NOT EXISTS "materials_barcode_bpom_idx" ON "materials"("barcode_bpom");
-- >>>
CREATE INDEX IF NOT EXISTS "materials_barcode_produk_idx" ON "materials"("barcode_produk");
-- >>>
CREATE INDEX IF NOT EXISTS "materials_kode_ocs_idx" ON "materials"("kode_ocs");
-- >>>
CREATE INDEX IF NOT EXISTS "migo_logs_reversal_of_idx" ON "migo_logs"("reversal_of");

-- >>>
-- ---------- FOREIGN KEY ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_types_material_code_fkey') THEN
    ALTER TABLE "packaging_types"
      ADD CONSTRAINT "packaging_types_material_code_fkey"
      FOREIGN KEY ("material_code") REFERENCES "materials"("material_code") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_req_items_tr_id_fkey') THEN
    ALTER TABLE "transfer_req_items"
      ADD CONSTRAINT "transfer_req_items_tr_id_fkey"
      FOREIGN KEY ("tr_id") REFERENCES "transfer_reqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phys_inv_doc_items_doc_id_fkey') THEN
    ALTER TABLE "phys_inv_doc_items"
      ADD CONSTRAINT "phys_inv_doc_items_doc_id_fkey"
      FOREIGN KEY ("doc_id") REFERENCES "phys_inv_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_role_id_fkey') THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_auth_role_id_fkey"
      FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- >>>
-- ---------- KONFIGURASI SISTEM: isi default yang belum ada ----------
INSERT INTO "system_settings" ("key","value","updated_by","updated_at")
SELECT k.key, k.val, 'UPGRADE', CURRENT_TIMESTAMP
  FROM (VALUES
    ('PDT_ENABLED','1'),
    ('AUTO_SPLIT_PALLET','1'),
    ('PDT_STRICT_FEFO','0'),
    ('DEFAULT_GR_BIN','TRN-IN-01'),
    ('DEFAULT_GI_BIN','TRN-OUT-01'),
    ('PDT_ZRF01','1'),('PDT_ZRF02','1'),('PDT_ZRF03','1'),
    ('PDT_ZRF04','1'),('PDT_ZRF05','1'),('PDT_ZRF06','1'),('PDT_ZRF07','1'),
    ('PDT_ZRF08','1')
  ) AS k(key,val)
 WHERE NOT EXISTS (SELECT 1 FROM "system_settings" s WHERE s."key" = k.key);

-- >>>
-- ---------- MASTER ZONE (T-Code ZZONE) ----------
CREATE TABLE IF NOT EXISTS "zones" (
  "id"          TEXT NOT NULL,
  "zone_code"   TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "zone_group"  TEXT NOT NULL DEFAULT 'LAIN',
  "bin_pattern" TEXT,
  "is_interim"  BOOLEAN NOT NULL DEFAULT false,
  "is_pick"     BOOLEAN NOT NULL DEFAULT false,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "zones_zone_code_key" ON "zones"("zone_code");

-- >>>
CREATE INDEX IF NOT EXISTS "zones_is_active_idx" ON "zones"("is_active");

-- >>>
CREATE INDEX IF NOT EXISTS "zones_zone_group_idx" ON "zones"("zone_group");

-- >>>
-- Seed zona bawaan (sama persis dengan konstanta lama di src/lib/zones.ts).
INSERT INTO "zones" ("id","zone_code","label","zone_group","bin_pattern","is_interim","is_pick","is_active","created_at","updated_at")
SELECT gen_random_uuid()::text, z.code, z.label, z.grp, z.pattern, z.interim, z.pick, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('GB-HDR',      'Gudang Besar — Heavy Duty Racking',                        'BESAR',   'GB-A-01-02-1', false, false),
    ('GB-PICK',     'Gudang Besar — Pick Bin',                                  'BESAR',   'GB-PICK-A-01', false, true ),
    ('GK-BIN',      'Gudang Kecil — Bin Box',                                   'KECIL',   'GK-B-03-01-2', false, false),
    ('GK-PICK',     'Gudang Kecil — Pick Bin',                                  'KECIL',   'GK-PICK-B-03', false, true ),
    ('TRANSIT-IN',  'Transit penerimaan — hasil MIGO 101, menunggu put-away',   'TRANSIT', 'TRN-IN-01',    true,  false),
    ('TRANSIT-OUT', 'Transit pengeluaran — hasil picking, siap goods issue',    'TRANSIT', 'TRN-OUT-01',   true,  false),
    ('RACK-FAST',   'Racking fast moving (lama)',                               'LAIN',    'A-01-02-1',    false, false),
    ('RACK-SLOW',   'Racking slow moving (lama)',                               'LAIN',    'B-01-02-1',    false, false),
    ('RACK-BULK',   'Racking bulk / floor stack (lama)',                        'LAIN',    'C-01-01-1',    false, false),
    ('STAGING',     'Staging area',                                             'LAIN',    'STG-01',       false, false),
    ('REJECT',      'Barang reject',                                            'LAIN',    'RJ-01',        false, false),
    ('QUARANTINE',  'Karantina / hold QC',                                      'LAIN',    'QC-01',        false, false)
  ) AS z(code,label,grp,pattern,interim,pick)
 WHERE NOT EXISTS (SELECT 1 FROM "zones" x WHERE x."zone_code" = z.code);

-- >>>
-- Zona yang sudah terlanjur dipakai bin tetapi belum ada di master ikut didaftarkan,
-- supaya data lama tidak menjadi tidak valid setelah field zone dikunci.
INSERT INTO "zones" ("id","zone_code","label","zone_group","bin_pattern","is_interim","is_pick","is_active","created_at","updated_at")
SELECT gen_random_uuid()::text,
       b."zone_id",
       b."zone_id" || ' (hasil migrasi)',
       'LAIN',
       NULL,
       bool_or(b."is_interim"),
       false,
       true,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
  FROM "storage_bins" b
 WHERE b."zone_id" IS NOT NULL
   AND b."zone_id" <> ''
   AND NOT EXISTS (SELECT 1 FROM "zones" x WHERE x."zone_code" = b."zone_id")
 GROUP BY b."zone_id";

-- >>>
-- Samakan flag is_interim bin dengan master zone (bin lama ikut terkoreksi).
UPDATE "storage_bins" b
   SET "is_interim" = z."is_interim",
       "updated_at" = CURRENT_TIMESTAMP
  FROM "zones" z
 WHERE z."zone_code" = b."zone_id"
   AND b."is_interim" IS DISTINCT FROM z."is_interim";

-- >>>
-- ---------- KOLOM WARISAN: phys_inv_docs.bin_code ----------
-- Dokumen stock opname versi lama menyimpan SATU bin di level dokumen.
-- Sejak dokumen bisa mencakup banyak bin, bin disimpan di kolom array
-- "frozen_bins" dan per baris di "phys_inv_doc_items"."bin_code", sehingga
-- kolom lama ini tidak pernah diisi lagi. Selama masih NOT NULL, setiap
-- pembuatan dokumen baru di LI01N ditolak PostgreSQL (Prisma: P2011).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'phys_inv_docs'
       AND column_name = 'bin_code'
       AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE "phys_inv_docs" ALTER COLUMN "bin_code" DROP NOT NULL';
  END IF;
END $$;

-- >>>
-- ---------- MOVEMENT TYPE BARU: 601 GI Penjualan & 602 pembatalannya ----------
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS '601_GI_SALES';

-- >>>
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS '602_GI_SALES_CANCEL';

-- >>>
-- ---------- MASTER COST CENTER (T-Code KS01) ----------
CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id"          TEXT NOT NULL,
  "cost_center" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "department"  TEXT,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_cost_center_key" ON "cost_centers"("cost_center");

-- >>>
CREATE INDEX IF NOT EXISTS "cost_centers_is_active_idx" ON "cost_centers"("is_active");

-- >>>
-- Pembebanan cost center pada dokumen goods issue 201.
ALTER TABLE "migo_logs" ADD COLUMN IF NOT EXISTS "cost_center" TEXT;

-- >>>
CREATE INDEX IF NOT EXISTS "migo_logs_cost_center_idx" ON "migo_logs"("cost_center");

-- >>>
-- ---------- STATUS HITUNG PER BIN (opname paralel) ----------
CREATE TABLE IF NOT EXISTS "phys_inv_bins" (
  "id"         TEXT NOT NULL,
  "doc_id"     TEXT NOT NULL,
  "bin_code"   TEXT NOT NULL,
  "counted_at" TIMESTAMP(3),
  "counted_by" TEXT,
  CONSTRAINT "phys_inv_bins_pkey" PRIMARY KEY ("id")
);

-- >>>
CREATE UNIQUE INDEX IF NOT EXISTS "phys_inv_bins_doc_id_bin_code_key" ON "phys_inv_bins"("doc_id","bin_code");

-- >>>
CREATE INDEX IF NOT EXISTS "phys_inv_bins_doc_id_idx" ON "phys_inv_bins"("doc_id");

-- >>>
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phys_inv_bins_doc_id_fkey') THEN
    ALTER TABLE "phys_inv_bins"
      ADD CONSTRAINT "phys_inv_bins_doc_id_fkey"
      FOREIGN KEY ("doc_id") REFERENCES "phys_inv_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- >>>
-- Backfill: setiap bin yang di-freeze dokumen lama dapat baris statusnya sendiri.
INSERT INTO "phys_inv_bins" ("id","doc_id","bin_code","counted_at","counted_by")
SELECT gen_random_uuid()::text, d."id", b.bin_code, NULL, NULL
  FROM "phys_inv_docs" d
  CROSS JOIN LATERAL unnest(d."frozen_bins") AS b(bin_code)
 WHERE NOT EXISTS (
   SELECT 1 FROM "phys_inv_bins" x WHERE x."doc_id" = d."id" AND x."bin_code" = b.bin_code
 );

-- >>>
-- Bin yang seluruh barisnya sudah terisi hasil hitung dianggap sudah dihitung,
-- supaya progres dokumen yang sedang berjalan tidak ikut ter-reset.
UPDATE "phys_inv_bins" p
   SET "counted_at" = COALESCE(d."counted_at", CURRENT_TIMESTAMP),
       "counted_by" = 'MIGRASI'
  FROM "phys_inv_docs" d
 WHERE d."id" = p."doc_id"
   AND p."counted_at" IS NULL
   AND EXISTS (
     SELECT 1 FROM "phys_inv_doc_items" i
      WHERE i."doc_id" = d."id" AND i."bin_code" = p."bin_code"
   )
   AND NOT EXISTS (
     SELECT 1 FROM "phys_inv_doc_items" i
      WHERE i."doc_id" = d."id" AND i."bin_code" = p."bin_code" AND i."counted_qty" IS NULL
   );
