"use strict";

/* ============================================================
   적용 — 모든 명령이 여기를 지난다. reflog 도 여기서 쌓인다
   ============================================================ */

/* ============================================================
   과제 — 달성 판정은 state 술어 하나뿐이라 undo 를 해도 저절로 맞다
   ============================================================ */

let quest = null, questId = "";

function loadMode(id){
  closePop();
  questId = id;
  undoStack.length = 0; msgIdx = 0; mateIdx = 0; fileIdx = 0;
  const sc = SCENARIOS.find(x => x.id === id);
  if(!sc){ quest = null; state = initialState(); }
  else {
    quest = sc.make();
    state = quest.state;
    out(state, `과제 · ${quest.goal}`, "note");
  }
  render(state); renderQuest(); renderConsole();
  document.getElementById("btn-undo").disabled = true;
}

function renderQuest(){
  document.getElementById("guide").hidden = !!quest;
  document.getElementById("quest").hidden = !quest;
  document.getElementById("side-title").textContent = quest ? "과제" : "이렇게 해보세요";
  if(!quest) return;
  const qp = document.getElementById("quest");
  qp.querySelector(".q-brief").textContent = quest.brief;
  qp.querySelector(".q-goal").textContent = quest.goal;
  qp.querySelector(".q-hint p").textContent = quest.hint;
  const cleared = quest.done(state);
  const st = document.getElementById("q-state");
  st.textContent = cleared ? "✓ 달성" : "아직";
  st.classList.toggle("ok", cleared);
}

/* 달성 안내는 콘솔에 한 줄만. 표식을 state.log 에 두므로 undo 로 되돌리면
   표식도 같이 사라지고, 다시 풀면 다시 뜬다 (모듈 변수로 들고 있으면 이게 안 맞는다) */
function checkQuest(){
  if(quest && quest.done(state) && !state.log.some(l => l.k === "quest")){
    out(state, `✓ 과제 달성 — ${quest.goal}`, "quest");
  }
  renderQuest();
}

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
  checkQuest();
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
const popQ = document.getElementById("pop-q");
const popSub = document.getElementById("pop-sub");
const popWhy = document.getElementById("pop-why");
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

/* 끌지 않고 그냥 눌렀을 때 — 우클릭과 같은 메뉴를 연다.
   터치 기기엔 우클릭이 없어서, 이게 없으면 amend/revert/tag 에 아예 닿을 수 없다 */
const clickMenu = (s, kind, name) =>
  kind === "ref" ? branchMenu(s, name)
  : kind === "tag" ? tagMenu(s, name)
  : kind === "tracking" ? trackingMenu(s, name)
  : kind === "commit" ? commitMenu(s, name)
  : [];
const clickSub = (s, kind, name) =>
  kind === "commit" ? s.commits[name].msg
  : kind === "ref" ? "원격과 주고받기 / 갈아타기"
  : kind === "tag" ? "태그는 커밋을 따라 움직이지 않습니다"
  : "내가 마지막으로 본 origin 의 모습";

