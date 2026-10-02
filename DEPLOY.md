# Host it online for free — GitHub + Supabase + Vercel

About 30 minutes, no credit card. Everything below is on free plans.

| Piece | Service | What it does |
|---|---|---|
| Code | **GitHub** | Holds the code. Vercel deploys from it; GitHub Actions runs the daily update. |
| Database | **Supabase** (free Postgres) | Trials, drugs, your product info, data-quality results. Free plan: 500 MB — this database is only a few MB. |
| Website | **Vercel** (free Hobby plan) | The site at `https://<name>.vercel.app`, behind a login. |
| Daily update | **GitHub Actions** | Every day pulls new / changed trials from ClinicalTrials.gov into Supabase. |

> **Free-plan terms to know**
> - Vercel's Hobby plan is for personal, non-commercial use. If the site is for company
>   business, check with them first (the paid plan removes this limit).
> - Supabase pauses a free project after about 7 days with no activity. The daily update
>   queries the database every day, which keeps it active. If it ever does pause:
>   Supabase dashboard → your project → **Restore project** (data is kept).
> - The GitHub repository must be **public** for the free daily schedule. Your data,
>   passwords and connection strings are never in the code.

---

## 1. Put the latest code on GitHub

Your repository already exists (`Bhanu9110/obesity-trials-platform`). From the project folder:

```powershell
cd C:\Users\bhanu\Downloads\obesity-trials-platform-ctgov
git add .
git commit -m "Supabase support, data-quality page, lineage"
git push
```

Check first with `git status` that no `.sql` backup or `.env` file is listed — both are
ignored on purpose (they contain your data / passwords).

## 2. Create the database (Supabase)

1. Go to **https://supabase.com** → *Start your project* → sign in with GitHub.
2. **New project**: name `obesity-trials`, region **closest to you** (e.g. *Mumbai* /
   *Singapore*), and a **database password with only letters and numbers** (no `@ # / ? %`
   — those break connection strings). Use *Generate a password* and save it somewhere safe.
3. When the project is ready, click **Connect** (top of the page) → **Connection string**.
   You need **two** strings (replace `[YOUR-PASSWORD]` with your password in both):

   | Use it for | Which one | Looks like |
   |---|---|---|
   | GitHub (daily update + migrations) | **Session pooler** (port **5432**) | `postgresql://postgres.abcdxyz:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` |
   | Vercel (website) | **Transaction pooler** (port **6543**) | `postgresql://postgres.abcdxyz:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres` |

   Do **not** use the "Direct connection" (`db.xxxx.supabase.co`): on the free plan it only
   works over IPv6, which GitHub and Vercel can't reach.
4. Recommended — switch off the unused public API: **Project Settings → Data API** →
   turn off *Enable Data API* (or remove `public` from *Exposed schemas*). The app connects
   to Postgres directly and never uses it. (The database is also locked against it by
   migration `0008`, so this is belt-and-braces.)

## 3. Connect GitHub to the database

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `DATABASE_URL` | the **Session pooler** string (port 5432) |

If an old `DATABASE_URL` secret exists (e.g. from Neon), click it → *Update* → paste the new one.

## 4. (Optional) Copy the product info you entered locally

Skip this if you haven't filled in drug information yet — step 5 loads all trials fresh.
Otherwise, with Docker running locally:

```powershell
cd C:\Users\bhanu\Downloads\obesity-trials-platform-ctgov
docker compose exec -T db pg_dump -U postgres -d obesity_trials --no-owner --no-privileges -f /tmp/backup.sql
docker compose cp db:/tmp/backup.sql .\backup.sql
docker run --rm -v "${PWD}:/w" postgres:16 psql "PASTE-SESSION-POOLER-STRING?sslmode=require" -f /w/backup.sql
```

A few "already exists" messages are normal. `backup.sql` contains your data: it is
git-ignored, never commit it.

## 5. Load the data (first run of the daily update)

