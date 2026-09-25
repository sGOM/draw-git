# CLAUDE.md

git 커밋 그래프를 끌면 해당 명령어 후보를 보여주는 학습용 놀이터. 빌드·의존성 없는 바닐라 JS.
기능과 구조 설명은 [`README.md`](README.md) 에 있다. 여기엔 규칙만 둔다.

## 명령

```bash
# self-check (출력이 없으면 통과, 깨지면 "Assertion failed: ..." )
(echo 'globalThis.window=globalThis;'; cat src/{model,layout,commands,scenarios,selfcheck}.js) | node
python build.py     # 퍼블리시용 단일 파일 dist.html (커밋하지 않는다)
```

브라우저 확인은 `index.html` 을 그대로 연다.

## 지킬 것

- `src/model.js` 의 `OPS` 는 전부 `(state) => state` 순수 함수. DOM 이나 전역 `state` 를 건드리지 않는다.
- 명령어 추가는 `src/commands.js` 후보 테이블에서. 새 OPS 를 넣으면 `src/selfcheck.js` 에 assert 를 같이 넣는다.
- 과제 판정(`src/scenarios.js`)은 **state 술어 하나**로만 한다. 진행 상태를 따로 저장하지 않는다(되돌리기와 어긋난다).
- 리베이스·amend·cherry-pick 이 같은 변경임을 알아보는 근거는 커밋의 `patch` 다. 새 연산도 `patch` 를 보존한다.
- 원격은 `remote`(서버 실제값)와 `tracking`(`origin/x` 캐시)을 따로 둔다. 둘을 합치지 않는다.
- `<script>` 순서(`index.html`)가 곧 의존 순서다. 모듈 번들러를 들이지 않는다.
