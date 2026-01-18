import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { roomPlaybackService } from '@/services/roomPlaybackService';
import { roomQueueService, RoomQueueItem } from '@/services/roomQueueService';
import { fetchRecommendations } from '@/services/recommendationService';

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

// Track where playback originated from
type PlaybackSource = 'home' | 'search' | 'playlist' | 'room' | null;

interface MusicPlayerContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  queue: Song[];
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  activeRoomId: string | null;
  recommendationQueue: Song[];
  isLoadingRecommendations: boolean;
  recommendationSlow: boolean;
  recommendationError: string | null;
  recommendationSource: string | null;
  playbackSource: PlaybackSource;
  canSkipNext: boolean;
  audioOnlyMode: boolean;
  setAudioOnlyMode: (enabled: boolean) => void;
  playQueueSong: (song: Song) => void;
  
  // Floating animation state
  floatingQueueSong: Song | null;
  showFloatingAnimation: boolean;
  clearFloatingAnimation: () => void;

  playSong: (song: Song, source?: PlaybackSource) => void;
  playSongInRoom: (song: Song) => void;
  addToRoomQueue: (song: Song) => void;
  playRoomQueueItem: (itemId: string) => void;
  pauseSong: () => void;
  resumeSong: () => void;
  nextSong: () => void;
  prevSong: () => void;
  addToQueue: (song: Song) => void;
  setQueue: (songs: Song[], source?: PlaybackSource) => void;
  clearQueue: () => void;
  seekTo: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  stopMusic: () => void;
  playerRef: React.MutableRefObject<any>;
  updateDuration: () => void;
  setPlayerReady: (ready: boolean) => void;
  setActiveRoom: (roomId: string | null, userId: string | null) => void;
  roomQueue: RoomQueueItem[];
  forcePlayerReload: () => void;
  playRecommendedSong: (song: Song) => void;
  refreshRecommendations: () => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextType | undefined>(
  undefined
);

export const useMusicPlayer = () => {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within provider');
  return ctx;
};