svg.addEventListener("pointerdown", e => {
  if(stageWrap.classList.contains("is-preview")) return;
  if(state.conflict) return;      // 충돌 중엔 해결하거나 취소하는 것 말고 할 수 있는 게 없다
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

function endDrag(){
  const d = drag; drag = null;
  const line = svg.querySelector("#drag-line");
  if(line) line.setAttribute("d", "");
  svg.querySelectorAll(".node").forEach(n => n.classList.remove("drop-ok"));
  return d;
}
// 브라우저가 드래그를 가로채면(스크롤 제스처 등) 끌던 선이 화면에 남는다
svg.addEventListener("pointercancel", endDrag);

svg.addEventListener("pointerup", e => {
  if(!drag) return;
  const d = endDrag();
  if(!d.moved){
    const list = clickMenu(state, d.from.kind, d.from.name);
    if(list.length) openPop(popTitle(d.from), clickSub(state, d.from.kind, d.from.name), list);
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
  if(!chip && !node || state.conflict) return;
  e.preventDefault();

  const from = chip
    ? { kind: chip.getAttribute("data-chip"), name: chip.getAttribute("data-name") }
    : { kind: "commit", name: node.getAttribute("data-commit") };
  const list = clickMenu(state, from.kind, from.name);
  if(list.length) openPop(popTitle(from), clickSub(state, from.kind, from.name), list);
});

/* 목록은 명령어만 한 줄씩(훑기 쉽게), 설명은 아래 고정 칸에 '지금 보고 있는 것'만.
   칸 높이가 고정이라 항목을 옮겨다녀도 목록이 출렁이지 않는다 */
function openPop(q, sub, list){
  popQ.textContent = q;
  popSub.textContent = sub;
  popList.innerHTML = "";
  const base = state;

  // 강조는 .cur 하나로만 — :hover 와 :focus 를 같이 쓰면 두 줄이 동시에 밝아진다
  const show = i => {
    [...popList.children].forEach((el, j) => el.classList.toggle("cur", j === i));
    popWhy.textContent = list[i].why;
    render(list[i].act(clone(base)), base);
  };
  // 항목 사이를 지날 때 base 로 안 돌아간다 — 그러면 미리보기가 깜빡인다
  popList.onmouseleave = () => {
    const f = popList.querySelector(".cand:focus");
    if(f) show(+f.dataset.i); else render(base);
  };

  list.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "cand";
    b.dataset.i = i;
    b.innerHTML = `<span class="tag"></span><span class="cmd"></span>`;
    b.querySelector(".tag").textContent = c.tag;
    b.querySelector(".cmd").textContent = c.cmd;
    b.addEventListener("mouseenter", () => show(i));
    b.addEventListener("focus", () => show(i));
    b.addEventListener("click", () => { closePop(true); commit(c.act(clone(base)), c.cmd); });
    popList.appendChild(b);
  });

  pop.classList.add("open");
  placePop();
  popList.firstChild.focus({ preventScroll: true });
}

/* ↑↓ 로 후보 사이 이동 — 포커스가 곧 미리보기라 키보드만으로도 다 보인다 */
popList.addEventListener("keydown", e => {
  if(e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...popList.children];
  const i = items.indexOf(document.activeElement);
  items[(Math.max(0, i) + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
});

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

window.addEventListener("resize", () => { if(pop.classList.contains("open")) placePop(); });
document.addEventListener("keydown", e => { if(e.key === "Escape") closePop(); });
document.addEventListener("pointerdown", e => { if(pop.classList.contains("open") && !pop.contains(e.target)) closePop(); });

/* ============================================================
   툴바
   ============================================================ */

const BRANCH_POOL = ["hotfix","release","experiment","refactor","docs","spike"];
const on = (id, fn) => document.getElementById(id).addEventListener("click", fn);

on("btn-resolve", () => commit(OPS.resolveConflict(clone(state)), state.conflict.cont));
on("btn-abort",   () => commit(OPS.abortConflict(clone(state)),   state.conflict.abort));

on("btn-commit", () => {
  if(state.conflict) return;
  const msg = nextMsg().trim();
  commit(OPS.commit(clone(state), msg), `git commit -m "${msg}"`);
});

on("btn-branch", () => {
  if(state.conflict) return;
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
  if(state.conflict) return;
  // cmdText 없음 = reflog 에 안 남는다. 내 ref 는 하나도 안 움직였으니 그게 맞다
  const b = Object.keys(state.remote)[0] || "main";
  commit(OPS.matePush(clone(state), b), null);
});

on("btn-undo", () => {
  if(!undoStack.length) return;
  state = undoStack.pop();
  state.log.push({ k:"out", t:"↶ 한 단계 되돌렸습니다." });
  render(state); checkQuest(); renderConsole();
  document.getElementById("btn-undo").disabled = !undoStack.length;
});

on("btn-reset", () => loadMode(questId));   // 과제 중이면 그 과제를 처음부터

on("btn-clear", () => { state.log = []; renderConsole(); });

const modeSel = document.getElementById("mode");
for(const sc of SCENARIOS) modeSel.add(new Option(sc.title, sc.id));
modeSel.addEventListener("change", () => loadMode(modeSel.value));

document.getElementById("btn-undo").disabled = true;
render(state);
renderQuest();
renderConsole();
