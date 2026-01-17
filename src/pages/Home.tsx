import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatDuration } from '@/services/youtubeApi';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getOrRefreshHomeData, getOrRefreshRecommendations } from '@/services/homeDataService';
import { startDailyRefreshScheduler } from '@/services/dailyRefresh';

// Shuffle array utility
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

interface Artist {
  id: string;
  name: string;
  image: string;
}

// Memoized SongCard to prevent re-renders
const SongCard = memo(({ song, onClick, index }: { song: Song; onClick: () => void; index?: number }) => (
  <Card 
    className="flex-shrink-0 w-36 bg-card/50 backdrop-blur border-border hover:bg-card/80 
               transition-all duration-300 cursor-pointer group hover:scale-105 hover:shadow-lg hover:shadow-primary/20
               animate-fade-in"
    style={{ animationDelay: `${(index || 0) * 0.05}s` }}
    onClick={onClick}
  >
    <div className="relative overflow-hidden rounded-t">
      <img 
        src={song.thumbnail} 
        alt={song.title}
        className="w-full h-36 object-cover transition-transform duration-500 group-hover:scale-110"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent 
                      opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
        <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/50
                        transform scale-75 group-hover:scale-100 transition-transform duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
    </div>
    <div className="p-2">
      <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{song.title}</h3>
      <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
      {song.duration && (
        <p className="text-xs text-muted-foreground mt-1">{formatDuration(song.duration)}</p>
      )}
    </div>
  </Card>
));

SongCard.displayName = 'SongCard';

// Memoized ArtistCard to prevent re-renders
const ArtistCard = memo(({ artist, onClick, index }: { artist: Artist; onClick: () => void; index?: number }) => (
  <div 
    className="flex-shrink-0 w-32 cursor-pointer group animate-fade-in"
    style={{ animationDelay: `${(index || 0) * 0.05}s` }}
    onClick={onClick}
  >
    <div className="relative mb-2">
      {/* Glow effect */}
      <div className="absolute -inset-1 bg-gradient-to-r from-primary to-secondary rounded-full opacity-0 
                      group-hover:opacity-60 blur-lg transition-all duration-500" />
      <img 
        src={artist.image} 
        alt={artist.name}
        className="relative w-32 h-32 rounded-full object-cover border-2 border-primary/20 
                   group-hover:border-primary group-hover:scale-105 transition-all duration-300
                   shadow-lg group-hover:shadow-xl group-hover:shadow-primary/30"
        loading="lazy"
      />
      {/* Play overlay */}
      <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 
                      transition-all duration-300 flex items-center justify-center">
        <Play className="w-10 h-10 text-white fill-white" />
      </div>
    </div>
    <p className="text-sm font-medium text-center truncate group-hover:text-primary transition-colors">{artist.name}</p>
  </div>
));

ArtistCard.displayName = 'ArtistCard';

// In-memory cache to prevent refetch on navigation (exposed globally for clearing)
let homeDataCache: {
  trending: Song[];
  global: Song[];
  regional: Song[];
  artists: Artist[];
  recommended: Song[];
  userId: string | null;
} | null = null;

// Expose cache clearing for FavoriteArtistsSelection
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__homeDataCache', {
    get: () => homeDataCache,
    set: (val) => { homeDataCache = val; },
    configurable: true,
  });
}

