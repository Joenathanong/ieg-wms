'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

export type MsgType = 'S' | 'E' | 'W' | 'I';

interface StatusMessage {
  text: string;
  type: MsgType;
  at: number;
}

interface StatusCtx {
  message: StatusMessage | null;
  setStatus: (text: string, type?: MsgType) => void;
  clearStatus: () => void;
}

const Ctx = createContext<StatusCtx>({
  message: null,
  setStatus: () => {},
  clearStatus: () => {},
});

export function useStatus() {
  return useContext(Ctx);
}

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<StatusMessage | null>(null);

  const setStatus = useCallback((text: string, type: MsgType = 'S') => {
    setMessage({ text, type, at: Date.now() });
  }, []);

  const clearStatus = useCallback(() => setMessage(null), []);

  const value = useMemo(() => ({ message, setStatus, clearStatus }), [message, setStatus, clearStatus]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const STYLE: Record<MsgType, { color: string; bg: string; Icon: typeof Info }> = {
  S: { color: '#8FE0A4', bg: 'rgba(63,164,91,0.14)', Icon: CheckCircle2 },
  E: { color: '#FF9CA0', bg: 'rgba(229,72,77,0.16)', Icon: XCircle },
  W: { color: '#F3C77B', bg: 'rgba(233,162,59,0.14)', Icon: AlertTriangle },
  I: { color: '#9DC0FF', bg: 'rgba(54,123,245,0.14)', Icon: Info },
};

/** Status Bar khas SAP di baris paling bawah layar. */
export function StatusBar({ system = 'PRD', client = '100' }: { system?: string; client?: string }) {
  const { message } = useStatus();
  const s = STYLE[message?.type ?? 'I'];
  const Icon = s.Icon;

  return (
    <footer
      className="flex items-center justify-between h-[26px] shrink-0 border-t border-sap-border bg-sap-sysbar
                 text-2xs select-none"
    >
      <div
        key={message?.at ?? 'idle'}
        className="sap-flash flex items-center gap-2 px-3 h-full min-w-0 flex-1"
        style={message ? { backgroundColor: s.bg } : undefined}
      >
        {message ? (
          <>
            <Icon size={13} style={{ color: s.color }} className="shrink-0" />
            <span className="truncate font-mono" style={{ color: s.color }} title={message.text}>
              {message.text}
            </span>
          </>
        ) : (
          <span className="text-sap-muted/70 font-mono">Ready</span>
        )}
      </div>

      <div className="flex items-center h-full divide-x divide-sap-border border-l border-sap-border font-mono text-sap-muted">
        <span className="px-3">{system}</span>
        <span className="px-3">CLNT {client}</span>
        <span className="px-3 hidden sm:inline">OVR</span>
        <span className="px-3 hidden md:inline">WMS-LITE</span>
      </div>
    </footer>
  );
}
