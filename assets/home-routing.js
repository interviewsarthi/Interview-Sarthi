/* Preserve old Live links and payment returns when the root becomes the product hub. */
(() => {
  'use strict';
  function redirect(url) {
    window.sarthiHomeRedirecting = true;
    location.replace(url);
  }
  if (location.protocol === 'http:' && /(^|\.)interviewsarthi\.com$/.test(location.hostname)) {
    redirect('https://' + location.host + location.pathname + location.search + location.hash);
    return;
  }
  const params = new URLSearchParams(location.search);
  if (params.has('license_key') || params.has('order_id')) {
    redirect('/thanks.html' + location.search + location.hash);
    return;
  }
  const oldLiveSections = new Set(['pricing','hidden','why','features','how','install','faq','proof','promo','tools']);
  function routeLegacyLink() {
    if (oldLiveSections.has(location.hash.slice(1)) || params.get('utm_medium') === 'mobile_handoff') {
      redirect('/live/' + location.search + location.hash);
    }
  }
  routeLegacyLink();
  addEventListener('hashchange', routeLegacyLink);
})();
