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
src/main.js       드래그·팝오버·툴바
src/selfcheck.js  assert — 깨지면 브라우저 콘솔에 뜬다
build.py          <link>/<script src> 인라인
```

state 는 커밋 풀 하나에 ref 네 종류(`refs` 브랜치 / `tags` / `tracking` / `remote`) + `head` + `reflog` + `log`.
미리보기·실행·undo 가 전부 같은 `act(state) => state` 함수 하나에서 나온다.

## 다루지 않는 것

staging area 와 working directory가 없다. 그래서 `reset --soft/--mixed` 구분, `stash`, 충돌 해결은 없다.
그래프에 안 보이는 것은 이 도구가 가르칠 수 없는 것이라 일부러 뺐다.
