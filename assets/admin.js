(function () {
  const store = window.MockStore;
  let activeFilter = 'active';
  let toastTimer;
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  const labels = {
    payment_pending: '입금 확인', confirmed: '주문 접수', cooking: '조리 중',
    ready: '수령 가능', picked_up: '수령 완료', cancelled: '취소'
  };
  const nextAction = {
    payment_pending: { label: '입금 확인', next: 'confirmed' },
    confirmed: { label: '조리 시작', next: 'cooking' },
    cooking: { label: '수령 가능', next: 'ready' },
    ready: { label: '수령 완료', next: 'picked_up' }
  };

  function toast(message) {
    const element = $('#toast'); element.textContent = message; element.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 1600);
  }

  function matchesFilter(order) {
    if (activeFilter === 'active') return ['payment_pending', 'confirmed', 'cooking', 'ready'].includes(order.status);
    if (activeFilter === 'done') return ['picked_up', 'cancelled'].includes(order.status);
    return order.status === activeFilter;
  }

  function elapsed(iso) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    return `${Math.floor(minutes / 60)}시간 전`;
  }

  function renderMetrics(state) {
    $('#metric-payment').textContent = state.orders.filter(order => order.status === 'payment_pending').length;
    $('#metric-cooking').textContent = state.orders.filter(order => ['confirmed', 'cooking'].includes(order.status)).length;
    $('#metric-ready').textContent = state.orders.filter(order => order.status === 'ready').length;
    $('#metric-done').textContent = state.orders.filter(order => ['picked_up', 'cancelled'].includes(order.status)).length;
  }

  function itemSummary(order, state) {
    return order.items.map(item => {
      const menu = state.menu.find(menuItem => menuItem.id === item.menuId);
      return `${menu ? menu.name : '삭제된 메뉴'} ${item.quantity}`;
    }).join(' · ');
  }

  function renderOrders(state) {
    const orders = state.orders.filter(matchesFilter).sort((a, b) => {
      if (activeFilter === 'done') return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      return a.orderNumber - b.orderNumber;
    });
    if (!orders.length) { $('#admin-orders').innerHTML = '<div class="empty-state">이 상태의 주문이 없습니다.</div>'; return; }
    $('#admin-orders').innerHTML = orders.map(order => {
      const action = nextAction[order.status];
      const restoreAction = order.status === 'cancelled' ? { label: '주문 복구', next: 'confirmed' } : order.status === 'picked_up' ? { label: '수령 취소', next: 'ready' } : null;
      const statusClass = order.status === 'ready' ? 'ready' : order.status === 'cooking' ? 'cooking' : '';
      return `<article class="admin-order">
        <div class="admin-order-number">#${order.orderNumber}</div>
        <div class="admin-order-detail"><strong>${escapeHtml(itemSummary(order, state))}</strong><small>${escapeHtml(order.payerName)} · ${elapsed(order.createdAt)} · ${store.formatPrice(store.calculateOrderTotal(order, state))}</small></div>
        <span class="status-pill ${statusClass}">${labels[order.status]}</span>
        <div class="order-actions">
          ${action ? `<button class="next" type="button" data-order="${order.id}" data-status="${action.next}">${action.label}</button>` : ''}
          ${restoreAction ? `<button class="next" type="button" data-order="${order.id}" data-status="${restoreAction.next}">${restoreAction.label}</button>` : ''}
          ${!['picked_up', 'cancelled'].includes(order.status) ? `<button class="cancel" type="button" data-order="${order.id}" data-status="cancelled">취소</button>` : ''}
        </div>
      </article>`;
    }).join('');

    document.querySelectorAll('[data-order][data-status]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.status === 'cancelled' && !window.confirm('이 주문을 취소할까요? 취소 후 완료·취소 탭에서 복구할 수 있습니다.')) return;
      const order = store.updateOrderStatus(button.dataset.order, button.dataset.status);
      if (order) toast(`#${order.orderNumber} · ${labels[order.status]} 처리`);
    }));
  }

  function renderMenu(state) {
    $('#admin-menu-list').innerHTML = state.menu.map(item => `<div class="admin-menu-item"><div><strong>${escapeHtml(item.name)}</strong><small>${store.formatPrice(item.price)}</small></div><button class="stock-button ${item.soldOut ? 'sold-out' : ''}" type="button" data-stock="${item.id}">${item.soldOut ? '품절 해제' : '품절 처리'}</button></div>`).join('');
    document.querySelectorAll('[data-stock]').forEach(button => button.addEventListener('click', () => {
      const item = store.toggleSoldOut(button.dataset.stock);
      if (item) toast(`${item.name} · ${item.soldOut ? '품절' : '판매 재개'}`);
    }));
  }

  function render(state) { renderMetrics(state); renderOrders(state); renderMenu(state); }

  $('#order-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]'); if (!button) return;
    activeFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderOrders(store.getState());
  });

  $('#reset-demo').addEventListener('click', () => {
    if (!window.confirm('모든 임시 주문과 품절 상태를 초기화할까요?')) return;
    store.resetDemo(); toast('데모 데이터를 초기화했습니다.');
  });
  document.querySelector('.eyebrow').textContent = '부스 관리';
  store.subscribe(render);
  render(store.getState());
})();
