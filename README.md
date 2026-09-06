# 손으로 그리는 Git

git 커밋 그래프를 마우스로 끌면, **그 일을 하는 명령어 후보를 되묻고** 고른 명령을 콘솔에 찍어주는 학습용 놀이터.

> [Learn Git Branching](https://learngitbranching.js.org) 이 `명령어 → 트리` 방향이라면, 이건 그 반대 방향이다.
> 트리를 보고 명령을 추론하지 않는다 — **제스처 자체가 명령어 후보 테이블의 키**다.

## 무엇을 배울 수 있나

각 후보에 마우스를 올리면 캔버스가 **그 명령을 골랐을 때의 결과**로 바뀐다 (새로 생기는 커밋은 주황 점선).
`merge` 와 `rebase` 를 나란히 미리 보면 "리베이스는 옮기는 게 아니라 새로 쓰는 것"이 눈에 보인다.

| 제스처 | 물어보는 것 |
|---|---|
| 브랜치 이름표 → 커밋 | `reset --hard` / `branch -f` / `checkout`(detached) |
| 커밋 → 다른 브랜치 끝 | `merge` / `--no-ff` / `--squash` / `rebase` |
| 커밋 → 자기 부모 | `rebase -i` 의 squash / fixup |
| 중간 커밋 → 다른 커밋 | `rebase --onto` / `cherry-pick` |
| HEAD, 태그 끌기 | detached HEAD / `tag -f` vs 새 태그 |
| 브랜치 칩 클릭·우클릭 | `switch` vs `checkout`, `push` / `--force-with-lease` / `pull` / `--rebase` |
| `origin/…` 칩 | `fetch` / `merge origin/x` / `reset --hard origin/x` |
| 커밋 우클릭 | `amend` / `revert` / `reset` / reword / drop / `tag` |
| 흐린(고아) 커밋 우클릭 | `reset --hard HEAD@{n}` / `branch <이름> <해시>` — reflog 복구 |

칩과 커밋은 **끌지 않고 그냥 눌러도** 같은 메뉴가 열린다 (터치 기기엔 우클릭이 없으니까).
팝오버는 캔버스를 덮지 않는 자리에 붙고, 목록은 명령어 한 줄씩·설명은 아래 고정 칸에 현재 항목만 — `↑↓` 로도 넘길 수 있다.

## 과제 모드

오른쪽 위 드롭다운에서 과제 7개를 고를 수 있다. 목표를 주고, 달성 여부는 **state 술어 하나로** 판정한다 —
진행 상태를 따로 안 들고 있어서 `되돌리기`로 오가도 판정이 저절로 맞다.

| | 배우는 것 |
|---|---|
| 1 새 커밋 없이 합치기 | fast-forward — `--no-ff` 로는 통과 못 한다 |
| 2 히스토리를 일직선으로 | `merge` 로는 통과 못 한다. `rebase` 여야 한다 |
| 3 지저분한 커밋 정리 | `rebase -i` squash / fixup |
| 4 날아간 커밋 되살리기 | reflog — 고아 커밋은 사라진 게 아니다 |
| 5 남의 커밋 안 지우고 강제 push | `--force` 로는 통과 못 한다. fetch → rebase → push |
| 6 병합 커밋 없이 따라잡기 | `pull` vs `pull --rebase` |
| 7 충돌 만나고 취소하기 | 충돌 중에는 **아직 아무것도 안 바뀌었다**는 것 |

## 충돌

커밋마다 "건드린 파일"을 하나씩 달아두고, 공통 조상 이후 양쪽이 같은 파일을 건드렸으면 충돌로 본다.
진짜 3-way merge 는 없지만 `merge` / `rebase` / `cherry-pick` 이 멈추고, `--continue` 와 `--abort` 가 갈린다.

커밋에는 `patch` 도 달려 있다 — git 의 patch-id 와 같은 역할이라, rebase·amend·cherry-pick 으로
**해시가 바뀌어도 같은 변경**임을 알아본다. 이게 없으면 이미 반영된 변경을 충돌로 오인한다.

충돌은 **고르기 전에 후보 설명에 ⚠ 로 예고된다.** 놀라는 것보다 예고되는 편이 배우기 쉬우니까.

원격은 **서버의 진짜 값(`remote`)** 과 **내 `origin/x` 캐시(`tracking`)** 를 따로 들고 있다.
둘이 어긋날 수 있다는 게 원격 파트의 학습 지점이고, `--force-with-lease` 는 정의상 둘이 같을 때만 통과한다.
툴바의 `동료가 push` 를 누르면 origin 만 앞서간다 — `fetch` 전엔 그래프에 안 보인다.

## 실행

```sh
open index.html          # 빌드 없음, 의존성 없음
```

퍼블리시용 단일 파일이 필요하면:

```sh
python build.py          # index.html + style.css + src/*.js → dist.html
```

## 구조

```
index.html        마크업만
style.css
src/model.js      state + OPS — 전부 (state) => state 인 순수 함수
src/layout.js     레인 배치
src/render.js     SVG + 콘솔
src/commands.js   제스처 → 명령어 후보 테이블   ← 명령어를 늘릴 땐 여기
src/scenarios.js  과제 — 시작 상태 + 달성 판정
src/main.js       드래그·팝오버·툴바
src/selfcheck.js  assert — 깨지면 브라우저 콘솔에 뜬다
build.py          <link>/<script src> 인라인
```

state 는 커밋 풀 하나에 ref 네 종류(`refs` 브랜치 / `tags` / `tracking` / `remote`) + `head` + `reflog` + `log` + `conflict`.
미리보기·실행·undo 가 전부 같은 `act(state) => state` 함수 하나에서 나온다.

## 다루지 않는 것

staging area 와 working directory 가 없다. 그래서 `reset --soft` 와 `--mixed` 의 구분, `stash`, `restore` 는 없다.
충돌도 "어느 파일에서 겹치나"까지만 본다 — 줄 단위 해결은 그래프에 안 보이는 일이라 뺐다.
그래프에 안 보이는 것은 이 도구가 가르칠 수 없는 것이라는 게 원칙.
