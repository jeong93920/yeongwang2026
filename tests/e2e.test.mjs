// 데모 모드 브라우저 동작 테스트
// 헤드리스 크롬으로 고객 화면(폰 390px)과 주방 화면(노트북 1440px)을 함께 열고,
// 실제 버튼을 눌러 주문 → 입금 확인 → 조리 → 수령 알림까지 따라가며 확인합니다.
// 실제 Supabase에는 접속하지 않습니다(?demo, 외부 요청 차단).
//
//   npm install && npx playwright install chromium
//   npm test             테스트만 실행
//   npm run screenshots  테스트하면서 docs/screenshots/flow/ 스크린샷도 다시 찍기
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.argv.includes('--shots') ? join(ROOT, 'docs/screenshots/flow') : null;
const M = n => `b0030000-0000-4000-8000-00000000000${n}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

// ---- 저장소 폴더를 그대로 보여 주는 작은 정적 서버 ----
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce', locale: 'ko-KR' });
// 데모는 외부에 아무것도 보내지 않아야 합니다. 글꼴 외의 외부 요청은 막고 기록합니다.
const external = [];
await context.route(url => !url.href.startsWith(BASE), route => {
  const { hostname } = new URL(route.request().url());
  if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(hostname) && route.request().resourceType() !== 'script') return route.continue();
  external.push(route.request().url());
  return route.abort();
});
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
};

let passed = 0;
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    passed += 1;
    results.push(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push(`FAIL  ${name} — ${error.message.split('\n')[0]}`);
  }
}
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 85 });
};
const text = (page, selector) => page.locator(selector).first().innerText();

const customer = await context.newPage();
watch(customer);
let admin;
let orderId;
let orderNumber;

await check('데모 고객 화면 로드', async () => {
  await customer.goto(`${BASE}/?demo`);
  await customer.evaluate(() => localStorage.clear());
  await customer.goto(`${BASE}/?demo`);
  await customer.waitForSelector('.menu-row');
  await customer.waitForTimeout(1200);
  const banner = await customer.locator('.demo-banner').count();
  const rows = await customer.locator('.menu-row').count();
  expect(banner === 1, '데모 배너가 없음');
  expect(rows === 6, `메뉴 줄 ${rows}개 (세트 1 + 단품 5 기대)`);
  await shot(customer, 'c1-menu');
  return `데모 배너, 세트 1 + 메뉴 5`;
});

await check('세트 선택 창에서 할인 가격 계산', async () => {
  await customer.click('[data-open-set]');
  await customer.click(`label.choice:has(input[name=toast][value="${M(2)}"])`);
  await customer.click(`label.choice:has(input[name=drink][value="${M(4)}"])`);
  await customer.waitForTimeout(400);
  const price = await text(customer, '#sheet-price');
  expect(price.includes('6,500원') && price.includes('6,000원'), `가격 표시: ${price}`);
  await shot(customer, 'c2-set');
  await customer.click('#sheet-add');
  return '말차 튀김산도 + 아이스 아메리카노 6,500원 → 6,000원';
});

await check('장바구니 합계', async () => {
  await customer.click('button[aria-label="크림브륄레 튀김산도 담기"]');
  await customer.waitForTimeout(2600);
  const total = await text(customer, '#cart-total');
  expect(total.includes('11,000원'), `합계: ${total}`);
  return '세트 6,000원 + 크림브륄레 5,000원 = 11,000원';
});

await check('주문 접수와 송금 화면', async () => {
  await customer.click('#open-cart');
  await customer.fill('#payer-name', '데모손님');
  await customer.fill('#contact', '010-0000-1234');
  await customer.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, document.documentElement.scrollHeight); });
  await customer.waitForTimeout(400);
  await shot(customer, 'c3-review');
  await customer.click('#create-order');
  await customer.waitForSelector('#step-payment:not([hidden])');
  await customer.waitForTimeout(800);
  orderNumber = (await text(customer, '#payment-order-number')).trim();
  const account = await text(customer, '#account-number');
  const tossHidden = await customer.locator('#toss-pay-link').isHidden();
  const kakaoHidden = await customer.locator('#kakao-pay-link').isHidden();
  expect(account.includes('000-0000-0000'), `계좌: ${account}`);
  expect(tossHidden && kakaoHidden, '데모인데 송금 앱 링크가 보임');
  await shot(customer, 'c4-payment');
  await customer.click('#payment-done');
  await customer.waitForTimeout(600);
  orderId = await customer.evaluate(() => window.BoothStore.getCurrentOrderId());
  return `주문번호 ${orderNumber}, 예시 계좌만 표시, 송금 앱 링크 숨김`;
});

await check('관리자 데모: 로그인 없이 주방 화면', async () => {
  admin = await context.newPage();
  watch(admin);
  await admin.setViewportSize({ width: 1440, height: 900 });
  await admin.goto(`${BASE}/admin/?demo`);
  await admin.waitForSelector('#admin-app:not([hidden])');
  await admin.waitForTimeout(1200);
  const loginHidden = await admin.locator('#admin-login').isHidden();
  const card = admin.locator(`button.next[data-order="${orderId}"][data-status="cooking"]`);
  expect(loginHidden, '로그인 화면이 보임');
  expect(await card.count() === 1, '새 주문의 입금 확인 버튼이 없음');
  await shot(admin, 'a1-new-order');
  return `${orderNumber} 입금 대기로 도착`;
});

await check('입금 확인 → 조리 중, 고객 화면에 바로 반영', async () => {
  const before = Number(await text(admin, '#metric-cooking'));
  await admin.click(`button.next[data-order="${orderId}"][data-status="cooking"]`);
  await admin.waitForTimeout(1000);
  const after = Number(await text(admin, '#metric-cooking'));
  await customer.waitForTimeout(800);
  const status = await text(customer, '#my-order-card');
  expect(after === before + 1, `조리 중 개수 ${before} → ${after}`);
  expect(status.includes('조리 중'), `고객 상태: ${status.replace(/\s+/g, ' ')}`);
  await shot(admin, 'a2-cooking');
  await shot(customer, 'c5-queue');
  return `주방 조리 중 ${before} → ${after}, 고객 화면 '조리 중'`;
});

await check('지금 만들어야 할 메뉴 합계', async () => {
  const totals = (await text(admin, '#kds-menu-totals')).replace(/\s+/g, ' ');
  // 진행 중 주문 #8(크림브륄레 세트·말차) + 새 주문(말차 세트·크림브륄레)
  expect(/크림브륄레 튀김산도 2/.test(totals) && /말차 튀김산도 2/.test(totals) && /아이스 아메리카노 2/.test(totals), totals);
  return '크림브륄레 2, 말차 2, 아이스 아메리카노 2 (세트 구성품 포함)';
});

await check('수령 가능 → 고객 폰 수령 알림', async () => {
  await admin.click(`button.next[data-order="${orderId}"][data-status="ready"]`);
  await admin.waitForTimeout(1000);
  await shot(admin, 'a3-ready');
  await customer.waitForSelector('#ready-alert:not([hidden])', { timeout: 5000 });
  await customer.waitForTimeout(1200);
  const number = await text(customer, '#ready-alert-number');
  expect(number.includes(orderNumber.replace('#', '')), `알림 번호 ${number}`);
  await shot(customer, 'c6-ready-alert');
  return `알림 팝업 ${number}`;
});

await check('서버와 같은 세트 저장 방식', async () => {
  const items = await admin.evaluate(id => window.BoothStore.getState().orders.find(order => order.id === id).items
    .map(item => `${item.name}:${item.price}`), orderId);
  expect(items.includes('말차 튀김산도 (세트):4500') && items.includes('아이스 아메리카노 (세트):1500') && items.includes('크림브륄레 튀김산도:5000'), items.join(', '));
  return '세트는 "(세트)" 두 줄, 할인 500원은 음료 줄에서 차감';
});

await check('품절 처리 → 고객 메뉴·세트 창에 품절 표시', async () => {
  await admin.evaluate(id => window.BoothStore.toggleSoldOut(id), M(2));
  await customer.click('#ready-alert-close');
  await customer.click('#new-order');
  await customer.waitForTimeout(800);
  const row = (await customer.locator('.menu-row', { hasText: '말차 튀김산도' }).innerText()).replace(/\s+/g, ' ');
  await customer.click('[data-open-set]');
  const disabled = await customer.locator(`input[name=toast][value="${M(2)}"]`).isDisabled();
  await customer.click('[data-sheet-close]');
  expect(row.includes('품절'), row);
  expect(disabled, '세트 창에서 말차를 고를 수 있음');
  await admin.evaluate(id => window.BoothStore.toggleSoldOut(id), M(2));
  return '말차 튀김산도 품절 → 메뉴 줄과 세트 창 모두 품절';
});

await check('남은 수량보다 많이 주문하면 거절', async () => {
  const { stock, message } = await customer.evaluate(async id => {
    const stock = window.BoothStore.getState().menu.find(item => item.id === id).stockRemaining;
    try {
      await window.BoothStore.createOrder({ payerName: '데모', contact: '01000000000', items: [{ menuId: id, quantity: stock + 1 }] });
      return { stock, message: 'accepted' };
    } catch (error) { return { stock, message: error.message }; }
  }, M(3));
  expect(message.includes(`${stock}개만 남았습니다`), message);
  return `초코 튀김산도 ${stock}개 남음, ${stock + 1}개 주문 → "${message}"`;
});

await check('관리자 수동 주문은 바로 조리 중', async () => {
  const before = Number(await text(admin, '#metric-cooking'));
  const order = await admin.evaluate(async id => window.BoothStore.adminCreateOrder({ payerName: '', contact: '', items: [{ menuId: id, quantity: 1 }], paid: true }), M(1));
  await admin.waitForTimeout(800);
  const after = Number(await text(admin, '#metric-cooking'));
  expect(order.status === 'cooking' && after === before + 1, `상태 ${order.status}, 조리 중 ${before} → ${after}`);
  return `#${order.orderNumber} 조리 중으로 추가`;
});

await check('데모 초기화', async () => {
  await admin.click('[data-demo-reset]');
  await admin.waitForTimeout(1000);
  const count = await admin.evaluate(() => window.BoothStore.getState().orders.length);
  expect(count === 9, `주문 ${count}건`);
  return '예시 주문 9건으로 복원';
});

await check('폰 320px에서 가로 넘침 없음', async () => {
  await customer.setViewportSize({ width: 320, height: 700 });
  await customer.goto(`${BASE}/?demo`);
  await customer.waitForSelector('.menu-row');
  const overflow = await customer.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 0, `${overflow}px 넘침`);
  return '고객 화면 너비 320px';
});

await check('실행 중 스크립트 오류·외부 요청 없음', async () => {
  expect(errors.length === 0, errors.join(' / '));
  expect(external.length === 0, `외부 요청: ${external.join(', ')}`);
  return '';
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} 통과`);
process.exit(passed === results.length ? 0 : 1);
