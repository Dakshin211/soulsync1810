// ============= ROLLBACK: Revert to previous version if issues occur =============
// Daily refresh mechanism for home data - uses Firestore meta doc for global coordination
import { refreshHomeData } from './homeDataService';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const REFRESH_TIME_HOUR = 12; // 12:00 PM
const REFRESH_CHECK_INTERVAL = 60 * 60 * 1000;

let refreshTimer: NodeJS.Timeout | null = null;
let lastRefreshDate: string | null = null;

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}


function getTimeUntilRefresh(): number {
  const now = new Date();
  const today = new Date(now);
  today.setHours(REFRESH_TIME_HOUR, 0, 0, 0);
  
  // If refresh time has passed today, schedule for tomorrow
  if (now >= today) {
    today.setDate(today.getDate() + 1);
  }
  
  return today.getTime() - now.getTime();
}

async function performDailyRefresh() {
  const today = getTodayDate();
  
  // Check if already refreshed today
  if (lastRefreshDate === today) {
    console.log('Already refreshed today, skipping...');
    return;
  }
  
  try {
    // Check Firestore meta doc to see if refresh needed (global coordination)
    const metaRef = doc(db, 'DailyMusicData', 'meta');
    const metaSnap = await getDoc(metaRef);
    
    if (metaSnap.exists()) {
      const meta = metaSnap.data();
      const lastUpdated = meta.lastUpdated?.toDate?.() || new Date(0);
      const lastUpdatedDate = lastUpdated.toISOString().split('T')[0];
      
      if (lastUpdatedDate === today) {
        console.log('✅ [DailyRefresh] Already refreshed globally today, skipping...');
        lastRefreshDate = today;
        return;
      }
    }
    
    // Add small random jitter (0-5 seconds) to avoid race conditions
    const jitter = Math.random() * 5000;
    await new Promise(resolve => setTimeout(resolve, jitter));
    
    // Double-check after jitter
    const metaSnap2 = await getDoc(metaRef);
    if (metaSnap2.exists()) {
      const meta = metaSnap2.data();
      const lastUpdated = meta.lastUpdated?.toDate?.() || new Date(0);
      const lastUpdatedDate = lastUpdated.toISOString().split('T')[0];
      
      if (lastUpdatedDate === today) {
        console.log('✅ [DailyRefresh] Another instance already refreshed, skipping...');
        lastRefreshDate = today;
        return;
      }
    }
    
    console.log('🔄 [DailyRefresh] Performing daily home data refresh (BATCHED)...');
    const startTime = Date.now();
    await refreshHomeData();
    const elapsed = Date.now() - startTime;
    
    // Update meta doc with serverTimestamp and token estimate
    await setDoc(metaRef, {
      lastUpdated: serverTimestamp(),
      date: today,
      status: 'completed',
      refreshDurationMs: elapsed,
      tokenEstimate: '~2500 tokens (batched)' // Much lower than before!
    });
    
    // Update Admin/RefreshStatus for monitoring
    const statusRef = doc(db, 'Admin', 'RefreshStatus');
    await setDoc(statusRef, {
      lastSuccess: serverTimestamp(),
      lastSuccessDate: today,
      durationMs: elapsed,
      method: 'batched-groq'
    }, { merge: true });
    
    lastRefreshDate = today;
    console.log(`✅ [DailyRefresh] Refresh completed in ${(elapsed / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error('❌ [DailyRefresh] Error during daily refresh:', error);
    
    // Update meta doc with error status
    try {
      const metaRef = doc(db, 'DailyMusicData', 'meta');
      await setDoc(metaRef, {
        lastUpdated: serverTimestamp(),
        date: today,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      const statusRef = doc(db, 'Admin', 'RefreshStatus');
      await setDoc(statusRef, {
        lastError: serverTimestamp(),
        lastErrorMsg: error instanceof Error ? error.message : 'Unknown error'
      }, { merge: true });
    } catch (e) {
      console.error('❌ [DailyRefresh] Failed to update meta doc:', e);
    }
  }
}

export function startDailyRefreshScheduler() {
  // ============= DISABLED: Home data refresh is now disabled =============
  // The songs in Firebase should remain the same
  console.log('📌 [DailyRefresh] Daily refresh is DISABLED - using cached Firebase data');
  return;
}

export function stopDailyRefreshScheduler() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Manual trigger for testing or force refresh
export async function triggerManualRefresh() {
  console.log('Manual refresh triggered');
  await performDailyRefresh();
}
