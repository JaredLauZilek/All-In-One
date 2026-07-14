import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BellOff } from "lucide-react";
import { supabase, type Notification } from "../lib/supabase";
import { Card, StatusBadge, Spinner, EmptyState } from "../components/ui";

export default function Notifications() {
  const { data: notifs, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lzd_notifications")
        .select("*, product:lzd_products(title,url)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Notification[];
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <Card>
      {!notifs?.length ? (
        <EmptyState
          icon={<BellOff className="h-5 w-5" />}
          title="No notifications yet"
          subtitle="When a monitored product comes back in stock, the Telegram alert is logged here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {notifs.map((n) => (
            <li key={n.id} className="flex items-center gap-4 px-5 py-4">
              <StatusBadge status={n.type} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-800">{n.message}</p>
                {n.product?.url && (
                  <a href={n.product.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline">
                    Open product page
                  </a>
                )}
                {n.error && <p className="mt-0.5 text-xs text-red-500">{n.error}</p>}
              </div>
              <div className="text-right">
                <StatusBadge status={n.status} />
                <p className="mt-1 text-xs text-slate-400">{format(new Date(n.created_at), "d MMM yyyy, HH:mm:ss")}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
