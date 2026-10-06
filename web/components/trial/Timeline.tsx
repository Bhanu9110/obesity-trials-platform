import { formatRegistryDate } from "@/lib/ctgov";

export interface Milestone { label: string; date?: string; anticipated?: boolean }

const toTime = (d: string) => {
  const m = d.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  return m ? Date.UTC(Number(m[1]), Number(m[2] ?? 6) - 1, Number(m[3] ?? 15)) : NaN;
};

/** Key dates on one track: done in cyan, planned as hollow dots, with a "today" marker. */
export default function Timeline({ items }: { items: Milestone[] }) {
  const pts = items.filter((i) => i.date && !isNaN(toTime(i.date))).map((i) => ({ ...i, t: toTime(i.date!) }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const now = Date.now();
  const min = Math.min(pts[0].t, now);
  const max = Math.max(pts[pts.length - 1].t, now);
  const span = Math.max(1, max - min);
  const x = (t: number) => 4 + ((t - min) / span) * 92; // keep 4% padding at both ends
  const progress = Math.min(100, Math.max(0, x(now)));

  return (
    <div className="relative pb-2 pt-12">
      <div className="relative h-1.5 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-500 to-accent-500 shadow-[0_0_12px_-2px_rgb(34_211_238/0.7)]"
             style={{ width: `${progress}%` }} />
        {pts.map((p, i) => {
          const done = p.t <= now && !p.anticipated;
          const up = i % 2 === 0;
          return (
            <div key={p.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(p.t)}%` }}>
              <span className={`block h-3.5 w-3.5 rounded-full ring-4 ring-[rgb(12_19_38)] ${
                done ? "bg-brand-500 shadow-[0_0_12px_rgb(34_211_238)]" : "border-2 border-accent-500 bg-[rgb(12_19_38)]"}`} />
              <div className={`absolute left-1/2 w-max max-w-[140px] -translate-x-1/2 text-center ${up ? "bottom-6" : "top-6"}`}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{p.label}</div>
                <div className={`text-xs font-medium ${done ? "text-slate-900" : "text-accent-700"}`}>
                  {formatRegistryDate(p.date!)}{p.anticipated ? " (est.)" : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(now)}%` }}>
          <span className="block h-5 w-[2px] rounded-full bg-emerald-400 shadow-[0_0_10px_rgb(52_211_153)]" />
        </div>
      </div>
      <div className="h-12" />
      <div className="flex items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500" /> reached</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border-2 border-accent-500" /> planned</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-[2px] bg-emerald-400" /> today</span>
      </div>
    </div>
  );
}
