import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  signInWithPopup,
  fetchSignInMethodsForEmail,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '@/lib/firebase';
import { presenceService } from '@/services/presenceService';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  needsFavoriteArtists: boolean;
  setNeedsFavoriteArtists: (value: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, username: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

type PendingGoogleLink = {
  email: string;
  idToken?: string | null;
  accessToken?: string | null;
};

const PENDING_GOOGLE_LINK_KEY = 'soulsync_pending_google_link';

function readPendingGoogleLink(): PendingGoogleLink | null {
  try {
    const raw = sessionStorage.getItem(PENDING_GOOGLE_LINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingGoogleLink(data: PendingGoogleLink) {
  try {
    sessionStorage.setItem(PENDING_GOOGLE_LINK_KEY, JSON.stringify(data));
  } catch {}
}

function clearPendingGoogleLink() {
  try {
    sessionStorage.removeItem(PENDING_GOOGLE_LINK_KEY);
  } catch {}
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsFavoriteArtists, setNeedsFavoriteArtists] = useState(false);

  const ensureUserDoc = async (user: User, username?: string) => {
    const userRef = doc(db, 'Users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        username: username || user.displayName || user.email?.split('@')[0] || 'User',
        email: user.email,
        favoriteArtists: [],
        createdAt: new Date().toISOString(),
      });
    }
  };

  const maybeLinkPendingGoogle = async (signedInEmail: string, firebaseUser: User) => {
    const pending = readPendingGoogleLink();
    if (!pending) return;

    const normalizedEmail = signedInEmail.trim().toLowerCase();
    if (pending.email !== normalizedEmail) return;

    const cred = GoogleAuthProvider.credential(pending.idToken ?? null, pending.accessToken ?? null);
    try {
      await linkWithCredential(firebaseUser, cred);
    } catch (e: any) {
      // If it's already linked, ignore.
      if (e?.code !== 'auth/provider-already-linked') throw e;
    } finally {
      clearPendingGoogleLink();
    }
  };

  const signup = async (email: string, password: string, username: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await ensureUserDoc(userCredential.user, username);
    } catch (error: any) {
      // If the email already exists under Google, link password to the Google account instead of creating a new one.
      if (error?.code === 'auth/email-already-in-use') {
        const methods = await fetchSignInMethodsForEmail(auth, email).catch(() => [] as string[]);

        if (methods.includes('google.com')) {
          const googleResult = await signInWithPopup(auth, googleProvider);

          const googleEmail = (googleResult.user.email || '').toLowerCase();
          if (googleEmail !== email.trim().toLowerCase()) {
            await signOut(auth);
            throw new Error('Please choose the same Google account as the email you entered.');
          }

          try {
            await linkWithCredential(
              googleResult.user,
              EmailAuthProvider.credential(email, password)
            );
          } catch (e: any) {
            if (e?.code !== 'auth/provider-already-linked') throw e;
          }

          await ensureUserDoc(googleResult.user, username);
          return;
        }

        throw new Error('This email is already registered. Please sign in instead.');
      }

      throw error;
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await maybeLinkPendingGoogle(email, userCredential.user);
    } catch (error: any) {
      // Common case: user originally used Google, so password login will fail.
      if (
        error?.code === 'auth/wrong-password' ||
        error?.code === 'auth/invalid-credential' ||
        error?.code === 'auth/user-not-found'
      ) {
        const methods = await fetchSignInMethodsForEmail(auth, email).catch(() => [] as string[]);
        if (methods.includes('google.com') && !methods.includes('password')) {
          throw new Error('This email uses Google sign-in. Use Google, or sign in with Google once to set a password.');
        }
      }

      throw error;
    }
  };

  const loginWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await ensureUserDoc(result.user);
    } catch (error: any) {
      // If user already has an email/password account, Google sign-in must be linked.
      if (error?.code === 'auth/account-exists-with-different-credential') {
        const email = (error?.customData?.email || '').toLowerCase();
        const methods = email ? await fetchSignInMethodsForEmail(auth, email).catch(() => [] as string[]) : [];

        const pendingCred = GoogleAuthProvider.credentialFromError(error) as any;
        if (email && pendingCred) {
          writePendingGoogleLink({
            email,
            idToken: pendingCred.idToken ?? null,
            accessToken: pendingCred.accessToken ?? null,
          });
        }

        if (methods.includes('password')) {
          throw new Error('This email already uses password login. Sign in with email + password once to link Google.');
        }

        throw new Error('This email is already registered with another sign-in method.');
      }

      throw error;
    }
  };

  const logout = async () => {
    try {
      if (auth.currentUser) {
        await presenceService.updatePresence(auth.currentUser.uid, { status: 'offline' } as any);
      }
    } finally {
      presenceService.cleanup();
      await signOut(auth);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
        // Presence should be global (not only inside Rooms/Friends)
        void presenceService.initUserPresence(user.uid);

        const userDoc = await getDoc(doc(db, 'Users', user.uid));
        const userData = userDoc.data();

        if (!userData?.favoriteArtists || userData.favoriteArtists.length === 0) {
          setNeedsFavoriteArtists(true);
        } else {
          setNeedsFavoriteArtists(false);
        }
      } else {
        presenceService.cleanup();
        setNeedsFavoriteArtists(false);
      }

      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    loading,
    needsFavoriteArtists,
    setNeedsFavoriteArtists,
    login,
    signup,
    loginWithGoogle,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

