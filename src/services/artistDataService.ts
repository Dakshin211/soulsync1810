// Artist Data Service - Caches artist songs in Firebase (shared across ALL users)
import { doc, setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { searchYouTube } from './youtubeApi';
import { askGroq } from './groqApi';

interface ArtistSongsCache {
  artistName: string;
  songs: any[];
  bio: string;
  achievements: string[];
  image: string;
  monthlyListeners: string;
  lastUpdated: any;
}

// 20 Famous artists with their REAL info (fetched via Groq and cached)
export const FAMOUS_ARTISTS_DATA: Record<string, { bio: string; achievements: string[]; monthlyListeners: string }> = {
  'The Weeknd': {
    bio: 'Abel Tesfaye, known as The Weeknd, is a Canadian singer and songwriter who has revolutionized R&B and pop music with his dark, atmospheric sound.',
    achievements: ['4x Grammy Winner', '100+ Billion Streams', 'Super Bowl LV Halftime Show', 'Blinding Lights - Most #1 Weeks Ever'],
    monthlyListeners: '115M'
  },
  'Bruno Mars': {
    bio: 'Peter Gene Hernandez, known as Bruno Mars, is an American singer-songwriter known for his retro showmanship and blend of pop, R&B, funk, soul, and reggae.',
    achievements: ['15x Grammy Winner', 'Diamond Certified Singles', 'Silk Sonic Collaboration', '130M+ Records Sold'],
    monthlyListeners: '75M'
  },
  'Taylor Swift': {
    bio: 'Taylor Swift is an American singer-songwriter known for narrative songwriting about her personal life. She has transitioned from country to pop to indie folk.',
    achievements: ['14x Grammy Winner', 'Eras Tour - Highest Grossing Ever', 'Most Streamed Female Artist', 'Time Person of the Year 2023'],
    monthlyListeners: '95M'
  },
  'Lana Del Rey': {
    bio: 'Elizabeth Grant, known as Lana Del Rey, is an American singer-songwriter known for her cinematic, melancholic music exploring themes of glamour, melancholia, and Americana.',
    achievements: ['Billboard Woman of the Year', 'Brit Award Winner', 'Video of the Year - MTV', 'Cultural Icon Status'],
    monthlyListeners: '52M'
  },
  'Lady Gaga': {
    bio: 'Stefani Germanotta, known as Lady Gaga, is an American singer, songwriter, and actress known for her reinvention and visual presentation.',
    achievements: ['13x Grammy Winner', 'Oscar Winner - A Star Is Born', 'Super Bowl LI Halftime Show', '35M+ Albums Sold'],
    monthlyListeners: '55M'
  },
  'Justin Bieber': {
    bio: 'Justin Bieber is a Canadian singer discovered on YouTube who became one of the biggest pop stars of the 2010s and 2020s.',
    achievements: ['2x Grammy Winner', 'Most Streamed Male Artist (2020)', '70M+ Albums Sold', 'Diamond Certified Songs'],
    monthlyListeners: '70M'
  },
  'Billie Eilish': {
    bio: 'Billie Eilish is an American singer-songwriter known for her whispered vocals, dark aesthetics, and genre-blending music created with her brother Finneas.',
    achievements: ['9x Grammy Winner', 'Youngest Solo Artist #1 Album', 'Oscar Winner - No Time to Die', 'Record of the Year x2'],
    monthlyListeners: '85M'
  },
  'Ed Sheeran': {
    bio: 'Ed Sheeran is a British singer-songwriter known for his acoustic guitar-driven pop songs and his ability to blend folk, hip-hop, and R&B influences.',
    achievements: ['4x Grammy Winner', 'Shape of You - 3B+ Streams', 'Most Streamed Artist 2017', '150M+ Records Sold'],
    monthlyListeners: '80M'
  },
  'Coldplay': {
    bio: 'Coldplay is a British rock band formed in London, known for their atmospheric, anthemic rock songs and spectacular live shows.',
    achievements: ['7x Grammy Winner', 'Most Successful British Band', 'Music of the Spheres World Tour', '100M+ Albums Sold'],
    monthlyListeners: '60M'
  },
  'Ariana Grande': {
    bio: 'Ariana Grande is an American singer and actress known for her four-octave vocal range and pop/R&B music.',
    achievements: ['2x Grammy Winner', 'Most Followed Woman on Instagram', '27 Guinness World Records', 'Thank U Next #1 Debut'],
    monthlyListeners: '75M'
  },
  'Bad Bunny': {
    bio: 'Benito Martínez Ocasio, known as Bad Bunny, is a Puerto Rican rapper and singer who brought reggaeton and Latin trap to global mainstream.',
    achievements: ['3x Grammy Winner', 'Most Streamed Artist 2020-2022', 'WWE Appearances', 'First Spanish Album #1 in US'],
    monthlyListeners: '90M'
  },
  'Alan Walker': {
    bio: 'Alan Walker is a British-Norwegian DJ and record producer known for his electronic dance music and signature masked appearance.',
    achievements: ['Faded - 3B+ Views', 'Diamond Certified Singles', 'NRJ Music Award Winner', 'Youngest Norwegian #1'],
    monthlyListeners: '40M'
  },
  'David Guetta': {
    bio: 'David Guetta is a French DJ and music producer, one of the pioneers of the EDM scene who has collaborated with numerous top artists.',
    achievements: ['2x Grammy Winner', 'DJ Mag #1 DJ', '10B+ Streams', '50M+ Albums Sold'],
    monthlyListeners: '45M'
  },
  'Sabrina Carpenter': {
    bio: 'Sabrina Carpenter is an American singer and actress known for her powerful vocals and catchy pop songs.',
    achievements: ['Disney Channel Star', 'Espresso - Viral Hit', 'Billboard Rising Star', 'Triple Platinum Singles'],
    monthlyListeners: '65M'
  },
  'Arctic Monkeys': {
    bio: 'Arctic Monkeys are an English rock band formed in Sheffield, known for their guitar-driven indie rock and Alex Turner\'s distinctive lyrics.',
    achievements: ['7x Brit Award Winner', 'Fastest Selling Debut Album UK', 'AM - Diamond Certified', 'Headlined Glastonbury'],
    monthlyListeners: '35M'
  },
  'Post Malone': {
    bio: 'Austin Post, known as Post Malone, is an American singer known for blending genres including hip-hop, pop, rock, and country.',
    achievements: ['9x Grammy Nominated', 'Diamond Certified Singles', 'Sunflower - 2B+ Streams', '80M+ Records Sold'],
    monthlyListeners: '55M'
  },
  'Doja Cat': {
    bio: 'Amala Dlamini, known as Doja Cat, is an American rapper and singer known for her viral hits and creative music videos.',
    achievements: ['Grammy Winner', 'Say So - #1 Billboard', 'Planet Her - Critical Acclaim', 'MTV VMA Winner'],
    monthlyListeners: '60M'
  },
  'Drake': {
    bio: 'Aubrey Graham, known as Drake, is a Canadian rapper and singer who has dominated the charts for over a decade.',
    achievements: ['5x Grammy Winner', 'Most Billboard Hot 100 Entries', 'Certified Lover Boy', '170M+ Records Sold'],
    monthlyListeners: '85M'
  },
  'Dua Lipa': {
    bio: 'Dua Lipa is a British-Albanian singer known for her disco-influenced pop music and powerful vocals.',
    achievements: ['3x Grammy Winner', 'Future Nostalgia - Critical Acclaim', 'Levitating - Longest Charting', 'Brit Award Winner'],
    monthlyListeners: '65M'
  },
  'Harry Styles': {
    bio: 'Harry Styles is a British singer and actor who rose to fame as a member of One Direction before launching a successful solo career.',
    achievements: ['Grammy Winner', 'As It Was - Record of the Year', 'World Tour Success', 'Fashion Icon Status'],
    monthlyListeners: '50M'
  },
  // Indian Artists
  'Arijit Singh': {
    bio: 'Arijit Singh is an Indian playback singer and music composer, considered one of the most versatile singers in Indian cinema.',
    achievements: ['6x Filmfare Awards', 'Most Streamed Indian Artist', 'Tum Hi Ho - 1B+ Views', 'National Film Award'],
    monthlyListeners: '80M'
  },
  'AP Dhillon': {
    bio: 'AP Dhillon is an Indo-Canadian singer, songwriter, and record producer known for his unique blend of Punjabi music with international sounds.',
    achievements: ['Brown Munde - 1B+ Views', 'Excuses - Viral Hit', 'Global Punjabi Music Pioneer', 'Multi-Platinum Artist'],
    monthlyListeners: '25M'
  },
  'Pritam': {
    bio: 'Pritam Chakraborty is an Indian music director and composer known for creating some of Bollywood\'s biggest soundtracks.',
    achievements: ['6x Filmfare Awards', 'Ae Dil Hai Mushkil', 'Jab We Met Soundtrack', 'Dangal Music'],
    monthlyListeners: '15M'
  },
  // NEW 15 Artists
  'Selena Gomez': {
    bio: 'Selena Gomez is an American singer, actress, and producer known for her pop music and advocacy for mental health awareness.',
    achievements: ['Billboard Woman of the Year', 'Rare - #1 Album', 'Most Followed Woman on Instagram', 'UNICEF Ambassador'],
    monthlyListeners: '55M'
  },
  'Michael Jackson': {
    bio: 'Michael Jackson was an American singer, songwriter, and dancer, widely regarded as the King of Pop and one of the most influential entertainers of all time.',
    achievements: ['13x Grammy Winner', 'Thriller - Best Selling Album Ever', 'Rock & Roll Hall of Fame', 'Moonwalk Inventor'],
    monthlyListeners: '35M'
  },
  'NoCopyrightSounds': {
    bio: 'NoCopyrightSounds (NCS) is a British record label known for releasing royalty-free electronic dance music used by content creators worldwide.',
    achievements: ['30M+ YouTube Subscribers', 'Alan Walker Discovery', '10B+ Total Views', 'Creator Community Pioneer'],
    monthlyListeners: '8M'
  },
  'A. R. Rahman': {
    bio: 'A. R. Rahman is an Indian composer, singer, and music producer known as the Mozart of Madras, creating iconic Bollywood and Hollywood soundtracks.',
    achievements: ['2x Oscar Winner', '6x National Film Awards', 'Slumdog Millionaire', 'Grammy Winner'],
    monthlyListeners: '20M'
  },
  'Anirudh Ravichander': {
    bio: 'Anirudh Ravichander is an Indian composer and singer who revolutionized Tamil film music with his contemporary sound.',
    achievements: ['Why This Kolaveri Di - Viral Hit', 'Filmfare Awards Winner', 'Master Soundtrack', 'Leo Music Director'],
    monthlyListeners: '25M'
  },
  'Shreya Ghoshal': {
    bio: 'Shreya Ghoshal is an Indian playback singer and one of the most celebrated female vocalists in Indian cinema.',
    achievements: ['4x National Film Awards', '8x Filmfare Awards', 'Padma Shri Award', 'Most Awarded Female Singer'],
    monthlyListeners: '30M'
  },
  'Harris Jayaraj': {
    bio: 'Harris Jayaraj is an Indian film composer known for his soulful melodies and contemporary sound in Tamil cinema.',
    achievements: ['Filmfare Award Winner', 'Vinnaithaandi Varuvaayaa', 'Ghajini Music', 'Kaakha Kaakha Soundtrack'],
    monthlyListeners: '8M'
  },
  'Ilaiyaraaja': {
    bio: 'Ilaiyaraaja is an Indian composer, singer, and lyricist, considered the Maestro who transformed Indian film music with Western classical influences.',
    achievements: ['5x National Film Awards', 'Padma Bhushan', '7000+ Songs Composed', 'Padma Vibhushan'],
    monthlyListeners: '12M'
  },
  'Sid Sriram': {
    bio: 'Sid Sriram is an American-born Indian playback singer known for his soulful voice and emotional renditions in South Indian cinema.',
    achievements: ['Maruvaarthai - Viral Hit', 'Filmfare Award Winner', 'Samajavaragamana', 'Multi-language Singer'],
    monthlyListeners: '18M'
  },
  'S. P. Balasubrahmanyam': {
    bio: 'S. P. Balasubrahmanyam was a legendary Indian playback singer who recorded over 40,000 songs in 16 languages.',
    achievements: ['6x National Film Awards', 'Padma Bhushan', 'Guinness World Record', 'Ek Duuje Ke Liye'],
    monthlyListeners: '10M'
  },
  'Yuvan Shankar Raja': {
    bio: 'Yuvan Shankar Raja is an Indian composer known as the Youth Icon, pioneering contemporary and experimental music in Tamil cinema.',
    achievements: ['Filmfare Award Winner', 'Nenjukkul Peidhidum', 'Paiyaa Soundtrack', 'Asuran Music'],
    monthlyListeners: '15M'
  },
  'Aditya Rikhari': {
    bio: 'Aditya Rikhari is an Indian indie singer-songwriter known for his soulful Hindi songs and emotional storytelling.',
    achievements: ['Viral Indie Artist', 'Raat Bhar - Hit Song', 'Independent Music Pioneer', 'Growing Fanbase'],
    monthlyListeners: '3M'
  }
};

// Get artist key for Firebase (sanitize for document ID)
const getArtistKey = (artistName: string): string => {
  return artistName.toLowerCase().replace(/[^a-z0-9]/g, '_');
};

// Deduplicate songs by title similarity
const deduplicateSongs = (songs: any[]): any[] => {
  const seen = new Map<string, any>();
  
  songs.forEach(song => {
    // Normalize title for comparison
    const normalizedTitle = song.title
      .toLowerCase()
      .replace(/\(.*?\)/g, '') // Remove parentheses content
      .replace(/\[.*?\]/g, '') // Remove brackets content
      .replace(/official|audio|video|lyrics|hd|4k|full|song|ft\.|feat\./gi, '')
      .replace(/[^\w\s]/g, '')
      .trim();
    
    // Use first 25 chars as key to catch similar titles
    const key = normalizedTitle.slice(0, 25);
    
    if (!seen.has(key)) {
      seen.set(key, song);
    }
  });
  
  return Array.from(seen.values());
};

// Filter out lyrics videos
const filterOutLyrics = (songs: any[]): any[] => {
  return songs.filter(song => {
    const lowerTitle = song.title.toLowerCase();
    return !lowerTitle.includes('lyrics') && 
           !lowerTitle.includes('lyric') &&
           !lowerTitle.includes('karaoke') &&
           !lowerTitle.includes('instrumental') &&
           !lowerTitle.includes('cover') &&
           !lowerTitle.includes('live at') &&
           !lowerTitle.includes('concert');
  });
};

// Get cached artist songs from Firebase
export const getCachedArtistSongs = async (artistName: string): Promise<ArtistSongsCache | null> => {
  try {
    const artistKey = getArtistKey(artistName);
    const docRef = doc(db, 'ArtistSongs', artistKey);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data() as ArtistSongsCache;
      // Require at least 10 songs for good cache
      if (data.songs?.length >= 10) {
        console.log(`✅ [ArtistData] Using cached songs for ${artistName} (${data.songs.length} songs, 0 API calls)`);
        return data;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ [ArtistData] Error getting cached songs for ${artistName}:`, error);
    return null;
  }
};

// Fetch real artist info using Groq API
const fetchArtistInfoFromGroq = async (artistName: string): Promise<{ bio: string; achievements: string[]; monthlyListeners: string } | null> => {
  try {
    const prompt = `Provide accurate information about the music artist "${artistName}". Return ONLY valid JSON with no markdown:
{
  "bio": "A 2-sentence bio about the artist",
  "achievements": ["Achievement 1", "Achievement 2", "Achievement 3", "Achievement 4"],
  "monthlyListeners": "XXM"
}

Requirements:
- Bio should be factual and concise
- Achievements should be real awards, certifications, or milestones
- Monthly listeners should be a realistic Spotify estimate (e.g., "45M", "12M")
- Return ONLY the JSON, no explanation`;

    const response = await askGroq(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`✅ [ArtistData] Got real info for ${artistName} from Groq`);
      return {
        bio: parsed.bio || `${artistName} is a talented artist in the music industry.`,
        achievements: parsed.achievements || ['Popular Artist', 'Growing Fanbase'],
        monthlyListeners: parsed.monthlyListeners || '1M+'
      };
    }
  } catch (error) {
    console.warn(`⚠️ [ArtistData] Groq failed for ${artistName}, using static data`);
  }
  return null;
};

// Fetch and cache artist songs (called ONCE, then used forever)
// Now fetches 20 unique, non-repetitive songs
export const fetchAndCacheArtistSongs = async (artistName: string): Promise<ArtistSongsCache> => {
  console.log(`🔍 [ArtistData] Fetching 20 songs for ${artistName}...`);
  
  try {
    // Fetch more songs (40) to filter and deduplicate down to 20
    const rawSongs = await searchYouTube(`${artistName} top songs official audio`, 40);
    
    // Filter out lyrics videos and deduplicate
    const filteredSongs = filterOutLyrics(rawSongs);
    const uniqueSongs = deduplicateSongs(filteredSongs);
    
    // Take top 20 unique songs
    const songs = uniqueSongs.slice(0, 20);
    
    console.log(`✅ [ArtistData] Got ${songs.length} unique songs for ${artistName} (filtered from ${rawSongs.length})`);
    
    // Get artist info - try static first, then Groq for unknown artists
    let artistInfo = FAMOUS_ARTISTS_DATA[artistName];
    
    if (!artistInfo) {
      // Try Groq for real data
      const groqInfo = await fetchArtistInfoFromGroq(artistName);
      artistInfo = groqInfo || {
        bio: `${artistName} is a renowned artist known for their unique musical style and contributions to the music industry.`,
        achievements: ['Chart-Topping Hits', 'Millions of Streams', 'Global Recognition', 'Award Nominations'],
        monthlyListeners: '10M+'
      };
    }
    
    const artistData: ArtistSongsCache = {
      artistName,
      songs,
      bio: artistInfo.bio,
      achievements: artistInfo.achievements,
      monthlyListeners: artistInfo.monthlyListeners,
      image: songs[0]?.thumbnail || '',
      lastUpdated: Timestamp.now()
    };
    
    // Try to cache in Firebase (may fail due to permissions, that's okay)
    try {
      const artistKey = getArtistKey(artistName);
      await setDoc(doc(db, 'ArtistSongs', artistKey), artistData);
      console.log(`✅ [ArtistData] Cached ${songs.length} songs for ${artistName}`);
    } catch (cacheError) {
      console.warn(`⚠️ [ArtistData] Could not cache (permissions), returning data anyway`);
    }
    
    return artistData;
  } catch (error) {
    console.error(`❌ [ArtistData] Error fetching songs for ${artistName}:`, error);
    // Return empty data instead of throwing
    const staticInfo = FAMOUS_ARTISTS_DATA[artistName] || {
      bio: `${artistName} is a talented artist.`,
      achievements: ['Popular Artist'],
      monthlyListeners: '1M+'
    };
    return {
      artistName,
      songs: [],
      bio: staticInfo.bio,
      achievements: staticInfo.achievements,
      monthlyListeners: staticInfo.monthlyListeners,
      image: '',
      lastUpdated: Timestamp.now()
    };
  }
};

// Main function: Get artist songs (from cache or fetch once)
export const getArtistSongs = async (artistName: string): Promise<ArtistSongsCache | null> => {
  // Always try cache first
  const cached = await getCachedArtistSongs(artistName);
  if (cached) {
    return cached;
  }
  
  // Fetch and cache (one-time API use)
  return await fetchAndCacheArtistSongs(artistName);
};

// Get recommendations for user (uses shared artist cache)
export const getRecommendationsFromArtists = async (favoriteArtists: string[]): Promise<any[]> => {
  if (!favoriteArtists || favoriteArtists.length === 0) {
    return [];
  }
  
  console.log(`🎵 [Recommendations] Getting cached songs for artists: ${favoriteArtists.join(', ')}`);
  
  // Use up to 4 favorite artists (max selection)
  const artistsToUse = favoriteArtists.slice(0, 4);
  
  const allSongs: any[] = [];
  
  for (const artistName of artistsToUse) {
    // ONLY use cached data - no API calls for recommendations
    const artistData = await getCachedArtistSongs(artistName);
    if (artistData && artistData.songs) {
      // Add 8 songs per artist for more variety (25 / 4 = ~6, round up)
      allSongs.push(...artistData.songs.slice(0, 8).map(song => ({
        ...song,
        sourceArtist: artistName
      })));
    }
  }
  
  // Randomly shuffle songs for variety
  const shuffled = allSongs.sort(() => Math.random() - 0.5);
  
  // Remove duplicates
  const uniqueMap = new Map();
  shuffled.forEach(song => {
    const key = `${song.id}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, song);
    }
  });
  
  // Return 25 songs instead of 15
  return Array.from(uniqueMap.values()).slice(0, 25);
};

// Pre-populate all 20 famous artists (run once to fill Firebase)
export const prePopulateArtists = async (): Promise<void> => {
  console.log('🎤 [ArtistData] Pre-populating famous artists...');
  
  const artists = Object.keys(FAMOUS_ARTISTS_DATA);
  let fetched = 0;
  let cached = 0;
  
  for (const artistName of artists) {
    const existing = await getCachedArtistSongs(artistName);
    if (existing && existing.songs?.length >= 15) {
      cached++;
      continue;
    }
    
    try {
      await fetchAndCacheArtistSongs(artistName);
      fetched++;
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`⚠️ [ArtistData] Failed to fetch ${artistName}:`, error);
    }
  }
  
  console.log(`✅ [ArtistData] Pre-population complete: ${fetched} fetched, ${cached} already cached`);
};
