# Obesity Trials Intelligence — User Manual

| | |
|---|---|
| **Website** | obesity-trials.vercel.app |
| **Manual version** | 1.11.3 |
| **Last updated** | 29 Oct 2026 |
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
| 7 | [Drugs](#7-drugs) | Drug list, upcoming milestones, drug pages, development & regulatory profile, results, timeline, editing |
| 7A | [Downloading data](#7a-downloading-data) | Export from Trials and Drugs: rows, columns, Excel / PDF / CSV / Word, who may download |
| 8 | [Registry changes](#8-registry-changes) | What changed on ClinicalTrials.gov |
| 9 | [Data quality](#9-data-quality) | Quality scores, issues and the drug-profile auto-fill |
| 10 | [Admin page](#10-admin-page) | Pipeline health, syncs, users and access |
| 11 | [Creating and managing logins](#11-creating-and-managing-logins) | Adding admins, members and guests; access time; passwords |
| 12 | [Audit logs](#12-audit-logs) | Sign-ins, page views and admin actions |
| 13 | [Profile](#13-profile) | Your account, recent sign-ins, changing your password |
| 14 | [Data sources and the daily sync](#14-data-sources-and-the-daily-sync) | Where each piece of data comes from and how often |
| 15 | [Conference abstracts, company reports and research files](#15-conference-abstracts-company-reports-and-research-files) | ADA abstracts, company pipeline reports, the researched profiles of the leading drugs |
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

**Downloading data** (Export button on Trials and Drugs): the super admin, owners and admins always can; **members and guests only when an admin ticks *Can download data*** for their login (see [7A](#7a-downloading-data)).

> There is always exactly **one** super admin. If `SUPER_ADMIN` is empty, or names an account that is not an owner, the **first owner written in `AUTH_USERS`** is the super admin, and the Admin page shows a reminder to set `SUPER_ADMIN`. Every other owner account is an admin.

## 4. Finding your way around

| Part of the screen | What it is |
|---|---|
| **Left sidebar — Intelligence** | Overview, Trials explorer, Drugs, Registry changes |
| **Left sidebar — Workspace** | Data quality; Admin and Audit logs (admins only) |
| **Left sidebar — Account** | Profile, Help & manual |
| **Bottom of the sidebar** | Your name and role (click for your profile) and **Sign out** |
| **Collapse** | Shrinks the sidebar to icons; remembered on this device |
| **Search box (top)** | Searches trials, drugs, sponsors and NCT IDs — and **drug classes**: typing `GLP-1 agonists` offers *all drugs of the class* and *all their trials*. Shortcut: **Ctrl K** (Windows) or **⌘ K** (Mac), or press **/** |
| **Sun / moon button** | Light or dark theme, remembered on this device |
| **Round initials (top right)** | Opens your profile |

On a phone, the sidebar opens from the **menu** button at the top left.

**Numbers update by themselves.** Every open page checks for new data once a minute and whenever you come back to its tab. When something changed — the daily sync finished, someone edited, merged or re-classified a drug, or data quality was re-checked — the counts, charts and tables reload in place and a small **Updated with the latest data** note appears at the bottom right. Your filters, search text and scroll position stay as they were. You never need to press refresh.

## 5. Overview

The dashboard of every interventional obesity trial: totals, trials by phase, recruitment status, sponsor type, where trials run, trial starts per year, leading drugs, top sponsors and the latest trials added. **Click any bar** to open those trials in the Trials explorer.

## 6. Trials explorer

> **Filters are kept:** after opening a trial, the browser's Back button or **← All trials** returns to the list with the same filters.

> **Class search:** typing a drug class in the keyword box (e.g. `GLP-1 agonists`, `amylin analogues`) lists the trials of every drug in that class, with a banner showing the class and how many drugs it covers.

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
| **Upcoming milestones** | The next 8 expected regulatory decisions, readouts and launches across all drugs, soonest first. "date passed" means the expected date has gone by — check whether it happened. Click a drug to open its timeline |
| Search | Finds a drug by **name, INN, brand, code name or any alias** the database knows, plus company and class. Spaces, hyphens and capitals don't matter (`nn 9440`, `NN-9440` and `nn9440` all work). A match on an alias shows "Also known as …". Code names are listed in every spelling — `VT355, VT-355, VT 355` |
| **Search by drug class** | Type a class instead of a drug — `GLP-1 agonists`, `GLP-1 RA`, `amylin analogues`, `incretin`, `dual agonists`, `GIP`, `glucagon`, `SGLT2 inhibitors`, `CB1 blockers`, `MC4R`, `myostatin`, `lipase inhibitors` … (plural, hyphens and capitals don't matter). Every drug of the class is listed with a **Drug class** banner and a tag on each drug: *GLP-1 only*, *Dual: GLP-1 + GIP*, *Triple: GLP-1 + GIP + glucagon*, *GLP-1 agonist + GIPR antagonist* or *Combination: amylin + GLP-1*. The drugs are **grouped by development stage** (Approved, Filed, Phase 3, 2, 1, Preclinical, Discontinued, No active development) and the stage chips count only the drugs of the class — click one to show just that stage. In the table they are sorted the same way |
| How a drug's class is found | From its profile — sub-class first, then mechanism, then therapy class; for a drug with no profile, from its name stem (*-glutide*, *-lintide*, *-gliflozin* …). Drugs that only raise the body's own hormone ("increases GLP-1 release") are not counted as agonists. A drug missing from a class usually has an empty profile — fill in its sub-class |
| **Regulatory status filter** | Approved, Filed / under review, Investigational, Discontinued, or **With an upcoming milestone**. Works in both the cards and the table |
| Card and table extras | Each drug shows its regulatory status (a coloured tag plus the detail) and its **next milestone** with its date |
| Stage chips | The **development stage**, not only the highest trial phase: **Approved** (in *any* country — e.g. mazdutide and ecnoglutide in China, even though their trials only reach Phase 3), **Filed**, **Phase 3 / 2 / 1**, **Preclinical / no NCT yet** (known only from conference abstracts or company reports), **Discontinued / withdrawn**, and **No active development** |
| How the stage is decided | 1) Discontinued or withdrawn when the regulatory status or phase says so; 2) Approved when approved anywhere (Phase 4 trials also count, unless the status says investigational); 3) Filed; 4) **No active development** when no trial is running and the newest trial started 7+ years ago — a warning, not a confirmed discontinuation; 5) otherwise the highest trial phase. **No phase on ClinicalTrials.gov** ("Not applicable" or blank) on an interventional trial: the phase is **estimated from enrollment** — Phase 1 up to ~100 people, Phase 2 ~100–300, Phase 3 more than 300 — and shown as *Phase 2 (est.)*. Hover the stage tag for the reason |
| What is listed | Specific drugs only. Drug classes and generic names ("Anti-obesity medication", "Incretin therapies", "Biguanide" …) are not drugs and are left out. A trial that names only a class appears as an **Undisclosed <class>** programme — listed only when a **company** runs it as drug development: an industry sponsor that isn't a university, hospital, clinic or research unit (the registry labels some of those "industry"), and a Phase 1–3 trial. Studies of a class given as usual care ("Biguanide, DPP4 inhibitors, SGLT2 inhibitors", phase *Not applicable*) are left out |
| Development bar on a card | P1 → P2 → P3 → Appr.; grey when the drug was stopped, with "reached P3" for the furthest phase |
| Sort | Most trials, most advanced, name A–Z |
| Cards / Table | Switch between the card grid and a detailed table; the main search box filters both |
| **Filters are kept** | Search, stage, regulatory status, sort, cards/table, "Show more" and the table's page are kept in the address (e.g. `/drugs?q=GLP-1&stage=p2`). Open a drug and come back with the browser's **Back** button or **← All drugs** and the list is exactly as you left it. You can also bookmark or share the filtered list |
| `*` next to a trial count | The trial was reported in a conference abstract or company report and has no ClinicalTrials.gov record yet |

### 7.2 Drug page

| Section | What it shows |
|---|---|
| Header | Trials, **development stage** (same rules as the drug list), sponsors, recruiting; under the name, the **regulatory status** and the **next milestone** (click either to jump to it) |
| Profile | Company, class, sub-class, mechanism, modality, route, phase, code names, brand names, approval — each value shows its source; hand-entered values win |
| **Development & regulatory** | INN, API (active ingredient), regulatory status, designations (Breakthrough, Fast Track, PRIME, priority vouchers …), patents / exclusivity, anticipated launch, efficacy signal and safety signal. Part of the profile: change them with its **Edit** button |
| **Milestones & timeline** | Dated events in two columns — **Upcoming** (soonest first) and **Past** (newest first): regulatory steps, readouts, launches, patent expiries and inflection points, each with its source. Tabs: All, Upcoming, Past |
| **Efficacy & safety results** | Key trial results — trial, population and duration, dose, endpoint, result, comparator and source. Tabs: Efficacy, Safety |
| Trials | Every linked ClinicalTrials.gov trial |
| Conference abstracts / company reports | Abstracts (e.g. ADA 2026) and company pipeline reports that name the drug |
| Kind | Mark an entry as a drug, a supplement, not a drug, or **not an obesity drug** (a real medicine with no effect on weight — anaesthetics, antibiotics, blood-pressure drugs, contraceptives in drug-interaction studies …). Only drugs are listed (members and above) |
| Merge | Merge a duplicate spelling into this drug (members and above) |

### 7.3 Where the values come from

| Tag | Meaning |
|---|---|
| *(no tag)* | Typed on the drug page — always shown first and never changed by the sync |
| **research** | From the research files (see [15](#15-conference-abstracts-company-reports-and-research-files)); click the tag to open the source |
| **auto** | Worked out automatically from trial data, ChEMBL, openFDA or Inxight Drugs — INN, API and regulatory status are also filled this way for drugs without research |
| **added** | A milestone or result row someone added on the page |

Dates like *Q4 2026*, *H2 2026* or *2027* are company guidance or registry estimates. When an expected date has passed, the row shows **Date passed — check**.

### 7.4 Editing results and milestones

Members, admins and the super admin (not guests).

| Task | How |
|---|---|
| Add | **+ Add milestone** or **+ Add result**, fill in the form, then save. Dates: `2026-03-19`, `2026-03`, `2026-Q4`, `2026-H2` or `2027` — or leave blank if not known |
| Change or delete | **Edit** / **Delete** on a row you added (click Delete twice) |
| Hide a research row | **Hide** — it stays hidden after every sync. "Show them" at the bottom lists hidden rows so you can bring one back |
| Change a research row | Hide it and add your own row — research rows are rewritten by the sync |

## 7A. Downloading data

The **Export** button on the **Trials explorer** and the **Drugs** page opens the **Download data** page with the list's current filters.

| Step | How |
|---|---|
| 1. Data | **Trials** or **Drugs** (guests: only the pages they may open) |
| 2. Rows | **With my current filters** (search, drug class, phase, status, stage … from the page you came from) or **Everything** |
| 3. Columns | Tick the columns you need, grouped (Trial, Sponsor, Dates, Location, Links — or Drug, Development, Pharmacology, Results, Trials, Links). **Default**, **All**, **None**. Your choice is remembered in this browser |
| 4. Check | The page shows the chosen data as a small dashboard: counts, top phase / stage and status, breakdown bars and a **preview table** of exactly the columns you ticked (first 2,000 rows, 50 per page) |
| 5. Download | **Excel** (.xlsx: formatted, filter row, frozen header, clickable links, plus an *About this export* sheet with the filters and counts), **PDF** (landscape report with title, filters and date), **CSV**, **Word** (.docx table) |

| Detail | |
|---|---|
| Size | Excel and CSV take up to 20,000 rows; PDF and Word show the first 3,000 rows (the page tells you when) |
| **Key trial (NCT ID)** | Drug exports, ticked by default. **Approved** drugs: the trial(s) the approval was based on, e.g. *Approval based on: NCT03548935 (STEP 1, Phase 3)* — from the research file `pivotal-trials-2026-10.json` (semaglutide, tirzepatide, liraglutide, orforglipron, mazdutide, ecnoglutide, setmelanotide, Contrave, Qsymia, lorcaserin; drugs approved before trial registration say so). Approved drugs not in that file show their highest-phase trial, marked as such. **Other drugs**: one trial with their highest phase — obesity trials first, then company-sponsored, running and largest |
| Order | Trials: as sorted on the Trials page. Drugs: phase-wise — approved first, then filed, Phase 3, 2, 1 … |
| Who | Super admin, owners and admins always. Members and guests when an admin ticks **Can download data** (Admin page → add a login, or Manage → **Download data**) |
| Record | Every download is written to the **Audit logs** (tab **Downloads**: who, what, format, rows and filters) |

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
| Allow or stop downloads | Manage → **Download data** → *Can download data* (members and guests; admins always can). Also a tick box when adding a login. Logins that may download show a **Downloads** tag in the list |
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
| Log filters | Tabs: **Everything**, **Sign-ins**, **Page views**, **Failed attempts**, **Admin actions**, **Downloads** (each shows its count); a **person** list; a **search** box (page, name, IP address or city). **Clear filters** resets them |
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
| Research files | INN, regulatory status, designations, patents, results, milestones, launch timing of the leading drugs | On every run, from `sync/data/profiles/` |

If a source is down for 3 drugs in a row it is skipped for that run; the health check fails after 47 hours down, and an e-mail alert is sent after 3 days.

When a sync finishes, pages that are open show the new numbers within about a minute (see [4](#4-finding-your-way-around)). The "Synced" time on the Overview is shown in India time (the `APP_TIMEZONE` setting).

## 15. Conference abstracts, company reports and research files

| Item | Detail |
|---|---|
| ADA 2026 | Obesity abstracts linked to drug pages; drugs with no ClinicalTrials.gov trial get a page and count the trials the abstracts report (`*`) |
| Company reports | A company's own pipeline report sets the drug's phase (e.g. Monlunabant "Terminated (Phase 2)") and adds its code names |
| Adding a new file | Put a JSON file in `sync/data/conference/`; it is imported on the next sync |
| **Research files** | `sync/data/profiles/*.json` — the researched development, regulatory and commercial profile of the leading obesity drugs: INN, API, regulatory status, designations, patents, launch timing, efficacy and safety signals, results and milestones, each with its source. Loaded on every daily sync |
| Current file | `obesity-leaders-2026-10.json` (researched 25 Oct 2026): semaglutide, tirzepatide, orforglipron, retatrutide, CagriSema, survodutide, maridebart cafraglutide, amycretin, mazdutide, VK2735, petrelintide, eloralintide, ecnoglutide — 42 results and 65 milestones |
| `drug-basics-2026-10.json` | Modality, route, therapy class, subclass and mechanism for 479 drugs whose automatic profile left them blank or wrong — standard pharmacology for established drugs, company sources for pipeline drugs (e.g. VK2735, HRS9531, petrelintide, AZD6234, MET-097). Codes with no public information are left blank |
| `pivotal-trials-2026-10.json` | The trial(s) each approval was based on (Key trial in exports) |
| `status-audit-2026-10.json` | Researched 28 Oct 2026 after the client data review: approvals outside the US (ecnoglutide, mazdutide, beinaglutide, efsubaglutide, henagliflozin, enavogliflozin, cetilistat), filings (BGM0504, ribupatide, tesofensine, CagriSema), discontinued drugs with the company source (otenabant, beloranib, pramlintide/Symlin, danuglipron, lotiglipron, cotadutide, CT-868, emugrobart, dapiglutide, monlunabant, NNC0519-0130, INV-347, TERN-601, AMG 786, BI 1820237, azelaprag, taranabant, taspoglutide, PF-07976016 …), wrong automatic approvals corrected (phentermine, diethylpropion, ARD-101, cannabis …) and missing aliases (Relsipatide, BG128, Poterepatide, P001, Safiglipron, Compound 121a, CKD-732, HRK-429, HRK-512, J3R-MC-YDAL, MET-097o, IN-B00009, DA-63110) |
| **Aliases in research files** | Every alias in a research file is linked to the drug page in all its spellings, so a new trial that writes `VT 355` lands on the same page as `VT-355`. An alias that already has its own drug page is reported in the sync log so it can be merged |
| Updating | Edit the file (or add a newer one) and push; rows that are no longer in a file are removed on the next sync, hidden rows stay hidden, and rows added on the website are never touched. A drug named in a file must already have a drug page (found by its name or any alias) |

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
| An approved drug shows a trial phase, or a stopped drug looks active | Set its **Regulatory status** on the drug page (Edit), starting with *Approved — …*, *Filed — …* or *Discontinued — …*; the stage follows the first word |

## 18. Change log

Newest first. Every change to the website adds a row here and updates the sections above.

| Date | Version | Change | Sections updated |
|---|---|---|---|
| 29 Oct 2026 | 1.11.3 | Undisclosed programmes: only Phase 1–3 trials of a real company count — academic sponsors the registry calls "industry" (e.g. Metabolic Research Unit) and class-only usual-care studies are left out | 7 |
| 29 Oct 2026 | 1.11.2 | Drug exports get a **Key trial (NCT ID)** column: the approval trial(s) for approved drugs (new research file, NCT IDs checked on ClinicalTrials.gov), else one highest-phase trial | 7A, 15 |
| 29 Oct 2026 | 1.11.1 | Drug classes and generic names ("Anti-obesity medication", "Incretin Therapies", "GLP-1 Receptor Agonist e.g", "Biguanide", "Alter" …) are no longer listed as drugs (new name rule + list). **Undisclosed programmes** count only company-sponsored trials — academic-only ones are left out. Trials with no phase on ClinicalTrials.gov get a phase **estimated from enrollment** (marked *est.*) on the Trials explorer, drug pages, stage chips and exports | 6, 7 |
| 29 Oct 2026 | 1.11 | **Download data**: Export button on Trials and Drugs → choose rows (current filters or everything) and columns, see them as a dashboard with a preview table, download as Excel, PDF, CSV or Word. Admins always; members and guests when allowed on the Admin page. Downloads appear in the Audit logs (new **Downloads** tab) | 3, 7A, 11, 12 |
| 29 Oct 2026 | 1.10.3 | Drugs list keeps its filters (search, stage, status, sort, view, page) in the address, so Back or **← All drugs** returns to the same list; **← All trials** does the same for the Trials explorer | 6, 7 |
| 29 Oct 2026 | 1.10.2 | Drug pages renamed to their official INN, with the old name kept as an alias: Amycretin → **Zenagamtide**, GZR18 → Bofanglutide, HDM1005 → Poterepatide, HRS-7535 → Safiglipron, LY3549492 → Naperiglipron, CT-868 → Acmopatide, HM15211 → Efocipegtrutide, HM11260C → Efpeglenatide, HM15136 → Efpegerglucagon, RO7204239 → Emugrobart and 11 more. Wrong INNs from combination trials removed (NA-931, PP1420) | 7, 15 |
| 29 Oct 2026 | 1.10.1 | Class search: drugs grouped phase-wise, stage chips count only the class's drugs (and any search's results), and a class search starts from All stages | 7 |
| 29 Oct 2026 | 1.10 | **Search by drug class** on the Drugs page, the Trials explorer and the top search (Ctrl K): `GLP-1 agonists`, `amylin analogues`, `SGLT2 inhibitors` … list every drug of the class (or all its trials), including dual / triple agonists and combinations, each labelled | 4, 6, 7 |
| 28 Oct 2026 | 1.9 | **Development stage** replaces "highest trial phase" on the drug list, table and drug page: drugs approved in any country show **Approved**, discontinued/withdrawn drugs show **Discontinued**, and drugs with no trial for 7+ years show **No active development**. Status audit of 46 drugs with sources; 8 more duplicate pages merged (CP-945598 → otenabant, IN-B00009 → ecnoglutide, NB32 → Contrave, VI-0521 → Qsymia, Tesomet, Exendin, …). Aliases shown in every spelling (VT355, VT-355, VT 355); glued-together junk names (HRS9531PLACEBO …) removed | 7, 15, 17 |
| 27 Oct 2026 | 1.8 | New kind **Not an obesity drug**: 270 medicines with no effect on obesity (anaesthetics, painkillers, antibiotics, anticoagulants, blood-pressure and cholesterol drugs, contraceptives and probe drugs from drug-interaction studies, vaccines, IV fluids …) taken out of the drug list. They stay in the database with their trials | 7 |
| 27 Oct 2026 | 1.7 | 38 natural hormones (glucagon, ghrelin, PYY, GIP, oxytocin, insulin, growth hormone, testosterone, oestrogen, thyroid hormone …) taken out of the drug list as "not a drug"; engineered analogues (metreleptin, setmelanotide, insulin glargine …) stay. Each can be put back with the Kind selector on its page | 7 |
| 27 Oct 2026 | 1.6 | 64 duplicate drug pages merged into 56 (code name vs INN, brand vs generic, misspellings — e.g. MET097 and PF-08653944 into Berobenatide, HRS9531 into Ribupatide, Tirzapatide into Tirzepatide). Merges now also carry the development & regulatory fields and rows added on the page | 7 |
| 26 Oct 2026 | 1.5 | Drug basics research file: modality, route, therapy class, subclass and mechanism filled for 479 drugs that had gaps (and wrong automatic values corrected, e.g. acarbose, metoprolol, pioglitazone) | 15 |
| 25 Oct 2026 | 1.4 | Development & regulatory profile on drug pages: INN, API, regulatory status, designations, patents, anticipated launch, efficacy and safety signals; **Milestones & timeline** and **Efficacy & safety results** sections with editing; regulatory status and next milestone in the Drugs list with a filter; **Upcoming milestones** panel; research file for 13 leading drugs; INN, API and regulatory status also filled automatically | 7, 14, 15 |
| 23 Oct 2026 | 1.3 | Audit logs page redesigned: headline numbers, 14-day activity chart, most opened pages, People list (click a person to filter), activity log as sentences grouped by day with type tabs, person and text filters, older entries on demand and CSV export | 12 |
| 23 Oct 2026 | 1.2 | Counts update by themselves: open pages reload their numbers within a minute of any data change (sync, drug edits, merges, quality checks). Trials filter counts are never held out of date. Admin's drug counts now match the Overview. Overview "Synced" time shown in India time | 4, 14, 17 |
| 23 Oct 2026 | 1.1 | Exactly one super admin: `SUPER_ADMIN` names it; if empty or not an owner, the first owner in `AUTH_USERS` is the super admin. Other owners are admins | 3, 16, 17 |
| 23 Oct 2026 | 1.0 | Super admin (`SUPER_ADMIN`) and admin logins; only the super admin creates admins. Sign out moved to the bottom of the sidebar. Audit logs moved to their own page, now including admin actions. New Profile page with password change. New Help & manual page | 2, 3, 4, 10, 11, 12, 13, 16 |
| 16 Oct 2026 | — | Drug search finds drugs by any alias, code or brand name; the page search box also filters the table | 6, 7 |
| 13 Oct 2026 | — | Novo Nordisk Q2 2026 pipeline report: phases and code names for six obesity programs | 15 |
| Oct 2026 | — | ADA 2026 conference abstracts; trial counts for drugs with no NCT trial; NCATS Inxight Drugs and ChEMBL improvements | 7, 14, 15 |
