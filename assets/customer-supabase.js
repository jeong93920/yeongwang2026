(function () {
  'use strict';

  const store = window.BoothStore;
  const cart = new Map();
  const cartOptions = new Map();
  let activeOrderId = null;
  let toastTimer;

  const statusLabels = {
    payment_pending: '입금 확인 중', confirmed: '주문 접수', cooking: '조리 중',
    ready: '수령해 주세요', picked_up: '수령 완료', cancelled: '주문 취소'
  };
  const steps = ['menu', 'review', 'payment', 'queue'];
  const $ = selector => document.querySelector(selector);
  const MAX_QUANTITY = 20;
  const prepSpeedLabels = { fast: '빨라요', normal: '적당해요', slow: '늦어요' };
  const stockGroups = {
    potato: { itemName: '감자치즈누룽지', menuNames: new Set(['감자치즈누룽지', '세트메뉴']) },
    kimchi: { itemName: '김치말이국수', menuNames: new Set(['김치말이국수', '세트메뉴']) }
  };
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

  function getCartItems() {
    return [...cart.entries()]
      .filter(([, quantity]) => quantity > 0)
      .map(([menuId, quantity]) => ({
        menuId,
        quantity,
        noCucumber: Boolean(cartOptions.get(menuId)?.noCucumber)
      }));
  }

  function cartTotal(state) {
    return getCartItems().reduce((total, item) => {
      const menu = state.menu.find(menuItem => menuItem.id === item.menuId);
      return total + (menu ? menu.price * item.quantity : 0);
    }, 0);
  }

  function getStock(state, group) {
    const config = stockGroups[group];
    const item = state.menu.find(menuItem => menuItem.name === config.itemName);
    return item?.stockRemaining ?? null;
  }

  function cartStockUnits(state, group) {
    const config = stockGroups[group];
    return getCartItems().reduce((total, item) => {
      const menu = state.menu.find(menuItem => menuItem.id === item.menuId);
      return total + (menu && config.menuNames.has(menu.name) ? item.quantity : 0);
    }, 0);
  }

  function stockGroupsForMenu(name) {
    return Object.entries(stockGroups)
      .filter(([, config]) => config.menuNames.has(name))
      .map(([group]) => group);
  }

  function menuStockRemaining(state, name) {
    const stocks = stockGroupsForMenu(name)
      .map(group => getStock(state, group))
      .filter(stock => stock != null);
    return stocks.length ? Math.min(...stocks) : null;
  }

  function stockLimitReached(state, name) {
    return stockGroupsForMenu(name).some(group => {
      const stock = getStock(state, group);
      return stock != null && cartStockUnits(state, group) >= stock;
    });
  }

  function pruneCart(state) {
    [...cart.keys()].forEach(menuId => {
      const menu = state.menu.find(item => item.id === menuId);
      if (!menu || menu.soldOut || !menu.active) {
        cart.delete(menuId);
        cartOptions.delete(menuId);
      }
    });
  }

  function renderMenu(state) {
    pruneCart(state);
    $('#booth-name').textContent = state.settings.boothName;
    const waitingTeams = state.orders.filter(order => ['payment_pending', 'confirmed', 'cooking'].includes(order.status)).length;
    $('#wait-time').textContent = state.settings.isOpen
      ? (waitingTeams ? `지금 주문하면 앞에 ${waitingTeams}팀` : '지금 주문하면 바로 접수돼요')
      : '지금은 주문 준비 중이에요';
    const available = state.menu.filter(item => !item.soldOut && menuStockRemaining(state, item.name) !== 0);
    $('#menu-count').textContent = `${available.length}개 메뉴`;

    if (!state.settings.isOpen || !state.menu.length) {
      $('#menu-grid').innerHTML = `<div class="empty-state customer-empty">${state.settings.isOpen ? '판매 메뉴를 준비하고 있습니다.' : '지금은 주문을 받지 않습니다.'}</div>`;
      return;
    }

    $('#menu-grid').innerHTML = state.menu.map(item => {
      const quantity = cart.get(item.id) || 0;
      const safeName = escapeHtml(item.name);
      const safeDescription = escapeHtml(item.description);
      const image = escapeHtml(item.image || './assets/menu-placeholder.svg');
      const supportsNoCucumber = ['김치말이국수', '세트메뉴'].includes(item.name);
      const noCucumber = Boolean(cartOptions.get(item.id)?.noCucumber);
      const stockRemaining = menuStockRemaining(state, item.name);
      const sharedStockOut = stockRemaining === 0;
      const unavailable = item.soldOut || sharedStockOut;
      const reachedStockLimit = stockLimitReached(state, item.name);
      const stockLabel = item.name === '세트메뉴' ? '세트 가능' : '남은 수량';
      const stockText = stockRemaining != null && item.stockVisible
        ? `<div class="prep-speed">${stockLabel} · ${stockRemaining}개</div>`
        : '';
      return `<article class="menu-card ${unavailable ? 'sold-out' : ''}">
        <img src="${image}" alt="${safeName} 사진">
        ${unavailable ? '<span class="sold-out-label">품절</span>' : ''}
        <div class="menu-info"><h3>${safeName}</h3><p>${safeDescription || '&nbsp;'}</p>
          <div class="prep-speed prep-speed-${item.prepSpeed}">소요시간 · ${prepSpeedLabels[item.prepSpeed] || prepSpeedLabels.normal}</div>
          ${stockText}
          <div class="menu-card-footer"><strong>${store.formatPrice(item.price)}</strong>
            <div class="quantity-control">
              ${quantity ? `<button class="minus" type="button" data-menu="${item.id}" data-change="-1" aria-label="${safeName} 수량 줄이기">−</button><span>${quantity}</span>` : ''}
              <button type="button" data-menu="${item.id}" data-change="1" aria-label="${safeName} 담기" style="${quantity ? '' : 'width:auto;padding:0 10px'}" ${unavailable || reachedStockLimit || quantity >= MAX_QUANTITY ? 'disabled' : ''}>${quantity ? '+' : '담기'}</button>
            </div>
            ${supportsNoCucumber && quantity ? `<label class="menu-option"><input type="checkbox" data-no-cucumber="${item.id}" ${noCucumber ? 'checked' : ''}><span>오이 빼기</span></label>` : ''}
          </div></div></article>`;
    }).join('');

    document.querySelectorAll('[data-menu][data-change]').forEach(button => {
      button.addEventListener('click', () => {
        const menuId = button.dataset.menu;
        const currentState = store.getState();
        const menu = currentState.menu.find(item => item.id === menuId);
        const change = Number(button.dataset.change);
        if (change > 0 && menu && stockLimitReached(currentState, menu.name)) {
          const stockRemaining = menuStockRemaining(currentState, menu.name);
          toast(menu.stockVisible
            ? `${menu.name}은 ${stockRemaining}개만 더 주문할 수 있어요.`
            : `${menu.name}은 더 담을 수 없어요.`);
          return;
        }
        const previous = cart.get(menuId) || 0;
        const next = Math.min(MAX_QUANTITY, Math.max(0, previous + change));
        if (next === MAX_QUANTITY && previous === MAX_QUANTITY) toast(`메뉴당 최대 ${MAX_QUANTITY}개까지 담을 수 있어요.`);
        if (next) cart.set(menuId, next);
        else {
          cart.delete(menuId);
          cartOptions.delete(menuId);
        }
        renderMenu(store.getState());
        renderCartBar(store.getState());
      });
    });

    document.querySelectorAll('[data-no-cucumber]').forEach(input => {
      input.addEventListener('change', () => {
        cartOptions.set(input.dataset.noCucumber, { noCucumber: input.checked });
      });
    });
  }

  function renderCartBar(state) {
    const count = getCartItems().reduce((sum, item) => sum + item.quantity, 0);
    $('#cart-count').textContent = count;
    $('#cart-total').textContent = count ? `${store.formatPrice(cartTotal(state))} · 장바구니 보기` : '메뉴를 담아주세요';
    $('#open-cart').disabled = count === 0;
  }

  function renderReview(state) {
    const rows = getCartItems().map(item => {
      const menu = state.menu.find(menuItem => menuItem.id === item.menuId);
      if (!menu) return '';
      const option = item.noCucumber ? '<small class="summary-option">오이 빼기</small>' : '';
      return `<div class="summary-row summary-item"><div>${escapeHtml(menu.name)}${option}<small>${store.formatPrice(menu.price)} × ${item.quantity}</small></div><strong>${store.formatPrice(menu.price * item.quantity)}</strong></div>`;
    }).join('');
    const total = cartTotal(state);
    $('#order-summary').innerHTML = `${rows}<div class="summary-row total"><span>총 금액</span><strong>${store.formatPrice(total)}</strong></div>`;
    $('#review-total').textContent = store.formatPrice(total);
  }

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
      : '상태는 자동으로 갱신됩니다. 주문 변경이나 취소는 부스 직원에게 주문번호를 보여주세요.';
  }

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

  function selectPaymentTab(name) {
    document.querySelectorAll('[data-payment-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.paymentTab === name));
    document.querySelectorAll('.payment-panel').forEach(panel => panel.classList.toggle('active', panel.id === `payment-${name}`));
  }
  document.querySelectorAll('[data-payment-tab]').forEach(button => button.addEventListener('click', () => selectPaymentTab(button.dataset.paymentTab)));

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
    cartOptions.clear();
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
  });

  document.querySelector('.eyebrow').textContent = 'ORDER_SYS / QR';
  $('#payer-name').nextElementSibling.textContent = '입금 확인에만 사용하며 손님 대기열에는 표시하지 않습니다. 행사 종료 후 삭제합니다.';
  selectPaymentTab('account');

  store.ready().then(() => {
    activeOrderId = store.getCurrentOrderId();
    const initialState = store.getState();
    renderMenu(initialState);
    renderCartBar(initialState);
    if (activeOrderId && findActiveOrder(initialState)) {
      renderQueue(initialState);
      showStep('queue');
    }
  }).catch(error => {
    renderMenu(store.getState());
    renderCartBar(store.getState());
    toast(`연결 실패: ${error.message}`);
  });
})();
