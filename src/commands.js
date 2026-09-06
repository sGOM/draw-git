"use strict";

/* ============================================================
   후보 테이블 — 제스처가 키다. 그래프를 보고 명령을 추론하지 않는다.
   act 는 (state) => state. 미리보기와 실행이 같은 함수를 쓴다.
   ============================================================ */

const mk = list => (cmd, why, tag, act) => list.push({ cmd, why, tag, act });

/* 고르기 전에 알려준다 — 충돌은 놀라는 것보다 예고되는 편이 배우기 쉽다 */
const warnConflict = (s, a, b) => {
  const cf = conflictFiles(s, a, b);
  return cf.length ? ` ⚠ 양쪽이 ${cf.join(", ")} 를 건드려서 충돌이 납니다.` : "";
};

function nextTagName(s){
  let n = 2;
  while(s.tags["v0." + n] !== undefined) n++;
  return "v0." + n;
}

/* ---------- 드래그: 무언가를 커밋 T 위에 떨어뜨렸다 ---------- */

function candidates(s, g){
  const T = g.target, list = [], add = mk(list);
  const cb = curBranch(s);

  if(g.kind === "tracking") return [];   // origin/* 은 fetch/push 로만 움직인다

  if(g.kind === "tag"){
    const N = g.name;
    if(s.tags[N] === T) return [];
    add(`git tag -f ${N} ${shortOf(T)}`,
        "태그를 다른 커밋으로 옮깁니다. 이미 배포에 쓰인 태그를 옮기면 남의 체크아웃이 조용히 달라집니다.",
        "태그", x => OPS.tag(x, N, T, true));
    add(`git tag ${nextTagName(s)} ${shortOf(T)}`,
        "원래 태그는 그대로 두고 새 태그를 하나 더 붙입니다. 보통 이쪽이 맞습니다.",
        "태그", x => OPS.tag(x, nextTagName(s), T));
    return list;
  }

  if(g.kind === "ref"){
    const B = g.name;
    if(s.refs[B] === T) return [];
    const targetBranches = refsAt(s, T).filter(n => n !== B);
    const ff = isAncestor(s, s.refs[B], T);

    if(B === cb){
      add(`git reset --hard ${shortOf(T)}`,
          ff ? "현재 브랜치를 앞으로 이동. 작업 트리도 그 시점으로 맞춥니다."
             : "현재 브랜치를 뒤로 이동. 지나친 커밋은 ref 로는 안 보이게 됩니다 (reflog 엔 남습니다).",
          "포인터", x => OPS.resetHard(x, T));
      if(ff && targetBranches.length){
        add(`git merge ${targetBranches[0]}`,
            "가는 길이 일직선이라 새 커밋 없이 포인터만 따라갑니다 — fast-forward.",
            "병합", x => OPS.merge(x, targetBranches[0]));
        add(`git merge --no-ff ${targetBranches[0]}`,
            "일직선이어도 병합 커밋을 남깁니다. 언제 무엇이 합쳐졌는지 기록을 남기고 싶을 때.",
            "병합", x => OPS.merge(x, targetBranches[0], {noff:true}));
      }
    }
    add(`git branch -f ${B} ${shortOf(T)}`,
        B === cb ? "포인터만 옮깁니다. 작업 트리는 건드리지 않아요 (현재 브랜치엔 보통 거부됨)."
                 : "다른 브랜치 포인터를 강제로 옮깁니다. 커밋은 하나도 안 만듭니다.",
        "포인터", x => OPS.branchForce(x, B, T));
    add(`git checkout ${shortOf(T)}`,
        "브랜치는 제자리에 두고 보는 위치만 옮깁니다 — detached HEAD.",
        "이동", x => OPS.checkout(x, T));
    return list;
  }

  if(g.kind === "head"){
    if(headCommit(s) === T) return [];
    const names = refsAt(s, T);
    if(names.length) add(`git checkout ${names[0]}`,
        `'${names[0]}' 브랜치에 올라탑니다. 여기서 커밋하면 브랜치가 같이 따라옵니다.`,
        "이동", x => OPS.checkout(x, names[0]));
    add(`git checkout ${shortOf(T)}`,
        "커밋을 직접 가리킵니다. 브랜치에 안 붙어 있으니 여기서 만든 커밋은 미아가 됩니다.",
        "이동", x => OPS.checkout(x, T));
    return list;
  }

  // kind === "commit"
  const C = g.name;
  if(C === T) return [];
  const B = owningBranch(s, C);
  const parent = s.commits[C].parents[0];

  // 자기 부모 위에 떨어뜨렸다 = 두 커밋을 하나로 합치겠다는 뜻
  if(parent === T && B){
    add(`git rebase -i ${shortOf(s.commits[T].parents[0] || T)}   # ${shortOf(C)} → squash`,
        `${shortOf(C)} 를 부모 ${shortOf(T)} 에 흡수시켜 커밋 하나로 만듭니다. 메시지는 둘 다 남습니다.`,
        "재작성", x => OPS.squash(x, C));
    add(`git rebase -i ${shortOf(s.commits[T].parents[0] || T)}   # ${shortOf(C)} → fixup`,
        "같은 합치기인데 이쪽은 메시지를 버립니다. '오타 수정' 같은 커밋을 앞 커밋에 밀어넣을 때.",
        "재작성", x => OPS.squash(x, C, true));
    return list;
  }

  const targetBranches = refsAt(s, T);
  const D = targetBranches[0];
  const isTip = B && s.refs[B] === C;
  const pre = D && D !== cb ? `git checkout ${D} && ` : "";

  if(isTip && D && D !== B){
    const wouldFF = isAncestor(s, s.refs[D], C);
    const cw = warnConflict(s, s.refs[D], C);
    add(`git checkout ${D} && git merge ${B}`,
        (wouldFF ? "" : cw) + (wouldFF
          ? `${D} 가 ${B} 의 조상이라 새 커밋 없이 포인터만 따라갑니다 — fast-forward.`
          : `${B}의 작업을 ${D}에 합칩니다. 부모가 둘인 병합 커밋이 생기고, 양쪽 히스토리는 원래 모양 그대로 남습니다.`),
        "병합", x => { OPS.checkout(x, D); return OPS.merge(x, B); });
    if(wouldFF){
      add(`git checkout ${D} && git merge --no-ff ${B}`,
          "fast-forward 가 가능해도 병합 커밋을 만듭니다. 브랜치가 있었다는 사실이 히스토리에 남습니다.",
          "병합", x => { OPS.checkout(x, D); return OPS.merge(x, B, {noff:true}); });
    }
    add(`git checkout ${B} && git rebase ${D}`,
        cw + `${B}의 커밋들을 ${D} 끝으로 옮겨 다시 씁니다. 히스토리는 일직선이 되지만 커밋 해시가 전부 바뀝니다.`,
        "재작성", x => { OPS.checkout(x, B); return OPS.replay(x, B, s.refs[D], s.refs[D]); });
    add(`git checkout ${D} && git merge --squash ${B}`,
        `${B} 의 변경을 커밋 하나로 눌러 담습니다. ${D} 는 ${B} 과 이어지지 않아서, 나중에 또 머지하면 같은 변경이 두 번 들어옵니다.`,
        "병합", x => { OPS.checkout(x, D); return OPS.merge(x, B, {squash:true}); });
  }

  if(B && parent){
    add(`git rebase --onto ${shortOf(T)} ${shortOf(parent)} ${B}`,
        `${shortOf(C)}부터 ${B} 끝까지를 통째로 ${shortOf(T)} 위에 새로 얹습니다. 베이스만 갈아끼우는 방법.`,
        "재작성", x => OPS.replay(x, B, T, parent));
  }

  add(`${pre}git cherry-pick ${shortOf(C)}`,
      warnConflict(s, C, T) + "그 커밋 하나만 복사해서 여기 위에 올립니다. 원본은 제자리에 그대로.",
      "복사", x => { if(D && D !== curBranch(x)) OPS.checkout(x, D); else if(!D) OPS.checkout(x, T); return OPS.cherryPick(x, C); });

  return list;
}

