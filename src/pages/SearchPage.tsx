import { useState, useEffect, useRef } from 'react';
import { Search, Play, Clock, TrendingUp, X, Plus, Radio, Info, Zap, Server } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { useAuth } from '@/contexts/AuthContext';
import { searchSongs } from '@/services/searchService';
import { formatDuration, isYouTubeApiExhausted } from '@/services/youtubeApi';
import { getSearchSuggestions } from '@/services/searchSuggestionsApi';
import { getCachedSearch, setCachedSearch, cleanupExpiredCache } from '@/services/searchCacheService';
import { collection, addDoc, getDocs, query as firestoreQuery, orderBy, limit, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useNavigate } from 'react-router-dom';

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

export default function SearchPage() {
  const activeSearchId = useRef(0);
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [slowSearch, setSlowSearch] = useState(false);
  const [searchMode, setSearchMode] = useState<'fast' | 'slow'>(() => 
    isYouTubeApiExhausted() ? 'slow' : 'fast'
  );
  const [apiExhausted, setApiExhausted] = useState(isYouTubeApiExhausted());
  const { playSong, setQueue, activeRoomId, addToRoomQueue, playSongInRoom } =
    useMusicPlayer();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const inRoom = Boolean(activeRoomId);

  useEffect(() => {
    loadRecentSearches();
    // Check API status periodically
    const checkApi = () => {
      const exhausted = isYouTubeApiExhausted();
      setApiExhausted(exhausted);
      if (exhausted && searchMode === 'fast') {
        setSearchMode('slow');
      }
    };
    checkApi();
    const interval = setInterval(checkApi, 30000);
    
    // Cleanup expired cache entries on mount
    if (currentUser) {
      cleanupExpiredCache(currentUser.uid).catch(() => {});
    }
    
    return () => clearInterval(interval);
  }, [currentUser]);

  const loadRecentSearches = async () => {
    if (!currentUser) return;

    try {
      console.log(
        `📂 [Search] Loading recent searches for user ${currentUser.uid.slice(0, 8)}...`
      );
      const searchesRef = collection(db, 'Users', currentUser.uid, 'recentSearches');
      // Increased limit from 5 to 10
      const q = firestoreQuery(searchesRef, orderBy('timestamp', 'desc'), limit(10));
      const snapshot = await getDocs(q);

      const searches = snapshot.docs.map(
        (docSnap) => (docSnap.data() as { query: string }).query
      );
      console.log(`✅ [Search] Loaded ${searches.length} recent searches`);
      setRecentSearches(searches);
    } catch (error) {
      console.error('❌ [Search] Error loading recent searches:', error);
    }
  };

  const saveSearch = async (searchQuery: string) => {
    if (!currentUser || !searchQuery.trim()) return;

    try {
      console.log(`💾 [Search] Saving search: "${searchQuery}"`);
      const searchesRef = collection(db, 'Users', currentUser.uid, 'recentSearches');
      const q = firestoreQuery(searchesRef, orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(q);

      const existingSearch = snapshot.docs.find(
        (docSnap) =>
          docSnap.data().query.toLowerCase() === searchQuery.toLowerCase()
      );

      if (existingSearch) {
        console.log(`♻️ [Search] Duplicate found - moving to top`);
        await deleteDoc(existingSearch.ref);
      }

      // Keep max 10 recent searches
      const currentCount = existingSearch
        ? snapshot.docs.length - 1
        : snapshot.docs.length;
      if (currentCount >= 10) {
        const oldestDoc = snapshot.docs[snapshot.docs.length - 1];
        if (oldestDoc.id !== existingSearch?.id) {
          console.log(`🗑️ [Search] Removing oldest search`);
          await deleteDoc(oldestDoc.ref);
        }
      }

      await addDoc(searchesRef, {
        query: searchQuery,
        timestamp: Timestamp.now(),
      });

      console.log(`✅ [Search] Saved successfully`);
      loadRecentSearches();
    } catch (error) {
      console.error('❌ [Search] Error saving:', error);
    }
  };

  const removeRecentSearch = async (searchQuery: string) => {
    if (!currentUser) return;

    try {
      console.log(`🗑️ [Search] Removing recent search: "${searchQuery}"`);
      const searchesRef = collection(db, 'Users', currentUser.uid, 'recentSearches');
      const q = firestoreQuery(searchesRef);
      const snapshot = await getDocs(q);

      const searchToDelete = snapshot.docs.find(
        (doc) => doc.data().query === searchQuery
      );

      if (searchToDelete) {
        await deleteDoc(searchToDelete.ref);
        console.log(`✅ [Search] Removed successfully`);
        loadRecentSearches();
      }
    } catch (error) {
      console.error('❌ [Search] Error removing:', error);
    }
  };

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setSearchError(null);
      setLoading(false);
      return;
    }

    const searchId = ++activeSearchId.current; // track this request

    setLoading(true);
    setSlowSearch(false);
    setSearchError(null);
    setShowSuggestions(false);
    inputRef.current?.blur();

    try {
      // Check Firebase cache first
      if (currentUser) {
        const cached = await getCachedSearch(currentUser.uid, searchQuery, searchMode);
        if (cached && cached.songs.length > 0) {
          if (searchId !== activeSearchId.current) return;
          console.log('[Search] Using cached results for:', searchQuery);
          setResults(cached.songs.slice(0, 10));
          setSlowSearch(false);
          setSearchError(null);
          setLoading(false);
          saveSearch(searchQuery);
          return;
        }
      }

      const result = await searchSongs(searchQuery, searchMode);

      // Ignore outdated responses
      if (searchId !== activeSearchId.current) return;

      const songs = (result.songs || []).slice(0, 10);
      setResults(songs);
      setSlowSearch(result.source === 'ytdlp' && result.slow);
      setSearchError(result.error || (songs.length === 0 ? 'No results found.' : null));

      if (!result.error && songs.length > 0 && currentUser) {
        // Save to Firebase cache
        await setCachedSearch(
          currentUser.uid,
          searchQuery,
          searchMode,
          songs,
          result.source || 'youtube'
        );
        saveSearch(searchQuery);
      }
    } catch (error) {
      if (searchId !== activeSearchId.current) return;
      setResults([]);
      setSearchError('Search failed. Please try again.');
    } finally {
      if (searchId === activeSearchId.current) {
        setLoading(false);
      }
    }
  };


  const handleQueryChange = (value: string) => {
    setQuery(value);

    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
    }

    if (value.trim().length >= 2) {
      setShowSuggestions(true);
      suggestionTimerRef.current = setTimeout(async () => {
        setLoadingSuggestions(true);
        const sug = await getSearchSuggestions(value);
        setSuggestions(sug);
        setLoadingSuggestions(false);
      }, 300);
    } else {
      setResults([]);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handlePlaySong = (song: Song) => {
    if (inRoom) {
      addToRoomQueue(song);
      navigate('/rooms');
      return;
    }

    // Play from search source - enables recommendations
    playSong(song, 'search');
    // Don't set queue so recommendations work
  };

  const handlePlayNow = (song: Song) => {
    if (inRoom) {
      playSongInRoom(song);
      navigate('/rooms');
      return;
    }

    playSong(song, 'search');
  };

  return (
    <div className="p-4 pb-44 animate-fade-in bg-background">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold mb-3 md:mb-4 bg-gradient-primary bg-clip-text text-transparent">
          Search
        </h1>

        <div className="flex flex-wrap items-center gap-2 mb-4 animate-fade-in">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={searchMode === 'fast' ? 'default' : 'outline'}
              onClick={() => !apiExhausted && setSearchMode('fast')}
              disabled={apiExhausted}
              className={`hover-scale transition-all duration-300 ${
                searchMode === 'fast' 
                  ? 'bg-gradient-to-r from-primary to-primary/80 shadow-lg shadow-primary/25' 
                  : 'hover:border-primary/50'
              } ${apiExhausted ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Zap className={`w-3.5 h-3.5 mr-1.5 ${searchMode === 'fast' ? 'animate-pulse' : ''}`} />
              Quick
            </Button>
            <Button
              type="button"
              size="sm"
              variant={searchMode === 'slow' ? 'default' : 'outline'}
              onClick={() => setSearchMode('slow')}
              className={`hover-scale transition-all duration-300 ${
                searchMode === 'slow' 
                  ? 'bg-gradient-to-r from-secondary to-secondary/80 shadow-lg shadow-secondary/25' 
                  : 'hover:border-secondary/50'
              }`}
            >
              <Server className="w-3.5 h-3.5 mr-1.5" />
              Extended
            </Button>
          </div>
          {/* Search mode help text (visible on mobile too) */}
          <p className="text-[11px] text-muted-foreground leading-snug sm:text-xs">
            {searchMode === 'fast'
              ? 'Quick: Faster results and better performance than extended.'
              : 'Extended: Backup mode when Quick is unavailable — slower.'}
          </p>
          {apiExhausted && (
            <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20 animate-fade-in">
              High server load — Extended search only
            </span>
          )}
        </div>

        {inRoom && (
          <Card className="bg-primary/10 border-primary/20 p-3 mb-4 flex items-center gap-3">
            <Radio className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">You're in a music room</p>
              <p className="text-xs text-muted-foreground">
                Songs you select will be added to the room queue
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/rooms')}
              className="shrink-0"
            >
              Go to Room
            </Button>
          </Card>
        )}

        
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSearch(query); }} 
          className="relative mb-4 md:mb-6"
          onKeyDown={(e) => {
            // Handle Enter key from anywhere in the form (touchpad, keyboard)
            if (e.key === 'Enter' && query.trim()) {
              e.preventDefault();
              handleSearch(query);
            }
          }}
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
          <Input 
            ref={inputRef}
            value={query} 
            onChange={(e) => handleQueryChange(e.target.value)} 
            onFocus={() => setShowSuggestions(true)} 
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} 
            placeholder="Search songs, artists..." 
            className="pl-12 pr-10 py-5 md:py-6 text-base bg-card border-border rounded-xl" 
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                setSearchError(null);
                setLoading(false); // prevent stuck spinner
              }}

              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          
          {showSuggestions && !results.length && (
            <Card className="absolute z-50 w-full mt-2 p-2 bg-card border-border animate-fade-in max-h-80 overflow-y-auto shadow-xl">
              {suggestions.length > 0 && (
                <>
                  <div className="px-3 py-2 text-xs text-muted-foreground font-semibold flex items-center gap-2">
                    <TrendingUp className="w-3 h-3" />
                    Suggestions
                  </div>
                  {suggestions.slice(0, 5).map((suggestion, i) => (
                    <div 
                      key={`sug-${i}`}
                      onClick={() => { setQuery(suggestion); handleSearch(suggestion); setShowSuggestions(false); }} 
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted rounded-lg cursor-pointer transition-colors"
                    >
                      <Search className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{suggestion}</span>
                    </div>
                  ))}
                </>
              )}
              
              {recentSearches.length > 0 && (
                <>
                  <div className="px-3 py-2 text-xs text-muted-foreground font-semibold flex items-center gap-2 mt-2">
                    <Clock className="w-3 h-3" />
                    Recent
                  </div>
                  {/* Display up to 10 recent searches */}
                  {recentSearches.slice(0, 10).map((search, i) => (
                    <div 
                      key={`recent-${i}`}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted rounded-lg group transition-colors"
                    >
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span 
                        onClick={() => { setQuery(search); handleSearch(search); setShowSuggestions(false); }}
                        className="text-sm flex-1 cursor-pointer"
                      >
                        {search}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeRecentSearch(search); }}
                        className="p-1 hover:bg-muted-foreground/10 rounded text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </Card>
          )}
        </form>
        
        {loading && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
              {[...Array(10)].map((_, i) => (
                <Card key={i} className="bg-card border-border overflow-hidden">
                  <Skeleton className="aspect-square w-full" />
                  <div className="p-2 space-y-1">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-2 w-2/3" />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
        
        {slowSearch && results.length > 0 && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-muted/30 text-sm text-muted-foreground animate-fade-in">
            <Info className="w-4 h-4 shrink-0" />
            <span>High load on server. Search may take a few seconds.</span>
          </div>
        )}
        
        {!loading && query.trim() && results.length === 0 && !showSuggestions && (
          <Card className="p-4 mb-4 bg-card border-border animate-fade-in">
            <p className="text-sm font-medium">No results</p>
            <p className="text-xs text-muted-foreground mt-1">
              {searchError || 'Try a different search term.'}
            </p>
          </Card>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3 animate-fade-in">
            {results.map((song) => (
              <Card 
                key={song.id} 
                className="group bg-card border-border hover:bg-card/80 cursor-pointer transition-all hover:scale-[1.02] overflow-hidden"
              >
                <div className="aspect-square relative overflow-hidden" onClick={() => handlePlaySong(song)}>
                  <img 
                    src={song.thumbnail} 
                    alt={song.title} 
                    className="w-full h-full object-cover" 
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-2">
                    {inRoom ? (
                      <>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handlePlayNow(song); }}
                          className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
                        >
                          <Play className="w-5 h-5 text-white ml-0.5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handlePlaySong(song); }}
                          className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
                        >
                          <Plus className="w-5 h-5 text-white" />
                        </button>
                      </>
                    ) : (
                      <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg">
                        <Play className="w-6 h-6 text-white ml-0.5" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-2">
                  <h3 className="font-semibold text-xs mb-0.5 line-clamp-2 leading-tight">{song.title}</h3>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{song.artist}</p>
                  {song.duration && (
                    <p className="text-[10px] text-muted-foreground mt-1">{formatDuration(song.duration)}</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
