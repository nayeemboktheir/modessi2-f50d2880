import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Plus, Minus, Trash2, Star, Loader2, Phone, MessageCircle, UserCheck, History, AlertTriangle, ShieldAlert, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { syncOrderToBotBhai } from '@/services/botbhaiService';
import { Badge } from '@/components/ui/badge';

interface ProductVariation {
  id: string;
  name: string;
  price: number;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  stock: number;
  slug: string;
  variations?: ProductVariation[];
}

interface OrderItem {
  product: Product;
  quantity: number;
  variation?: ProductVariation;
  customPrice?: number; // Allow custom price override (can be 0 for free)
  customSize?: string; // Allow manual size/variant text entry
}

interface ManualOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderCreated: () => void;
}

// Bengali to English digit conversion
const BENGALI_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
};

function convertBengaliToEnglish(str: string): string {
  return str.replace(/[০-৯]/g, (match) => BENGALI_DIGITS[match] || match);
}

function normalizePhone(phone: string): string {
  let clean = convertBengaliToEnglish(phone).replace(/\s+/g, '').replace(/[^0-9]/g, '');
  if (clean.startsWith('88')) clean = clean.substring(2);
  if (!clean.startsWith('0') && clean.length === 10) clean = `0${clean}`;
  return clean;
}

function normalizeVariationName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Parse pasted text to extract name, phone, address
function parsePastedText(text: string): { phone?: string; name?: string; address?: string } {
  const converted = convertBengaliToEnglish(text);
  const lines = converted.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
  
  let phone: string | undefined;
  let name: string | undefined;
  let address: string | undefined;
  
  // Find phone number (11 digits starting with 01)
  const phoneRegex = /(?:^|\s|:)(01[3-9][0-9]{8})(?:\s|$|,)/;
  const phoneMatch = converted.match(phoneRegex);
  if (phoneMatch) {
    phone = phoneMatch[1];
  } else {
    // Try to find any 11-digit number
    const anyPhone = converted.match(/\b(01[0-9]{9})\b/);
    if (anyPhone) phone = anyPhone[1];
  }
  
  // Process remaining parts
  const remainingParts: string[] = [];
  for (const line of lines) {
    const cleanLine = line.replace(/01[0-9]{9}/g, '').trim();
    if (cleanLine.length > 0) {
      remainingParts.push(cleanLine);
    }
  }
  
  // First non-phone part is usually name, rest is address
  if (remainingParts.length >= 1) {
    // If first part looks like a name (short, no numbers)
    const firstPart = remainingParts[0];
    if (firstPart.length <= 50 && !/\d/.test(firstPart)) {
      name = firstPart;
      if (remainingParts.length > 1) {
        address = remainingParts.slice(1).join(', ');
      }
    } else {
      // Might all be address
      address = remainingParts.join(', ');
    }
  }
  
  return { phone, name, address };
}

// Courier history types
type CourierStats = {
  name?: string;
  logo?: string;
  total_parcel?: number;
  success_parcel?: number;
  cancelled_parcel?: number;
  success_ratio?: number;
};

type CourierData = {
  summary?: CourierStats;
  pathao?: CourierStats;
  redx?: CourierStats;
  steadfast?: CourierStats;
  paperfly?: CourierStats;
  parceldex?: CourierStats;
};

type CourierHistoryApiResponse = {
  success?: boolean;
  data?: { courierData?: CourierData };
  error?: string;
};

const courierCache = new Map<string, { data?: CourierData; fetchedAt: number }>();

// Previous customer type
interface PreviousCustomer {
  phone: string;
  name: string;
  address: string;
  district: string;
  city: string;
  lastOrderDate: string;
  orderCount: number;
}

