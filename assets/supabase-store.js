(function () {
  'use strict';

  const config = window.BOOTH_SUPABASE_CONFIG;
  if (!config || !config.url || !config.publishableKey) {
    throw new Error('Supabase 설정이 없습니다.');
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase 클라이언트를 불러오지 못했습니다.');
  }

  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  const IS_ADMIN_PAGE = document.body.classList.contains('admin-body');
  const CURRENT_TOKEN_KEY = 'booth-order-public-token-v1';
  const listeners = new Set();
  let activeRefreshPromise = null;
  let currentOrderId = null;
  let session = null;
  let isAdmin = false;
  let initialized = false;
  let realtimeChannel = null;
  let refreshTimer = null;

  let state = {
    settings: {
      boothName: '감자에 싹이나서 이파리에 감자', bankName: '', accountHolder: '', accountNumber: '',
      transferQrUrl: null, isOpen: true
    },
    menu: [],
    orders: []
  };

  const mapSettings = row => row ? ({
    boothName: row.booth_name,
    bankName: row.bank_name,
    accountHolder: row.account_holder,
    accountNumber: row.account_number,
    transferQrUrl: row.transfer_qr_url,
    isOpen: row.is_open
  }) : state.settings;

  const mapMenu = row => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    price: Number(row.price),
    image: row.image_url || './assets/menu-placeholder.svg',
    soldOut: row.sold_out,
    active: row.active,
    sortOrder: row.sort_order,
    prepSpeed: row.prep_speed || 'normal',
    stockRemaining: row.stock_remaining == null ? null : Number(row.stock_remaining),
    stockVisible: row.stock_visible !== false
  });

  const mapQueueOrder = row => ({
    id: row.order_id,
    orderNumber: Number(row.order_number),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const mapOwnOrder = row => row ? ({
    id: row.id,
    orderNumber: Number(row.order_number),
    status: row.status,
    totalAmount: Number(row.total_amount),
    createdAt: row.created_at,
    items: (row.items || []).map(item => ({
      name: item.name,
      price: Number(item.price),
      quantity: Number(item.quantity),
      lineTotal: Number(item.line_total)
    }))
  }) : null;

  const mapAdminOrder = row => ({
    id: row.id,
    orderNumber: Number(row.order_number),
    payerName: row.payer_name,
    contact: row.contact || '',
    status: row.status,
    totalAmount: Number(row.total_amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (row.booth_order_items || []).map(item => ({
      menuId: item.menu_item_id,
      name: item.name_snapshot,
      price: Number(item.price_snapshot),
      quantity: Number(item.quantity),
      lineTotal: Number(item.line_total)
    }))
  });

  function throwIfError(result) {
    if (result.error) throw new Error(result.error.message || 'Supabase 요청에 실패했습니다.');
    return result.data;
  }

  function notify() {
    listeners.forEach(listener => listener(state));
  }

  function mergeOwnOrder(orders, ownOrder) {
    if (!ownOrder) return orders;
    const index = orders.findIndex(order => order.id === ownOrder.id);
    if (index < 0) return [...orders, ownOrder];
    const merged = [...orders];
    merged[index] = { ...merged[index], ...ownOrder };
    return merged;
  }

  async function hydrateCurrentOrder(orders) {
    const token = localStorage.getItem(CURRENT_TOKEN_KEY);
    if (!token) {
      currentOrderId = null;
      return orders;
    }
    try {
      const data = throwIfError(await client.rpc('booth_get_order', { p_public_token: token }));
      const order = mapOwnOrder(data);
      if (!order) {
        localStorage.removeItem(CURRENT_TOKEN_KEY);
        currentOrderId = null;
        return orders;
      }
      currentOrderId = order.id;
      return mergeOwnOrder(orders, order);
    } catch (error) {
      console.error('내 주문 복구 실패:', error);
      return orders;
    }
  }

  async function loadPublicState() {
    const [settingsResult, menuResult, queueResult] = await Promise.all([
      client.from('booth_settings').select('booth_name,bank_name,account_holder,account_number,transfer_qr_url,is_open').limit(1).maybeSingle(),
      client.from('booth_menu_items').select('id,name,description,price,image_url,sold_out,active,sort_order,prep_speed,stock_remaining,stock_visible').order('sort_order'),
      client.from('booth_public_queue').select('order_id,order_number,status,created_at,updated_at').order('order_number')
    ]);
    const settings = throwIfError(settingsResult);
    const menu = throwIfError(menuResult);
    const queue = throwIfError(queueResult);
    const orders = await hydrateCurrentOrder((queue || []).map(mapQueueOrder));
    state = {
      settings: mapSettings(settings),
      menu: (menu || []).map(mapMenu),
      orders
    };
    notify();
  }

  async function checkAdmin() {
    if (!session) return false;
    return Boolean(throwIfError(await client.rpc('booth_is_admin')));
  }

  async function loadAdminState() {
    const [settingsResult, menuResult, ordersResult] = await Promise.all([
      client.from('booth_settings').select('booth_name,bank_name,account_holder,account_number,transfer_qr_url,is_open').limit(1).maybeSingle(),
      client.from('booth_menu_items').select('id,name,description,price,image_url,sold_out,active,sort_order,prep_speed,stock_remaining,stock_visible').order('sort_order'),
      client.from('booth_orders').select('id,order_number,payer_name,contact,status,total_amount,created_at,updated_at,booth_order_items(menu_item_id,name_snapshot,price_snapshot,quantity,line_total)').order('order_number')
    ]);
    const settings = throwIfError(settingsResult);
    const menu = throwIfError(menuResult);
    const orders = throwIfError(ordersResult);
    state = {
      settings: mapSettings(settings),
      menu: (menu || []).map(mapMenu),
      orders: (orders || []).map(mapAdminOrder)
    };
    notify();
  }

  async function runRefresh() {
    if (IS_ADMIN_PAGE) {
      isAdmin = await checkAdmin();
      if (isAdmin) await loadAdminState();
      else {
        state = { ...state, menu: [], orders: [] };
        notify();
      }
    } else {
      await loadPublicState();
    }
  }

  async function refresh() {
    if (activeRefreshPromise) return activeRefreshPromise;
    activeRefreshPromise = runRefresh();
    try {
      return await activeRefreshPromise;
    } finally {
      activeRefreshPromise = null;
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch(error => console.error('실시간 갱신 실패:', error)), 120);
  }

  function startRealtime() {
    if (realtimeChannel) client.removeChannel(realtimeChannel);
    realtimeChannel = client
      .channel(`booth-public-queue-${IS_ADMIN_PAGE ? 'admin' : 'customer'}-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booth_public_queue' }, scheduleRefresh)
      .subscribe();
  }

  async function initialize() {
    const authResult = await client.auth.getSession();
    if (authResult.error) throw new Error(authResult.error.message);
    session = authResult.data.session;
    await refresh();
    startRealtime();
    initialized = true;
    notify();
  }

  const readyPromise = initialize().catch(error => {
    initialized = true;
    notify();
    throw error;
  });

  client.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
    setTimeout(() => refresh().catch(error => console.error('인증 상태 갱신 실패:', error)), 0);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRefresh();
  });

  async function createOrder({ payerName, contact, items }) {
    const normalizedItems = items
      .map(item => ({
        menu_id: item.menuId,
        quantity: Math.min(20, Math.max(0, Number(item.quantity) || 0)),
        no_cucumber: Boolean(item.noCucumber)
      }))
      .filter(item => item.quantity > 0);
    if (!normalizedItems.length) throw new Error('주문할 메뉴가 없습니다.');
    const normalizedContact = String(contact || '').replace(/[^0-9]/g, '');
    if (!/^01[0-9]{8,9}$/.test(normalizedContact)) throw new Error('올바른 연락처를 입력해 주세요.');
    const data = throwIfError(await client.rpc('booth_create_order', {
      p_payer_name: payerName.trim(),
      p_contact: normalizedContact,
      p_items: normalizedItems
    }));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('주문 결과를 확인하지 못했습니다.');
    localStorage.setItem(CURRENT_TOKEN_KEY, row.public_token);
    currentOrderId = row.id;
    const order = {
      id: row.id,
      orderNumber: Number(row.order_number),
      status: row.status,
      totalAmount: Number(row.total_amount),
      createdAt: row.created_at,
      items: normalizedItems.map(item => ({
        menuId: item.menu_id,
        quantity: item.quantity,
        noCucumber: item.no_cucumber
      }))
    };
    state = { ...state, orders: mergeOwnOrder(state.orders, order) };
    notify();
    return order;
  }

  async function updateOrderStatus(orderId, status) {
    throwIfError(await client.from('booth_orders').update({ status }).eq('id', orderId));
    await loadAdminState();
    return state.orders.find(order => order.id === orderId) || null;
  }

  async function toggleSoldOut(menuId) {
    const current = state.menu.find(item => item.id === menuId);
    if (!current) return null;
    const data = throwIfError(await client.from('booth_menu_items')
      .update({ sold_out: !current.soldOut })
      .eq('id', menuId)
      .select('id,name,description,price,image_url,sold_out,active,sort_order,prep_speed,stock_remaining,stock_visible')
      .single());
    const updated = mapMenu(data);
    state = { ...state, menu: state.menu.map(item => item.id === menuId ? updated : item) };
    notify();
    return updated;
  }

  async function updateMenuItem(menuId, changes) {
    const current = state.menu.find(item => item.id === menuId);
    if (!current) throw new Error('메뉴를 찾지 못했습니다.');
    const values = {};
    if (Object.hasOwn(changes, 'price')) {
      const price = Number(changes.price);
      if (!Number.isInteger(price) || price < 0) throw new Error('가격은 0 이상의 원 단위 숫자로 입력해 주세요.');
      values.price = price;
    }
    if (Object.hasOwn(changes, 'active')) {
      const nextPrice = Object.hasOwn(values, 'price') ? values.price : current.price;
      if (changes.active && nextPrice <= 0) throw new Error('가격을 입력한 뒤 판매를 시작해 주세요.');
      values.active = Boolean(changes.active);
      if (changes.active && current.description === '가격 확정 후 판매 시작') values.description = '';
    }
    if (Object.hasOwn(changes, 'prepSpeed')) {
      if (!['fast', 'normal', 'slow'].includes(changes.prepSpeed)) throw new Error('올바른 소요시간을 선택해 주세요.');
      values.prep_speed = changes.prepSpeed;
    }
    if (Object.hasOwn(changes, 'stockRemaining')) {
      if (changes.stockRemaining === null) {
        values.stock_remaining = null;
      } else {
        const stock = Number(changes.stockRemaining);
        if (!Number.isInteger(stock) || stock < 0) throw new Error('남은 수량은 0 이상의 정수로 입력해 주세요.');
        values.stock_remaining = stock;
        values.sold_out = stock <= 0;
      }
    }
    if (Object.hasOwn(changes, 'stockVisible')) {
      values.stock_visible = Boolean(changes.stockVisible);
    }
    const data = throwIfError(await client.from('booth_menu_items')
      .update(values)
      .eq('id', menuId)
      .select('id,name,description,price,image_url,sold_out,active,sort_order,prep_speed,stock_remaining,stock_visible')
      .single());
    const updated = mapMenu(data);
    state = { ...state, menu: state.menu.map(item => item.id === menuId ? updated : item) };
    notify();
    return updated;
  }

  async function signInWithPassword(email, password) {
    if (!password) throw new Error('비밀번호를 입력해 주세요.');
    const result = await client.auth.signInWithPassword({ email, password });
    const data = throwIfError(result);
    session = data.session;
    if (!session) throw new Error('로그인 세션을 만들지 못했습니다.');
    await refresh();
    if (!isAdmin) throw new Error('이 계정에는 부스 관리자 권한이 없습니다.');
  }

  async function signInWithOtp(email) {
    const redirectUrl = `${window.location.origin}${window.location.pathname}`;
    const result = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl, shouldCreateUser: false }
    });
    throwIfError(result);
  }

  async function signOut() {
    const result = await client.auth.signOut();
    if (result.error) throw new Error(result.error.message);
    session = null;
    isAdmin = false;
    state = { ...state, menu: [], orders: [] };
    notify();
  }

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
    localStorage.removeItem(CURRENT_TOKEN_KEY);
    currentOrderId = null;
  }
  function getAuthState() { return { session, isAdmin, initialized }; }
  function formatPrice(value) { return `${Number(value || 0).toLocaleString('ko-KR')}원`; }

  window.BoothStore = {
    getState, ready, subscribe, createOrder, updateOrderStatus, toggleSoldOut, updateMenuItem,
    calculateOrderTotal, setCurrentOrderId, getCurrentOrderId, clearCurrentOrder,
    getAuthState, signInWithPassword, signInWithOtp, signOut, formatPrice
  };
})();
