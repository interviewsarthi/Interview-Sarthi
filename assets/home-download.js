// Use the Windows Store directly on Windows; offer a link for the PC on other devices.
(() => {
  const windows = navigator.userAgentData ? navigator.userAgentData.platform === 'Windows' : /Windows NT/.test(navigator.userAgent);
  if (windows) return;
  const buttons = [...document.querySelectorAll('a[href*="apps.microsoft.com"]')];
  if (!buttons.length) return;
  const modal = document.createElement('dialog');
  modal.className = 'download-dialog';
  modal.setAttribute('aria-labelledby', 'download-dialog-title');
  modal.innerHTML = '<button class="download-close" type="button" aria-label="Close download help">×</button><h2 id="download-dialog-title">Get Live Sarthi on your Windows PC.</h2><p>Live runs on Windows 10/11. Copy the link and open it on your PC to start your free 30-minute trial.</p><button class="copy-live-link" type="button">Copy Live Sarthi link</button><a class="store-anyway" href="https://apps.microsoft.com/detail/9NMKQPSQ1KS8">View the Microsoft Store listing</a>';
  document.body.append(modal);
  modal.querySelector('.download-close').addEventListener('click', () => modal.close());
  modal.addEventListener('click', event => {
    if (event.target === modal) {
      const box = modal.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close();
    }
  });
  modal.querySelector('.copy-live-link').addEventListener('click', async event => {
    const url = 'https://interviewsarthi.com/live/';
    try {
      await navigator.clipboard.writeText(url);
      event.target.textContent = 'Link copied · open it on your Windows PC';
    } catch {
      const field = document.createElement('input');
      field.value = url;
      field.readOnly = true;
      field.style.cssText = 'width:100%;padding:10px;margin-top:12px;font-size:14px';
      if (!modal.querySelector('input')) { modal.append(field); field.focus(); field.select(); }
    }
  });
  buttons.forEach(button => {
    button.setAttribute('data-gated', '1');
    const label = button.querySelector('[data-download-label]');
    if (label) label.textContent = button.closest('header') ? 'Get Live Sarthi' : 'Windows only · get the app link';
    button.addEventListener('click', event => { event.preventDefault(); modal.showModal(); });
  });
})();
