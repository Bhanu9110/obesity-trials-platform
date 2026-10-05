import { Fragment, type ReactNode } from "react";

// Registry free text uses a little Markdown: "* item" bullets, "1. item" lists,
// **bold**, blank-line paragraphs, and backslash escapes ("\>=18 years").
// Rendered as plain React elements (no HTML injection).

const unescape = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!<>|~=^])/g, "$1");

function inline(text: string, key: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4
      ? <strong key={`${key}-${i}`} className="font-semibold text-slate-800">{unescape(p.slice(2, -2))}</strong>
      : <Fragment key={`${key}-${i}`}>{unescape(p)}</Fragment>,
  );
}

type Line = { indent: number; kind: "ul" | "ol" | "p"; text: string };

function parseLine(raw: string): Line {
  const indent = raw.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0;
  const t = raw.trim();
  const ul = t.match(/^[*\-•]\s+(.*)$/);
  if (ul) return { indent, kind: "ul", text: ul[1] };
  const ol = t.match(/^(\d{1,3})[.)]\s+(.*)$/);
  if (ol) return { indent, kind: "ol", text: ol[2] };
  return { indent, kind: "p", text: t };
}

/** Nested list from consecutive list lines (indentation decides the level). */
function renderList(lines: Line[], key: string): ReactNode {
  const base = lines[0].indent;
  const items: { line: Line; children: Line[] }[] = [];
  for (const l of lines) {
    if (l.indent > base && items.length) items[items.length - 1].children.push(l);
    else items.push({ line: l, children: [] });
  }
  const ordered = items[0].line.kind === "ol";
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={key} className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 marker:text-slate-400`}>
      {items.map((it, i) => (
        <li key={`${key}-${i}`}>
          {inline(it.line.text, `${key}-${i}`)}
          {it.children.length > 0 && <div className="mt-1">{renderList(it.children, `${key}-${i}-c`)}</div>}
        </li>
      ))}
    </Tag>
  );
}

export default function RichText({ text, className = "" }: { text?: string | null; className?: string }) {
  if (!text?.trim()) return null;
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: Line[] = [];
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>{i > 0 && <br />}{inline(l, `${k}-${i}`)}</Fragment>
          ))}
        </p>,
      );
    }
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(renderList(list, `l${blocks.length}`));
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) { flushPara(); flushList(); continue; }
    const l = parseLine(raw);
    if (l.kind === "p") {
      // A wrapped continuation of the previous bullet stays in that bullet.
      if (list.length && l.indent > list[list.length - 1].indent) {
        list[list.length - 1] = { ...list[list.length - 1], text: `${list[list.length - 1].text} ${l.text}` };
        continue;
      }
      flushList();
      para.push(l.text);
    } else {
      flushPara();
      list.push(l);
    }
  }
  flushPara();
  flushList();
  return <div className={`space-y-2 text-sm leading-relaxed text-slate-700 ${className}`}>{blocks}</div>;
}
