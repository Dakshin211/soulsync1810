// Shared Playlist Service - handles sharing playlists with links
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

interface SharedPlaylist {
  id: string;
  name: string;
  originalUserId: string;
  originalPlaylistId: string;
  songs: Song[];
  createdAt: string;
  shareCode: string;
}

interface SharedPlaylistRef {
  sharedPlaylistId: string;
  savedAt: string;
}

// Generate a unique share code
function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Share a playlist and get a shareable link
export async function sharePlaylist(
  playlistId: string,
  playlistName: string,
  songs: Song[],
  userId: string
): Promise<{ shareCode: string; shareUrl: string }> {
  // Check if playlist is already shared
  const playlistRef = doc(db, 'Playlists', playlistId);
  const playlistSnap = await getDoc(playlistRef);
  
  if (playlistSnap.exists()) {
    const data = playlistSnap.data();
    
    // If already shared, return existing share code
    if (data.shareCode) {
      console.log('[SharedPlaylist] Playlist already shared:', data.shareCode);
      return {
        shareCode: data.shareCode,
        shareUrl: `${window.location.origin}/shared/${data.shareCode}`
      };
    }
  }
  
  // Generate new share code
  const shareCode = generateShareCode();
  
  // Create shared playlist document
  const sharedData: Omit<SharedPlaylist, 'id'> = {
    name: playlistName,
    originalUserId: userId,
    originalPlaylistId: playlistId,
    songs,
    createdAt: new Date().toISOString(),
    shareCode
  };
  
  await setDoc(doc(db, 'SharedPlaylists', shareCode), sharedData);
  
  // Update original playlist with share code
  await updateDoc(playlistRef, {
    isShared: true,
    shareCode
  });
  
  console.log('[SharedPlaylist] Created shared playlist:', shareCode);
  
  return {
    shareCode,
    shareUrl: `${window.location.origin}/shared/${shareCode}`
  };
}

// Get shared playlist by share code
export async function getSharedPlaylist(shareCode: string): Promise<SharedPlaylist | null> {
  try {
    const docRef = doc(db, 'SharedPlaylists', shareCode);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      console.log('[SharedPlaylist] Not found:', shareCode);
      return null;
    }
    
    return {
      id: docSnap.id,
      ...docSnap.data()
    } as SharedPlaylist;
  } catch (error) {
    console.error('[SharedPlaylist] Error getting shared playlist:', error);
    return null;
  }
}

// Save shared playlist to user's library
export async function saveSharedPlaylistToLibrary(
  shareCode: string,
  userId: string
): Promise<{ success: boolean; playlistId?: string; error?: string }> {
  try {
    // Get the shared playlist
    const sharedPlaylist = await getSharedPlaylist(shareCode);
    
    if (!sharedPlaylist) {
      return { success: false, error: 'Shared playlist not found' };
    }
    
    // Check if user already has this playlist saved
    const userPlaylistsRef = collection(db, 'Playlists');
    const q = query(
      userPlaylistsRef,
      where('userId', '==', userId),
      where('savedFromShareCode', '==', shareCode)
    );
    const existingSnap = await getDocs(q);
    
    if (!existingSnap.empty) {
      return { 
        success: false, 
        error: 'You already have this playlist in your library',
        playlistId: existingSnap.docs[0].id
      };
    }
    
    // Create a reference to the shared playlist instead of duplicating
    const newPlaylist = await addDoc(collection(db, 'Playlists'), {
      name: sharedPlaylist.name,
      userId,
      songs: sharedPlaylist.songs,
      createdAt: new Date().toISOString(),
      isSharedCopy: true,
      savedFromShareCode: shareCode,
      originalOwnerId: sharedPlaylist.originalUserId
    });
    
    console.log('[SharedPlaylist] Saved to library:', newPlaylist.id);
    
    return { success: true, playlistId: newPlaylist.id };
  } catch (error) {
    console.error('[SharedPlaylist] Error saving to library:', error);
    return { success: false, error: 'Failed to save playlist' };
  }
}

// Check if a playlist is shared
export async function isPlaylistShared(playlistId: string): Promise<{ isShared: boolean; shareCode?: string }> {
  try {
    const docRef = doc(db, 'Playlists', playlistId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return { isShared: false };
    }
    
    const data = docSnap.data();
    return {
      isShared: Boolean(data.isShared || data.shareCode),
      shareCode: data.shareCode
    };
  } catch (error) {
    console.error('[SharedPlaylist] Error checking share status:', error);
    return { isShared: false };
  }
}

// Unshare a playlist
export async function unsharePlaylist(playlistId: string, shareCode: string): Promise<boolean> {
  try {
    // Delete shared playlist document
    await setDoc(doc(db, 'SharedPlaylists', shareCode), { deleted: true }, { merge: true });
    
    // Update original playlist
    await updateDoc(doc(db, 'Playlists', playlistId), {
      isShared: false,
      shareCode: null
    });
    
    console.log('[SharedPlaylist] Unshared playlist:', playlistId);
    return true;
  } catch (error) {
    console.error('[SharedPlaylist] Error unsharing:', error);
    return false;
  }
}
