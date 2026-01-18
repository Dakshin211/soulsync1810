import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music2, Loader2, AlertTriangle, ChevronRight, X, Sparkles, Lock, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { toast } from 'sonner';

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
  sourceArtist?: string;
}

interface PlaylistPreview {
  id: string;
  name: string;
  owner: string;
  total_tracks: number;
  duration: string;
}

interface CreatePlaylistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SPOTIFY_API_BASE = 'https://spotify-backend-3ef1.onrender.com';
const SPOTIFY_REGEX = /^https:\/\/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/;

type ImportStep = 'idle' | 'preview' | 'confirm' | 'options' | 'importing' | 'done';

// Loading messages for animation
const loadingMessages = [
  "Waking up the server...",
  "Connecting to Spotify...",
  "Getting things ready...",
  "Almost there...",
  "Fetching playlist info..."
];

const importingMessages = [
  "Searching for songs...",
  "Matching best versions...",
  "Finding audio sources...",
  "Processing tracks...",
  "Almost done..."
];

export default function CreatePlaylistModal({ open, onOpenChange }: CreatePlaylistModalProps) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  
  // Create playlist state
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  
  // Spotify import state
  const [showSpotifyImport, setShowSpotifyImport] = useState(false);
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [importStep, setImportStep] = useState<ImportStep>('idle');
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [importLimit, setImportLimit] = useState<number | null>(null);
  const [useFullPlaylist, setUseFullPlaylist] = useState(true);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importCancelled, setImportCancelled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [importMessageIndex, setImportMessageIndex] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [importStats, setImportStats] = useState<{
    processed: number;
    imported: number;
    skippedSpotify: number;
    skippedYoutube: number;
  } | null>(null);

  // Animate loading messages
  useEffect(() => {
    if (isLoading || importStep === 'preview') {
      const interval = setInterval(() => {
        setLoadingMessageIndex(prev => (prev + 1) % loadingMessages.length);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [isLoading, importStep]);

  // Animate importing messages
  useEffect(() => {
    if (importStep === 'importing') {
      const interval = setInterval(() => {
        setImportMessageIndex(prev => (prev + 1) % importingMessages.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [importStep]);

  const resetState = () => {
    setNewPlaylistName('');
    setShowSpotifyImport(false);
    setSpotifyUrl('');
    setUrlError('');
    setImportStep('idle');
    setPreview(null);
    setImportLimit(null);
    setUseFullPlaylist(true);
    setImportProgress(0);
    setImportTotal(0);
    setImportCancelled(false);
    setIsLoading(false);
    setLoadingMessageIndex(0);
    setImportMessageIndex(0);
    setRetryCount(0);
    setImportStats(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  // Validate Spotify URL
  const validateSpotifyUrl = (url: string): { valid: boolean; error?: string } => {
    if (!url.trim()) {
      return { valid: false, error: 'Please enter a Spotify playlist URL' };
    }
    if (!SPOTIFY_REGEX.test(url)) {
      return { valid: false, error: 'Invalid Spotify playlist URL. Use format: https://open.spotify.com/playlist/...' };
    }
    return { valid: true };
  };

  // Create playlist (non-Spotify)
  const createPlaylist = async () => {
    if (!currentUser || !newPlaylistName.trim()) return;
    
    setIsCreating(true);
    try {
      const docRef = await addDoc(collection(db, 'Playlists'), {
        name: newPlaylistName,
        userId: currentUser.uid,
        songs: [],
        createdAt: new Date().toISOString(),
        isShared: false
      });
      
      toast.success('Playlist created!');
      handleClose();
      navigate(`/playlist/${docRef.id}`);
    } catch (error) {
      console.error('Error creating playlist:', error);
      toast.error('Failed to create playlist');
    } finally {
      setIsCreating(false);
    }
  };

  // Fetch Spotify preview with retry logic
  const fetchPreview = async (isRetry = false) => {
    const validation = validateSpotifyUrl(spotifyUrl);
    if (!validation.valid) {
      setUrlError(validation.error || '');
      return;
    }
    setUrlError('');
    
    if (!isRetry) {
      setRetryCount(0);
    }
    
    setIsLoading(true);
    setImportStep('preview');
    setLoadingMessageIndex(0);
    
    try {
      const response = await fetch(`${SPOTIFY_API_BASE}/preview-spotify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: spotifyUrl })
      });
      
      if (response.status === 403 || response.status === 401) {
        throw new Error('PRIVATE_PLAYLIST');
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch playlist details');
      }
      
      const data = await response.json();
      
      // Check if playlist is private based on response
      if (data.error?.includes('private') || data.error?.includes('Private')) {
        throw new Error('PRIVATE_PLAYLIST');
      }
      
      setPreview(data.playlist);
      setImportTotal(data.playlist.total_tracks);
      setImportStep('confirm');
    } catch (error: any) {
      console.error('Preview error:', error);
      
      if (error.message === 'PRIVATE_PLAYLIST') {
        setUrlError('This playlist is private. Please make it public on Spotify and try again.');
        setImportStep('idle');
      } else if (retryCount < 2) {
        // Auto-retry logic for transient errors
        setRetryCount(prev => prev + 1);
        toast.info(`Connection issue. Retrying... (${retryCount + 1}/3)`);
        setTimeout(() => fetchPreview(true), 2000);
        return;
      } else {
        setUrlError('Failed to fetch playlist. Please check the URL and try again.');
        setImportStep('idle');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Start animated progress
  const startAnimatedProgress = (total: number) => {
    setImportProgress(0);
    let progress = 0;
    
    const interval = setInterval(() => {
      if (importCancelled) {
        clearInterval(interval);
        return;
      }
      
      // Simulate progress with natural acceleration/deceleration
      const remaining = total - progress;
      const increment = Math.max(0.5, Math.min(2, remaining * 0.05));
      progress = Math.min(total * 0.95, progress + increment);
      setImportProgress(Math.floor(progress));
    }, 1500 + Math.random() * 1000);
    
    return interval;
  };

  // Import the playlist
  const importPlaylist = async () => {
    if (!currentUser || !preview) return;
    
    setImportStep('importing');
    setImportCancelled(false);
    setImportMessageIndex(0);
    
    const total = useFullPlaylist ? preview.total_tracks : (importLimit || preview.total_tracks);
    setImportTotal(total);
    
    const progressInterval = startAnimatedProgress(total);
    
    try {
      const response = await fetch(`${SPOTIFY_API_BASE}/import-spotify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playlistUrl: spotifyUrl,
          limit: useFullPlaylist ? null : importLimit
        })
      });
      
      clearInterval(progressInterval);
      
      if (importCancelled) {
        toast.info('Import cancelled');
        resetState();
        return;
      }
      
      if (response.status === 403 || response.status === 401) {
        throw new Error('PRIVATE_PLAYLIST');
      }
      
      if (!response.ok) {
        throw new Error('Import failed');
      }
      
      const data = await response.json();
      
      // Store stats from backend
      const stats = data.stats || {
        processed: data.processed || preview.total_tracks,
        imported: data.songs?.length || 0,
        skipped_spotify: 0,
        skipped_youtube: 0
      };
      setImportStats({
        processed: stats.processed,
        imported: stats.imported,
        skippedSpotify: stats.skipped_spotify,
        skippedYoutube: stats.skipped_youtube
      });
      setImportProgress(stats.imported);
      
      // Transform songs to our format
      const songs: Song[] = data.songs.map((song: any) => ({
        id: song.id,
        title: song.title,
        artist: song.artist || song.sourceArtist || 'Unknown',
        thumbnail: song.thumbnail || `https://img.youtube.com/vi/${song.id}/hqdefault.jpg`,
        duration: song.duration || 0,
        sourceArtist: song.sourceArtist
      }));
      
      // Create playlist in Firebase
      const docRef = await addDoc(collection(db, 'Playlists'), {
        name: data.playlist.name || preview.name,
        userId: currentUser.uid,
        songs,
        createdAt: new Date().toISOString(),
        importedFrom: 'spotify',
        spotifyId: preview.id,
        isShared: false
      });
      
      setImportStep('done');
      toast.success(`Imported ${songs.length} songs!`);
      
      // Keep summary visible for 4 seconds before closing
      setTimeout(() => {
        handleClose();
        navigate(`/playlist/${docRef.id}`);
      }, 4000);
      
    } catch (error: any) {
      clearInterval(progressInterval);
      console.error('Import error:', error);
      
      if (error.message === 'PRIVATE_PLAYLIST') {
        toast.error('This playlist is private. Please make it public on Spotify.');
        setImportStep('idle');
        setUrlError('This playlist is private. Please make it public on Spotify and try again.');
      } else {
        toast.error('Failed to import playlist. Please try again.');
        setImportStep('options');
      }
    }
  };

  const cancelImport = () => {
    setImportCancelled(true);
    setImportStep('idle');
    resetState();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card/95 backdrop-blur-xl border-border w-[calc(100vw-2rem)] max-w-[400px] max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3">
          <DialogTitle className="text-lg flex items-center gap-2">
            <Music2 className="w-5 h-5 text-primary animate-pulse" />
            {showSpotifyImport ? 'Import from Spotify' : 'Create Playlist'}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-5 pb-5">
          {!showSpotifyImport ? (
            // Create playlist view
            <div className="space-y-4">
              <Input
                placeholder="Playlist name"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
                className="bg-input border-border transition-all focus:ring-2 focus:ring-primary/50 h-11"
              />
              <Button 
                onClick={createPlaylist}
                disabled={isCreating || !newPlaylistName.trim()}
                className="w-full btn-gradient-primary transition-all hover:scale-[1.02] h-11"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Playlist'
                )}
              </Button>
              
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/50" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              
              <button
                onClick={() => setShowSpotifyImport(true)}
                className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-all group relative overflow-hidden rounded-xl border border-[#1DB954]/50 hover:border-[#1DB954] hover:shadow-[0_0_30px_rgba(29,185,84,0.5)] hover:scale-[1.02]"
              >
                {/* Animated Spotify green glow background */}
                <div className="absolute inset-0 bg-gradient-to-r from-[#1DB954]/20 via-[#1DB954]/10 to-[#1DB954]/20 opacity-50 group-hover:opacity-80 transition-opacity" />
                <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-[#1DB954]/20 to-transparent" />
                <div className="absolute -inset-1 bg-gradient-to-r from-[#1DB954]/0 via-[#1DB954]/30 to-[#1DB954]/0 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <Sparkles className="w-5 h-5 text-[#1DB954] animate-pulse relative z-10" />
                <span className="text-[#1DB954] font-bold relative z-10">
                  Import from Spotify
                </span>
                <ChevronRight className="w-4 h-4 text-[#1DB954] group-hover:translate-x-1 transition-transform relative z-10" />
              </button>
            </div>
          ) : (
            // Spotify import flow
            <div className="space-y-4 mt-2 pb-4">
              {/* Step 1: Enter URL */}
              {importStep === 'idle' && (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-2">
                    <Input
                      placeholder="Paste Spotify playlist URL..."
                      value={spotifyUrl}
                      onChange={(e) => {
                        setSpotifyUrl(e.target.value);
                        if (urlError) setUrlError('');
                      }}
                      className={`bg-input border-border transition-all ${urlError ? 'border-destructive ring-2 ring-destructive/30' : 'focus:ring-2 focus:ring-[#1DB954]/50'}`}
                    />
                    {urlError && (
                      <div className="flex items-start gap-2 text-xs text-destructive animate-fade-in">
                        {urlError.includes('private') ? (
                          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        )}
                        <span>{urlError}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground/80">📝 Note:</p>
                    <p>• Some songs may be skipped if exact matches aren't found</p>
                    <p>• Missing songs can be added manually later</p>
                    <p>• Private playlists need to be made public first</p>
                  </div>
                  
                  <Button
                    onClick={() => fetchPreview()}
                    disabled={!spotifyUrl.trim()}
                    className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold shadow-[0_4px_15px_rgba(29,185,84,0.4)] hover:shadow-[0_6px_25px_rgba(29,185,84,0.6)] transition-all hover:scale-[1.02]"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Search Playlist
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowSpotifyImport(false)}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    Back to Create
                  </Button>
                </div>
              )}

              {/* Step 2: Loading preview with animated messages */}
              {importStep === 'preview' && isLoading && (
                <div className="py-10 text-center space-y-6 animate-fade-in">
                  <div className="relative w-20 h-20 mx-auto">
                    {/* Outer ring */}
                    <div className="absolute inset-0 rounded-full border-4 border-[#1DB954]/20" />
                    {/* Spinning ring */}
                    <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#1DB954] animate-spin" />
                    {/* Inner glow */}
                    <div className="absolute inset-2 rounded-full bg-[#1DB954]/10 animate-pulse" />
                    {/* Center icon */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Music2 className="w-8 h-8 text-[#1DB954] animate-bounce" />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground animate-pulse">
                      {loadingMessages[loadingMessageIndex]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Getting things ready. This may take up to a minute.
                    </p>
                    {retryCount > 0 && (
                      <p className="text-xs text-amber-500 animate-fade-in">
                        Retry attempt {retryCount}/3...
                      </p>
                    )}
                  </div>
                  
                  {/* Animated dots */}
                  <div className="flex justify-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-[#1DB954] animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Show preview + Confirm */}
              {importStep === 'confirm' && preview && (
                <div className="space-y-4 animate-fade-in">
                  <div className="bg-gradient-to-br from-[#1DB954]/20 to-[#1DB954]/5 rounded-xl p-5 space-y-3 border border-[#1DB954]/30">
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-[#1DB954]/20 flex items-center justify-center">
                        <Music2 className="w-7 h-7 text-[#1DB954]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-lg truncate">{preview.name}</h3>
                        <p className="text-sm text-muted-foreground truncate">
                          by {preview.owner}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Music2 className="w-4 h-4" />
                        {preview.total_tracks} songs
                      </span>
                      <span>•</span>
                      <span>{preview.duration}</span>
                    </div>
                  </div>
                  
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex gap-3 animate-fade-in">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5 animate-pulse" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-500">Importing may take 2-10 minutes</p>
                      <p className="text-muted-foreground mt-1">
                        Depending on playlist size. Some songs may be skipped if no match is found.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setImportStep('idle');
                        setPreview(null);
                      }}
                      className="flex-1 transition-all hover:scale-[1.02]"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => setImportStep('options')}
                      className="flex-1 bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold shadow-[0_4px_15px_rgba(29,185,84,0.4)] hover:shadow-[0_6px_25px_rgba(29,185,84,0.6)] transition-all hover:scale-[1.02]"
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Import options */}
              {importStep === 'options' && preview && (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-3">
                    <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all hover:scale-[1.01] ${
                      useFullPlaylist ? 'border-[#1DB954] bg-[#1DB954]/10 shadow-[0_0_15px_rgba(29,185,84,0.2)]' : 'border-border hover:border-[#1DB954]/50'
                    }`}>
                      <input
                        type="radio"
                        name="importOption"
                        checked={useFullPlaylist}
                        onChange={() => setUseFullPlaylist(true)}
                        className="w-5 h-5 text-[#1DB954] accent-[#1DB954]"
                      />
                      <div>
                        <p className="font-medium">Import full playlist</p>
                        <p className="text-xs text-muted-foreground">{preview.total_tracks} songs</p>
                      </div>
                    </label>
                    
                    <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all hover:scale-[1.01] ${
                      !useFullPlaylist ? 'border-[#1DB954] bg-[#1DB954]/10 shadow-[0_0_15px_rgba(29,185,84,0.2)]' : 'border-border hover:border-[#1DB954]/50'
                    }`}>
                      <input
                        type="radio"
                        name="importOption"
                        checked={!useFullPlaylist}
                        onChange={() => setUseFullPlaylist(false)}
                        className="w-5 h-5 text-[#1DB954] accent-[#1DB954]"
                      />
                      <div className="flex-1">
                        <p className="font-medium">Set max songs</p>
                        {!useFullPlaylist && (
                          <Input
                            type="number"
                            min={1}
                            max={preview.total_tracks}
                            placeholder="Enter number..."
                            value={importLimit || ''}
                            onChange={(e) => setImportLimit(parseInt(e.target.value) || null)}
                            className="mt-2 w-32 bg-input border-border"
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>
                    </label>
                  </div>
                  
                  <Button
                    onClick={importPlaylist}
                    disabled={!useFullPlaylist && (!importLimit || importLimit < 1)}
                    className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold shadow-[0_4px_15px_rgba(29,185,84,0.4)] hover:shadow-[0_6px_25px_rgba(29,185,84,0.6)] transition-all hover:scale-[1.02]"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Import Playlist
                  </Button>
                </div>
              )}

              {/* Step 5: Importing progress with animations */}
              {importStep === 'importing' && (
                <div className="py-8 space-y-6 animate-fade-in">
                  {/* Animated circular progress */}
                  <div className="relative w-32 h-32 mx-auto">
                    {/* Background circle */}
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        className="text-muted/30"
                      />
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        strokeLinecap="round"
                        className="text-[#1DB954] transition-all duration-500"
                        strokeDasharray={`${(importProgress / importTotal) * 352} 352`}
                      />
                    </svg>
                    {/* Center content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-[#1DB954]">{importProgress}</span>
                      <span className="text-xs text-muted-foreground">of {importTotal}</span>
                    </div>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="relative h-2 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#1DB954] via-[#1ed760] to-[#1DB954] transition-all duration-500 rounded-full"
                      style={{ width: `${(importProgress / importTotal) * 100}%` }}
                    />
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                  </div>
                  
                  <div className="text-center space-y-2">
                    <p className="text-sm font-medium text-[#1DB954] animate-pulse">
                      {importingMessages[importMessageIndex]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      This may take a few minutes. Please don't close this window.
                    </p>
                  </div>
                  
                  <Button
                    variant="destructive"
                    onClick={cancelImport}
                    className="w-full transition-all hover:scale-[1.02]"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cancel Import
                  </Button>
                </div>
              )}

              {/* Step 6: Done with animated summary */}
              {importStep === 'done' && (
                <div className="py-8 space-y-6 animate-fade-in">
                  <div className="relative w-20 h-20 mx-auto">
                    <div className="absolute inset-0 rounded-full bg-[#1DB954]/20 animate-ping" />
                    <div className="relative w-full h-full rounded-full bg-[#1DB954]/20 flex items-center justify-center">
                      <CheckCircle2 className="w-10 h-10 text-[#1DB954] animate-bounce" />
                    </div>
                  </div>
                  
                  <div className="text-center">
                    <p className="font-bold text-xl text-[#1DB954]">Import Complete!</p>
                    <p className="text-sm text-muted-foreground mt-1">Your playlist is ready to play</p>
                  </div>
                  
                  {/* Animated stats cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/30 rounded-xl p-4 text-center animate-fade-in" style={{ animationDelay: '0.1s' }}>
                      <p className="text-2xl font-bold text-foreground">{importStats?.processed || importTotal}</p>
                      <p className="text-xs text-muted-foreground">Spotify tracks</p>
                    </div>
                    <div className="bg-[#1DB954]/10 rounded-xl p-4 text-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
                      <p className="text-2xl font-bold text-[#1DB954]">{importStats?.imported || importProgress}</p>
                      <p className="text-xs text-muted-foreground">Imported</p>
                    </div>
                  </div>
                  
                  {((importStats?.skippedSpotify || 0) > 0 || (importStats?.skippedYoutube || 0) > 0) && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center animate-fade-in" style={{ animationDelay: '0.3s' }}>
                      <p className="text-sm text-amber-500">
                        {(importStats?.skippedSpotify || 0) + (importStats?.skippedYoutube || 0)} songs skipped
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        You can add them manually later
                      </p>
                    </div>
                  )}
                  
                  <p className="text-xs text-muted-foreground text-center">
                    Redirecting to your playlist...
                  </p>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
