import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authDisabled, displayUsername, isGuest, isSiteUser, plainName, verifySession } from "@/lib/auth";
import { ROLE_NAMES, adminLevel, shownRole, superAdminInfo, type ShownRole } from "@/lib/admin";
import { getProfile, siteUserStatus } from "@/lib/site-users";
import { GUEST_PAGES } from "@/lib/guest-pages";
import { query } from "@/lib/db";
import { displayTimeZone } from "@/lib/queries";
import PageHeader from "@/components/PageHeader";
import ChangePassword from "@/components/ChangePassword";

export const dynamic = "force-dynamic";

const WHAT_YOU_CAN_DO: Record<ShownRole, string> = {
  super_admin: "Every page. Create, change and remove admins, members and guests; see and clean up the audit logs; run syncs.",
  owner: "Every page except Admin and Audit logs. Edit drug profiles.",
  admin: "Every page, including Admin and Audit logs. Create and manage members and guests; run syncs. Edit drug profiles.",
  member: "Every page except Admin and Audit logs. Edit drug profiles.",
  guest: "Only the pages listed below, view-only.",
};

const EVENT_LABEL: Record<string, string> = {
  login: "Signed in", logout: "Signed out", login_failed: "Failed sign-in", blocked: "Blocked", password_changed: "Password changed",
};

/** "Chrome on Windows" from a user-agent string. */
function device(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|python|bot|spider|crawl/i.test(ua) ? "Script / bot" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone / iPad"
    : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-slate-100 py-2.5 text-sm last:border-0">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

/** Your account: who you are, what you can open, recent sign-ins, and changing your password. */
export default async function ProfilePage() {
  const user = authDisabled() ? "local" : await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login?next=/profile");
  const tz = displayTimeZone();
  const fmt = (v: string | Date | null | undefined) =>
    v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—";

  const site = isSiteUser(user);
  const role = await shownRole(user);
  const level = await adminLevel(user);
  const [profile, status] = site ? await Promise.all([getProfile(user).catch(() => null), siteUserStatus(user)]) : [null, null];
  const events = await query<{ at: string; event: string; place: string | null; user_agent: string | null }>(
    `SELECT to_char(at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI') AS at, event,
            nullif(concat_ws(', ', nullif(city, ''), nullif(region, ''), country), '') AS place, user_agent
       FROM access_log
      WHERE (username = $1 OR username = $2) AND event IN ('login', 'logout', 'login_failed', 'blocked', 'password_changed')
      ORDER BY access_log.at DESC LIMIT 10`,
    [user.toLowerCase(), plainName(user).toLowerCase(), tz],
  ).catch(() => []);

  const name = profile?.label?.trim() || displayUsername(user);
  const pages = isGuest(user) ? (status?.pages ?? []) : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Your" highlight="profile" description="Your login, what you can open, your recent sign-ins and your password." />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Account</h2>
          <dl>
            <Row k="Name">{name}</Row>
            <Row k="Username"><span className="font-mono">{displayUsername(user)}</span></Row>
            <Row k="Role">
              <span className="rounded bg-brand-500/10 px-2 py-0.5 text-xs font-semibold text-brand-700">{ROLE_NAMES[role]}</span>
              {level === "super" && user !== "local" && (
                <span className="ml-2 text-xs text-slate-500">
                  {superAdminInfo().source === "setting" ? "(the only super admin — set by SUPER_ADMIN in Vercel)" : "(the only super admin — first owner in AUTH_USERS; set SUPER_ADMIN in Vercel to choose)"}
                </span>
              )}
            </Row>
            <Row k="Account type">{site ? "Login made on the website" : user === "local" ? "Local (login switched off)" : "Owner account (set in Vercel)"}</Row>
            {profile && <Row k="Created">{fmt(profile.created_at)}{profile.created_by ? <span className="text-slate-500"> by {displayUsername(profile.created_by)}</span> : null}</Row>}
            {site && <Row k="Access until">{profile?.expires_at ? fmt(profile.expires_at) : "No end date"}</Row>}
            {profile && <Row k="Last sign-in">{fmt(profile.last_login_at)}<span className="text-slate-500"> · {profile.login_count} sign-ins in total</span></Row>}
            {profile && <Row k="Password changed">{profile.password_changed_at ? fmt(profile.password_changed_at) : "Never (still the one you were given)"}</Row>}
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">What you can do</h2>
          <p className="text-sm text-slate-700">{WHAT_YOU_CAN_DO[role]}</p>
          {pages && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {GUEST_PAGES.filter((p) => pages.includes(p.key)).map((p) => (
                <span key={p.key} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{p.label}</span>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500">Everyone can open this Profile page and the Help &amp; manual page.</p>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Password</h2>
        {site && !isGuest(user) ? (
          <ChangePassword />
        ) : isGuest(user) ? (
          <p className="text-sm text-slate-600">Guest logins can&apos;t change their password. Ask the person who gave you access for a new one.</p>
        ) : (
          <p className="text-sm text-slate-600">
            Owner passwords are set in Vercel → Settings → Environment Variables → <code className="rounded bg-slate-100 px-1">AUTH_USERS</code>, then redeploy.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Your recent sign-ins</h2>
          <p className="text-xs text-slate-500">The last 10, with approximate location. Times in {tz}. Something you don&apos;t recognise? Change your password and tell an admin.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">What</th><th className="px-3 py-2 font-semibold">Where</th><th className="px-5 py-2 font-semibold">Browser</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400">Nothing recorded yet.</td></tr>
              ) : events.map((e, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-5 py-2 tabular-nums text-slate-600">{e.at}</td>
                  <td className="px-3 py-2">{EVENT_LABEL[e.event] ?? e.event}</td>
                  <td className="px-3 py-2 text-slate-600">{e.place ?? "—"}</td>
                  <td className="px-5 py-2 text-slate-600" title={e.user_agent ?? undefined}>{device(e.user_agent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
