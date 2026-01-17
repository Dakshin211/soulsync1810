// Firebase Firestore service for storing and retrieving daily home content
import { doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { searchYouTube, getTrendingSongs, searchArtists } from './youtubeApi';
import { getRecommendationsFromArtists, getCachedArtistSongs } from './artistDataService';

// Static data for trending songs (user requested songs + popular)
const STATIC_TRENDING = [
  { title: "They Call This Love", artist: "Lana Del Rey" },
  { title: "Apocalypse", artist: "Cigarettes After Sex" },
  { title: "Back to Friends", artist: "Lauren Spencer Smith" },
  { title: "End of Beginning", artist: "Djo" },
  { title: "Sailor Song", artist: "Gigi Perez" },
  { title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars" },
  { title: "APT.", artist: "ROSÉ & Bruno Mars" },
  { title: "luther", artist: "Kendrick Lamar & SZA" },
  { title: "Birds of a Feather", artist: "Billie Eilish" },
  { title: "Taste", artist: "Sabrina Carpenter" },
  { title: "Good Luck Babe", artist: "Chappell Roan" },
  { title: "Espresso", artist: "Sabrina Carpenter" },
  { title: "Please Please Please", artist: "Sabrina Carpenter" },
  { title: "Not Like Us", artist: "Kendrick Lamar" },
  { title: "Beautiful Things", artist: "Benson Boone" },
  { title: "Lose Control", artist: "Teddy Swims" },
  { title: "We Can't Be Friends", artist: "Ariana Grande" },
  { title: "Too Sweet", artist: "Hozier" },
  { title: "I Had Some Help", artist: "Post Malone ft. Morgan Wallen" },
  { title: "Austin", artist: "Dasha" }
];

// Static data for global hits (REAL famous songs that everyone knows)
const STATIC_GLOBAL_HITS = [
  { title: "Blinding Lights", artist: "The Weeknd" },
  { title: "Shape of You", artist: "Ed Sheeran" },
  { title: "Starboy", artist: "The Weeknd" },
  { title: "Faded", artist: "Alan Walker" },
  { title: "Someone Like You", artist: "Adele" },
  { title: "Believer", artist: "Imagine Dragons" },
  { title: "Despacito", artist: "Luis Fonsi ft. Daddy Yankee" },
  { title: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars" },
  { title: "See You Again", artist: "Wiz Khalifa ft. Charlie Puth" },
  { title: "Hello", artist: "Adele" },
  { title: "Perfect", artist: "Ed Sheeran" },
  { title: "Counting Stars", artist: "OneRepublic" },
  { title: "Closer", artist: "The Chainsmokers ft. Halsey" },
  { title: "Havana", artist: "Camila Cabello" },
  { title: "Stay", artist: "The Kid LAROI & Justin Bieber" },
  { title: "Levitating", artist: "Dua Lipa" },
  { title: "drivers license", artist: "Olivia Rodrigo" },
  { title: "Heat Waves", artist: "Glass Animals" },
  { title: "bad guy", artist: "Billie Eilish" },
  { title: "As It Was", artist: "Harry Styles" }
];

// Regional hits (India) - Popular Bollywood/Hindi songs
const STATIC_REGIONAL_HITS = [
  { title: "Kesariya", artist: "Arijit Singh" },
  { title: "Raataan Lambiyan", artist: "Jubin Nautiyal & Asees Kaur" },
  { title: "Tum Hi Ho", artist: "Arijit Singh" },
  { title: "Apna Bana Le", artist: "Arijit Singh" },
  { title: "Chaleya", artist: "Arijit Singh & Shilpa Rao" },
  { title: "Teri Mitti", artist: "B Praak" },
  { title: "Pehle Bhi Main", artist: "Vishal Mishra" },
  { title: "O Bedardeya", artist: "Arijit Singh" },
  { title: "Jhoome Jo Pathaan", artist: "Arijit Singh & Sukriti Kakar" },
  { title: "Tere Vaaste", artist: "Varun Jain & Sachin-Jigar" },
  { title: "Maan Meri Jaan", artist: "King" },
  { title: "Kahani Suno", artist: "Kaifi Khalil" },
  { title: "Pasoori", artist: "Ali Sethi & Shae Gill" },
  { title: "Dil Nu", artist: "AP Dhillon" },
  { title: "Brown Munde", artist: "AP Dhillon" },
  { title: "Excuses", artist: "AP Dhillon" },
  { title: "Ve Haaniya", artist: "Arijit Singh" },
  { title: "What Jhumka", artist: "Arijit Singh" },
  { title: "Besharam Rang", artist: "Shilpa Rao & Caralisa" },
  { title: "Zihaal e Miskin", artist: "Vishal Mishra & Shreya Ghoshal" }
];

// All famous artists - expanded list (up to 50)
const STATIC_FAMOUS_ARTISTS = [
  // Original 15
  'The Weeknd', 'Bruno Mars', 'Taylor Swift', 'Lana Del Rey', 'Lady Gaga',
  'Justin Bieber', 'Billie Eilish', 'Ed Sheeran', 'Coldplay', 'Ariana Grande',
  'Bad Bunny', 'Alan Walker', 'David Guetta', 'Sabrina Carpenter', 'Arctic Monkeys',
  // New 14 artists
  'Selena Gomez', 'Michael Jackson', 'NoCopyrightSounds', 'A. R. Rahman', 'Anirudh Ravichander',
  'Arijit Singh', 'Shreya Ghoshal', 'Harris Jayaraj', 'Ilaiyaraaja', 'Sid Sriram',
  'S. P. Balasubrahmanyam', 'Pritam', 'Yuvan Shankar Raja', 'Aditya Rikhari'
];

// Export for FavoriteArtistsSelection to use
export const getAllFamousArtists = () => STATIC_FAMOUS_ARTISTS;

interface CachedHomeData {
  trending: any[];
  global: any[];
  regional: any[];
  artists: any[];
  lastUpdated: any;
  date: string;
  status?: string;
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// Deduplicate songs by title similarity
const deduplicateSongs = (songs: any[]): any[] => {
  const seen = new Map<string, any>();
  
  songs.forEach(song => {
    // Normalize title for comparison
    const normalizedTitle = song.title
      .toLowerCase()
      .replace(/\(.*?\)/g, '') // Remove parentheses content
      .replace(/\[.*?\]/g, '') // Remove brackets content
      .replace(/official|audio|video|lyrics|hd|4k|full|song/gi, '')
      .replace(/[^\w\s]/g, '')
      .trim();
    
    const key = normalizedTitle.slice(0, 30);
    
    if (!seen.has(key)) {
      seen.set(key, song);
    }
  });
  
  return Array.from(seen.values());
};

// Check if song is a lyrics video (we want to avoid these)
const isLyricsVideo = (title: string): boolean => {
  const lowerTitle = title.toLowerCase();
  return lowerTitle.includes('lyrics') || 
         lowerTitle.includes('lyric') ||
         lowerTitle.includes('karaoke') ||
         lowerTitle.includes('instrumental');
};

// Filter out lyrics videos
const filterOutLyrics = (songs: any[]): any[] => {
  return songs.filter(song => !isLyricsVideo(song.title));
};

// Get cached home data - checks Firebase FIRST to avoid API calls
export const getCachedHomeData = async (): Promise<CachedHomeData | null> => {
  try {
    console.log('📂 [HomeData] Checking Firebase cache...');
    const docRef = doc(db, 'DailyMusicData', 'homeData');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data() as CachedHomeData;
      
      // Use cache if it has sufficient data
      if (data.trending?.length >= 10 && data.regional?.length >= 10 && data.status !== 'error') {
        console.log('✅ [HomeData] Using cached data from', data.date, '(0 API calls)');
        return data;
      }
    }
    
    console.log('📭 [HomeData] No valid cache found - will need to fetch');
    return null;
  } catch (error: any) {
    console.warn('⚠️ [HomeData] Cache check error:', error?.message || error);
    return null;
  }
};

// Refresh home data - fetches all data and stores in Firebase
// Uses static curated lists + YouTube search for metadata
export const refreshHomeData = async (): Promise<CachedHomeData> => {
  console.log('🔄 [HomeData] Refreshing home data (one-time API use)...');
  
  try {
    // 1. Get trending songs from static list (20 songs)
    console.log('🔍 [HomeData] Fetching trending songs...');
    let trendingSongs: any[] = [];
    
    try {
      const trendingDoc = await getDoc(doc(db, 'StaticMusicData', 'trendingSongs'));
      if (trendingDoc.exists() && trendingDoc.data().songs?.length >= 15) {
        console.log('✅ [HomeData] Using cached trending songs');
        trendingSongs = trendingDoc.data().songs;
      }
    } catch (e) {
      console.warn('⚠️ [HomeData] Could not read trending cache');
    }
    
    if (trendingSongs.length < 15) {
      // Fetch from static trending list via YouTube search
      console.log('🔍 [HomeData] Fetching trending from static list via YouTube...');
      const trendingPromises = STATIC_TRENDING.slice(0, 20).map(async (song) => {
        const results = await searchYouTube(`${song.title} ${song.artist} official audio`, 1);
        return results[0] || null;
      });
      const trendingResults = await Promise.all(trendingPromises);
      trendingSongs = trendingResults.filter(s => s !== null);
      
      // Cache trending songs
      try {
        await setDoc(doc(db, 'StaticMusicData', 'trendingSongs'), {
          songs: trendingSongs,
          lastUpdated: Timestamp.now()
        });
        console.log('✅ [HomeData] Trending songs cached');
      } catch (e) {
        console.warn('⚠️ [HomeData] Could not cache trending');
      }
    }
    
    // 2. Get or create global hit songs
    console.log('🔍 [HomeData] Processing global hit songs...');
    let globalSongs: any[] = [];
    
    try {
      const globalHitsDoc = await getDoc(doc(db, 'StaticMusicData', 'globalHits'));
      if (globalHitsDoc.exists() && globalHitsDoc.data().songs?.length >= 10) {
        console.log('✅ [HomeData] Using cached global hits');
        globalSongs = globalHitsDoc.data().songs;
      }
    } catch (e) {
      console.warn('⚠️ [HomeData] Could not read global hits cache');
    }
    
    if (globalSongs.length < 10) {
      console.log('🔍 [HomeData] Fetching global hits from YouTube...');
      const globalPromises = STATIC_GLOBAL_HITS.map(async (song) => {
        const results = await searchYouTube(`${song.title} ${song.artist} official audio`, 1);
        return results[0] || null;
      });
      const globalResults = await Promise.all(globalPromises);
      globalSongs = globalResults.filter(s => s !== null);
      
      // Cache static data
      try {
        await setDoc(doc(db, 'StaticMusicData', 'globalHits'), {
          songs: globalSongs,
          lastUpdated: Timestamp.now()
        });
        console.log('✅ [HomeData] Global hits cached');
      } catch (e) {
        console.warn('⚠️ [HomeData] Could not cache global hits');
      }
    }
    
    // 3. Get or create regional hits (India - 20 songs)
    console.log('🔍 [HomeData] Processing regional hits (India)...');
    let regionalSongs: any[] = [];
    
    try {
      const regionalDoc = await getDoc(doc(db, 'StaticMusicData', 'regionalHits'));
      if (regionalDoc.exists() && regionalDoc.data().songs?.length >= 15) {
        console.log('✅ [HomeData] Using cached regional hits');
        regionalSongs = regionalDoc.data().songs;
      }
    } catch (e) {
      console.warn('⚠️ [HomeData] Could not read regional cache');
    }
    
    if (regionalSongs.length < 15) {
      console.log('🔍 [HomeData] Fetching regional hits from YouTube...');
      const regionalPromises = STATIC_REGIONAL_HITS.map(async (song) => {
        const results = await searchYouTube(`${song.title} ${song.artist} official`, 1);
        return results[0] || null;
      });
      const regionalResults = await Promise.all(regionalPromises);
      regionalSongs = regionalResults.filter(s => s !== null);
      
      // Cache regional data
      try {
        await setDoc(doc(db, 'StaticMusicData', 'regionalHits'), {
          songs: regionalSongs,
          lastUpdated: Timestamp.now()
        });
        console.log('✅ [HomeData] Regional hits cached');
      } catch (e) {
        console.warn('⚠️ [HomeData] Could not cache regional hits');
      }
    }
    
    // 4. Get or create famous artists
    console.log('🔍 [HomeData] Processing famous artists...');
    let artists: any[] = [];
    
    try {
      const artistsDoc = await getDoc(doc(db, 'StaticMusicData', 'famousArtists'));
      if (artistsDoc.exists() && artistsDoc.data().artists?.length >= 10) {
        console.log('✅ [HomeData] Using cached famous artists');
        artists = artistsDoc.data().artists;
      }
    } catch (e) {
      console.warn('⚠️ [HomeData] Could not read artists cache');
    }
    
    // Check if we have all artists or if new ones were added
    const expectedArtistCount = STATIC_FAMOUS_ARTISTS.length;
    if (artists.length < expectedArtistCount) {
      console.log(`🔍 [HomeData] Fetching ${expectedArtistCount - artists.length} new famous artists from YouTube...`);
      
      // Get existing artist names for comparison
      const existingNames = new Set(artists.map((a: any) => a.name?.toLowerCase()));
      
      // Only fetch missing artists
      const missingArtists = STATIC_FAMOUS_ARTISTS.filter(
        name => !existingNames.has(name.toLowerCase())
      );
      
      const artistPromises = missingArtists.map(async (artistName) => {
        const results = await searchArtists(artistName);
        return results[0] || null;
      });
      const newArtistResults = await Promise.all(artistPromises);
      const validNewArtists = newArtistResults.filter(a => a !== null);
      
      // Merge existing and new artists
      artists = [...artists, ...validNewArtists];
      
      // Cache all artists
      try {
        await setDoc(doc(db, 'StaticMusicData', 'famousArtists'), {
          artists,
          lastUpdated: Timestamp.now()
        });
        console.log(`✅ [HomeData] Famous artists cached (${artists.length} total)`);
      } catch (e) {
        console.warn('⚠️ [HomeData] Could not cache artists');
      }
    }
    
    const homeData: CachedHomeData = {
      trending: trendingSongs.slice(0, 20),
      global: globalSongs.slice(0, 20),
      regional: regionalSongs.slice(0, 20),
      artists: artists.slice(0, 50), // Show up to 50 artists
      lastUpdated: Timestamp.now(),
      date: getTodayDate(),
      status: 'success'
    };
    
    // Save to Firestore
    console.log('💾 [HomeData] Saving to Firestore...');
    try {
      await setDoc(doc(db, 'DailyMusicData', 'homeData'), homeData);
      console.log('✅ [HomeData] Saved successfully');
    } catch (saveError) {
      console.error('❌ [HomeData] Failed to save:', saveError);
    }
    
    return homeData;
  } catch (error) {
    console.error('❌ [HomeData] Error refreshing:', error);
    
    try {
      await setDoc(doc(db, 'DailyMusicData', 'homeData'), {
        trending: [],
        global: [],
        regional: [],
        artists: [],
        lastUpdated: Timestamp.now(),
        date: getTodayDate(),
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } catch (e) {
      // Ignore save errors
    }
    
    throw error;
  }
};

// Get or refresh home data - main entry point (NEVER wastes API on refresh)
export const getOrRefreshHomeData = async (): Promise<CachedHomeData> => {
  // Always check cache first - this is FREE (Firebase read)
  const cached = await getCachedHomeData();
  
  // If we have ANY cached data with songs, use it (saves API quota)
  if (cached && cached.trending?.length >= 10) {
    console.log('💰 [HomeData] Using cache - 0 API units used');
    return cached;
  }
  
  // Only fetch from API if absolutely no data exists
  console.log('🔄 [HomeData] No cache found, fetching (one-time API use)...');
  return await refreshHomeData();
};

// NEW: Get recommendations using shared artist cache (0 API if cached)
export const getOrRefreshRecommendations = async (userId: string, favoriteArtists: string[]): Promise<any[]> => {
  if (!favoriteArtists || favoriteArtists.length === 0) {
    return [];
  }
  
  console.log(`🎵 [Recommendations] Getting for user ${userId.slice(0, 8)} with ${favoriteArtists.length} artists`);
  
  // Use shared artist cache - 0 API calls if already cached!
  return await getRecommendationsFromArtists(favoriteArtists);
};

// Backward compatibility exports
export const enrichSongsWithYouTube = (songs: any[]) => songs;
export const enrichArtistsWithImages = (artists: any[]) => artists;
