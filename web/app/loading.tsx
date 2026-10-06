/** Shown while a page is opening: the shape of the page, gently pulsing. */
export default function Loading() {
  const bar = "animate-pulse rounded-lg bg-slate-100";
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className={`${bar} h-3 w-40`} />
        <div className={`${bar} h-9 w-[min(560px,90%)]`} />
        <div className={`${bar} h-4 w-[min(720px,95%)]`} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass rounded-2xl p-4">
            <div className={`${bar} h-3 w-20`} />
            <div className={`${bar} mt-3 h-7 w-16`} />
            <div className={`${bar} mt-2 h-3 w-24`} />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="glass h-72 rounded-2xl p-5 xl:col-span-2"><div className={`${bar} h-4 w-48`} /></div>
        <div className="glass h-72 rounded-2xl p-5"><div className={`${bar} h-4 w-40`} /></div>
      </div>
    </div>
  );
}
