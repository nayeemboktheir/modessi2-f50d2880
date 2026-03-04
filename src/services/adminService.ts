import { supabase } from '@/integrations/supabase/client';

// Dashboard Stats
export type DateRange = 'today' | 'week' | 'month' | 'custom';

export interface DateRangeParams {
  range: DateRange;
  startDate?: Date;
  endDate?: Date;
}

export const getDateRangeBounds = (params: DateRangeParams): { start: Date; end: Date } => {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  
  let start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (params.range) {
    case 'today':
      // start is already set to today's beginning
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case 'month':
      start.setMonth(start.getMonth() - 1);
      break;
    case 'custom':
      if (params.startDate && params.endDate) {
        start = new Date(params.startDate);
        start.setHours(0, 0, 0, 0);
        end.setTime(params.endDate.getTime());
        end.setHours(23, 59, 59, 999);
      }
      break;
  }

  return { start, end };
};

export const getDashboardStats = async (dateParams?: DateRangeParams) => {
  const { start, end } = dateParams 
    ? getDateRangeBounds(dateParams) 
    : getDateRangeBounds({ range: 'week' });

  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // All queries run in parallel with server-side date filtering
  const [ordersResult, ordersCountResult, productsResult, usersCountResult, lowStockResult, pendingResult] = await Promise.all([
    // Filtered orders for chart data (only within date range)
    supabase.from('orders')
      .select('total, created_at, payment_status')
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .order('created_at', { ascending: false })
      .limit(200),
    // Total count of filtered orders (fast estimate)
    supabase.from('orders')
      .select('*', { count: 'planned', head: true })
      .gte('created_at', startISO)
      .lte('created_at', endISO),
    // Product count only (fast estimate)
    supabase.from('products')
      .select('*', { count: 'planned', head: true }),
    // User count only (fast estimate)
    supabase.from('profiles')
      .select('*', { count: 'planned', head: true }),
    // Low stock count (fast estimate)
    supabase.from('products')
      .select('*', { count: 'planned', head: true })
      .lt('stock', 10)
      .eq('is_active', true),
    // Pending orders count (within date range, fast estimate)
    supabase.from('orders')
      .select('*', { count: 'planned', head: true })
      .eq('status', 'pending')
      .gte('created_at', startISO)
      .lte('created_at', endISO),
  ]);

  const filteredOrders = ordersResult.data || [];

  const totalRevenue = filteredOrders
    .filter(o => o.payment_status === 'paid')
    .reduce((sum, order) => sum + Number(order.total), 0);

  return {
    totalOrders: ordersCountResult.count || 0,
    totalProducts: productsResult.count || 0,
    totalUsers: usersCountResult.count || 0,
    totalRevenue,
    pendingOrders: pendingResult.count || 0,
    lowStockProducts: lowStockResult.count || 0,
    recentOrders: filteredOrders,
    dateRange: { start, end },
  };
};

// Products CRUD
export const getAllProducts = async () => {
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      categories:category_id (id, name)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
};

