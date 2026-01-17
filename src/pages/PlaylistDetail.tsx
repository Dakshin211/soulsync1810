import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Pause, Shuffle, Repeat, Plus, Trash2, Music2, MoreVertical, Share2, Clock, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, arrayRemove, onSnapshot, arrayUnion, deleteDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { formatDuration } from '@/services/youtubeApi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

interface Playlist {
  id: string;
  name: string;
  userId: string;
  songs: Song[];
  createdAt: string;
  shuffleMode?: boolean;
}

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { playSong, setQueue, currentSong, isPlaying, pauseSong, resumeSong, repeat, toggleRepeat, shuffle, toggleShuffle } = useMusicPlayer();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaylistPlaying, setIsPlaylistPlaying] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  
  // Local shuffle state for this playlist (default: random/shuffle)
  const [playlistShuffle, setPlaylistShuffle] = useState(true);

  useEffect(() => {
    if (!id || !currentUser) return;

    const unsubscribe = onSnapshot(doc(db, 'Playlists', id), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.userId === currentUser.uid) {
          const pl = {
            id: docSnap.id,
            ...data
          } as Playlist;
          setPlaylist(pl);
          // Load saved shuffle mode (default to true = random)
          setPlaylistShuffle(data.shuffleMode !== false);
        } else {
          toast.error('Unauthorized');
          navigate('/playlists');
        }
      } else {
        toast.error('Playlist not found');
        navigate('/playlists');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [id, currentUser, navigate]);

  // Track if current song is from this playlist
  useEffect(() => {
    if (currentSong && playlist) {
      const isFromPlaylist = playlist.songs.some(s => s.id === currentSong.id);
      setIsPlaylistPlaying(isFromPlaylist && isPlaying);
    }
  }, [currentSong, playlist, isPlaying]);

  const togglePlaylistShuffle = async () => {
    if (!playlist) return;
    const newValue = !playlistShuffle;
    setPlaylistShuffle(newValue);
    
    try {
      await updateDoc(doc(db, 'Playlists', playlist.id), {
        shuffleMode: newValue
      });
      toast.success(newValue ? 'Shuffle: Random' : 'Shuffle: Sequential');
    } catch (error) {
      console.error('Error updating shuffle mode:', error);
    }
  };

  const playAll = useCallback(() => {
    if (!playlist?.songs.length) {
      toast.error('Playlist is empty');
      return;
    }
    
    let songsToPlay = [...playlist.songs];
    // Use playlist-specific shuffle state
    if (playlistShuffle) {
      songsToPlay = songsToPlay.sort(() => Math.random() - 0.5);
    }

    setQueue(songsToPlay, 'playlist');
    playSong(songsToPlay[0], 'playlist');
    toast.success(`Playing ${playlist.name}`);
  }, [playlist, playlistShuffle, setQueue, playSong]);

  const togglePlayPause = () => {
    if (isPlaylistPlaying) {
      pauseSong();
    } else if (currentSong && playlist?.songs.some(s => s.id === currentSong.id)) {
      resumeSong();
    } else {
      playAll();
    }
  };

  const playSongFromList = useCallback((song: Song, index: number) => {
    if (!playlist) return;
    
    let songsToPlay = [...playlist.songs];
    // Use playlist-specific shuffle
    if (playlistShuffle) {
      const rest = songsToPlay.filter((_, i) => i !== index);
      songsToPlay = [song, ...rest.sort(() => Math.random() - 0.5)];
    } else {
      songsToPlay = [...songsToPlay.slice(index), ...songsToPlay.slice(0, index)];
    }
    
    setQueue(songsToPlay, 'playlist');
    playSong(song, 'playlist');
  }, [playlist, playlistShuffle, setQueue, playSong]);

  const removeSong = async (song: Song) => {
    if (!playlist) return;
    
    try {
      await updateDoc(doc(db, 'Playlists', playlist.id), {
        songs: arrayRemove(song)
      });
      toast.success('Song removed');
    } catch (error) {
      console.error('Error removing song:', error);
      toast.error('Failed to remove song');
    }
  };

  const addCurrentSong = async () => {
    if (!currentSong || !playlist) {
      toast.error('No song currently playing');
      return;
    }

    if (playlist.songs.some(s => s.id === currentSong.id)) {
      toast.error('Song already in playlist');
      return;
    }

    try {
      await updateDoc(doc(db, 'Playlists', playlist.id), {
        songs: arrayUnion(currentSong)
      });
      toast.success('Song added to playlist');
    } catch (error) {
      console.error('Error adding song:', error);
      toast.error('Failed to add song');
    }
  };

  const sharePlaylist = async () => {
    if (!playlist) return;
    
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/playlist/${playlist.id}`);
      toast.success('Playlist link copied!');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const startRename = () => {
    if (!playlist) return;
    setNewName(playlist.name);
    setIsRenaming(true);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setNewName('');
  };

  const saveRename = async () => {
    if (!playlist || !newName.trim()) return;
    
    try {
      await updateDoc(doc(db, 'Playlists', playlist.id), {
        name: newName.trim()
      });
      toast.success('Playlist renamed!');
      setIsRenaming(false);
      setNewName('');
    } catch (error) {
      console.error('Error renaming playlist:', error);
      toast.error('Failed to rename playlist');
    }
  };

  const deletePlaylist = async () => {
    if (!playlist) return;
    
    try {
      await deleteDoc(doc(db, 'Playlists', playlist.id));
      toast.success('Playlist deleted');
      navigate('/playlists');
    } catch (error) {
      console.error('Error deleting playlist:', error);
      toast.error('Failed to delete playlist');
    }
  };

  const totalDuration = playlist?.songs.reduce((acc, song) => acc + (song.duration || 0), 0) || 0;
  const totalMinutes = Math.floor(totalDuration / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-fade-in flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading playlist...</p>
        </div>
      </div>
    );
  }

  if (!playlist) return null;

  return (
    <div className="min-h-screen bg-background pb-40">
      {/* Hero Header */}
      <div className="relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/40 via-primary/20 to-background" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/30 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
        
        <div className="relative px-4 pt-6 pb-10">
          {/* Back button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/playlists')}
            className="mb-6 hover:bg-white/10 backdrop-blur-sm"
          >
            <ArrowLeft className="w-6 h-6" />
          </Button>

          {/* Playlist info */}
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Playlist cover with glow effect */}
            <div className="relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-primary via-secondary to-primary rounded-3xl opacity-60 blur-2xl group-hover:opacity-80 transition-all duration-500 animate-pulse" />
              <Card className="relative w-56 h-56 md:w-64 md:h-64 bg-gradient-to-br from-card to-card/50 flex items-center justify-center overflow-hidden rounded-2xl shadow-2xl">
                {playlist.songs.length > 0 ? (
                  <div className="grid grid-cols-2 w-full h-full">
                    {playlist.songs.slice(0, 4).map((song, i) => (
                      <img
                        key={i}
                        src={song.thumbnail}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        style={{ animationDelay: `${i * 0.1}s` }}
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
                    <Music2 className="w-24 h-24 text-primary/30 mb-2" />
                  </div>
                )}
              </Card>
            </div>

            {/* Playlist details */}
            <div className="text-center md:text-left flex-1 space-y-3 w-full">
              <p className="text-sm text-primary uppercase tracking-widest font-semibold">Playlist</p>
              
              {isRenaming ? (
                <div className="flex items-center gap-2 max-w-md mx-auto md:mx-0">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    className="text-2xl md:text-4xl font-bold bg-input border-border"
                    autoFocus
                  />
                  <Button size="icon" onClick={saveRename} className="bg-primary hover:bg-primary/90">
                    <Check className="w-5 h-5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={cancelRename}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center md:justify-start gap-3 group">
                  <h1 className="text-3xl md:text-6xl font-black bg-gradient-to-r from-foreground via-primary to-secondary bg-clip-text text-transparent text-center md:text-left">
                    {playlist.name}
                  </h1>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={startRename}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0"
                    title="Rename playlist"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
              )}
              
              <div className="flex items-center justify-center md:justify-start gap-4 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Music2 className="w-4 h-4" />
                  {playlist.songs.length} songs
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {totalHours > 0 ? `${totalHours}h ${remainingMinutes}m` : `${totalMinutes} min`}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-4 mt-8 justify-center md:justify-start flex-wrap">
            <Button
              onClick={togglePlayPause}
              disabled={!playlist.songs.length}
              className="btn-gradient-primary shadow-glow-pink px-10 py-7 text-lg rounded-full transition-all hover:scale-105"
            >
              {isPlaylistPlaying ? (
                <>
                  <Pause className="w-7 h-7 mr-2" fill="white" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-7 h-7 mr-2" fill="white" />
                  Play
                </>
              )}
            </Button>
            
            {/* Shuffle button - toggles between random/sequential */}
            <Button
              variant="outline"
              size="icon"
              onClick={togglePlaylistShuffle}
              className={`w-14 h-14 rounded-full border-2 transition-all hover:scale-105 ${
                playlistShuffle ? 'bg-primary/20 border-primary text-primary shadow-glow-pink' : 'border-border'
              }`}
              title={playlistShuffle ? 'Random (click for sequential)' : 'Sequential (click for random)'}
            >
              <Shuffle className="w-6 h-6" />
            </Button>
            
            {/* Loop button - only 2 modes: off and all */}
            <Button
              variant="outline"
              size="icon"
              onClick={toggleRepeat}
              className={`w-14 h-14 rounded-full border-2 transition-all hover:scale-105 ${
                repeat !== 'off' ? 'bg-primary/20 border-primary text-primary shadow-glow-pink' : 'border-border'
              }`}
              title={repeat !== 'off' ? 'Loop on' : 'Loop off'}
            >
              <Repeat className="w-6 h-6" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={addCurrentSong}
              className="w-14 h-14 rounded-full border-2 border-primary/50 bg-primary/10 hover:bg-primary/20 hover:border-primary text-primary transition-all hover:scale-105"
              title="Add current song"
            >
              <Plus className="w-6 h-6" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={sharePlaylist}
              className="w-14 h-14 rounded-full border-2 border-border hover:border-primary hover:text-primary transition-all hover:scale-105"
              title="Share playlist"
            >
              <Share2 className="w-6 h-6" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={deletePlaylist}
              className="w-14 h-14 rounded-full border-2 border-destructive/50 bg-destructive/10 hover:bg-destructive hover:border-destructive text-destructive hover:text-destructive-foreground transition-all hover:scale-105"
              title="Delete playlist"
            >
              <Trash2 className="w-6 h-6" />
            </Button>
          </div>
        </div>
      </div>

      {/* Song list */}
      <div className="px-4 mt-4">
        {playlist.songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-fade-in">
            <div className="relative">
              <div className="absolute -inset-8 bg-primary/10 rounded-full blur-2xl" />
              <Music2 className="relative w-24 h-24 mb-6 opacity-30" />
            </div>
            <p className="text-2xl font-semibold mb-2">Empty playlist</p>
            <p className="text-sm text-center max-w-xs">Play a song and tap the + button above to add it to this playlist</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Header */}
            <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto] gap-4 px-4 py-2 text-sm text-muted-foreground border-b border-border">
              <span className="w-8">#</span>
              <span>Title</span>
              <span className="w-20 text-right">Duration</span>
              <span className="w-10"></span>
            </div>

            {playlist.songs.map((song, index) => {
              const isCurrentSong = currentSong?.id === song.id;
              const isThisSongPlaying = isCurrentSong && isPlaying;
              
              return (
                <Card
                  key={`${song.id}-${index}`}
                  className={`group flex items-center gap-4 p-3 cursor-pointer transition-all duration-300 hover:bg-primary/10 animate-fade-in border-transparent ${
                    isCurrentSong ? 'bg-primary/15 border-primary/30 shadow-glow-pink' : 'bg-card/30 hover:bg-card/60'
                  }`}
                  style={{ animationDelay: `${index * 0.03}s` }}
                  onClick={() => playSongFromList(song, index)}
                >
                  {/* Index / Playing indicator */}
                  <div className="w-8 flex items-center justify-center">
                    {isThisSongPlaying ? (
                      <div className="flex items-center justify-center gap-[2px]">
                        <span className="w-1 h-4 bg-primary rounded-full animate-pulse" style={{ animationDuration: '0.5s' }} />
                        <span className="w-1 h-6 bg-primary rounded-full animate-pulse" style={{ animationDuration: '0.7s' }} />
                        <span className="w-1 h-3 bg-primary rounded-full animate-pulse" style={{ animationDuration: '0.4s' }} />
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-muted-foreground group-hover:hidden">{index + 1}</span>
                        <Play className="w-4 h-4 hidden group-hover:block text-primary" fill="currentColor" />
                      </>
                    )}
                  </div>

                  {/* Thumbnail */}
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 shadow-lg">
                    <img
                      src={song.thumbnail}
                      alt={song.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    {isCurrentSong && (
                      <div className="absolute inset-0 bg-primary/30 backdrop-blur-[1px]" />
                    )}
                  </div>

                  {/* Song info */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate transition-colors ${isCurrentSong ? 'text-primary' : 'group-hover:text-primary'}`}>
                      {song.title}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                  </div>

                  {/* Duration */}
                  {song.duration && (
                    <span className="text-sm text-muted-foreground hidden sm:block w-16 text-right">
                      {formatDuration(song.duration)}
                    </span>
                  )}

                  {/* Actions */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all hover:bg-primary/20"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-card border-border">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSong(song);
                        }}
                        className="text-destructive focus:text-destructive cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove from playlist
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}