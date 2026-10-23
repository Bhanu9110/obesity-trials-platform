# Obesity Trials Intelligence — User Manual

| | |
|---|---|
| **Website** | obesity-trials.vercel.app |
| **Manual version** | 1.3 |
| **Last updated** | 23 Oct 2026 |
| **Who this is for** | Everyone who signs in: super admin, admins, members and guests |

> This manual lives in GitHub at `docs/USER_MANUAL.md` and is shown inside the website on the **Help & manual** page. It is updated with every change to the website — see [18. Change log](#18-change-log).

## Contents

| No. | Section | What it covers |
|---|---|---|
| 1 | [About the website](#1-about-the-website) | What the site does and where the data comes from |
| 2 | [Signing in and out](#2-signing-in-and-out) | Sign-in page, session length, signing out |
| 3 | [Roles and permissions](#3-roles-and-permissions) | Super admin, admin, member, guest — who can do what |
| 4 | [Finding your way around](#4-finding-your-way-around) | Sidebar, search, dark mode, automatic updates |
| 5 | [Overview](#5-overview) | The dashboard |
| 6 | [Trials explorer](#6-trials-explorer) | Filtering, previewing and sharing trial lists |
| 7 | [Drugs](#7-drugs) | Drug list, search by code names, drug pages, editing |
| 8 | [Registry changes](#8-registry-changes) | What changed on ClinicalTrials.gov |
| 9 | [Data quality](#9-data-quality) | Quality scores, issues and the drug-profile auto-fill |
| 10 | [Admin page](#10-admin-page) | Pipeline health, syncs, users and access |
| 11 | [Creating and managing logins](#11-creating-and-managing-logins) | Adding admins, members and guests; access time; passwords |
| 12 | [Audit logs](#12-audit-logs) | Sign-ins, page views and admin actions |
| 13 | [Profile](#13-profile) | Your account, recent sign-ins, changing your password |
| 14 | [Data sources and the daily sync](#14-data-sources-and-the-daily-sync) | Where each piece of data comes from and how often |
| 15 | [Conference abstracts and company reports](#15-conference-abstracts-and-company-reports) | ADA abstracts, company pipeline reports |
| 16 | [Settings for the super admin](#16-settings-for-the-super-admin) | Vercel variables and GitHub settings |
| 17 | [Troubleshooting](#17-troubleshooting) | Common problems and fixes |
| 18 | [Change log](#18-change-log) | Every change to the website, newest first |

---

## 1. About the website

Obesity Trials Intelligence tracks every interventional obesity trial on ClinicalTrials.gov, links each trial to its drugs and sponsors, and keeps a profile for every drug (phase, mechanism, company, code names and more).

| Item | Detail |
|---|---|
| Trial data | ClinicalTrials.gov (v2 API), synced every day |
| Drug profiles | Filled in automatically from openFDA, ChEMBL, NCATS Inxight Drugs, company pipeline pages and conference abstracts; anything typed by hand always wins |
| Who can see it | Only people with a login — every page needs you to sign in |
| Time zone | Times are shown in the site's display time zone (shown on the pages that list times) |

## 2. Signing in and out

1. Open the website. If you are not signed in you land on the **Sign in** page.
2. Enter your **username** and **password** and press **Sign in**. Usernames are not case-sensitive; copied spaces before or after are ignored.
3. To **sign out**, use **Sign out** at the bottom of the left sidebar, under your name.

| Situation | What happens |
|---|---|
| Wrong username or password | "Wrong username or password." |
| Too many wrong attempts from one network | Sign-in is blocked for 15 minutes |
| Your access has ended or was revoked | "This login's access has ended." Ask the person who gave you access |
| You open the sign-in page while signed in | You can continue as yourself or sign in as someone else |
| Session length | Owners: 30 days. Admins and members: 12 hours, renewed while you use the site. Guests: 1 hour, renewed while you use the site, never past their end date |

## 3. Roles and permissions

There are five kinds of login. **Owner accounts** are set in Vercel; all other logins are made on the website.

| Role | How the login is made | Pages | Can do |
|---|---|---|---|
| **Super admin** | **Only one.** The owner account named in the `SUPER_ADMIN` variable in Vercel. It can't be created on the website | Every page | Everything an admin can, plus **create, change and remove admins**, and remove audit-log history |
| **Admin** | Created by the super admin on the Admin page (or an owner account that is not the super admin) | Every page, including **Admin** and **Audit logs** | Create and manage members and guests, run syncs, see audit logs, edit drug profiles. Cannot create, change or remove admins |
| **Owner** | Set in Vercel (`AUTH_USERS`) | Every page; Admin and Audit logs only if allowed by `ADMIN_USERS` | Edit drug profiles |
| **Member** | Created by an admin | Every page except Admin and Audit logs | Edit drug profiles and merge drugs |
| **Guest** | Created by an admin | Only the pages ticked for them | View only, for a limited time |

Everyone can open **Profile** and **Help & manual**.

> There is always exactly **one** super admin. If `SUPER_ADMIN` is empty, or names an account that is not an owner, the **first owner written in `AUTH_USERS`** is the super admin, and the Admin page shows a reminder to set `SUPER_ADMIN`. Every other owner account is an admin.

## 4. Finding your way around

| Part of the screen | What it is |
|---|---|
| **Left sidebar — Intelligence** | Overview, Trials explorer, Drugs, Registry changes |
| **Left sidebar — Workspace** | Data quality; Admin and Audit logs (admins only) |
| **Left sidebar — Account** | Profile, Help & manual |
| **Bottom of the sidebar** | Your name and role (click for your profile) and **Sign out** |
| **Collapse** | Shrinks the sidebar to icons; remembered on this device |
| **Search box (top)** | Searches trials, drugs, sponsors and NCT IDs. Shortcut: **Ctrl K** (Windows) or **⌘ K** (Mac), or press **/** |
| **Sun / moon button** | Light or dark theme, remembered on this device |
| **Round initials (top right)** | Opens your profile |

On a phone, the sidebar opens from the **menu** button at the top left.

**Numbers update by themselves.** Every open page checks for new data once a minute and whenever you come back to its tab. When something changed — the daily sync finished, someone edited, merged or re-classified a drug, or data quality was re-checked — the counts, charts and tables reload in place and a small **Updated with the latest data** note appears at the bottom right. Your filters, search text and scroll position stay as they were. You never need to press refresh.

## 5. Overview

The dashboard of every interventional obesity trial: totals, trials by phase, recruitment status, sponsor type, where trials run, trial starts per year, leading drugs, top sponsors and the latest trials added. **Click any bar** to open those trials in the Trials explorer.

## 6. Trials explorer

| Feature | How to use it |
|---|---|
| Keyword search | Searches NCT ID, sponsor, conditions, interventions, countries and drug names — including a drug's **code names** (e.g. `NN9440` finds Monlunabant's trials) |
| Filters | Phase, recruitment status, country / continent, sponsor type, obesity scope |
| Preview | Click a row for a quick preview; open the full trial record from there |
| Sharing | Every view has its own link — copy the address bar to share exactly what you see |
| Rows per page | Choose how many trials to show per page |

## 7. Drugs

### 7.1 Drug list

| Feature | How to use it |
|---|---|
| Search | Finds a drug by **name, brand, code name or any alias** the database knows, plus company and class. Spaces, hyphens and capitals don't matter (`nn 9440`, `NN-9440` and `nn9440` all work). A match on an alias shows "Also known as …" |
| Stage chips | All stages, Phase 1–4, and **No NCT yet (conference)** for drugs known only from conference abstracts or company reports |
| Sort | Most trials, most advanced, name A–Z |
| Cards / Table | Switch between the card grid and a detailed table; the main search box filters both |
| `*` next to a trial count | The trial was reported in a conference abstract or company report and has no ClinicalTrials.gov record yet |

### 7.2 Drug page

| Section | What it shows |
|---|---|
| Header tiles | Trials, phase, sponsors, approval |
| Profile | Company, class, sub-class, mechanism, modality, route, phase, code names, brand names, approval — each value shows its source; hand-entered values win |
| Trials | Every linked ClinicalTrials.gov trial |
| Conference abstracts / company reports | Abstracts (e.g. ADA 2026) and company pipeline reports that name the drug |
| Kind | Mark a product as drug, supplement or not a drug (members and above) |
| Merge | Merge a duplicate spelling into this drug (members and above) |

## 8. Registry changes

New trials, field-by-field registry updates, reclassifications and removals, recorded automatically by every sync. Filter by NCT ID or sponsor.

## 9. Data quality

Every trial is checked each time it is synced (score 1.00 = no issues). Click a tile or an issue to list those trials. The **CSV download** button exports the list for Excel (guests only if allowed). Further down, the **drug-profile auto-fill** panel shows how many profiles each source filled and when it last ran.

## 10. Admin page

Admins and the super admin only.

| Section | What it does |
|---|---|
| Pipeline dashboard | Last successful sync; **Sync now** and **Full re-download** start the GitHub workflow |
| Health | Database, migrations, sync freshness and drug-profile sources |
| Dead-letter / retry queues | Trials that failed to download; requeue or dismiss |
| Recent sync runs | Every run with counts and duration |
| Users & access | Every login — see [11](#11-creating-and-managing-logins) |
| Audit logs | A link to the [Audit logs](#12-audit-logs) page |

## 11. Creating and managing logins

### 11.1 Add a login

1. Admin page → **Users & access** → **+ Add user**.
2. Choose the type: **Guest**, **Member**, or **Admin** (the Admin choice appears for the super admin only).
3. Enter a name (who it's for). Username and password are optional — the site makes them up if left blank.
4. Choose how long the access lasts. Admins and members can have **No end date**; guests always end.
5. Guests only: tick the pages they may open.
6. Press **Create**. Copy the login details shown and send them to the person.

### 11.2 Who can manage which login

| You are | Admins | Members | Guests |
|---|---|---|---|
| Super admin | Create, change, remove | Create, change, remove | Create, change, remove |
| Admin | See only ("Super admin only") | Create, change, remove | Create, change, remove |

### 11.3 Manage a login

| Action | Where |
|---|---|
| Copy login details | **Copy login** in the list |
| Show / make a new password | Manage → Login → **Show** / **New password** |
| Rename | Manage → Login → Name → **Save** |
| Add time, set an end, no end date | Manage → Access time |
| End access now | Manage → Access time → **End access now** (signs them out) |
| Change type or guest pages | Manage → Type and pages (changing the type signs them out once) |
| Delete | Manage → Delete (their history stays in the audit logs) |

Every add, change, removal and new password is recorded in the [Audit logs](#12-audit-logs).

## 12. Audit logs

Admins and the super admin only. Sidebar → **Audit logs**. The page updates itself every 30 seconds.

| Part | What it shows |
|---|---|
| **Headline numbers** | People active, sign-ins (and how many today), page views, and failed attempts — all for the last 7 days. Click **Failed attempts** to see them in the log |
| **Activity, last 14 days** | Page views and sign-ins per day; a red badge shows failed attempts on that day. Hover a day for its numbers |
| **Most opened pages** | The 8 most opened pages in the last 30 days, with how many people opened each |
| **People** | Everyone who can sign in, and anyone with activity in the last 180 days: role, *Online now* (active in the last 5 minutes), last active, last sign-in, sign-ins and pages in 30 days, location and device. **Click a person** to see only their activity |
| **Activity log** | Every entry as a sentence ("Asha opened Drug · Semaglutide"), newest first and grouped by day, with location, device and IP address |
| Log filters | Tabs: **Everything**, **Sign-ins**, **Page views**, **Failed attempts**, **Admin actions** (each shows its count); a **person** list; a **search** box (page, name, IP address or city). **Clear filters** resets them |
| **Load older entries** | The log shows 50 entries at a time; this adds the next 50 |
| **Export CSV** | Downloads the entries shown as a spreadsheet file |
| Remove history | Super admin only, on a person who can no longer sign in: deletes their activity history |

| Event | Meaning |
|---|---|
| Signed in / Signed out | A successful sign-in or sign-out |
| Failed sign-in | A wrong username or password |
| Blocked | Too many failed attempts from one network; sign-in is paused for a while |
| Viewed | A page was opened |
| Login added / changed / removed | An admin action on a login — the sentence says what was done and to whom |
| Password changed | An admin set a new password, or someone changed their own |

Records are kept for 180 days. Times are in India time. Locations come from the IP address and are approximate.

## 13. Profile

Sidebar → **Profile**, or click your name at the bottom of the sidebar or your initials at the top right.

| Section | What it shows |
|---|---|
| Account | Name, username, role, who created the login and when, access end date, last sign-in, when the password was last changed |
| What you can do | Your permissions, and for guests the pages you can open |
| Password | Change your own password (admins and members made on the website). Owners change theirs in Vercel; guests ask for a new one |
| Your recent sign-ins | The last 10 sign-ins, sign-outs and failed attempts, with place and browser |

Changing your password needs your current one. Afterwards admins can no longer see your password.

## 14. Data sources and the daily sync

| Source | Used for | How often |
|---|---|---|
| ClinicalTrials.gov (v2 API) | Trials, interventions, sponsors, sites | Daily (GitHub Actions) |
| openFDA | Brand names, approval, route | Daily; each drug re-checked every 30 days |
| ChEMBL | Mechanism, class, code names | Daily, up to 200 drugs per run |
| NCATS Inxight Drugs | Development status, highest phase, targets | Daily, up to 100 drugs per run |
| Company pipeline pages | Code names (e.g. Roche RG6640) | Monthly re-check |
| Conference abstract files | ADA 2026 abstracts | On every run, from `sync/data/conference/` |
| Company reports | e.g. Novo Nordisk Q2 2026 pipeline | On every run, from `sync/data/conference/` |

If a source is down for 3 drugs in a row it is skipped for that run; the health check fails after 47 hours down, and an e-mail alert is sent after 3 days.

When a sync finishes, pages that are open show the new numbers within about a minute (see [4](#4-finding-your-way-around)). The "Synced" time on the Overview is shown in India time (the `APP_TIMEZONE` setting).

## 15. Conference abstracts and company reports

| Item | Detail |
|---|---|
| ADA 2026 | Obesity abstracts linked to drug pages; drugs with no ClinicalTrials.gov trial get a page and count the trials the abstracts report (`*`) |
| Company reports | A company's own pipeline report sets the drug's phase (e.g. Monlunabant "Terminated (Phase 2)") and adds its code names |
| Adding a new file | Put a JSON file in `sync/data/conference/`; it is imported on the next sync |

## 16. Settings for the super admin

Set in **Vercel → Project → Settings → Environment Variables**, then redeploy.

| Variable | Purpose | Example |
|---|---|---|
| `AUTH_USERS` | Owner accounts and passwords | `ObeyBhanu:••••,Asha:••••` |
| `AUTH_SECRET` | Signs session cookies (16+ random characters) | — |
| `SUPER_ADMIN` | The **one** owner account that is super admin — a single username from `AUTH_USERS` (if a list is given, only the first name counts). Empty = the first owner in `AUTH_USERS` | `ObeyBhanu` |
| `ADMIN_USERS` | Optional: owners allowed on the Admin page (empty = all owners) | `ObeyBhanu,Asha` |
| `DATABASE_URL` | Supabase Postgres connection | — |
| `GITHUB_DISPATCH_TOKEN` | Lets **Sync now** start the GitHub workflow | — |

Never paste passwords, tokens or connection strings into chats, issues or this manual.

## 17. Troubleshooting

| Problem | Fix |
|---|---|
| A page says a migration is not applied | Run the GitHub workflow **Daily CT.gov sync** (it applies database migrations first) |
| "Only admins can…" | Your login is not an admin — ask the super admin |
| "Only the super admin can create, change or remove admins" | Only the one super admin can do this. Your Profile page shows whether that is you |
| The wrong person is super admin | Set `SUPER_ADMIN` in Vercel to the right owner username (it must also be in `AUTH_USERS`) and redeploy |
| You were signed out after your type changed | Expected — sign in again |
| A guest can't change their password | Guests ask an admin for a new password |
| The Sync buttons don't work | Set `GITHUB_DISPATCH_TOKEN` in Vercel (see DEPLOY.md) |
| A count looks out of date | Wait a minute or switch back to the tab — pages refresh their numbers by themselves. If it still looks wrong, check **Admin → Recent sync runs** for a failed run |
| Search doesn't find a code name | The alias may not be known yet; add it to the drug's profile (Code names) |

## 18. Change log

Newest first. Every change to the website adds a row here and updates the sections above.

| Date | Version | Change | Sections updated |
|---|---|---|---|
| 23 Oct 2026 | 1.3 | Audit logs page redesigned: headline numbers, 14-day activity chart, most opened pages, People list (click a person to filter), activity log as sentences grouped by day with type tabs, person and text filters, older entries on demand and CSV export | 12 |
| 23 Oct 2026 | 1.2 | Counts update by themselves: open pages reload their numbers within a minute of any data change (sync, drug edits, merges, quality checks). Trials filter counts are never held out of date. Admin's drug counts now match the Overview. Overview "Synced" time shown in India time | 4, 14, 17 |
| 23 Oct 2026 | 1.1 | Exactly one super admin: `SUPER_ADMIN` names it; if empty or not an owner, the first owner in `AUTH_USERS` is the super admin. Other owners are admins | 3, 16, 17 |
| 23 Oct 2026 | 1.0 | Super admin (`SUPER_ADMIN`) and admin logins; only the super admin creates admins. Sign out moved to the bottom of the sidebar. Audit logs moved to their own page, now including admin actions. New Profile page with password change. New Help & manual page | 2, 3, 4, 10, 11, 12, 13, 16 |
| 16 Oct 2026 | — | Drug search finds drugs by any alias, code or brand name; the page search box also filters the table | 6, 7 |
| 13 Oct 2026 | — | Novo Nordisk Q2 2026 pipeline report: phases and code names for six obesity programs | 15 |
| Oct 2026 | — | ADA 2026 conference abstracts; trial counts for drugs with no NCT trial; NCATS Inxight Drugs and ChEMBL improvements | 7, 14, 15 |
