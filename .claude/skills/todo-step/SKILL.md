---
name: todo-step
description: BASAK WITCH 주문 웹앱에서 docs/TODO.md의 다음 항목 하나를 구현하고, 브라우저로 확인하고, TODO와 변경 내역을 갱신한 뒤 커밋·push·배포 확인까지 하는 절차. "다음 Todo 진행", "Todo 하나 처리", "todo-step" 같은 요청에 사용한다.
---

# todo-step — Todo 항목 하나를 끝까지 처리하기

한 번에 **Todo 항목 하나만** 처리한다. 여러 항목을 묶어 한 번에 push하지 않는다.

## 1. 항목 고르기
1. `docs/TODO.md`를 읽고, 체크되지 않은 첫 항목(`- [ ]`)을 고른다.
2. 항목이 너무 크면(파일 3개 이상을 크게 바꾸는 정도) 먼저 TODO.md에서 하위 항목으로 쪼개고, 쪼갠 사실을 "변경 내역"에 적는다.

## 2. 구현
- 기존 코드 스타일을 따른다: 즉시 실행 함수 `(function () { 'use strict'; ... })();`, `const $ = selector => document.querySelector(selector);`, 한국어 주석.
- 화면 코드(`customer-supabase.js`, `admin-supabase.js`)는 `window.BoothStore` 인터페이스만 쓴다. 저장소 동작을 바꿀 때는 `supabase-store.js`와 `demo-store.js`를 **같이** 맞춘다.
- DB 구조를 바꾸는 항목이면 `supabase/migrations/`에 SQL을 추가하고, **원격 DB에 먼저 적용(`npx supabase db push`)한 뒤** 프런트엔드를 push한다. 순서를 거꾸로 하면 실제 사이트가 메뉴를 못 불러온다.

## 3. 확인 (실제 주문을 만들지 않는다)
1. 문법 검사: `node --check assets/<바꾼 파일>.js`
2. 로컬 서버: `python3 -m http.server 4173 --bind 127.0.0.1`
3. 브라우저에서 **데모 모드**로 확인한다.
   - 고객: `http://127.0.0.1:4173/?demo`
   - 관리자: `http://127.0.0.1:4173/admin/?demo`
   - 폰 폭(390px, 320px)에서 줄바꿈·겹침이 없는지 본다.
4. 실제 Supabase(데모가 아닌 주소)에는 테스트 주문을 넣지 않는다. 실제 손님 데이터와 매출이 섞인다.

## 4. 기록
1. 바뀐 JS/CSS를 불러오는 `<script>`/`<link>`의 `?v=` 값을 새 날짜시각(예: `202611021530`)으로 올린다. 올리지 않으면 폰 브라우저가 예전 파일을 계속 보여 준다.
2. `docs/TODO.md`에서 항목을 `- [x]`로 바꾸고 커밋 해시를 적는다.
3. 처음 계획과 달라진 점(테스트 후 고친 것, 뺀 것, 새로 넣은 것)이 있으면 "변경 내역" 표에 날짜·내용·이유를 한 줄로 추가한다.

## 5. 커밋과 push
1. 커밋 메시지는 `종류: 무엇을 했는지` 형식으로 **내용이 드러나게** 쓴다. 종류는 `feat`(기능), `fix`(버그), `style`(디자인), `docs`(문서), `chore`(기타).
   - 좋은 예: `feat: 데모 모드에서 관리자 화면을 로그인 없이 열기`
   - 나쁜 예: `update`, `수정`
2. `git push origin main`
3. `gh run watch`로 GitHub Pages 배포가 끝날 때까지 본 뒤, `curl -s https://jeong93920.github.io/yeongwang2026/ | grep "?v="`로 새 버전이 반영됐는지 확인한다.

## 6. 보고
무엇을 했는지, 어떻게 확인했는지, 확인하지 못한 것이 무엇인지 세 줄 이내로 말한다.
