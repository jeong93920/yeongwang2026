(function () {
  'use strict';

  // 주소에 ?demo가 있으면 실제 Supabase 대신 브라우저 안에서만 도는 데모 저장소를 불러옵니다.
  // 사용법: <script src="./assets/boot.js?v=..." data-page="customer-supabase.js?v=..." data-demo="demo-store.js?v=..." data-store="supabase-store.js?v=..."></script>
  const script = document.currentScript;
  const base = script.src.replace(/boot\.js(\?.*)?$/, '');
  const isDemo = new URLSearchParams(window.location.search).has('demo');
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js';

  const sources = isDemo
    ? [base + script.dataset.demo]
    : [SUPABASE_JS, base + 'supabase-config.js', base + script.dataset.store];
  sources.push(base + script.dataset.page);

  // 동적으로 넣은 script는 기본이 비동기라서, async=false로 넣은 순서대로 실행되게 합니다.
  sources.forEach(src => {
    const element = document.createElement('script');
    element.src = src;
    element.async = false;
    document.body.appendChild(element);
  });
})();
