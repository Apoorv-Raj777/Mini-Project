// Simple component injector and small helpers
(async function inject() {
  // Determine base path: pages under /pages/ need ../components paths,
  // root pages need /components paths. We'll try both fallbacks.
  async function fetchEither(path1, path2){
    try {
      const r1 = await fetch(path1);
      if (r1.ok) return r1.text();
    } catch(e){}
    try {
      const r2 = await fetch(path2);
      if (r2.ok) return r2.text();
    } catch(e){}
    return '';
  }

  const headerHtml = await fetchEither('components/header.html', '../components/header.html');
  const footerHtml = await fetchEither('components/footer.html', '../components/footer.html');

  const headerEl = document.getElementById('header');
  const footerEl = document.getElementById('footer');
  if (headerEl && headerHtml) headerEl.innerHTML = headerHtml;
  if (footerEl && footerHtml) footerEl.innerHTML = footerHtml;

  // small nav active link highlight
  const links = document.querySelectorAll('.header-nav a');
  links.forEach(a => {
    if (window.location.pathname.includes(a.getAttribute('href').replace('../',''))) {
      a.classList.add('active');
    }
  });
})();
