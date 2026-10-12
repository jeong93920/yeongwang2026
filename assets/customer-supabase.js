(function () {
  'use strict';

  const store = window.BoothStore;
  // key → { menuId, alt, setDrinkId, setDrinkAlt, quantity }
  const cart = new Map();
  let activeOrderId = null;
  let toastTimer;
  let sheet = null;
  let introScheduled = false;

  const statusLabels = {
    payment_pending: '입금 확인 중', confirmed: '주문 접수', cooking: '조리 중',
    ready: '수령해 주세요', picked_up: '수령 완료', cancelled: '주문 취소'
  };
  const steps = ['menu', 'review', 'payment', 'queue'];
  const $ = selector => document.querySelector(selector);
  const MAX_QUANTITY = 20;
  const prepSpeedLabels = { fast: '빨라요', normal: '적당해요', slow: '늦어요' };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function showStep(name) {
    document.querySelectorAll('.customer-step').forEach(step => step.classList.remove('active'));
    $(`#step-${name}`).classList.add('active');
    const index = steps.indexOf(name);
    document.querySelectorAll('[data-progress]').forEach((bar, barIndex) => bar.classList.toggle('active', barIndex <= index));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
  }

  const lineKey = line => [line.menuId, line.alt ? 1 : 0, line.setDrinkId || '', line.setDrinkAlt ? 1 : 0].join('|');
  const setDiscount = state => Math.max(0, Number(state.settings.setDiscount) || 0);
  const findMenu = (state, id) => state.menu.find(item => item.id === id);

  function getCartItems() {
    return [...cart.values()].filter(line => line.quantity > 0);
  }

  function lineName(state, line) {
    const menu = findMenu(state, line.menuId);
    if (!menu) return '';
    if (!line.setDrinkId) return line.alt ? menu.altName : menu.name;
    const drink = findMenu(state, line.setDrinkId);
    return drink ? `${menu.name} + ${line.setDrinkAlt ? drink.altName : drink.name}` : '';
  }

  function linePrice(state, line) {
    const menu = findMenu(state, line.menuId);
    if (!menu) return 0;
    if (!line.setDrinkId) return menu.price;
    const drink = findMenu(state, line.setDrinkId);
    return drink ? menu.price + drink.price - setDiscount(state) : 0;
  }

  function cartTotal(state) {
    return getCartItems().reduce((total, line) => total + linePrice(state, line) * line.quantity, 0);
  }

  function menuStockRemaining(item) {
    return item && item.stockRemaining != null ? item.stockRemaining : null;
  }

  function isAvailable(item) {
    return Boolean(item) && item.active && !item.soldOut && menuStockRemaining(item) !== 0;
  }

  // 세트 음료까지 포함해 이 메뉴가 장바구니에 몇 개 들어 있는지 셉니다.
  function menuDemand(menuId) {
    return getCartItems().reduce((sum, line) => sum
      + (line.menuId === menuId ? line.quantity : 0)
      + (line.setDrinkId === menuId ? line.quantity : 0), 0);
  }

  function menuLimit(item) {
    const stock = menuStockRemaining(item);
    return stock == null ? MAX_QUANTITY : Math.min(MAX_QUANTITY, stock);
  }

  function canAddLine(state, line) {
    for (const id of [line.menuId, line.setDrinkId].filter(Boolean)) {
      const menu = findMenu(state, id);
      if (!isAvailable(menu)) return '품절된 메뉴가 있어요.';
      if (menuDemand(id) >= menuLimit(menu)) {
        return menuStockRemaining(menu) != null && menuStockRemaining(menu) < MAX_QUANTITY
          ? `${menu.name}은(는) ${menuStockRemaining(menu)}개까지만 담을 수 있어요.`
          : `메뉴당 최대 ${MAX_QUANTITY}개까지 담을 수 있어요.`;
      }
    }
    return '';
  }

  function changeLine(spec, change) {
    const key = lineKey(spec);
    const current = cart.get(key);
    if (change > 0) {
      const blocked = canAddLine(store.getState(), spec);
      if (blocked) {
        toast(blocked);
        return false;
      }
    }
    const next = Math.max(0, (current ? current.quantity : 0) + change);
    if (next) cart.set(key, { menuId: spec.menuId, alt: Boolean(spec.alt), setDrinkId: spec.setDrinkId || null, setDrinkAlt: Boolean(spec.setDrinkAlt), quantity: next });
    else cart.delete(key);
    return true;
  }

  function pruneCart(state) {
    [...cart.entries()].forEach(([key, line]) => {
      const ids = [line.menuId, line.setDrinkId].filter(Boolean);
      if (ids.some(id => {
        const menu = findMenu(state, id);
        return !menu || menu.soldOut || !menu.active;
      })) cart.delete(key);
    });
  }

  function setMenus(state) {
    return {
      toasts: state.menu.filter(item => item.category === 'toast'),
      drinks: state.menu.filter(item => item.category === 'drink')
    };
  }

  function quantityControl(spec, label, disabled) {
    const quantity = (cart.get(lineKey(spec)) || {}).quantity || 0;
    const data = `data-line='${escapeHtml(JSON.stringify(spec))}'`;
    if (!quantity) return `<button class="add-button" type="button" ${data} data-change="1" aria-label="${label} 담기" ${disabled ? 'disabled' : ''}>담기</button>`;
    return `<div class="quantity-control">
      <button type="button" ${data} data-change="-1" aria-label="${label} 수량 줄이기">−</button>
      <span>${quantity}</span>
      <button type="button" ${data} data-change="1" aria-label="${label} 수량 늘리기" ${disabled ? 'disabled' : ''}>+</button>
    </div>`;
  }

  function menuRow(item) {
    const safeName = escapeHtml(item.name);
    const unavailable = !isAvailable(item);
    const stock = menuStockRemaining(item);
    const notes = [];
    if (item.altName) notes.push(`${escapeHtml(item.altName)}로 변경 가능`);
    if (item.description) notes.push(escapeHtml(item.description));
    if (stock != null && stock > 0) notes.push(`남은 수량 ${stock}개`);
    notes.push(`소요시간 ${prepSpeedLabels[item.prepSpeed] || prepSpeedLabels.normal}`);

    let control;
    if (unavailable) {
      control = '<span class="sold-out-label">품절</span>';
    } else if (item.altName) {
      const count = getCartItems().filter(line => line.menuId === item.id && !line.setDrinkId).reduce((sum, line) => sum + line.quantity, 0);
      control = `<button class="add-button" type="button" data-open-option="${item.id}">${count ? `${count}개 · 추가` : '선택'}</button>`;
    } else {
      control = quantityControl({ menuId: item.id }, safeName, false);
    }

    return `<li class="menu-row ${unavailable ? 'sold-out' : ''}">
      <div class="menu-row-main">
        <div class="menu-row-title"><h4>${safeName}</h4><span class="menu-dots" aria-hidden="true"></span><strong>${store.formatPrice(item.price)}</strong></div>
        <p class="menu-row-note">${notes.join(' · ')}</p>
      </div>
      <div class="menu-row-action">${control}</div>
    </li>`;
  }

  function setRow(state) {
    const { toasts, drinks } = setMenus(state);
    const availableToasts = toasts.filter(isAvailable);
    const availableDrinks = drinks.filter(isAvailable);
    if (!toasts.length || !drinks.length) return '';
    const unavailable = !availableToasts.length || !availableDrinks.length;
    const minPrice = unavailable ? 0
      : Math.min(...availableToasts.map(item => item.price)) + Math.min(...availableDrinks.map(item => item.price)) - setDiscount(state);
    const count = getCartItems().filter(line => line.setDrinkId).reduce((sum, line) => sum + line.quantity, 0);
    return `<li class="menu-row set-row ${unavailable ? 'sold-out' : ''}">
      <div class="menu-row-main">
        <div class="menu-row-title"><h4>바삭 세트</h4><span class="menu-dots" aria-hidden="true"></span><strong>${unavailable ? '—' : `${store.formatPrice(minPrice)}~`}</strong></div>
        <p class="menu-row-note">${setDiscount(state) ? `<span class="discount-badge">${store.formatPrice(setDiscount(state))} 할인</span> ` : ''}토스트 + 음료를 골라주세요</p>
      </div>
      <div class="menu-row-action">${unavailable
        ? '<span class="sold-out-label">품절</span>'
        : `<button class="add-button" type="button" data-open-set>${count ? `${count}개 · 추가` : '선택'}</button>`}</div>
    </li>`;
  }

  function renderMenu(state) {
    pruneCart(state);
    if (state.settings.boothName) $('#booth-name').textContent = state.settings.boothName;
    const waitingTeams = state.orders.filter(order => ['payment_pending', 'confirmed', 'cooking'].includes(order.status)).length;
    $('#wait-time').textContent = state.settings.isOpen
      ? (waitingTeams ? `지금 주문하면 앞에 ${waitingTeams}팀` : '지금 주문하면 바로 접수돼요')
      : '지금은 주문 준비 중이에요';
    $('#menu-count').textContent = `${state.menu.filter(isAvailable).length}개 메뉴`;

    if (!state.settings.isOpen || !state.menu.length) {
      $('#menu-board').innerHTML = `<div class="empty-state customer-empty">${state.settings.isOpen ? '판매 메뉴를 준비하고 있습니다.' : '지금은 주문을 받지 않습니다.'}</div>`;
      return;
    }

    const { toasts, drinks } = setMenus(state);
    const others = state.menu.filter(item => !['toast', 'drink'].includes(item.category));
    const section = (title, rows) => rows ? `<section class="menu-section"><h3>${title}</h3><ul class="menu-list">${rows}</ul></section>` : '';
    $('#menu-board').innerHTML = [
      section('토스트', toasts.map(menuRow).join('')),
      section('음료', drinks.map(menuRow).join('')),
      section('세트', setRow(state)),
      section('기타', others.map(menuRow).join(''))
    ].join('');
    // 첫 화면에서만 메뉴 카드가 차례로 올라오고, 이후 실시간 갱신 때는 다시 움직이지 않게 합니다.
    if (!introScheduled) {
      introScheduled = true;
      setTimeout(() => $('#menu-board').classList.remove('intro'), 1000);
    }
    if (sheet) renderSheet(state);
  }

  let lastCartCount = 0;

  function renderCartBar(state) {
    const count = getCartItems().reduce((sum, item) => sum + item.quantity, 0);
    if (count > lastCartCount) {
      const button = $('#open-cart');
      button.classList.remove('bump');
      void button.offsetWidth;
      button.classList.add('bump');
    }
    lastCartCount = count;
    $('#cart-count').textContent = count;
    $('#cart-total').textContent = count ? `${store.formatPrice(cartTotal(state))} · 주문 확인` : '메뉴를 담아주세요';
    $('#open-cart').disabled = count === 0;
  }

  function radio(group, value, checked, label, price, disabled) {
    return `<label class="choice ${disabled ? 'disabled' : ''}">
      <input type="radio" name="${group}" value="${value}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${label}</span>${price ? `<em>${price}</em>` : ''}
    </label>`;
  }

  function sheetSpec() {
    if (!sheet) return null;
    if (sheet.mode === 'alt') return { menuId: sheet.menuId, alt: sheet.alt };
    if (!sheet.toastId || !sheet.drinkId) return null;
    return { menuId: sheet.toastId, setDrinkId: sheet.drinkId, setDrinkAlt: sheet.drinkAlt };
  }

  function renderSheet(state) {
    const body = $('#sheet-body');
    if (sheet.mode === 'alt') {
      const menu = findMenu(state, sheet.menuId);
      if (!isAvailable(menu)) return closeSheet();
      $('#sheet-title').textContent = menu.name;
      body.innerHTML = `<fieldset class="choice-group"><legend>종류</legend>
        ${radio('alt', '0', !sheet.alt, escapeHtml(menu.name))}
        ${radio('alt', '1', sheet.alt, escapeHtml(menu.altName))}
      </fieldset>`;
      $('#sheet-price').textContent = store.formatPrice(menu.price);
      $('#sheet-add').disabled = false;
      $('#sheet-add').textContent = '담기';
      return;
    }

    const { toasts, drinks } = setMenus(state);
    if (sheet.toastId && !isAvailable(findMenu(state, sheet.toastId))) sheet.toastId = null;
    if (sheet.drinkId && !isAvailable(findMenu(state, sheet.drinkId))) sheet.drinkId = null;
    const drink = findMenu(state, sheet.drinkId);
    if (!drink || !drink.altName) sheet.drinkAlt = false;
    $('#sheet-title').textContent = '바삭 세트';
    body.innerHTML = `<fieldset class="choice-group"><legend>토스트 선택</legend>
        ${toasts.map(item => radio('toast', item.id, item.id === sheet.toastId, escapeHtml(item.name), store.formatPrice(item.price), !isAvailable(item))).join('')}
      </fieldset>
      <fieldset class="choice-group"><legend>음료 선택</legend>
        ${drinks.map(item => radio('drink', item.id, item.id === sheet.drinkId, escapeHtml(item.name) + (item.altName ? ` <small>(${escapeHtml(item.altName)} 가능)</small>` : ''), store.formatPrice(item.price), !isAvailable(item))).join('')}
      </fieldset>
      ${drink && drink.altName ? `<fieldset class="choice-group"><legend>음료 종류</legend>
        ${radio('drink-alt', '0', !sheet.drinkAlt, escapeHtml(drink.name))}
        ${radio('drink-alt', '1', sheet.drinkAlt, escapeHtml(drink.altName))}
      </fieldset>` : ''}`;

    const spec = sheetSpec();
    if (spec) {
      const original = findMenu(state, spec.menuId).price + drink.price;
      const discounted = original - setDiscount(state);
      $('#sheet-price').innerHTML = discounted < original
        ? `<s>${store.formatPrice(original)}</s> <strong>${store.formatPrice(discounted)}</strong>`
        : `<strong>${store.formatPrice(original)}</strong>`;
    } else {
      $('#sheet-price').textContent = setDiscount(state) ? `세트 ${store.formatPrice(setDiscount(state))} 할인` : '';
    }
    $('#sheet-add').disabled = !spec;
    $('#sheet-add').textContent = spec ? '세트 담기' : '토스트와 음료를 골라주세요';
  }

  function openSheet(next) {
    sheet = next;
    renderSheet(store.getState());
    $('#option-sheet').hidden = false;
    document.body.classList.add('sheet-open');
  }

  function closeSheet() {
    sheet = null;
    $('#option-sheet').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  function renderReview(state) {
    const rows = getCartItems().map(line => {
      const name = lineName(state, line);
      if (!name) return '';
      const price = linePrice(state, line);
      const spec = { menuId: line.menuId, alt: line.alt, setDrinkId: line.setDrinkId, setDrinkAlt: line.setDrinkAlt };
      const tag = line.setDrinkId ? '<span class="set-tag">바삭 세트</span>' : '';
      return `<div class="summary-row summary-item">
        <div>${tag}${escapeHtml(name)}<small>${store.formatPrice(price)} × ${line.quantity}</small></div>
        <div class="summary-line-end">
          ${quantityControl(spec, escapeHtml(name), false)}
          <strong>${store.formatPrice(price * line.quantity)}</strong>
        </div>
      </div>`;
    }).join('');
    const total = cartTotal(state);
    $('#order-summary').innerHTML = `${rows}<div class="summary-row total"><span>총 금액</span><strong>${store.formatPrice(total)}</strong></div>`;
    $('#review-total').textContent = store.formatPrice(total);
  }

  function rerenderCart() {
    const state = store.getState();
    renderMenu(state);
    renderCartBar(state);
    if ($('#step-review').classList.contains('active')) {
      if (!getCartItems().length) showStep('menu');
      else renderReview(state);
    }
  }

  function handleLineClick(event) {
    const button = event.target.closest('[data-line][data-change]');
    if (!button) return;
    changeLine(JSON.parse(button.dataset.line), Number(button.dataset.change));
    rerenderCart();
  }

  $('#menu-board').addEventListener('click', event => {
    const option = event.target.closest('[data-open-option]');
    if (option) return openSheet({ mode: 'alt', menuId: option.dataset.openOption, alt: false });
    if (event.target.closest('[data-open-set]')) return openSheet({ mode: 'set', toastId: null, drinkId: null, drinkAlt: false });
    handleLineClick(event);
  });
  $('#order-summary').addEventListener('click', handleLineClick);

  $('#sheet-body').addEventListener('change', event => {
    const input = event.target;
    if (input.name === 'alt') sheet.alt = input.value === '1';
    if (input.name === 'toast') sheet.toastId = input.value;
    if (input.name === 'drink') sheet.drinkId = input.value;
    if (input.name === 'drink-alt') sheet.drinkAlt = input.value === '1';
    renderSheet(store.getState());
  });

  $('#sheet-add').addEventListener('click', () => {
    const spec = sheetSpec();
    if (!spec || !changeLine(spec, 1)) return;
    toast(`${lineName(store.getState(), spec)} 담았어요.`);
    closeSheet();
    rerenderCart();
  });

  $('#option-sheet').addEventListener('click', event => {
    if (event.target === event.currentTarget || event.target.closest('[data-sheet-close]')) closeSheet();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sheet) closeSheet();
  });

  function findActiveOrder(state) {
    return state.orders.find(order => order.id === activeOrderId);
  }

  function renderPayment(state, order) {
    $('#payment-order-number').textContent = `#${order.orderNumber}`;
    const orderTotal = store.calculateOrderTotal(order, state);
    document.querySelectorAll('[data-order-total]').forEach(element => {
      element.textContent = store.formatPrice(orderTotal);
    });
    const moveToQueue = () => {
      const currentOrder = findActiveOrder(store.getState());
      if (!currentOrder) return;
      renderQueue(store.getState());
      showStep('queue');
    };

    const kakaoPayLink = $('#kakao-pay-link');
    const bridgeUrl = state.settings.transferQrUrl;
    if (bridgeUrl) {
      const userAgent = navigator.userAgent;
      const isAndroid = /Android/i.test(userAgent);
      const isIos = /iPhone|iPad|iPod/i.test(userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isCurrentKakaoPayLink = bridgeUrl === 'https://qr.kakaopay.com/FZjVSUoNp';
      const qrCode = '281006011181748411009807';
      const directAppUrl = isAndroid
        ? `intent://kakaopay/money/to/qr?qr_code=${qrCode}#Intent;scheme=kakaotalk;package=com.kakao.talk;end;`
        : `kakaotalk://kakaopay/money/to/qr?qr_code=${qrCode}`;
      const opensAppDirectly = isCurrentKakaoPayLink && (isAndroid || isIos);

      kakaoPayLink.href = opensAppDirectly ? directAppUrl : bridgeUrl;
      kakaoPayLink.target = opensAppDirectly ? '_self' : '_blank';
      kakaoPayLink.hidden = false;
      kakaoPayLink.onclick = moveToQueue;
    } else {
      kakaoPayLink.removeAttribute('href');
      kakaoPayLink.onclick = null;
      kakaoPayLink.hidden = true;
    }

    const tossPayLink = $('#toss-pay-link');
    if (state.settings.bankName && state.settings.accountNumber && orderTotal > 0) {
      const tossParams = new URLSearchParams({
        amount: String(orderTotal),
        bank: state.settings.bankName,
        accountNo: state.settings.accountNumber,
        origin: 'qr'
      });
      tossPayLink.href = `supertoss://send?${tossParams.toString()}`;
      tossPayLink.target = '_self';
      tossPayLink.onclick = moveToQueue;
      tossPayLink.hidden = false;
    } else {
      tossPayLink.removeAttribute('href');
      tossPayLink.onclick = null;
      tossPayLink.hidden = true;
    }

    $('#bank-name').textContent = [state.settings.bankName, state.settings.accountHolder].filter(Boolean).join(' · ') || '계좌 정보 준비 중';
    $('#account-number').textContent = state.settings.accountNumber || '등록 전';
    $('#copy-account').disabled = !state.settings.accountNumber;
  }

  function ordersForStatus(state, statuses) {
    return state.orders.filter(order => statuses.includes(order.status)).sort((a, b) => a.orderNumber - b.orderNumber);
  }

  function renderQueue(state) {
    const order = findActiveOrder(state);
    if (!order) {
      activeOrderId = null;
      store.clearCurrentOrder();
      showStep('menu');
      return;
    }
    const ahead = state.orders.filter(item => item.orderNumber < order.orderNumber && ['payment_pending', 'confirmed', 'cooking'].includes(item.status)).length;
    const status = statusLabels[order.status] || order.status;
    const ready = order.status === 'ready';
    $('#my-order-card').className = `my-order-card ${ready ? 'ready' : ''}`;
    const aheadMessage = ahead === 0 ? '바로 앞 순서예요' : `내 앞에 ${ahead}팀 있어요`;
    $('#my-order-card').innerHTML = `<div><small>내 주문번호</small><div class="my-order-number">#${order.orderNumber}</div></div><div class="my-order-status"><small>현재 상태</small><strong>${ready ? '수령해 주세요' : status}</strong>${['confirmed', 'cooking'].includes(order.status) ? `<strong>${aheadMessage}</strong>` : ''}</div>`;

    const groups = [
      { label: '수령 가능', className: 'ready', statuses: ['ready'] },
      { label: '조리 중', className: 'cooking', statuses: ['cooking'] },
      { label: '접수 순서', className: '', statuses: ['confirmed', 'payment_pending'] }
    ];
    $('#public-queue').innerHTML = groups.map(group => {
      const orders = ordersForStatus(state, group.statuses);
      const numbers = orders.length
        ? orders.map(item => `<span class="queue-number ${item.id === order.id ? 'mine' : ''}">${item.orderNumber}${item.id === order.id ? ' · 나' : ''}</span>`).join('')
        : '<span class="subtle">없음</span>';
      return `<div class="queue-row ${group.className}"><strong>${group.label}</strong><div class="queue-numbers">${numbers}</div></div>`;
    }).join('');
    $('#queue-notice').textContent = ready
      ? '주문이 준비됐습니다. 주문번호 화면을 보여주고 받아가세요.'
      : '준비되면 소리·진동으로 알려드려요. 이 화면을 켜 두세요. 주문 변경이나 취소는 부스 직원에게 주문번호를 보여주세요.';
  }

  // ---- 수령 알림: 내 주문이 '수령 가능'으로 바뀌면 소리·진동·화면 안내로 알립니다. ----
  const BASE_TITLE = document.title;
  const READY_TITLE = '🔔 수령해 주세요!';
  const notifiedReady = new Set();
  let lastStatus = null;
  let audioContext = null;
  let titleTimer = null;
  let pollTimer = null;

  // 브라우저는 사용자가 화면을 누른 뒤에만 소리를 허용하므로, 첫 터치 때 오디오를 미리 열어 둡니다.
  function unlockAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      if (!audioContext) audioContext = new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume();
    } catch (_) { audioContext = null; }
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(type => document.addEventListener(type, unlockAudio, { passive: true }));

  function playChime() {
    if (!audioContext) return;
    try {
      const start = audioContext.currentTime + 0.05;
      [[880, 0], [1175, 0.18], [1568, 0.36], [880, 0.9], [1175, 1.08], [1568, 1.26]].forEach(([frequency, offset]) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.32);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 0.35);
      });
    } catch (_) { /* 소리를 못 내도 화면 안내는 계속 보여 줍니다. */ }
  }

  function startTitleBlink() {
    clearInterval(titleTimer);
    let on = false;
    titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? READY_TITLE : BASE_TITLE;
    }, 1000);
    document.title = READY_TITLE;
  }

  function stopReadyAlert() {
    clearInterval(titleTimer);
    titleTimer = null;
    document.title = BASE_TITLE;
    $('#ready-alert').hidden = true;
    if (navigator.vibrate) navigator.vibrate(0);
  }

  function showReadyAlert(order) {
    $('#ready-alert-number').textContent = `#${order.orderNumber}`;
    $('#ready-alert').hidden = false;
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]);
    playChime();
    startTitleBlink();
  }

  function checkReady(state) {
    const order = activeOrderId ? findActiveOrder(state) : null;
    const status = order ? order.status : null;
    if (order && status === 'ready' && lastStatus !== 'ready' && !notifiedReady.has(order.id)) {
      notifiedReady.add(order.id);
      showReadyAlert(order);
    }
    if (status !== 'ready' && titleTimer) stopReadyAlert();
    lastStatus = status;

    // 실시간 연결이 끊겨도 놓치지 않도록, 기다리는 주문이 있으면 20초마다 다시 확인합니다.
    const waiting = order && ['payment_pending', 'confirmed', 'cooking'].includes(status);
    if (waiting && !pollTimer) pollTimer = setInterval(() => store.refresh().catch(() => {}), 20000);
    if (!waiting && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  $('#ready-alert-close').addEventListener('click', () => {
    stopReadyAlert();
    const order = findActiveOrder(store.getState());
    if (order) {
      renderQueue(store.getState());
      showStep('queue');
    }
  });

  $('#open-cart').addEventListener('click', () => {
    renderReview(store.getState());
    showStep('review');
  });
  document.querySelector('[data-back="menu"]').addEventListener('click', () => showStep('menu'));

  $('#create-order').addEventListener('click', async event => {
    const payerName = $('#payer-name').value.trim();
    if (!payerName) {
      toast('입금자 이름을 입력해 주세요.');
      $('#payer-name').focus();
      return;
    }
    const contact = $('#contact').value.replace(/[^0-9]/g, '');
    if (!/^01[0-9]{8,9}$/.test(contact)) {
      toast('연락처는 01로 시작하는 휴대폰 번호를 입력해 주세요.');
      $('#contact').focus();
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const order = await store.createOrder({ payerName, contact, items: getCartItems() });
      activeOrderId = order.id;
      renderPayment(store.getState(), order);
      showStep('payment');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  $('#copy-account').addEventListener('click', async event => {
    const number = $('#account-number').textContent;
    if (!store.getState().settings.accountNumber) return;
    try {
      await navigator.clipboard.writeText(number);
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = number;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    event.currentTarget.textContent = '복사했어요 ✓';
    toast('계좌번호를 복사했습니다.');
    setTimeout(() => { event.currentTarget.textContent = '계좌번호 복사'; }, 1500);
  });

  $('#payment-done').addEventListener('click', () => {
    renderQueue(store.getState());
    showStep('queue');
  });

  const paymentAgain = document.createElement('button');
  paymentAgain.type = 'button';
  paymentAgain.className = 'text-button new-order-button';
  paymentAgain.textContent = '송금 정보 다시 보기';
  $('#queue-notice').insertAdjacentElement('afterend', paymentAgain);
  paymentAgain.addEventListener('click', () => {
    const order = findActiveOrder(store.getState());
    if (order) {
      renderPayment(store.getState(), order);
      showStep('payment');
    }
  });

  $('#new-order').addEventListener('click', () => {
    if (!window.confirm('현재 주문은 취소되지 않습니다. 다른 주문을 새로 시작할까요?')) return;
    store.clearCurrentOrder();
    activeOrderId = null;
    cart.clear();
    $('#payer-name').value = '';
    $('#contact').value = '';
    renderMenu(store.getState());
    renderCartBar(store.getState());
    showStep('menu');
  });

  store.subscribe(state => {
    renderMenu(state);
    renderCartBar(state);
    if (activeOrderId && $('#step-queue').classList.contains('active')) renderQueue(state);
    checkReady(state);
  });

  store.ready().then(() => {
    activeOrderId = store.getCurrentOrderId();
    const initialState = store.getState();
    renderMenu(initialState);
    renderCartBar(initialState);
    if (activeOrderId && findActiveOrder(initialState)) {
      renderQueue(initialState);
      showStep('queue');
    }
    checkReady(initialState);
  }).catch(error => {
    renderMenu(store.getState());
    renderCartBar(store.getState());
    toast(`연결 실패: ${error.message}`);
  });
})();
