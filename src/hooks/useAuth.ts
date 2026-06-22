'use client';
import { useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import type { AppUser } from '@/types';

interface AuthState {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    firebaseUser: null,
    appUser: null,
    loading: true,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState({ firebaseUser: null, appUser: null, loading: false });
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', fbUser.uid));
        const appUser = snap.exists() ? (snap.data() as AppUser) : null;
        setState({ firebaseUser: fbUser, appUser, loading: false });
      } catch {
        setState({ firebaseUser: fbUser, appUser: null, loading: false });
      }
    });
    return unsub;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
    // Clear server-side session cookie
    await fetch('/api/auth/logout', { method: 'POST' });
  };

  return { ...state, login, logout };
}
