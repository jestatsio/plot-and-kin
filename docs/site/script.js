/* Progressive enhancements. The full guide is available without JavaScript. */
const copyStatus = document.querySelector('#copy-status');

for (const button of document.querySelectorAll('.copy-button')) {
  if (!navigator.clipboard?.writeText) {
    button.hidden = true;
    continue;
  }

  button.addEventListener('click', async () => {
    const code = button.closest('.code-block')?.querySelector('code');
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.textContent = 'Copied';
      button.dataset.state = 'copied';
      if (copyStatus) copyStatus.textContent = 'Code copied to clipboard.';
    } catch {
      if (copyStatus) copyStatus.textContent = 'Copy was unavailable. Select the code and copy it manually.';
    }
    window.setTimeout(() => {
      button.textContent = 'Copy';
      delete button.dataset.state;
    }, 2200);
  });
}

if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.docs-rail a')];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links) {
        if (link.getAttribute('href') === `#${entry.target.id}`) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      }
    }
  }, { rootMargin: '-5% 0px -75% 0px', threshold: 0 });
  for (const section of document.querySelectorAll('.doc-section')) observer.observe(section);
}
