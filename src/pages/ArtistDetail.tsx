import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, ArrowLeft, Music2, Award, Users, Disc3, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { getArtistSongs, FAMOUS_ARTISTS_DATA } from '@/services/artistDataService';
import { formatDuration } from '@/services/youtubeApi';
interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}
interface ArtistData {
  artistName: string;
  image: string;
  bio: string;
  achievements: string[];
  monthlyListeners: string;
  songs: Song[];
}
export default function ArtistDetail() {
  const {
    artistName: encodedArtistName
  } = useParams<{
    artistName: string;
  }>();
  const artistName = encodedArtistName ? decodeURIComponent(encodedArtistName) : '';
  const navigate = useNavigate();
  const {
    playSong,
    setQueue
  } = useMusicPlayer();
  const [artistData, setArtistData] = useState<ArtistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => {
    loadArtistData();
  }, [artistName]);
  const loadArtistData = async () => {
    if (!artistName) return;
    try {
      setLoading(true);
      setImageLoaded(false);
      console.log(`🎤 [Artist] Loading data for ${artistName}`);
      const data = await getArtistSongs(artistName);
      if (data) {
        setArtistData({
          artistName: data.artistName,
          image: data.image,
          bio: data.bio,
          achievements: data.achievements,
          monthlyListeners: data.monthlyListeners,
          songs: data.songs
        });
      } else {
        // Fallback for unknown artists
        setArtistData({
          artistName,
          image: '',
          bio: `${artistName} is a talented artist in the music industry.`,
          achievements: ['Popular Artist', 'Growing Fanbase'],
          monthlyListeners: '1M+',
          songs: []
        });
      }
    } catch (error) {
      console.error('❌ [Artist] Error loading artist data:', error);
    } finally {
      setLoading(false);
    }
  };
  const handlePlaySong = (song: Song, index: number) => {
    if (artistData) {
      playSong(song);
      setQueue(artistData.songs);
    }
  };
  const handlePlayAll = () => {
    if (artistData && artistData.songs.length > 0) {
      playSong(artistData.songs[0]);
      setQueue(artistData.songs);
    }
  };
  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-r from-primary to-secondary animate-pulse" />
            <Disc3 className="absolute inset-0 m-auto w-10 h-10 text-white animate-spin" style={{
            animationDuration: '3s'
          }} />
          </div>
          <p className="text-muted-foreground">Loading artist...</p>
        </div>
      </div>;
  }
  if (!artistData) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <Music2 className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-lg">Artist not found</p>
          <Button onClick={() => navigate(-1)} variant="outline" className="mt-4">
            Go Back
          </Button>
        </div>
      </div>;
  }
  return <div className="min-h-screen bg-background pb-32 animate-fade-in">
      {/* Hero Section with Gradient Overlay */}
      <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
        {/* Background Image with Blur */}
        <div className="absolute inset-0 bg-cover bg-center transition-opacity duration-700" style={{
        backgroundImage: artistData.image ? `url(${artistData.image})` : 'none',
        opacity: imageLoaded ? 1 : 0,
        filter: 'blur(30px)',
        transform: 'scale(1.2)'
      }} />
        
        {/* Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/60 to-background" />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-secondary/20" />
        
        {/* Back Button */}
        <Button variant="ghost" size="icon" className="absolute top-4 left-4 z-20 glass rounded-full hover:scale-110 transition-transform" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Artist Info */}
        <div className="absolute inset-0 flex-col p-6 z-10 pt-16 py-[6px] flex items-center justify-end">
          {/* Artist Image */}
          <div className="relative mb-6 group">
            <div className="absolute -inset-2 bg-gradient-to-r from-primary to-secondary rounded-full opacity-75 blur-xl group-hover:opacity-100 transition-opacity animate-pulse" style={{
            animationDuration: '3s'
          }} />
            <img src={artistData.image || '/placeholder.svg'} alt={artistData.artistName} onLoad={() => setImageLoaded(true)} className="relative w-36 h-36 md:w-48 md:h-48 rounded-full object-cover border-4 border-white/20 shadow-2xl 
                         transform group-hover:scale-105 transition-all duration-500" />
            <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg animate-bounce" style={{
            animationDuration: '2s'
          }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
          </div>
          
          {/* Artist Name */}
          <h1 className="text-3xl md:text-5xl font-bold text-center mb-2 bg-gradient-primary bg-clip-text text-transparent
                         animate-fade-in" style={{
          animationDelay: '0.2s'
        }}>
            {artistData.artistName}
          </h1>
          
          {/* Monthly Listeners */}
          <div className="flex items-center gap-2 text-muted-foreground mb-4 animate-fade-in" style={{
          animationDelay: '0.3s'
        }}>
            <Users className="w-4 h-4" />
            <span className="text-sm md:text-base">{artistData.monthlyListeners} monthly listeners</span>
          </div>
          
          {/* Play Button */}
          <Button onClick={handlePlayAll} className="btn-gradient-primary rounded-full px-8 py-6 text-lg font-semibold shadow-lg shadow-primary/30
                       hover:scale-105 hover:shadow-xl hover:shadow-primary/40 transition-all duration-300
                       animate-fade-in" style={{
          animationDelay: '0.4s'
        }} disabled={artistData.songs.length === 0}>
            <Play className="w-6 h-6 mr-2 fill-current" />
            Play All
          </Button>
        </div>
      </div>

      {/* Content Sections - Moved down with margin-top */}
      <div className="container mt-6 relative z-20 my-[35px] mx-0 py-[10px] px-[24px]">
        {/* About Section */}
        <Card className="glass p-6 mb-6 border-border/50 animate-fade-in" style={{
        animationDelay: '0.5s'
      }}>
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
            <Music2 className="w-5 h-5 text-primary" />
            About
          </h2>
          <p className="text-muted-foreground leading-relaxed">{artistData.bio}</p>
        </Card>

        {/* Achievements Section */}
        <Card className="glass p-6 mb-6 border-border/50 animate-fade-in" style={{
        animationDelay: '0.6s'
      }}>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-secondary" />
            Achievements
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {artistData.achievements.map((achievement, index) => <div key={index} className="glass p-3 rounded-xl text-center border border-border/30 
                           hover:border-primary/50 hover:shadow-glow-violet transition-all duration-300
                           transform hover:scale-105 cursor-default" style={{
            animationDelay: `${0.7 + index * 0.1}s`
          }}>
                <span className="text-sm font-medium">{achievement}</span>
              </div>)}
          </div>
        </Card>

        {/* Popular Tracks Section */}
        <div className="animate-fade-in" style={{
        animationDelay: '0.8s'
      }}>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <Disc3 className="w-6 h-6 text-primary" />
            Popular Tracks
          </h2>
          
          {artistData.songs.length === 0 ? <Card className="glass p-8 text-center border-border/50">
              <Music2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No tracks available</p>
            </Card> : <div className="space-y-3">
              {artistData.songs.map((song, index) => <Card key={song.id} className="glass p-3 md:p-4 border-border/50 hover:border-primary/50 
                             transition-all duration-300 cursor-pointer group
                             hover:shadow-lg hover:shadow-primary/10 hover:scale-[1.01]" onClick={() => handlePlaySong(song, index)} style={{
            animationDelay: `${0.9 + index * 0.05}s`
          }}>
                  <div className="flex items-center gap-3 md:gap-4">
                    {/* Track Number */}
                    <div className="w-8 text-center">
                      <span className="text-lg font-bold text-muted-foreground group-hover:hidden">
                        {index + 1}
                      </span>
                      <Play className="w-5 h-5 text-primary hidden group-hover:block mx-auto fill-current" />
                    </div>
                    
                    {/* Thumbnail */}
                    <div className="relative flex-shrink-0">
                      <img src={song.thumbnail} alt={song.title} className="w-12 h-12 md:w-14 md:h-14 rounded-lg object-cover shadow-md
                                   group-hover:shadow-lg group-hover:shadow-primary/20 transition-all" />
                      <div className="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 
                                      transition-opacity flex items-center justify-center">
                        <Play className="w-6 h-6 text-white fill-current" />
                      </div>
                    </div>
                    
                    {/* Song Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate text-sm md:text-base group-hover:text-primary transition-colors">
                        {song.title}
                      </h3>
                      <p className="text-xs md:text-sm text-muted-foreground truncate">{song.artist}</p>
                    </div>
                    
                    {/* Duration */}
                    {song.duration && <span className="text-sm text-muted-foreground hidden sm:block">
                        {formatDuration(song.duration)}
                      </span>}
                  </div>
                </Card>)}
            </div>}
        </div>
      </div>
    </div>;
}