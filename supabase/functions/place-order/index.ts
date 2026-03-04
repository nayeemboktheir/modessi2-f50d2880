// Lovable Cloud Function: place-order
// Public endpoint (verify_jwt=false). Uses service role key to safely create orders for guests.
// Optimized for speed: returns response immediately, handles CAPI/SMS in background.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PlaceOrderBody = {
  userId?: string | null;
  items: Array<{
    productId: string;
    variationId?: string;
    quantity: number;
    productName?: string;
    productImage?: string | null;
    price?: number;
  }>;
  shipping: { name: string; phone: string; address: string };
  shippingZone?: 'inside_dhaka' | 'outside_dhaka';
  notes?: string;
  invoiceNote?: string | null;
  steadfastNote?: string | null;
  orderSource?: 'web' | 'manual' | 'landing_page';
  // Manual order overrides (only respected for orderSource === 'manual')
  customShippingCost?: number;
  customDiscount?: number;
  customAdvance?: number;
};

function normalizeBdPhoneLocal(phone: string) {
  // Canonicalize to BD local format: 01XXXXXXXXX
  // Accepts: 01..., 8801..., +8801..., spaces, dashes, etc.
  let digits = String(phone || '').replace(/\D/g, '');

  if (digits.startsWith('880')) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  if (digits.length === 11 && digits.startsWith('01')) return digits;

  // fallback: if we can't normalize cleanly, return digits as-is (validation will fail later)
  return digits;
}

function isBangladeshPhone(phone: string) {
  const local = normalizeBdPhoneLocal(phone);
  return /^01[3-9]\d{8}$/.test(local);
}

// Background task: Facebook purchase event is intentionally NOT sent here.
// We only count "Purchase" when the user reaches the order confirmation page.
// This prevents double-counting and ensures event_source_url is accurate.

// Background task: Send order email notification
async function sendOrderEmail(
  supabaseUrl: string,
  orderId: string,
  orderNumber: string,
  name: string,
  phone: string,
  address: string,
  subtotal: number,
  shippingCost: number,
  total: number,
  items: Array<{ productId: string | null; name: string; image: string | null; price: number; quantity: number }>,
  notes: string | null
) {
  try {
    console.log('Sending order email notification...');
    const emailUrl = `${supabaseUrl}/functions/v1/send-order-email`;
    const emailResponse = await fetch(emailUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId,
        order_number: orderNumber,
        customer_name: name,
        customer_phone: phone,
        customer_address: address,
        subtotal,
        shipping_cost: shippingCost,
        total,
        items: items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          price: i.price,
          image: i.image,
        })),
        notes,
      }),
    });
    const emailResult = await emailResponse.json();
    console.log('Email notification response:', JSON.stringify(emailResult));
  } catch (emailError) {
    console.error('Failed to send order email:', emailError);
  }
}