1. GitHub repo → **Actions** tab → (if asked) *enable workflows*.
2. **Daily CT.gov sync** → **Run workflow** → tick **Full re-download** → **Run workflow**.
3. Wait ~3–5 minutes for the green tick. Supabase now has every trial, drug and quality result.
   (Check: Supabase → **Table Editor** → `trials`.)

From then on it runs by itself every day at 00:05 India time.

## 6. Put the website online (Vercel)

1. **https://vercel.com** → sign up with **GitHub**.
2. **Add New… → Project** → *Import* `obesity-trials-platform`.
3. **Root Directory** → *Edit* → **`web`**. Framework: Next.js (auto-detected).
4. **Environment Variables**:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the **Transaction pooler** string (port 6543) |
   | `AUTH_USERS` | logins as `name:password`, comma-separated, e.g. `poli:MyStrongPass2026,anita:AnotherPass77` |
   | `AUTH_SECRET` | a long random string — make one in PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)` |

   The site's server code runs in **Mumbai** (`web/vercel.json` → `"regions": ["bom1"]`), next to the
   Supabase database. If you created Supabase in another region, change `bom1` to the closest
   [Vercel region](https://vercel.com/docs/regions) (e.g. `sin1` Singapore, `iad1` US East, `fra1` Frankfurt).
5. **Deploy**. After ~2 minutes you get `https://obesity-trials-platform.vercel.app` (or
   similar). Open it and sign in.

If you already deployed to Vercel earlier (with Neon): Vercel → project → *Settings →
Environment Variables* → edit `DATABASE_URL` → paste the Transaction pooler string →
*Deployments* → ⋯ → **Redeploy**.

### Optional: full certificate checking

Connections to Supabase are always **encrypted**. To also **verify** Supabase's certificate:
Supabase → *Project Settings → Database → SSL Configuration* → **Download certificate**.
Open the file in Notepad, copy everything, and add it as `DATABASE_CA_CERT` in Vercel
(environment variable) and in GitHub (repository secret).

---

## Checking data quality

- **On the website:** the **Data quality** tab — average score, how many trials are clean /
  need review, every issue type with counts (click one to filter), and the affected trials
  with links to ClinicalTrials.gov.
- **In Supabase:** *SQL Editor* → run
  ```sql
  SELECT * FROM data_quality_summary ORDER BY trials DESC;
  SELECT trial_id, score, issues FROM trial_quality WHERE score < 1 ORDER BY score LIMIT 50;
  ```

## Everyday use

- **Add / remove a person:** Vercel → *Settings → Environment Variables* → edit
  `AUTH_USERS` → Save → *Deployments* → ⋯ → **Redeploy**.
- **Is the daily update working?** Website **Admin** page (last successful sync), or
  GitHub → *Actions* (GitHub emails you if a run fails).
- **Change the code:** `git add . ; git commit -m "change" ; git push` — Vercel redeploys
  automatically; the next daily run applies any new database migrations.
- **Local copy:** `docker compose up` on your PC still works, with its own database and no login.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Site says *"Login is not configured"* | `AUTH_USERS` / `AUTH_SECRET` missing in Vercel (secret ≥ 16 characters) → add → Redeploy. |
| Site shows 0 trials | Step 5 hasn't run yet, or Vercel's `DATABASE_URL` points at another project. |
| Action fails at *Check the DATABASE_URL secret* | Add the `DATABASE_URL` repository secret (step 3). |
| *"Tenant or user not found"* | Username must be `postgres.<project-ref>` exactly as Supabase shows it, with the pooler host. |
| *"password authentication failed"* | Wrong password, or it contains special characters → reset it (Supabase → *Project Settings → Database*) using letters and numbers only, update both strings. |
| *"Network is unreachable"* / timeout | You used the Direct connection (`db.xxxx.supabase.co`) — use the pooler strings. |
| Site was working, now errors / HTTP 540 | Supabase project paused → dashboard → **Restore project**. |
| First full run was cut off (time limit) | Just run it again — trials already stored are skipped. A daily run also finishes an incomplete first download by itself. |
| Daily runs stopped | GitHub → Actions → *Daily CT.gov sync* → **Enable workflow**. |