export const MusicPlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { currentUser } = useAuth();

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueueState] = useState<Song[]>([]);
  const [roomQueue, setRoomQueue] = useState<RoomQueueItem[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(100);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'one' | 'all'>('off');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  // Recommendation queue state
  const [recommendationQueue, setRecommendationQueue] = useState<Song[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [recommendationSlow, setRecommendationSlow] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [recommendationSource, setRecommendationSource] = useState<string | null>(null);
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>(null);
  
  // Floating queue animation state
  const [floatingQueueSong, setFloatingQueueSong] = useState<Song | null>(null);
  const [showFloatingAnimation, setShowFloatingAnimation] = useState(false);
  
  const clearFloatingAnimation = useCallback(() => {
    setShowFloatingAnimation(false);
    setFloatingQueueSong(null);
  }, []);
  
  // Audio-only mode for background playback (desktop)
  const [audioOnlyMode, setAudioOnlyModeState] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('audioOnlyMode') === 'true';
    }
    return false;
  });

  // Player reload key - increment to force YouTube component remount
  const [playerKey, setPlayerKey] = useState(0);

  const playerRef = useRef<any>(null);
  
  // Set audio-only mode with localStorage persistence
  const setAudioOnlyMode = useCallback((enabled: boolean) => {
    setAudioOnlyModeState(enabled);
    localStorage.setItem('audioOnlyMode', enabled ? 'true' : 'false');
  }, []);
  const lastAppliedVersionRef = useRef<number>(0);
  const isSyncingRef = useRef(false);

  const inRoom = Boolean(activeRoomId && activeUserId);

  // Force player reload - used to fix audio/video mismatch
  const forcePlayerReload = useCallback(() => {
    setPlayerKey((prev) => prev + 1);
    setDuration(0);
    setCurrentTime(0);
  }, []);

  // Restore persisted room context
  useEffect(() => {
    const storedRoomId = localStorage.getItem('activeRoomId');
    const storedUserId = localStorage.getItem('userId');
    const uid = storedUserId || currentUser?.uid || null;

    if (storedRoomId && uid) {
      setActiveRoomId(storedRoomId);
      setActiveUserId(uid);
      localStorage.setItem('userId', uid);
    }
  }, [currentUser?.uid]);

  useEffect(() => {
    if (activeRoomId && !activeUserId && currentUser?.uid) {
      setActiveUserId(currentUser.uid);
      localStorage.setItem('userId', currentUser.uid);
    }
  }, [activeRoomId, activeUserId, currentUser?.uid]);

  const setActiveRoom = useCallback(
    (roomId: string | null, userId: string | null) => {
      console.log(
        `🎵 [MusicPlayer] Setting active room: ${roomId?.slice(0, 8) || 'none'}`
      );
      setActiveRoomId(roomId);
      setActiveUserId(userId);
      lastAppliedVersionRef.current = 0;

      if (roomId) {
        localStorage.setItem('activeRoomId', roomId);
        if (userId) localStorage.setItem('userId', userId);
      } else {
        localStorage.removeItem('activeRoomId');
        localStorage.removeItem('userId');
        setRoomQueue([]);
      }
    },
    []
  );

  /* ================= FIREBASE → CONTEXT (Room Sync) ================= */
  const hasInitialSyncedRef = useRef(false);
  const pendingSyncPositionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!inRoom || !activeRoomId) return;

    hasInitialSyncedRef.current = false;
    pendingSyncPositionRef.current = null;
    console.log(`🔄 [MusicPlayer] Subscribing to room playback: ${activeRoomId.slice(0, 8)}`);

    const unsub = roomPlaybackService.subscribe(
      activeRoomId,
      (state, syncedPos, isLocal) => {
        if (!state) return;

        const version = typeof state.version === 'number' ? state.version : 0;
        if (version < lastAppliedVersionRef.current) return;
        lastAppliedVersionRef.current = version;

        if (isLocal) return;

        console.log(
          `📡 [MusicPlayer] Sync - song: ${state.songMeta?.title || 'Unknown'}, playing: ${state.isPlaying}, pos: ${syncedPos?.toFixed(1) || state.position}`
        );

        isSyncingRef.current = true;

        const meta = state.songMeta ?? { title: 'Unknown', artist: '', thumbnail: '' };
        const nextTime = syncedPos ?? state.position;

        setCurrentSong((prev) => {
          const isSameSong = prev?.id === state.songId;
          if (!isSameSong) {
            setDuration(0);
            forcePlayerReload();
            // Store the position to apply after player is ready
            pendingSyncPositionRef.current = nextTime;
          }
          return isSameSong ? prev : {
            id: state.songId,
            title: meta.title,
            artist: meta.artist,
            thumbnail: meta.thumbnail,
          };
        });

        setIsPlaying(state.isPlaying);
        setCurrentTime(nextTime);

        // Try to seek immediately if player is ready
        if (playerRef.current) {
          const local = playerRef.current.getCurrentTime?.();
          const shouldForceSeek =
            !hasInitialSyncedRef.current ||
            (typeof local === 'number' && Math.abs(local - nextTime) > 2);

          if (shouldForceSeek) {
            console.log(`⏩ [MusicPlayer] Seeking to synced position: ${nextTime.toFixed(1)}s`);
            playerRef.current.seekTo(nextTime, true);
            hasInitialSyncedRef.current = true;
            pendingSyncPositionRef.current = null;
          }
        } else {
          // Player not ready yet, store for later
          pendingSyncPositionRef.current = nextTime;
        }

        if (state.volume !== volume) {
          setVolumeState(state.volume);
        }

        setTimeout(() => {
          isSyncingRef.current = false;
        }, 400);
      }
    );

    return () => {
      hasInitialSyncedRef.current = false;
      pendingSyncPositionRef.current = null;
      unsub();
    };
  }, [inRoom, activeRoomId, volume, forcePlayerReload]);

  // Apply pending sync position when player becomes ready
  useEffect(() => {
    if (playerReady && pendingSyncPositionRef.current !== null && inRoom) {
      const pos = pendingSyncPositionRef.current;
      console.log(`⏩ [MusicPlayer] Applying pending sync position: ${pos.toFixed(1)}s`);
      playerRef.current?.seekTo(pos, true);
      hasInitialSyncedRef.current = true;
      pendingSyncPositionRef.current = null;
    }
  }, [playerReady, inRoom]);

  /* ================= FIREBASE → CONTEXT (Room Queue) ================= */
  useEffect(() => {
    if (!inRoom || !activeRoomId) return;

    const unsub = roomQueueService.subscribe(activeRoomId, (items) => {
      setRoomQueue(items);
    });

    return () => unsub();
  }, [inRoom, activeRoomId]);

  const recPrefetchSongIdRef = useRef<string | null>(null);

  /* ================= PLAYER PROGRESS ================= */
  useEffect(() => {
    if (!playerRef.current || !isPlaying || !playerReady) return;

    const id = setInterval(() => {
      const t = playerRef.current?.getCurrentTime?.();
      if (typeof t === 'number') setCurrentTime(t);
    }, 250);

    return () => clearInterval(id);
  }, [isPlaying, playerReady]);

  /* ================= RECOMMENDATION QUEUE LOGIC ================= */
  const fetchRecommendationsForSong = useCallback(async (song: Song) => {
    // Don't fetch if already loading
    if (isLoadingRecommendations) return;
    
    // Only fetch for home/search playback
    if (playbackSource !== 'home' && playbackSource !== 'search') {
      console.log('⏭️ [Recommendations] Skipping - not in home/search mode');
      return;
    }

    setIsLoadingRecommendations(true);
    setRecommendationSlow(false);
    setRecommendationError(null);
    setRecommendationSource(null);

    try {
      const result = await fetchRecommendations(song.title, song.artist);
      if (result.songs.length > 0) {
        setRecommendationQueue(result.songs);
        setRecommendationSlow(result.slow);
        setRecommendationSource(result.source || null);
        console.log(`✅ [Recommendations] Got ${result.songs.length} songs (source: ${result.source})`);
      } else if (result.error) {
        setRecommendationError(result.error);
        setRecommendationSource(result.source || null);
      }
    } catch (e: any) {
      console.error('Failed to fetch recommendations:', e);
      setRecommendationError(e.message || 'Failed to fetch recommendations');
    } finally {
      setIsLoadingRecommendations(false);
    }
  }, [isLoadingRecommendations, playbackSource]);

  /* ================= RECOMMENDATION PREFETCH ================= */
  useEffect(() => {
    if (inRoom) return;
    if (!currentSong) return;
    if (playbackSource !== 'home' && playbackSource !== 'search') return;
    if (!duration || !currentTime) return;
    if (isLoadingRecommendations) return;
    if (recommendationQueue.length > 0) return;

    const remaining = duration - currentTime;
    if (remaining > 25) return;

    if (recPrefetchSongIdRef.current === currentSong.id) return;
    recPrefetchSongIdRef.current = currentSong.id;

    fetchRecommendationsForSong(currentSong);
  }, [
    inRoom,
    currentSong,
    playbackSource,
    duration,
    currentTime,
    isLoadingRecommendations,
    recommendationQueue.length,
    fetchRecommendationsForSong,
  ]);

  // Refresh recommendations manually

  // Refresh recommendations manually
  const refreshRecommendations = useCallback(() => {
    if (currentSong && (playbackSource === 'home' || playbackSource === 'search')) {
      setRecommendationQueue([]);
      setRecommendationSource(null);
      fetchRecommendationsForSong(currentSong);
    }
  }, [currentSong, playbackSource, fetchRecommendationsForSong]);

  // Play a song from recommendations
  const playRecommendedSong = useCallback((song: Song) => {
    // Remove the selected song from queue and play it
    setRecommendationQueue(prev => prev.filter(s => s.id !== song.id));
    
    if (currentSong) playHistoryRef.current.push(currentSong);
    
    setDuration(0);
    setCurrentTime(0);
    setCurrentSong(song);
    setIsPlaying(true);

    // Fetch more recommendations if queue is getting low
    setTimeout(() => {
      if (recommendationQueue.length <= 2) {
        fetchRecommendationsForSong(song);
      }
    }, 500);
  }, [currentSong, recommendationQueue.length, fetchRecommendationsForSong]);

  // Determine if user can skip to next
  const canSkipNext = useMemo(() => {
    if (inRoom) return roomQueue.length > 0;
    if (queue.length > 0) return true;
    return recommendationQueue.length > 0 || !isLoadingRecommendations;
  }, [inRoom, roomQueue.length, queue.length, recommendationQueue.length, isLoadingRecommendations]);

  /* ================= ACTIONS ================= */

  const playSong = useCallback(
    (song: Song, source: PlaybackSource = null) => {
      if (inRoom && activeRoomId && activeUserId) {
        // Trigger floating animation
        setFloatingQueueSong(song);
        setShowFloatingAnimation(true);
        
        void roomQueueService
          .addSong(activeRoomId, activeUserId, song)
          .catch((err) => {
            console.error('❌ [MusicPlayer] Failed to add to room queue:', err);
            toast.error('Could not add to room queue');
          });
        return;
      }

      // Set playback source
      setPlaybackSource(source);
      
      // IMPORTANT: Clear the queue when user selects a song from home/search
      // This ensures recommendations will be used instead of old playlist songs
      if (source === 'home' || source === 'search') {
        setQueueState([]);
      }
      
      // Clear recommendation queue when user manually selects a song
      setRecommendationQueue([]);
      setRecommendationError(null);
      setRecommendationSource(null);
      recPrefetchSongIdRef.current = null; // Reset prefetch tracker
      
      // Reset states and start playing
      setDuration(0);
      setCurrentTime(0);
      setCurrentSong(song);
      setIsPlaying(true);

      // Fetch recommendations IMMEDIATELY for this song (only for home/search)
      if (source === 'home' || source === 'search') {
        // Start fetching immediately - don't wait
        setIsLoadingRecommendations(true);
        fetchRecommendations(song.title, song.artist)
          .then((result) => {
            if (result.songs.length > 0) {
              setRecommendationQueue(result.songs);
              setRecommendationSlow(result.slow);
              setRecommendationSource(result.source || null);
              console.log(`✅ [Recommendations] Got ${result.songs.length} songs (source: ${result.source})`);
            } else if (result.error) {
              setRecommendationError(result.error);
              setRecommendationSource(result.source || null);
            }
          })
          .catch((e) => {
            console.error('Failed to fetch recommendations:', e);
            setRecommendationError(e.message || 'Failed to fetch recommendations');
          })
          .finally(() => {
            setIsLoadingRecommendations(false);
          });
      }
    },
    [inRoom, activeRoomId, activeUserId]
  );

  const playSongInRoom = useCallback(
    (song: Song) => {
      if (!inRoom || !activeRoomId || !activeUserId) return;

      forcePlayerReload();
      setCurrentSong(song);
      setIsPlaying(true);
      setCurrentTime(0);

      void roomPlaybackService
        .playSong(activeRoomId, activeUserId, song.id, {
          title: song.title,
          artist: song.artist,
          thumbnail: song.thumbnail,
        }, volume)
        .catch((err) => {
          console.error('❌ [MusicPlayer] Failed to play in room:', err);
          toast.error('Room playback failed');
        });
    },
    [inRoom, activeRoomId, activeUserId, volume, forcePlayerReload]
  );

  const addToRoomQueue = useCallback(
    (song: Song) => {
      if (!inRoom || !activeRoomId || !activeUserId) return;

      void roomQueueService
        .addSong(activeRoomId, activeUserId, song)
        .then(() => toast.success('Added to room queue'))
        .catch((err) => {
          console.error('❌ [MusicPlayer] Failed to add to room queue:', err);
          toast.error('Could not add to room queue');
        });
    },
    [inRoom, activeRoomId, activeUserId]
  );

  const playRoomQueueItem = useCallback(
    (itemId: string) => {
      if (!inRoom || !activeRoomId || !activeUserId) return;

      const item = roomQueue.find((i) => i.itemId === itemId);
      if (!item) return;

      const song = item.song;

      forcePlayerReload();
      setCurrentSong(song);
      setIsPlaying(true);
      setCurrentTime(0);

      void roomPlaybackService
        .playSong(activeRoomId, activeUserId, song.id, {
          title: song.title,
          artist: song.artist,
          thumbnail: song.thumbnail,
        }, volume)
        .catch((err) => {
          console.error('❌ [MusicPlayer] Failed to play queued item:', err);
          toast.error('Room playback failed');
        });

      void roomQueueService.removeItem(activeRoomId, itemId).catch(console.error);
    },
    [inRoom, activeRoomId, activeUserId, roomQueue, volume, forcePlayerReload]
  );

  const pauseSong = useCallback(() => {
    if (isSyncingRef.current) return;

    if (inRoom && activeRoomId && activeUserId) {
      const pos = playerRef.current?.getCurrentTime?.() ?? currentTime;
      setIsPlaying(false);

      void roomPlaybackService.pause(activeRoomId, activeUserId, pos).catch(console.error);
      return;
    }

    setIsPlaying(false);
  }, [inRoom, activeRoomId, activeUserId, currentTime]);

  const resumeSong = useCallback(() => {
    if (isSyncingRef.current) return;

    if (inRoom && activeRoomId && activeUserId) {
      const pos = playerRef.current?.getCurrentTime?.() ?? currentTime;
      setIsPlaying(true);

      void roomPlaybackService.resume(activeRoomId, activeUserId, pos).catch(console.error);
      return;
    }

    setIsPlaying(true);
  }, [inRoom, activeRoomId, activeUserId, currentTime]);

  const seekTo = useCallback(
    (time: number) => {
      if (isSyncingRef.current) return;

      if (playerRef.current) {
        playerRef.current.seekTo(time, true);
        setCurrentTime(time);
      }

      if (inRoom && activeRoomId && activeUserId) {
        void roomPlaybackService.seek(activeRoomId, activeUserId, time, isPlaying).catch(console.error);
      }
    },
    [inRoom, activeRoomId, activeUserId, isPlaying]
  );

  const playHistoryRef = useRef<Song[]>([]);

  const nextSong = useCallback(() => {
    // Room mode: ONLY play from room queue
    if (inRoom) {
      if (roomQueue.length > 0) {
        playRoomQueueItem(roomQueue[0].itemId);
      } else {
        setIsPlaying(false);
        toast.info('Queue empty - add songs to continue');
      }
      return;
    }

    // Playlist mode (queue has songs)
    if (queue.length > 0) {
      const currentIndex = queue.findIndex((s) => s.id === currentSong?.id);
      let nextIndex = currentIndex + 1;

      if (shuffle) {
        nextIndex = Math.floor(Math.random() * queue.length);
      } else if (nextIndex >= queue.length) {
        if (repeat === 'all') {
          nextIndex = 0;
        } else {
          setIsPlaying(false);
          return;
        }
      }

      if (currentSong) playHistoryRef.current.push(currentSong);
      setDuration(0);
      setCurrentTime(0);
      setCurrentSong(queue[nextIndex]);
      setIsPlaying(true);
      return;
    }

    // Solo mode: use recommendation queue
    if (recommendationQueue.length > 0) {
      const nextSongFromQueue = recommendationQueue[0];
      const remainingQueue = recommendationQueue.slice(1);
      
      if (currentSong) playHistoryRef.current.push(currentSong);
      
      setDuration(0);
      setCurrentTime(0);
      setCurrentSong(nextSongFromQueue);
      setRecommendationQueue(remainingQueue);
      setRecommendationSource(null);
      setIsPlaying(true);

      // If queue is getting low (<=1), fetch more recommendations
      if (remainingQueue.length <= 1) {
        setTimeout(() => fetchRecommendationsForSong(nextSongFromQueue), 500);
      }
      return;
    }

    // No queue, no recommendations - fetch recommendations
    if (currentSong && !isLoadingRecommendations) {
      playHistoryRef.current.push(currentSong);
      toast.info('Fetching next songs...');
      fetchRecommendationsForSong(currentSong);
    }
  }, [inRoom, roomQueue, playRoomQueueItem, queue, currentSong, shuffle, repeat, recommendationQueue, fetchRecommendationsForSong, isLoadingRecommendations]);

  const prevSong = useCallback(() => {
    if (inRoom) {
      toast.info('Previous not available in rooms');
      return;
    }

    if (playHistoryRef.current.length > 0) {
      const prevTrack = playHistoryRef.current.pop();
      if (prevTrack) {
        setDuration(0);
        setCurrentTime(0);
        setCurrentSong(prevTrack);
        setIsPlaying(true);
        return;
      }
    }

    if (queue.length > 0) {
      const currentIndex = queue.findIndex((s) => s.id === currentSong?.id);
      let prevIndex = currentIndex - 1;

      if (prevIndex < 0) {
        if (repeat === 'all') {
          prevIndex = queue.length - 1;
        } else {
          return;
        }
      }

      setDuration(0);
      setCurrentTime(0);
      setCurrentSong(queue[prevIndex]);
      setIsPlaying(true);
    }
  }, [inRoom, queue, currentSong, repeat]);

  const addToQueue = useCallback((song: Song) => {
    setQueueState((prev) => [...prev, song]);
  }, []);

  const setQueue = useCallback((songs: Song[], source: PlaybackSource = 'playlist') => {
    setQueueState(songs);
    setPlaybackSource(source);
    // Clear recommendation queue when entering playlist mode
    setRecommendationQueue([]);
  }, []);

  const clearQueue = useCallback(() => {
    setQueueState([]);
  }, []);

  const stopMusic = useCallback(() => {
    setCurrentSong(null);
    setIsPlaying(false);
    setQueueState([]);
    setCurrentTime(0);
    setDuration(0);
    setRoomQueue([]);
    setRecommendationQueue([]);
    setRecommendationSource(null);
    playHistoryRef.current = [];
  }, []);

  // Play a song from the playlist queue (for up-next jump)
  const playQueueSong = useCallback((song: Song) => {
    const songIndex = queue.findIndex(s => s.id === song.id);
    if (songIndex === -1) return;
    
    if (currentSong) playHistoryRef.current.push(currentSong);
    
    setDuration(0);
    setCurrentTime(0);
    setCurrentSong(song);
    setIsPlaying(true);
  }, [queue, currentSong]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((prev) => !prev);
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeat((prev) => (prev === 'off' ? 'all' : 'off'));
  }, []);

  const updateDuration = useCallback(() => {
    if (playerRef.current) {
      const d = playerRef.current.getDuration?.();
      if (d && !isNaN(d) && d > 0) {
        setDuration(d);
      }
    }
  }, []);

  // Expose playerKey through playerRef for NowPlaying to use
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current._playerKey = playerKey;
    }
  }, [playerKey]);

  return (
    <MusicPlayerContext.Provider
      value={{
        currentSong,
        isPlaying,
        queue,
        currentTime,
        duration,
        volume,
        shuffle,
        repeat,
        activeRoomId,
        recommendationQueue,
        isLoadingRecommendations,
        recommendationSlow,
        recommendationError,
        recommendationSource,
        playbackSource,
        canSkipNext,
        audioOnlyMode,
        setAudioOnlyMode,
        playQueueSong,
        floatingQueueSong,
        showFloatingAnimation,
        clearFloatingAnimation,
        playSong,
        playSongInRoom,
        addToRoomQueue,
        playRoomQueueItem,
        pauseSong,
        resumeSong,
        nextSong,
        prevSong,
        addToQueue,
        setQueue,
        clearQueue,
        seekTo,
        setVolume,
        toggleShuffle,
        toggleRepeat,
        stopMusic,
        playerRef,
        updateDuration,
        setPlayerReady,
        setActiveRoom,
        roomQueue,
        forcePlayerReload,
        playRecommendedSong,
        refreshRecommendations,
      }}
    >
      {children}
    </MusicPlayerContext.Provider>
  );
};
