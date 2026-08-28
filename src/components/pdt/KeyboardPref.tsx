'use client';

import { useEffect, useState } from 'react';
import { Keyboard, ScanLine } from 'lucide-react';
import { readKeyboardPref, writeKeyboardPref, type KeyboardPref } from '@/lib/pdtprefs';

/**
 * Sakelar perilaku keyboard, disimpan per perangkat.
 *
 * Perilaku yang benar bergantung pada cara scanner mengirim data:
 *  - keystroke biasa            -> "Sembunyi otomatis" enak dipakai
 *  - lewat IME (DataWedge       -> HARUS "Selalu tampil", karena inputmode
 *    Enhanced keystroke output)    "none" membuat IME tidak menyala sehingga
 *                                  hasil scan tidak sampai ke field
 *
 * Karena itu pilihannya diletakkan di terminal, bukan di ZSET: satu gudang bisa
 * memakai beberapa tipe perangkat sekaligus.
 */
export function KeyboardPrefToggle() {
  const [pref, setPref] = useState<KeyboardPref>('auto');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPref(readKeyboardPref());
    setReady(true);
  }, []);

  function choose(v: KeyboardPref) {
    setPref(v);
    writeKeyboardPref(v);
  }

  if (!ready) return null;

  return (
    <div className="sap-panel px-3 py-2.5 space-y-2">
      <p className="text-xxs uppercase tracking-wide text-sap-muted">Keyboard perangkat ini</p>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => choose('auto')}
          className={`rounded-sappanel border-2 px-2 py-2 text-left ${
            pref === 'auto' ? 'border-sap-blue bg-sap-blue/10' : 'border-sap-border bg-sap-panelalt'
          }`}
        >
          <span className="flex items-center gap-1.5 text-2xs font-semibold">
            <ScanLine size={14} /> Sembunyi otomatis
          </span>
          <span className="block text-xxs text-sap-muted mt-0.5">
            Keyboard hanya muncul saat field diketuk.
          </span>
        </button>

        <button
          type="button"
          onClick={() => choose('always')}
          className={`rounded-sappanel border-2 px-2 py-2 text-left ${
            pref === 'always' ? 'border-sap-blue bg-sap-blue/10' : 'border-sap-border bg-sap-panelalt'
          }`}
        >
          <span className="flex items-center gap-1.5 text-2xs font-semibold">
            <Keyboard size={14} /> Selalu tampil
          </span>
          <span className="block text-xxs text-sap-muted mt-0.5">
            Pilih ini bila hasil scan tidak masuk ke field.
          </span>
        </button>
      </div>

      <p className="text-xxs text-sap-muted/70 leading-snug">
        Zebra dengan DataWedge <b>Enhanced keystroke output</b> mengirim data lewat IME dan
        memerlukan mode <b>Selalu tampil</b>.
      </p>
    </div>
  );
}
