import { realtimeDb } from '@/lib/firebaseRealtime';
import {
  ref,
  push,
  set,
  onValue,
  remove,
  get,
  serverTimestamp,
} from 'firebase/database';

export interface RoomQueueSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

export interface RoomQueueItem {
  itemId: string;
  song: RoomQueueSong;
  addedBy: string;
  addedAt?: number;
}

class RoomQueueService {
  subscribe(roomId: string, callback: (items: RoomQueueItem[]) => void) {
    const queueRef = ref(realtimeDb, `rooms/${roomId}/queue`);

    return onValue(queueRef, (snap) => {
      const val = snap.val() as Record<string, any> | null;
      if (!val) return callback([]);

      const items: RoomQueueItem[] = Object.entries(val).map(([itemId, v]) => ({
        itemId,
        song: v.song,
        addedBy: v.addedBy,
        addedAt: typeof v.addedAt === 'number' ? v.addedAt : undefined,
      }));

      items.sort((a, b) => {
        const ta = a.addedAt ?? 0;
        const tb = b.addedAt ?? 0;
        if (ta !== tb) return ta - tb;
        return a.itemId.localeCompare(b.itemId);
      });

      callback(items);
    });
  }

  async addSong(roomId: string, userId: string, song: RoomQueueSong) {
    const listRef = ref(realtimeDb, `rooms/${roomId}/queue`);
    const itemRef = push(listRef);
    if (!itemRef.key) throw new Error('Failed to create queue item');

    await set(itemRef, {
      song,
      addedBy: userId,
      addedAt: serverTimestamp(),
    });

    return itemRef.key;
  }

  async removeItem(roomId: string, itemId: string) {
    await remove(ref(realtimeDb, `rooms/${roomId}/queue/${itemId}`));
  }

  async getFirstItem(roomId: string): Promise<RoomQueueItem | null> {
    const snap = await get(ref(realtimeDb, `rooms/${roomId}/queue`));
    const val = snap.val() as Record<string, any> | null;
    if (!val) return null;

    const items: RoomQueueItem[] = Object.entries(val).map(([itemId, v]) => ({
      itemId,
      song: v.song,
      addedBy: v.addedBy,
      addedAt: typeof v.addedAt === 'number' ? v.addedAt : undefined,
    }));

    items.sort((a, b) => {
      const ta = a.addedAt ?? 0;
      const tb = b.addedAt ?? 0;
      if (ta !== tb) return ta - tb;
      return a.itemId.localeCompare(b.itemId);
    });

    return items[0] ?? null;
  }
}

export const roomQueueService = new RoomQueueService();
