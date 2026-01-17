# IP Rotation for API Calls

## Current Limitation
The SoulSync app makes API calls directly from the client (browser), which means all requests use the user's IP address. True IP rotation requires a backend proxy/edge function.

## Recommendations for IP Rotation

### Option 1: Lovable Cloud Edge Functions (Recommended)
- Create edge functions that proxy YouTube API calls
- Each function invocation gets a different IP from Supabase infrastructure
- Example structure:
  ```
  supabase/functions/youtube-proxy/index.ts
  ```
- Benefits: Built-in, no external services needed

### Option 2: Third-party Proxy Services
- Use services like:
  - ScraperAPI
  - ProxyMesh
  - Bright Data
- Add proxy URLs to environment variables
- Call through proxy in API requests

### Option 3: Rate Limiting & Caching (Current Approach)
- Aggressive caching reduces API calls (24h for home data)
- Quota detection prevents hitting limits
- Store complete metadata in Firebase
- This is the currently implemented approach

## Implementation Notes
- Client-side code cannot change IP addresses
- Backend proxy is required for true IP rotation
- Current caching strategy minimizes the need for rotation
- Consider implementing Option 1 if quota issues persist

## Related Files
- src/services/youtubeApi.ts - YouTube API calls with quota detection
- src/services/homeDataService.ts - Daily refresh with caching
- src/services/dailyRefresh.ts - Scheduled refresh coordinator
