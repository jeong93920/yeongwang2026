(function () {
  'use strict';

  // 데모 모드 저장소: supabase-store.js의 window.BoothStore와 같은 함수를 브라우저 localStorage만으로 구현합니다.
  // 실제 DB에는 아무것도 보내지 않습니다. 가격·세트 할인·재고 계산은 서버 함수 booth_create_order와 같게 맞춥니다.
  const IS_ADMIN_PAGE = document.body.classList.contains('admin-body');
  const STATE_KEY = 'booth-demo-state-v1';
  const CURRENT_ORDER_KEY = 'booth-demo-current-order-v1';
  const MAX_QUANTITY = 20;
  const listeners = new Set();
  let currentOrderId = null;
  let initialized = false;
  let db = null;
  let state = { settings: {}, menu: [], orders: [] };

  const menuId = n => `b0030000-0000-4000-8000-00000000000${n}`;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

  // ---- 시드 데이터: 실제 사이트와 같은 메뉴, 예시 계좌, 가짜 연락처의 예시 주문 ----
  function seedMenu() {
    const row = (n, name, price, category, extra = {}) => ({
      id: menuId(n), name, description: '', price, image: '', soldOut: false, active: true,
      sortOrder: n * 10, prepSpeed: 'normal', stockRemaining: null, category, altName: null, ...extra
    });
    return [
      row(1, '크림브륄레 튀김산도', 5000, 'toast', { prepSpeed: 'slow' }),
      row(2, '말차 튀김산도', 4500, 'toast'),
      row(3, '초코 튀김산도', 4500, 'toast', { stockRemaining: 12 }),
      row(4, '아이스 아메리카노', 2000, 'drink', { prepSpeed: 'fast' }),
      row(5, '청귤에이드', 3000, 'drink', { prepSpeed: 'fast', altName: '청귤차' })
    ];
  }

  function seed() {
    const db = {
      settings: {
        boothName: 'BASAK WITCH', bankName: '데모은행', accountHolder: '바삭위치(예시)', accountNumber: '000-0000-0000',
        transferQrUrl: null, isOpen: true, setDiscount: 500
      },
      menu: seedMenu(),
      orders: [],
      nextOrderNumber: 1
    };
    const kst = (date, time) => new Date(`${date}T${time}+09:00`).toISOString();
    const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();
    const add = (payerName, contact, createdAt, status, items) => {
      const order = buildOrder(db, payerName, contact, items);
      order.createdAt = createdAt;
      order.updatedAt = createdAt;
      order.status = status;
      db.orders.push(order);
    };
    // 축제 1·2일차에 끝난 주문(관리자 화면 매출 칸에 보입니다)
    add('김예시', '01000000001', kst('2026-10-28', '11:05:00'), 'picked_up', [{ menuId: menuId(1), quantity: 1, setDrinkId: menuId(4) }]);
    add('이예시', '01000000002', kst('2026-10-28', '11:20:00'), 'picked_up', [{ menuId: menuId(2), quantity: 2 }, { menuId: menuId(5), quantity: 1, alt: true }]);
    add('박예시', '01000000003', kst('2026-10-28', '13:42:00'), 'picked_up', [{ menuId: menuId(3), quantity: 1, setDrinkId: menuId(5) }]);
    add('최예시', '01000000004', kst('2026-10-28', '14:10:00'), 'cancelled', [{ menuId: menuId(4), quantity: 1 }]);
    add('정예시', '01000000005', kst('2026-10-29', '10:58:00'), 'picked_up', [{ menuId: menuId(1), quantity: 2 }, { menuId: menuId(4), quantity: 2 }]);
    add('강예시', '01000000006', kst('2026-10-29', '12:31:00'), 'picked_up', [{ menuId: menuId(2), quantity: 1, setDrinkId: menuId(5), setDrinkAlt: true }]);
    // 지금 진행 중인 주문(주방 화면과 손님 대기열에 보입니다)
    add('조예시', '01000000007', minutesAgo(9), 'ready', [{ menuId: menuId(3), quantity: 1 }]);
    add('윤예시', '01000000008', minutesAgo(5), 'cooking', [{ menuId: menuId(1), quantity: 1, setDrinkId: menuId(4) }, { menuId: menuId(2), quantity: 1 }]);
    add('장예시', '01000000009', minutesAgo(2), 'payment_pending', [{ menuId: menuId(2), quantity: 1, setDrinkId: menuId(5) }]);
    return db;
  }

  // ---- 주문 계산: booth_create_order와 같은 규칙 ----
  function normalizeItems(items) {
    return (items || [])
      .map(item => ({
        menuId: item.menuId,
        quantity: Math.min(MAX_QUANTITY, Math.max(0, Number(item.quantity) || 0)),
        alt: Boolean(item.alt),
        setDrinkId: item.setDrinkId || null,
        setDrinkAlt: Boolean(item.setDrinkAlt)
      }))
      .filter(item => item.quantity > 0);
  }

  // 메뉴를 확인하고 재고를 빼며, 세트는 "○○ (세트)" 두 줄로 나눠 할인은 음료 줄에서 먼저 뺍니다.
  function buildOrder(db, payerName, contact, rawItems) {
    const items = normalizeItems(rawItems);
    if (!items.length) throw new Error('주문할 메뉴가 없습니다.');
    const findMenu = id => db.menu.find(item => item.id === id);
    const discount = Math.max(0, Number(db.settings.setDiscount) || 0);

    const needs = new Map();
    items.forEach(item => [item.menuId, item.setDrinkId].filter(Boolean)
      .forEach(id => needs.set(id, (needs.get(id) || 0) + item.quantity)));
    needs.forEach((quantity, id) => {
      const menu = findMenu(id);
      if (quantity > MAX_QUANTITY) throw new Error('메뉴당 수량은 1~20개까지 가능합니다.');
      if (!menu || !menu.active || menu.soldOut) throw new Error('판매 중이 아닌 메뉴가 포함되어 있습니다.');
      if (menu.stockRemaining != null && quantity > menu.stockRemaining) throw new Error(`${menu.name}은(는) ${menu.stockRemaining}개만 남았습니다.`);
    });

    let total = 0;
    const lines = [];
    items.forEach(item => {
      const menu = findMenu(item.menuId);
      if (item.alt && !menu.altName) throw new Error('선택할 수 없는 메뉴 옵션입니다.');
      if (!item.setDrinkId) {
        if (item.setDrinkAlt) throw new Error('선택할 수 없는 메뉴 옵션입니다.');
        total += menu.price * item.quantity;
        lines.push({ menuId: menu.id, name: item.alt ? menu.altName : menu.name, price: menu.price, quantity: item.quantity });
        return;
      }
      const drink = findMenu(item.setDrinkId);
      if (menu.category !== 'toast' || drink.category !== 'drink' || item.alt) throw new Error('세트는 토스트 1개와 음료 1개로 골라 주세요.');
      if (item.setDrinkAlt && !drink.altName) throw new Error('선택할 수 없는 메뉴 옵션입니다.');
      if (menu.price + drink.price <= discount) throw new Error('세트 가격을 계산할 수 없습니다.');
      total += (menu.price + drink.price - discount) * item.quantity;
      lines.push(
        { menuId: menu.id, name: `${menu.name} (세트)`, price: menu.price - Math.max(discount - drink.price, 0), quantity: item.quantity },
        { menuId: drink.id, name: `${item.setDrinkAlt ? drink.altName : drink.name} (세트)`, price: drink.price - Math.min(discount, drink.price), quantity: item.quantity }
      );
    });

    // 검사를 모두 통과한 뒤에만 재고를 뺍니다. 0개가 되면 품절로 바꿉니다.
    needs.forEach((quantity, id) => {
      const menu = findMenu(id);
      if (menu.stockRemaining == null) return;
      menu.stockRemaining -= quantity;
      if (menu.stockRemaining <= 0) menu.soldOut = true;
    });

    // 같은 메뉴·이름·가격 줄은 합치고 이름순으로 저장합니다(서버의 group by … order by name과 같음).
    const grouped = new Map();
    lines.forEach(line => {
      const key = `${line.menuId}|${line.name}|${line.price}`;
      const current = grouped.get(key);
      if (current) current.quantity += line.quantity;
      else grouped.set(key, { ...line });
    });
    const now = new Date().toISOString();
    return {
      id: uuid(),
      orderNumber: db.nextOrderNumber++,
      payerName,
      contact: contact || '',
      status: 'payment_pending',
      totalAmount: total,
      createdAt: now,
      updatedAt: now,
      items: [...grouped.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(line => ({ ...line, lineTotal: line.price * line.quantity }))
    };
  }

  // ---- 저장과 화면용 상태 ----
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY));
      if (saved && Array.isArray(saved.menu) && Array.isArray(saved.orders)) return saved;
    } catch (_) { /* 저장된 값이 깨졌으면 새로 만듭니다. */ }
    const fresh = seed();
    save(fresh);
    return fresh;
  }

  function save(next) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); } catch (_) { /* 저장을 못 해도 이 탭에서는 계속 동작합니다. */ }
  }

  // 고객 화면은 공개 대기열(번호·상태)만 보고, 내 주문만 메뉴와 금액까지 봅니다. 관리자 화면은 전체를 봅니다.
  function buildView() {
    try { currentOrderId = localStorage.getItem(CURRENT_ORDER_KEY); } catch (_) { currentOrderId = null; }
    if (currentOrderId && !db.orders.some(order => order.id === currentOrderId)) currentOrderId = null;
    const settings = { ...db.settings };
    if (IS_ADMIN_PAGE) {
      return { settings, menu: db.menu.map(item => ({ ...item })), orders: db.orders.map(order => ({ ...order, items: order.items.map(item => ({ ...item })) })) };
    }
    const orders = db.orders.map(order => {
      const queued = { id: order.id, orderNumber: order.orderNumber, status: order.status, createdAt: order.createdAt, updatedAt: order.updatedAt };
      if (order.id !== currentOrderId) return queued;
      return { ...queued, totalAmount: order.totalAmount, items: order.items.map(({ name, price, quantity, lineTotal }) => ({ name, price, quantity, lineTotal })) };
    });
    return { settings, menu: db.menu.filter(item => item.active).map(item => ({ ...item })), orders };
  }

  function notify() {
    listeners.forEach(listener => listener(state));
  }

  function commit() {
    save(db);
    state = buildView();
    notify();
  }

  async function refresh() {
    db = load();
    state = buildView();
    notify();
  }

  // 다른 탭(예: 관리자 데모)이 저장한 값이 바뀌면 이 탭도 다시 읽습니다. Supabase 실시간 구독을 대신합니다.
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === STATE_KEY || event.key === CURRENT_ORDER_KEY) refresh();
  });

  // 처음 상태(시드)로 되돌립니다. 다른 탭은 storage 이벤트로 함께 초기화됩니다.
  function resetDemo() {
    clearCurrentOrder();
    db = seed();
    commit();
  }

  // ---- 데모 안내 배너: 데모 표시, 고객↔관리자 데모 이동, 초기화 ----
  function mountBanner() {
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.setAttribute('role', 'note');
    const otherHref = IS_ADMIN_PAGE ? '../?demo' : './admin/?demo';
    const otherLabel = IS_ADMIN_PAGE ? '고객 화면 데모 열기' : '주방(관리자) 화면 데모 열기';
    banner.innerHTML = `<span><strong>데모 모드</strong> · 실제 주문·결제가 일어나지 않아요</span>
      <span class="demo-banner-actions">
        <a href="${otherHref}" target="_blank" rel="noopener">${otherLabel}</a>
        <button type="button" data-demo-reset>데모 초기화</button>
      </span>`;
    document.body.prepend(banner);
    banner.querySelector('[data-demo-reset]').addEventListener('click', () => {
      if (window.confirm('데모 주문과 메뉴 설정을 처음 상태로 되돌릴까요?')) resetDemo();
    });
    // 데모 관리자는 로그인하지 않으므로 로그아웃 버튼은 숨깁니다.
    const logout = document.querySelector('#admin-logout');
    if (logout) logout.hidden = true;
    // 페이지 안의 고객·관리자 화면 링크도 데모 주소를 유지하게 합니다.
    document.querySelectorAll('a[href$="index.html"]').forEach(link => {
      link.href = link.getAttribute('href').replace(/index\.html$/, '?demo');
    });
  }
  mountBanner();

  const readyPromise = Promise.resolve().then(() => {
    db = load();
    state = buildView();
    initialized = true;
    notify();
  });

  // ---- BoothStore 함수들 ----
  async function createOrder({ payerName, contact, items }) {
    const name = String(payerName || '').trim();
    if (name.length < 1 || name.length > 20) throw new Error('입금자 이름은 1~20자로 입력해 주세요.');
    const normalizedContact = String(contact || '').replace(/[^0-9]/g, '');
    if (!/^01[0-9]{8,9}$/.test(normalizedContact)) throw new Error('올바른 연락처를 입력해 주세요.');
    db = load();
    const order = buildOrder(db, name, normalizedContact, items);
    db.orders.push(order);
    try { localStorage.setItem(CURRENT_ORDER_KEY, order.id); } catch (_) { /* 무시 */ }
    commit();
    return state.orders.find(item => item.id === order.id);
  }

  // 수동 주문은 서버(booth_admin_create_order)처럼 입금 확인된 '조리 중' 상태로 시작합니다.
  async function adminCreateOrder({ payerName, contact, items, paid }) {
    if (!normalizeItems(items).length) throw new Error('주문할 메뉴를 담아 주세요.');
    const normalizedContact = String(contact || '').replace(/[^0-9]/g, '');
    if (normalizedContact && !/^01[0-9]{8,9}$/.test(normalizedContact)) throw new Error('연락처는 01로 시작하는 번호로 입력하거나 비워 두세요.');
    db = load();
    const order = buildOrder(db, String(payerName || '').trim() || '현장 주문', normalizedContact, items);
    if (paid !== false) order.status = 'cooking';
    db.orders.push(order);
    commit();
    return { orderNumber: order.orderNumber, status: order.status, totalAmount: order.totalAmount };
  }

  async function updateOrderStatus(orderId, status) {
    db = load();
    const order = db.orders.find(item => item.id === orderId);
    if (!order) throw new Error('주문을 찾지 못했습니다.');
    order.status = status;
    order.updatedAt = new Date().toISOString();
    commit();
    return state.orders.find(item => item.id === orderId) || null;
  }

  async function toggleSoldOut(id) {
    db = load();
    const menu = db.menu.find(item => item.id === id);
    if (!menu) return null;
    menu.soldOut = !menu.soldOut;
    commit();
    return state.menu.find(item => item.id === id);
  }

  async function updateMenuItem(id, changes) {
    db = load();
    const menu = db.menu.find(item => item.id === id);
    if (!menu) throw new Error('메뉴를 찾지 못했습니다.');
    const values = {};
    if (Object.hasOwn(changes, 'price')) {
      const price = Number(changes.price);
      if (!Number.isInteger(price) || price < 0) throw new Error('가격은 0 이상의 원 단위 숫자로 입력해 주세요.');
      values.price = price;
    }
    if (Object.hasOwn(changes, 'active')) {
      const nextPrice = Object.hasOwn(values, 'price') ? values.price : menu.price;
      if (changes.active && nextPrice <= 0) throw new Error('가격을 입력한 뒤 판매를 시작해 주세요.');
      values.active = Boolean(changes.active);
    }
    if (Object.hasOwn(changes, 'prepSpeed')) {
      if (!['fast', 'normal', 'slow'].includes(changes.prepSpeed)) throw new Error('올바른 소요시간을 선택해 주세요.');
      values.prepSpeed = changes.prepSpeed;
    }
    if (Object.hasOwn(changes, 'stockRemaining')) {
      if (changes.stockRemaining === null) {
        values.stockRemaining = null;
      } else {
        const stock = Number(changes.stockRemaining);
        if (!Number.isInteger(stock) || stock < 0) throw new Error('남은 수량은 0 이상의 정수로 입력해 주세요.');
        values.stockRemaining = stock;
        values.soldOut = stock <= 0;
      }
    }
    Object.assign(menu, values);
    commit();
    return { ...menu };
  }

  async function updateSetDiscount(value) {
    const discount = Number(value);
    if (!Number.isInteger(discount) || discount < 0 || discount > 100000) throw new Error('세트 할인은 0 이상의 원 단위 숫자로 입력해 주세요.');
    db = load();
    db.settings.setDiscount = discount;
    commit();
    return state.settings;
  }

  async function signInWithPassword() { throw new Error('데모 모드에서는 로그인하지 않아도 돼요.'); }
  async function signInWithOtp() { throw new Error('데모 모드에서는 로그인 이메일을 보내지 않아요.'); }
  async function signOut() { throw new Error('데모 모드에서는 로그아웃할 수 없어요.'); }

  function calculateOrderTotal(order, currentState = state) {
    if (Number.isFinite(order.totalAmount)) return order.totalAmount;
    return (order.items || []).reduce((sum, item) => {
      if (Number.isFinite(item.lineTotal)) return sum + item.lineTotal;
      const menuItem = currentState.menu.find(menu => menu.id === item.menuId);
      return sum + (menuItem ? menuItem.price * item.quantity : 0);
    }, 0);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState() { return state; }
  function ready() { return readyPromise; }
  function setCurrentOrderId(id) { currentOrderId = id; }
  function getCurrentOrderId() { return currentOrderId; }
  function clearCurrentOrder() {
    try { localStorage.removeItem(CURRENT_ORDER_KEY); } catch (_) { /* 무시 */ }
    currentOrderId = null;
  }
  // 데모에서는 로그인 없이 관리자로 봅니다(주방 화면이 바로 열림).
  function getAuthState() { return { session: IS_ADMIN_PAGE ? { demo: true } : null, isAdmin: IS_ADMIN_PAGE, initialized }; }
  function formatPrice(value) { return `${Number(value || 0).toLocaleString('ko-KR')}원`; }

  window.BoothStore = {
    getState, ready, subscribe, createOrder, adminCreateOrder, updateOrderStatus, toggleSoldOut, updateMenuItem, updateSetDiscount,
    calculateOrderTotal, setCurrentOrderId, getCurrentOrderId, clearCurrentOrder,
    getAuthState, signInWithPassword, signInWithOtp, signOut, formatPrice, refresh,
    isDemo: true, resetDemo
  };
})();
