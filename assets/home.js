(() => {
  'use strict';
  const paths = {
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    play: '<path d="m9 5 10 7-10 7V5Z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M10 12h4v3h-4z"/>',
    wave: '<path d="M3 10v4M7.5 6v12M12 3v18M16.5 7v10M21 10v4"/>',
    'eye-off': '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.4A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.8M6.2 6.2A20 20 0 0 0 2 12s4 7 10 7a10 10 0 0 0 5.8-1.8"/>',
    key: '<circle cx="8" cy="8" r="4.5"/><path d="m11.5 11.5 9 9m-3-3 3-3m-6 0 2-2"/>',
  };
  const icon = key => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[key] || paths.arrow}</svg>`;
  function paint(root = document) {
    root.querySelectorAll('[data-icon]:not([data-painted])').forEach(el => {
      el.innerHTML = icon(el.dataset.icon); el.dataset.painted = 'true';
    });
  }
  const products = {
    apply: {
      name: 'Apply Sarthi', eyebrow: 'APPLY SARTHI · JOB SEARCH', title: 'Fewer job tabs.\nMore relevant jobs.',
      description: 'Browse jobs collected from different portals and company career pages. Upload your CV to see which fit your experience, then use Chrome autofill to apply faster.',
      points: ['Filter by website, location and remote work', 'Tailor your CV and cover letter for a role', 'Track applications; review before submitting'],
      url: '/apply/', views: [
        {label:'Jobs from multiple sites',src:'/assets/apply-app-current.png',alt:'Current public Apply Sarthi job list with job-site and location filters',caption:'Current public Apply interface. Job listings and counts are a captured snapshot.'}
      ]
    },
    prep: {
      name: 'Prep Sarthi', eyebrow: 'PREP SARTHI · MOCK INTERVIEWS', title: "See which answers\nneed more practice.",
      description: 'Get feedback on the answers you struggled with, and see a stronger way to answer. Your report also reviews your pace, pauses and filler words.',
      points: ['Questions based on your CV and target role', 'Follow-ups when your answer needs more detail', 'Practise on your phone or computer'],
      url: '/prep/', views: [
        {label:'Feedback report',src:'/assets/prep-report-existing.png',alt:'Existing published Prep Sarthi report with scores, feedback and a stronger answer',caption:'Report published on the existing Prep Sarthi website. Example feedback, not a promised result.'},
        {label:'Interview setup',src:'/assets/prep-app-current.png',alt:'Current Prep Sarthi setup with CV, job description, language and role fields',caption:'Current Prep app setup. Add your CV and target role before a voice mock interview.'}
      ]
    },
    live: {
      name: 'Live Sarthi', eyebrow: 'LIVE SARTHI · INTERVIEW ANSWERS', title: 'You see the answers.\nYour screen share hides them.*',
      description: 'Read the question and answer suggestions alongside your call. Switch views to see the answer panel present on your screen and absent in the shared view.',
      points: ['Answers start in about 1 second; timing varies', 'Based on your CV, with no bot joining the call', 'Supported Windows capture; check your setup first'],
      url:'/live/',views:[
        {label:'Your screen',src:'/assets/shot-you-see.webp',alt:'Existing Live Sarthi website demonstration with answer panel visible on your screen',caption:'Your screen: the Live answer panel is visible. Existing website demonstration.'},
        {label:'Shared screen',src:'/assets/shot-they-see.webp',alt:'Existing Live Sarthi website demonstration of a shared view with no answer panel',caption:'Shared screen: the answer panel is excluded. Requires supported Windows screen capture.'}
      ]
    }
  };
  let active = 'live';
  let activeView = 0;
  const tabs = [...document.querySelectorAll('[data-media-tab]')];
  const panel = document.getElementById('media-panel');
  const picture = document.getElementById('product-screenshot');
  const options = document.getElementById('media-options');
  const dialog = document.getElementById('media-dialog');
  const dialogBody = document.getElementById('dialog-body');
  function showView(index) {
    const product = products[active];
    activeView = product.views[index] ? index : 0;
    const view = product.views[activeView];
    picture.src = view.src; picture.alt = view.alt;
    // Intrinsic ratios differ; retain a natural aspect ratio for every source.
    picture.removeAttribute('width'); picture.removeAttribute('height');
    document.getElementById('media-caption').textContent = view.caption;
    options.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === activeView)));
  }
  function showProduct(key, scroll = false) {
    if (!Object.hasOwn(products, key)) return;
    active = key;
    const product = products[key];
    tabs.forEach(tab => { tab.setAttribute('aria-selected', String(tab.dataset.mediaTab === key)); tab.tabIndex = tab.dataset.mediaTab === key ? 0 : -1; });
    panel.setAttribute('aria-labelledby', 'tab-' + key);
    document.getElementById('media-eyebrow').textContent = product.eyebrow;
    document.getElementById('media-title').textContent = product.title;
    document.getElementById('media-description').textContent = product.description;
    document.getElementById('media-points').replaceChildren(...product.points.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    const link = document.getElementById('media-product-link');
    link.href = product.url; link.dataset.product = key; link.innerHTML = `Explore ${product.name} ${icon('arrow')}`;
    options.replaceChildren(...product.views.map((view, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = view.label;
      button.setAttribute('aria-pressed', String(index === 0)); button.addEventListener('click', () => showView(index)); return button;
    }));
    showView(0);
    if (scroll) {
      tabs.find(tab => tab.dataset.mediaTab === key).focus({preventScroll:true});
      document.getElementById('see-inside').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }
  }
  tabs.forEach(tab => {
    tab.addEventListener('click', () => showProduct(tab.dataset.mediaTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); let index = tabs.indexOf(tab);
      if (event.key === 'Home') index = 0; else if (event.key === 'End') index = tabs.length - 1;
      else index = (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tabs[index].focus(); showProduct(tabs[index].dataset.mediaTab);
    });
  });
  document.querySelectorAll('[data-show-product]').forEach(button => button.addEventListener('click', () => showProduct(button.dataset.showProduct, true)));
  function openVideo() {
    document.getElementById('dialog-title').textContent = 'Live Sarthi · Product video';
    const video = document.createElement('video');
    video.controls = true; video.playsInline = true; video.muted = true; video.preload = 'metadata';
    video.poster = '/assets/promo-poster.jpg'; video.src = '/assets/promo-24s.mp4';
    video.setAttribute('aria-label', 'Existing illustrated Live Sarthi promotional video');
    const caption = document.createElement('p'); caption.textContent = 'Existing illustrated promotional video from InterviewSarthi. Use the player controls to turn sound on or pause.';
    dialogBody.replaceChildren(video,caption); dialog.showModal(); video.play().catch(() => {});
  }
  document.querySelectorAll('[data-open-video]').forEach(button => button.addEventListener('click',openVideo));
  document.getElementById('media-zoom').addEventListener('click', () => {
    const view = products[active].views[activeView];
    document.getElementById('dialog-title').textContent = products[active].name + ' · ' + view.label;
    const image = document.createElement('img'); image.src = view.src; image.alt = view.alt;
    const caption = document.createElement('p'); caption.textContent = view.caption;
    dialogBody.replaceChildren(image,caption); dialog.showModal();
  });
  document.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.querySelector('video')?.pause(); dialogBody.replaceChildren(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  const menu = document.getElementById('main-menu'); const toggle = document.querySelector('.nav-toggle');
  function closeMenu() { menu.classList.remove('open'); toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-label','Open menu'); }
  toggle.addEventListener('click', () => {
    const open = !menu.classList.contains('open'); menu.classList.toggle('open',open);
    toggle.setAttribute('aria-expanded',String(open)); toggle.setAttribute('aria-label',open ? 'Close menu' : 'Open menu');
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.classList.contains('open')) { closeMenu(); toggle.focus(); } });
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click',closeMenu));
  document.addEventListener('click', event => { if (!event.target.closest('.site-nav')) closeMenu(); });

  paint(); showProduct('live');
})();
