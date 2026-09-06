"use strict";

/* ---- self-check: 핵심 로직이 깨지면 브라우저 콘솔에 뜬다 ---- */
(function selfCheck(){
  const ok = (c, m) => console.assert(c, m);
  const n  = s => Object.keys(s.commits).length;
  try{
    const s = initialState();
    const MAIN = s.refs.main, FEAT = s.refs.feature;
    ok(n(s) === 5, "seed commits");
    ok(liveSet(s).size === 5, "seed 는 전부 ref 로 닿는다");

    // merge: 갈라진 두 브랜치 → 부모 2개짜리 커밋
    const m = OPS.merge(clone(s), "feature");
    ok(m.commits[m.refs.main].parents.length === 2, "merge creates 2-parent commit");
    ok(n(m) === 6, "merge adds exactly one commit");

    // 조상 머지는 no-op
    const up = clone(s); up.refs.feature = s.commits[FEAT].parents[0];
    up.refs.main = up.refs.feature;
    ok(n(OPS.merge(up, "feature")) === n(up), "ancestor merge is a no-op");

    // fast-forward vs --no-ff
    const ff = clone(s); ff.refs.main = s.commits[MAIN].parents[0];   // main 이 feature 의 조상
    const ff1 = OPS.merge(clone(ff), "feature");
    ok(n(ff1) === n(ff) && ff1.refs.main === FEAT, "fast-forward 는 커밋을 안 만든다");
    const ff2 = OPS.merge(clone(ff), "feature", {noff:true});
    ok(n(ff2) === n(ff) + 1 && ff2.commits[ff2.refs.main].parents.length === 2, "--no-ff 는 병합 커밋을 만든다");
    const sq = OPS.merge(clone(ff), "feature", {squash:true});
    ok(sq.commits[sq.refs.main].parents.length === 1, "--squash 는 부모가 하나");

    // rebase: 커밋이 복제되고 원본은 ref 에서 떨어져 나간다
    const r = clone(s); OPS.checkout(r, "feature"); OPS.replay(r, "feature", MAIN, MAIN);
    ok(n(r) === 7, "rebase copies 2 commits");
    ok(ancestors(r, r.refs.feature).has(MAIN), "rebased feature sits on main");
    ok(!liveSet(r).has(FEAT), "원본 feature tip 은 어떤 ref 로도 안 닿는다");

    // reflog 가 있으면 그 원본은 고아로 화면에 남는다 (없으면 사라진다)
    ok(!layout(r).visible.includes(FEAT), "reflog 없으면 원본은 그래프에서 사라진다");
    const rl = clone(r); rl.reflog.unshift({ to: FEAT, cmd: "rebase", ref: "feature" });
    ok(layout(rl).visible.includes(FEAT) && layout(rl).orphan.has(FEAT), "reflog 로 닿으면 고아로 남는다");

    // amend / squash / reword — 전부 해시를 새로 쓴다
    const am = OPS.amend(clone(s), "고친 메시지");
    ok(n(am) === 6 && am.refs.main !== MAIN, "amend 는 새 커밋을 만든다");
    ok(am.commits[am.refs.main].parents[0] === s.commits[MAIN].parents[0], "amend 는 부모를 유지한다");
    ok(!Object.values(am.refs).includes(MAIN), "amend 원본은 로컬 브랜치에서 떨어진다");
    ok(am.tracking.main === MAIN, "origin/main 은 아직 원본을 가리킨다 — 그래서 force push 가 필요해진다");

    const sqz = clone(s); OPS.checkout(sqz, "feature"); OPS.squash(sqz, FEAT);
    ok(ancestors(sqz, sqz.refs.feature).size === ancestors(s, FEAT).size - 1, "squash 로 커밋 하나가 줄어든다");

    const rw = clone(s); OPS.reword(rw, s.commits[FEAT].parents[0], "새 메시지");
    ok(rw.refs.feature !== FEAT, "reword 는 뒤 커밋 해시까지 바꾼다");
    ok(ancestors(rw, rw.refs.feature).size === ancestors(s, FEAT).size, "reword 는 커밋 개수를 안 바꾼다");

    // 브랜치 갈아타기가 메뉴에 있다 (현재 브랜치엔 없다)
    ok(branchMenu(s, "feature").some(c => c.cmd === "git switch feature"), "다른 브랜치는 갈아탈 수 있다");
    ok(!branchMenu(s, "main").some(c => c.cmd.startsWith("git switch")), "이미 올라탄 브랜치엔 안 나온다");
    ok(candidates(s, {kind:"tracking", name:"main", target:FEAT}).length === 0, "origin/* 드래그는 무의미");

    // 태그는 커밋을 따라 안 움직인다
    const tg = OPS.commit(clone(s), "새 커밋");
    ok(tg.tags["v0.1"] === s.tags["v0.1"], "태그는 제자리");

    // 원격: fetch 전엔 동료 커밋이 안 보인다
    const mate = OPS.matePush(clone(s), "main");
    ok(!liveSet(mate).has(mate.remote.main), "fetch 전엔 origin 커밋이 안 보인다");
    const fetched = OPS.fetch(clone(mate));
    ok(liveSet(fetched).has(fetched.remote.main), "fetch 하면 보인다");
    ok(fetched.refs.main === MAIN, "fetch 는 내 브랜치를 안 옮긴다");

    // push: ff 는 통과, 되쓴 뒤엔 거부, stale 이면 lease 가 막는다
    const p1 = OPS.push(OPS.commit(clone(s), "새 커밋"), "main");
    ok(p1.remote.main === p1.refs.main && p1.tracking.main === p1.refs.main, "ff push 는 통과");
    const p2 = OPS.push(OPS.amend(clone(p1)), "main");
    ok(p2.remote.main === p1.remote.main, "되쓴 히스토리의 push 는 거부된다");
    const p3 = OPS.push(OPS.matePush(OPS.amend(clone(p1)), "main"), "main", "lease");
    ok(p3.remote.main !== p3.refs.main && p3.tracking.main !== p3.remote.main,
       "tracking 이 stale 이면 --force-with-lease 는 origin 을 안 건드린다");
    const p4 = OPS.push(OPS.amend(clone(p1)), "main", "force");
    ok(p4.remote.main === p4.refs.main, "--force 는 덮어쓴다");

    // pull --rebase 는 병합 커밋을 안 만든다
    const pr = OPS.pull(OPS.commit(OPS.matePush(clone(s), "main"), "내 커밋"), "main", true);
    ok(pr.commits[pr.refs.main].parents.length === 1, "pull --rebase 는 병합 커밋 없음");
    const pm = OPS.pull(OPS.commit(OPS.matePush(clone(s), "main"), "내 커밋"), "main");
    ok(pm.commits[pm.refs.main].parents.length === 2, "pull 은 병합 커밋을 만든다");
    const pb = OPS.pull(OPS.matePush(clone(s), "main"), "main", true);
    ok(pb.refs.main === pb.tracking.main && n(pb) === n(s) + 1, "뒤처지기만 했으면 pull 은 fast-forward");

    /* ---- 충돌 ---- */
    const cf = () => {
      const c = initialState();
      OPS.checkout(c, "feature"); OPS.commit(c, "A", ["api.js"]);
      OPS.checkout(c, "main");    OPS.commit(c, "B", ["api.js"]);
      return c;
    };
    ok(conflictFiles(s, MAIN, FEAT).length === 0, "시드는 서로 다른 파일이라 충돌 없음");
    const cx = OPS.merge(clone(cf()), "feature");
    ok(cx.conflict && cx.conflict.files.join() === "api.js", "같은 파일이면 merge 가 멈춘다");
    ok(n(cx) === n(cf()), "충돌 중엔 그래프가 안 바뀐다 — abort 가 공짜인 이유");
    const cAbort = OPS.abortConflict(clone(cx));
    ok(!cAbort.conflict && n(cAbort) === n(cx), "abort 는 표시만 지운다");
    const cDone = OPS.resolveConflict(clone(cx));
    ok(!cDone.conflict && cDone.commits[cDone.refs.main].parents.length === 2, "해결하면 병합 커밋이 생긴다");

    // patch — 다시 쓴 커밋과 원본은 같은 변경이다
    const cp = clone(s);
    OPS.commit(cp, "핫픽스", ["api.js"]);
    const fix = cp.refs.main;
    OPS.checkout(cp, "feature"); OPS.cherryPick(cp, fix);
    ok(cp.commits[cp.refs.feature].patch === cp.commits[fix].patch, "cherry-pick 은 patch 를 물려받는다");
    ok(conflictFiles(cp, fix, cp.refs.feature).length === 0, "이미 반영된 변경은 충돌이 아니다");

    /* ---- 과제 ---- */
    const solve = {
      ff:      q => OPS.merge(clone(q.state), "feature"),
      rebase:  q => { const y = clone(q.state); OPS.checkout(y,"feature");
                      return OPS.replay(y,"feature",q.state.refs.main,q.state.refs.main); },
      squash:  q => OPS.squash(clone(q.state), q.state.refs.feature),
      reflog:  q => OPS.createBranch(clone(q.state), "rescue", [...orphanSet(q.state)][0]),
      lease:   q => OPS.push(OPS.pull(clone(q.state), "main", true), "main"),
      pull:    q => OPS.push(OPS.pull(clone(q.state), "main", true), "main"),
      conflict:q => OPS.abortConflict(OPS.merge(clone(q.state), "feature"))
    };
    ok(SCENARIOS.length === Object.keys(solve).length, "과제가 전부 검사된다");
    for(const sc of SCENARIOS){
      const q = sc.make();
      ok(!q.done(q.state), `과제 ${sc.id}: 시작은 미달성`);
      ok(q.done(solve[sc.id](q)), `과제 ${sc.id}: 의도한 풀이로 달성`);
    }
    // 솔깃한 오답으로는 안 풀린다
    const wrong = [
      ["ff",     q => OPS.merge(clone(q.state), "feature", {noff:true})],
      ["rebase", q => OPS.merge(clone(q.state), "feature")],
      ["lease",  q => OPS.push(clone(q.state), "main", "force")],
      ["pull",   q => OPS.push(OPS.pull(clone(q.state), "main"), "main")]
    ];
    for(const [id, f] of wrong){
      const q = SCENARIOS.find(x => x.id === id).make();
      ok(!q.done(f(q)), `과제 ${id}: 오답 경로로는 안 풀린다`);
    }
  }catch(err){ console.error("self-check 실패:", err); }
})();
