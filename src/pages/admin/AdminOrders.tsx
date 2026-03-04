import { useEffect, useState, useCallback, useMemo, useRef, memo } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Search, Eye, Package, Truck, CheckCircle, XCircle, Clock, Send, Printer, Globe, UserPlus, Plus, Check, Tag, RefreshCw, RotateCcw, Loader2, UserCheck, History, Trash2, Calendar, Edit } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { getAllOrders, getOrderById, updateOrderStatus, deleteOrder } from '@/services/adminService';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { CourierHistoryDialog } from '@/components/admin/CourierHistoryDialog';
import { InvoicePrintDialog } from '@/components/admin/InvoicePrintDialog';
import { StickerPrintDialog } from '@/components/admin/StickerPrintDialog';
import { ManualOrderDialog } from '@/components/admin/ManualOrderDialog';
import { OrderEditDialog } from '@/components/admin/OrderEditDialog';

interface SteadfastStatus {
  tracking_code: string;
  delivery_status?: string;
  current_status?: string;
  rider_name?: string;
  rider_phone?: string;
  error?: string;
}

interface OrderItem {
  id: string;
  product_name: string;
  product_image: string | null;
  quantity: number;
  price: number;
  variation_name: string | null;
}

interface Order {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  payment_method: string;
  total: number;
  subtotal: number;
  shipping_cost: number | null;
  discount: number | null;
  shipping_name: string;
  shipping_phone: string;
  shipping_street: string;
  shipping_city: string;
  shipping_district: string;
  shipping_postal_code: string | null;
  tracking_number: string | null;
  notes: string | null;
  invoice_note: string | null;
  steadfast_note: string | null;
  steadfast_consignment_id?: string | null;
  created_at: string;
  order_items: OrderItem[];
  order_source: string;
  is_printed: boolean;
}

const sourceOptions = [
  { value: 'web', label: 'Web Orders', icon: Globe },
  { value: 'manual', label: 'Manual Orders', icon: UserPlus },
];

const statusOptions = [
  { value: 'pending', label: 'Pending', icon: Clock, color: 'bg-yellow-500' },
  { value: 'processing', label: 'Processing', icon: Package, color: 'bg-blue-500' },
  { value: 'confirmed', label: 'Confirmed', icon: CheckCircle, color: 'bg-teal-500' },
  { value: 'shipped', label: 'Shipped', icon: Truck, color: 'bg-purple-500' },
  { value: 'delivered', label: 'Delivered', icon: CheckCircle, color: 'bg-green-500' },
  { value: 'returned', label: 'Returned', icon: XCircle, color: 'bg-orange-500' },
  { value: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'bg-red-500' },
];

const normalizePhoneForLookup = (phone: string): string => phone.replace(/\D/g, '').slice(-11);

const ORDERS_CACHE_KEY = 'admin_orders_cache_v2';
const ORDERS_CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const ORDERS_PAGE_SIZE = 50;

