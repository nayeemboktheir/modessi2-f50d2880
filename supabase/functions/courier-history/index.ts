import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory cache to reduce API calls
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone } = await req.json();

    if (!phone) {
      return new Response(
        JSON.stringify({ error: 'Phone number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      console.error('Missing Supabase configuration');
      return new Response(
        JSON.stringify({ error: 'Server not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Clean phone number - remove +88 or 88 prefix if present
    let cleanPhone = phone.replace(/\s+/g, '').replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('88')) {
      cleanPhone = cleanPhone.substring(2);
    }
    // Ensure it starts with 0 for Bangladeshi numbers
    if (!cleanPhone.startsWith('0') && cleanPhone.length === 10) {
      cleanPhone = '0' + cleanPhone;
    }

    // Check cache first
    const cached = cache.get(cleanPhone);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log('Returning cached courier history for phone:', cleanPhone);
      return new Response(
        JSON.stringify({ success: true, data: cached.data, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get API key from environment
    const BDCOURIER_API_KEY = Deno.env.get('BDCOURIER_API_KEY');
    
    if (!BDCOURIER_API_KEY) {
      console.error('BDCOURIER_API_KEY secret is not configured');
      return new Response(
        JSON.stringify({ error: 'BD Courier API key not configured. Please add the BDCOURIER_API_KEY secret.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Checking courier history for phone:', cleanPhone);

    // BD Courier PAID API endpoint (api.bdcourier.com) - POST method
    const apiUrl = 'https://api.bdcourier.com/courier-check';
    
    console.log('Calling BD Courier API (POST):', apiUrl, 'phone:', cleanPhone);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BDCOURIER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ phone: cleanPhone }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    const responseText = await response.text();
    console.log('BD Courier API response status:', response.status);
    console.log('BD Courier API response:', responseText.substring(0, 500));

    // Handle rate limiting (429)
    if (response.status === 429) {
      console.error('BD Courier API rate limit reached');
      return new Response(
        JSON.stringify({ 
          success: false,
          rateLimited: true,
          message: 'BD Courier API rate limit reached. Please wait a few minutes and try again.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle unauthorized
    if (response.status === 401) {
      console.error('BD Courier API unauthorized - check API key');
      return new Response(
        JSON.stringify({ 
          success: false,
          unauthorized: true,
          message: 'BD Courier API key is invalid or expired.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      // Check if it's a Cloudflare challenge (bot protection)
      if (response.status === 403 && responseText.includes('challenge-platform')) {
        console.error('BD Courier API is blocking requests (Cloudflare protection)');
        return new Response(
          JSON.stringify({ 
            success: false,
            blocked: true,
            message: 'The courier history service is temporarily blocked. Please try again later or check manually at bdcourier.com'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch courier history',
          details: responseText.substring(0, 200)
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse response as JSON:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid response from courier API' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Parsed courier data structure:', Object.keys(data));

    // Normalize the response to a consistent format
    // Handle multiple response formats:
    // Format 1: { status: "success", data: { courierData: { pathao, steadfast, ... } } }
    // Format 2: { status: 200, data: { pathao, steadfast, ... } }
    // Format 3: { pathao, steadfast, ... } (direct format)
    
    let normalizedData = data;
    
    if (data.data?.courierData) {
      // New format with nested courierData
      normalizedData = {
        ...data,
        courierData: data.data.courierData
      };
    } else if (data.data && (data.data.summary || data.data.pathao || data.data.steadfast)) {
      // Legacy format with data wrapper
      normalizedData = {
        ...data,
        courierData: data.data
      };
    } else if (data.summary || data.pathao || data.steadfast) {
      // Direct format (no wrapper)
      normalizedData = {
        courierData: {
          pathao: data.pathao,
          steadfast: data.steadfast,
          redx: data.redx,
          paperfly: data.paperfly,
          parceldex: data.parceldex,
          summary: data.summary
        }
      };
    }

    console.log('Normalized courier data:', JSON.stringify(normalizedData).substring(0, 300));

    // Cache the result
    cache.set(cleanPhone, { data: normalizedData, timestamp: Date.now() });

    return new Response(
      JSON.stringify({ success: true, data: normalizedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in courier-history function:', error);

    // If upstream is slow/unreachable, fail gracefully (don't break admin UI)
    const isAbort =
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && /abort/i.test(error.message));

    if (isAbort) {
      return new Response(
        JSON.stringify({
          success: false,
          blocked: true,
          message: 'Courier history service timed out. Please try again later or check manually at bdcourier.com',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
