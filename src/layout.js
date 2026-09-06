"use strict";

/* ============================================================
   레이아웃 — 레인은 ref 등록 순서, x 는 깊이. 편집해도 자리가 안 튄다.
   고아 커밋(reflog 로만 닿는 것)도 자리를 받는다.
   ============================================================ */

const COL = 116, ROW = 86, X0 = 70, Y0 = 96;

function layout(s){
  const reach = reachSet(s);
  const orphan = orphanSet(s);
  const visible = s.order.filter(id => reach.has(id));

  const depth = {};
  for(const id of visible){
    const ps = s.commits[id].parents.filter(p => reach.has(p));
    depth[id] = ps.length ? Math.max(...ps.map(p => depth[p] ?? 0)) + 1 : 0;
  }

  // 앵커: 브랜치 tip → 추적 ref → 태그 → 고아 사슬의 끝. 각자 첫 부모를 따라 레인을 선점한다
  const hasChild = new Set();
  for(const id of visible) for(const p of s.commits[id].parents) if(reach.has(p)) hasChild.add(p);
  const anchors = [
    ...Object.values(s.refs), ...Object.values(s.tracking), ...Object.values(s.tags),
    ...visible.filter(id => orphan.has(id) && !hasChild.has(id))
  ];

  const lane = {};
  let next = 0;
  for(const a of anchors){
    const claimed = [];
    let cur = a;
    while(cur && reach.has(cur) && lane[cur] === undefined){
      claimed.push(cur);
      cur = s.commits[cur].parents[0];
    }
    if(claimed.length){ for(const c of claimed) lane[c] = next; next++; }
  }
  for(const id of visible) if(lane[id] === undefined) lane[id] = next++;

  // 같은 칸 충돌만 아래로 밀기
  const used = new Set(), pos = {};
  for(const id of visible){
    let l = lane[id];
    while(used.has(depth[id] + ":" + l)) l++;
    used.add(depth[id] + ":" + l);
    pos[id] = { d: depth[id], l, x: X0 + depth[id]*COL, y: Y0 + l*ROW };
  }
  return {
    visible, pos, orphan, laneOf: lane,
    maxD: Math.max(0, ...visible.map(i => pos[i].d)),
    maxL: Math.max(0, ...visible.map(i => pos[i].l))
  };
}
