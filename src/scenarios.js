"use strict";

/* ============================================================
   과제 — 시작 상태를 만들어주고, 달성 여부를 state 술어로 판정한다.
   진행 상태를 따로 안 들고 있어서 undo 를 해도 판정이 저절로 맞다.
   ============================================================ */

const noMergeCommit = s => Object.values(s.commits).every(c => c.parents.length < 2);

const SCENARIOS = [
  {
    id: "ff", title: "1 · 새 커밋 없이 합치기",
    make(){
      const s = initialState();
      s.refs.main = s.commits[s.refs.main].parents[0];      // main 을 feature 의 조상 자리로
      s.tracking.main = s.remote.main = s.refs.main;
      s.reflog = [{ to: s.refs.main, cmd: "clone: from origin", ref: null }];
      s.log = [];
      const target = s.refs.feature, n = Object.keys(s.commits).length;
      return {
        brief: "main 과 feature 사이에 갈라진 데가 없습니다. main 이 feature 의 조상이에요.",
        goal: "커밋을 하나도 만들지 않고 main 을 feature 끝까지 데려가기",
        hint: "feature 끝 커밋을 main 위로 끌어보세요. 새 커밋이 생기는 후보와 안 생기는 후보가 같이 나옵니다 — 미리보기로 어느 쪽인지 확인하세요.",
        state: s,
        done: x => x.refs.main === target && Object.keys(x.commits).length === n
      };
    }
  },
  {
    id: "rebase", title: "2 · 히스토리를 일직선으로",
    make(){
      const s = initialState(); s.log = [];
      const mainTip = s.refs.main;
      return {
        brief: "main 과 feature 가 갈라져 있습니다. 합치는 방법은 하나가 아니에요.",
        goal: "병합 커밋을 만들지 말고, feature 의 커밋들이 main 끝 위에 오게 하기",
        hint: "feature 끝 커밋을 main 끝으로 끌면 merge 와 rebase 가 같이 나옵니다. 두 후보에 번갈아 마우스를 올려서 그래프가 어떻게 달라지는지 비교해 보세요.",
        state: s,
        done: x => x.refs.main === mainTip && noMergeCommit(x) && isAncestor(x, mainTip, x.refs.feature)
      };
    }
  },
  {
    id: "squash", title: "3 · 지저분한 커밋 정리",
    make(){
      const s = initialState();
      OPS.checkout(s, "feature");
      OPS.commit(s, "오타 수정");
      s.log = [];
      const n = ancestors(s, s.refs.feature).size, mainTip = s.refs.main;
      return {
        brief: "feature 끝에 '오타 수정' 커밋이 붙어 있습니다. 원래 앞 커밋에 섞여 들어갔어야 할 것.",
        goal: "feature 의 커밋 개수를 하나 줄이기",
        hint: "'오타 수정' 커밋을 바로 앞 커밋(자기 부모) 위로 끌어보세요. squash 와 fixup 이 나옵니다 — 차이는 메시지를 남기느냐뿐입니다.",
        state: s,
        done: x => x.refs.main === mainTip && ancestors(x, x.refs.feature).size === n - 1
      };
    }
  },
  {
    id: "reflog", title: "4 · 날아간 커밋 되살리기",
    make(){
      const s = initialState();
      OPS.checkout(s, "feature");
      const lost = s.refs.feature;
      s.reflog.unshift({ to: lost, cmd: 'commit -m "비밀번호 검증"', ref: "feature" });
      s.reflog.unshift({ to: lost, cmd: "checkout feature", ref: null });
      OPS.resetHard(s, s.commits[lost].parents[0]);
      s.reflog.unshift({ to: s.refs.feature, cmd: "reset --hard HEAD~1", ref: "feature" });
      s.reflog.unshift({ to: s.refs.feature, cmd: "reset --hard HEAD~1", ref: null });
      s.log = [];
      return {
        brief: `reset --hard 로 커밋 ${shortOf(lost)} 를 날려버렸습니다. 그래프에 흐리게 남아 있죠.`,
        goal: "그 커밋을 다시 어떤 ref 로든 닿게 만들기",
        hint: "흐린 커밋을 눌러보세요. reflog 의 그 자리로 되돌리거나, 아예 새 브랜치 이름표를 붙여줄 수 있습니다. 툴바의 git reflog 도 눌러보세요.",
        state: s,
        done: x => liveSet(x).has(lost)
      };
    }
  },
  {
    id: "lease", title: "5 · 남의 커밋 안 지우고 강제 push",
    make(){
      const s = initialState();
      OPS.commit(s, "로그 추가");
      OPS.push(s, "main");
      OPS.amend(s, "로그 추가 (메시지 다듬음)");
      OPS.matePush(s, "main");
      const mate = s.remote.main;
      s.log = [];
      return {
        brief: "이미 push 한 커밋을 amend 로 다시 썼습니다. 그 사이 동료도 origin 에 뭔가 올렸고요.",
        goal: "내 커밋을 origin 에 올리되, 동료가 올린 커밋을 origin 에서 지우지 않기",
        hint: "--force 로 그냥 밀면 동료 커밋이 사라집니다. --force-with-lease 는 그걸 막아주고요. 먼저 fetch 해서 뭐가 올라왔는지 보고, 그 위로 다시 쓴 다음 올리세요.",
        state: s,
        done: x => x.remote.main === x.refs.main && ancestors(x, x.remote.main).has(mate)
      };
    }
  },
  {
    id: "pull", title: "6 · 병합 커밋 없이 따라잡기",
    make(){
      const s = initialState();
      OPS.matePush(s, "main");
      OPS.commit(s, "내 작업");
      s.log = [];
      return {
        brief: "내 커밋이 하나, origin 에도 동료 커밋이 하나. 아직 fetch 도 안 했습니다.",
        goal: "병합 커밋 없이 양쪽을 합치고 origin 에 올리기",
        hint: "브랜치 이름표를 눌러 pull 과 pull --rebase 를 비교해 보세요. 미리보기에서 병합 커밋이 생기는지 아닌지가 그대로 보입니다.",
        state: s,
        done: x => noMergeCommit(x) && x.remote.main === x.refs.main
      };
    }
  },
  {
    id: "conflict", title: "7 · 충돌 만나고 취소하기",
    make(){
      const s = initialState();
      OPS.checkout(s, "feature");
      OPS.commit(s, "로그인 에러 문구", ["auth.js"]);
      OPS.checkout(s, "main");
      OPS.commit(s, "로그인 검증 정리", ["auth.js"]);   // 양쪽이 같은 파일
      s.log = [];
      const n = Object.keys(s.commits).length;
      return {
        brief: "main 과 feature 가 둘 다 auth.js 를 건드렸습니다. 합치면 충돌이 납니다.",
        goal: "충돌을 한 번 내보고, 그래프를 바꾸지 않은 채 취소해서 원래대로 되돌리기",
        hint: "후보 설명에 ⚠ 가 붙은 걸 골라보세요. 멈춘 뒤 --abort 를 누르면 그래프가 그대로인 게 보입니다. 충돌 중에는 아직 아무것도 바뀌지 않은 상태거든요.",
        state: s,
        done: x => !x.conflict && x.log.some(l => l.t.startsWith("CONFLICT"))
                   && Object.keys(x.commits).length === n
      };
    }
  }
];
