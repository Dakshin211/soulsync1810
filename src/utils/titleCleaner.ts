/**
 * Utility to clean song titles and artist names for recommendation API
 * The API requires clean titles without extra metadata
 */

// Common patterns to remove from song titles
const TITLE_PATTERNS_TO_REMOVE = [
  // Video type indicators
  /\(\s*official\s*(music\s*)?video\s*\)?/gi,
  /\(\s*official\s*audio\s*\)?/gi,
  /\(\s*official\s*lyric\s*(video)?\s*\)?/gi,
  /\(\s*lyrics?\s*(video)?\s*\)?/gi,
  /\(\s*visualizer\s*\)?/gi,
  /\(\s*audio\s*\)?/gi,
  /\(\s*video\s*\)?/gi,
  /\(\s*mv\s*\)?/gi,
  /\(\s*m\/v\s*\)?/gi,
  
  // Quality indicators
  /\[?\s*hd\s*\]?/gi,
  /\[?\s*hq\s*\]?/gi,
  /\[?\s*4k\s*\]?/gi,
  /\[?\s*1080p\s*\]?/gi,
  /\[?\s*720p\s*\]?/gi,
  
  // Extras
  /\(\s*full\s*(song|audio|video)?\s*\)?/gi,
  /\(\s*extended\s*(version|mix)?\s*\)?/gi,
  /\(\s*remix\s*\)?/gi,
  /\(\s*remastered\s*\)?/gi,
  /\(\s*live\s*\)?/gi,
  /\(\s*acoustic\s*\)?/gi,
  /\(\s*radio\s*edit\s*\)?/gi,
  
  // Featuring indicators that might be in title
  /\s*\|\s*.*/gi, // Everything after pipe
  /\s*-\s*(official|audio|video|lyrics).*/gi, // Official/audio/video after dash
  
  // Brackets/parentheses with common content
  /\[.*?\]/g,
  /\(from\s+.*?\)/gi,
  /\(feat\.?\s+.*?\)/gi,
  /\(ft\.?\s+.*?\)/gi,
  /\(with\s+.*?\)/gi,
  
  // Year in parentheses
  /\(\d{4}\)/g,
];

// Patterns to extract clean artist from messy artist strings
const ARTIST_SEPARATORS = [
  ' - ',
  ' – ', // en-dash
  ' — ', // em-dash
  ' ft. ',
  ' ft ',
  ' feat. ',
  ' feat ',
  ' featuring ',
  ' x ',
  ' X ',
  ' & ',
  ' and ',
  ', ',
  ' with ',
];

/**
 * Clean a song title for the recommendation API
 */
export function cleanTitle(title: string): string {
  if (!title) return '';
  
  let cleaned = title.trim();
  
  // Apply all cleaning patterns
  for (const pattern of TITLE_PATTERNS_TO_REMOVE) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Remove artist name if it's in the format "Artist - Song"
  // We want just the song name
  const dashMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    // Take the second part (usually the song name) unless it's clearly metadata
    const [, first, second] = dashMatch;
    const secondLower = second.toLowerCase();
    
    // If second part looks like metadata, keep first part
    if (secondLower.includes('official') || secondLower.includes('audio') || 
        secondLower.includes('video') || secondLower.includes('lyrics')) {
      cleaned = first;
    } else {
      // Otherwise assume format is "Artist - Song Title"
      cleaned = second;
    }
  }
  
  // Clean up whitespace
  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .replace(/^\s*[-–—]\s*/g, '')
    .replace(/\s*[-–—]\s*$/g, '')
    .trim();
  
  // Remove trailing special characters
  cleaned = cleaned.replace(/[|:;,.\\-–—]+$/, '').trim();
  
  return cleaned;
}

/**
 * Clean an artist name for the recommendation API
 */
export function cleanArtist(artist: string): string {
  if (!artist) return '';
  
  let cleaned = artist.trim();
  
  // Get just the first/main artist
  for (const sep of ARTIST_SEPARATORS) {
    if (cleaned.includes(sep)) {
      cleaned = cleaned.split(sep)[0];
      break;
    }
  }
  
  // Remove any parenthetical content
  cleaned = cleaned.replace(/\s*\(.*?\)\s*/g, ' ');
  cleaned = cleaned.replace(/\s*\[.*?\]\s*/g, ' ');
  
  // Remove "VEVO", "Official", "Topic" suffixes
  cleaned = cleaned.replace(/\s*(VEVO|Official|Topic|Music)$/gi, '');
  
  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

/**
 * Extract clean song and artist from a YouTube video title
 * Handles common formats like "Artist - Song Title (Official Video)"
 */
export function extractSongInfo(
  rawTitle: string, 
  rawArtist: string
): { title: string; artist: string } {
  const cleanedArtist = cleanArtist(rawArtist);
  let cleanedTitle = cleanTitle(rawTitle);
  
  // If title still contains the artist name at the start, remove it
  if (cleanedArtist && cleanedTitle.toLowerCase().startsWith(cleanedArtist.toLowerCase())) {
    cleanedTitle = cleanedTitle.slice(cleanedArtist.length).replace(/^\s*[-–—:]\s*/, '').trim();
  }
  
  // Final cleanup
  cleanedTitle = cleanedTitle || 'Unknown';
  
  return {
    title: cleanedTitle,
    artist: cleanedArtist || 'Unknown',
  };
}
