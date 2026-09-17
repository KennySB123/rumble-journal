// Theme toggle, chart hover, and the rotating saying. No dependencies.
(function () {
  // ---- theme
  const root = document.documentElement;
  const btn = document.querySelector('.theme-toggle');
  const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = () => root.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light');
  if (btn) btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  // ---- rotating saying on the home page
  const sayingBox = document.querySelector('.saying[data-sayings]');
  if (sayingBox) {
    try {
      const all = JSON.parse(sayingBox.getAttribute('data-sayings'));
      const pick = all[Math.floor(Math.random() * all.length)];
      sayingBox.querySelector('blockquote p').innerHTML = pick.text;
      const a = sayingBox.querySelector('footer a');
      a.textContent = pick.ref; a.href = pick.href;
    } catch (e) {}
  }

  // ---- chart hover: nearest point by x, crosshair + tooltip
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  document.querySelectorAll('.chart svg[data-chart]').forEach((svg) => {
    let c; try { c = JSON.parse(svg.getAttribute('data-chart')); } catch (e) { return; }
    if (!c.points.length) return;
    const fig = svg.closest('.chart');
    const tip = fig.querySelector('.tooltip');
    const hover = svg.querySelector('.hover');
    const line = hover.querySelector('.crosshair');
    const dot = hover.querySelector('.hover-dot');
    const pw = c.W - c.L - c.R, ph = c.H - c.T - c.B;
    const sx = (x) => c.L + ((x - c.xlo) / (c.xhi - c.xlo || 1)) * pw;
    const sy = (y) => c.T + ph - ((y - c.ylo) / (c.yhi - c.ylo || 1)) * ph;
    const fmtY = (y) => (c.yLabels ? (c.yLabels[y] || y) : fmt(y));
    const show = (evt) => {
      const r = svg.getBoundingClientRect();
      const vx = ((evt.clientX - r.left) / r.width) * c.W;
      const x = c.xlo + ((vx - c.L) / pw) * (c.xhi - c.xlo);
      let best = c.points[0];
      for (const p of c.points) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      const px = sx(best.x), py = sy(best.y);
      line.setAttribute('x1', px); line.setAttribute('x2', px);
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      hover.removeAttribute('hidden');
      tip.innerHTML = '<b>' + fmtY(best.y) + '</b> ' + (c.yLabels ? '' : c.yLabel.toLowerCase() + ' ') + 'at <b>' + fmt(best.x) + ' h</b>' +
        '<span class="muted">' + fmtDate(best.date) + (best.note ? ' · ' + best.note : '') + '</span>';
      tip.style.left = (px / c.W) * r.width + 'px';
      tip.style.top = (py / c.H) * r.height + 'px';
      tip.removeAttribute('hidden');
    };
    const hide = () => { hover.setAttribute('hidden', ''); tip.setAttribute('hidden', ''); };
    svg.addEventListener('mousemove', show);
    svg.addEventListener('touchstart', (e) => show(e.touches[0]), { passive: true });
    svg.addEventListener('touchmove', (e) => show(e.touches[0]), { passive: true });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchend', hide);
  });
})();