export default function Home() {
  const { playSong, setQueue } = useMusicPlayer();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [trendingSongs, setTrendingSongs] = useState<Song[]>([]);
  const [recommendedSongs, setRecommendedSongs] = useState<Song[]>([]);
  const [globalHits, setGlobalHits] = useState<Song[]>([]);
  const [regionalHits, setRegionalHits] = useState<Song[]>([]);
  const [famousArtists, setFamousArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);

  // Start daily refresh scheduler ONLY ONCE per app instance
  useEffect(() => {
    if (!(window as any).__dailyRefreshStarted) {
      (window as any).__dailyRefreshStarted = true;
      startDailyRefreshScheduler();
      console.log('✅ [Home] Daily refresh scheduler started (single instance)');
    }
  }, []);

  useEffect(() => {
    const fetchContent = async () => {
      // Use cached data if available for same user (prevents refetch on navigation)
      if (homeDataCache && homeDataCache.userId === (currentUser?.uid || null)) {
        console.log('💰 [Home] Using in-memory cache - no fetch');
        setTrendingSongs(homeDataCache.trending);
        setGlobalHits(homeDataCache.global);
        setRegionalHits(homeDataCache.regional);
        setFamousArtists(homeDataCache.artists);
        setRecommendedSongs(homeDataCache.recommended);
        setLoading(false);
        return;
      }
      
      const timeout = setTimeout(() => {
        console.warn('⏱️ [Home] Loading timeout - showing empty state');
        setLoading(false);
      }, 10000);
      
      try {
        setLoading(true);
        console.log('🏠 [Home] Starting data fetch...');
        
        // Only read from Firebase - never refresh automatically
        const homeData = await getOrRefreshHomeData().catch((err) => {
          console.error('❌ [Home] Failed to get home data:', err);
          return {
            trending: [],
            global: [],
            regional: [],
            artists: [],
            lastUpdated: null,
            date: new Date().toISOString().split('T')[0]
          };
        });
        
        console.log(`✅ [Home] Got home data: ${homeData.trending.length} trending, ${homeData.regional.length} regional`);
        
        setTrendingSongs(homeData.trending || []);
        setGlobalHits(homeData.global || []);
        setRegionalHits(homeData.regional || []);
        setFamousArtists(homeData.artists || []);
        
        let recSongs: Song[] = [];
        // Get user's favorite artists for recommendations
        if (currentUser) {
          try {
            const userDoc = await getDoc(doc(db, 'Users', currentUser.uid));
            const favoriteArtists = userDoc.data()?.favoriteArtists || [];
            
            if (favoriteArtists.length > 0) {
              const artistNames = favoriteArtists.filter((a: any) => a && typeof a === 'string');
              if (artistNames.length > 0) {
                recSongs = await getOrRefreshRecommendations(currentUser.uid, artistNames).catch(() => []);
                setRecommendedSongs(recSongs);
              }
            }
          } catch (error) {
            console.warn('⚠️ [Home] Error fetching recommendations:', error);
          }
        }
        
        // Cache results in memory
        homeDataCache = {
          trending: homeData.trending || [],
          global: homeData.global || [],
          regional: homeData.regional || [],
          artists: homeData.artists || [],
          recommended: recSongs,
          userId: currentUser?.uid || null
        };
        
        console.log('✅ [Home] Data fetch complete + cached');
      } catch (error) {
        console.error('❌ [Home] Error in fetchContent:', error);
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    };

    fetchContent();
  }, [currentUser?.uid]); // Only re-fetch when user ID changes

  // Memoized handlers to prevent child re-renders
  const handlePlaySong = useCallback((song: Song, allSongs: Song[]) => {
    // Play from home source - enables recommendations
    playSong(song, 'home');
    // Don't set queue so recommendations work
  }, [playSong]);

  const handleArtistClick = useCallback((artist: Artist) => {
    navigate(`/artist/${encodeURIComponent(artist.name)}`);
  }, [navigate]);

  // Shuffle songs on component mount (one-time shuffle per session)
  const shuffledOnceRef = useRef(false);
  
  // Memoize song lists with shuffle for trending/regional - LIMITS: 30 for sections, 25 for recommended
  const memoizedTrending = useMemo(() => {
    if (!shuffledOnceRef.current && trendingSongs.length > 0) {
      return shuffleArray(trendingSongs).slice(0, 30);
    }
    return trendingSongs.slice(0, 30);
  }, [trendingSongs]);
  
  const memoizedGlobal = useMemo(() => globalHits.slice(0, 30), [globalHits]);
  
  const memoizedRegional = useMemo(() => {
    if (!shuffledOnceRef.current && regionalHits.length > 0) {
      shuffledOnceRef.current = true; // Mark as shuffled after first render
      return shuffleArray(regionalHits).slice(0, 30);
    }
    return regionalHits.slice(0, 30);
  }, [regionalHits]);
  
  const memoizedRecommended = useMemo(() => recommendedSongs.slice(0, 25), [recommendedSongs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-fade-in flex flex-col items-center gap-4">
          <div className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            SoulSync
          </div>
          <div className="flex gap-2">
            <div className="w-3 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
            <div className="w-3 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
            <div className="w-3 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
          </div>
          <p className="text-sm text-muted-foreground">Loading your music...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-32 animate-fade-in bg-background">
      <h1 className="text-3xl font-bold mb-6 bg-gradient-primary bg-clip-text text-transparent">
        Home
      </h1>

      {/* Top Trending Section */}
      <section className="mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
          <span className="w-1 h-6 bg-gradient-to-b from-primary to-secondary rounded-full" />
          Top Trending
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
          {memoizedTrending.map((song, index) => (
            <SongCard 
              key={song.id}
              song={song}
              index={index}
              onClick={() => handlePlaySong(song, memoizedTrending)}
            />
          ))}
        </div>
      </section>

      {/* Recommended For You Section */}
      {memoizedRecommended.length > 0 && (
        <section className="mb-8 animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-6 bg-gradient-to-b from-secondary to-primary rounded-full" />
            Recommended For You
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
            {memoizedRecommended.map((song, index) => (
              <SongCard 
                key={song.id}
                song={song}
                index={index}
                onClick={() => handlePlaySong(song, memoizedRecommended)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Global Hit Songs Section */}
      <section className="mb-8 animate-fade-in" style={{ animationDelay: '0.3s' }}>
        <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
          <span className="w-1 h-6 bg-gradient-to-b from-primary to-secondary rounded-full" />
          Global Hit Songs
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
          {memoizedGlobal.map((song, index) => (
            <SongCard 
              key={song.id}
              song={song}
              index={index}
              onClick={() => handlePlaySong(song, memoizedGlobal)}
            />
          ))}
        </div>
      </section>

      {/* Famous Artists Section */}
      <section className="mb-8 animate-fade-in" style={{ animationDelay: '0.4s' }}>
        <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
          <span className="w-1 h-6 bg-gradient-to-b from-secondary to-primary rounded-full" />
          Famous Artists
        </h2>
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
          {famousArtists.map((artist, index) => (
            <ArtistCard 
              key={artist.id}
              artist={artist}
              index={index}
              onClick={() => handleArtistClick(artist)}
            />
          ))}
        </div>
      </section>

      {/* Regional Hits Section */}
      <section className="mb-8 animate-fade-in" style={{ animationDelay: '0.5s' }}>
        <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
          <span className="w-1 h-6 bg-gradient-to-b from-primary to-secondary rounded-full" />
          Regional Hits
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
          {memoizedRegional.map((song, index) => (
            <SongCard 
              key={song.id}
              song={song}
              index={index}
              onClick={() => handlePlaySong(song, memoizedRegional)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
