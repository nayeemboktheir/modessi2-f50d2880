import { ReactNode, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  LayoutDashboard, 
  Package, 
  FolderTree, 
  ShoppingCart, 
  Users, 
  Boxes,
  Image,
  LogOut,
  ChevronRight,
  Menu,
  Truck,
  History,
  Settings,
  Megaphone,
  MessageSquare,
  Share2,
  BarChart3,
  Home,
  Video,
  Shield,
  
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const adminNavItems = [
  { title: 'Dashboard', url: '/admin', icon: LayoutDashboard },
  { title: 'Reports', url: '/admin/reports', icon: BarChart3 },
  { title: 'Products', url: '/admin/products', icon: Package },
  { title: 'Categories', url: '/admin/categories', icon: FolderTree },
  { title: 'Orders', url: '/admin/orders', icon: ShoppingCart },
  { title: 'Incomplete Orders', url: '/admin/incomplete-orders', icon: ShoppingCart },
  { title: 'Order Protection', url: '/admin/order-protection', icon: Shield },
  { title: 'Contact Messages', url: '/admin/contact-submissions', icon: MessageSquare },
  { title: 'Landing Pages', url: '/admin/landing-pages', icon: Megaphone },
  { title: 'Courier History', url: '/admin/courier-history', icon: History },
  { title: 'Courier Settings', url: '/admin/courier-settings', icon: Truck },
  { title: 'Users', url: '/admin/users', icon: Users },
  { title: 'Inventory', url: '/admin/inventory', icon: Boxes },
  { title: 'Slider Settings', url: '/admin/banners', icon: Image },
  { title: 'Marketing', url: '/admin/marketing', icon: Megaphone },
  { title: 'SMS', url: '/admin/sms', icon: MessageSquare },
  { title: 'Social Media', url: '/admin/social-media', icon: Share2 },
  { title: 'Shop Settings', url: '/admin/shop-settings', icon: Settings },
  { title: 'Site Settings', url: '/admin/site-settings', icon: Settings },
  { title: 'Home Page Edit', url: '/admin/home-page-edit', icon: Home },
  { title: 'Landing Video', url: '/admin/landing-video-settings', icon: Video },
  
];

function AdminSidebar() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Fetch unread contact submissions count
  const { data: unreadContactCount = 0 } = useQuery({
    queryKey: ['unread-contact-submissions'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('contact_submissions')
        .select('*', { count: 'planned', head: true })
        .eq('is_read', false);
      
      if (error) throw error;
      return count || 0;
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: 120000, // Refresh every 2 minutes
  });

  // Fetch pending orders count
  const { data: pendingOrdersCount = 0 } = useQuery({
    queryKey: ['pending-orders-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'planned', head: true })
        .eq('status', 'pending');
      
      if (error) throw error;
      return count || 0;
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: 120000, // Refresh every 2 minutes
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <Sidebar className="border-r border-sidebar-border">
      <div className="p-4 border-b border-sidebar-border">
        <h1 className="font-display text-xl font-bold text-sidebar-foreground">
          Admin Panel
        </h1>
      </div>
      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminNavItems.map((item) => {
                const isActive = location.pathname === item.url || 
                  (item.url !== '/admin' && location.pathname.startsWith(item.url));
                
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink 
                        to={item.url} 
                        end={item.url === '/admin'}
                        className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                          isActive 
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' 
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                        }`}
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                        {item.url === '/admin/orders' && pendingOrdersCount > 0 && (
                          <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0.5 min-w-[20px] h-5 flex items-center justify-center">
                            {pendingOrdersCount}
                          </Badge>
                        )}
                        {item.url === '/admin/contact-submissions' && unreadContactCount > 0 && (
                          <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0.5 min-w-[20px] h-5 flex items-center justify-center">
                            {unreadContactCount}
                          </Badge>
                        )}
                        {isActive && item.url !== '/admin/contact-submissions' && item.url !== '/admin/orders' && <ChevronRight className="h-4 w-4 ml-auto" />}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="mt-auto p-4 border-t border-sidebar-border">
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </Sidebar>
  );
}

function AdminHeader() {
  return (
    <header className="h-14 border-b border-border bg-background flex items-center px-4 gap-4">
      <SidebarTrigger className="md:hidden">
        <Menu className="h-5 w-5" />
      </SidebarTrigger>
      <div className="flex-1" />
      <Button variant="outline" size="sm" asChild>
        <a href="/" target="_blank" rel="noopener noreferrer">
          View Store
        </a>
      </Button>
    </header>
  );
}

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { user, isLoading, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth');
    } else if (!isLoading && user && !isAdmin) {
      navigate('/');
    }
  }, [user, isLoading, isAdmin, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AdminSidebar />
        <div className="flex-1 flex flex-col">
          <AdminHeader />
          <main className="flex-1 p-6 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
