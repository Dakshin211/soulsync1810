// Smart Similar Tracks Service
// Uses Last.fm to get similar tracks, caches in Firebase, fetches YT metadata efficiently

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { getSimilarTracks } from './lastfmApi';
import { searchYouTube, isYouTubeQuotaExceeded } from './youtubeApi';

interface SongMeta {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

interface SimilarTrackEntry {
  title: string;
  artist: string;
  ytMeta?: SongMeta;
  fetchedAt?: number;
}

interface SimilarTracksDoc {
  baseSongId: string;
  baseSongTitle: string;
  baseSongArtist: string;
  tracks: SimilarTrackEntry[];
  createdAt: number;
  lastYTFetchIndex: number; // How many tracks have YT metadata
  playIndex: number; // Current position in the shuffled play order
  shuffledOrder: number[]; // Shuffled indices for random play
}

const TRACKS_PER_BATCH = 10;
const MAX_TRACKS = 50;
const CACHE_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Generate cache key from song
function getCacheKey(songId: string): string {
  return songId.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
}

// Shuffle array using Fisher-Yates
function shuffleArray(arr: number[]): number[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Get or create similar tracks cache for a song
async function getOrCreateSimilarCache(song: SongMeta): Promise<SimilarTracksDoc | null> {
  const cacheKey = getCacheKey(song.id);
  const docRef = doc(db, 'SimilarTracks', cacheKey);
  
  try {
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data() as SimilarTracksDoc;
      
      // Check if cache is still valid (less than 5 days old)
      const ageInDays = (Date.now() - data.createdAt) / MS_PER_DAY;
      if (ageInDays < CACHE_DAYS) {
        console.log(`📀 [SimilarTracks] Using cached tracks for ${song.title}`);
        return data;
      }
      
      console.log(`📀 [SimilarTracks] Cache expired for ${song.title}, refreshing...`);
    }
    
    // Fetch from Last.fm
    console.log(`🎵 [SimilarTracks] Fetching similar tracks from Last.fm for: ${song.title} - ${song.artist}`);
    const similar = await getSimilarTracks(song.artist, song.title);
    
    if (similar.length === 0) {
      console.warn(`⚠️ [SimilarTracks] No similar tracks found for ${song.title}`);
      return null;
    }
    
    // Create new cache document
    const tracks: SimilarTrackEntry[] = similar.slice(0, MAX_TRACKS).map(t => ({
      title: t.title,
      artist: t.artist,
    }));
    
    const shuffledOrder = shuffleArray(Array.from({ length: tracks.length }, (_, i) => i));
    
    const newDoc: SimilarTracksDoc = {
      baseSongId: song.id,
      baseSongTitle: song.title,
      baseSongArtist: song.artist,
      tracks,
      createdAt: Date.now(),
      lastYTFetchIndex: 0,
      playIndex: 0,
      shuffledOrder,
    };
    
    await setDoc(docRef, newDoc);
    console.log(`✅ [SimilarTracks] Cached ${tracks.length} similar tracks for ${song.title}`);
    
    return newDoc;
  } catch (error) {
    console.error('❌ [SimilarTracks] Error getting similar tracks:', error);
    return null;
  }
}

// Fetch YT metadata for a batch of tracks
async function fetchYTMetadataForBatch(
  cacheKey: string, 
  tracks: SimilarTrackEntry[], 
  startIndex: number
): Promise<SimilarTrackEntry[]> {
  if (isYouTubeQuotaExceeded()) {
    console.warn('⚠️ [SimilarTracks] YT quota exceeded, skipping metadata fetch');
    return tracks;
  }
  
  const endIndex = Math.min(startIndex + TRACKS_PER_BATCH, tracks.length);
  const batchTracks = tracks.slice(startIndex, endIndex);
  
  console.log(`🔍 [SimilarTracks] Fetching YT metadata for tracks ${startIndex}-${endIndex}`);
  
  // Batch search - one YT call for multiple songs by combining queries
  // Actually, we need individual searches for accuracy. Use Promise.all for parallel calls
  const searchPromises = batchTracks.map(async (track) => {
    if (track.ytMeta) return track; // Already has metadata
    
    const query = `${track.artist} ${track.title}`;
    const results = await searchYouTube(query, 1);
    
    if (results.length > 0) {
      return {
        ...track,
        ytMeta: results[0],
        fetchedAt: Date.now(),
      };
    }
    return track;
  });
  
  const updatedBatch = await Promise.all(searchPromises);
  
  // Update the original tracks array
  const updatedTracks = [...tracks];
  for (let i = 0; i < updatedBatch.length; i++) {
    updatedTracks[startIndex + i] = updatedBatch[i];
  }
  
  // Update Firebase
  try {
    const docRef = doc(db, 'SimilarTracks', cacheKey);
    await updateDoc(docRef, {
      tracks: updatedTracks,
      lastYTFetchIndex: endIndex,
    });
    console.log(`✅ [SimilarTracks] Updated YT metadata for ${updatedBatch.filter(t => t.ytMeta).length} tracks`);
  } catch (error) {
    console.error('❌ [SimilarTracks] Error updating tracks:', error);
  }
  
  return updatedTracks;
}

// Get next similar song to play
export async function getNextSimilarSong(currentSong: SongMeta): Promise<SongMeta | null> {
  try {
    const cache = await getOrCreateSimilarCache(currentSong);
    if (!cache || cache.tracks.length === 0) return null;
    
    const cacheKey = getCacheKey(currentSong.id);
    let tracks = cache.tracks;
    let playIndex = cache.playIndex;
    const shuffledOrder = cache.shuffledOrder;
    
    // Get the actual track index from shuffled order
    const trackIndex = shuffledOrder[playIndex % shuffledOrder.length];
    
    // Check if we need to fetch YT metadata for this batch
    const batchStart = Math.floor(trackIndex / TRACKS_PER_BATCH) * TRACKS_PER_BATCH;
    if (batchStart >= cache.lastYTFetchIndex) {
      tracks = await fetchYTMetadataForBatch(cacheKey, tracks, batchStart);
    }
    
    const track = tracks[trackIndex];
    
    // Update play index for next time
    const newPlayIndex = (playIndex + 1) % shuffledOrder.length;
    
    // If we've gone through all tracks, reshuffle
    let newShuffledOrder = shuffledOrder;
    if (newPlayIndex === 0) {
      newShuffledOrder = shuffleArray(Array.from({ length: tracks.length }, (_, i) => i));
    }
    
    try {
      const docRef = doc(db, 'SimilarTracks', cacheKey);
      await updateDoc(docRef, {
        playIndex: newPlayIndex,
        shuffledOrder: newShuffledOrder,
      });
    } catch (e) {
      console.error('Error updating play index:', e);
    }
    
    if (track.ytMeta) {
      console.log(`🎵 [SimilarTracks] Next song: ${track.ytMeta.title}`);
      return track.ytMeta;
    }
    
    // If no YT metadata yet, try to fetch it now
    if (!isYouTubeQuotaExceeded()) {
      const results = await searchYouTube(`${track.artist} ${track.title}`, 1);
      if (results.length > 0) {
        console.log(`🎵 [SimilarTracks] Fetched on-demand: ${results[0].title}`);
        return results[0];
      }
    }
    
    console.warn(`⚠️ [SimilarTracks] No YT metadata for ${track.title}`);
    return null;
  } catch (error) {
    console.error('❌ [SimilarTracks] Error getting next similar song:', error);
    return null;
  }
}

// Add Firestore rule for SimilarTracks collection
// match /SimilarTracks/{trackId} {
//   allow read: if true;
//   allow write: if true;
// }
