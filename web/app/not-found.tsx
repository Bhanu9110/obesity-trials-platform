import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <div className="font-display text-6xl font-semibold text-gradient">404</div>
      <h1 className="mt-3 font-display text-xl font-semibold text-slate-950">Nothing here</h1>
      <p className="mt-2 text-sm text-slate-500">
        This trial or drug isn&apos;t in the database (any more), or the address is mistyped. Try the search — press Ctrl/⌘ K.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/" className="rounded-xl bg-brand-600 px-4 py-2 text-sm text-white">Go to Overview</Link>
        <Link href="/trials" className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:text-slate-950">Trials explorer</Link>
      </div>
    </div>
  );
}
