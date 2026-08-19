-- =====================================================================
--  WMS SAP LITE — Skrip pelengkap untuk TiDB / MySQL
--
--  BEDA PENTING dengan versi PostgreSQL:
--  Struktur tabel TIDAK lagi dibuat di sini. Skema dibentuk langsung dari
--  prisma/schema.prisma dengan `npm run db:push`, karena database TiDB ini
--  dimulai dari kosong sehingga tidak perlu skrip migrasi bertahap.
--
--  Yang tersisa di file ini hanyalah isian awal yang bukan bagian dari
--  struktur: nilai konfigurasi ZSET.
--
--  Dijalankan oleh `npm run db:upgrade`, dipisah dengan penanda "-- >>>".
-- =====================================================================

-- >>>
-- Konfigurasi sistem: isi default yang belum ada.
--
-- Memakai INSERT IGNORE, bukan "WHERE NOT EXISTS (SELECT ... WHERE key = ...)".
-- Alasannya: perbandingan teks antara kolom dan literal hanya sah bila
-- collation keduanya sama. Collation tabel ditentukan server (TiDB memakai
-- utf8mb4_unicode_ci) sedangkan literal memakai collation koneksi, sehingga
-- perbandingan gagal dengan error 1267 "Illegal mix of collations".
-- `key` adalah primary key, jadi INSERT IGNORE melewati baris yang sudah ada
-- tanpa membandingkan teks sama sekali — dan tetap aman diulang.
INSERT IGNORE INTO `system_settings` (`key`, `value`, `updated_by`, `updated_at`) VALUES
  ('PDT_ENABLED',       '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('AUTO_SPLIT_PALLET', '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_STRICT_FEFO',   '0',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('DEFAULT_GR_BIN',    'TRN-IN-01',  'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('DEFAULT_GI_BIN',    'TRN-OUT-01', 'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF01',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF02',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF03',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF04',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF05',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF06',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF07',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF08',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('PDT_ZRF09',         '1',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('KEEPALIVE_ENABLED',  '0',          'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('KEEPALIVE_FROM',     '07:00',      'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('KEEPALIVE_TO',       '22:00',      'UPGRADE', CURRENT_TIMESTAMP(3)),
  ('KEEPALIVE_INTERVAL', '4',          'UPGRADE', CURRENT_TIMESTAMP(3));
