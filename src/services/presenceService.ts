import { realtimeDb } from '@/lib/firebaseRealtime';
import {
  ref,
  set,
  update,
  onValue,
  onDisconnect,
} from 'firebase/database';

export interface UserPresence {
  status: 'online' | 'offline';
  lastSeen: number;
  currentRoom?: string;
  currentSong?: {
    title: string;
    artist: string;
  };
}

// Heartbeat interval (30 seconds for more accurate online detection)
const HEARTBEAT_INTERVAL = 30 * 1000;
// Consider offline after 45 seconds of no heartbeat (tighter window)
const OFFLINE_THRESHOLD = 45 * 1000;

class PresenceService {
  private unsubscribers: Map<string, () => void> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentUserId: string | null = null;
  private isInitialized = false;

  /**
   * Initialize presence ONCE per session with heartbeat
   */
  async initUserPresence(userId: string) {
    // Prevent multiple initializations
    if (this.isInitialized && this.currentUserId === userId) {
      console.log(`🟢 [Presence] Already initialized for ${userId.slice(0, 8)}`);
      return;
    }

    // Clean up previous if switching users
    if (this.currentUserId && this.currentUserId !== userId) {
      this.cleanup();
    }

    this.currentUserId = userId;
    this.isInitialized = true;
    
    try {
      const presenceRef = ref(realtimeDb, `presence/${userId}`);

      // Mark user online with current timestamp
      await set(presenceRef, {
        status: 'online',
        lastSeen: Date.now(),
      });

      // Ensure offline state on disconnect
      onDisconnect(presenceRef).set({
        status: 'offline',
        lastSeen: Date.now(),
      });

      // Start heartbeat
      this.startHeartbeat(userId);

      console.log(`🟢 [Presence] User ${userId.slice(0, 8)} online with heartbeat`);
    } catch (err) {
      // Silently fail - presence is optional
      console.warn('⚠️ [Presence] initUserPresence failed:', err);
      this.isInitialized = false;
    }
  }

  /**
   * Start heartbeat to keep presence alive
   */
  private startHeartbeat(userId: string) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Immediate first heartbeat
    this.sendHeartbeat(userId);

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat(userId);
    }, HEARTBEAT_INTERVAL);
    
    // Also send heartbeat on visibility change (when user returns to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        this.sendHeartbeat(userId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Store cleanup for later
    (this as any)._visibilityCleanup = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }

  private async sendHeartbeat(userId: string) {
    try {
      const presenceRef = ref(realtimeDb, `presence/${userId}`);
      await update(presenceRef, {
        status: 'online',
        lastSeen: Date.now(),
      });
    } catch {
      // Silently fail
    }
  }

  /**
   * Update only room info (no overwrite)
   */
  async updatePresence(userId: string, data: Partial<UserPresence>) {
    try {
      const presenceRef = ref(realtimeDb, `presence/${userId}`);

      const cleanUpdate: Record<string, any> = {
        lastSeen: Date.now(),
        status: 'online',
      };

      if (data.currentRoom !== undefined) {
        cleanUpdate.currentRoom = data.currentRoom || null;
      }

      if (data.currentSong !== undefined) {
        cleanUpdate.currentSong = data.currentSong || null;
      }

      await update(presenceRef, cleanUpdate);
    } catch {
      // Silently fail
    }
  }

  /**
   * Subscribe to a user's presence with accurate online/offline detection
   * Returns existing subscription if already subscribed (doesn't overwrite)
   */
  subscribeToUserPresence(
    userId: string,
    callback: (presence: UserPresence | null) => void
  ): (() => void) | undefined {
    // If already subscribed, update callback but don't create new listener
    if (this.unsubscribers.has(userId)) {
      // Create a wrapper that calls the new callback too
      const existingUnsub = this.unsubscribers.get(userId)!;
      
      // Subscribe with new callback
      const presenceRef = ref(realtimeDb, `presence/${userId}`);
      const newUnsub = onValue(presenceRef, (snapshot) => {
        const data = snapshot.val();
        
        if (!data) {
          callback({ status: 'offline', lastSeen: 0 });
          return;
        }

        // Check if user is actually online based on heartbeat
        const lastSeen = data.lastSeen || 0;
        const isOnline = data.status === 'online' && (Date.now() - lastSeen < OFFLINE_THRESHOLD);

        callback({
          status: isOnline ? 'online' : 'offline',
          lastSeen,
          currentRoom: data.currentRoom,
          currentSong: data.currentSong,
        });
      });
      
      return newUnsub;
    }

    const presenceRef = ref(realtimeDb, `presence/${userId}`);

    const unsubscribe = onValue(presenceRef, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) {
        callback({ status: 'offline', lastSeen: 0 });
        return;
      }

      // Check if user is actually online based on heartbeat
      const lastSeen = data.lastSeen || 0;
      const isOnline = data.status === 'online' && (Date.now() - lastSeen < OFFLINE_THRESHOLD);

      callback({
        status: isOnline ? 'online' : 'offline',
        lastSeen,
        currentRoom: data.currentRoom,
        currentSong: data.currentSong,
      });
    });

    this.unsubscribers.set(userId, unsubscribe);
    return unsubscribe;
  }

  unsubscribe(userId: string) {
    const unsub = this.unsubscribers.get(userId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(userId);
    }
  }

  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // Clean up visibility listener
    if ((this as any)._visibilityCleanup) {
      (this as any)._visibilityCleanup();
      (this as any)._visibilityCleanup = null;
    }
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers.clear();
    this.isInitialized = false;
    this.currentUserId = null;
  }
}

export const presenceService = new PresenceService();
