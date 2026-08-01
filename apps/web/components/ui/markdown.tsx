"use client";

import { useState, type ReactNode } from "react";

/**
 * Minimal, dependency-free, XSS-safe markdown renderer for chat. It builds React
 * elements directly (never dangerouslySetInnerHTML), handling the subset LLMs
 * actually emit: fenced code, inline code, bold/italic, links, headings, and
 * bullet/numbered lists.
 */

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="my-2 overflow-hidden rounded border border-border">
      <div className="mono flex items-center justify-between bg-white/5 px-3 py-1 text-[10px] uppercase tracking-wider text-muted">
        <span>{lang || "code"}</span>
        <button onClick={copy} className="hover:text-fg">
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="scroll-thin overflow-x-auto bg-black/40 p-3">
        <code className="mono text-[12px] leading-relaxed text-fg">{code}</code>
      </pre>
    </div>
  );
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // order matters: code, bold, italic, link
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={k} className="mono rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-accent">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={k} className="font-semibold text-fg">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={k}>{tok.slice(1, -1)}</em>);
    } else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      nodes.push(
        <a key={k} href={mm[2]} target="_blank" rel="noreferrer" className="text-accent underline">
          {mm[1]}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const segments = content.split(/```/);
  segments.forEach((seg, si) => {
    if (si % 2 === 1) {
      // code fence
      const nl = seg.indexOf("\n");
      const lang = nl > 0 ? seg.slice(0, nl).trim() : "";
      const code = (nl >= 0 ? seg.slice(nl + 1) : seg).replace(/\n$/, "");
      blocks.push(<CodeBlock key={`c${si}`} code={code} lang={lang} />);
      return;
    }
    const lines = seg.split("\n");
    let para: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    const flushPara = (key: string) => {
      if (para.length) {
        blocks.push(<p key={key} className="whitespace-pre-wrap">{inline(para.join("\n"), key)}</p>);
        para = [];
      }
    };
    const flushList = (key: string) => {
      if (list) {
        const Tag = list.ordered ? "ol" : "ul";
        blocks.push(
          <Tag key={key} className={`ml-5 space-y-0.5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
            {list.items.map((it, ii) => (
              <li key={ii}>{inline(it, `${key}-${ii}`)}</li>
            ))}
          </Tag>,
        );
        list = null;
      }
    };
    lines.forEach((raw, li) => {
      const key = `s${si}-${li}`;
      const h = /^(#{1,3})\s+(.*)$/.exec(raw);
      const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
      const ordered = /^\s*\d+\.\s+(.*)$/.exec(raw);
      if (h) {
        flushPara(key);
        flushList(key);
        const depth = h[1]?.length ?? 1;
        const size = depth === 1 ? "text-lg" : depth === 2 ? "text-base" : "text-sm";
        blocks.push(<div key={key} className={`mono ${size} mt-2 font-semibold text-fg`}>{inline(h[2] ?? "", key)}</div>);
      } else if (bullet) {
        flushPara(key);
        if (!list || list.ordered) { flushList(key); list = { ordered: false, items: [] }; }
        list!.items.push(bullet[1] ?? "");
      } else if (ordered) {
        flushPara(key);
        if (!list || !list.ordered) { flushList(key); list = { ordered: true, items: [] }; }
        list!.items.push(ordered[1] ?? "");
      } else if (raw.trim() === "") {
        flushPara(key);
        flushList(key);
      } else {
        flushList(key);
        para.push(raw);
      }
    });
    flushPara(`s${si}-end`);
    flushList(`s${si}-endl`);
  });

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}
