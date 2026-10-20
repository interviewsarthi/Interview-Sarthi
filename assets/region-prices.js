// Indian visitors see rupees; everyone else the USD prices the checkout
// actually charges them (Dodo). Every price in the page carries its USD text
// in data-intl. The choice is shared with /live/ through the same
// localStorage key, so a visitor sees one currency across both pages.
(() => {
  'use strict';
  const GEO = 'https://license.interviewsarthi.com/geo';
  const KEY = 'sarthi-region';
  const els = document.querySelectorAll('[data-intl]');
  const name = document.getElementById('region-name');
  const swap = document.getElementById('region-swap');
  let current = 'in';

  function apply(region) {
    current = region;
    els.forEach(el => {
      if (!el.hasAttribute('data-in')) el.setAttribute('data-in', el.textContent);
      el.textContent = el.getAttribute(region === 'intl' ? 'data-intl' : 'data-in');
    });
    document.documentElement.dataset.region = region;
    if (name) name.textContent = region === 'intl' ? 'outside India (USD)' : 'India';
    if (swap) swap.textContent = region === 'intl' ? 'In India? See prices in ₹' : 'Outside India? See prices in $';
  }
  function remember(region) {
    try { localStorage.setItem(KEY, region); } catch (e) { /* private mode */ }
  }

  if (swap) swap.addEventListener('click', event => {
    event.preventDefault();
    const next = current === 'intl' ? 'in' : 'intl';
    apply(next); remember(next);
  });

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  if (saved === 'in' || saved === 'intl') return apply(saved);

  // A first guess from the clock, so a visitor abroad does not watch rupees
  // turn into dollars; the licence server's country (what checkout uses) decides.
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* old browser */ }
  if (zone && zone !== 'Asia/Kolkata' && zone !== 'Asia/Calcutta') apply('intl');
  fetch(GEO).then(r => r.json()).then(d => {
    if (d && d.country) apply(d.country === 'IN' ? 'in' : 'intl');
  }).catch(() => { /* no answer: keep the guess */ });
})();
