import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBUl9xPneLDA1ZT_rRjWIiTpZ7HXIiKPwo",
  authDomain: "soulsync-app-119.firebaseapp.com",
  projectId: "soulsync-app-119",
  storageBucket: "soulsync-app-119.firebasestorage.app",
  messagingSenderId: "503234048267",
  appId: "1:503234048267:web:0d5cddda4c797176ecb20e",
  measurementId: "G-WL0R740RJW"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export { app };
