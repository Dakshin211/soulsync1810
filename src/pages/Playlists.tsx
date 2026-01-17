import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ListMusic, Play, Music2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { toast } from 'sonner';
import CreatePlaylistModal from '@/components/CreatePlaylistModal';

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

export default function Playlists() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { playSong, setQueue } = useMusicPlayer();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, 'Playlists'), where('userId', '==', currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Playlist));
      setPlaylists(data);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const playPlaylist = (e: React.MouseEvent, playlist: Playlist) => {
    e.stopPropagation();
    if (playlist.songs.length === 0) {
      toast.error('Playlist is empty');
      return;
    }
    setQueue(playlist.songs);
    playSong(playlist.songs[0]);
    toast.success(`Playing ${playlist.name}`);
  };

  const openPlaylist = (playlist: Playlist) => {
    navigate(`/playlist/${playlist.id}`);
  };

  return (
    <div className="p-4 pb-32 animate-fade-in bg-background min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Your Playlists
          </h1>
          <Button 
            variant="gradient" 
            className="shadow-glow-violet"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="w-5 h-5 mr-2" />
            Create
          </Button>
        </div>

        {playlists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-fade-in">
            <div className="relative mb-6">
              <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-full blur-xl" />
              <Music2 className="relative w-24 h-24 opacity-40" />
            </div>
            <p className="text-2xl font-medium mb-2">No playlists yet</p>
            <p className="text-sm mb-6">Create your first playlist to get started</p>
            <Button 
              onClick={() => setCreateDialogOpen(true)}
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="w-5 h-5 mr-2" />
              Create Playlist
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {playlists.map((playlist, index) => (
              <Card
                key={playlist.id}
                className="group bg-card/50 border-border hover:bg-card/80 hover:shadow-glow-pink hover:scale-105 transition-all cursor-pointer overflow-hidden animate-fade-in"
                style={{ animationDelay: `${index * 0.05}s` }}
                onClick={() => openPlaylist(playlist)}
              >
                {/* Playlist cover */}
                <div className="aspect-square bg-gradient-to-br from-primary/30 to-secondary/30 relative overflow-hidden">
                  {playlist.songs.length > 0 ? (
                    <div className="grid grid-cols-2 w-full h-full">
                      {playlist.songs.slice(0, 4).map((song, i) => (
                        <img
                          key={i}
                          src={song.thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ))}
                      {playlist.songs.length < 4 && Array(4 - Math.min(playlist.songs.length, 4)).fill(0).map((_, i) => (
                        <div key={`empty-${i}`} className="w-full h-full bg-muted/30" />
                      ))}
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ListMusic className="w-16 h-16 text-primary/40" />
                    </div>
                  )}
                  
                  {/* Hover overlay - Play only */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
                    <Button
                      size="icon"
                      className="w-14 h-14 rounded-full bg-primary hover:bg-primary/90 shadow-lg transform scale-90 group-hover:scale-100 transition-transform"
                      onClick={(e) => playPlaylist(e, playlist)}
                    >
                      <Play className="w-7 h-7 text-white ml-1" fill="white" />
                    </Button>
                  </div>
                </div>
                
                {/* Playlist info */}
                <div className="p-3">
                  <h3 className="font-bold text-sm mb-1 truncate group-hover:text-primary transition-colors">
                    {playlist.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {playlist.songs.length} {playlist.songs.length === 1 ? 'song' : 'songs'}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreatePlaylistModal
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
