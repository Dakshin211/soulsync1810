import { realtimeDb } from '@/lib/firebaseRealtime';
import { ref, set, update, onValue, remove, serverTimestamp } from 'firebase/database';

/**
 * Room metadata ONLY
 * ❌ No playback control
 * ❌ No position
 * ❌ No play / pause
 */
export interface RoomMeta {
  roomId: string;
  hostId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

class RoomStateService {
  private unsubscribers: Map<string, () => void> = new Map();

  /* ================= CREATE ROOM ================= */

  async createRoom(roomId: string, hostId: string, title?: string) {
    const refPath = ref(realtimeDb, `rooms/${roomId}/meta`);

    await set(refPath, {
      roomId,
      hostId,
      title: title ?? 'Music Room',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    console.log(`🏠 Room created: ${roomId}`);
  }

  /* ================= UPDATE ROOM META ================= */

  async updateRoom(roomId: string, data: Partial<RoomMeta>) {
    await update(ref(realtimeDb, `rooms/${roomId}/meta`), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  }

  /* ================= SUBSCRIBE ================= */

  subscribeToRoomMeta(roomId: string, callback: (meta: RoomMeta | null) => void) {
    const metaRef = ref(realtimeDb, `rooms/${roomId}/meta`);

    const unsub = onValue(metaRef, (snap) => {
      callback(snap.val());
    });

    this.unsubscribers.set(roomId, unsub);
    return unsub;
  }

  unsubscribe(roomId: string) {
    const unsub = this.unsubscribers.get(roomId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(roomId);
    }
  }

  cleanup() {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers.clear();
  }

  /* ================= DELETE ROOM ================= */

  async deleteRoom(roomId: string) {
    await remove(ref(realtimeDb, `rooms/${roomId}`));
    console.log(`🗑️ Room deleted: ${roomId}`);
  }
}

export const roomStateService = new RoomStateService();
