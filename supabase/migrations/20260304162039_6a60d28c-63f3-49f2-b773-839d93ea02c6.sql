
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role ON public.user_roles (user_id, role);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON public.products (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_product_variations_active ON public.product_variations (product_id, is_active) WHERE is_active = true;
