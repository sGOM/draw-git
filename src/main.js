"use strict";

/* ============================================================
   적용 — 모든 명령이 여기를 지난다. reflog 도 여기서 쌓인다
   ============================================================ */

function commit(next, cmdText){
  const prev = state;
  undoStack.push(clone(prev));
  if(cmdText){
    // ops 는 로그를 뒤에만 붙이므로, 명령줄을 그 출력 앞에 끼워넣는다
    next.log.splice(prev.log.length, 0, { k:"cmd", t:cmdText });
    reflogAdd(prev, next, cmdText.replace(/^git /, "").split(" && ").pop());
  }
  state = next;
  render(state);
  renderConsole();
  document.getElementById("btn-undo").disabled = !undoStack.length;
}

/** HEAD 와, 값이 바뀐 브랜치의 '이전 자리'를 남긴다 — git 의 per-ref reflog 에 해당 */
function reflogAdd(prev, next, cmd){
  for(const b in prev.refs){
    if(prev.refs[b] !== next.refs[b]) next.reflog.unshift({ to: prev.refs[b], cmd, ref: b });
  }
  const hc = headCommit(next);
  if(hc && next.reflog[0] && next.reflog[0].to === hc && !next.reflog[0].ref){ /* 중복 */ }
  else if(hc) next.reflog.unshift({ to: hc, cmd, ref: null });
  next.reflog.length = Math.min(next.reflog.length, REFLOG_MAX);
}

/* ============================================================
   드래그 & 팝오버
   ============================================================ */

const pop = document.getElementById("pop");
const popList = document.getElementById("pop-list");
let drag = null;

const popTitle = f => ({ ref:`브랜치 '${f.name}'`, tag:`태그 '${f.name}'`, tracking:`origin/${f.name}`, head:"HEAD" }[f.kind]
                     || `커밋 ${shortOf(f.name)}`);

