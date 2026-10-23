import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authDisabled, verifySession } from "@/lib/auth";
import { adminLevel } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import AccessPanel from "@/components/AccessPanel";

export const dynamic = "force-dynamic";

/** Audit logs: sign-ins, failed attempts, page views and admin actions. Admins and the super admin only. */
export default async function AuditLogsPage() {
  const user = authDisabled() ? "local" : await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const level = await adminLevel(user);
  if (!level) redirect("/");
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Audit"
        highlight="logs"
        description={
          <>
            Who signed in and when, failed sign-in attempts, which pages were opened, and what admins changed on logins (added,
            changed, removed, new passwords). {level === "super"
              ? "As super admin you can also remove the history of someone who can no longer sign in."
              : "Only the super admin can remove history."}
          </>
        }
      />
      <AccessPanel />
    </div>
  );
}
