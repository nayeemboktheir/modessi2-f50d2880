import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Trash2 } from 'lucide-react';

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
  created_at: string;
  order_items: OrderItem[];
  order_source: string;
  is_printed: boolean;
}

interface OrderEditDialogProps {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderUpdated: (updatedOrder: Order) => void;
}

const paymentMethods = [
  { value: 'cod', label: 'Cash on Delivery' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'bank', label: 'Bank Transfer' },
];

const paymentStatuses = [
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
];

export function OrderEditDialog({ order, open, onOpenChange, onOrderUpdated }: OrderEditDialogProps) {
  const [saving, setSaving] = useState(false);
  
  // Customer & Shipping fields
  const [shippingName, setShippingName] = useState('');
  const [shippingPhone, setShippingPhone] = useState('');
  const [shippingStreet, setShippingStreet] = useState('');
  const [shippingCity, setShippingCity] = useState('');
  const [shippingDistrict, setShippingDistrict] = useState('');
  const [shippingPostalCode, setShippingPostalCode] = useState('');
  
  // Payment fields
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [paymentStatus, setPaymentStatus] = useState('pending');
  
  // Pricing fields
  const [shippingCost, setShippingCost] = useState(0);
  const [discount, setDiscount] = useState(0);
  
  // Notes
  const [notes, setNotes] = useState('');
  
  // Order items
  const [items, setItems] = useState<OrderItem[]>([]);
  
  // Calculate subtotal from items
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const total = subtotal + shippingCost - discount;

  // Load order data when dialog opens
  useEffect(() => {
    if (order && open) {
      setShippingName(order.shipping_name || '');
      setShippingPhone(order.shipping_phone || '');
      setShippingStreet(order.shipping_street || '');
      setShippingCity(order.shipping_city || '');
      setShippingDistrict(order.shipping_district || '');
      setShippingPostalCode(order.shipping_postal_code || '');
      setPaymentMethod(order.payment_method || 'cod');
      setPaymentStatus(order.payment_status || 'pending');
      setShippingCost(Number(order.shipping_cost) || 0);
      setDiscount(Number(order.discount) || 0);
      setNotes(order.notes || '');
      setItems([...order.order_items]);
    }
  }, [order, open]);

  const handleItemChange = (index: number, field: keyof OrderItem, value: string | number) => {
    setItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      toast.error('Order must have at least one item');
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddItem = () => {
    const newItem: OrderItem = {
      id: `new-${Date.now()}`,
      product_name: 'New Item',
      product_image: null,
      quantity: 1,
      price: 0,
      variation_name: null,
    };
    setItems(prev => [...prev, newItem]);
  };

  const handleSave = async () => {
    if (!order) return;
    
    // Validation
    if (!shippingName.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (!shippingPhone.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!shippingStreet.trim()) {
      toast.error('Address is required');
      return;
    }
    if (items.length === 0) {
      toast.error('Order must have at least one item');
      return;
    }

    setSaving(true);
    try {
      const normalizedItems: OrderItem[] = items.map((item) => ({
        ...item,
        id: item.id.startsWith('new-') ? crypto.randomUUID() : item.id,
        product_name: item.product_name?.trim() || 'Item',
        quantity: Number(item.quantity) || 1,
        price: Number(item.price) || 0,
        variation_name: item.variation_name?.trim() || null,
      }));

      // Run independent operations in parallel to reduce save latency
      const [{ error: orderError }, { error: deleteError }] = await Promise.all([
        supabase
          .from('orders')
          .update({
            shipping_name: shippingName.trim(),
            shipping_phone: shippingPhone.trim(),
            shipping_street: shippingStreet.trim(),
            shipping_city: shippingCity.trim(),
            shipping_district: shippingDistrict.trim(),
            shipping_postal_code: shippingPostalCode.trim() || null,
            payment_method: paymentMethod,
            payment_status: paymentStatus,
            shipping_cost: shippingCost,
            discount: discount,
            notes: notes.trim() || null,
            subtotal: subtotal,
            total: total,
          })
          .eq('id', order.id),
        supabase
          .from('order_items')
          .delete()
          .eq('order_id', order.id),
      ]);

      if (orderError) throw orderError;
      if (deleteError) throw deleteError;

      const itemsToInsert = normalizedItems.map(item => ({
        id: item.id,
        order_id: order.id,
        product_name: item.product_name,
        product_image: item.product_image,
        quantity: item.quantity,
        price: item.price,
        variation_name: item.variation_name,
        product_id: null,
        variation_id: null,
      }));

      const { error: insertError } = await supabase
        .from('order_items')
        .insert(itemsToInsert);

      if (insertError) throw insertError;

      const updatedOrder: Order = {
        ...order,
        shipping_name: shippingName.trim(),
        shipping_phone: shippingPhone.trim(),
        shipping_street: shippingStreet.trim(),
        shipping_city: shippingCity.trim(),
        shipping_district: shippingDistrict.trim(),
        shipping_postal_code: shippingPostalCode.trim() || null,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        shipping_cost: shippingCost,
        discount,
        notes: notes.trim() || null,
        subtotal,
        total,
        order_items: normalizedItems,
      };

      toast.success('Order updated successfully');
      onOrderUpdated(updatedOrder);
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating order:', error);
      toast.error('Failed to update order');
    } finally {
      setSaving(false);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Order {order.order_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Customer Information */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Customer Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Name *</Label>
                <Input
                  value={shippingName}
                  onChange={(e) => setShippingName(e.target.value)}
                  placeholder="Enter customer name"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone Number *</Label>
                <Input
                  value={shippingPhone}
                  onChange={(e) => setShippingPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                />
              </div>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Shipping Address</h3>
            <div className="space-y-2">
              <Label>Street Address *</Label>
              <Textarea
                value={shippingStreet}
                onChange={(e) => setShippingStreet(e.target.value)}
                placeholder="House, Road, Area..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>District</Label>
                <Input
                  value={shippingDistrict}
                  onChange={(e) => setShippingDistrict(e.target.value)}
                  placeholder="District"
                />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={shippingCity}
                  onChange={(e) => setShippingCity(e.target.value)}
                  placeholder="City"
                />
              </div>
              <div className="space-y-2">
                <Label>Postal Code</Label>
                <Input
                  value={shippingPostalCode}
                  onChange={(e) => setShippingPostalCode(e.target.value)}
                  placeholder="Postal Code"
                />
              </div>
            </div>
          </div>

          {/* Payment Information */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Payment Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map((method) => (
                      <SelectItem key={method.value} value={method.value}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Status</Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentStatuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Order Items */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-medium text-lg">Order Items</h3>
              <Button variant="outline" size="sm" onClick={handleAddItem}>
                <Plus className="h-4 w-4 mr-1" />
                Add Item
              </Button>
            </div>
            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={item.id} className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                  <div className="flex-1 grid grid-cols-4 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs text-muted-foreground">Product Name</Label>
                      <Input
                        value={item.product_name}
                        onChange={(e) => handleItemChange(index, 'product_name', e.target.value)}
                        placeholder="Product name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Size/Variant</Label>
                      <Input
                        value={item.variation_name || ''}
                        onChange={(e) => handleItemChange(index, 'variation_name', e.target.value)}
                        placeholder="Size/Variant"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value) || 1)}
                      />
                    </div>
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-xs text-muted-foreground">Price (৳)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={item.price}
                      onChange={(e) => handleItemChange(index, 'price', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemoveItem(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Shipping Cost (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Discount (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span>৳{subtotal.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Shipping</span>
                <span>৳{shippingCost.toFixed(0)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span>-৳{discount.toFixed(0)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t pt-2">
                <span>Total</span>
                <span>৳{total.toFixed(0)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Order Notes</h3>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes about the order..."
                rows={2}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
