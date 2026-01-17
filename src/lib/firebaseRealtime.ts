import { getDatabase } from 'firebase/database';
import { app } from './firebase';

// ✅ Use the existing Firebase app instance from firebase.ts
export const realtimeDb = getDatabase(app, "https://soulsync-app-119-default-rtdb.asia-southeast1.firebasedatabase.app");
