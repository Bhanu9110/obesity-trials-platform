import PageHeader from "@/components/PageHeader";
import { MANUAL_MD } from "@/lib/manual.generated";
import { renderMarkdown } from "@/lib/markdown";

export const metadata = { title: "Help & manual — Obesity Trials Intelligence" };

const GITHUB_URL = "https://github.com/Bhanu9110/obesity-trials-platform/blob/main/docs/USER_MANUAL.md";

/** The user manual (docs/USER_MANUAL.md), for everyone who is signed in. */
export default function HelpPage() {
  // The manual's own title and version box are shown by the page header instead.
  const body = MANUAL_MD.replace(/^# .*\n/, "");
  const { html, headings } = renderMarkdown(body);
  const sections = headings.filter((h) => h.level === 2 && /^\d+\./.test(h.text));
  return (
    <div>
      <PageHeader
        eyebrow="Account"
        title="Help &"
        highlight="manual"
        description="How to use every page, who can do what, and how logins work. Updated with every change to the website."
        actions={<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-2 text-sm text-brand-600 hover:underline">View on GitHub ↗</a>}
      />
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <nav className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Contents</div>
            {sections.map((h) => (
              <a key={h.id} href={`#${h.id}`} className="block rounded-lg px-2 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {h.text}
              </a>
            ))}
          </div>
        </nav>
        <article className="manual min-w-0 rounded-2xl border border-slate-200 bg-white p-5 md:p-8" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
