import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useFacebookPixel } from '@/hooks/useFacebookPixel';
import { useServerTracking } from '@/hooks/useServerTracking';

export function FacebookPixelTracker() {
  const location = useLocation();
  const { trackPageView: trackBrowserPageView, isEnabled, isReady, generateEventId } = useFacebookPixel();
  const { trackFacebookEvent } = useServerTracking();
  const lastTrackedPath = useRef<string>('');
  const hasTrackedInitial = useRef<boolean>(false);

  useEffect(() => {
    // Skip tracking for admin routes
    if (location.pathname.startsWith('/admin')) {
      return;
    }
    
    if (isEnabled && isReady) {
      const shouldTrack = location.pathname !== lastTrackedPath.current || !hasTrackedInitial.current;
      
      if (shouldTrack) {
        // Generate a shared event ID for deduplication between browser pixel and CAPI
        const eventId = generateEventId('PageView');
        
        // Track via browser pixel with event ID
        trackBrowserPageView(eventId);
        
        // Track via server-side Facebook CAPI ONLY (not GA/TikTok — they have their own trackers)
        trackFacebookEvent({ eventName: 'PageView', eventId }).catch(() => {});
        
        lastTrackedPath.current = location.pathname;
        hasTrackedInitial.current = true;
      }
    }
  }, [location.pathname, isEnabled, isReady, trackBrowserPageView, trackFacebookEvent, generateEventId]);

  return null;
}
