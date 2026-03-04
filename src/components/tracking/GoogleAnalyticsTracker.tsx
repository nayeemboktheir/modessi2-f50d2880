import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useGoogleAnalytics } from '@/hooks/useGoogleAnalytics';

/**
 * Component that initializes Google Analytics/GTM and tracks page views
 * Place this inside the BrowserRouter in App.tsx
 * Excludes admin routes from tracking
 */
const GoogleAnalyticsTracker = () => {
  const location = useLocation();
  const { trackPageView } = useGoogleAnalytics();
  const lastTrackedPath = useRef<string>('');

  // Track page views on route changes, excluding admin routes
  useEffect(() => {
    if (location.pathname.startsWith('/admin')) return;
    if (location.pathname === lastTrackedPath.current) return;
    
    lastTrackedPath.current = location.pathname;
    trackPageView(location.pathname);
  }, [location.pathname, trackPageView]);

  return null;
};

export default GoogleAnalyticsTracker;
