import { useEffect, useState } from 'react';

const ROOM_STORAGE_KEY = 'soulsync_current_room';

interface RoomPersistence {
  roomId: string;
  roomName: string;
  roomCode: string;
  timestamp: number;
}

export const useRoomPersistence = () => {
  const [persistedRoom, setPersistedRoom] = useState<RoomPersistence | null>(null);

  // Load persisted room on mount
  useEffect(() => {
    const stored = localStorage.getItem(ROOM_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Only use if less than 24 hours old
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          setPersistedRoom(parsed);
          console.log(`💾 [RoomPersistence] Restored room: ${parsed.roomName}`);
        } else {
          localStorage.removeItem(ROOM_STORAGE_KEY);
          console.log(`🗑️ [RoomPersistence] Cleared expired room`);
        }
      } catch (error) {
        console.error('❌ [RoomPersistence] Error loading:', error);
        localStorage.removeItem(ROOM_STORAGE_KEY);
      }
    }
  }, []);

  const saveRoom = (roomId: string, roomName: string, roomCode: string) => {
    const data: RoomPersistence = {
      roomId,
      roomName,
      roomCode,
      timestamp: Date.now()
    };
    localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(data));
    setPersistedRoom(data);
    console.log(`💾 [RoomPersistence] Saved room: ${roomName}`);
  };

  const clearRoom = () => {
    localStorage.removeItem(ROOM_STORAGE_KEY);
    setPersistedRoom(null);
    console.log(`🗑️ [RoomPersistence] Cleared room`);
  };

  return { persistedRoom, saveRoom, clearRoom };
};
