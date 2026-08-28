'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Palette } from 'lucide-react';
import { post } from '@/lib/client';
import { useStatus } from './StatusBar';
import { DEFAULT_THEME, normalizeTheme, themeById, themesByFamily, type ThemeDef } from '@/lib/themes';

/**
 * Pemilih tema.
 *
 * Menggantikan tombol matahari/bulan yang lama. Alasannya bukan sekadar jumlah
 * tema: toggle dua arah menyembunyikan pilihan yang ada, dan tema di sini
 * berbeda bukan hanya gelap-terang melainkan juga kerapatan dan bentuknya.
 * Orang perlu MELIHAT pilihannya sebelum memutuskan.
 *
 * Perubahannya diterapkan ke <html> seketika supaya terasa langsung, baru
 * kemudian disimpan ke master user. Bila penyimpanan gagal, tampilan
 * dikembalikan ke tema semula — lebih jujur daripada membiarkan layar
 * memakai tema yang sebenarnya tidak tersimpan.
 */
export function ThemeMenu({ className = '' }: { className?: string }) {
  const { setStatus } = useStatus();
  const [theme, setTheme] = useState<string>(DEFAULT_THEME);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Tema sebenarnya sudah ditulis server ke <html data-theme>; komponen ini
  // hanya membacanya kembali supaya tahu mana yang sedang aktif.
  useEffect(() => {
    setTheme(normalizeTheme(document.documentElement.getAttribute('data-theme')));
  }, []);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();

    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('[data-theme-menu]')) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    // Menu memakai posisi fixed, jadi ia tidak ikut bergerak sendiri saat
    // halaman digulir atau jendela diubah ukurannya.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  async function choose(next: ThemeDef) {
    if (next.id === theme) return setOpen(false);
    const prev = theme;

    // terapkan dulu — perubahan tema harus terasa seketika
    document.documentElement.setAttribute('data-theme', next.id);
    setTheme(next.id);
    setOpen(false);
    setBusy(true);

    const r = await post('/api/users/me/theme', { theme: next.id });
    setBusy(false);

    if (!r.ok) {
      document.documentElement.setAttribute('data-theme', prev);
      setTheme(prev);
      setStatus(`Tema gagal disimpan: ${r.message}`, 'E');
      return;
    }
    setStatus(r.message, 'S');
  }

  const active = themeById(theme);
  const groups = themesByFamily();

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Tema: ${active.label}`}
        aria-label="Ganti tema tampilan"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        className={`sap-btn sap-btn-ghost !px-1.5 !py-1 ${className}`}
      >
        <Palette size={14} />
        <span className="hidden xl:inline text-xxs text-sap-muted">{active.label}</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            data-theme-menu
            role="menu"
            className="sap-pop fixed z-[70] w-[290px] bg-sap-panel border border-sap-border rounded-sappanel shadow-sap overflow-hidden"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="px-3 py-2 border-b border-sap-border">
              <p className="text-2xs font-semibold text-sap-text">Tema tampilan</p>
              <p className="text-xxs text-sap-muted leading-snug">
                Tersimpan di user Anda — ikut ke perangkat mana pun.
              </p>
            </div>

            {groups.map((g) => (
              <div key={g.family}>
                <p className="px-3 pt-2 pb-1 text-xxs text-sap-muted">{g.label}</p>
                {g.items.map((t) => {
                  const on = t.id === active.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      onClick={() => choose(t)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors
                                  ${on ? 'bg-sap-blue/12' : 'hover:bg-sap-btnhover'}`}
                    >
                      {/* Contoh warna: latar, permukaan, aksen — susunan yang
                          sama dengan yang akan dilihat di layar sungguhan. */}
                      <span
                        aria-hidden
                        className="mt-[2px] shrink-0 flex rounded-sap overflow-hidden border border-sap-border"
                      >
                        {t.swatch.map((c) => (
                          <span key={c} style={{ background: c }} className="w-3.5 h-6 block" />
                        ))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-2xs text-sap-text truncate">{t.label}</span>
                          {on && <Check size={12} className="text-sap-blue shrink-0" />}
                        </span>
                        <span className="block text-xxs text-sap-muted leading-snug">{t.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}

            <p className="px-3 py-2 border-t border-sap-border text-xxs text-sap-muted leading-snug">
              Horizon mengubah kerapatan dan bentuk, bukan hanya warna. Quartz memuat lebih banyak
              baris per layar.
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
