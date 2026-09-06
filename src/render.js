"use strict";

/* ============================================================
   렌더
   ============================================================ */

const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("graph");
const stageWrap = document.getElementById("stage-wrap");
const el = (n, a, kids) => {
  const e = document.createElementNS(NS, n);
  for(const k in (a||{})) e.setAttribute(k, a[k]);
  (kids||[]).forEach(c => e.appendChild(c));
  return e;
};
const txt = (s, a) => { const e = el("text", a); e.textContent = s; return e; };
const laneColor = i => `var(--lane-${i % 6})`;

const MONO = '"IBM Plex Mono", monospace';

let renderedState = null;   // 지금 화면에 그려진 state (미리보기일 수 있음)

function render(s, base){
  renderedState = s;
  const L = layout(s);
  const W = Math.max(660, X0 + (L.maxD + 1) * COL + 46);
  const H = Math.max(300, Y0 + (L.maxL + 1) * ROW + 34);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.innerHTML = "";

  const isPreview = !!base;
  const known = base ? new Set(Object.keys(base.commits)) : null;

  // 간선
  for(const id of L.visible){
    const c = s.commits[id], a = L.pos[id];
    const dim = L.orphan.has(id);
    c.parents.forEach((p, pi) => {
      if(!L.pos[p]) return;
      const b = L.pos[p];
      const col = laneColor(a.l);
      const d = (a.l === b.l)
        ? `M${b.x} ${b.y} L${a.x} ${a.y}`
        : `M${b.x} ${b.y} C${b.x + 46} ${b.y}, ${a.x - 46} ${a.y}, ${a.x} ${a.y}`;
      svg.appendChild(el("path", {
        d, fill:"none", stroke: dim ? "var(--ink-3)" : (pi === 0 ? col : "var(--line-strong)"),
        "stroke-width": 2,
        "stroke-dasharray": pi === 0 ? "" : "1 5", "stroke-linecap":"round",
        opacity: dim ? .3 : .9
      }));
    });
  }

  // 노드
  for(const id of L.visible){
    const p = L.pos[id], c = s.commits[id];
    const isNew = isPreview && !known.has(id);
    const dim = L.orphan.has(id);
    const g = el("g", {
      class: "node" + (dim ? " orphan" : ""),
      "data-commit": id, "data-orphan": dim ? "1" : "", tabindex:"0"
    });
    g.appendChild(el("circle", {
      class:"body", cx:p.x, cy:p.y, r: c.parents.length > 1 ? 15 : 13,
      fill: isNew ? "var(--accent-soft)" : "var(--surface)",
      stroke: isNew ? "var(--accent)" : (dim ? "var(--ink-3)" : laneColor(p.l)),
      "stroke-width": isNew ? 3 : 2.5,
      "stroke-dasharray": isNew ? "4 3" : (dim ? "3 4" : "")
    }));
    if(c.parents.length > 1) g.appendChild(el("circle", { cx:p.x, cy:p.y, r:5, fill: laneColor(p.l), opacity:.55 }));
    g.appendChild(txt(shortOf(id), {
      x:p.x, y:p.y + 32, "text-anchor":"middle",
      "font-family":MONO, "font-size":"11", fill:"var(--ink-3)"
    }));
    g.appendChild(txt(c.msg.length > 13 ? c.msg.slice(0,12) + "…" : c.msg, {
      x:p.x, y:p.y + 46, "text-anchor":"middle",
      "font-family":'"IBM Plex Sans", sans-serif', "font-size":"11", fill:"var(--ink-2)"
    }));
    const t = el("title");
    t.textContent = dim
      ? `${shortOf(id)} — ${c.msg}  (고아: 어떤 ref 도 안 가리킴. reflog 로만 닿습니다)`
      : `${shortOf(id)} — ${c.msg}`;
    g.appendChild(t);
    svg.appendChild(g);
  }

  // ref 칩 — 브랜치 / 태그 / origin 추적 / HEAD
  const hc = headCommit(s), cb = curBranch(s);
  for(const id of L.visible){
    const p = L.pos[id];
    const chips = [
      ...refsAt(s, id).map(n => ({ kind:"ref", name:n })),
      ...tagsAt(s, id).map(n => ({ kind:"tag", name:n })),
      ...trackingAt(s, id).map(n => ({ kind:"tracking", name:n }))
    ];
    if(s.head.type === "commit" && s.head.ref === id) chips.push({ kind:"head", name:"HEAD" });
    chips.forEach((ch, i) => {
      const isCur  = ch.kind === "ref" && ch.name === cb;
      const isHead = ch.kind === "head";
      const label = ch.kind === "tag" ? `⌗ ${ch.name}`
                  : ch.kind === "tracking" ? `origin/${ch.name}`
                  : isCur ? `HEAD → ${ch.name}` : ch.name;
      const w = label.length * 7.1 + 16;
      const y = p.y - 26 - i * 25;
      const col = ch.kind === "tag" ? "var(--tag)"
                : ch.kind === "tracking" ? "var(--remote)"
                : laneColor(L.laneOf[id] ?? p.l);
      const g = el("g", {
        class: "chip chip-" + ch.kind + (isPreview ? " static" : ""),
        "data-chip": ch.kind, "data-name": ch.name, tabindex: isPreview ? "-1" : "0"
      });
      g.appendChild(el("rect", {
        x: p.x - w/2, y: y - 11, width:w, height:22, rx:6,
        fill: isHead ? "var(--ink)" : (isCur ? col : "var(--surface)"),
        stroke: isHead ? "var(--ink)" : col,
        "stroke-width": 1.6,
        "stroke-dasharray": ch.kind === "tracking" ? "4 3" : ""
      }));
      g.appendChild(txt(label, {
        x:p.x, y:y + 4, "text-anchor":"middle",
        "font-family":MONO, "font-size":"11.5", "font-weight":"500",
        fill: (isHead || isCur) ? "var(--surface)" : col
      }));
      g.appendChild(el("path", { d:`M${p.x} ${y + 11} L${p.x} ${p.y - 14}`, stroke:"var(--line-strong)", "stroke-width":1.5, "stroke-dasharray":"2 3" }));
      svg.appendChild(g);
    });
  }

  svg.appendChild(el("path", { id:"drag-line", d:"", stroke:"var(--accent)", "stroke-width":2.5, "stroke-dasharray":"5 4", fill:"none", "pointer-events":"none" }));

  stageWrap.classList.toggle("is-preview", isPreview);
  document.getElementById("head-label").textContent = cb || shortOf(hc || "");
  document.getElementById("head-note").textContent = cb ? "" : "(detached HEAD)";
  renderSync(s);
}

/* origin 과 얼마나 어긋나 있나 — 한 줄 상태 표시 */
function renderSync(s){
  const box = document.getElementById("sync");
  const b = curBranch(s);
  if(!b || s.remote[b] === undefined){ box.textContent = b ? "origin 에 없는 브랜치 — push 하면 새로 생깁니다" : ""; return; }
  const local = s.refs[b], track = s.tracking[b], server = s.remote[b];
  const ahead  = [...ancestors(s, local)].filter(id => !ancestors(s, track).has(id)).length;
  const behind = [...ancestors(s, track)].filter(id => !ancestors(s, local).has(id)).length;
  const stale  = track !== server;
  box.textContent =
    (ahead || behind ? `origin/${b} 대비 ↑${ahead} ↓${behind}` : `origin/${b} 과 동기화됨`) +
    (stale ? " · fetch 안 한 변경이 origin 에 있음" : "");
  box.classList.toggle("warn", stale);
}

/* 콘솔 */
const consoleEl = document.getElementById("console");
function renderConsole(){
  consoleEl.innerHTML = "";
  for(const l of state.log){
    const d = document.createElement("div");
    d.className = "l " + (l.k || "out");
    d.textContent = l.t;
    consoleEl.appendChild(d);
  }
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