/* ---------- 우클릭: 커밋 ---------- */

function commitMenu(s, C){
  const list = [], add = mk(list);
  const cb = curBranch(s);
  const B = owningBranch(s, C);
  const parent = s.commits[C].parents[0];

  // 고아 커밋 — 살려내는 쪽만 보여준다
  if(orphanSet(s).has(C)){
    const heads = s.reflog.filter(e => !e.ref);
    const n = heads.findIndex(e => e.to === C);
    if(n >= 0) add(`git reset --hard HEAD@{${n}}`,
        `reflog 의 ${n}칸 전 자리로 현재 브랜치를 되돌립니다 — "${heads[n].cmd}" 직후 상태.`,
        "복구", x => OPS.resetHard(x, C, `HEAD@{${n}}`));
    const owner = s.reflog.find(e => e.ref && e.to === C);
    if(n < 0 && owner) add(`git reset --hard ${shortOf(C)}`,
        `${owner.ref} 가 "${owner.cmd}" 전에 가리키던 자리입니다. 현재 브랜치를 거기로 되돌립니다.`,
        "복구", x => OPS.resetHard(x, C, `${owner.ref} 의 이전 자리`));
    add(`git branch rescue-${shortOf(C)} ${shortOf(C)}`,
        "지금 자리는 그대로 두고, 그 커밋에 이름표를 붙여 되살립니다. 가장 안전한 복구.",
        "복구", x => OPS.createBranch(x, "rescue-" + shortOf(C), C));
    add(`git checkout ${shortOf(C)}`,
        "일단 가서 보기만 합니다. detached HEAD — 마음에 들면 거기서 브랜치를 만드세요.",
        "이동", x => OPS.checkout(x, C));
    return list;
  }

  if(headCommit(s) === C){
    add(`git commit --amend`,
        "마지막 커밋을 고칩니다. 실제로는 새 해시로 다시 쓰는 것 — 원래 커밋은 고아가 되어 흐리게 남습니다.",
        "재작성", x => OPS.amend(x));
    add(`git commit --amend -m "..."`,
        "메시지만 바꿉니다. 이것도 새 커밋입니다. 이미 push 했다면 --force-with-lease 가 필요해집니다.",
        "재작성", x => OPS.amend(x, s.commits[C].msg + " (수정)"));
  }
  if(cb && s.refs[cb] === C && parent){
    add(`git reset --hard HEAD~1`,
        "마지막 커밋을 통째로 버립니다. ref 에서는 사라지지만 reflog 에는 남아 있습니다.",
        "폐기", x => OPS.resetHard(x, parent));
  }
  add(`git revert ${shortOf(C)}`,
      "그 커밋을 취소하는 새 커밋을 쌓습니다. 히스토리를 안 건드려서 공유 브랜치에 안전한 쪽.",
      "역커밋", x => OPS.revert(x, C));
  if(parent && B){
    add(`git rebase -i ${shortOf(parent)}   # ${shortOf(C)} → reword`,
        "메시지만 바꿔 다시 씁니다. 이 커밋과 그 뒤 커밋들의 해시가 전부 새로 붙습니다.",
        "재작성", x => OPS.reword(x, C, s.commits[C].msg + " (설명 보강)"));
  }
  if(B && parent && s.refs[B] !== C){
    add(`git rebase --onto ${shortOf(parent)} ${shortOf(C)} ${B}`,
        "이 커밋만 빼고 뒤 커밋들을 다시 씁니다 — rebase -i 에서 drop 과 같은 효과.",
        "재작성", x => OPS.replay(x, B, parent, C));
  }
  add(`git tag ${nextTagName(s)} ${shortOf(C)}`,
      "이 커밋에 이름을 박아둡니다. 브랜치와 달리 커밋을 따라 움직이지 않습니다.",
      "태그", x => OPS.tag(x, nextTagName(s), C));
  return list;
}

