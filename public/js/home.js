// Homepage interactions: chalk-dust hero canvas, pointer spotlight, card tilt, scroll reveals, count-up.
// Everything is decorative and switches off for visitors who prefer reduced motion.
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------- Scroll reveal ----------
  const revealEls = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach((el) => io.observe(el));
  }

  // ---------- Count-up numbers ----------
  const counters = document.querySelectorAll('[data-count]');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const countIo = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        countIo.unobserve(e.target);
        const target = Number(e.target.dataset.count);
        const start = performance.now();
        const duration = 1200;
        const tick = (now) => {
          const t = Math.min(1, (now - start) / duration);
          e.target.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
          if (t < 1) requestAnimationFrame(tick);
        };
        e.target.textContent = '0';
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => countIo.observe(el));
  }

  // ---------- Card tilt (mouse only) ----------
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('.tilt').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
        card.style.setProperty('--gx', `${(x + 0.5) * 100}%`);
        card.style.setProperty('--gy', `${(y + 0.5) * 100}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  // ---------- Hero: spotlight + chalk dust ----------
  const hero = document.querySelector('.hero');
  const canvas = document.querySelector('.hero-canvas');
  if (!hero || !canvas) return;

  const pointer = { x: -9999, y: -9999, active: false };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.active = true;
    hero.style.setProperty('--mx', `${pointer.x}px`);
    hero.style.setProperty('--my', `${pointer.y}px`);
    hero.style.setProperty('--px', ((pointer.x / r.width) - 0.5).toFixed(3));
    hero.style.setProperty('--py', ((pointer.y / r.height) - 0.5).toFixed(3));
  });
  hero.addEventListener('pointerleave', () => { pointer.active = false; });

  if (reduceMotion) return;

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  let particles = [];

  function resize() {
    width = hero.clientWidth;
    height = hero.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(110, (width * height) / 14000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.15 + Math.random() * 0.45), // chalk drifts upward
      r: 0.8 + Math.random() * 2.2,
      orange: Math.random() < 0.28,
    }));
  }

  let running = false;
  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      // Pointer pushes nearby dust away
      if (pointer.active) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 16000) {
          const f = (16000 - d2) / 16000;
          p.vx += (dx / Math.sqrt(d2 + 1)) * f * 0.35;
          p.vy += (dy / Math.sqrt(d2 + 1)) * f * 0.35;
        }
      }
      p.vx *= 0.96;
      p.vy = p.vy * 0.96 - 0.012;
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.orange ? 'rgba(255, 95, 31, 0.75)' : 'rgba(255, 255, 255, 0.45)';
      ctx.fill();
    }

    // Faint lines between dust near the pointer
    if (pointer.active) {
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        if (Math.hypot(a.x - pointer.x, a.y - pointer.y) > 170) continue;
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 90) {
            ctx.strokeStyle = `rgba(255, 95, 31, ${(1 - d / 90) * 0.5})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }
    requestAnimationFrame(frame);
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  // Only animate while the hero is on screen and the tab is visible
  let heroVisible = true;
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; setRunning(heroVisible && !document.hidden); }).observe(hero);
  document.addEventListener('visibilitychange', () => setRunning(heroVisible && !document.hidden));
  setRunning(true);
})();