// Debounce hook for search
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleRows, setVisibleRows] = useState(ORDERS_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [steadfastFilter, setSteadfastFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [updating, setUpdating] = useState(false);
  const [sendingToSteadfast, setSendingToSteadfast] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkStatusChanging, setBulkStatusChanging] = useState(false);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [isStickerDialogOpen, setIsStickerDialogOpen] = useState(false);
  const [isManualOrderOpen, setIsManualOrderOpen] = useState(false);
  const [isEditOrderOpen, setIsEditOrderOpen] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState<Order | null>(null);
  const [steadfastStatuses, setSteadfastStatuses] = useState<Record<string, SteadfastStatus>>({});
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [invoiceNote, setInvoiceNote] = useState('');
  const [steadfastNote, setSteadfastNote] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const phoneOrderStats = useMemo(() => {
    const counts = new Map<string, number>();
    const groups = new Map<string, Order[]>();

    for (const order of orders) {
      const normalizedPhone = normalizePhoneForLookup(order.shipping_phone);
      counts.set(normalizedPhone, (counts.get(normalizedPhone) ?? 0) + 1);

      const existingGroup = groups.get(normalizedPhone);
      if (existingGroup) {
        existingGroup.push(order);
      } else {
        groups.set(normalizedPhone, [order]);
      }
    }

    for (const group of groups.values()) {
      group.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return { counts, groups };
  }, [orders]);

  const getOrderCount = useCallback((phone: string) => {
    return phoneOrderStats.counts.get(normalizePhoneForLookup(phone)) ?? 0;
  }, [phoneOrderStats]);

  const getPreviousOrders = useCallback((phone: string, excludeOrderId?: string) => {
    const ordersByPhone = phoneOrderStats.groups.get(normalizePhoneForLookup(phone)) ?? [];
    return excludeOrderId ? ordersByPhone.filter((o) => o.id !== excludeOrderId) : ordersByPhone;
  }, [phoneOrderStats]);

  const openEditDialog = (order: Order) => {
    setOrderToEdit(order);
    setIsEditOrderOpen(true);
  };

  useEffect(() => {
    let cachedLoaded = false;

    try {
      const raw = sessionStorage.getItem(ORDERS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { timestamp: number; data: Order[] };
        const isFresh = Date.now() - parsed.timestamp < ORDERS_CACHE_TTL;
        if (isFresh && Array.isArray(parsed.data) && parsed.data.length > 0) {
          setOrders(parsed.data);
          setLoading(false);
          cachedLoaded = true;
        }
      }
    } catch {
      // ignore cache parse errors
    }

    void loadOrders(!cachedLoaded);
  }, []);

  const loadOrders = async (showLoader = true) => {
    if (showLoader) setLoading(true);

    try {
      const data = await getAllOrders();
      const nextOrders = data || [];
      setOrders(nextOrders);
      sessionStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: nextOrders }));
    } catch (error) {
      toast.error('Failed to load orders');
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  const handleManualOrderCreated = async (orderId?: string) => {
    if (!orderId) {
      void loadOrders(false);
      return;
    }

    try {
      const createdOrder = await getOrderById(orderId) as Order;
      setOrders((prev) => {
        const exists = prev.some((order) => order.id === createdOrder.id);
        const next = exists
          ? prev.map((order) => (order.id === createdOrder.id ? createdOrder : order))
          : [createdOrder, ...prev];

        sessionStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: next }));
        return next;
      });
    } catch {
      void loadOrders(false);
    }
  };

  const handleOrderUpdated = useCallback((updatedOrder: Order) => {
    setOrders(prev => prev.map(o => (o.id === updatedOrder.id ? updatedOrder : o)));

    if (selectedOrder?.id === updatedOrder.id) {
      setSelectedOrder(updatedOrder);
      setTrackingNumber(updatedOrder.tracking_number || '');
      setInvoiceNote(updatedOrder.invoice_note || '');
      setSteadfastNote(updatedOrder.steadfast_note || '');
    }

    if (orderToEdit?.id === updatedOrder.id) {
      setOrderToEdit(updatedOrder);
    }
  }, [selectedOrder, orderToEdit]);

  // Fetch Steadfast statuses only for filtered/visible orders with tracking numbers
  const fetchSteadfastStatuses = useCallback(async (ordersToCheck?: Order[]) => {
    const targetOrders = ordersToCheck || orders;
    const ordersWithTracking = targetOrders.filter(o => o.tracking_number && !steadfastStatuses[o.tracking_number!]);
    if (ordersWithTracking.length === 0) return;

    // Limit to 50 at a time to avoid edge function timeout
    const batch = ordersWithTracking.slice(0, 50);

    setLoadingStatuses(true);
    try {
      const trackingCodes = batch.map(o => o.tracking_number!);
      
      const { data, error } = await supabase.functions.invoke('steadfast-status', {
        body: { tracking_codes: trackingCodes },
      });

      if (error) {
        console.error('Failed to fetch Steadfast statuses:', error);
        return;
      }

      if (data?.results) {
        setSteadfastStatuses(prev => ({ ...prev, ...data.results }));
      }
    } catch (error) {
      console.error('Error fetching Steadfast statuses:', error);
    } finally {
      setLoadingStatuses(false);
    }
  }, [orders, steadfastStatuses]);

  // Don't auto-fetch statuses on load - only on manual refresh

  const filteredOrders = useMemo(() => {
    const searchLower = debouncedSearch.toLowerCase();
    return orders.filter(order => {
      // Fast-path: status check first (most selective)
      if (statusFilter !== 'all' && order.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && order.order_source !== sourceFilter) return false;

      // Search
      if (searchLower && !(
        order.order_number.toLowerCase().includes(searchLower) ||
        order.shipping_name.toLowerCase().includes(searchLower) ||
        order.shipping_phone.includes(debouncedSearch)
      )) return false;

      // Date filter
      if (dateFrom || dateTo) {
        const orderTime = new Date(order.created_at).getTime();
        if (dateFrom) {
          const fromTime = new Date(dateFrom);
          fromTime.setHours(0, 0, 0, 0);
          if (orderTime < fromTime.getTime()) return false;
        }
        if (dateTo) {
          const toTime = new Date(dateTo);
          toTime.setHours(23, 59, 59, 999);
          if (orderTime > toTime.getTime()) return false;
        }
      }

      // Steadfast filter
      if (steadfastFilter !== 'all') {
        if (!order.tracking_number) return false;
        const sfStatus = steadfastStatuses[order.tracking_number];
        const deliveryStatus = (sfStatus?.delivery_status || sfStatus?.current_status || '').toLowerCase();
        if (steadfastFilter === 'returned' && !(deliveryStatus.includes('return') || deliveryStatus.includes('cancelled'))) return false;
        if (steadfastFilter === 'delivered' && !deliveryStatus.includes('delivered')) return false;
        if (steadfastFilter === 'in_transit' && !(deliveryStatus.includes('transit') || deliveryStatus.includes('picked') || deliveryStatus.includes('hub'))) return false;
        if (steadfastFilter === 'pending_delivery' && !(deliveryStatus.includes('pending') || deliveryStatus === '')) return false;
      }

      return true;
    });
  }, [orders, debouncedSearch, statusFilter, sourceFilter, steadfastFilter, dateFrom, dateTo, steadfastStatuses]);

  // Pre-computed counts — O(n) single pass instead of O(n * statuses)
  const { statusCounts, sourceCounts, totalBySource } = useMemo(() => {
    const sc: Record<string, number> = {};
    const src: Record<string, number> = {};
    const tbs: Record<string, Record<string, number>> = {};

    for (const order of orders) {
      src[order.order_source] = (src[order.order_source] || 0) + 1;

      // Status counts filtered by source
      if (!tbs[order.order_source]) tbs[order.order_source] = {};
      tbs[order.order_source][order.status] = (tbs[order.order_source][order.status] || 0) + 1;

      // Global status counts
      sc[order.status] = (sc[order.status] || 0) + 1;
    }

    return { statusCounts: sc, sourceCounts: src, totalBySource: tbs };
  }, [orders]);

  const getStatusCount = useCallback((status: string) => {
    if (sourceFilter === 'all') return statusCounts[status] || 0;
    return totalBySource[sourceFilter]?.[status] || 0;
  }, [statusCounts, totalBySource, sourceFilter]);

  const getSourceCount = useCallback((source: string) => {
    return sourceCounts[source] || 0;
  }, [sourceCounts]);

  useEffect(() => {
    setVisibleRows(ORDERS_PAGE_SIZE);
    setSelectedOrderIds(new Set());
  }, [debouncedSearch, statusFilter, sourceFilter, steadfastFilter, dateFrom, dateTo]);

  const displayedOrders = useMemo(
    () => filteredOrders.slice(0, visibleRows),
    [filteredOrders, visibleRows]
  );

  const hasMoreOrders = displayedOrders.length < filteredOrders.length;

  // Count for Steadfast filters
  const getSteadfastCount = (filterType: string) => {
    return orders.filter(order => {
      if (!order.tracking_number) return false;
      const sfStatus = steadfastStatuses[order.tracking_number];
      const deliveryStatus = sfStatus?.delivery_status?.toLowerCase() || sfStatus?.current_status?.toLowerCase() || '';
      
      if (filterType === 'returned') {
        return deliveryStatus.includes('return') || deliveryStatus.includes('cancelled');
      } else if (filterType === 'delivered') {
        return deliveryStatus.includes('delivered');
      } else if (filterType === 'in_transit') {
        return deliveryStatus.includes('transit') || deliveryStatus.includes('picked') || deliveryStatus.includes('hub');
      }
      return false;
    }).length;
  };


  const getSourceBadge = (source: string) => {
    const sourceOption = sourceOptions.find(s => s.value === source);
    if (!sourceOption) return <Badge variant="outline">{source || 'web'}</Badge>;

    const Icon = sourceOption.icon;
    return (
      <Badge variant="outline" className="gap-1">
        <Icon className="h-3 w-3" />
        {sourceOption.label}
      </Badge>
    );
  };

  const openOrderDetail = (order: Order) => {
    setSelectedOrder(order);
    setTrackingNumber(order.tracking_number || '');
    setInvoiceNote(order.invoice_note || '');
    setSteadfastNote(order.steadfast_note || '');
    setIsDetailOpen(true);
  };

  const handleSaveNotes = async () => {
    if (!selectedOrder) return;
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          invoice_note: invoiceNote || null,
          steadfast_note: steadfastNote || null,
        })
        .eq('id', selectedOrder.id);

      if (error) throw error;
      
      // Update local state
      setOrders(prev => prev.map(o => 
        o.id === selectedOrder.id 
          ? { ...o, invoice_note: invoiceNote || null, steadfast_note: steadfastNote || null }
          : o
      ));
      setSelectedOrder({ ...selectedOrder, invoice_note: invoiceNote || null, steadfast_note: steadfastNote || null });
      toast.success('Notes saved');
    } catch (error) {
      toast.error('Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    setUpdating(true);
    try {
      await updateOrderStatus(orderId, newStatus, trackingNumber || undefined);
      toast.success('Order status updated');
      
      // Update local state instantly
      const updatedOrders = orders.map(o => 
        o.id === orderId ? { ...o, status: newStatus, tracking_number: trackingNumber || o.tracking_number } : o
      );
      setOrders(updatedOrders);
      
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus, tracking_number: trackingNumber || selectedOrder.tracking_number });
      }
      
      // Background tasks - don't block UI
      const order = orders.find(o => o.id === orderId);
      if (order) {
        sendStatusSms(order, newStatus);
      }
    } catch (error) {
      toast.error('Failed to update order status');
    } finally {
      setUpdating(false);
    }
  };

  const sendStatusSms = async (order: Order, newStatus: string) => {
    try {
      // Check if auto-send is enabled
      const { data: smsSettings } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', ['sms_enabled', 'sms_auto_send_status_change']);

      const settings: Record<string, string> = {};
      smsSettings?.forEach((item) => {
        settings[item.key] = item.value;
      });

      if (settings.sms_enabled !== 'true' || settings.sms_auto_send_status_change !== 'true') {
        return;
      }

      // Map status to template key
      const statusTemplateMap: Record<string, string> = {
        'processing': 'order_processing',
        'confirmed': 'order_confirmed',
        'shipped': 'order_shipped',
        'delivered': 'order_delivered',
        'cancelled': 'order_cancelled',
      };

      const templateKey = statusTemplateMap[newStatus];
      if (!templateKey) return;

      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: {
          phone: order.shipping_phone,
          template_key: templateKey,
          order_id: order.id,
          variables: {
            customer_name: order.shipping_name,
            order_number: order.order_number,
            total: order.total.toString(),
            tracking_number: trackingNumber || order.tracking_number || '',
          },
        },
      });

      if (error) {
        console.error('SMS error:', error);
      } else if (data?.success) {
        toast.success('SMS notification sent');
      }
    } catch (error) {
      console.error('Failed to send status SMS:', error);
    }
  };

  const handleSendToSteadfast = async (order: Order) => {
    setSendingToSteadfast(true);
    try {
      const fullAddress = `${order.shipping_street}, ${order.shipping_district}, ${order.shipping_city}${order.shipping_postal_code ? `, ${order.shipping_postal_code}` : ''}`;
      
      // Use steadfast_note if available, otherwise fall back to notes, then to item list
      const noteToSend = order.steadfast_note || order.notes || `Order items: ${order.order_items.map(i => `${i.product_name}${i.variation_name ? ` (${i.variation_name})` : ''} x${i.quantity}`).join(', ')}`;
      
      const { data, error } = await supabase.functions.invoke('steadfast-courier', {
        body: {
          orderId: order.id,
          invoice: order.order_number,
          recipient_name: order.shipping_name,
          recipient_phone: order.shipping_phone,
          recipient_address: fullAddress,
          cod_amount: order.payment_method === 'cod' ? Number(order.total) : 0,
          note: noteToSend,
        },
      });

      if (error) {
        console.error('Steadfast error:', error);
        toast.error(error.message || 'Failed to send order to Steadfast');
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success('Order sent to Steadfast successfully!');
      if (data?.tracking_code) {
        setTrackingNumber(data.tracking_code);
        // Update local state with tracking info
        setOrders(prev => prev.map(o => 
          o.id === order.id ? { ...o, tracking_number: data.tracking_code, steadfast_consignment_id: data.consignment_id } : o
        ));
        if (selectedOrder?.id === order.id) {
          setSelectedOrder(prev => prev ? { ...prev, tracking_number: data.tracking_code } : prev);
        }
      }
    } catch (error) {
      console.error('Failed to send to Steadfast:', error);
      toast.error('Failed to send order to Steadfast');
    } finally {
      setSendingToSteadfast(false);
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    const newSelected = new Set(selectedOrderIds);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrderIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedOrderIds.size > 0 && selectedOrderIds.size === displayedOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(displayedOrders.map(o => o.id)));
    }
  };

  const handleBulkSendToSteadfast = async () => {
    if (selectedOrderIds.size === 0) {
      toast.error('Please select orders to send');
      return;
    }

    setBulkSending(true);
    try {
      const ordersToSend = orders.filter(o => selectedOrderIds.has(o.id));
      
      const orderPayloads = ordersToSend.map(order => {
        const fullAddress = `${order.shipping_street}, ${order.shipping_district}, ${order.shipping_city}${order.shipping_postal_code ? `, ${order.shipping_postal_code}` : ''}`;
        // Use steadfast_note if available, otherwise fall back to notes, then to item list
        const noteToSend = order.steadfast_note || order.notes || `Order items: ${order.order_items.map(i => `${i.product_name}${i.variation_name ? ` (${i.variation_name})` : ''} x${i.quantity}`).join(', ')}`;
        return {
          orderId: order.id,
          invoice: order.order_number,
          recipient_name: order.shipping_name,
          recipient_phone: order.shipping_phone,
          recipient_address: fullAddress,
          cod_amount: order.payment_method === 'cod' ? Number(order.total) : 0,
          note: noteToSend,
        };
      });

      const { data, error } = await supabase.functions.invoke('steadfast-courier', {
        body: { orders: orderPayloads },
      });

      if (error) {
        console.error('Bulk Steadfast error:', error);
        toast.error(error.message || 'Failed to send orders to Steadfast');
        return;
      }

      if (data?.results) {
        const successCount = data.results.filter((r: { success: boolean }) => r.success).length;
        const failCount = data.results.filter((r: { success: boolean }) => !r.success).length;
        
        if (failCount > 0) {
          toast.warning(`Sent ${successCount} orders, ${failCount} failed`);
        } else {
          toast.success(`Successfully sent ${successCount} orders to Steadfast`);
        }
      }

      setSelectedOrderIds(new Set());
      // Update local state with tracking codes from results
      if (data?.results) {
        setOrders(prev => {
          const updated = [...prev];
          data.results.forEach((r: any) => {
            if (r.success && r.tracking_code) {
              const idx = updated.findIndex(o => o.id === r.orderId);
              if (idx !== -1) updated[idx] = { ...updated[idx], tracking_number: r.tracking_code };
            }
          });
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to bulk send to Steadfast:', error);
      toast.error('Failed to send orders to Steadfast');
    } finally {
      setBulkSending(false);
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedOrderIds.size === 0) {
      toast.error('Please select orders to update');
      return;
    }

    setBulkStatusChanging(true);
    try {
      const ordersToUpdate = orders.filter(o => selectedOrderIds.has(o.id));
      let successCount = 0;
      let failCount = 0;

      for (const order of ordersToUpdate) {
        try {
          await updateOrderStatus(order.id, newStatus);
          sendStatusSms(order, newStatus);
          successCount++;
        } catch (error) {
          console.error(`Failed to update order ${order.order_number}:`, error);
          failCount++;
        }
      }

      if (failCount > 0) {
        toast.warning(`Updated ${successCount} orders, ${failCount} failed`);
      } else {
        toast.success(`Successfully updated ${successCount} orders to ${newStatus}`);
      }

      setSelectedOrderIds(new Set());
      // Update local state instantly
      setOrders(prev => prev.map(o => 
        selectedOrderIds.has(o.id) ? { ...o, status: newStatus } : o
      ));
    } catch (error) {
      console.error('Failed to bulk update status:', error);
      toast.error('Failed to update order statuses');
    } finally {
      setBulkStatusChanging(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;
    
    setDeleting(true);
    try {
      await deleteOrder(orderToDelete.id);
      
      toast.success(`Order ${orderToDelete.order_number} deleted successfully`);
      // Remove from local state instantly
      setOrders(prev => prev.filter(o => o.id !== orderToDelete.id));
      setIsDeleteDialogOpen(false);
      setOrderToDelete(null);
      setIsDetailOpen(false);
    } catch (error) {
      console.error('Failed to delete order:', error);
      toast.error('Failed to delete order');
    } finally {
      setDeleting(false);
    }
  };

  const openDeleteDialog = (order: Order) => {
    setOrderToDelete(order);
    setIsDeleteDialogOpen(true);
  };

  const handleTogglePrinted = async (orderId: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ is_printed: !currentValue })
        .eq('id', orderId);

      if (error) throw error;

      setOrders(prev => prev.map(o => 
        o.id === orderId ? { ...o, is_printed: !currentValue } : o
      ));
      
      toast.success(!currentValue ? 'Marked as printed' : 'Marked as not printed');
    } catch (error) {
      toast.error('Failed to update print status');
    }
  };

  const getStatusBadge = (status: string) => {
    const statusOption = statusOptions.find(s => s.value === status);
    if (!statusOption) return <Badge>{status}</Badge>;

    const Icon = statusOption.icon;
    return (
      <Badge className={`${statusOption.color} text-white gap-1`}>
        <Icon className="h-3 w-3" />
        {statusOption.label}
      </Badge>
    );
  };

  const getSteadfastStatusBadge = (trackingNumber: string | null) => {
    if (!trackingNumber) {
      return <span className="text-muted-foreground text-xs">-</span>;
    }

    const sfStatus = steadfastStatuses[trackingNumber];
    
    if (!sfStatus) {
      if (loadingStatuses) {
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      }
      return <span className="text-muted-foreground text-xs">Loading...</span>;
    }

    if (sfStatus.error) {
      return <Badge variant="outline" className="text-xs">Error</Badge>;
    }

    const deliveryStatus = sfStatus.delivery_status || sfStatus.current_status || 'Unknown';
    const statusLower = deliveryStatus.toLowerCase();
    
    let color = 'bg-gray-500';
    let Icon = Clock;
    
    if (statusLower.includes('delivered')) {
      color = 'bg-green-500';
      Icon = CheckCircle;
    } else if (statusLower.includes('return') || statusLower.includes('cancelled')) {
      color = 'bg-red-500';
      Icon = RotateCcw;
    } else if (statusLower.includes('transit') || statusLower.includes('picked') || statusLower.includes('hub')) {
      color = 'bg-blue-500';
      Icon = Truck;
    } else if (statusLower.includes('pending')) {
      color = 'bg-yellow-500';
      Icon = Clock;
    }

    return (
      <div className="space-y-1">
        <Badge className={`${color} text-white gap-1 text-xs`}>
          <Icon className="h-3 w-3" />
          {deliveryStatus}
        </Badge>
        {sfStatus.rider_name && (
          <div className="text-xs text-muted-foreground">
            Rider: {sfStatus.rider_name}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Card>
          <CardContent className="p-0">
            <div className="space-y-4 p-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Orders</h1>
          <p className="text-muted-foreground">Manage and track customer orders</p>
        </div>
        <Button onClick={() => setIsManualOrderOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Order
        </Button>
      </div>

      {/* Source Tabs */}
      <Tabs value={sourceFilter} onValueChange={setSourceFilter} className="w-full">
        <TabsList className="h-auto p-1 bg-muted/50">
          <TabsTrigger 
            value="all" 
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-4"
          >
            All Orders
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
              {orders.length}
            </Badge>
          </TabsTrigger>
          {sourceOptions.map((source) => {
            const Icon = source.icon;
            return (
              <TabsTrigger 
                key={source.value} 
                value={source.value}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-4 gap-1.5"
              >
                <Icon className="h-4 w-4" />
                {source.label}
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {getSourceCount(source.value)}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Status Tabs */}
      <div className="overflow-x-auto">
        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full">
          <TabsList className="h-auto p-1 bg-muted/50 inline-flex w-auto min-w-full">
            {statusOptions.map((status) => (
              <TabsTrigger 
                key={status.value} 
                value={status.value}
                className="data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-4"
              >
                {status.label}
                <Badge variant="outline" className="ml-2 h-5 px-1.5 text-xs">
                  {getStatusCount(status.value)}
                </Badge>
              </TabsTrigger>
            ))}
            <TabsTrigger 
              value="all" 
              className="data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-4"
            >
              All
              <Badge variant="outline" className="ml-2 h-5 px-1.5 text-xs">
                {sourceFilter === 'all' ? orders.length : (sourceCounts[sourceFilter] || 0)}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Steadfast Status Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">Steadfast Status:</span>
        <div className="flex gap-2">
          <Button
            variant={steadfastFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSteadfastFilter('all')}
          >
            All
          </Button>
          <Button
            variant={steadfastFilter === 'returned' ? 'destructive' : 'outline'}
            size="sm"
            onClick={() => setSteadfastFilter('returned')}
            className="gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            Returned ({getSteadfastCount('returned')})
          </Button>
          <Button
            variant={steadfastFilter === 'delivered' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSteadfastFilter('delivered')}
            className="gap-1 bg-green-600 hover:bg-green-700 data-[active=true]:bg-green-600"
            data-active={steadfastFilter === 'delivered'}
          >
            <CheckCircle className="h-3 w-3" />
            Delivered ({getSteadfastCount('delivered')})
          </Button>
          <Button
            variant={steadfastFilter === 'in_transit' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSteadfastFilter('in_transit')}
            className="gap-1"
          >
            <Truck className="h-3 w-3" />
            In Transit ({getSteadfastCount('in_transit')})
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchSteadfastStatuses()}
          disabled={loadingStatuses}
          className="gap-1 ml-auto"
        >
          {loadingStatuses ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Status
        </Button>
      </div>

      <Card>
        <CardHeader>
        <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by order number, customer, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>
            
            {/* Date Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Calendar className="h-4 w-4" />
                    {dateFrom ? format(dateFrom, 'dd MMM yyyy') : 'From Date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Calendar className="h-4 w-4" />
                    {dateTo ? format(dateTo, 'dd MMM yyyy') : 'To Date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              
              {(dateFrom || dateTo) && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}
                  className="text-muted-foreground"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>
          
          <div className="flex gap-2 flex-wrap mt-4">
              {selectedOrderIds.size > 0 && (
                <>
                  <Select
                    onValueChange={handleBulkStatusChange}
                    disabled={bulkStatusChanging}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder={bulkStatusChanging ? 'Updating...' : `Change ${selectedOrderIds.size} Status`} />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((status) => {
                        const Icon = status.icon;
                        return (
                          <SelectItem key={status.value} value={status.value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              {status.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => setIsInvoiceDialogOpen(true)}
                    className="gap-2"
                  >
                    <Printer className="h-4 w-4" />
                    Print {selectedOrderIds.size} Invoice{selectedOrderIds.size > 1 ? 's' : ''}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsStickerDialogOpen(true)}
                    className="gap-2"
                  >
                    <Tag className="h-4 w-4" />
                    Print {selectedOrderIds.size} Sticker{selectedOrderIds.size > 1 ? 's' : ''}
                  </Button>
                  <Button
                    onClick={handleBulkSendToSteadfast}
                    disabled={bulkSending}
                    className="gap-2"
                  >
                    <Send className="h-4 w-4" />
                    {bulkSending ? 'Sending...' : `Send ${selectedOrderIds.size} to Steadfast`}
                  </Button>
                </>
              )}
            </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[1400px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={displayedOrders.length > 0 && selectedOrderIds.size > 0 && selectedOrderIds.size === displayedOrders.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Steadfast Status</TableHead>
                <TableHead>Print</TableHead>
                <TableHead>Change Status</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead className="text-right sticky right-0 bg-background shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedOrderIds.has(order.id)}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                    />
                  </TableCell>
                  <TableCell 
                    className="font-medium cursor-pointer hover:text-primary hover:underline"
                    onClick={() => openOrderDetail(order)}
                  >
                    {order.order_number}
                  </TableCell>
                  <TableCell>{getSourceBadge(order.order_source)}</TableCell>
                  <TableCell>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span 
                            className="truncate cursor-pointer hover:text-primary hover:underline"
                            onClick={() => openOrderDetail(order)}
                          >
                            {order.shipping_name}
                          </span>
                          {getOrderCount(order.shipping_phone) > 1 && (
                            <Badge variant="secondary" className="gap-1 text-xs bg-amber-100 text-amber-700 hover:bg-amber-200">
                              <UserCheck className="h-3 w-3" />
                              Repeat
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">{order.shipping_phone}</div>
                        
                      </div>
                      <div className="shrink-0 pt-1">
                        <CourierHistoryDialog phone={order.shipping_phone} customerName={order.shipping_name} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {order.order_items.slice(0, 3).map((item, idx) => (
                        <div
                          key={item.id}
                          className="relative w-10 h-10 rounded border bg-muted overflow-hidden shrink-0"
                          title={`${item.product_name}${item.variation_name ? ` (${item.variation_name})` : ''} x${item.quantity}`}
                        >
                          {item.product_image ? (
                            <img
                              src={item.product_image}
                              alt={item.product_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                              <Package className="h-4 w-4" />
                            </div>
                          )}
                          {item.quantity > 1 && (
                            <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] px-1 rounded-full min-w-[16px] text-center">
                              {item.quantity}
                            </span>
                          )}
                        </div>
                      ))}
                      {order.order_items.length > 3 && (
                        <div className="w-10 h-10 rounded border bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">
                          +{order.order_items.length - 3}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{format(new Date(order.created_at), 'MMM dd, yyyy')}</TableCell>
                  <TableCell>৳{Number(order.total).toFixed(0)}</TableCell>
                  <TableCell>
                    <Badge variant={order.payment_status === 'paid' ? 'default' : 'outline'}>
                      {order.payment_status}
                    </Badge>
                  </TableCell>
                  <TableCell>{getStatusBadge(order.status)}</TableCell>
                  <TableCell>{getSteadfastStatusBadge(order.tracking_number)}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => handleTogglePrinted(order.id, order.is_printed)}
                      className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                        order.is_printed 
                          ? 'bg-green-100 text-green-600 hover:bg-green-200' 
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      }`}
                      title={order.is_printed ? 'Printed - Click to unmark' : 'Not printed - Click to mark as printed'}
                    >
                      {order.is_printed ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        <Printer className="h-4 w-4" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={order.status}
                      onValueChange={(value) => handleStatusChange(order.id, value)}
                      disabled={updating}
                    >
                      <SelectTrigger className="w-[130px] h-8 text-xs">
                        <SelectValue placeholder="Change" />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((status) => {
                          const Icon = status.icon;
                          return (
                            <SelectItem key={status.value} value={status.value}>
                              <div className="flex items-center gap-2">
                                <Icon className="h-3 w-3" />
                                {status.label}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {order.tracking_number ? (
                      <a 
                        href={`https://steadfast.com.bd/t/${order.tracking_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex"
                      >
                        <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors">
                          <Truck className="h-3 w-3" />
                          {order.tracking_number}
                        </Badge>
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-sm">Not sent</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right sticky right-0 bg-background shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openOrderDetail(order)}
                        title="View order details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDeleteDialog(order)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Delete order"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredOrders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                    No orders found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasMoreOrders && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisibleRows((prev) => prev + ORDERS_PAGE_SIZE)}>
            Load More Orders ({filteredOrders.length - displayedOrders.length} remaining)
          </Button>
        </div>
      )}

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order {selectedOrder?.order_number}</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-medium mb-2 flex items-center gap-2">
                    Customer Information
                    {getOrderCount(selectedOrder.shipping_phone) > 1 && (
                      <Badge variant="secondary" className="gap-1 text-xs bg-amber-100 text-amber-700">
                        <UserCheck className="h-3 w-3" />
                        Repeat Customer
                      </Badge>
                    )}
                  </h3>
                  <div className="text-sm space-y-1 text-muted-foreground">
                    <p>{selectedOrder.shipping_name}</p>
                    <p>{selectedOrder.shipping_phone}</p>
                    <p>{selectedOrder.shipping_street}</p>
                    <p>{selectedOrder.shipping_district}, {selectedOrder.shipping_city}</p>
                    {selectedOrder.shipping_postal_code && <p>{selectedOrder.shipping_postal_code}</p>}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Order Details</h3>
                  <div className="text-sm space-y-1 text-muted-foreground">
                    <p>Date: {format(new Date(selectedOrder.created_at), 'PPpp')}</p>
                    <p>Payment: {selectedOrder.payment_method.toUpperCase()}</p>
                    <p>Payment Status: {selectedOrder.payment_status}</p>
                    {selectedOrder.notes && <p>Notes: {selectedOrder.notes}</p>}
                  </div>
                </div>
              </div>

              {/* Previous Orders Section */}
              {(() => {
                const previousOrders = getPreviousOrders(selectedOrder.shipping_phone, selectedOrder.id);
                if (previousOrders.length === 0) return null;
                return (
                  <div className="border rounded-lg p-3 bg-amber-50">
                    <h3 className="font-medium mb-2 flex items-center gap-2 text-amber-800">
                      <History className="h-4 w-4" />
                      Previous Orders ({previousOrders.length})
                    </h3>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {previousOrders.map((prevOrder) => (
                        <div key={prevOrder.id} className="flex items-center justify-between text-sm bg-white rounded px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-amber-700">{prevOrder.order_number}</span>
                            <span className="text-muted-foreground">
                              {format(new Date(prevOrder.created_at), 'dd MMM yyyy')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(prevOrder.status)}
                            <span className="font-medium">৳{Number(prevOrder.total).toFixed(0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div>
                <h3 className="font-medium mb-2">Items</h3>
                <div className="border rounded-lg divide-y">
                  {selectedOrder.order_items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 p-3">
                      {item.product_image && (
                        <img
                          src={item.product_image}
                          alt={item.product_name}
                          className="h-12 w-12 rounded object-cover"
                        />
                      )}
                      <div className="flex-1">
                        <p className="font-medium">{item.product_name}</p>
                        {item.variation_name && (
                          <p className="text-sm text-blue-600 font-medium">Size: {item.variation_name}</p>
                        )}
                        <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
                      </div>
                      <p className="font-medium">৳{Number(item.price).toFixed(0)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>৳{Number(selectedOrder.subtotal).toFixed(0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Shipping</span>
                  <span>৳{Number(selectedOrder.shipping_cost || 0).toFixed(0)}</span>
                </div>
                {selectedOrder.discount && Number(selectedOrder.discount) > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount</span>
                    <span>-৳{Number(selectedOrder.discount).toFixed(0)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t">
                  <span>Total</span>
                  <span>৳{Number(selectedOrder.total).toFixed(0)}</span>
                </div>
              </div>

              {/* Notes Section */}
              <div className="border-t pt-4 space-y-4">
                <h3 className="font-medium">Order Notes</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Invoice Note (shows on invoice)</Label>
                    <Textarea
                      value={invoiceNote}
                      onChange={(e) => setInvoiceNote(e.target.value)}
                      placeholder="Note to show on printed invoice..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Steadfast Note (sent to courier)</Label>
                    <Textarea
                      value={steadfastNote}
                      onChange={(e) => setSteadfastNote(e.target.value)}
                      placeholder="Note to send to Steadfast..."
                      rows={2}
                    />
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                >
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </Button>
              </div>

              <div className="border-t pt-4 space-y-4">
                <h3 className="font-medium">Update Status</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={selectedOrder.status}
                      onValueChange={(value) => handleStatusChange(selectedOrder.id, value)}
                      disabled={updating}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tracking Number</Label>
                    <Input
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="Enter tracking number"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsDetailOpen(false);
                      openEditDialog(selectedOrder);
                    }}
                    className="gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    Edit Order
                  </Button>
                  <Button
                    onClick={() => handleSendToSteadfast(selectedOrder)}
                    disabled={sendingToSteadfast || !!selectedOrder.tracking_number}
                    className="flex-1"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {sendingToSteadfast ? 'Sending...' : selectedOrder.tracking_number ? 'Already Sent to Steadfast' : 'Send to Steadfast'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => openDeleteDialog(selectedOrder)}
                    className="gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Order Edit Dialog */}
      <OrderEditDialog
        order={orderToEdit}
        open={isEditOrderOpen}
        onOpenChange={setIsEditOrderOpen}
        onOrderUpdated={handleOrderUpdated}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete order <strong>{orderToDelete?.order_number}</strong>? 
              This action cannot be undone and will permanently remove the order and all its items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOrder}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete Order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InvoicePrintDialog
        orders={orders.filter((o) => selectedOrderIds.has(o.id))}
        open={isInvoiceDialogOpen}
        onOpenChange={setIsInvoiceDialogOpen}
        onOrdersPrinted={(orderIds) => {
          // Update local state to reflect printed status
          setOrders(prev => prev.map(o => 
            orderIds.includes(o.id) ? { ...o, is_printed: true } : o
          ));
          setSelectedOrderIds(new Set());
        }}
      />

      <StickerPrintDialog
        orders={orders.filter((o) => selectedOrderIds.has(o.id))}
        open={isStickerDialogOpen}
        onOpenChange={setIsStickerDialogOpen}
        onOrdersPrinted={(orderIds) => {
          setOrders(prev => prev.map(o => 
            orderIds.includes(o.id) ? { ...o, is_printed: true } : o
          ));
          setSelectedOrderIds(new Set());
        }}
      />

      <ManualOrderDialog
        open={isManualOrderOpen}
        onOpenChange={setIsManualOrderOpen}
        onOrderCreated={handleManualOrderCreated}
      />
    </div>
  );
}