export const createProduct = async (product: {
  name: string;
  slug: string;
  description?: string;
  price: number;
  original_price?: number;
  category_id?: string;
  stock: number;
  images?: string[];
  tags?: string[];
  is_featured?: boolean;
  is_new?: boolean;
  is_active?: boolean;
}) => {
  const { data, error } = await supabase
    .from('products')
    .insert([product])
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const updateProduct = async (id: string, updates: Partial<{
  name: string;
  slug: string;
  description: string;
  price: number;
  original_price: number;
  category_id: string;
  stock: number;
  images: string[];
  tags: string[];
  is_featured: boolean;
  is_new: boolean;
  is_active: boolean;
}>) => {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const deleteProduct = async (id: string) => {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// Categories CRUD
export const getAllCategories = async () => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data;
};

export const createCategory = async (category: {
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  parent_id?: string;
  sort_order?: number;
}) => {
  const { data, error } = await supabase
    .from('categories')
    .insert([category])
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const updateCategory = async (id: string, updates: Partial<{
  name: string;
  slug: string;
  description: string;
  image_url: string;
  parent_id: string;
  sort_order: number;
}>) => {
  const { data, error } = await supabase
    .from('categories')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const deleteCategory = async (id: string) => {
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// Orders Management
export const getAllOrders = async (limit = 200) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, status, payment_status, payment_method, total, subtotal, shipping_cost, discount,
      shipping_name, shipping_phone, shipping_street, shipping_city, shipping_district, shipping_postal_code,
      tracking_number, notes, invoice_note, steadfast_note, steadfast_consignment_id, created_at, order_source, is_printed,
      order_items (id, order_id, product_id, product_name, product_image, quantity, price, variation_name)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
};

export const getOrderById = async (orderId: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, status, payment_status, payment_method, total, subtotal, shipping_cost, discount,
      shipping_name, shipping_phone, shipping_street, shipping_city, shipping_district, shipping_postal_code,
      tracking_number, notes, invoice_note, steadfast_note, steadfast_consignment_id, created_at, order_source, is_printed,
      order_items (id, order_id, product_id, product_name, product_image, quantity, price, variation_name)
    `)
    .eq('id', orderId)
    .single();

  if (error) throw error;
  return data;
};

export const updateOrderStatus = async (id: string, status: string, trackingNumber?: string) => {
  const updates: { status: string; tracking_number?: string } = { status };
  if (trackingNumber) {
    updates.tracking_number = trackingNumber;
  }

  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const deleteOrder = async (id: string) => {
  // Delete SMS logs and order items in parallel first
  const [{ error: smsError }, { error: itemsError }] = await Promise.all([
    supabase.from('sms_logs').delete().eq('order_id', id),
    supabase.from('order_items').delete().eq('order_id', id),
  ]);

  if (smsError) throw smsError;
  if (itemsError) throw itemsError;

  // Then delete the order
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// Users Management
export const getAllUsers = async () => {
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (profilesError) throw profilesError;

  const { data: roles, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id, role');

  if (rolesError) throw rolesError;

  // Merge profiles with roles
  return profiles?.map(profile => ({
    ...profile,
    user_roles: roles?.filter(r => r.user_id === profile.user_id) || []
  })) || [];
};

export const updateUserRole = async (userId: string, role: 'admin' | 'user') => {
  const { data: existing } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('user_roles')
      .update({ role })
      .eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('user_roles')
      .insert([{ user_id: userId, role }]);
    if (error) throw error;
  }
};

// Inventory (Stock Management)
export const getLowStockProducts = async (threshold = 10) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .lt('stock', threshold)
    .eq('is_active', true)
    .order('stock', { ascending: true });

  if (error) throw error;
  return data;
};

export const updateProductStock = async (id: string, stock: number) => {
  const { data, error } = await supabase
    .from('products')
    .update({ stock })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

// Banners Management
export const getAllBanners = async () => {
  const { data, error } = await supabase
    .from('banners')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data;
};

export const createBanner = async (banner: {
  title: string;
  subtitle?: string;
  image_url: string;
  link_url?: string;
  is_active?: boolean;
  sort_order?: number;
}) => {
  const { data, error } = await supabase
    .from('banners')
    .insert([banner])
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const updateBanner = async (id: string, updates: Partial<{
  title: string;
  subtitle: string;
  image_url: string;
  link_url: string;
  is_active: boolean;
  sort_order: number;
}>) => {
  const { data, error } = await supabase
    .from('banners')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const deleteBanner = async (id: string) => {
  const { error } = await supabase
    .from('banners')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// Draft/Incomplete Orders
export const getAllDraftOrders = async () => {
  const { data, error } = await supabase
    .from('draft_orders')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data;
};

export const deleteDraftOrder = async (id: string) => {
  const { error } = await supabase
    .from('draft_orders')
    .delete()
    .eq('id', id);

  if (error) throw error;
};
