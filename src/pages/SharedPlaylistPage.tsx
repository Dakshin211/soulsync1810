import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Music2, Play, ArrowLeft, Save, Share2, Users, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { getSharedPlaylist, saveSharedPlaylistToLibrary } from '@/services/sharedPlaylistService';
import { toast } from 'sonner';
import { formatDuration } from '@/services/youtubeApi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

interface SharedPlaylistData {
  id: string;
  name: string;
  originalUserId: string;
  songs: Song[];
  createdAt: string;
  shareCode: string;
}

export default function SharedPlaylistPage() {
  const { shareCode } = useParams<{ shareCode: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { playSong, setQueue, currentSong, isPlaying, pauseSong, resumeSong } = useMusicPlayer();
  
  const [playlist, setPlaylist] = useState<SharedPlaylistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSharedPlaylist();
  }, [shareCode]);

  const loadSharedPlaylist = async () => {
    if (!shareCode) {
      setError('Invalid share link');
      setLoading(false);
      return;
    }

    try {
      const data = await getSharedPlaylist(shareCode);
      
      if (!data) {
        setError('Playlist not found or link has expired');
        setLoading(false);
        return;
      }
      
      setPlaylist(data);
    } catch (err) {
      console.error('Error loading shared playlist:', err);
      setError('Failed to load playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!currentUser) {
      toast.error('Please sign in to save this playlist');
      navigate('/auth');
      return;
    }

    if (!shareCode) return;

    setSaving(true);
    try {
      const result = await saveSharedPlaylistToLibrary(shareCode, currentUser.uid);
      
      if (result.success) {
        toast.success('Playlist saved to your library!');
        setShowSaveDialog(false);
        navigate(`/playlist/${result.playlistId}`);
      } else {
        if (result.error?.includes('already have')) {
          toast.info(result.error);
          if (result.playlistId) {
            navigate(`/playlist/${result.playlistId}`);
          }
        } else {
          toast.error(result.error || 'Failed to save playlist');
        }
      }
    } catch (err) {
      toast.error('Failed to save playlist');
    } finally {
      setSaving(false);
    }
  };

  const playAll = () => {
    if (!playlist?.songs.length) {
      toast.error('Playlist is empty');
      return;
    }
    
    setQueue(playlist.songs, 'playlist');
    playSong(playlist.songs[0], 'playlist');
    toast.success(`Playing ${playlist.name}`);
  };

  const playSongFromList = (song: Song, index: number) => {
    if (!playlist) return;
    
    const songsToPlay = [...playlist.songs.slice(index), ...playlist.songs.slice(0, index)];
    setQueue(songsToPlay, 'playlist');
    playSong(song, 'playlist');
  };

  const totalDuration = playlist?.songs.reduce((acc, song) => acc + (song.duration || 0), 0) || 0;
  const totalMinutes = Math.floor(totalDuration / 60);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-fade-in flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading shared playlist...</p>
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4 animate-fade-in">
          <div className="w-20 h-20 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <Music2 className="w-10 h-10 text-destructive/50" />
          </div>
          <h2 className="text-xl font-bold">{error || 'Playlist not found'}</h2>
          <p className="text-muted-foreground">This link may have expired or been removed</p>
          <Button onClick={() => navigate('/')} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-40">
      {/* Hero Header */}
      <div className="relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-secondary/40 via-secondary/20 to-background" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-secondary/30 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-primary/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
        
        <div className="relative px-4 pt-6 pb-10">
          {/* Back button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            className="mb-6 hover:bg-white/10 backdrop-blur-sm"
          >
            <ArrowLeft className="w-6 h-6" />
          </Button>

          {/* Shared badge */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/20 border border-secondary/30 text-secondary text-sm font-medium">
              <Share2 className="w-4 h-4" />
              Shared Playlist
            </div>
          </div>

          {/* Playlist info */}
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Playlist cover with glow effect */}
            <div className="relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-secondary via-primary to-secondary rounded-3xl opacity-60 blur-2xl group-hover:opacity-80 transition-all duration-500 animate-pulse" />
              <Card className="relative w-56 h-56 md:w-64 md:h-64 bg-gradient-to-br from-card to-card/50 flex items-center justify-center overflow-hidden rounded-2xl shadow-2xl">
                {playlist.songs.length > 0 ? (
                  <div className="grid grid-cols-2 w-full h-full">
                    {playlist.songs.slice(0, 4).map((song, i) => (
                      <img
                        key={i}
                        src={song.thumbnail}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ))}
                    {playlist.songs.length < 4 && Array(4 - playlist.songs.length).fill(0).map((_, i) => (
                      <div key={`empty-${i}`} className="w-full h-full bg-gradient-to-br from-muted/50 to-muted/30 flex items-center justify-center">
                        <Music2 className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center">
                    <Music2 className="w-24 h-24 text-secondary/30 mb-2" />
                  </div>
                )}
              </Card>
            </div>

            {/* Playlist details */}
            <div className="text-center md:text-left flex-1 space-y-3 w-full">
              <h1 className="text-3xl md:text-6xl font-black bg-gradient-to-r from-foreground via-secondary to-primary bg-clip-text text-transparent">
                {playlist.name}
              </h1>
              
              <div className="flex items-center justify-center md:justify-start gap-4 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Music2 className="w-4 h-4" />
                  {playlist.songs.length} songs
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  Shared playlist
                </span>
                <span>~{totalMinutes} min</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-4 mt-8 justify-center md:justify-start flex-wrap">
            <Button
              onClick={playAll}
              disabled={!playlist.songs.length}
              className="btn-gradient-primary shadow-glow-pink px-10 py-7 text-lg rounded-full transition-all hover:scale-105"
            >
              <Play className="w-7 h-7 mr-2" fill="white" />
              Play
            </Button>
            
            <Button
              onClick={() => setShowSaveDialog(true)}
              className="px-8 py-7 text-lg rounded-full bg-secondary hover:bg-secondary/90 transition-all hover:scale-105"
            >
              <Save className="w-6 h-6 mr-2" />
              Save to Library
            </Button>
          </div>
        </div>
      </div>

      {/* Song list */}
      <div className="px-4 mt-4">
        {playlist.songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-fade-in">
            <Music2 className="w-24 h-24 mb-6 opacity-30" />
            <p className="text-2xl font-semibold mb-2">Empty playlist</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Header */}
            <div className="hidden md:grid grid-cols-[auto_1fr_auto] gap-4 px-4 py-2 text-sm text-muted-foreground border-b border-border">
              <span className="w-8">#</span>
              <span>Title</span>
              <span className="w-20 text-right">Duration</span>
            </div>

            {playlist.songs.map((song, index) => {
              const isCurrentSong = currentSong?.id === song.id;
              const isThisSongPlaying = isCurrentSong && isPlaying;
              
              return (
                <Card
                  key={`${song.id}-${index}`}
                  onClick={() => playSongFromList(song, index)}
                  className={`group flex items-center gap-4 p-3 cursor-pointer transition-all duration-300 hover:bg-secondary/10 animate-fade-in border-transparent ${
                    isCurrentSong ? 'bg-secondary/20 border-secondary/50' : ''
                  }`}
                  style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
                >
                  {/* Track number or playing indicator */}
                  <div className="w-8 text-center shrink-0">
                    {isThisSongPlaying ? (
                      <div className="flex items-center justify-center gap-0.5">
                        {[...Array(3)].map((_, i) => (
                          <div
                            key={i}
                            className="w-1 bg-secondary rounded-full animate-pulse"
                            style={{
                              height: `${8 + Math.random() * 8}px`,
                              animationDelay: `${i * 0.15}s`
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground group-hover:hidden">
                        {index + 1}
                      </span>
                    )}
                    <Play className={`w-4 h-4 text-secondary hidden group-hover:block mx-auto ${isThisSongPlaying ? '!hidden' : ''}`} />
                  </div>
                  
                  {/* Thumbnail */}
                  <div className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden">
                    <img
                      src={song.thumbnail}
                      alt={song.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  
                  {/* Song info */}
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-medium truncate transition-colors ${
                      isCurrentSong ? 'text-secondary' : 'group-hover:text-secondary'
                    }`}>
                      {song.title}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {song.artist}
                    </p>
                  </div>
                  
                  {/* Duration */}
                  <div className="w-20 text-right text-sm text-muted-foreground shrink-0">
                    {song.duration ? formatDuration(song.duration) : '--:--'}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Save to Library Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="w-5 h-5 text-secondary" />
              Save to Your Library
            </DialogTitle>
            <DialogDescription>
              Do you want to save "{playlist.name}" to your playlist library? You'll be able to edit and manage it like your own playlists.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowSaveDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveToLibrary}
              disabled={saving}
              className="bg-secondary hover:bg-secondary/90"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Playlist
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
