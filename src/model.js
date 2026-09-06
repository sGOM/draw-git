"use strict";

/* ============================================================
   state — 커밋 풀 하나 + ref 네 종류 + HEAD + reflog + 콘솔 로그

     refs      로컬 브랜치        main, feature
     tags      태그               v0.1      — 커밋을 따라 움직이지 않는다
     tracking  원격 추적 ref      origin/main — fetch 해야 갱신된다
     remote    서버의 진짜 값     화면에 안 보인다. push/fetch 로만 만진다

   tracking 과 remote 가 어긋날 수 있다는 것이 원격 파트의 학습 지점이다.
   그래서 두 필드를 따로 둔다 (--force-with-lease 는 둘이 같을 때만 통과).
   ============================================================ */

const SEED_MSGS = ["프로젝트 초기 설정","README 작성","로그인 폼 추가","비밀번호 검증","세션 저장"];
const MATE_MSGS = ["문서 오타 수정","CI 캐시 설정","의존성 업데이트","린트 규칙 정리"];
let msgIdx = 0, mateIdx = 0;
const nextMsg = () => SEED_MSGS[msgIdx++ % SEED_MSGS.length] + " " + (Math.floor(msgIdx/SEED_MSGS.length)||"");
const nextMateMsg = () => MATE_MSGS[mateIdx++ % MATE_MSGS.length];
const newId = () => Math.random().toString(16).slice(2,9);

// ponytail: 오래된 것부터 자른다. 잘린 자리만 가리키던 고아 커밋은 화면에서 사라진다 —
// 진짜 git 도 gc 하면 그렇다. 부족하면 숫자만 키우면 되고, 제대로 하려면 만료 시각을 달아야 한다.
const REFLOG_MAX = 40;

function initialState(){
  const s = {
    commits:{}, order:[],
    refs:{}, tags:{}, tracking:{}, remote:{},
    head:{type:"branch",ref:"main"}, reflog:[], log:[]
  };
  const mk = (msg, parents) => {
    const id = newId();
    s.commits[id] = { id, parents, msg };
    s.order.push(id);
    return id;
  };
  const c1 = mk("프로젝트 초기 설정", []);
  const c2 = mk("README 작성", [c1]);
  const c3 = mk("빌드 스크립트 정리", [c2]);
  const f1 = mk("로그인 폼 추가", [c2]);
  const f2 = mk("비밀번호 검증", [f1]);
  s.refs     = { main:c3, feature:f2 };
  s.tags     = { "v0.1": c2 };
  s.tracking = { main:c3 };
  s.remote   = { main:c3 };
  s.reflog   = [{ to:c3, cmd:"clone: from origin" }];
  s.log = [
    {k:"out", t:"git clone — 예제 저장소를 불러왔습니다."},
    {k:"out", t:"main 3개(origin 과 동기화됨), feature 2개, 태그 v0.1."}
  ];
  return s;
}

let state = initialState();
const undoStack = [];

const clone = s => (window.structuredClone ? structuredClone(s) : JSON.parse(JSON.stringify(s)));
const shortOf = id => id.slice(0,7);
const curBranch = s => s.head.type === "branch" ? s.head.ref : null;
const headCommit = s => s.head.type === "branch" ? s.refs[s.head.ref] : s.head.ref;

function ancestors(s, id, acc){
  acc = acc || new Set();
  if(!id || acc.has(id) || !s.commits[id]) return acc;
  acc.add(id);
  for(const p of s.commits[id].parents) ancestors(s, p, acc);
  return acc;
}
const isAncestor = (s, a, b) => ancestors(s, b).has(a);   // a 가 b 의 조상인가

