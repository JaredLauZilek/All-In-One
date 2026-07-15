import { useState } from "react";
import { Newspaper, ExternalLink } from "lucide-react";
import { Card, EmptyState } from "../components/ui";
import { fmtAgo } from "../lib/signal";

// A daily reading list, nothing more. This page is INERT by design: it renders
// no direction, no badge and no colour coding, because the feed must never
// look like — or become — a signal. The verdict comes only from the edge
// function; see CLAUDE.md.
export default function News({ news, lastDate }) {
  const items = news?.items ?? [];

  if (!items.length) {
    return (
      <Card>
        <EmptyState
          icon={<Newspaper className="h-5 w-5" />}
          title="No news yet"
          subtitle="The daily crawl fills this each morning. Hit “Refresh now” to fetch it."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((it, i) => <NewsCard key={it.url || i} item={it} />)}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        A daily reading list, auto-collected from {news?.source ?? "Bing News"} across{" "}
        {(news?.queries ?? []).length} searches{lastDate ? ` · snapshot ${lastDate}` : ""}. It is not a
        signal — it never touches the verdict, the trigger, or your contract log.
      </p>
    </div>
  );
}

function NewsCard({ item }) {
  // Bing's th?id=… thumbnails are ephemeral, so yesterday's snapshot will 404
  // some of them. onError (not just a null check) is what keeps the placeholder
  // honest as the blob ages.
  const [broken, setBroken] = useState(false);
  const showImg = item.image && !broken;

  return (
    <a href={item.url} target="_blank" rel="noreferrer noopener" className="group block">
      <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
        <div className="aspect-video w-full overflow-hidden bg-slate-100">
          {showImg ? (
            <img
              src={item.image}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <Newspaper className="h-8 w-8" />
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-3 text-sm font-semibold leading-snug text-slate-900 group-hover:text-indigo-600">
            {item.title}
          </h3>
          <div className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-slate-400">
            <span className="truncate">{item.source || "—"}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 font-mono">{fmtAgo(item.ts)}</span>
            <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0" />
          </div>
        </div>
      </Card>
    </a>
  );
}
