import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Shuffle,
  Repeat,
  Plus,
  Loader2,
  ChevronUp,
  ChevronDown,
  Music2,
  Disc3,
  Headphones,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { useAuth } from '@/contexts/AuthContext';
import YouTube, { YouTubeProps } from 'react-youtube';
import AddToPlaylistModal from './AddToPlaylistModal';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function NowPlaying() {
  const { currentUser } = useAuth();
  const {
    currentSong,
    isPlaying,
    nextSong,
    prevSong,
    pauseSong,
    resumeSong,
    currentTime,
    duration,
    seekTo,
    volume,
    setVolume,
    shuffle,
    toggleShuffle,
    repeat,
    toggleRepeat,
    playerRef,
    updateDuration,
    setPlayerReady,
    activeRoomId,
    roomQueue,
    stopMusic,
    isLoadingRecommendations,
    recommendationSlow,
    recommendationQueue,
    recommendationError,
    recommendationSource,
    refreshRecommendations,
    queue,
    playbackSource,
    playRecommendedSong,
    playQueueSong,
    audioOnlyMode,
    setAudioOnlyMode,
  } = useMusicPlayer();

  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  // Track the last displayed song so player bar never disappears
  const [displayedSong, setDisplayedSong] = useState<typeof currentSong>(null);

  // Audio-only fallback refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const isDesktop = typeof navigator !== 'undefined' && !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const inRoom = Boolean(activeRoomId);

  const isMobileRef = useRef<boolean>(
    typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );

  const applyingRemoteUpdateRef = useRef(false);
  const hasTriggeredInitialSync = useRef(false);
  const durationPollRef = useRef<NodeJS.Timeout | null>(null);
  const backgroundWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const endTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // User intent tracking (prevents "auto-resume" fighting OS pause controls)
  const userPausedRef = useRef(false);
  const lastPlayRequestAtRef = useRef(0);

  const forceResumeAttemptsRef = useRef(0);
  const autoplayBlockedRef = useRef(false);
  const prevUserRef = useRef(currentUser);
  const hasTriggeredNextRef = useRef(false);
  const lastVideoIdRef = useRef<string | null>(null);

  // Stop music and hide player on logout
  useEffect(() => {
    if (prevUserRef.current && !currentUser) {
      stopMusic();
      setDisplayedSong(null); // Clear player bar on logout
    }
    prevUserRef.current = currentUser;
  }, [currentUser, stopMusic]);

  // Force player reload when song changes to fix audio/video mismatch
  useEffect(() => {
    if (currentSong?.id && currentSong.id !== lastVideoIdRef.current) {
      console.log(
        `🔄 [Player] Song changed: ${lastVideoIdRef.current?.slice(0, 8) || 'none'} → ${currentSong.id.slice(0, 8)}`
      );
      lastVideoIdRef.current = currentSong.id;
      setPlayerKey((prev) => prev + 1);
      hasTriggeredNextRef.current = false;
      hasTriggeredInitialSync.current = false;
      forceResumeAttemptsRef.current = 0;
      autoplayBlockedRef.current = false;
      userPausedRef.current = false;
      lastPlayRequestAtRef.current = Date.now();

      if (endTimeoutRef.current) {
        clearTimeout(endTimeoutRef.current);
        endTimeoutRef.current = null;
      }

      // Update displayed song when there's a real song
      setDisplayedSong(currentSong);
    }
  }, [currentSong?.id]);

  // Keep displayedSong in sync with currentSong when available
  useEffect(() => {
    if (currentSong) {
      setDisplayedSong(currentSong);
    }
    // Note: We intentionally DON'T clear displayedSong when currentSong becomes null
    // This keeps the player bar visible with the last played song
  }, [currentSong]);

  /* ================= MEDIA SESSION (BACKGROUND FIX) ================= */
  useEffect(() => {
    if (!currentSong || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title,
      artist: currentSong.artist,
      album: 'SoulSync',
      artwork: [
        { src: currentSong.thumbnail, sizes: '96x96', type: 'image/jpeg' },
        { src: currentSong.thumbnail, sizes: '128x128', type: 'image/jpeg' },
        { src: currentSong.thumbnail, sizes: '192x192', type: 'image/jpeg' },
        { src: currentSong.thumbnail, sizes: '512x512', type: 'image/jpeg' },
      ],
    });

    // Important: call the YouTube player directly inside the handler so the OS "play" gesture works.
    navigator.mediaSession.setActionHandler('play', () => {
      userPausedRef.current = false;
      lastPlayRequestAtRef.current = Date.now();
      resumeSong();
      try {
        playerRef.current?.playVideo?.();
      } catch {}
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      userPausedRef.current = true;
      pauseSong();
      try {
        playerRef.current?.pauseVideo?.();
      } catch {}
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextSong());

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      seekTo(Math.max(0, currentTime - skipTime));
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      seekTo(Math.min(duration, currentTime + skipTime));
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) seekTo(details.seekTime);
    });
  }, [currentSong?.id, resumeSong, pauseSong, prevSong, nextSong, seekTo, duration, currentTime, playerRef]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: duration,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      });
    } catch (e) {}
  }, [currentTime, duration]);

  /* ================= AUDIO-ONLY FALLBACK MODE ================= */
  // When enabled on desktop, fetch audio stream for reliable background playback
  useEffect(() => {
    if (!isDesktop || !audioOnlyMode || !currentSong || inRoom) {
      // Cleanup audio if mode disabled or no song
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
        audioUrlRef.current = null;
      }
      return;
    }

    const fetchAudioStream = async () => {
      try {
        // Use yt-dlp backend to get audio URL
        const response = await fetch('https://35.209.154.134.sslip.io/audio-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId: currentSong.id }),
        });

        if (!response.ok) {
          console.log('🎧 [Audio-Only] Could not fetch audio stream, falling back to YouTube');
          return;
        }

        const data = await response.json();
        if (!data.audioUrl) return;

        // Create or reuse audio element
        if (!audioRef.current) {
          audioRef.current = new Audio();
          audioRef.current.volume = volume / 100;
          
          // Handle audio end - advance to next song
          audioRef.current.onended = () => {
            if (!hasTriggeredNextRef.current) {
              hasTriggeredNextRef.current = true;
              console.log('🎧 [Audio-Only] Track ended, advancing...');
              nextSong();
            }
          };

          // Sync time updates with context
          audioRef.current.ontimeupdate = () => {
            // Optional: could sync currentTime if needed
          };
        }

        audioUrlRef.current = data.audioUrl;
        audioRef.current.src = data.audioUrl;
        
        // Sync with current playback state
        if (isPlaying) {
          audioRef.current.play().catch(() => {
            console.log('🎧 [Audio-Only] Autoplay blocked for audio');
          });
        }

        console.log('🎧 [Audio-Only] Audio stream ready for background playback');
      } catch (err) {
        console.log('🎧 [Audio-Only] Error fetching audio:', err);
      }
    };

    fetchAudioStream();

    return () => {
      // Don't cleanup on every effect - only when song changes or mode disables
    };
  }, [currentSong?.id, audioOnlyMode, isDesktop, inRoom]);

  // Sync audio-only element with play/pause state
  useEffect(() => {
    if (!audioRef.current || !audioOnlyMode || !isDesktop) return;

    if (isPlaying) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, audioOnlyMode, isDesktop]);

  // Sync audio-only volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  // Sync audio-only seek
  useEffect(() => {
    if (!audioRef.current || !audioOnlyMode || !isDesktop) return;
    
    // Only seek if there's a significant difference
    if (Math.abs(audioRef.current.currentTime - currentTime) > 2) {
      audioRef.current.currentTime = currentTime;
    }
  }, [currentTime, audioOnlyMode, isDesktop]);

  /* ================= BACKGROUND WATCHDOG ================= */
  // Best-effort background next-track detection.
  // NOTE: Browsers/YouTube may throttle timers/events in background tabs, so this can't be 100% Spotify-like.
  useEffect(() => {
    if (backgroundWatchdogRef.current) {
      clearInterval(backgroundWatchdogRef.current);
      backgroundWatchdogRef.current = null;
    }

    // If audio-only mode is on, rely on the audio element's onended event instead
    if (audioOnlyMode && isDesktop && !inRoom) {
      return;
    }

    if (!playerRef.current) return;

    backgroundWatchdogRef.current = setInterval(() => {
      if (!playerRef.current) return;

      const state = playerRef.current.getPlayerState?.();
      const ct = playerRef.current.getCurrentTime?.();
      const d = playerRef.current.getDuration?.();

      // Handle ended state (0) OR time-based end detection
      if (
        (state === 0 || (typeof ct === 'number' && typeof d === 'number' && d > 0 && ct >= d - 0.75)) &&
        !hasTriggeredNextRef.current
      ) {
        hasTriggeredNextRef.current = true;
        console.log('🔄 [BG Watchdog] Song ended, advancing...');
        nextSong();
      }
    }, 1000);

    return () => {
      if (backgroundWatchdogRef.current) {
        clearInterval(backgroundWatchdogRef.current);
        backgroundWatchdogRef.current = null;
      }
    };
  }, [nextSong, playerRef, audioOnlyMode, isDesktop, inRoom]);

  /* ================= YOUTUBE PLAYER HANDLERS ================= */
  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    playerRef.current = event.target;
    setPlayerReady(true);
    event.target.setVolume(volume);
    hasTriggeredInitialSync.current = false;
    forceResumeAttemptsRef.current = 0;
    autoplayBlockedRef.current = false;
    hasTriggeredNextRef.current = false;

    if (durationPollRef.current) clearInterval(durationPollRef.current);
    durationPollRef.current = setInterval(() => {
      const d = playerRef.current?.getDuration?.();
      if (d && d > 0 && !isNaN(d)) {
        updateDuration();
        if (durationPollRef.current) clearInterval(durationPollRef.current);
      }
    }, 300);
  };

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    if (applyingRemoteUpdateRef.current) return;
    const player = event.target;

    if (event.data === 1) {
      // Playing state - success
      setTimeout(() => updateDuration(), 200);
      forceResumeAttemptsRef.current = 0;
      autoplayBlockedRef.current = false;
      // IMPORTANT: Only reset hasTriggeredNextRef when a NEW song starts playing
      // Don't reset it here as it can cause multiple next triggers
      
      // Schedule a best-effort "end" timeout (helps when onEnd event is delayed in background)
      try {
        if (endTimeoutRef.current) {
          clearTimeout(endTimeoutRef.current);
          endTimeoutRef.current = null;
        }

        const d = player.getDuration?.();
        const ct = player.getCurrentTime?.();
        if (typeof d === 'number' && typeof ct === 'number' && d > 0) {
          const ms = Math.max(0, (d - ct) * 1000 + 1000); // Added buffer to prevent premature triggers
          const songIdAtSchedule = currentSong?.id;

          endTimeoutRef.current = setTimeout(() => {
            // Only act if we're still on the same song
            if (!playerRef.current) return;
            if (currentSong?.id !== songIdAtSchedule) return;

            const stateNow = playerRef.current.getPlayerState?.();
            const ctNow = playerRef.current.getCurrentTime?.();
            const dNow = playerRef.current.getDuration?.();

            if (
              (stateNow === 0 ||
                (typeof ctNow === 'number' &&
                  typeof dNow === 'number' &&
                  dNow > 0 &&
                  ctNow >= dNow - 0.5)) &&
              !hasTriggeredNextRef.current
            ) {
              hasTriggeredNextRef.current = true;
              console.log('⏭️ [End Timeout] Advancing to next...');
              nextSong();
            }
          }, ms);
        }
      } catch {}

      if (!hasTriggeredInitialSync.current) {
        hasTriggeredInitialSync.current = true;
      }
    }

    // If YouTube pauses while we expect playing, try ONE resume only when it looks like autoplay was blocked.
    // Never fight explicit user pause (notification controls) or background/OS pauses.
    if (event.data === 2 && isPlaying && !inRoom) {
      const looksLikeAutoplayBlock = Date.now() - lastPlayRequestAtRef.current < 2000;

      if (userPausedRef.current || !looksLikeAutoplayBlock) {
        pauseSong();
        return;
      }

      if (autoplayBlockedRef.current) {
        // Already tried once - just sync UI to paused state
        pauseSong();
        return;
      }

      autoplayBlockedRef.current = true;
      console.log('⛔️ [Player] Autoplay likely blocked. Trying ONE resume...');

      // Single resume attempt after short delay
      setTimeout(() => {
        if (!playerRef.current || !isPlaying) return;
        if (userPausedRef.current) return;

        const state = playerRef.current.getPlayerState?.();
        if (state !== 2) {
          autoplayBlockedRef.current = false;
          return;
        }

        try {
          playerRef.current.playVideo?.();
        } catch {}

        // Check result after 400ms
        setTimeout(() => {
          const after = playerRef.current?.getPlayerState?.();
          if (after === 2) {
            // Still paused - give up, let user click play
            pauseSong();
          } else {
            autoplayBlockedRef.current = false;
          }
        }, 400);
      }, 200);
    }

    if (event.data === 0 && !hasTriggeredNextRef.current) {
      // Ended state - only trigger once per song
      hasTriggeredNextRef.current = true;
      console.log('🎵 [Player] Song ended, advancing to next...');

      if (repeat === 'one') {
        player.seekTo(0, true);
        setTimeout(() => player.playVideo(), 100);
      } else {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
        nextSong();
      }
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!playerRef.current) return;

      if (document.visibilityState === 'visible') {
        setTimeout(() => {
          if (!playerRef.current) return;

          const state = playerRef.current.getPlayerState?.();
          const ct = playerRef.current.getCurrentTime?.();
          const d = playerRef.current.getDuration?.();

          // If we effectively reached the end while backgrounded, advance immediately.
          if (isPlaying && typeof ct === 'number' && typeof d === 'number' && d > 0 && ct >= d - 1) {
            nextSong();
            return;
          }

          // If a track ended while we were backgrounded, advance on return
          if (state === 0 && isPlaying) {
            nextSong();
            return;
          }

          // Avoid repeated auto-resume loops; user gesture should handle it.
          if (autoplayBlockedRef.current) return;
        }, 200);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying, nextSong]);

  /* ================= REMOTE & VOLUME SYNC ================= */
  useEffect(() => {
    if (!playerRef.current) return;
    applyingRemoteUpdateRef.current = true;

    if (isPlaying) {
      // We requested play (helps distinguish autoplay-block vs background pause)
      lastPlayRequestAtRef.current = Date.now();
      userPausedRef.current = false;
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }

    setTimeout(() => {
      applyingRemoteUpdateRef.current = false;
    }, 350);
  }, [isPlaying]);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Use displayedSong for UI (never disappears), currentSong for player (may be null)
  const songToShow = displayedSong || currentSong;
  
  // Don't render if we've never had a song
  if (!songToShow) return null;

  // Determine what to show in "Up Next" based on playback source
  const getUpcomingSongs = () => {
    // In room mode - never show recommendations
    if (inRoom) {
      return { songs: roomQueue.map(q => q.song).slice(0, 5), source: 'room' as const };
    }
    
    // Playlist mode - show queue
    if (playbackSource === 'playlist' && queue.length > 0 && songToShow) {
      const currentIndex = queue.findIndex((s) => s.id === songToShow.id);
      return { 
        songs: queue.slice(currentIndex + 1, currentIndex + 6), 
        source: 'playlist' as const 
      };
    }
    
    // Home/Search mode - show recommendations
    if (playbackSource === 'home' || playbackSource === 'search') {
      return { songs: recommendationQueue.slice(0, 5), source: 'recommendations' as const };
    }
    
    return { songs: [], source: 'none' as const };
  };

  const { songs: upcomingSongs, source: upcomingSource } = getUpcomingSongs();
  const showUpNextButton =
    !inRoom &&
    (upcomingSource === 'recommendations'
      ? playbackSource === 'home' || playbackSource === 'search'
      : upcomingSongs.length > 0);

  const opts: YouTubeProps['opts'] = {
    height: '1',
    width: '1',
    playerVars: { autoplay: 1, controls: 0 },
  };

  /* ================= UI RENDER ================= */
  return (
    <>
      {/* Hidden Player Box - key forces remount on song change */}
      {currentSong && (
        <div style={{ position: 'absolute', opacity: 0.001, pointerEvents: 'none' }}>
          <YouTube
            key={`yt-${currentSong.id}-${playerKey}`}
            videoId={currentSong.id}
            opts={opts}
            onReady={onPlayerReady}
            onStateChange={onPlayerStateChange}
          />
        </div>
      )}

      <div className="fixed bottom-12 left-0 right-0 bg-sidebar border-t border-sidebar-border z-30">
        {/* Upcoming songs panel - shows above the player */}
        {showUpcoming && (showUpNextButton || isLoadingRecommendations) && (
          <div className="bg-card/95 backdrop-blur border-b border-border p-3 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Disc3 className="w-3 h-3" />
                <span>
                  {upcomingSource === 'recommendations'
                    ? 'Recommended Next'
                    : upcomingSource === 'playlist'
                      ? 'Up Next in Playlist'
                      : upcomingSource === 'room'
                        ? 'Room Queue'
                        : 'Up Next'}
                </span>
                {/* Show recommendation source */}
                {upcomingSource === 'recommendations' && recommendationSource && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded">
                    {recommendationSource}
                  </span>
                )}
              </div>
            </div>
            
            {upcomingSongs.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {upcomingSongs.map((song, i) => (
                  <div
                    key={`${song.id}-${i}`}
                    className="flex-shrink-0 w-20 cursor-pointer group"
                    onClick={() => {
                      if (upcomingSource === 'recommendations') {
                        playRecommendedSong(song);
                      } else if (upcomingSource === 'playlist') {
                        playQueueSong(song);
                      }
                    }}
                  >
                    <img
                      src={song.thumbnail}
                      alt={song.title}
                      className="w-20 h-20 rounded object-cover group-hover:ring-2 ring-primary transition-all"
                    />
                    <p className="text-[10px] truncate mt-1 group-hover:text-primary transition-colors">
                      {song.title}
                    </p>
                  </div>
                ))}
              </div>
            ) : isLoadingRecommendations && upcomingSource === 'recommendations' ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <span>Finding similar songs...</span>
              </div>
            ) : upcomingSource === 'recommendations' ? (
              <div className="flex items-center justify-between gap-3 py-3 text-xs text-muted-foreground">
                <span className="truncate">
                  {recommendationError || 'No recommendations yet.'}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => refreshRecommendations()}
                  className="shrink-0"
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                <span>Nothing queued.</span>
              </div>
            )}
          </div>
        )}

        {/* Progress Slider */}
        <div className="px-3 pt-1.5">
          <Slider
            value={[currentTime]}
            min={0}
            max={duration || 100}
            step={0.1}
            onValueChange={([value]) => {
              if (!applyingRemoteUpdateRef.current) seekTo(value);
            }}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Loading indicator removed from player bar - now only inside the up next tab */}

        {/* Mobile View */}
        <div className="px-3 py-1.5 md:hidden">
          <div className="flex items-center gap-2">
            <img
              src={songToShow.thumbnail}
              alt={songToShow.title}
              className="w-10 h-10 rounded object-cover shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-xs truncate">{songToShow.title}</h4>
              <p className="text-[10px] text-muted-foreground truncate">{songToShow.artist}</p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Up Next button - hide in rooms */}
              {!inRoom && showUpNextButton && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setShowUpcoming(!showUpcoming)} 
                  className="h-8 w-8"
                  title="Show next songs"
                >
                  {showUpcoming ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={prevSong} disabled={inRoom} className="h-8 w-8">
                <SkipBack className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (isPlaying) {
                    userPausedRef.current = true;
                    pauseSong();
                  } else {
                    userPausedRef.current = false;
                    lastPlayRequestAtRef.current = Date.now();
                    resumeSong();
                  }
                }}
                className="h-8 w-8"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={nextSong}
                disabled={inRoom && roomQueue.length === 0}
                className="h-8 w-8"
              >
                <SkipForward className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPlaylistModal(true)}
                className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {inRoom && (
            <div className="mt-0.5 text-center">
              <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                🎵 Room • {roomQueue.length} queued
              </span>
            </div>
          )}
        </div>

        {/* Desktop View */}
        <div className="hidden md:flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4 flex-1">
            <img src={songToShow.thumbnail} alt="" className="w-14 h-14 rounded object-cover" />
            <div className="min-w-0">
              <h4 className="font-semibold truncate">{songToShow.title}</h4>
              <p className="text-sm text-muted-foreground truncate">{songToShow.artist}</p>
            </div>
            {inRoom && (
              <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded-full shrink-0">
                🎵 In Room
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-1 justify-center">
            <Button onClick={toggleShuffle} variant="ghost" size="icon" className={shuffle ? 'text-primary' : ''}>
              <Shuffle className="w-5 h-5" />
            </Button>
            <Button onClick={prevSong} variant="ghost" size="icon">
              <SkipBack className="w-5 h-5" />
            </Button>
            <Button
              onClick={() => {
                if (isPlaying) {
                  userPausedRef.current = true;
                  pauseSong();
                } else {
                  userPausedRef.current = false;
                  lastPlayRequestAtRef.current = Date.now();
                  resumeSong();
                }
              }}
              className="w-12 h-12 rounded-full btn-gradient-primary"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
            </Button>
            <Button onClick={nextSong} variant="ghost" size="icon">
              <SkipForward className="w-5 h-5" />
            </Button>
            <Button onClick={toggleRepeat} variant="ghost" size="icon" className={repeat !== 'off' ? 'text-primary' : ''}>
              <Repeat className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-end">
            {/* Audio-only mode toggle (desktop only) */}
            {isDesktop && !inRoom && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setAudioOnlyMode(!audioOnlyMode)}
                      className={audioOnlyMode ? 'text-primary' : 'text-muted-foreground'}
                    >
                      <Headphones className="w-5 h-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">
                      <strong>Audio-only mode</strong><br />
                      {audioOnlyMode 
                        ? 'ON: Background playback enabled. Songs continue when tab is hidden.' 
                        : 'OFF: Enable for reliable background playback when switching tabs.'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {/* Up Next button - hide in rooms */}
            {!inRoom && showUpNextButton && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowUpcoming(!showUpcoming)}
                className={showUpcoming ? 'text-primary' : ''}
                title="Show next songs"
              >
                {isLoadingRecommendations && upcomingSource === 'recommendations' ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Disc3 className="w-5 h-5" />
                )}
              </Button>
            )}
            <Button
              onClick={() => setShowPlaylistModal(true)}
              variant="ghost"
              size="icon"
              className="text-primary"
            >
              <Plus className="w-5 h-5" />
            </Button>
            <div
              className="relative"
              onMouseEnter={() => setShowVolumeSlider(true)}
              onMouseLeave={() => setShowVolumeSlider(false)}
            >
              <Button variant="ghost" size="icon">
                <Volume2 className="w-5 h-5" />
              </Button>
              {showVolumeSlider && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-card p-3 rounded-lg shadow-lg border animate-fade-in">
                  <Slider
                    orientation="vertical"
                    value={[volume]}
                    onValueChange={([v]) => setVolume(v)}
                    min={0}
                    max={100}
                    className="h-24"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add to Playlist Modal */}
      <AddToPlaylistModal
        open={showPlaylistModal}
        onOpenChange={setShowPlaylistModal}
        song={songToShow}
      />
    </>
  );
}
