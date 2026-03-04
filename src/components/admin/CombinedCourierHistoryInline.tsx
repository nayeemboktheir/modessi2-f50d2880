import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle, CheckCircle, XCircle, Clock, TrendingUp, Truck, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CourierStats {
  total_parcel: number;
  success_parcel: number;
  cancelled_parcel: number;
  success_ratio: number;
}

interface InternalStats {
  total_orders: number;
  delivered: number;
  cancelled: number;
  pending: number;
  success_ratio: number | null;
  total_spent: number;
  risk_level: string;
}

interface BDCourierData {
  status?: string;
  courierData?: {
    pathao?: CourierStats & { name?: string; logo?: string };
    steadfast?: CourierStats & { name?: string; logo?: string };
    redx?: CourierStats & { name?: string; logo?: string };
    paperfly?: CourierStats & { name?: string; logo?: string };
    parceldex?: CourierStats & { name?: string; logo?: string };
    summary?: CourierStats;
  };
  // Legacy format support
  pathao?: CourierStats;
  steadfast?: CourierStats;
  redx?: CourierStats;
  paperfly?: CourierStats;
  summary?: CourierStats;
}

interface CombinedResponse {
  phone: string;
  internal: InternalStats;
  bd_courier: BDCourierData | null;
  bd_courier_available: boolean;
  combined_risk_level: string;
  cached?: boolean;
}

// Global cache for API results - shared across all instances
const cache = new Map<string, { data: CombinedResponse; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Global request queue to prevent parallel requests
const requestQueue: string[] = [];
let isProcessingQueue = false;

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^0-9]/g, "");
  // Align with backend normalization rules
  if (cleaned.startsWith("880")) {
    cleaned = "0" + cleaned.slice(3);
  }
  if (!cleaned.startsWith("0") && cleaned.length === 10) {
    cleaned = "0" + cleaned;
  }
  // Keep the last 11 digits (e.g., 01XXXXXXXXX)
  return cleaned.slice(-11);
}

// Progress ring component
function ProgressRing({ 
  percentage, 
  size = 32, 
  strokeWidth = 3,
  riskLevel 
}: { 
  percentage: number; 
  size?: number; 
  strokeWidth?: number;
  riskLevel: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  const getColor = () => {
    switch (riskLevel) {
      case "high": return "text-red-500";
      case "medium": return "text-amber-500";
      case "low": return "text-emerald-500";
      default: return "text-muted-foreground";
    }
  };

  const getBgColor = () => {
    switch (riskLevel) {
      case "high": return "stroke-red-100";
      case "medium": return "stroke-amber-100";
      case "low": return "stroke-emerald-100";
      default: return "stroke-muted";
    }
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={getBgColor()}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={cn("transition-all duration-300", getColor().replace("text-", "stroke-"))}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
          }}
        />
      </svg>
      <span className={cn("absolute text-[9px] font-bold", getColor())}>
        {Math.round(percentage)}%
      </span>
    </div>
  );
}

