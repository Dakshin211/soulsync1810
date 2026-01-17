import { realtimeDb } from '@/lib/firebaseRealtime';
import {
  ref,
  set,
  update,
  onValue,
  serverTimestamp,
  get,
} from 'firebase/database';

export interface PlaybackState {
  songId: string;
  songMeta: {
    title: string;
    artist: string;
    thumbnail: string;
  };
  isPlaying: boolean;
  position: number;
  volume: number;
  initiator: string;
  opId: string;
  version: number;
  updatedAt: number;
  startServerTs: number | null;
}

class RoomPlaybackService {
  private subscriptions = new Map<string, () => void>();
  private lastUserOpId: string | null = null;
  private heartbeatIntervals = new Map<string, NodeJS.Timeout>();
  private seekThrottle: NodeJS.Timeout | null = null;

  private serverTimeOffsetMs = 0;
  private serverOffsetUnsub: (() => void) | null = null;

  private ensureServerTimeOffsetListener() {
    if (this.serverOffsetUnsub) return;

    const offsetRef = ref(realtimeDb, '.info/serverTimeOffset');
    this.serverOffsetUnsub = onValue(offsetRef, (snap) => {
      const v = snap.val();
      this.serverTimeOffsetMs = typeof v === 'number' ? v : 0;
    });
  }

  private nowServerMs() {
    return Date.now() + this.serverTimeOffsetMs;
  }

  /* ================= HELPERS ================= */

  private generateOpId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getNextVersion(current: any): number {
    return typeof current?.version === 'number' ? current.version + 1 : 1;
  }

  /* ================= SONG CHANGE (AUTHORITATIVE) ================= */

  async playSong(
    roomId: string,
    userId: string,
    songId: string,
    songMeta: PlaybackState['songMeta'],
    volume = 80
  ) {
    const playbackRef = ref(realtimeDb, `rooms/${roomId}/playback`);
    const snapshot = await get(playbackRef);
    const current = snapshot.val();

    const opId = this.generateOpId();
    this.lastUserOpId = opId;

    await set(playbackRef, {
      songId,
      songMeta,
      isPlaying: true,
      position: 0,
      volume,
      initiator: userId,
      opId,
      version: this.getNextVersion(current),
      updatedAt: serverTimestamp(),
      startServerTs: serverTimestamp(),
    });

    console.log(`🎵 [Playback] New song: ${songMeta.title}`);
    return opId;
  }

  /* ================= PAUSE ================= */

  async pause(roomId: string, userId: string, position: number) {
    const playbackRef = ref(realtimeDb, `rooms/${roomId}/playback`);
    const snapshot = await get(playbackRef);
    const current = snapshot.val();
    if (!current) return;

    const opId = this.generateOpId();
    this.lastUserOpId = opId;

    await update(playbackRef, {
      isPlaying: false,
      position,
      initiator: userId,
      opId,
      version: this.getNextVersion(current),
      updatedAt: serverTimestamp(),
      startServerTs: null,
    });
  }

  /* ================= RESUME ================= */

  async resume(roomId: string, userId: string, position: number) {
    const playbackRef = ref(realtimeDb, `rooms/${roomId}/playback`);
    const snapshot = await get(playbackRef);
    const current = snapshot.val();
    if (!current) return;

    const opId = this.generateOpId();
    this.lastUserOpId = opId;

    await update(playbackRef, {
      isPlaying: true,
      position,
      initiator: userId,
      opId,
      version: this.getNextVersion(current),
      updatedAt: serverTimestamp(),
      startServerTs: serverTimestamp(),
    });
  }

  /* ================= SEEK ================= */

  async seek(
    roomId: string,
    userId: string,
    position: number,
    isPlaying: boolean
  ) {
    if (this.seekThrottle) return;

    this.seekThrottle = setTimeout(() => {
      this.seekThrottle = null;
    }, 250);

    const playbackRef = ref(realtimeDb, `rooms/${roomId}/playback`);
    const snapshot = await get(playbackRef);
    const current = snapshot.val();
    if (!current) return;

    const opId = this.generateOpId();
    this.lastUserOpId = opId;

    await update(playbackRef, {
      position,
      isPlaying,
      initiator: userId,
      opId,
      version: this.getNextVersion(current),
      updatedAt: serverTimestamp(),
      startServerTs: isPlaying ? serverTimestamp() : null,
    });
  }

  /* ================= SUBSCRIBE ================= */

  subscribe(
    roomId: string,
    callback: (
      state: PlaybackState | null,
      syncedPos: number | null,
      isLocal: boolean
    ) => void
  ) {
    this.ensureServerTimeOffsetListener();

    const playbackRef = ref(realtimeDb, `rooms/${roomId}/playback`);

    const unsub = onValue(playbackRef, (snap) => {
      const raw = snap.val() as any;
      if (!raw) return callback(null, null, false);

      const state = raw as PlaybackState;
      const isLocal = typeof state.opId === 'string' && state.opId === this.lastUserOpId;

      const position = typeof raw.position === 'number' ? raw.position : 0;
      const startServerTs = typeof raw.startServerTs === 'number' ? raw.startServerTs : null;

      let syncedPos = position;
      if (raw.isPlaying && startServerTs) {
        syncedPos = position + (this.nowServerMs() - startServerTs) / 1000;
      }

      callback(state, syncedPos, isLocal);
    });

    this.subscriptions.set(roomId, unsub);
    return unsub;
  }

  /* ================= HEARTBEAT (NO VERSION) ================= */

  startHeartbeat(
    roomId: string,
    userId: string,
    getPlayerState: () => { position: number; isPlaying: boolean }
  ) {
    this.stopHeartbeat(roomId);

    const interval = setInterval(async () => {
      const { position, isPlaying } = getPlayerState();
      const refPath = ref(realtimeDb, `rooms/${roomId}/playback`);

      const snap = await get(refPath);
      const current = snap.val();
      if (!current || current.initiator !== userId) return;

      await update(refPath, {
        position,
        updatedAt: serverTimestamp(),
        startServerTs: isPlaying ? serverTimestamp() : null,
        // ❌ NO version update here
      });
    }, 8000);

    this.heartbeatIntervals.set(roomId, interval);
  }

  stopHeartbeat(roomId: string) {
    const interval = this.heartbeatIntervals.get(roomId);
    if (interval) clearInterval(interval);
    this.heartbeatIntervals.delete(roomId);
  }

  unsubscribe(roomId: string) {
    this.stopHeartbeat(roomId);
    const unsub = this.subscriptions.get(roomId);
    if (unsub) {
      unsub();
      this.subscriptions.delete(roomId);
    }
  }

  cleanup() {
    this.subscriptions.forEach((u) => u());
    this.subscriptions.clear();
    this.heartbeatIntervals.forEach(clearInterval);
    this.heartbeatIntervals.clear();
    this.lastUserOpId = null;

    if (this.serverOffsetUnsub) {
      this.serverOffsetUnsub();
      this.serverOffsetUnsub = null;
    }
    this.serverTimeOffsetMs = 0;
  }
}

export const roomPlaybackService = new RoomPlaybackService();
