import React, { useState, useEffect } from 'react';
import { Check, ListMusic, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, addDoc, query, where, onSnapshot, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { toast } from 'sonner';

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
}

interface AddToPlaylistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: Song | null;
}

export default function AddToPlaylistModal({ open, onOpenChange, song }: AddToPlaylistModalProps) {
  const { currentUser } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);

  useEffect(() => {
    if (!currentUser || !open) return;

    const q = query(collection(db, 'Playlists'), where('userId', '==', currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Playlist));
      setPlaylists(data);
      
      // Pre-select playlists that already contain this song
      if (song) {
        const alreadyIn = new Set<string>();
        data.forEach(playlist => {
          if (playlist.songs.some(s => s.id === song.id)) {
            alreadyIn.add(playlist.id);
          }
        });
        setSelectedPlaylists(alreadyIn);
      }
    });

    return () => unsubscribe();
  }, [currentUser, open, song]);

  const togglePlaylist = (playlistId: string) => {
    const newSelected = new Set(selectedPlaylists);
    if (newSelected.has(playlistId)) {
      newSelected.delete(playlistId);
    } else {
      newSelected.add(playlistId);
    }
    setSelectedPlaylists(newSelected);
  };

  const createPlaylist = async () => {
    if (!currentUser || !newPlaylistName.trim()) return;
    
    setIsCreating(true);
    try {
      const docRef = await addDoc(collection(db, 'Playlists'), {
        name: newPlaylistName,
        userId: currentUser.uid,
        songs: [],
        createdAt: new Date().toISOString()
      });
      
      // Auto-select the new playlist
      setSelectedPlaylists(prev => new Set(prev).add(docRef.id));
      setNewPlaylistName('');
      setShowCreateInput(false);
      toast.success('Playlist created!');
    } catch (error) {
      console.error('Error creating playlist:', error);
      toast.error('Failed to create playlist');
    } finally {
      setIsCreating(false);
    }
  };

  const saveSongToPlaylists = async () => {
    if (!song || selectedPlaylists.size === 0) return;
    
    setIsSaving(true);
    try {
      const promises: Promise<void>[] = [];
      
      // Count only NEW playlists (not already containing the song)
      let newlyAddedCount = 0;
      
      for (const playlistId of selectedPlaylists) {
        const playlist = playlists.find(p => p.id === playlistId);
        // Only add if song is not already in playlist
        if (playlist && !playlist.songs.some(s => s.id === song.id)) {
          newlyAddedCount++;
          const playlistRef = doc(db, 'Playlists', playlistId);
          promises.push(
            updateDoc(playlistRef, {
              songs: arrayUnion({
                id: song.id,
                title: song.title,
                artist: song.artist,
                thumbnail: song.thumbnail,
                duration: song.duration || 0
              })
            })
          );
        }
      }
      
      await Promise.all(promises);
      // Show count of only newly added playlists
      if (newlyAddedCount > 0) {
        toast.success(`Added to ${newlyAddedCount} playlist${newlyAddedCount > 1 ? 's' : ''}`);
      } else {
        toast.info('Already in all selected playlists');
      }
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving to playlists:', error);
      toast.error('Failed to save to playlists');
    } finally {
      setIsSaving(false);
    }
  };

  if (!song) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card/95 backdrop-blur border-border max-w-sm w-[min(92vw,24rem)] max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-4 pb-3 border-b border-border">
          <DialogTitle className="text-lg flex items-center gap-2">
            <ListMusic className="w-5 h-5 text-primary" />
            Add to Playlist
          </DialogTitle>
        </DialogHeader>
        
        {/* Current song preview - fixed height */}
        <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border shrink-0">
          <img
            src={song.thumbnail}
            alt={song.title}
            className="w-12 h-12 rounded object-cover shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{song.title}</p>
            <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
          </div>
        </div>

        {/* Playlist list - scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-2 space-y-1">
            {playlists.map((playlist) => {
              const isSelected = selectedPlaylists.has(playlist.id);
              const alreadyHasSong = playlist.songs.some((s) => s.id === song.id);

              return (
                <button
                  key={playlist.id}
                  onClick={() => !alreadyHasSong && togglePlaylist(playlist.id)}
                  disabled={alreadyHasSong}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                    alreadyHasSong
                      ? 'opacity-50 cursor-not-allowed bg-muted/10'
                      : isSelected
                        ? 'bg-primary/20 border border-primary/40'
                        : 'bg-muted/20 hover:bg-muted/40 border border-transparent'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                      alreadyHasSong
                        ? 'bg-primary/30 text-primary-foreground'
                        : isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50'
                    }`}
                  >
                    {(isSelected || alreadyHasSong) && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium truncate">{playlist.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {playlist.songs.length} songs
                      {alreadyHasSong && (
                        <span className="text-primary ml-1">• Already added</span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}

            {playlists.length === 0 && !showCreateInput && (
              <div className="text-center py-6 text-muted-foreground">
                <ListMusic className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No playlists yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Create new playlist - fixed at bottom */}
        <div className="p-4 pt-3 border-t border-border space-y-3 shrink-0">
          {showCreateInput ? (
            <div className="flex gap-2">
              <Input
                placeholder="Playlist name"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
                className="flex-1 bg-input border-border"
                autoFocus
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setShowCreateInput(false);
                  setNewPlaylistName('');
                }}
              >
                <X className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                onClick={createPlaylist}
                disabled={isCreating || !newPlaylistName.trim()}
                className="bg-primary hover:bg-primary/90"
              >
                <Check className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setShowCreateInput(true)}
              className="w-full border-dashed border-muted-foreground/30 hover:border-primary/50"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Playlist
            </Button>
          )}

          {/* Save button - count only NEW playlists (not already containing song) */}
          {(() => {
            // Count how many NEW playlists are selected (excluding ones that already have the song)
            const newPlaylistsCount = Array.from(selectedPlaylists).filter(playlistId => {
              const playlist = playlists.find(p => p.id === playlistId);
              return playlist && !playlist.songs.some(s => s.id === song.id);
            }).length;
            
            return (
              <Button
                onClick={saveSongToPlaylists}
                disabled={isSaving || newPlaylistsCount === 0}
                className="w-full bg-gradient-to-r from-primary to-secondary hover:opacity-90"
              >
                {isSaving ? 'Saving...' : newPlaylistsCount === 0 
                  ? 'Already in selected playlists' 
                  : `Save to ${newPlaylistsCount} Playlist${newPlaylistsCount !== 1 ? 's' : ''}`}
              </Button>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
