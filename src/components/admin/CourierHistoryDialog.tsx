import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, Loader2, Package, XCircle, CheckCircle, AlertTriangle, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type CourierStats = {
  name?: string;
  logo?: string;
  total_parcel?: number;
  success_parcel?: number;
  cancelled_parcel?: number;
  success_ratio?: number;
};

type CourierHistoryData = {
  status?: string;
  courierData?: {
    pathao?: CourierStats;
    steadfast?: CourierStats;
    redx?: CourierStats;
    paperfly?: CourierStats;
    parceldex?: CourierStats;
    summary?: {
      total_parcel?: number;
      success_parcel?: number;
      cancelled_parcel?: number;
      success_ratio?: number;
    };
  };
  reports?: unknown[];
};

interface CourierHistoryDialogProps {
  phone: string;
  customerName?: string;
}

export function CourierHistoryDialog({ phone, customerName }: CourierHistoryDialogProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CourierHistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const fetchCourierHistory = async () => {
    if (data) return; // Already fetched

    setLoading(true);
    setError(null);

    try {
      const { data: response, error: fetchError } = await supabase.functions.invoke("combined-courier-history", {
        body: { phone, skipBdCourier: false },
      });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (response?.error) {
        throw new Error(response.error);
      }

      // Extract BD courier data from combined response
      const bdCourier = response?.bd_courier;
      const courierData = bdCourier?.courierData || null;

      setData({ courierData } as CourierHistoryData);
    } catch (err) {
      console.error("Failed to fetch courier history:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch courier history";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      fetchCourierHistory();
    }
  };

  const getRiskLevel = (successRatio: number | undefined) => {
    if (successRatio === undefined) return { level: "Unknown", color: "secondary", icon: AlertTriangle };
    if (successRatio >= 80) return { level: "Low Risk", color: "default", icon: CheckCircle };
    if (successRatio >= 50) return { level: "Medium Risk", color: "secondary", icon: AlertTriangle };
    return { level: "High Risk", color: "destructive", icon: XCircle };
  };

  const CourierStatsRow = ({ name, stats }: { name: string; stats?: CourierStats }) => {
    if (!stats || stats.total_parcel === 0) return null;

    return (
      <div className="p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Truck className="h-4 w-4 text-primary" />
          <span className="font-medium">{name}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="text-center">
            <div className="text-lg font-semibold">{stats.total_parcel || 0}</div>
            <div className="text-muted-foreground text-xs">Total</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-green-600">{stats.success_parcel || 0}</div>
            <div className="text-muted-foreground text-xs">Success</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-red-600">{stats.cancelled_parcel || 0}</div>
            <div className="text-muted-foreground text-xs">Cancelled</div>
          </div>
        </div>
      </div>
    );
  };

  const summary = data?.courierData?.summary;
  const risk = getRiskLevel(summary?.success_ratio);
  const RiskIcon = risk.icon;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Check courier history">
          <History className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Courier History
          </DialogTitle>
          <DialogDescription>
            {customerName && <span className="font-medium">{customerName}</span>}
            {customerName && " - "}{phone}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <XCircle className="h-12 w-12 text-destructive mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={fetchCourierHistory}>
                Try Again
              </Button>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Overall Stats */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">Overall Summary</span>
                  <Badge variant={risk.color as any} className="gap-1">
                    <RiskIcon className="h-3 w-3" />
                    {risk.level}
                  </Badge>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="text-2xl font-bold">{summary?.total_parcel || 0}</div>
                    <div className="text-xs text-muted-foreground">Total</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">{summary?.success_parcel || 0}</div>
                    <div className="text-xs text-muted-foreground">Success</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-red-600">{summary?.cancelled_parcel || 0}</div>
                    <div className="text-xs text-muted-foreground">Cancel</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">{summary?.success_ratio?.toFixed(1) || 0}%</div>
                    <div className="text-xs text-muted-foreground">Ratio</div>
                  </div>
                </div>
              </div>

              {/* Courier Breakdown */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Breakdown by Courier</h4>
                <div className="grid gap-2">
                  <CourierStatsRow name="Steadfast" stats={data.courierData?.steadfast} />
                  <CourierStatsRow name="Pathao" stats={data.courierData?.pathao} />
                  <CourierStatsRow name="RedX" stats={data.courierData?.redx} />
                  <CourierStatsRow name="Paperfly" stats={data.courierData?.paperfly} />
                </div>
                {!data.courierData?.steadfast?.total_parcel &&
                  !data.courierData?.pathao?.total_parcel &&
                  !data.courierData?.redx?.total_parcel &&
                  !data.courierData?.paperfly?.total_parcel && (
                    <p className="text-sm text-muted-foreground text-center py-4">No courier history found for this phone number</p>
                  )}
              </div>
            </>
          )}

          {!loading && !error && !data && (
            <div className="text-center py-8">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Click to check courier history</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