// Risk badge component
function RiskBadge({ level }: { level: string }) {
  const config = {
    high: { icon: XCircle, label: "Risk", className: "bg-red-100 text-red-700 border-red-200" },
    medium: { icon: AlertTriangle, label: "Caution", className: "bg-amber-100 text-amber-700 border-amber-200" },
    low: { icon: CheckCircle, label: "Good", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    new: { icon: Clock, label: "New", className: "bg-blue-100 text-blue-700 border-blue-200" },
  };

  const { icon: Icon, label, className } = config[level as keyof typeof config] || config.new;

  return (
    <span className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border", className)}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

export function CombinedCourierHistoryInline({ 
  phone, 
  className,
  autoFetchBdCourier = false,
}: { 
  phone: string; 
  className?: string;
  autoFetchBdCourier?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CombinedResponse | null>(null);
  const [fetchingBdCourier, setFetchingBdCourier] = useState(false);

  const normalizedPhone = useMemo(() => normalizePhone(phone), [phone]);

  // Initial fetch - optionally include BD Courier data
  useEffect(() => {
    if (!normalizedPhone || normalizedPhone.length < 11) {
      setLoading(false);
      return;
    }

    // Check cache first
    const cached = cache.get(normalizedPhone);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke(
          "combined-courier-history",
          { body: { phone: normalizedPhone, skipBdCourier: !autoFetchBdCourier } }
        );

        if (error) throw error;

        if (result) {
          cache.set(normalizedPhone, { data: result, timestamp: Date.now() });
          setData(result);
        }
      } catch (err) {
        console.error("Error fetching combined history:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [normalizedPhone]);

  // Function to fetch BD Courier data on demand
  const fetchBdCourierData = useCallback(async () => {
    if (fetchingBdCourier || !normalizedPhone || data?.bd_courier_available) return;

    setFetchingBdCourier(true);
    try {
      const { data: result, error } = await supabase.functions.invoke(
        "combined-courier-history",
        { body: { phone: normalizedPhone } }
      );

      if (error) throw error;

      if (result) {
        cache.set(normalizedPhone, { data: result, timestamp: Date.now() });
        setData(result);
      }
    } catch (err) {
      console.error("Error fetching BD Courier data:", err);
    } finally {
      setFetchingBdCourier(false);
    }
  }, [normalizedPhone, fetchingBdCourier, data?.bd_courier_available]);

  if (loading) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { internal, bd_courier, bd_courier_available, combined_risk_level } = data;
  
  // Handle both new format (courierData.summary) and legacy format (summary directly)
  const bdCourierData = bd_courier?.courierData || bd_courier;
  const bdSummary = bdCourierData?.summary;
  const bdPathao = bdCourierData?.pathao;
  const bdSteadfast = bdCourierData?.steadfast;
  const bdRedx = bdCourierData?.redx;

  // Calculate display values
  const hasInternal = internal.total_orders > 0;
  const hasBDCourier = bd_courier_available && bdSummary && bdSummary.total_parcel > 0;

  // Use BD Courier ratio if available, otherwise internal (only if there's internal data)
  // If neither data source has data, we'll show "New" badge instead of 0%
  const displayRatio = hasBDCourier 
    ? bdSummary!.success_ratio 
    : (hasInternal ? (internal.success_ratio ?? 0) : 0);
  
  // Only show progress ring if we have actual data from either source
  const hasAnyData = hasInternal || hasBDCourier;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn("flex items-center gap-1.5 cursor-help", className)}
            onMouseEnter={fetchBdCourierData}
          >
            {hasAnyData ? (
              <>
                <ProgressRing 
                  percentage={displayRatio} 
                  riskLevel={combined_risk_level} 
                />
                <RiskBadge level={combined_risk_level} />
              </>
            ) : (
              <RiskBadge level="new" />
            )}
            {fetchingBdCourier && (
              <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs p-3">
          <div className="space-y-2 text-xs">
            <div className="font-semibold border-b pb-1 mb-2 flex items-center justify-between">
              <span>Customer History</span>
              {!bd_courier_available && !fetchingBdCourier && (
                <button 
                  onClick={(e) => { e.stopPropagation(); fetchBdCourierData(); }}
                  className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <RefreshCw className="h-2.5 w-2.5" /> Load BD Courier
                </button>
              )}
            </div>
            
            {/* BD Courier Steadfast History - Show First (Most Important) */}
            {bd_courier_available && bdSteadfast && bdSteadfast.total_parcel > 0 && (
              <div className="space-y-1">
                <div className="font-medium text-blue-700 flex items-center gap-1">
                  <Truck className="h-3 w-3" /> Steadfast History (BD Courier)
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pl-4">
                  <span>Total Parcels:</span>
                  <span className="font-medium">{bdSteadfast.total_parcel}</span>
                  <span className="text-emerald-600">Delivered:</span>
                  <span className="font-medium text-emerald-600">{bdSteadfast.success_parcel}</span>
                  <span className="text-red-600">Cancelled:</span>
                  <span className="font-medium text-red-600">{bdSteadfast.cancelled_parcel}</span>
                  <span>Success Rate:</span>
                  <span className="font-medium">{Math.round(bdSteadfast.success_ratio)}%</span>
                </div>
              </div>
            )}

            {/* Other BD Courier Services */}
            {bd_courier_available && (bdPathao?.total_parcel > 0 || bdRedx?.total_parcel > 0) && (
              <div className="space-y-1 border-t pt-2">
                <div className="font-medium text-muted-foreground text-[10px]">Other Couriers</div>
                <div className="text-[10px] text-muted-foreground pl-4 flex flex-wrap gap-2">
                  {bdPathao && bdPathao.total_parcel > 0 && (
                    <span className="bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">
                      Pathao: {bdPathao.success_parcel}/{bdPathao.total_parcel} ({Math.round(bdPathao.success_ratio)}%)
                    </span>
                  )}
                  {bdRedx && bdRedx.total_parcel > 0 && (
                    <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                      RedX: {bdRedx.success_parcel}/{bdRedx.total_parcel} ({Math.round(bdRedx.success_ratio)}%)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* BD Courier Summary */}
            {bd_courier_available && bdSummary && bdSummary.total_parcel > 0 && (
              <div className="space-y-1 border-t pt-2">
                <div className="font-medium text-muted-foreground flex items-center gap-1 text-[10px]">
                  All Couriers Combined: {bdSummary.success_parcel}/{bdSummary.total_parcel} ({Math.round(bdSummary.success_ratio)}%)
                </div>
              </div>
            )}

            {!bd_courier_available && (
              <div className="text-[10px] text-muted-foreground border-t pt-1">
                {fetchingBdCourier ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading BD Courier data...
                  </span>
                ) : (
                  "Hover to load BD Courier data"
                )}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
