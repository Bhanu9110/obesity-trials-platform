import { NextRequest, NextResponse } from "next/server";
import { activeUser, mayEdit } from "@/lib/admin";
import {
  addMilestone, addResult, deleteMilestone, deleteResult, getProductMilestones, getProductResults,
  milestoneDateSort, setMilestoneHidden, setResultHidden, updateMilestone, updateResult,
  type MilestoneInput, type ResultInput,
} from "@/lib/queries";
import { MILESTONE_KINDS, MILESTONE_STATUSES, type MilestoneKind, type MilestoneStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Results (efficacy / safety) and milestones of one drug.
//   GET                                   both lists, hidden rows included (for editors)
//   POST   { type, ...fields }            add a row        (type: "result" | "milestone")
//   PATCH  { type, id, ...fields }        change a row typed on the page
//   PATCH  { type, id, hidden }           hide / show any row (research-file rows can only be hidden)
//   DELETE ?type=…&id=…                   delete a row typed on the page
// Members, admins and owners only; guests are view-only.

const text = (v: unknown, n: number) => {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, n) : "";
  return s || null;
};
const url = (v: unknown) => {
  const s = text(v, 1000);
  return s && /^https?:\/\/\S+$/i.test(s) ? s : null;
};

class BadInput extends Error {}

function resultFrom(b: Record<string, unknown>): ResultInput {
  const kind = b.kind === "safety" ? "safety" : b.kind === "efficacy" ? "efficacy" : null;
  if (!kind) throw new BadInput("Choose Efficacy or Safety.");
  const result = text(b.result, 500);
  if (!result) throw new BadInput("Write the result (e.g. −14.9% body weight).");
  if (b.source_url && !url(b.source_url)) throw new BadInput("The source link must start with http:// or https://");
  return {
    kind, result, trial: text(b.trial, 200), phase: text(b.phase, 100), population: text(b.population, 300),
    duration: text(b.duration, 100), dose: text(b.dose, 200), endpoint: text(b.endpoint, 200),
    comparator: text(b.comparator, 300), reported: text(b.reported, 40), source_label: text(b.source_label, 200), source_url: url(b.source_url),
  };
}

function milestoneFrom(b: Record<string, unknown>): MilestoneInput {
  const kind = String(b.kind ?? "") as MilestoneKind;
  if (!MILESTONE_KINDS.includes(kind)) throw new BadInput("Choose what kind of milestone this is.");
  const status = String(b.status ?? "expected") as MilestoneStatus;
  if (!MILESTONE_STATUSES.includes(status)) throw new BadInput("Choose a status.");
  const title = text(b.title, 300);
  if (!title) throw new BadInput("Write what happens (e.g. FDA decision).");
  const date_label = text(b.date_label, 20);
  if (date_label && !milestoneDateSort(date_label)) throw new BadInput("Write the date as 2026-03-19, 2026-03, 2026-Q4, 2026-H2 or 2026 — or leave it blank.");
  if (b.source_url && !url(b.source_url)) throw new BadInput("The source link must start with http:// or https://");
  return {
    kind, status, title, date_label: date_label ? date_label.toUpperCase().replace(/^(\d{4})(Q|H)/, "$1-$2") : null,
    detail: text(b.detail, 1000), region: text(b.region, 120), source_label: text(b.source_label, 200), source_url: url(b.source_url),
  };
}

const forbidden = () => NextResponse.json({ error: "Guest access is view-only." }, { status: 403 });
const missing = () => NextResponse.json({ error: "Not found, or a research-file row (those can only be hidden)." }, { status: 404 });
function failure(err: unknown) {
  if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
  const msg = err instanceof Error ? err.message : "failed";
  return NextResponse.json(
    { error: /product_(results|milestones)/.test(msg) ? "Results and milestones can be saved after the next sync updates the database (migration 0024)." : msg },
    { status: 500 },
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await activeUser(req))) return NextResponse.json({ error: "login required" }, { status: 401 });
  const slug = decodeURIComponent((await params).slug);
  const [results, milestones] = await Promise.all([getProductResults(slug, true), getProductMilestones(slug, true)]);
  return NextResponse.json({ results, milestones }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await activeUser(req);
  if (!mayEdit(user)) return forbidden();
  const slug = decodeURIComponent((await params).slug);
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const row = b.type === "milestone" ? await addMilestone(slug, milestoneFrom(b), user)
      : b.type === "result" ? await addResult(slug, resultFrom(b), user)
      : null;
    return row ? NextResponse.json(row, { status: 201 }) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return failure(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!mayEdit(await activeUser(req))) return forbidden();
  const slug = decodeURIComponent((await params).slug);
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = Number(b.id);
    if (!Number.isInteger(id) || (b.type !== "result" && b.type !== "milestone")) return NextResponse.json({ error: "invalid request" }, { status: 400 });
    if (typeof b.hidden === "boolean") {
      const ok = b.type === "result" ? await setResultHidden(slug, id, b.hidden) : await setMilestoneHidden(slug, id, b.hidden);
      return ok ? NextResponse.json({ ok: true }) : missing();
    }
    const row = b.type === "result" ? await updateResult(slug, id, resultFrom(b)) : await updateMilestone(slug, id, milestoneFrom(b));
    return row ? NextResponse.json(row) : missing();
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!mayEdit(await activeUser(req))) return forbidden();
  const slug = decodeURIComponent((await params).slug);
  const type = req.nextUrl.searchParams.get("type");
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || (type !== "result" && type !== "milestone")) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const ok = type === "result" ? await deleteResult(slug, id) : await deleteMilestone(slug, id);
    return ok ? NextResponse.json({ deleted: true }) : missing();
  } catch (err) {
    return failure(err);
  }
}