/* ---------- 우클릭: 브랜치 이름표 ---------- */

function branchMenu(s, B){
  const list = [], add = mk(list);
  const local = s.refs[B], server = s.remote[B], track = s.tracking[B];

  if(B !== curBranch(s)){
    add(`git switch ${B}`,
        `${B} 에 올라탑니다. 여기서 커밋하면 ${B} 가 따라 움직입니다.`,
        "이동", x => OPS.checkout(x, B));
    add(`git checkout ${B}`,
        "같은 일을 하는 옛날 명령. checkout 은 파일 복원까지 겸해서 헷갈리는 탓에 switch 가 따로 생겼습니다.",
        "이동", x => OPS.checkout(x, B));
  }
  const known = server !== undefined;
  const ff = !known || isAncestor(s, server, local);
  const behind = track !== undefined && !isAncestor(s, track, local);

  if(!known || local !== server){
    add(`git push origin ${B}`,
        !known ? "origin 에 없는 브랜치를 새로 올립니다."
        : ff   ? "내 커밋을 origin 에 얹습니다. 서버 히스토리는 그대로 이어집니다."
               : "거부됩니다 — 내 히스토리가 origin 을 포함하지 않아서. 왜 그런지 콘솔에서 보세요.",
        "원격", x => OPS.push(x, B));
    if(known && !ff){
      add(`git push --force-with-lease origin ${B}`,
          "내가 마지막으로 본 origin 과 서버가 같을 때만 덮어씁니다. 되쓰기 후 올리는 정석.",
          "원격", x => OPS.push(x, B, "lease"));
      add(`git push --force origin ${B}`,
          "묻지도 따지지도 않고 덮어씁니다. 그 사이 남이 올린 커밋은 origin 에서 사라집니다.",
          "원격", x => OPS.push(x, B, "force"));
    }
  }
  add(`git fetch origin`,
      "origin 이 지금 뭘 갖고 있는지만 받아옵니다. origin/* 칩만 움직이고 내 브랜치는 그대로.",
      "원격", x => OPS.fetch(x));
  if(known){
    add(`git pull`,
        behind ? "fetch 한 뒤 origin 것을 내 브랜치에 병합합니다. 갈라져 있으면 병합 커밋이 생깁니다."
               : "fetch + merge. 지금은 받을 게 없을 수도 있습니다.",
        "원격", x => OPS.pull(x, B));
    add(`git pull --rebase`,
        "fetch 한 뒤 내 커밋을 origin 것 위로 다시 씁니다. 병합 커밋 없이 일직선.",
        "원격", x => OPS.pull(x, B, true));
  }
  add(`git tag ${nextTagName(s)} ${B}`,
      "지금 이 브랜치 끝에 태그를 붙입니다.",
      "태그", x => OPS.tag(x, nextTagName(s), local));
  if(B !== curBranch(s)){
    add(`git branch -D ${B}`,
        "이름표만 지웁니다. 커밋은 남아서 고아가 되고, reflog 로 되살릴 수 있습니다.",
        "폐기", x => OPS.deleteBranch(x, B));
  }
  return list;
}