function svgPoint(e){
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function commitUnder(e){
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const n = t && t.closest("[data-commit]");
  return n ? n.getAttribute("data-commit") : null;
}
const chipAnchor = (s, kind, name) =>
  kind === "head" ? headCommit(s)
  : kind === "tag" ? s.tags[name]
  : kind === "tracking" ? s.tracking[name]
  : s.refs[name];

/* 칩을 끌지 않고 그냥 눌렀을 때 — 우클릭과 같은 메뉴를 연다 (우클릭을 모를 수도 있으니) */
const chipMenu = (s, kind, name) =>
  kind === "ref" ? branchMenu(s, name)
  : kind === "tag" ? tagMenu(s, name)
  : kind === "tracking" ? trackingMenu(s, name)
  : [];

svg.addEventListener("pointerdown", e => {
  if(stageWrap.classList.contains("is-preview")) return;
  if(e.button !== 0) return;
  const chip = e.target.closest("[data-chip]");
  const node = e.target.closest("[data-commit]");
  if(!chip && !node) return;
  const from = chip
    ? { kind: chip.getAttribute("data-chip"), name: chip.getAttribute("data-name") }
    : { kind: "commit", name: node.getAttribute("data-commit") };
  const anchorId = chip ? chipAnchor(state, from.kind, from.name) : from.name;
  drag = { from, anchor: layout(state).pos[anchorId], at: {x:e.clientX, y:e.clientY}, moved: false };
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
});

svg.addEventListener("pointermove", e => {
  if(!drag) return;
  if(Math.hypot(e.clientX - drag.at.x, e.clientY - drag.at.y) > 4) drag.moved = true;
  if(!drag.moved) return;
  const p = svgPoint(e);
  const line = svg.querySelector("#drag-line");
  if(line && drag.anchor) line.setAttribute("d", `M${drag.anchor.x} ${drag.anchor.y} L${p.x} ${p.y}`);
  const over = commitUnder(e);
  svg.querySelectorAll(".node").forEach(n => n.classList.toggle("drop-ok", n.getAttribute("data-commit") === over && over !== drag.from.name));
});

svg.addEventListener("pointerup", e => {
  if(!drag) return;
  const d = drag; drag = null;
  const line = svg.querySelector("#drag-line");
  if(line) line.setAttribute("d", "");
  svg.querySelectorAll(".node").forEach(n => n.classList.remove("drop-ok"));
  if(!d.moved){
    const list = chipMenu(state, d.from.kind, d.from.name);
    if(list.length) openPop(popTitle(d.from), "무엇을 하시겠어요?", list);
    return;
  }
  const target = commitUnder(e);
  if(!target) return;

  const list = candidates(state, { kind: d.from.kind, name: d.from.name, target });
  if(!list.length) return;
  openPop(`${popTitle(d.from)} 을(를) ${shortOf(target)} 로 옮겼습니다`, "이 중에 어떤 뜻이었나요?", list);
});

svg.addEventListener("contextmenu", e => {
  const chip = e.target.closest("[data-chip]");
  const node = e.target.closest("[data-commit]");
  if(!chip && !node) return;
  e.preventDefault();

  let q, sub, list;
  if(chip){
    const kind = chip.getAttribute("data-chip"), name = chip.getAttribute("data-name");
    if(kind === "ref"){      q = `브랜치 ${name}`;        sub = "원격과 주고받기 / 이름표 다루기"; list = branchMenu(state, name); }
    else if(kind === "tag"){ q = `태그 ${name}`;          sub = "태그는 커밋을 따라 움직이지 않습니다"; list = tagMenu(state, name); }
    else if(kind === "tracking"){ q = `origin/${name}`;   sub = "내가 마지막으로 본 origin 의 모습"; list = trackingMenu(state, name); }
    else return;
  }else{
    const id = node.getAttribute("data-commit");
    q = `커밋 ${shortOf(id)}`;
    sub = state.commits[id].msg;
    list = commitMenu(state, id);
  }
  if(list && list.length) openPop(q, sub, list);
});

function openPop(q, sub, list){
  document.getElementById("pop-q").textContent = q;
  document.getElementById("pop-sub").textContent = sub;
  popList.innerHTML = "";
  const baseState = state;
  for(const c of list){
    const b = document.createElement("button");
    b.className = "cand";
    b.innerHTML = `<span class="tag"></span><span class="cmd"></span><div class="why"></div>`;
    b.querySelector(".tag").textContent = c.tag;
    b.querySelector(".cmd").textContent = c.cmd;
    b.querySelector(".why").textContent = c.why;
    const preview = () => { render(c.act(clone(baseState)), baseState); };
    b.addEventListener("mouseenter", preview);
    b.addEventListener("focus", preview);
    b.addEventListener("mouseleave", () => render(baseState));
    b.addEventListener("click", () => { closePop(true); commit(c.act(clone(baseState)), c.cmd); });
    popList.appendChild(b);
  }
  pop.classList.add("open");
  placePop();
  popList.querySelector(".cand").focus({ preventScroll: true });
}

/* 팝오버는 커서가 아니라 캔버스 '바깥'에 붙는다 — 호버 미리보기를 가리면 안 되니까.
   옆에 자리가 없으면 캔버스 아래로 내리고, 그만큼 목록 높이를 줄여 겹침을 없앤다 */
function placePop(){
  const r = stageWrap.getBoundingClientRect();
  const clamp = (v, max) => Math.max(12, Math.min(v, max - 12));

  popList.style.maxHeight = "";
  const w = pop.offsetWidth;
  const side = clamp(r.right + 12, window.innerWidth - w);
  const beside = side >= r.right - 20;

  const room = beside ? window.innerHeight - 24 : window.innerHeight - r.bottom - 36;
  const chrome = pop.offsetHeight - popList.offsetHeight;
  // ponytail: 화면이 아주 낮으면 140px 목록도 안 들어가 결국 겹친다. 그땐 스크롤이 답
  popList.style.maxHeight = Math.max(140, room - chrome) + "px";

  const h = pop.offsetHeight;
  pop.style.left = (beside ? side : clamp(r.left, window.innerWidth - w)) + "px";
  pop.style.top  = clamp(beside ? r.top : r.bottom + 12, window.innerHeight - h) + "px";
}

function closePop(skipRestore){
  if(!pop.classList.contains("open")) return;
  pop.classList.remove("open");
  if(!skipRestore) render(state);
}

document.addEventListener("keydown", e => { if(e.key === "Escape") closePop(); });
document.addEventListener("pointerdown", e => { if(pop.classList.contains("open") && !pop.contains(e.target)) closePop(); });

/* ============================================================
   툴바
   ============================================================ */

const BRANCH_POOL = ["hotfix","release","experiment","refactor","docs","spike"];
const on = (id, fn) => document.getElementById(id).addEventListener("click", fn);

on("btn-commit", () => {
  const msg = nextMsg().trim();
  commit(OPS.commit(clone(state), msg), `git commit -m "${msg}"`);
});

on("btn-branch", () => {
  const name = BRANCH_POOL.find(n => !(n in state.refs)) || "branch-" + Object.keys(state.refs).length;
  commit(OPS.createBranch(clone(state), name, headCommit(state), true), `git checkout -b ${name}`);
});

on("btn-reflog", () => {
  const next = clone(state);
  next.log.push({ k:"cmd", t:"git reflog" });
  const n = {};
  for(const e of next.reflog){
    const key = e.ref || "HEAD";
    n[key] = n[key] || 0;
    next.log.push({ k:"out", t:`${shortOf(e.to)} ${key}@{${n[key]++}}: ${e.cmd}` });
  }
  next.log.push({ k:"note", t:"흐리게 그려진 커밋은 어떤 ref 도 안 가리키지만 아직 여기 남아 있습니다. 우클릭해서 되살려 보세요." });
  state = next; renderConsole();
});

on("btn-mate", () => {
  // cmdText 없음 = reflog 에 안 남는다. 내 ref 는 하나도 안 움직였으니 그게 맞다
  const b = Object.keys(state.remote)[0] || "main";
  commit(OPS.matePush(clone(state), b), null);
});

on("btn-undo", () => {
  if(!undoStack.length) return;
  state = undoStack.pop();
  state.log.push({ k:"out", t:"↶ 한 단계 되돌렸습니다." });
  render(state); renderConsole();
  document.getElementById("btn-undo").disabled = !undoStack.length;
});

on("btn-reset", () => {
  undoStack.length = 0; msgIdx = 0; mateIdx = 0;
  state = initialState();
  render(state); renderConsole();
  document.getElementById("btn-undo").disabled = true;
});

on("btn-clear", () => { state.log = []; renderConsole(); });

document.getElementById("btn-undo").disabled = true;
render(state);
renderConsole();
