/* Progressive enhancements. The core page and links work without JavaScript. */
(() => {
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('#main-nav');
  if (toggle && menu) {
    document.documentElement.classList.add('js');
    const closeMenu = () => { menu.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.classList.contains('open')) { closeMenu(); toggle.focus(); }
    });
  }
  const preview = document.querySelector('.screenshot-link');
  const dialog = document.querySelector('#screenshot-dialog');
  if (preview && dialog && typeof dialog.showModal === 'function') {
    preview.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      dialog.showModal();
    });
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const showcase = document.querySelector('.product-visual');
  const tablist = document.querySelector('.preview-tabs');
  const tabs = [...document.querySelectorAll('.preview-tabs button')];
  const panels = [...document.querySelectorAll('.preview-panel')];
  const play = document.querySelector('.preview-play');
  const caption = document.querySelector('.preview-caption');
  const captions = [
    'Actual app screenshot. Listings change over time.',
    'Illustrative example. Your matches depend on your CV.',
    'Illustrative example. Chrome on a computer required.'
  ];
  let selected = 0;
  let paused = reducedMotion.matches;
  let inView = false;
  let hovering = false;
  let timer;
  const interval = 6500;

  function schedule() {
    clearTimeout(timer);
    showcase.classList.remove('is-playing');
    const canPlay = !paused && !hovering && inView && !document.hidden &&
      !showcase.contains(document.activeElement) && !dialog?.open;
    play.setAttribute('aria-label', paused ? 'Play preview' : 'Pause preview');
    play.innerHTML = paused ? '<span aria-hidden="true">▷</span> Play' : '<span aria-hidden="true">Ⅱ</span> Pause';
    showcase.dataset.paused = String(paused);
    if (canPlay) {
      // Restart the progress animation together with the panel timer.
      void showcase.offsetWidth;
      showcase.classList.add('is-playing');
      timer = setTimeout(() => select((selected + 1) % tabs.length), interval);
    }
  }
  function select(index, focus = false) {
    selected = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    showcase.dataset.step = String(index);
    caption.textContent = captions[index];
    if (focus) tabs[index].focus();
    schedule();
  }
  if (showcase && tablist && tabs.length && play) {
    tablist.hidden = false;
    play.hidden = false;
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => { paused = true; select(index); });
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next !== undefined) {
          event.preventDefault();
          paused = true;
          select(next, true);
        }
      });
    });
    play.addEventListener('click', () => { paused = !paused; schedule(); });
    showcase.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovering = true; schedule(); } });
    showcase.addEventListener('pointerleave', () => { hovering = false; schedule(); });
    showcase.addEventListener('focusin', schedule);
    showcase.addEventListener('focusout', () => setTimeout(schedule, 0));
    document.addEventListener('visibilitychange', schedule);
    dialog?.addEventListener('close', schedule);
    reducedMotion.addEventListener('change', () => { paused = true; schedule(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        inView = entries[0].isIntersecting;
        schedule();
      }, { threshold: 0.35 }).observe(showcase);
    }
    select(0);
  }

  // Animate on entry without ever hiding content while waiting for JavaScript.
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        reveal.unobserve(entry.target);
        if (!reducedMotion.matches && entry.target.animate) {
          entry.target.animate([
            { opacity: 0.35, transform: 'translateY(22px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ], { duration: 600, easing: 'cubic-bezier(.2,.65,.3,1)' });
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('[data-reveal], .steps li').forEach(el => reveal.observe(el));
    const navObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const link = menu?.querySelector(`a[href="#${entry.target.id}"]`);
        if (link) {
          if (entry.isIntersecting) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        }
      });
    }, { rootMargin: '-15% 0px -60% 0px' });
    document.querySelectorAll('#features, #how-it-works, #faq').forEach(el => navObserver.observe(el));
  }
  const header = document.querySelector('.site-header');
  const progress = document.querySelector('.reading-progress');
  let scrollQueued = false;
  function updateScroll() {
    const distance = document.documentElement.scrollHeight - innerHeight;
    if (progress) progress.style.transform = `scaleX(${distance > 0 ? scrollY / distance : 0})`;
    header?.classList.toggle('scrolled', scrollY > 16);
    scrollQueued = false;
  }
  addEventListener('scroll', () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateScroll); }
  }, { passive: true });
  addEventListener('resize', updateScroll);
  updateScroll();
})();
