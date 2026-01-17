import React, { useState, useEffect, useRef } from 'react';
import { Music, Search, Check, X, Sparkles, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import type { User } from 'firebase/auth';
import { fetchAndCacheArtistSongs, getCachedArtistSongs } from '@/services/artistDataService';
import { searchArtists as searchLastFmArtists, LastFmArtist } from '@/services/lastfmApi';
import { searchArtists as searchYouTubeArtists } from '@/services/youtubeApi';
import { useAuth } from '@/contexts/AuthContext';

interface Artist {
  id: string;
  name: string;
  thumbnail: string;
}

// Shuffle array utility
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

interface FavoriteArtistsSelectionProps {
  currentUser: User;
  onComplete: () => void;
}

// Normalize artist name to avoid duplicates
const normalizeArtistName = (name: string): string => {
  return name
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/Official$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Check if artist already exists (normalized comparison)
const isDuplicateArtist = (newName: string, existing: string[]): boolean => {
  const normalized = normalizeArtistName(newName).toLowerCase();
  return existing.some(name => normalizeArtistName(name).toLowerCase() === normalized);
};

export default function FavoriteArtistsSelection({ currentUser, onComplete }: FavoriteArtistsSelectionProps) {
  const { logout } = useAuth();
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Artist[]>([]);
  const [suggestions, setSuggestions] = useState<LastFmArtist[]>([]);
  const [popularArtists, setPopularArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPopularArtists();
  }, []);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getBestYouTubeArtist = async (name: string): Promise<Artist | null> => {
    try {
      const results = await searchYouTubeArtists(`${name} official artist`);
      if (!results || results.length === 0) return null;

      const normalizedTarget = normalizeArtistName(name).toLowerCase();
      const best = results.find((r: any) => normalizeArtistName(r.name).toLowerCase() === normalizedTarget) || results[0];

      return {
        id: best.id,
        name: normalizeArtistName(best.name),
        thumbnail: best.image || '',
      };
    } catch {
      return null;
    }
  };

  const loadPopularArtists = async () => {
    // First try to load from Firebase famous artists cache (same as home page)
    try {
      const famousArtistsDoc = await getDoc(doc(db, 'StaticMusicData', 'famousArtists'));
      
      if (famousArtistsDoc.exists() && famousArtistsDoc.data().artists?.length > 0) {
        const cachedArtists = famousArtistsDoc.data().artists as any[];
        
        // Convert to Artist format and shuffle
        const converted: Artist[] = cachedArtists.map((a: any, i: number) => ({
          id: a.id || `artist-${i}`,
          name: a.name,
          thumbnail: a.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&size=200&background=8b5cf6&color=fff&bold=true`,
        }));
        
        // Shuffle for variety each time
        const shuffled = shuffleArray(converted);
        setPopularArtists(shuffled.slice(0, 40)); // Show up to 40 shuffled artists
        console.log('✅ [FavArtists] Loaded from Firebase famous artists cache');
        return;
      }
    } catch (e) {
      console.warn('⚠️ [FavArtists] Could not read famous artists cache');
    }
    
    // Fallback: Try cached popular artist images
    try {
      const cachedDoc = await getDoc(doc(db, 'StaticMusicData', 'popularArtistImages'));

      if (cachedDoc.exists() && cachedDoc.data().artists?.length > 0) {
        const cached = cachedDoc.data().artists as Artist[];
        const looksLikeInitialsOnly = cached.every((a) => (a.thumbnail || '').includes('ui-avatars.com'));

        if (!looksLikeInitialsOnly) {
          setPopularArtists(shuffleArray(cached).slice(0, 40)); // Show up to 40 artists
          return;
        }
      }
    } catch (e) {
      console.warn('No cached artist images, will show fallback');
    }

    // Last resort: Generate placeholder avatars
    const defaultArtists = [
      'Taylor Swift', 'Ed Sheeran', 'The Weeknd', 'Ariana Grande', 'Billie Eilish',
      'Bruno Mars', 'Lana Del Rey', 'Alan Walker', 'Coldplay', 'Bad Bunny',
      'Arijit Singh', 'A. R. Rahman', 'Anirudh Ravichander', 'Pritam', 'Shreya Ghoshal'
    ];
    
    const artistsWithImages: Artist[] = defaultArtists.map((name, i) => ({
      id: `default-${i}`,
      name,
      thumbnail: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=200&background=8b5cf6&color=fff&bold=true`,
    }));

    setPopularArtists(shuffleArray(artistsWithImages));
  };
  
  const handleBackToLogin = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  // Suggestions: Last.fm for breadth, but we dedupe + only show artist name (no images/listeners)
  const fetchSuggestions = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const artists = await searchLastFmArtists(query, 12);

      const seen = new Set<string>();
      const deduped = artists.filter((a) => {
        const key = normalizeArtistName(a.name).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setSuggestions(deduped);
      setShowSuggestions(deduped.length > 0);
    } catch (error) {
      console.warn('Last.fm suggestions failed');
      setSuggestions([]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    fetchSuggestions(value);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // Search (YouTube for images) - show only 1 best match
  const searchArtist = async (query: string): Promise<Artist[]> => {
    const yt = await getBestYouTubeArtist(query);
    if (!yt) return [];

    return [
      {
        id: yt.id,
        name: normalizeArtistName(query),
        thumbnail: yt.thumbnail,
      },
    ];
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setShowSuggestions(false);
    const results = await searchArtist(searchQuery);
    setSearchResults(results);
    setSearching(false);
  };

  const handleSuggestionClick = async (suggestion: LastFmArtist) => {
    setSearchQuery(suggestion.name);
    setShowSuggestions(false);
    setSearching(true);

    // Always use YouTube for the artist image (Last.fm is just for suggestion breadth)
    const results = await searchArtist(suggestion.name);
    setSearchResults(results);
    setSearching(false);
  };

  const toggleArtist = (artistName: string) => {
    const normalizedName = normalizeArtistName(artistName);
    
    if (selectedArtists.some(a => normalizeArtistName(a).toLowerCase() === normalizedName.toLowerCase())) {
      setSelectedArtists(prev => prev.filter(a => 
        normalizeArtistName(a).toLowerCase() !== normalizedName.toLowerCase()
      ));
    } else {
      if (selectedArtists.length >= 4) {
        toast.error('Maximum 4 artists allowed');
        return;
      }
      if (isDuplicateArtist(normalizedName, selectedArtists)) {
        toast.error('Artist already selected');
        return;
      }
      setSelectedArtists(prev => [...prev, normalizedName]);
    }
  };

  const isArtistSelected = (artistName: string): boolean => {
    const normalized = normalizeArtistName(artistName).toLowerCase();
    return selectedArtists.some(a => normalizeArtistName(a).toLowerCase() === normalized);
  };

  // Cache songs for selected artists
  const cacheArtistSongs = async (artistNames: string[]) => {
    console.log('🎵 [FavArtists] Caching songs for selected artists...');
    
    for (const artistName of artistNames) {
      try {
        const cached = await getCachedArtistSongs(artistName);
        if (cached && cached.songs?.length >= 10) {
          console.log(`✅ [FavArtists] ${artistName} already cached, skipping`);
          continue;
        }
        
        await fetchAndCacheArtistSongs(artistName);
        console.log(`✅ [FavArtists] Cached songs for ${artistName}`);
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.warn(`⚠️ [FavArtists] Failed to cache ${artistName}:`, error);
      }
    }
  };

  const handleSubmit = async () => {
    if (selectedArtists.length < 1) {
      toast.error('Please select at least 1 artist');
      return;
    }

    if (!currentUser) return;

    setLoading(true);
    try {
      toast.info('Preparing your personalized recommendations...', { duration: 3000 });
      await cacheArtistSongs(selectedArtists);
      
      // Use setDoc with merge to create/update the user document
      await setDoc(doc(db, 'Users', currentUser.uid), {
        favoriteArtists: selectedArtists,
        email: currentUser.email,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      
      // Clear in-memory home cache so recommendations load immediately
      if (typeof window !== 'undefined') {
        (window as any).__homeDataCache = null;
      }
      
      toast.success('Favorite artists saved!');
      onComplete();
    } catch (error) {
      console.error('Error saving artists:', error);
      toast.error('Failed to save artists. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-dark flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl p-4 md:p-8 bg-card/90 backdrop-blur-glass border-border animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToLogin}
          className="mb-4 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Login
        </Button>
        
        <div className="flex flex-col items-center mb-4 md:mb-6">
          <div className="relative">
            <Music className="w-10 h-10 md:w-12 md:h-12 text-primary mb-2 md:mb-3 animate-glow-pulse" />
            <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-secondary animate-pulse" />
          </div>
          <h1 className="text-xl md:text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent text-center">
            Choose Your Favorite Artists
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-2 text-center">
            Select 1-4 artists for personalized recommendations ({selectedArtists.length}/4)
          </p>
        </div>

        {/* Selected Artists Pills */}
        {selectedArtists.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4 animate-fade-in">
            {selectedArtists.map((artist) => (
              <div
                key={artist}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary/20 border border-primary rounded-full text-sm"
              >
                <span>{artist}</span>
                <X
                  className="w-4 h-4 cursor-pointer hover:text-destructive transition-colors"
                  onClick={() => toggleArtist(artist)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Search Bar with Suggestions */}
        <div className="mb-4 md:mb-6 relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={handleInputChange}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Search for artists..."
                className="pl-10 pr-10 bg-input border-border text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Button onClick={handleSearch} disabled={searching} className="bg-primary hover:bg-primary/90 text-sm">
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </div>
          
          {/* Suggestions Dropdown - Last.fm names only (no image/listeners) */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              className="absolute z-50 top-full left-0 right-16 mt-1 bg-card border border-border rounded-lg shadow-xl overflow-hidden animate-fade-in max-h-64 overflow-y-auto"
            >
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="px-4 py-3 cursor-pointer hover:bg-primary/10 transition-colors"
                >
                  <p className="text-sm font-medium truncate">{normalizeArtistName(suggestion.name)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search Results - Single Result */}
        {searchResults.length > 0 && (
          <div className="mb-4 md:mb-6 animate-fade-in">
            <h3 className="text-xs md:text-sm font-semibold mb-2 md:mb-3 text-foreground">Search Result</h3>
            <div className="flex justify-center">
              {searchResults.map((artist) => (
                <Card
                  key={artist.id}
                  onClick={() => toggleArtist(artist.name)}
                  className={`cursor-pointer p-4 text-center transition-all hover:scale-105 w-40 ${
                    isArtistSelected(artist.name)
                      ? 'bg-primary/20 border-primary ring-2 ring-primary/50'
                      : 'bg-card/50 border-border'
                  }`}
                >
                  <div className="relative">
                    {artist.thumbnail ? (
                      <img
                        src={artist.thumbnail}
                        alt={artist.name}
                        className="w-full aspect-square object-cover rounded-lg mb-2"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(artist.name)}&size=200&background=8b5cf6&color=fff`;
                        }}
                      />
                    ) : (
                      <div className="w-full aspect-square bg-muted rounded-lg mb-2 flex items-center justify-center">
                        <Music className="w-10 h-10 text-muted-foreground" />
                      </div>
                    )}
                    {isArtistSelected(artist.name) && (
                      <div className="absolute top-1 right-1 bg-primary rounded-full p-1 shadow-lg">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium truncate">{artist.name}</p>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Popular Artists */}
        <div>
          <h3 className="text-xs md:text-sm font-semibold mb-2 md:mb-3 text-foreground">Popular Artists</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 md:gap-3 max-h-[300px] md:max-h-[400px] overflow-y-auto">
            {popularArtists.map((artist, index) => (
              <Card
                key={artist.id}
                onClick={() => toggleArtist(artist.name)}
                className={`cursor-pointer p-2 md:p-3 text-center transition-all hover:scale-105 animate-fade-in ${
                  isArtistSelected(artist.name)
                    ? 'bg-primary/20 border-primary ring-2 ring-primary/50'
                    : 'bg-card/50 border-border'
                }`}
                style={{ animationDelay: `${index * 0.03}s` }}
              >
                <div className="relative">
                  <img
                    src={artist.thumbnail}
                    alt={artist.name}
                    className="w-full aspect-square object-cover rounded-md md:rounded-lg mb-1 md:mb-2"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(artist.name)}&size=200&background=8b5cf6&color=fff`;
                    }}
                  />
                  {isArtistSelected(artist.name) && (
                    <div className="absolute top-0 right-0 bg-primary rounded-full p-0.5 md:p-1 shadow-lg">
                      <Check className="w-3 h-3 md:w-4 md:h-4 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] md:text-xs font-medium truncate">{artist.name}</p>
              </Card>
            ))}
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={selectedArtists.length < 1 || loading}
          variant="vibrant"
          className="w-full mt-4 md:mt-6 text-sm md:text-base py-6 rounded-xl"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Preparing your music...
            </span>
          ) : (
            `Continue (${selectedArtists.length} selected)`
          )}
        </Button>
      </Card>
    </div>
  );
}