export function ManualOrderDialog({ open, onOpenChange, onOrderCreated }: ManualOrderDialogProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [codeSearch, setCodeSearch] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [selectedProductForSize, setSelectedProductForSize] = useState<Product | null>(null);
  
  // Customer info
  const [mobileNumber, setMobileNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [invoiceNote, setInvoiceNote] = useState('');
  const [steadfastNote, setSteadfastNote] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('steadfast');
  const [shippingZone, setShippingZone] = useState<'inside_dhaka' | 'outside_dhaka'>('outside_dhaka');
  
  // Pricing
  const [discount, setDiscount] = useState('');
  const [advance, setAdvance] = useState('');
  const [deliveryCharge, setDeliveryCharge] = useState('');

  // Courier history
  const [courierHistory, setCourierHistory] = useState<CourierData | undefined>();
  const [loadingCourier, setLoadingCourier] = useState(false);

  // Previous customers for autofill
  const [previousCustomers, setPreviousCustomers] = useState<PreviousCustomer[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [selectedCustomerData, setSelectedCustomerData] = useState<PreviousCustomer | null>(null);

  // Default shipping costs
  const SHIPPING_COSTS = {
    inside_dhaka: 60,
    outside_dhaka: 120,
  };

  const normalizedPhone = useMemo(() => normalizePhone(mobileNumber), [mobileNumber]);

  // Fetch courier history when phone has 11 digits
  useEffect(() => {
    if (normalizedPhone.length !== 11) {
      setCourierHistory(undefined);
      return;
    }

    const cached = courierCache.get(normalizedPhone);
    if (cached?.data) {
      setCourierHistory(cached.data);
      return;
    }

    let mounted = true;
    (async () => {
      setLoadingCourier(true);
      try {
        const { data, error } = await supabase.functions.invoke('courier-history', {
          body: { phone: normalizedPhone },
        });
        if (error) throw error;
        const response = data as CourierHistoryApiResponse | undefined;
        if (response?.error) throw new Error(response.error);
        
        const courierData = response?.data?.courierData;
        courierCache.set(normalizedPhone, { data: courierData, fetchedAt: Date.now() });
        if (mounted) setCourierHistory(courierData);
      } catch {
        // Silent fail
      } finally {
        if (mounted) setLoadingCourier(false);
      }
    })();

    return () => { mounted = false; };
  }, [normalizedPhone]);

  useEffect(() => {
    if (open) {
      loadProducts();
      loadPreviousCustomers();
      // Set default delivery charge based on zone
      setDeliveryCharge(SHIPPING_COSTS[shippingZone].toString());
    }
  }, [open]);

  useEffect(() => {
    // Update delivery charge when zone changes (unless manually edited)
    if (!deliveryCharge || deliveryCharge === SHIPPING_COSTS.inside_dhaka.toString() || deliveryCharge === SHIPPING_COSTS.outside_dhaka.toString()) {
      setDeliveryCharge(SHIPPING_COSTS[shippingZone].toString());
    }
  }, [shippingZone]);

  // Load previous customers from orders - optimized with limit
  const loadPreviousCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('shipping_phone, shipping_name, shipping_street, shipping_district, shipping_city, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      const customerMap = new Map<string, PreviousCustomer>();
      (data || []).forEach((order) => {
        const normalizedPhone = order.shipping_phone.replace(/\D/g, '').slice(-11);
        if (normalizedPhone.length === 11) {
          if (customerMap.has(normalizedPhone)) {
            customerMap.get(normalizedPhone)!.orderCount++;
          } else {
            customerMap.set(normalizedPhone, {
              phone: order.shipping_phone,
              name: order.shipping_name,
              address: order.shipping_street,
              district: order.shipping_district,
              city: order.shipping_city,
              lastOrderDate: order.created_at,
              orderCount: 1,
            });
          }
        }
      });

      setPreviousCustomers(Array.from(customerMap.values()));
    } catch (error) {
      console.error('Failed to load previous customers:', error);
    }
  };

  // Filter customer suggestions based on input
  const customerSuggestions = useMemo(() => {
    if (mobileNumber.length < 3) return [];
    const normalizedInput = normalizePhone(mobileNumber);
    return previousCustomers.filter(c => {
      const normalizedCustomerPhone = c.phone.replace(/\D/g, '').slice(-11);
      return normalizedCustomerPhone.includes(normalizedInput) || c.name.toLowerCase().includes(mobileNumber.toLowerCase());
    }).slice(0, 5);
  }, [mobileNumber, previousCustomers]);

  // Apply customer autofill
  const applyCustomerAutofill = (customer: PreviousCustomer) => {
    setMobileNumber(customer.phone.replace(/\D/g, '').slice(-11));
    setCustomerName(customer.name);
    setCustomerAddress(customer.address);
    setSelectedCustomerData(customer);
    setShowCustomerSuggestions(false);
  };

  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      // Fetch products and variations in parallel for speed
      const [productsResult, variationsResult] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, price, images, stock, slug')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('product_variations')
          .select('id, name, price, stock, product_id, sort_order')
          .eq('is_active', true)
          .order('sort_order'),
      ]);

      if (productsResult.error) throw productsResult.error;
      if (variationsResult.error) throw variationsResult.error;

      // Build a map of variations by product_id for O(1) lookup
      const variationsByProduct = new Map<string, typeof variationsResult.data>();
      (variationsResult.data || []).forEach((v) => {
        const list = variationsByProduct.get(v.product_id) || [];
        list.push(v);
        variationsByProduct.set(v.product_id, list);
      });

      const productsWithVariations = (productsResult.data || []).map((product) => {
        const perProduct = variationsByProduct.get(product.id) || [];
        const uniqueByName = Array.from(
          new Map(
            perProduct
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
              .map((v) => [normalizeVariationName(v.name), v])
          ).values()
        );

        return {
          ...product,
          variations: uniqueByName.map((v) => ({
            id: v.id,
            name: v.name,
            price: v.price,
            stock: v.stock,
          })),
        };
      });

      setProducts(productsWithVariations);
    } catch (error) {
      toast.error('Failed to load products');
    } finally {
      setLoadingProducts(false);
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesCode = !codeSearch || p.slug.toLowerCase().includes(codeSearch.toLowerCase());
    const matchesName = !nameSearch || p.name.toLowerCase().includes(nameSearch.toLowerCase());
    return matchesCode && matchesName;
  });

  // Handle product click - if it has variations, show size selector, otherwise add directly
  const handleProductClick = (product: Product) => {
    if (product.variations && product.variations.length > 0) {
      setSelectedProductForSize(product);
    } else {
      addProductWithoutVariation(product);
    }
  };

  // Add product without variation
  const addProductWithoutVariation = (product: Product) => {
    const existing = orderItems.find(item => item.product.id === product.id && !item.variation);
    if (existing) {
      updateQuantity(product.id, undefined, existing.quantity + 1);
    } else {
      setOrderItems([...orderItems, { product, quantity: 1 }]);
    }
  };

  // Add product with specific variation
  const addProductWithVariation = (product: Product, variation: ProductVariation) => {
    const existing = orderItems.find(item => item.product.id === product.id && item.variation?.id === variation.id);
    if (existing) {
      updateQuantity(product.id, variation.id, existing.quantity + 1);
    } else {
      setOrderItems([...orderItems, { product, quantity: 1, variation }]);
    }
    setSelectedProductForSize(null);
  };

  const updateQuantity = (productId: string, variationId: string | undefined, quantity: number) => {
    if (quantity < 1) {
      removeProduct(productId, variationId);
      return;
    }
    setOrderItems(orderItems.map(item => {
      if (item.product.id === productId) {
        if (variationId && item.variation?.id === variationId) {
          return { ...item, quantity };
        }
        if (!variationId && !item.variation) {
          return { ...item, quantity };
        }
      }
      return item;
    }));
  };

  const removeProduct = (productId: string, variationId?: string) => {
    setOrderItems(orderItems.filter(item => {
      if (item.product.id === productId) {
        if (variationId) {
          return item.variation?.id !== variationId;
        }
        return !!item.variation; // Keep items with variations if removing non-variation item
      }
      return true;
    }));
  };

  const subtotal = orderItems.reduce((sum, item) => {
    // Use custom price if set (even if 0), otherwise use variation/product price
    const basePrice = item.variation ? item.variation.price : item.product.price;
    const itemPrice = item.customPrice !== undefined ? item.customPrice : basePrice;
    return sum + itemPrice * item.quantity;
  }, 0);
  const discountAmount = Number(discount) || 0;
  const advanceAmount = Number(advance) || 0;
  const shippingCost = Number(deliveryCharge) || 0;
  const grandTotal = subtotal - discountAmount + shippingCost - advanceAmount;

  // Update custom price for an item
  const updateCustomPrice = (productId: string, variationId: string | undefined, price: number | undefined) => {
    setOrderItems(orderItems.map(item => {
      if (item.product.id === productId) {
        if (variationId && item.variation?.id === variationId) {
          return { ...item, customPrice: price };
        }
        if (!variationId && !item.variation) {
          return { ...item, customPrice: price };
        }
      }
      return item;
    }));
  };

  // Update custom size text for an item
  const updateCustomSize = (productId: string, variationId: string | undefined, size: string) => {
    setOrderItems(orderItems.map(item => {
      if (item.product.id === productId) {
        if (variationId && item.variation?.id === variationId) {
          return { ...item, customSize: size || undefined };
        }
        if (!variationId && !item.variation) {
          return { ...item, customSize: size || undefined };
        }
      }
      return item;
    }));
  };

  const resetForm = () => {
    setOrderItems([]);
    setMobileNumber('');
    setCustomerName('');
    setCustomerAddress('');
    setInvoiceNote('');
    setSteadfastNote('');
    setDeliveryMethod('steadfast');
    setShippingZone('outside_dhaka');
    setDiscount('');
    setAdvance('');
    setDeliveryCharge(SHIPPING_COSTS.outside_dhaka.toString());
    setCodeSearch('');
    setNameSearch('');
    setCourierHistory(undefined);
    setSelectedCustomerData(null);
    setShowCustomerSuggestions(false);
    setSelectedProductForSize(null);
  };

  // Handle mobile number input with smart paste parsing
  const handleMobileInput = (value: string) => {
    // Convert Bengali to English
    const converted = convertBengaliToEnglish(value);
    
    // Check if this looks like pasted multi-field data
    if (converted.includes('\n') || converted.includes(',') || converted.length > 20) {
      const parsed = parsePastedText(value);
      
      if (parsed.phone) {
        setMobileNumber(parsed.phone);
      }
      if (parsed.name && !customerName) {
        setCustomerName(parsed.name);
      }
      if (parsed.address && !customerAddress) {
        setCustomerAddress(parsed.address);
      }
    } else {
      // Just a phone number - normalize and set
      let cleanNumber = converted.replace(/[^0-9+]/g, '');
      // Remove +88 or 88 prefix if present
      if (cleanNumber.startsWith('+88')) {
        cleanNumber = cleanNumber.substring(3);
      } else if (cleanNumber.startsWith('88') && cleanNumber.length > 11) {
        cleanNumber = cleanNumber.substring(2);
      }
      // Remove any remaining non-digit characters
      cleanNumber = cleanNumber.replace(/[^0-9]/g, '');
      // Limit to 11 digits
      setMobileNumber(cleanNumber.slice(0, 11));
    }
  };

  // Check if customer is a fraud risk (high cancellation rate or many cancelled orders)
  const getFraudRisk = () => {
    const summary = courierHistory?.summary;
    if (!summary) return null;
    
    const successRate = summary.success_ratio ?? 0;
    const cancelled = summary.cancelled_parcel ?? 0;
    const total = summary.total_parcel ?? 0;
    
    if (cancelled >= 5 || successRate < 50) {
      return { level: 'high', message: 'High Risk - Many cancelled orders', color: 'bg-red-500' };
    }
    if (cancelled >= 2 || successRate < 70) {
      return { level: 'medium', message: 'Medium Risk - Some cancelled orders', color: 'bg-amber-500' };
    }
    if (total > 0 && successRate >= 80) {
      return { level: 'low', message: 'Good Customer', color: 'bg-green-500' };
    }
    return null;
  };

  const fraudRisk = getFraudRisk();

  // Courier history display component
  const CourierStatsDisplay = ({ label, stats }: { label: string; stats?: CourierStats }) => {
    const successRate = stats?.success_ratio ?? 0;
    const total = stats?.total_parcel ?? 0;
    const success = stats?.success_parcel ?? 0;
    const cancelled = stats?.cancelled_parcel ?? 0;
    
    const getColor = () => {
      if (total === 0) return 'text-muted-foreground';
      if (successRate >= 80) return 'text-green-600';
      if (successRate >= 50) return 'text-amber-600';
      return 'text-red-600';
    };
    
    return (
      <div className="border rounded-lg p-2 bg-card text-center">
        <p className="font-medium text-xs mb-1">{label}</p>
        <p className={`text-lg font-bold ${getColor()}`}>
          {total > 0 ? `${Math.round(successRate)}%` : '—'}
        </p>
        <div className="flex justify-center gap-2 text-xs text-muted-foreground">
          <span className="text-green-600">✓{success}</span>
          <span className="text-red-600">✗{cancelled}</span>
        </div>
      </div>
    );
  };

  const handleSubmit = async () => {
    if (!mobileNumber.trim()) {
      toast.error('Please enter mobile number');
      return;
    }
    if (!customerName.trim()) {
      toast.error('Please enter customer name');
      return;
    }
    if (!customerAddress.trim()) {
      toast.error('Please enter address');
      return;
    }
    if (orderItems.length === 0) {
      toast.error('Please add at least one product');
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('place-order', {
        body: {
          userId: null,
          items: orderItems.map(item => {
            const basePrice = item.variation ? item.variation.price : item.product.price;
            const itemPrice = item.customPrice !== undefined ? item.customPrice : basePrice;
            const variationName = item.variation?.name || null;
            // Build display name with custom size if provided
            const sizePart = item.customSize ? item.customSize : variationName;
            const displayName = sizePart ? `${item.product.name} (${sizePart})` : item.product.name;
            return {
              productId: item.product.id,
              variationId: item.variation?.id || null,
              variationName: item.customSize || variationName,
              quantity: item.quantity,
              productName: displayName,
              productImage: item.product.images?.[0] || null,
              price: itemPrice,
            };
          }),
          shipping: {
            name: customerName,
            phone: mobileNumber,
            address: customerAddress,
          },
          shippingZone,
          invoiceNote: invoiceNote || null,
          steadfastNote: steadfastNote || null,
          orderSource: 'manual',
          // Send admin-set pricing overrides
          customShippingCost: shippingCost,
          customDiscount: discountAmount,
          customAdvance: advanceAmount,
        },
      });

      if (error) throw error;
      
      // Check if the response contains an error (e.g., order blocking)
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      
      // Validate that we got an order number back
      if (!data?.orderNumber && !data?.orderId) {
        throw new Error('Order response missing order number');
      }

      // Sync to BotBhai in background
      const orderId = data.orderId || data.orderNumber;
      syncOrderToBotBhai({
        id: orderId,
        total: grandTotal,
        subtotal,
        shipping_cost: shippingCost,
        discount: discountAmount,
        status: 'pending',
        payment_method: 'cod',
        payment_status: 'unpaid',
        customer: {
          name: customerName,
          phone: mobileNumber,
          address: customerAddress,
        },
        items: orderItems.map(item => ({
          product_id: item.product.id,
          qty: item.quantity,
          price: item.customPrice !== undefined ? item.customPrice : (item.variation ? item.variation.price : item.product.price),
        })),
      }).catch(() => {});

      toast.success(`Order created successfully! Order #${data.orderNumber || data.orderId}`);
      resetForm();
      onOrderCreated();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Failed to create order:', error);
      toast.error(error.message || 'Failed to create order');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-lg font-semibold">New Order</DialogTitle>
          
          {/* Courier History Section - In Header Area */}
          {normalizedPhone.length === 11 && (
            <div className="mt-2">
              {loadingCourier ? (
                <div className="flex items-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Checking courier history...</span>
                </div>
              ) : courierHistory ? (
                <div className={`flex items-center gap-3 p-3 rounded-lg ${
                  fraudRisk?.level === 'high' 
                    ? 'bg-red-50 border-2 border-red-500 text-red-800' 
                    : fraudRisk?.level === 'medium'
                    ? 'bg-amber-50 border border-amber-400 text-amber-800'
                    : fraudRisk?.level === 'low'
                    ? 'bg-green-50 border border-green-400 text-green-800'
                    : 'bg-muted/50 border text-muted-foreground'
                }`}>
                  {fraudRisk?.level === 'high' ? (
                    <ShieldAlert className="h-6 w-6 text-red-600 shrink-0" />
                  ) : fraudRisk?.level === 'medium' ? (
                    <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0" />
                  ) : fraudRisk?.level === 'low' ? (
                    <CheckCircle className="h-6 w-6 text-green-600 shrink-0" />
                  ) : null}
                  <div className="flex-1">
                    <p className="font-semibold">{fraudRisk?.message || 'Courier History'}</p>
                    <div className="flex gap-4 text-sm">
                      <span>Total: <strong>{courierHistory.summary?.total_parcel || 0}</strong></span>
                      <span className="text-green-700">Success: <strong>{courierHistory.summary?.success_parcel || 0}</strong></span>
                      <span className="text-red-700">Cancelled: <strong>{courierHistory.summary?.cancelled_parcel || 0}</strong></span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-3xl font-bold ${
                      fraudRisk?.level === 'high' ? 'text-red-600' : 
                      fraudRisk?.level === 'medium' ? 'text-amber-600' : 
                      fraudRisk?.level === 'low' ? 'text-green-600' : 'text-foreground'
                    }`}>
                      {Math.round(courierHistory.summary?.success_ratio || 0)}%
                    </span>
                    <p className="text-xs opacity-70">Success Rate</p>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogHeader>

        <div className="p-4 pt-2 space-y-4">

          {/* Customer Information Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="mobileNumber" className="text-sm text-muted-foreground flex items-center gap-2">
                Mobile Number
                {selectedCustomerData && (
                  <Badge variant="secondary" className="gap-1 text-xs bg-amber-100 text-amber-700">
                    <UserCheck className="h-3 w-3" />
                    Repeat ({selectedCustomerData.orderCount} orders)
                  </Badge>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="mobileNumber"
                  value={mobileNumber}
                  onChange={(e) => {
                    handleMobileInput(e.target.value);
                    setShowCustomerSuggestions(true);
                    setSelectedCustomerData(null);
                  }}
                  onFocus={() => setShowCustomerSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 200)}
                  onPaste={(e) => {
                    e.preventDefault();
                    const pastedText = e.clipboardData.getData('text');
                    handleMobileInput(pastedText);
                  }}
                  placeholder="Enter or paste info"
                  className="h-9 pr-16"
                  maxLength={11}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {mobileNumber.length === 11 && (
                    <>
                      <a 
                        href={`tel:${mobileNumber}`}
                        className="p-1 hover:bg-muted rounded text-blue-600"
                        title="Call"
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                      <a 
                        href={`https://wa.me/88${mobileNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 hover:bg-muted rounded text-green-600"
                        title="WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </>
                  )}
                </div>
                
                {/* Customer Autofill Suggestions */}
                {showCustomerSuggestions && customerSuggestions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {customerSuggestions.map((customer, index) => (
                      <button
                        key={index}
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-muted flex items-start gap-3 border-b last:border-b-0"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyCustomerAutofill(customer);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{customer.name}</span>
                            <Badge variant="secondary" className="gap-1 text-xs bg-amber-100 text-amber-700 shrink-0">
                              <History className="h-3 w-3" />
                              {customer.orderCount}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">{customer.phone}</div>
                          <div className="text-xs text-muted-foreground truncate">{customer.address}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customerName" className="text-sm text-muted-foreground">Name</Label>
              <Input
                id="customerName"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer Name"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Delivery Method</Label>
              <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="steadfast">Steadfast</SelectItem>
                  <SelectItem value="pathao">Pathao</SelectItem>
                  <SelectItem value="redx">RedX</SelectItem>
                  <SelectItem value="sundarban">Sundarban</SelectItem>
                  <SelectItem value="self">Self Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Address Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="address" className="text-sm text-muted-foreground">Address</Label>
              <Input
                id="address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Enter address"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Shipping Zone</Label>
              <Select value={shippingZone} onValueChange={(v: 'inside_dhaka' | 'outside_dhaka') => setShippingZone(v)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inside_dhaka">Inside Dhaka</SelectItem>
                  <SelectItem value="outside_dhaka">Outside Dhaka</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="invoiceNote" className="text-sm text-muted-foreground">Invoice Note (shows on invoice)</Label>
              <Input
                id="invoiceNote"
                value={invoiceNote}
                onChange={(e) => setInvoiceNote(e.target.value)}
                placeholder="Note for printed invoice..."
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="steadfastNote" className="text-sm text-muted-foreground">Steadfast Note (sent to courier)</Label>
              <Input
                id="steadfastNote"
                value={steadfastNote}
                onChange={(e) => setSteadfastNote(e.target.value)}
                placeholder="Note for Steadfast..."
                className="h-9"
              />
            </div>
          </div>

          {/* Products Section - Two Columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Ordered Products */}
            <Card className="border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-base font-semibold">Ordered Products</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 min-h-[250px]">
                {orderItems.length === 0 ? (
                  <p className="text-sm text-blue-500">No Products added. Please add products to the order</p>
                ) : (
                  <div className="space-y-2">
                    {orderItems.map((item, index) => {
                      const itemKey = item.variation ? `${item.product.id}-${item.variation.id}` : item.product.id;
                      const basePrice = item.variation ? item.variation.price : item.product.price;
                      const displayPrice = item.customPrice !== undefined ? item.customPrice : basePrice;
                      return (
                        <div
                          key={itemKey}
                          className="flex items-center gap-2 p-2 bg-muted/30 rounded-md"
                        >
                          {item.product.images?.[0] && (
                            <img
                              src={item.product.images[0]}
                              alt={item.product.name}
                              className="w-12 h-12 object-cover rounded"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.product.name}</p>
                            <div className="flex items-center gap-1 flex-wrap">
                              {item.variation && (
                                <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                                  {item.variation.name}
                                </Badge>
                              )}
                              <Input
                                type="text"
                                value={item.customSize || ''}
                                onChange={(e) => updateCustomSize(item.product.id, item.variation?.id, e.target.value)}
                                className="h-6 w-20 text-xs px-1 py-0"
                                placeholder="Size.."
                              />
                            </div>
                            {/* Editable price input */}
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-xs text-muted-foreground">৳</span>
                              <Input
                                type="number"
                                min="0"
                                value={displayPrice}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateCustomPrice(
                                    item.product.id,
                                    item.variation?.id,
                                    val === '' ? undefined : Number(val)
                                  );
                                }}
                                className="h-6 w-16 text-xs px-1 py-0"
                                placeholder={basePrice.toString()}
                              />
                              {item.customPrice !== undefined && item.customPrice !== basePrice && (
                                <span className="text-xs text-muted-foreground line-through">৳{basePrice}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, item.variation?.id, item.quantity - 1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center text-sm">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, item.variation?.id, item.quantity + 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => removeProduct(item.product.id, item.variation?.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <p className="font-medium text-sm w-16 text-right">
                            ৳{displayPrice * item.quantity}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Click To Add Products */}
            <Card className="border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-base font-semibold">Click To Add Products</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {/* Search Row */}
                <div className="flex gap-2 mb-3">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">Code/sku</Label>
                    <Input
                      value={codeSearch}
                      onChange={(e) => setCodeSearch(e.target.value)}
                      placeholder="Type to Search.."
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
                    <Input
                      value={nameSearch}
                      onChange={(e) => setNameSearch(e.target.value)}
                      placeholder="Type to Search.."
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                {/* Products List */}
                <div className="max-h-[200px] overflow-y-auto space-y-1">
                  {loadingProducts ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredProducts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No products found</p>
                  ) : (
                    filteredProducts.map(product => (
                      <div
                        key={product.id}
                        className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded-md cursor-pointer group"
                        onClick={() => handleProductClick(product)}
                      >
                        {product.images?.[0] ? (
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            className="w-14 h-14 object-cover rounded"
                          />
                        ) : (
                          <div className="w-14 h-14 bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
                            No img
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{product.name}</p>
                          <p className="text-xs text-blue-600">SKU: {product.slug}</p>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-xs text-muted-foreground">Price: ৳{product.price}</p>
                            <p className="text-xs text-muted-foreground">Stock: {product.stock}</p>
                          </div>
                          {product.variations && product.variations.length > 0 && (
                            <p className="text-xs text-amber-600 font-medium">{product.variations.length} sizes available</p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-amber-500 hover:text-amber-600 opacity-70 group-hover:opacity-100"
                        >
                          <Star className="h-4 w-4 fill-current" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {/* Size Selector Popup */}
                {selectedProductForSize && (
                  <div className="mt-3 p-3 border-2 border-primary rounded-lg bg-primary/5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-sm">Select Size for: {selectedProductForSize.name}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => setSelectedProductForSize(null)}
                      >
                        ✕
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {/* Dedupe variations by normalized name to avoid duplicates */}
                      {Array.from(
                        new Map(
                          (selectedProductForSize.variations || [])
                            .map((v) => [normalizeVariationName(v.name), v])
                        ).values()
                      ).map((variation) => (
                        <Button
                          key={variation.id}
                          variant="outline"
                          size="sm"
                          className="h-8 px-3 hover:bg-primary hover:text-primary-foreground"
                          onClick={() => addProductWithVariation(selectedProductForSize, variation)}
                        >
                          {variation.name}
                          <span className="ml-1 text-xs opacity-70">(৳{variation.price})</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pricing Summary Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Discount</Label>
              <Input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Advance</Label>
              <Input
                type="number"
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sub Total</Label>
              <Input
                value={subtotal}
                readOnly
                className="h-8 text-sm bg-muted/50"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">DeliveryCharge</Label>
              <Input
                type="number"
                value={deliveryCharge}
                onChange={(e) => setDeliveryCharge(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-primary">Grand Total</Label>
              <Input
                value={grandTotal}
                readOnly
                className="h-8 text-sm bg-muted/50 font-semibold"
              />
            </div>
          </div>

          {/* Create Order Button */}
          <Button
            onClick={handleSubmit}
            disabled={creating}
            className="w-full h-10 bg-emerald-500 hover:bg-emerald-600 text-white font-medium"
          >
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              `Create Order (${grandTotal.toFixed(2)}৳)`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
