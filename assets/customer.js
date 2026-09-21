(function () {
  const store = window.MockStore;
  const cart = new Map();
  let activeOrderId = store.getCurrentOrderId();
  let toastTimer;

  const statusLabels = {
    payment_pending: '입금 확인 중', confirmed: '주문 접수', cooking: '조리 중',
    ready: '수령해 주세요', picked_up: '수령 완료', cancelled: '주문 취소'
  };

  const steps = ['menu', 'review', 'payment', 'queue'];
  const $ = selector => document.querySelector(selector);
  const MAX_QUANTITY = 20;
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
    toastTimer = setTimeout(() => element.classList.remove('show'), 1600);
  }

  function getCartItems() {
    return [...cart.entries()].filter(([, quantity]) => quantity > 0).map(([menuId, quantity]) => ({ menuId, quantity }));
  }

  function renderMenu(state) {
    $('#booth-name').textContent = state.settings.boothName;
    const waitingTeams = state.orders.filter(order => ['payment_pending', 'confirmed', 'cooking'].includes(order.status)).length;
    $('#wait-time').textContent = waitingTeams ? `현재 ${waitingTeams}팀 대기` : '바로 주문 가능';
    $('#menu-count').textContent = `${state.menu.filter(item => !item.soldOut).length}개 메뉴`;
    $('#menu-grid').innerHTML = state.menu.map(item => {
      const quantity = cart.get(item.id) || 0;
      const image = item.image.replace('./assets/', './assets/');
      const safeName = escapeHtml(item.name);
      const safeDescription = escapeHtml(item.description);
      return `<article class="menu-card ${item.soldOut ? 'sold-out' : ''}">
        <img src="${escapeHtml(image)}" alt="${safeName} 사진 자리 표시자">
        ${item.soldOut ? '<span class="sold-out-label">품절</span>' : ''}
        <div class="menu-info"><h3>${safeName}</h3><p>${safeDescription}</p>
          <div class="menu-card-footer"><strong>${store.formatPrice(item.price)}</strong>
            <div class="quantity-control">
              ${quantity ? `<button class="minus" type="button" data-menu="${item.id}" data-change="-1" aria-label="${safeName} 수량 줄이기">−</button><span>${quantity}</span>` : ''}
              <button type="button" data-menu="${item.id}" data-change="1" aria-label="${safeName} 담기" style="${quantity ? '' : 'width:auto;padding:0 10px'}" ${item.soldOut || quantity >= MAX_QUANTITY ? 'disabled' : ''}>${quantity ? '+' : '담기'}</button>
            </div>
          </div></div></article>`;
    }).join('');

    document.querySelectorAll('[data-menu][data-change]').forEach(button => {
      button.addEventListener('click', () => {
        const menuId = button.dataset.menu;
        const previous = cart.get(menuId) || 0;
        const next = Math.min(MAX_QUANTITY, Math.max(0, previous + Number(button.dataset.change)));
        if (next === MAX_QUANTITY && previous === MAX_QUANTITY) toast(`메뉴당 최대 ${MAX_QUANTITY}개까지 담을 수 있어요.`);
        if (next) cart.set(menuId, next); else cart.delete(menuId);
        renderMenu(store.getState());
        renderCartBar(store.getState());
      });
    });
  }

  function cartTotal(state) {
    return getCartItems().reduce((total, item) => {
      const menu = state.menu.find(menuItem => menuItem.id === item.menuId);
      return total + (menu ? menu.price * item.quantity : 0);
    }, 0);
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
      return `<div class="summary-row summary-item"><div>${escapeHtml(menu.name)}<small>${store.formatPrice(menu.price)} × ${item.quantity}</small></div><strong>${store.formatPrice(menu.price * item.quantity)}</strong></div>`;
    }).join('');
    const total = cartTotal(state);
    $('#order-summary').innerHTML = `${rows}<div class="summary-row total"><span>총 금액</span><strong>${store.formatPrice(total)}</strong></div>`;
    $('#review-total').textContent = store.formatPrice(total);
  }

  function findActiveOrder(state) { return state.orders.find(order => order.id === activeOrderId); }

  function renderPayment(state, order) {
    $('#payment-order-number').textContent = `#${order.orderNumber}`;
    document.querySelectorAll('[data-order-total]').forEach(element => element.textContent = store.formatPrice(store.calculateOrderTotal(order, state)));
    $('#bank-name').textContent = `${state.settings.bankName} · ${state.settings.accountHolder}`;
    $('#account-number').textContent = state.settings.accountNumber;
  }

  function ordersForStatus(state, statuses) {
    return state.orders.filter(order => statuses.includes(order.status)).sort((a, b) => a.orderNumber - b.orderNumber);
  }

  function renderQueue(state) {
    const order = findActiveOrder(state);
    if (!order) { activeOrderId = null; store.clearCurrentOrder(); showStep('menu'); return; }
    const ahead = state.orders.filter(item => item.orderNumber < order.orderNumber && ['payment_pending', 'confirmed', 'cooking'].includes(item.status)).length;
    const status = statusLabels[order.status] || order.status;
    const ready = order.status === 'ready';
    $('#my-order-card').className = `my-order-card ${ready ? 'ready' : ''}`;
    $('#my-order-card').innerHTML = `<div><small>내 주문번호</small><div class="my-order-number">#${order.orderNumber}</div></div><div class="my-order-status"><small>현재 상태</small><strong>${ready ? '수령해 주세요' : status}</strong>${['confirmed', 'cooking'].includes(order.status) ? `<small>앞에 ${ahead}팀</small>` : ''}</div>`;

    const groups = [
      { label: '수령 가능', className: 'ready', statuses: ['ready'] },
      { label: '조리 중', className: 'cooking', statuses: ['cooking'] },
      { label: '접수 순서', className: '', statuses: ['confirmed', 'payment_pending'] }
    ];
    $('#public-queue').innerHTML = groups.map(group => {
      const orders = ordersForStatus(state, group.statuses);
      const numbers = orders.length ? orders.map(item => `<span class="queue-number ${item.id === order.id ? 'mine' : ''}">${item.orderNumber}${item.id === order.id ? ' · 나' : ''}</span>`).join('') : '<span class="subtle">없음</span>';
      return `<div class="queue-row ${group.className}"><strong>${group.label}</strong><div class="queue-numbers">${numbers}</div></div>`;
    }).join('');
    $('#queue-notice').textContent = ready ? '주문이 준비됐습니다. 주문번호 화면을 보여주고 받아가세요.' : '상태는 자동으로 갱신됩니다. 주문 변경이나 취소는 부스 직원에게 주문번호를 보여주세요.';
  }

  $('#open-cart').addEventListener('click', () => { renderReview(store.getState()); showStep('review'); });
  document.querySelector('[data-back="menu"]').addEventListener('click', () => showStep('menu'));
  $('#create-order').addEventListener('click', () => {
    const payerName = $('#payer-name').value.trim();
    if (!payerName) { toast('입금자 이름을 입력해 주세요.'); $('#payer-name').focus(); return; }
    try {
      const order = store.createOrder({ payerName, items: getCartItems() });
      activeOrderId = order.id;
      renderPayment(store.getState(), order);
      showStep('payment');
    } catch (error) { toast(error.message); }
  });

  function selectPaymentTab(name) {
    document.querySelectorAll('[data-payment-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.paymentTab === name));
    document.querySelectorAll('.payment-panel').forEach(panel => panel.classList.toggle('active', panel.id === `payment-${name}`));
  }
  document.querySelectorAll('[data-payment-tab]').forEach(button => button.addEventListener('click', () => selectPaymentTab(button.dataset.paymentTab)));

  $('#copy-account').addEventListener('click', async event => {
    const number = $('#account-number').textContent;
    try { await navigator.clipboard.writeText(number); } catch (_) {
      const input = document.createElement('textarea'); input.value = number; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove();
    }
    event.currentTarget.textContent = '복사했어요 ✓'; toast('계좌번호를 복사했습니다.');
    setTimeout(() => { event.currentTarget.textContent = '계좌번호 복사'; }, 1500);
  });

  $('#payment-done').addEventListener('click', () => { renderQueue(store.getState()); showStep('queue'); });
  const paymentAgain = document.createElement('button');
  paymentAgain.type = 'button'; paymentAgain.className = 'text-button new-order-button'; paymentAgain.textContent = '송금 정보 다시 보기';
  $('#queue-notice').insertAdjacentElement('afterend', paymentAgain);
  paymentAgain.addEventListener('click', () => {
    const order = findActiveOrder(store.getState());
    if (order) { renderPayment(store.getState(), order); showStep('payment'); }
  });
  $('#new-order').addEventListener('click', () => {
    if (!window.confirm('현재 주문은 취소되지 않습니다. 다른 주문을 새로 시작할까요?')) return;
    store.clearCurrentOrder(); activeOrderId = null; cart.clear(); $('#payer-name').value = '';
    renderMenu(store.getState()); renderCartBar(store.getState()); showStep('menu');
  });

  store.subscribe(state => {
    renderMenu(state); renderCartBar(state);
    if (activeOrderId && $('#step-queue').classList.contains('active')) renderQueue(state);
  });

  document.querySelector('.eyebrow').textContent = 'QR 주문';
  $('#payer-name').nextElementSibling.textContent = '입금 확인에만 사용하며 손님 대기열에는 표시하지 않습니다. 행사 종료 후 삭제합니다.';
  selectPaymentTab('account');
  const initialState = store.getState();
  renderMenu(initialState); renderCartBar(initialState);
  if (activeOrderId && findActiveOrder(initialState)) { renderQueue(initialState); showStep('queue'); }
})();
