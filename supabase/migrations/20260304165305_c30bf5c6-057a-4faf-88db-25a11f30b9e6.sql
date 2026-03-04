CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_order_source ON public.orders (order_source);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_phone ON public.orders (shipping_phone);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);