'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Check, X } from 'lucide-react';
import { TCODES, resolveTCode, normalizeCommand } from '@/lib/tcodes';
import { useStatus } from './StatusBar';

/**
 * Command Field ala SAP GUI: ketik T-Code (MIGO, MB52, /nLX02 ...) lalu Enter.
 */
export function CommandField({ role }: { role: string }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const router = useRouter();
  const { setStatus } = useStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Ctrl+/ atau F3-like shortcut untuk fokus ke command field
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const q = normalizeCommand(value);
  const suggestions = q
    ? TCODES.filter(
        (t) =>
          (t.code.startsWith(q) || t.title.toUpperCase().includes(q)) &&
          (!t.adminOnly || role === 'ADMIN')
      ).slice(0, 8)
    : [];

  function go(path: string, code: string) {
    setOpen(false);
    setValue('');
    inputRef.current?.blur();
    if (code === 'LOGOUT') {
      window.location.href = '/api/auth/logout';
      return;
    }
    setStatus(`Transaction ${code} started`, 'I');
    router.push(path);
  }

  function submit() {
    if (open && suggestions[hi]) {
      go(suggestions[hi].path, suggestions[hi].code);
      return;
    }
    const t = resolveTCode(value);
    if (!t) {
      setStatus(`Transaction ${normalizeCommand(value) || '?'} does not exist`, 'E');
      return;
    }
    if (t.adminOnly && role !== 'ADMIN') {
      setStatus(`No authorization for transaction ${t.code}`, 'E');
      return;
    }
    go(t.path, t.code);
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-stretch h-[24px] w-[240px] sm:w-[300px]">
        <div className="flex items-center px-1.5 bg-[#12161d] border border-r-0 border-sap-border rounded-l-[2px]">
          <ChevronRight size={13} className="text-sap-blue" />
        </div>
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="Command field  (Ctrl + /)"
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Escape') {
              setOpen(false);
              setValue('');
            }
          }}
          className="flex-1 min-w-0 bg-[#12161d] border border-sap-border text-sap-text
                     font-mono text-2xs px-2 outline-none focus:border-sap-blue
                     placeholder:text-sap-muted/50"
        />
        <button
          type="button"
          onClick={submit}
          title="Enter"
          className="px-1.5 bg-[#12161d] border border-l-0 border-sap-border rounded-r-[2px]
                     hover:bg-sap-blue/25 text-sap-muted hover:text-sap-blue"
        >
          <Check size={13} />
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-[340px] max-h-[280px] overflow-auto bg-sap-panel
                     border border-sap-border rounded-[3px] shadow-sap"
        >
          {suggestions.map((t, i) => (
            <li key={`${t.code}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setHi(i)}
                onClick={() => go(t.path, t.code)}
                className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-2xs
                            ${i === hi ? 'bg-sap-blue/25' : 'hover:bg-white/5'}`}
              >
                <span className="font-mono text-sap-blue w-[74px] shrink-0">{t.code}</span>
                <span className="truncate text-sap-muted">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && q && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 w-[340px] bg-sap-panel border border-sap-border rounded-[3px] shadow-sap px-2.5 py-2 text-2xs text-sap-error flex items-center gap-2">
          <X size={13} /> Transaction {q} does not exist
        </div>
      )}
    </div>
  );
}
