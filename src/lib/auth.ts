import { useEffect, useState } from 'react';

// Editing is "locked" by default. Unlocking stores the validated editor
// password (same APP_PASSWORD secret the Functions check) in localStorage;
// db.ts attaches it to every write. Reads/watching never need it.

const PW_KEY = 'fe_editor_password';
const EVENT = 'fe-auth-change';

export function getPassword(): string | null {
  try { return localStorage.getItem(PW_KEY); } catch { return null; }
}

export function isUnlocked(): boolean {
  return !!getPassword();
}

function setPassword(pw: string): void {
  try { localStorage.setItem(PW_KEY, pw); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
}

export function lock(): void {
  try { localStorage.removeItem(PW_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Check a candidate password against the server without storing it. */
export async function verifyPassword(pw: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth', { headers: { 'x-app-password': pw } });
    return res.ok;
  } catch {
    return false;
  }
}

/** Prompt for the editor password, validate it, and unlock on success. */
export async function unlock(): Promise<boolean> {
  const pw = window.prompt('Enter the editor password to unlock editing:');
  if (!pw) return false;
  if (!(await verifyPassword(pw))) {
    window.alert('Incorrect password.');
    return false;
  }
  setPassword(pw);
  return true;
}

/** React hook that re-renders when edit access is locked/unlocked. */
export function useUnlocked(): boolean {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  useEffect(() => {
    const handler = () => setUnlocked(isUnlocked());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler); // sync across tabs
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return unlocked;
}
