import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAdmin: boolean;
  signUp: (email: string, password: string, fullName: string, phone?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Cache admin check to avoid redundant queries
const adminCache = new Map<string, { isAdmin: boolean; timestamp: number }>();
const ADMIN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const initializedRef = useRef(false);
  const adminCheckRef = useRef<string | null>(null);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          await checkAdminRole(initialSession.user.id);
        } else {
          setIsAdmin(false);
          adminCheckRef.current = null;
        }
      } finally {
        setIsLoading(false);
        initializedRef.current = true;
      }
    };

    void initializeAuth();

    // Then listen for changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        // Skip if this is the initial event before getSession resolves
        if (!initializedRef.current) return;

        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Only re-check admin if user changed
          if (adminCheckRef.current !== newSession.user.id) {
            setIsLoading(true);
            void checkAdminRole(newSession.user.id).finally(() => {
              setIsLoading(false);
            });
          }
        } else {
          setIsAdmin(false);
          adminCheckRef.current = null;
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkAdminRole = async (userId: string) => {
    // Check cache first
    const cached = adminCache.get(userId);
    if (cached && Date.now() - cached.timestamp < ADMIN_CACHE_TTL) {
      setIsAdmin(cached.isAdmin);
      adminCheckRef.current = userId;
      return;
    }

    try {
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();
      
      const result = !!data;
      adminCache.set(userId, { isAdmin: result, timestamp: Date.now() });
      adminCheckRef.current = userId;
      setIsAdmin(result);
    } catch (err) {
      console.error('Error checking admin role:', err);
      adminCache.set(userId, { isAdmin: false, timestamp: Date.now() });
      adminCheckRef.current = userId;
      setIsAdmin(false);
    }
  };

  const signUp = async (email: string, password: string, fullName: string, phone?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          phone: phone || null,
        }
      }
    });

    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      isLoading,
      isAdmin,
      signUp,
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
