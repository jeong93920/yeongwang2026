(function () {
  'use strict';

  const store = window.BoothStore;
  const ADMIN_EMAIL = 'ipad93920@gmail.com';
  let activeFilter = 'active';
  let toastTimer;
  const preparedItems = new Set();
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  const labels = {
    payment_pending: '입금 대기', confirmed: '주문 접수', cooking: '조리 중',
    ready: '수령 가능', picked_up: '수령 완료', cancelled: '취소'
  };
  const nextAction = {
    payment_pending: { label: '입금 확인', next: 'cooking' },
    confirmed: { label: '조리 시작', next: 'cooking' },
    cooking: { label: '수령 가능', next: 'ready' },
    ready: { label: '수령 완료', next: 'picked_up' }
  };
  const prepSpeedLabels = { fast: '빨라요', normal: '적당해요', slow: '늦어요' };
  const SALES_DAYS = { day1: '2026-10-28', day2: '2026-10-29' };
  const paidStatuses = ['confirmed', 'cooking', 'ready', 'picked_up'];

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
  }

  function matchesFilter(order) {
    if (activeFilter === 'active') return !['picked_up', 'cancelled'].includes(order.status);
    if (activeFilter === 'done') return ['picked_up', 'cancelled'].includes(order.status);
    return order.status === activeFilter;
  }

  function elapsed(iso) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    return `${Math.floor(minutes / 60)}시간 전`;
  }

  function formatContact(value) {
    const digits = String(value || '').replace(/[^0-9]/g, '');
    if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    return '연락처 없음';
  }

  function koreaDateKey(iso) {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(iso));
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  function renderMetrics(state) {
    const paidOrders = state.orders.filter(order => paidStatuses.includes(order.status));
    const sales = paidOrders.reduce((total, order) => total + store.calculateOrderTotal(order, state), 0);
    const salesForDay = date => paidOrders
      .filter(order => koreaDateKey(order.createdAt) === date)
      .reduce((total, order) => total + store.calculateOrderTotal(order, state), 0);
    $('#metric-sales-day1').textContent = store.formatPrice(salesForDay(SALES_DAYS.day1));
    $('#metric-sales-day2').textContent = store.formatPrice(salesForDay(SALES_DAYS.day2));
    $('#metric-sales').textContent = store.formatPrice(sales);
    $('#metric-payment').textContent = state.orders.filter(order => order.status === 'payment_pending').length;
    $('#metric-cooking').textContent = state.orders.filter(order => order.status === 'cooking').length;
    $('#metric-ready').textContent = state.orders.filter(order => order.status === 'ready').length;
  }

  function renderMenuTotals(state) {
    // 세트 항목("말차 토스트 (세트)")은 단품과 합치고, 청귤에이드·청귤차처럼 대체 메뉴는 따로 셉니다.
    const baseName = name => String(name || '삭제된 메뉴').replace(/ \(세트\)$/, '');
    const totals = new Map();
    state.menu.forEach(item => [item.name, item.altName].filter(Boolean)
      .forEach(name => totals.set(name, { name, quantity: 0 })));
    state.orders
      .filter(order => order.status === 'cooking')
      .forEach(order => (order.items || []).forEach(item => {
        const key = baseName(item.name);
        const total = totals.get(key) || { name: key, quantity: 0 };
        total.quantity += Number(item.quantity) || 0;
        totals.set(key, total);
      }));

    const items = [...totals.values()];
    $('#kds-menu-totals').innerHTML = items.length
      ? items.map(item => `<article class="kds-total-card ${item.quantity ? 'has-orders' : ''}"><span>${escapeHtml(item.name)}</span><strong>${item.quantity}</strong><small>${item.quantity ? '개 남음' : '대기 없음'}</small></article>`).join('')
      : '<div class="empty-state">등록된 메뉴가 없습니다.</div>';
  }

  function itemLines(order) {
    return (order.items || []).map((item, index) => {
      const text = `${escapeHtml(item.name || '삭제된 메뉴')} <b>×${Number(item.quantity) || 0}</b>`;
      if (order.status !== 'cooking') return `<span>${text}</span>`;
      const key = `${order.id}:${index}`;
      const prepared = preparedItems.has(key);
      return `<button type="button" class="item-toggle ${prepared ? 'prepared' : ''}" data-item-toggle="${key}">${text}</button>`;
    }).join('');
  }

  function bindItemActions() {
    document.querySelectorAll('[data-item-toggle]').forEach(span => {
      span.addEventListener('click', () => {
        const key = span.dataset.itemToggle;
        if (preparedItems.has(key)) preparedItems.delete(key);
        else preparedItems.add(key);
        span.classList.toggle('prepared');
      });
    });
  }

  function bindOrderActions() {
    document.querySelectorAll('[data-order][data-status]').forEach(button => {
      button.addEventListener('click', async () => {
        if (button.dataset.status === 'cancelled' && !window.confirm('이 주문을 취소할까요? 취소 후 완료·취소 탭에서 복구할 수 있습니다.')) return;
        button.disabled = true;
        try {
          const order = await store.updateOrderStatus(button.dataset.order, button.dataset.status);
          if (order) toast(`#${order.orderNumber} · ${labels[order.status]} 처리`);
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function renderOrders(state) {
    const orders = state.orders.filter(matchesFilter).sort((a, b) => {
      if (activeFilter === 'done') return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      return a.orderNumber - b.orderNumber;
    });
    if (!orders.length) {
      $('#admin-orders').innerHTML = '<div class="empty-state">이 상태의 주문이 없습니다.</div>';
      return;
    }
    $('#admin-orders').innerHTML = orders.map(order => {
      const action = nextAction[order.status];
      const restoreAction = order.status === 'cancelled'
        ? { label: '주문 복구', next: 'cooking' }
        : order.status === 'picked_up' ? { label: '수령 취소', next: 'ready' } : null;
      return `<article class="admin-order kds-order-card status-${order.status}">
        <div class="kds-order-head"><div class="admin-order-number">#${order.orderNumber}</div><span class="status-pill status-${order.status}">${labels[order.status]}</span></div>
        <div class="admin-order-items status-${order.status}">${itemLines(order)}</div>
        <div class="admin-order-detail"><small>${escapeHtml(order.payerName)} · ${escapeHtml(formatContact(order.contact))}<br>${elapsed(order.createdAt)} · ${store.formatPrice(store.calculateOrderTotal(order, state))}</small></div>
        <div class="order-actions">
          ${action ? `<button class="next" type="button" data-order="${order.id}" data-status="${action.next}">${action.label}</button>` : ''}
          ${restoreAction ? `<button class="next" type="button" data-order="${order.id}" data-status="${restoreAction.next}">${restoreAction.label}</button>` : ''}
          ${!['picked_up', 'cancelled'].includes(order.status) ? `<button class="cancel" type="button" data-order="${order.id}" data-status="cancelled">취소</button>` : ''}
        </div>
      </article>`;
    }).join('');
    bindOrderActions();
    bindItemActions();
  }

  function bindMenuActions() {
    document.querySelectorAll('[data-save-price]').forEach(button => {
      button.addEventListener('click', async () => {
        const id = button.dataset.savePrice;
        const input = document.querySelector(`[data-price="${id}"]`);
        button.disabled = true;
        try {
          const item = await store.updateMenuItem(id, { price: Number(input.value) });
          toast(`${item.name} · ${store.formatPrice(item.price)} 저장`);
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-save-stock]').forEach(button => {
      button.addEventListener('click', async () => {
        const id = button.dataset.saveStock;
        const input = document.querySelector(`[data-stock-qty="${id}"]`);
        const raw = input.value.trim();
        button.disabled = true;
        try {
          const item = await store.updateMenuItem(id, { stockRemaining: raw === '' ? null : Number(raw) });
          toast(`${item.name} · 남은 수량 ${item.stockRemaining != null ? item.stockRemaining + '개' : '무제한'} 저장`);
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-active]').forEach(button => {
      button.addEventListener('click', async () => {
        const id = button.dataset.active;
        const item = store.getState().menu.find(menuItem => menuItem.id === id);
        const input = document.querySelector(`[data-price="${id}"]`);
        button.disabled = true;
        try {
          const updated = await store.updateMenuItem(id, { price: Number(input.value), active: !item.active });
          toast(`${updated.name} · ${updated.active ? '판매 시작' : '판매 중지'}`);
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-stock]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const item = await store.toggleSoldOut(button.dataset.stock);
          if (item) toast(`${item.name} · ${item.soldOut ? '품절' : '판매 재개'}`);
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-prep-speed]').forEach(select => {
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          const item = await store.updateMenuItem(select.dataset.prepSpeed, { prepSpeed: select.value });
          toast(`${item.name} · ${prepSpeedLabels[item.prepSpeed]} 저장`);
        } catch (error) {
          toast(error.message);
        } finally {
          select.disabled = false;
        }
      });
    });
  }

  function renderMenu(state) {
    if (!state.menu.length) {
      $('#admin-menu-list').innerHTML = '<div class="empty-state">등록된 메뉴가 없습니다.</div>';
      return;
    }
    $('#admin-menu-list').innerHTML = state.menu.map(item => {
      const stockText = item.stockRemaining != null ? ` · 재고 ${item.stockRemaining}개` : '';
      return `<div class="admin-menu-item menu-editor ${item.active ? '' : 'inactive'}">
      <div class="menu-editor-title"><strong>${escapeHtml(item.name)}</strong><small>${item.active ? (item.soldOut ? '품절' : '판매 중') : '판매 준비 중'}${stockText}</small></div>
      <div class="menu-editor-controls">
        <label class="prep-speed-field"><span>소요시간</span><select data-prep-speed="${item.id}" aria-label="${escapeHtml(item.name)} 소요시간">
          <option value="fast" ${item.prepSpeed === 'fast' ? 'selected' : ''}>빨라요</option>
          <option value="normal" ${item.prepSpeed === 'normal' ? 'selected' : ''}>적당해요</option>
          <option value="slow" ${item.prepSpeed === 'slow' ? 'selected' : ''}>늦어요</option>
        </select></label>
        <label><span class="sr-only">${escapeHtml(item.name)} 가격</span><input class="price-input" data-price="${item.id}" type="number" min="0" step="100" inputmode="numeric" value="${item.price}" aria-label="${escapeHtml(item.name)} 가격"></label>
        <button class="stock-button" type="button" data-save-price="${item.id}">가격 저장</button>
        <label><span class="sr-only">${escapeHtml(item.name)} 남은 수량</span><input class="price-input" data-stock-qty="${item.id}" type="number" min="0" step="1" inputmode="numeric" placeholder="무제한" value="${item.stockRemaining != null ? item.stockRemaining : ''}" aria-label="${escapeHtml(item.name)} 남은 수량"></label>
        <button class="stock-button" type="button" data-save-stock="${item.id}">수량 저장</button>
        <button class="stock-button ${item.active ? '' : 'start'}" type="button" data-active="${item.id}">${item.active ? '판매 중지' : '판매 시작'}</button>
        <button class="stock-button ${item.soldOut ? 'sold-out' : ''}" type="button" data-stock="${item.id}" ${item.active ? '' : 'disabled'}>${item.soldOut ? '품절 해제' : '품절 처리'}</button>
      </div>
    </div>`;
    }).join('');
    bindMenuActions();
  }

  function renderSetDiscount(state) {
    const input = $('#set-discount');
    if (document.activeElement !== input) input.value = state.settings.setDiscount;
  }

  // 수동 주문: 고객 화면을 쓸 수 없을 때 관리자가 직접 주문을 넣습니다.
  const manualLines = new Map();
  const manualSet = { toastId: '', drink: '' };
  const manualKey = line => [line.menuId, line.alt ? 1 : 0, line.setDrinkId || '', line.setDrinkAlt ? 1 : 0].join('|');
  const menuAvailable = item => Boolean(item) && item.active && !item.soldOut && item.stockRemaining !== 0;
  const findMenu = (state, id) => state.menu.find(item => item.id === id);

  function manualLinePrice(state, line) {
    const menu = findMenu(state, line.menuId);
    if (!menu) return 0;
    if (!line.setDrinkId) return menu.price;
    const drink = findMenu(state, line.setDrinkId);
    return drink ? menu.price + drink.price - Math.max(0, Number(state.settings.setDiscount) || 0) : 0;
  }

  function manualLineName(state, line) {
    const menu = findMenu(state, line.menuId);
    if (!menu) return '';
    if (!line.setDrinkId) return line.alt ? menu.altName : menu.name;
    const drink = findMenu(state, line.setDrinkId);
    return drink ? `${menu.name} + ${line.setDrinkAlt ? drink.altName : drink.name}` : '';
  }

  function manualStepper(line) {
    const quantity = (manualLines.get(manualKey(line)) || {}).quantity || 0;
    const data = `data-manual-line='${escapeHtml(JSON.stringify(line))}'`;
    return `<div class="quantity-control">
      <button type="button" ${data} data-change="-1" aria-label="수량 줄이기" ${quantity ? '' : 'disabled'}>−</button>
      <span>${quantity}</span>
      <button type="button" ${data} data-change="1" aria-label="수량 늘리기" ${quantity >= 20 ? 'disabled' : ''}>+</button>
    </div>`;
  }

  function renderManualOrder(state) {
    if ($('#manual-order').hidden) return;
    // 품절되거나 판매 중지된 메뉴가 든 줄은 뺍니다.
    [...manualLines.entries()].forEach(([key, line]) => {
      if (![line.menuId, line.setDrinkId].filter(Boolean).every(id => menuAvailable(findMenu(state, id)))) manualLines.delete(key);
    });

    const active = state.menu.filter(item => item.active);
    const toasts = active.filter(item => item.category === 'toast');
    const drinks = active.filter(item => item.category === 'drink');
    const singles = active.flatMap(item => [{ item, alt: false }].concat(item.altName ? [{ item, alt: true }] : []));
    const singleRows = singles.map(({ item, alt }) => {
      const name = escapeHtml(alt ? item.altName : item.name);
      const control = menuAvailable(item) ? manualStepper({ menuId: item.id, alt }) : '<span class="sold-out-label">품절</span>';
      return `<div class="manual-row ${menuAvailable(item) ? '' : 'sold-out'}"><span>${name}</span><em>${store.formatPrice(item.price)}</em>${control}</div>`;
    }).join('');

    let setBlock = '';
    if (toasts.length && drinks.length) {
      const option = (value, label, available, selected) => `<option value="${value}" ${available ? '' : 'disabled'} ${selected ? 'selected' : ''}>${escapeHtml(label)}${available ? '' : ' (품절)'}</option>`;
      const drinkOptions = drinks.flatMap(item => [option(`${item.id}|0`, item.name, menuAvailable(item), manualSet.drink === `${item.id}|0`)]
        .concat(item.altName ? [option(`${item.id}|1`, item.altName, menuAvailable(item), manualSet.drink === `${item.id}|1`)] : []));
      const setLines = [...manualLines.values()].filter(line => line.setDrinkId).map(line => {
        const spec = { menuId: line.menuId, setDrinkId: line.setDrinkId, setDrinkAlt: line.setDrinkAlt };
        return `<div class="manual-row"><span>${escapeHtml(manualLineName(state, line))}</span><em>${store.formatPrice(manualLinePrice(state, line))}</em>${manualStepper(spec)}</div>`;
      }).join('');
      setBlock = `<h3 class="manual-section-title">바삭 세트</h3>
        <div class="manual-set-pick">
          <select id="manual-set-toast" aria-label="세트 튀김산도"><option value="">튀김산도 선택</option>${toasts.map(item => option(item.id, item.name, menuAvailable(item), manualSet.toastId === item.id)).join('')}</select>
          <select id="manual-set-drink" aria-label="세트 음료"><option value="">음료 선택</option>${drinkOptions.join('')}</select>
          <button class="secondary-button" id="manual-set-add" type="button">세트 추가</button>
        </div>${setLines}`;
    }

    $('#manual-order-menu').innerHTML = `<h3 class="manual-section-title">단품</h3>${singleRows}${setBlock}`;
    const total = [...manualLines.values()].reduce((sum, line) => sum + manualLinePrice(state, line) * line.quantity, 0);
    $('#manual-order-total').textContent = store.formatPrice(total);
    $('#manual-order-submit').disabled = !manualLines.size;
  }

  function changeManualLine(line, change) {
    const key = manualKey(line);
    const next = Math.min(20, Math.max(0, ((manualLines.get(key) || {}).quantity || 0) + change));
    if (next) manualLines.set(key, { ...line, quantity: next });
    else manualLines.delete(key);
  }

  function resetManualOrder() {
    manualLines.clear();
    manualSet.toastId = '';
    manualSet.drink = '';
    $('#manual-payer').value = '';
    $('#manual-contact').value = '';
    $('#manual-paid').checked = true;
  }

  function closeManualOrder() {
    $('#manual-order').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  $('#manual-order-open').addEventListener('click', () => {
    $('#manual-order').hidden = false;
    document.body.classList.add('sheet-open');
    renderManualOrder(store.getState());
  });

  $('#manual-order').addEventListener('click', event => {
    if (event.target === event.currentTarget || event.target.closest('[data-manual-close]')) return closeManualOrder();
    const lineButton = event.target.closest('[data-manual-line]');
    if (lineButton) {
      changeManualLine(JSON.parse(lineButton.dataset.manualLine), Number(lineButton.dataset.change));
      return renderManualOrder(store.getState());
    }
    if (event.target.closest('#manual-set-add')) {
      if (!manualSet.toastId || !manualSet.drink) return toast('세트의 튀김산도와 음료를 골라 주세요.');
      const [drinkId, alt] = manualSet.drink.split('|');
      changeManualLine({ menuId: manualSet.toastId, setDrinkId: drinkId, setDrinkAlt: alt === '1' }, 1);
      renderManualOrder(store.getState());
    }
  });

  $('#manual-order').addEventListener('change', event => {
    if (event.target.id === 'manual-set-toast') manualSet.toastId = event.target.value;
    if (event.target.id === 'manual-set-drink') manualSet.drink = event.target.value;
  });

  $('#manual-order-submit').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const order = await store.adminCreateOrder({
        payerName: $('#manual-payer').value,
        contact: $('#manual-contact').value,
        items: [...manualLines.values()],
        paid: $('#manual-paid').checked
      });
      toast(`#${order.orderNumber} 주문을 넣었어요 · ${store.formatPrice(order.totalAmount)}`);
      resetManualOrder();
      closeManualOrder();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = !manualLines.size;
    }
  });

  function render(state) {
    renderMenuTotals(state);
    renderMetrics(state);
    renderOrders(state);
    renderMenu(state);
    renderSetDiscount(state);
    renderManualOrder(state);
  }

  $('#save-set-discount').addEventListener('click', async event => {
    const button = event.currentTarget;
    const raw = $('#set-discount').value.trim();
    button.disabled = true;
    try {
      const settings = await store.updateSetDiscount(raw === '' ? NaN : Number(raw));
      toast(`세트 할인 · ${store.formatPrice(settings.setDiscount)} 저장`);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  function clearAdminView() {
    $('#kds-menu-totals').replaceChildren();
    $('#metric-sales-day1').textContent = '0원';
    $('#metric-sales-day2').textContent = '0원';
    $('#metric-sales').textContent = '0원';
    $('#metric-payment').textContent = '0';
    $('#metric-cooking').textContent = '0';
    $('#metric-ready').textContent = '0';
    $('#admin-orders').replaceChildren();
    $('#admin-menu-list').replaceChildren();
  }

  function renderAuth() {
    const auth = store.getAuthState();
    const login = $('#admin-login');
    const app = $('#admin-app');
    const status = $('#login-status');
    const sendButton = $('#send-login-link');
    const logoutFromLogin = $('#login-sign-out');

    if (!auth.initialized) {
      clearAdminView();
      login.hidden = false;
      app.hidden = true;
      status.textContent = '로그인 상태를 확인하고 있습니다.';
      sendButton.hidden = true;
      logoutFromLogin.hidden = true;
      return;
    }
    if (!auth.session) {
      clearAdminView();
      login.hidden = false;
      app.hidden = true;
      status.textContent = '비밀번호로 로그인하거나 이메일 링크를 받을 수 있습니다.';
      sendButton.hidden = false;
      logoutFromLogin.hidden = true;
      return;
    }
    if (!auth.isAdmin) {
      clearAdminView();
      login.hidden = false;
      app.hidden = true;
      status.textContent = '이 계정에는 부스 관리자 권한이 없습니다.';
      sendButton.hidden = true;
      logoutFromLogin.hidden = false;
      return;
    }
    login.hidden = true;
    app.hidden = false;
    render(store.getState());
  }

  $('#order-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderOrders(store.getState());
  });

  function friendlyAuthError(error) {
    const message = String(error && error.message || error).toLowerCase();
    if (message.includes('rate limit')) return '로그인 이메일 발송 한도를 초과했습니다. 잠시 후 다시 시도하거나 비밀번호로 로그인해 주세요.';
    if (message.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (message.includes('email not confirmed')) return '이메일 인증이 완료되지 않은 계정입니다.';
    return error.message || '로그인에 실패했습니다.';
  }

  async function passwordLogin() {
    const button = $('#admin-password-login');
    const password = $('#admin-password').value;
    button.disabled = true;
    $('#login-status').textContent = '로그인하고 있습니다.';
    try {
      await store.signInWithPassword(ADMIN_EMAIL, password);
      renderAuth();
    } catch (error) {
      const message = friendlyAuthError(error);
      $('#login-status').textContent = message;
      toast(message);
    } finally {
      button.disabled = false;
    }
  }

  $('#admin-password-login').addEventListener('click', passwordLogin);
  $('#admin-password').addEventListener('keydown', event => {
    if (event.key === 'Enter') passwordLogin();
  });

  $('#send-login-link').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    $('#login-status').textContent = '로그인 이메일을 보내고 있습니다.';
    try {
      await store.signInWithOtp(ADMIN_EMAIL);
      $('#login-status').textContent = `${ADMIN_EMAIL}로 보낸 링크를 열어주세요.`;
      toast('로그인 이메일을 보냈습니다.');
    } catch (error) {
      const message = friendlyAuthError(error);
      $('#login-status').textContent = message;
      toast(message);
    } finally {
      button.disabled = false;
    }
  });

  async function logout(button) {
    button.disabled = true;
    try {
      await store.signOut();
      toast('로그아웃했습니다.');
      renderAuth();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }
  $('#admin-logout').addEventListener('click', event => logout(event.currentTarget));
  $('#login-sign-out').addEventListener('click', event => logout(event.currentTarget));

  store.subscribe(state => {
    renderAuth();
    if (store.getAuthState().isAdmin) render(state);
  });

  store.ready().then(renderAuth).catch(error => {
    $('#login-status').textContent = `연결 실패: ${error.message}`;
    toast(error.message);
  });
})();