/* ---------- 우클릭: 태그 / origin 칩 ---------- */

function tagMenu(s, N){
  const list = [], add = mk(list);
  add(`git tag -d ${N}`, "태그를 지웁니다. 커밋은 그대로 남습니다.", "태그", x => OPS.tagDelete(x, N));
  add(`git checkout ${N}`, "태그가 가리키는 커밋으로 갑니다 — detached HEAD.", "이동", x => OPS.checkout(x, s.tags[N]));
  return list;
}

function trackingMenu(s, B){
  const list = [], add = mk(list);
  add(`git fetch origin`, "origin 의 현재 상태를 다시 받아옵니다. 이 칩이 움직이는지 보세요.", "원격", x => OPS.fetch(x));
  if(s.refs[B] !== undefined){
    add(`git merge origin/${B}`, "받아둔 origin 것을 내 브랜치에 합칩니다. pull 의 뒷부분.", "병합",
        x => { if(curBranch(x) !== B) OPS.checkout(x, B); return OPS.merge(x, "origin/" + B, {at: x.tracking[B]}); });
    add(`git reset --hard origin/${B}`, "내 브랜치를 origin 과 똑같이 만듭니다. 내 로컬 커밋은 고아가 됩니다.", "폐기",
        x => { if(curBranch(x) !== B) OPS.checkout(x, B); return OPS.resetHard(x, s.tracking[B]); });
  }
  return list;
}
