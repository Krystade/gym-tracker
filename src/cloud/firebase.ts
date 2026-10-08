import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore/lite';

// Not a secret: a web app's Firebase config only names the project. firestore.rules is what guards the data.
const CONFIG = {
  apiKey: 'AIzaSyCLUl-penNTSaUqVqPxLKTu6PjFtlHq830',
  authDomain: 'krystade-gym-tracker.firebaseapp.com',
  projectId: 'krystade-gym-tracker',
  storageBucket: 'krystade-gym-tracker.firebasestorage.app',
  messagingSenderId: '668961884082',
  appId: '1:668961884082:web:84e5f911a8e65f52bc06ab',
};
/** Served from this machine (dev server, tests): the local emulators under a demo project, never the real one. */
const LOCAL = typeof location !== 'undefined' && ['127.0.0.1', 'localhost'].includes(location.hostname);

export interface Cloud { auth: Auth; db: Firestore; A: typeof import('firebase/auth'); F: typeof import('firebase/firestore/lite') }
let loading: Promise<Cloud> | null = null;

/** Firebase, loaded on first use: the app's first load doesn't pay for it until there's an account. */
export function loadCloud(): Promise<Cloud> {
  loading ??= (async () => {
    const [{ initializeApp }, A, F] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore/lite')]);
    const app = initializeApp(LOCAL ? { ...CONFIG, apiKey: 'demo-key', projectId: 'demo-gym-tracker' } : CONFIG);
    // No popup/redirect resolver: email + password needs none, and it keeps Firebase's sign-in iframe out.
    const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
    const db = F.getFirestore(app);
    if (LOCAL) {
      A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return { auth, db, A, F };
  })();
  loading.catch(() => { loading = null; }); // offline on first try: try again next time
  return loading;
}

/** Plain words for Firebase's error codes. */
export function cloudError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const known: Record<string, string> = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Type a password.',
    'auth/weak-password': 'Use a password of at least 6 characters.',
    'auth/email-already-in-use': 'There’s already an account with that email. Sign in instead.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No connection. Your log is safe on this phone; try again when you’re online.',
    'auth/requires-recent-login': 'Sign in again first.',
    'unavailable': 'No connection. Your log is safe on this phone; it syncs when you’re back online.',
    'permission-denied': 'The cloud refused that. Sign out and in again.',
  };
  return known[code] ?? `Something went wrong: ${code || String(e)}`;
}