// Background task: Send SMS notification
async function sendOrderSms(
  supabaseUrl: string,
  serviceKey: string,
  phone: string,
  name: string,
  orderNumber: string,
  total: number,
  orderId: string
) {
  try {
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    
    const { data: smsSettings } = await supabase
      .from('admin_settings')
      .select('key, value')
      .in('key', ['sms_enabled', 'sms_auto_send_order_placed']);

    const settings: Record<string, string> = {};
    smsSettings?.forEach((s: { key: string; value: string }) => {
      settings[s.key] = s.value;
    });

    if (settings.sms_enabled === 'true' && settings.sms_auto_send_order_placed === 'true') {
      console.log('Sending order confirmation SMS...');
      const smsUrl = `${supabaseUrl}/functions/v1/send-sms`;
      const smsResponse = await fetch(smsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone,
          template_key: 'order_placed',
          order_id: orderId,
          variables: {
            customer_name: name,
            order_number: orderNumber,
            total: total.toString(),
          },
        }),
      });
      const smsResult = await smsResponse.json();
      console.log('SMS response:', JSON.stringify(smsResult));
    }
  } catch (smsError) {
    console.error('Failed to send order SMS:', smsError);
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Server not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      db: { schema: 'public' },
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
    });

    const body = (await req.json()) as PlaceOrderBody;

    // Basic validation
    const name = (body?.shipping?.name ?? '').trim();
    const phoneRaw = (body?.shipping?.phone ?? '').trim();
    const phone = normalizeBdPhoneLocal(phoneRaw);
    const address = (body?.shipping?.address ?? '').trim();

    if (!name || name.length > 100) {
      return new Response(JSON.stringify({ error: 'Invalid name' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate against canonical local form (01XXXXXXXXX)
    if (!phone || phone.length > 30 || !isBangladeshPhone(phone)) {
      return new Response(JSON.stringify({ error: 'Invalid phone number' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!address || address.length > 300) {
      return new Response(JSON.stringify({ error: 'Invalid address' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === ORDER PROTECTION: Fetch All Protection Settings ===
    const { data: protectionSettings } = await supabase
      .from('admin_settings')
      .select('key, value')
      .like('key', 'order_protection_%');
    
    const protectionMap: Record<string, string> = {};
    protectionSettings?.forEach((s: { key: string; value: string }) => {
      protectionMap[s.key] = s.value;
    });
    
    // Normalize phone number for comparison
    const normalizedPhone = phone; // already canonical local form
    const phoneVariants = [
      normalizedPhone,
      `+880${normalizedPhone.substring(1)}`,
      `880${normalizedPhone.substring(1)}`,
      normalizedPhone.replace(/^0/, ''), // 1XXXXXXXXX
    ];
    
    // === STATUS-BASED BLOCKING ===
    const statusBlockingEnabled = protectionMap['order_protection_status_blocking_enabled'] === 'true';
    const blockPendingOrders = protectionMap['order_protection_block_pending_orders'] !== 'false';
    const blockShippedOrders = protectionMap['order_protection_block_shipped_orders'] === 'true';
    const maxPendingOrders = parseInt(protectionMap['order_protection_max_pending_orders']) || 2;
    
    if (statusBlockingEnabled) {
      // Check for existing orders with blocking statuses
      const { data: existingOrders, error: existingError } = await supabase
        .from('orders')
        .select('id, status, order_number, created_at')
        .or(phoneVariants.map(p => `shipping_phone.eq.${p}`).join(','))
        .in('status', ['pending', 'processing', 'shipped'])
        .order('created_at', { ascending: false });
      
      if (!existingError && existingOrders && existingOrders.length > 0) {
        const pendingOrders = existingOrders.filter(o => o.status === 'pending' || o.status === 'processing');
        const shippedOrders = existingOrders.filter(o => o.status === 'shipped');
        
        // Block if has pending orders beyond limit
        if (blockPendingOrders && pendingOrders.length >= maxPendingOrders) {
          console.log(`Status-based blocking: Phone ${phone} has ${pendingOrders.length} pending orders`);
          return new Response(
            JSON.stringify({ 
              error: `আপনার ${pendingOrders.length}টি অর্ডার পেন্ডিং আছে। নতুন অর্ডার করতে আগের অর্ডার ডেলিভারি হওয়া পর্যন্ত অপেক্ষা করুন।`,
              errorCode: 'STATUS_BLOCKED_PENDING',
              pendingCount: pendingOrders.length,
              orderNumbers: pendingOrders.map(o => o.order_number),
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        
        // Block if has shipped orders (in transit)
        if (blockShippedOrders && shippedOrders.length > 0) {
          console.log(`Status-based blocking: Phone ${phone} has ${shippedOrders.length} shipped orders`);
          return new Response(
            JSON.stringify({ 
              error: `আপনার একটি অর্ডার ডেলিভারির জন্য পাঠানো হয়েছে। ডেলিভারি সম্পন্ন হলে নতুন অর্ডার করতে পারবেন।`,
              errorCode: 'STATUS_BLOCKED_SHIPPED',
              shippedCount: shippedOrders.length,
              orderNumbers: shippedOrders.map(o => o.order_number),
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }
    }
    
    // === TIME-BASED BLOCKING ===
    const timeBlockingEnabled = protectionMap['order_protection_time_blocking_enabled'] === 'true';
    const cooldownHours = parseInt(protectionMap['order_protection_order_cooldown_hours']) || 12;
    
    if (timeBlockingEnabled) {
      // Calculate the cutoff time
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - cooldownHours);
      
      // Check for recent orders from this phone number
      const { data: recentOrders, error: recentError } = await supabase
        .from('orders')
        .select('id, created_at, order_number, status')
        .or(phoneVariants.map(p => `shipping_phone.eq.${p}`).join(','))
        .gte('created_at', cutoffTime.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!recentError && recentOrders && recentOrders.length > 0) {
        const lastOrder = recentOrders[0];
        const lastOrderTime = new Date(lastOrder.created_at);
        const hoursAgo = Math.round((Date.now() - lastOrderTime.getTime()) / (1000 * 60 * 60));
        const minutesAgo = Math.round((Date.now() - lastOrderTime.getTime()) / (1000 * 60));
        const waitHours = Math.max(1, cooldownHours - hoursAgo);
        
        // Format Bengali status
        const statusBn: Record<string, string> = {
          pending: 'পেন্ডিং',
          processing: 'প্রসেসিং',
          shipped: 'শিপড',
          delivered: 'ডেলিভার্ড',
          cancelled: 'বাতিল',
          returned: 'রিটার্ন',
        };
        
        console.log(`Time-based blocking: Phone ${phone} has recent order ${lastOrder.order_number} from ${minutesAgo} minutes ago`);
        
        const timeAgoText = hoursAgo < 1 
          ? `${minutesAgo} মিনিট আগে` 
          : `${hoursAgo} ঘন্টা আগে`;
        
        return new Response(
          JSON.stringify({ 
            error: `আপনি ${timeAgoText} একটি অর্ডার করেছেন (${statusBn[lastOrder.status] || lastOrder.status})। অনুগ্রহ করে আরও ${waitHours} ঘন্টা পরে অর্ডার করুন।`,
            errorCode: 'TIME_BLOCKED',
            lastOrderNumber: lastOrder.order_number,
            lastOrderStatus: lastOrder.status,
            waitHours: waitHours,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > 50) {
      return new Response(JSON.stringify({ error: 'Cart is empty' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const cleanItems = body.items
      .map((i) => ({
        productId: String(i.productId || '').trim(),
        variationId: typeof i.variationId === 'string' ? i.variationId.trim() : undefined,
        quantity: Number(i.quantity || 0),
        productName: typeof i.productName === 'string' ? i.productName.trim() : undefined,
        productImage: typeof i.productImage === 'string' ? i.productImage.trim() : null,
        price: typeof i.price === 'number' ? Number(i.price) : undefined,
      }))
      .filter((i) => i.productId && Number.isFinite(i.quantity) && i.quantity > 0 && i.quantity <= 99);

    if (cleanItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid items' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Split between DB-backed UUID items and mock/custom items
    const uuidItems = cleanItems.filter((i) => uuidRegex.test(i.productId));
    const customItems = cleanItems.filter((i) => !uuidRegex.test(i.productId));

    // Fetch products for UUID items & compute totals from DB values (prevents client tampering)
    const productById = new Map<string, { id: string; name: string; price: number; images: string[] | null }>();
    const variationById = new Map<string, { id: string; product_id: string; name: string; price: number }>();

    if (uuidItems.length > 0) {
      const productIds = Array.from(new Set(uuidItems.map((i) => i.productId)));

      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, name, price, images')
        .in('id', productIds)
        .eq('is_active', true);

      if (productsError) throw productsError;

      for (const p of products ?? []) {
        productById.set(p.id, {
          id: p.id,
          name: p.name,
          price: Number(p.price),
          images: (p.images as unknown as string[] | null) ?? null,
        });
      }

      const variationIds = Array.from(
        new Set(uuidItems.map((i) => i.variationId).filter((v): v is string => !!v && uuidRegex.test(v)))
      );

      if (variationIds.length > 0) {
        const { data: variations, error: variationsError } = await supabase
          .from('product_variations')
          .select('id, product_id, name, price')
          .in('id', variationIds)
          .eq('is_active', true);

        if (variationsError) throw variationsError;

        for (const v of variations ?? []) {
          variationById.set(v.id, {
            id: v.id,
            product_id: v.product_id,
            name: v.name,
            price: Number(v.price),
          });
        }
      }
    }

    const isManualOrder = body.orderSource === 'manual';

    const enrichedDbItems = uuidItems.map((i) => {
      const p = productById.get(i.productId);
      if (!p) return null;

      const v = i.variationId ? variationById.get(i.variationId) : undefined;
      if (i.variationId && !v) return null;
      if (v && v.product_id !== p.id) return null;

      // For manual orders, use client-sent price if provided; otherwise use DB price
      const dbPrice = v ? Number(v.price) : Number(p.price);
      const itemPrice = (isManualOrder && typeof i.price === 'number' && Number.isFinite(i.price) && i.price >= 0)
        ? i.price
        : dbPrice;

      return {
        productId: p.id,
        variationId: v?.id ?? null,
        variationName: v?.name ?? null,
        name: v ? `${p.name} (${v.name})` : p.name,
        image: p.images?.[0] ?? null,
        price: itemPrice,
        quantity: i.quantity,
      };
    });

    if (enrichedDbItems.some((x) => x === null)) {
      return new Response(JSON.stringify({ error: 'Some items are unavailable' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const enrichedCustomItems = customItems.map((i) => {
      const itemName = (i.productName ?? '').trim();
      const price = Number(i.price);
      const image = i.productImage ? i.productImage.trim() : null;

      if (!itemName || itemName.length > 150) return null;
      if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return null;
      if (image && image.length > 2048) return null;

      return {
        productId: null as string | null,
        variationId: null as string | null,
        variationName: null as string | null,
        name: itemName,
        image,
        price,
        quantity: i.quantity,
      };
    });

    if (enrichedCustomItems.some((x) => x === null)) {
      return new Response(JSON.stringify({ error: 'Invalid items' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const itemsFinal = [
      ...(enrichedDbItems as Array<{
        productId: string | null;
        variationId: string | null;
        variationName: string | null;
        name: string;
        image: string | null;
        price: number;
        quantity: number;
      }>),
      ...(enrichedCustomItems as Array<{
        productId: string | null;
        variationId: string | null;
        variationName: string | null;
        name: string;
        image: string | null;
        price: number;
        quantity: number;
      }>),
    ];

    const subtotal = itemsFinal.reduce((sum, i) => sum + i.price * i.quantity, 0);
    
    // For manual orders, use admin-provided shipping cost and discount
    const shippingZone = body.shippingZone || 'outside_dhaka';
    const defaultShippingCost = shippingZone === 'inside_dhaka' ? 80 : 130;
    
    const shippingCost = (isManualOrder && typeof body.customShippingCost === 'number' && Number.isFinite(body.customShippingCost) && body.customShippingCost >= 0)
      ? body.customShippingCost
      : defaultShippingCost;
    
    const discount = (isManualOrder && typeof body.customDiscount === 'number' && Number.isFinite(body.customDiscount) && body.customDiscount >= 0)
      ? body.customDiscount
      : 0;
    
    const advance = (isManualOrder && typeof body.customAdvance === 'number' && Number.isFinite(body.customAdvance) && body.customAdvance >= 0)
      ? body.customAdvance
      : 0;
    
    const total = subtotal - discount + shippingCost - advance;
    
    // Parse notes and order source
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;
    const invoiceNote = typeof body.invoiceNote === 'string' ? body.invoiceNote.trim().slice(0, 500) : null;
    const steadfastNote = typeof body.steadfastNote === 'string' ? body.steadfastNote.trim().slice(0, 500) : null;
    const orderSource = isManualOrder ? 'manual' : (body.orderSource === 'landing_page' ? 'landing_page' : 'web');

    const orderId = crypto.randomUUID();

    // Insert order first (order_items has FK to orders)
    const { error: orderError } = await supabase.from('orders').insert([
      {
        id: orderId,
        user_id: body.userId ?? null,
        order_number: '',
        status: 'pending',
        payment_method: 'cod',
        payment_status: advance > 0 ? 'partial' : 'pending',
        subtotal,
        shipping_cost: shippingCost,
        discount,
        total,
        shipping_name: name,
        shipping_phone: phone,
        shipping_street: address,
        shipping_city: 'N/A',
        shipping_district: 'N/A',
        shipping_postal_code: null,
        notes: advance > 0 ? `${notes ? notes + ' | ' : ''}Advance: ৳${advance}` : notes,
        invoice_note: invoiceNote,
        steadfast_note: steadfastNote,
        order_source: orderSource,
      },
    ]);

    if (orderError) throw orderError;

    // Now insert order items
    const { error: itemsError } = await supabase.from('order_items').insert(
      itemsFinal.map((i) => ({
        order_id: orderId,
        product_id: i.productId,
        variation_id: i.variationId,
        product_name: i.name,
        variation_name: i.variationName,
        product_image: i.image,
        price: i.price,
        quantity: i.quantity,
      }))
    );

    if (itemsError) throw itemsError;

    // Fetch generated order number (fast query)
    const { data: orderData } = await supabase
      .from('orders')
      .select('order_number')
      .eq('id', orderId)
      .single();
    
    const orderNumber = orderData?.order_number || orderId;

    // Schedule background tasks using EdgeRuntime.waitUntil
    // These run after the response is sent, so the user doesn't wait
    const backgroundTasks = Promise.all([
      sendOrderSms(supabaseUrl, serviceKey, phone, name, orderNumber, total, orderId),
      sendOrderEmail(supabaseUrl, orderId, orderNumber, name, phone, address, subtotal, shippingCost, total, itemsFinal, notes),
    ]);

    // Use EdgeRuntime.waitUntil to run tasks in background after response
    // @ts-ignore - EdgeRuntime is available in Deno Deploy
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundTasks);
    } else {
      // Fallback: don't await, let it run in background
      backgroundTasks.catch(err => console.error('Background task error:', err));
    }

    // Return immediately - background tasks will continue
    return new Response(
      JSON.stringify({
        orderId,
        orderNumber,
        subtotal,
        shippingCost,
        total,
        items: itemsFinal,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('place-order error:', err);
    return new Response(JSON.stringify({ error: 'Failed to place order' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