/** 어떤 브랜치들이 이 커밋을 히스토리에 갖고 있나 */
function branchesContaining(s, id){
  return Object.keys(s.refs).filter(b => ancestors(s, s.refs[b]).has(id));
}
/** 커밋을 '소유'한 브랜치 하나 — 현재 브랜치 우선, 아니면 tip이 가장 가까운 것 */
function owningBranch(s, id){
  const bs = branchesContaining(s, id);
  if(!bs.length) return null;
  const cb = curBranch(s);
  if(cb && bs.includes(cb)) return cb;
  bs.sort((a,b) => ancestors(s, s.refs[a]).size - ancestors(s, s.refs[b]).size);
  return bs[0];
}
const refsAt     = (s,id) => Object.keys(s.refs).filter(b => s.refs[b] === id);
const tagsAt     = (s,id) => Object.keys(s.tags).filter(t => s.tags[t] === id);
const trackingAt = (s,id) => Object.keys(s.tracking).filter(t => s.tracking[t] === id);

/** 지금 어떤 ref 로든 닿는 커밋. remote 는 아직 fetch 안 했으니 뺀다 */
function liveSet(s){
  const live = new Set();
  for(const id of Object.values(s.refs))     ancestors(s, id, live);
  for(const id of Object.values(s.tags))     ancestors(s, id, live);
  for(const id of Object.values(s.tracking)) ancestors(s, id, live);
  ancestors(s, headCommit(s), live);
  return live;
}
/** live + reflog 로만 닿는 고아 커밋. "커밋은 바로 사라지지 않는다" */
function reachSet(s){
  const reach = liveSet(s);
  for(const e of s.reflog) ancestors(s, e.to, reach);
  return reach;
}
// ponytail: 호출마다 그래프를 두 번 훑는다 (노드 수십 개짜리 장난감이라 그냥 둔다)
const orphanSet = s => {
  const live = liveSet(s), o = new Set();
  for(const id of reachSet(s)) if(!live.has(id)) o.add(id);
  return o;
};

function out(s, t, k){ s.log.push({k: k || "out", t}); }

/* ============================================================
   ops — 전부 (state) => state 인 순수 함수. 미리보기·실행·undo가 여기서 나옴
   ============================================================ */

function addCommit(s, msg, parents){
  const id = newId();
  s.commits[id] = { id, parents, msg };
  s.order.push(id);
  return id;
}
/** 현재 위치(브랜치 or detached)를 id 로 옮긴다. 옮긴 브랜치 이름을 돌려준다 */
function moveHere(s, id){
  const b = curBranch(s);
  if(b) s.refs[b] = id; else s.head = {type:"commit", ref:id};
  return b;
}

