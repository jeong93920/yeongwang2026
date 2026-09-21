(function () {
  const STORAGE_KEY = 'booth-order-state-v1';
  const CURRENT_ORDER_KEY = 'booth-order-current-id';
  const CHANNEL_NAME = 'booth-order-updates';
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

  const seedState = () => ({
    settings: {
      boothName: '오늘의 부스',
      waitMinutes: 12,
      bankName: '신한은행',
      accountHolder: '오늘의 부스',
      accountNumber: '110-123-456789'
    },
    menu: [
      { id: 'chicken', name: '반반 닭강정', description: '달콤 + 매콤', price: 5000, image: './assets/menu-placeholder.svg', soldOut: false },
      { id: 'potato', name: '갈릭 감자', description: '버터갈릭', price: 4000, image: './assets/menu-placeholder.svg', soldOut: false },
      { id: 'kimchi-noodles', name: '김치말이국수', description: '시원한 김치말이국수', price: 6000, image: './assets/menu-placeholder.svg', soldOut: false },
      { id: 'churros', name: '초코츄러스', description: '시나몬 슈가', price: 3500, image: './assets/menu-placeholder.svg', soldOut: false }
    ],
    orders: [
      sampleOrder(36, 'ready', '이하늘', [{ menuId: 'chicken', quantity: 1 }], -18),
      sampleOrder(37, 'ready', '박서윤', [{ menuId: 'kimchi-noodles', quantity: 2 }], -16),
      sampleOrder(38, 'cooking', '김지우', [{ menuId: 'churros', quantity: 2 }], -13),
      sampleOrder(39, 'cooking', '최도윤', [{ menuId: 'potato', quantity: 1 }, { menuId: 'kimchi-noodles', quantity: 1 }], -11),
      sampleOrder(40, 'confirmed', '정유진', [{ menuId: 'chicken', quantity: 1 }], -8),
      sampleOrder(41, 'confirmed', '이민준', [{ menuId: 'potato', quantity: 2 }], -5),
      sampleOrder(43, 'payment_pending', '한서아', [{ menuId: 'kimchi-noodles', quantity: 1 }], -2)
    ]
  });

  function sampleOrder(number, status, payerName, items, minutesAgo) {
    return {
      id: `demo-${number}`,
      orderNumber: number,
      payerName,
      items,
      status,
      createdAt: new Date(Date.now() + minutesAgo * 60000).toISOString()
    };
  }

  function getState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const state = seedState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    }
    try { return JSON.parse(raw); } catch (_) {
      const state = seedState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('booth-order-local-update', { detail: state }));
    if (channel) channel.postMessage({ type: 'state-updated' });
    return state;
  }

  function subscribe(listener) {
    const localHandler = event => listener(event.detail || getState());
    const storageHandler = event => { if (event.key === STORAGE_KEY) listener(getState()); };
    const channelHandler = () => listener(getState());
    window.addEventListener('booth-order-local-update', localHandler);
    window.addEventListener('storage', storageHandler);
    if (channel) channel.addEventListener('message', channelHandler);
    return () => {
      window.removeEventListener('booth-order-local-update', localHandler);
      window.removeEventListener('storage', storageHandler);
      if (channel) channel.removeEventListener('message', channelHandler);
    };
  }

  function createOrder({ payerName, items }) {
    const state = getState();
    const normalizedItems = items
      .map(item => ({ menuId: item.menuId, quantity: Math.min(20, Math.max(0, Number(item.quantity) || 0)) }))
      .filter(item => item.quantity > 0 && state.menu.some(menu => menu.id === item.menuId && !menu.soldOut));
    if (!normalizedItems.length) throw new Error('주문할 메뉴가 없습니다.');
    const nextNumber = Math.max(35, ...state.orders.map(order => order.orderNumber)) + 1;
    const order = {
      id: crypto.randomUUID ? crypto.randomUUID() : `order-${Date.now()}`,
      orderNumber: nextNumber,
      payerName: payerName.trim(),
      items: normalizedItems,
      status: 'payment_pending',
      createdAt: new Date().toISOString()
    };
    state.orders.push(order);
    saveState(state);
    setCurrentOrderId(order.id);
    return order;
  }

  function updateOrderStatus(orderId, status) {
    const state = getState();
    const order = state.orders.find(item => item.id === orderId);
    if (!order) return null;
    order.status = status;
    order.updatedAt = new Date().toISOString();
    saveState(state);
    return order;
  }

  function toggleSoldOut(menuId) {
    const state = getState();
    const item = state.menu.find(menuItem => menuItem.id === menuId);
    if (!item) return null;
    item.soldOut = !item.soldOut;
    saveState(state);
    return item;
  }

  function calculateOrderTotal(order, state = getState()) {
    return order.items.reduce((sum, item) => {
      const menuItem = state.menu.find(menu => menu.id === item.menuId);
      return sum + (menuItem ? menuItem.price * item.quantity : 0);
    }, 0);
  }

  function resetDemo() {
    localStorage.removeItem(CURRENT_ORDER_KEY);
    return saveState(seedState());
  }

  function setCurrentOrderId(id) { localStorage.setItem(CURRENT_ORDER_KEY, id); }
  function getCurrentOrderId() { return localStorage.getItem(CURRENT_ORDER_KEY); }
  function clearCurrentOrder() { localStorage.removeItem(CURRENT_ORDER_KEY); }
  function formatPrice(value) { return `${Number(value).toLocaleString('ko-KR')}원`; }

  window.MockStore = {
    getState, subscribe, createOrder, updateOrderStatus, toggleSoldOut,
    calculateOrderTotal, resetDemo, setCurrentOrderId, getCurrentOrderId,
    clearCurrentOrder, formatPrice
  };
})();
