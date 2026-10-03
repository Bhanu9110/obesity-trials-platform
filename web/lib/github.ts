// Start the "Daily CT.gov sync" GitHub Actions workflow from the website.
//
// Needs (Vercel environment variables):
//   GITHUB_DISPATCH_TOKEN  a fine-grained personal access token limited to this
//                          repository with "Actions: Read and write" permission
//   GITHUB_REPO            owner/name, e.g. Bhanu9110/obesity-trials-platform
//                          (optional on Vercel: taken from the connected Git repo)
//   GITHUB_WORKFLOW        workflow file name (default daily-sync.yml)
//   GITHUB_SYNC_BRANCH     branch (default main)

export function dispatchConfig() {
  const token = process.env.GITHUB_DISPATCH_TOKEN ?? "";
  const repo = process.env.GITHUB_REPO
    ?? (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : "");
  return {
    configured: Boolean(token && /^[\w.-]+\/[\w.-]+$/.test(repo)),
    token,
    repo,
    workflow: process.env.GITHUB_WORKFLOW ?? "daily-sync.yml",
    ref: process.env.GITHUB_SYNC_BRANCH ?? "main",
  };
}

export function actionsUrl(): string | null {
  const { repo, workflow } = dispatchConfig();
  return repo ? `https://github.com/${repo}/actions/workflows/${workflow}` : null;
}

export async function dispatchSync(full: boolean): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const cfg = dispatchConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error: "The Sync button is not set up: add GITHUB_DISPATCH_TOKEN (and GITHUB_REPO if not on Vercel) to the website's environment variables. You can always run the sync from GitHub → Actions → Daily CT.gov sync → Run workflow.",
    };
  }
  const res = await fetch(
    `https://api.github.com/repos/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${cfg.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "obesity-trials-web",
      },
      body: JSON.stringify({ ref: cfg.ref, inputs: { full: full ? "true" : "false" } }),
      cache: "no-store",
    },
  );
  if (res.status === 204) return { ok: true, url: actionsUrl() };
  const text = (await res.text()).slice(0, 300);
  const hint = res.status === 401 ? " (token invalid or expired)"
    : res.status === 403 || res.status === 404 ? " (token lacks 'Actions: Read and write' on this repository, or the repository/workflow name is wrong)"
    : "";
  return { ok: false, error: `GitHub answered ${res.status}${hint}: ${text}` };
}