const OPS = {
  commit(s, msg){
    const parent = headCommit(s);
    const id = addCommit(s, msg, parent ? [parent] : []);
    const b = moveHere(s, id);
    out(s, `[${b || "detached HEAD"} ${shortOf(id)}] ${msg}`);
    out(s, ` 1 file changed, 4 insertions(+)`);
    return s;
  },

  createBranch(s, name, at, checkout){
    s.refs[name] = at;
    if(checkout){ s.head = {type:"branch", ref:name}; out(s, `Switched to a new branch '${name}'`); }
    else out(s, `브랜치 '${name}' 를 ${shortOf(at)} 에 만들었습니다.`);
    return s;
  },

  branchForce(s, name, to){
    s.refs[name] = to;
    out(s, `'${name}' 이(가) ${shortOf(to)} 을(를) 가리킵니다.`);
    return s;
  },

  resetHard(s, to, label){
    moveHere(s, to);
    out(s, `HEAD is now at ${shortOf(to)} ${s.commits[to].msg}`);
    if(label) out(s, `${label} 이(가) 가리키던 자리로 돌아왔습니다. 버린 줄 알았던 커밋도 reflog 에 남아 있습니다.`, "note");
    return s;
  },

  checkout(s, refOrId){
    if(s.refs[refOrId] !== undefined){
      s.head = {type:"branch", ref:refOrId};
      out(s, `Switched to branch '${refOrId}'`);
    }else{
      s.head = {type:"commit", ref:refOrId};
      out(s, `Note: switching to '${shortOf(refOrId)}'.`);
      out(s, `You are in 'detached HEAD' state. 여기서 만든 커밋은 어떤 브랜치도 가리키지 않습니다.`);
    }
    return s;
  },

  /* ---------- 병합 ---------- */

  merge(s, from, opt){
    opt = opt || {};
    const into = curBranch(s);
    const a = s.refs[into];
    const b = opt.at !== undefined ? opt.at : s.refs[from];
    if(isAncestor(s, b, a)){ out(s, "Already up to date."); return s; }
    if(isAncestor(s, a, b) && !opt.noff && !opt.squash){
      s.refs[into] = b;
      out(s, `Updating ${shortOf(a)}..${shortOf(b)}`);
      out(s, `Fast-forward — 새 커밋 없이 포인터만 앞으로 갔습니다.`, "note");
      return s;
    }
    if(opt.squash){
      const id = addCommit(s, `Squashed '${from}'`, [a]);
      s.refs[into] = id;
      out(s, `Squash commit -- not updating HEAD`);
      out(s, `${from} 의 변경 내용만 커밋 하나로 얹었습니다. 부모가 하나뿐이라 ${from} 과 이어지지 않습니다 — 나중에 진짜 머지하면 중복됩니다.`, "note");
      return s;
    }
    const id = addCommit(s, `Merge branch '${from}' into ${into}`, [a, b]);
    s.refs[into] = id;
    out(s, `Merge made by the 'ort' strategy.`);
    out(s, opt.noff
      ? `일직선이라 그냥 뒀으면 fast-forward 였지만, --no-ff 로 병합 커밋을 남겼습니다. "여기서 ${from} 이 합쳐졌다"는 기록이 남습니다.`
      : `부모가 둘인 병합 커밋 ${shortOf(id)} 이(가) 생겼습니다. 양쪽 히스토리는 그대로.`, "note");
    return s;
  },

  /* ---------- 재작성 ---------- */

  /** branch 의 커밋 중 upstream 히스토리에 없는 것들을 newbase 위로 복제 */
  replay(s, branch, newbase, upstream){
    const skip = ancestors(s, upstream);
    const moving = s.order.filter(id => ancestors(s, s.refs[branch]).has(id) && !skip.has(id));
    if(!moving.length){ out(s, "Current branch is up to date."); return s; }
    const map = {};
    let base = newbase;
    for(const id of moving){
      const old = s.commits[id];
      const parents = old.parents.length > 1
        ? [base]                                        // 병합 커밋은 평탄화
        : [ old.parents[0] && map[old.parents[0]] ? map[old.parents[0]] : base ];
      base = addCommit(s, old.msg, parents);
      map[id] = base;
    }
    s.refs[branch] = base;
    out(s, `Successfully rebased and updated refs/heads/${branch}.`);
    out(s, `커밋 ${moving.length}개를 새로 썼습니다 (${moving.map(shortOf).join(", ")} → ${Object.values(map).map(shortOf).join(", ")}). 해시가 바뀐 것에 주목.`, "note");
    return s;
  },

  cherryPick(s, id){
    const nid = addCommit(s, s.commits[id].msg, [headCommit(s)]);
    const b = moveHere(s, nid);
    out(s, `[${b || "detached"} ${shortOf(nid)}] ${s.commits[id].msg}`);
    out(s, `원본 ${shortOf(id)} 은(는) 그대로 두고 복사본을 얹었습니다.`, "note");
    return s;
  },

  revert(s, id){
    const nid = addCommit(s, `Revert "${s.commits[id].msg}"`, [headCommit(s)]);
    const b = moveHere(s, nid);
    out(s, `[${b || "detached"} ${shortOf(nid)}] Revert "${s.commits[id].msg}"`);
    out(s, `히스토리를 지우지 않고, 되돌리는 커밋을 새로 쌓았습니다.`, "note");
    return s;
  },

  /** 마지막 커밋을 새 해시로 다시 쓴다 */
  amend(s, msg){
    const old = s.commits[headCommit(s)];
    const nid = addCommit(s, msg || old.msg, old.parents);
    const b = moveHere(s, nid);
    out(s, `[${b || "detached"} ${shortOf(nid)}] ${s.commits[nid].msg}`);
    out(s, `고친 게 아니라 ${shortOf(old.id)} 를 버리고 ${shortOf(nid)} 를 새로 썼습니다. 이미 push 했다면 강제 push 가 필요해집니다.`, "note");
    return s;
  },

  /** id 의 메시지만 바꿔 다시 쓰고, 뒤따르던 커밋들도 새 해시로 복제한다 */
  reword(s, id, msg){
    const B = owningBranch(s, id);
    const skip = ancestors(s, s.commits[id].parents[0]);
    const chain = s.order.filter(x => ancestors(s, s.refs[B]).has(x) && !skip.has(x));
    const map = {};
    let base = s.commits[id].parents[0];
    for(const x of chain){
      base = addCommit(s, x === id ? msg : s.commits[x].msg, [ map[s.commits[x].parents[0]] || base ]);
      map[x] = base;
    }
    s.refs[B] = base;
    out(s, `Successfully rebased and updated refs/heads/${B}.`);
    out(s, `메시지 한 줄 고쳤을 뿐인데 ${chain.length}개 커밋의 해시가 전부 바뀝니다. 커밋 해시는 부모까지 포함해 계산되기 때문.`, "note");
    return s;
  },

  /** id 와 그 부모를 커밋 하나로 합치고, 뒤따르던 커밋들을 다시 쓴다 */
  squash(s, id, fixup){
    const B = owningBranch(s, id);
    const parent = s.commits[id].parents[0];
    const merged = addCommit(s,
      fixup ? s.commits[parent].msg : `${s.commits[parent].msg} + ${s.commits[id].msg}`,
      s.commits[parent].parents);
    const skip = ancestors(s, id);
    const after = s.order.filter(x => ancestors(s, s.refs[B]).has(x) && !skip.has(x));
    const map = {};
    let base = merged;
    for(const x of after){
      base = addCommit(s, s.commits[x].msg, [ map[s.commits[x].parents[0]] || base ]);
      map[x] = base;
    }
    s.refs[B] = base;
    out(s, `Successfully rebased and updated refs/heads/${B}.`);
    out(s, fixup
      ? `fixup — ${shortOf(id)} 의 변경만 부모에 흡수시키고 메시지는 버렸습니다.`
      : `squash — 커밋 두 개가 ${shortOf(merged)} 하나가 됐습니다. 뒤 커밋들도 부모가 바뀌어 해시가 전부 새로 붙습니다.`, "note");
    return s;
  },

  /* ---------- 태그 ---------- */

  tag(s, name, at, force){
    s.tags[name] = at;
    out(s, force ? `Updated tag '${name}'` : `태그 '${name}' 를 ${shortOf(at)} 에 붙였습니다.`);
    out(s, `태그는 브랜치와 달리 커밋을 따라 움직이지 않습니다. 여기서 커밋해도 제자리.`, "note");
    return s;
  },
  tagDelete(s, name){
    delete s.tags[name];
    out(s, `Deleted tag '${name}'`);
    return s;
  },

  deleteBranch(s, name){
    delete s.refs[name];
    out(s, `Deleted branch ${name}.`);
    return s;
  },

  /* ---------- 원격 ---------- */

  fetch(s){
    const moved = [];
    for(const b in s.remote){
      if(s.tracking[b] !== s.remote[b]){ moved.push(b); s.tracking[b] = s.remote[b]; }
    }
    if(!moved.length){ out(s, "이미 최신입니다. origin 에 새로 올라온 게 없습니다."); return s; }
    out(s, `From origin`);
    moved.forEach(b => out(s, `   ${shortOf(s.tracking[b])}  ${b} -> origin/${b}`));
    out(s, `origin/${moved[0]} 만 움직였습니다. 내 ${moved[0]} 는 그대로 — fetch 는 합치지 않습니다.`, "note");
    return s;
  },

  push(s, b, mode){
    const local = s.refs[b], server = s.remote[b];
    if(server === local){ out(s, "Everything up-to-date."); return s; }
    const ff = server === undefined || isAncestor(s, server, local);
    if(!ff && !mode){
      out(s, ` ! [rejected]        ${b} -> ${b} (non-fast-forward)`);
      out(s, `error: failed to push some refs to 'origin'`);
      out(s, `내 히스토리가 origin 을 통째로 포함하지 않습니다. 되쓰기(rebase/amend/reset)를 했거나 남이 먼저 올렸다는 뜻.`, "note");
      return s;
    }
    if(mode === "lease" && s.tracking[b] !== server){
      out(s, ` ! [rejected]        ${b} -> ${b} (stale info)`);
      out(s, `내가 마지막으로 본 origin/${b} 은 ${shortOf(s.tracking[b])} 인데 서버는 ${shortOf(server)} 입니다.`);
      out(s, `--force-with-lease 가 막아준 상황. 그냥 --force 였다면 남의 커밋을 지웠습니다. 먼저 fetch 하세요.`, "note");
      return s;
    }
    const lost = ff ? [] : [...ancestors(s, server)].filter(id => !ancestors(s, local).has(id));
    s.remote[b] = local; s.tracking[b] = local;
    out(s, `To origin`);
    out(s, `   ${ff ? "" : "+ "}${shortOf(server || local)}..${shortOf(local)}  ${b} -> ${b}${ff ? "" : " (forced update)"}`);
    if(!ff) out(s, `서버 히스토리를 덮어썼습니다. 남만 갖고 있던 커밋 ${lost.length}개가 origin 에서 사라집니다.`, "note");
    return s;
  },

  pull(s, b, rebase){
    OPS.fetch(s);
    const up = s.tracking[b];
    if(up === undefined || isAncestor(s, up, s.refs[b])){ out(s, "Already up to date."); return s; }
    if(curBranch(s) !== b) OPS.checkout(s, b);
    if(isAncestor(s, s.refs[b], up)){          // 내 쪽에 새 커밋이 없으면 그냥 따라간다
      s.refs[b] = up;
      out(s, "Fast-forward");
      out(s, `내가 만든 커밋이 없어서 합칠 것도 없습니다. --rebase 든 아니든 포인터만 앞으로.`, "note");
      return s;
    }
    if(rebase){
      OPS.replay(s, b, up, up);
      out(s, `내 커밋들을 origin/${b} 위로 다시 썼습니다. 병합 커밋 없이 일직선.`, "note");
      return s;
    }
    const a = s.refs[b];
    const id = addCommit(s, `Merge branch '${b}' of origin into ${b}`, [a, up]);
    s.refs[b] = id;
    out(s, `Merge made by the 'ort' strategy.`);
    out(s, `병합 커밋이 생겼습니다. 이게 쌓여서 지저분해지는 걸 피하려고 --rebase 를 쓰기도 합니다.`, "note");
    return s;
  },

  /** 동료가 origin 에 커밋 하나를 올린 상황. 내 tracking 은 아직 모른다 */
  matePush(s, b){
    const id = addCommit(s, nextMateMsg(), [s.remote[b]]);
    s.remote[b] = id;
    out(s, `(시뮬레이션) 동료가 origin/${b} 에 커밋을 하나 올렸습니다.`);
    out(s, `아직 그래프에 안 보입니다 — fetch 하기 전엔 origin 에 뭐가 있는지 알 수 없으니까.`, "note");
    return s;
  },

  reflogPrint(s){
    out(s, "git reflog", "cmd");
    s.reflog.forEach((e, i) => out(s, `${shortOf(e.to)} HEAD@{${i}}: ${e.cmd}`));
    out(s, `되돌리고 싶으면 그 자리로 reset 하면 됩니다 — 고아 커밋을 우클릭해 보세요.`, "note");
    return s;
  }
};
