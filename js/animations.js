/**
 * A-Math Game — Visual Animations
 *
 * Animation helpers for tile placement, score counter, bingo celebration, etc.
 */

(function () {
  /**
   * Animate a score counter from oldValue to newValue with a rolling effect.
   * @param el: the DOM element (.score-value)
   * @param oldValue: starting number
   * @param newValue: ending number
   * @param duration: in milliseconds (default 600)
   */
  function animateScore(el, oldValue, newValue, duration) {
    duration = duration || 600;
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - t, 3);
      const value = Math.round(oldValue + (newValue - oldValue) * ease);
      el.textContent = value.toLocaleString('en-US');
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /**
   * Show a confetti burst on the screen (used for Bingo celebration).
   */
  function confettiBurst(durationMs) {
    durationMs = durationMs || 2000;
    const COLORS = ['#fbbf24', '#3b82f6', '#ef4444', '#10b981', '#a855f7', '#f97316'];
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const numPieces = 60;
    for (let i = 0; i < numPieces; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
      piece.style.left = Math.random() * 100 + '%';
      piece.style.animationDelay = Math.random() * 0.3 + 's';
      piece.style.animationDuration = (1.5 + Math.random() * 1) + 's';
      piece.style.width = (6 + Math.random() * 6) + 'px';
      piece.style.height = (6 + Math.random() * 6) + 'px';
      piece.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      container.appendChild(piece);
    }

    setTimeout(() => container.remove(), durationMs);
  }

  /**
   * Show a big "BINGO!" banner centered on screen.
   */
  function bingoBanner(text) {
    const banner = document.createElement('div');
    banner.className = 'bingo-banner';
    banner.textContent = text || 'BINGO!';
    document.body.appendChild(banner);

    // Trigger animation
    setTimeout(() => banner.classList.add('show'), 10);

    // Remove after animation
    setTimeout(() => {
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 400);
    }, 1800);
  }

  /**
   * Pulse highlight a board cell (for showing recently played tiles).
   * @param row, col
   */
  function pulseCell(row, col) {
    const cellEl = document.querySelector('.amath-cell[data-row="' + row + '"][data-col="' + col + '"]');
    if (!cellEl) return;
    cellEl.classList.add('cell-pulse');
    setTimeout(() => cellEl.classList.remove('cell-pulse'), 800);
  }

  /**
   * Pulse highlight multiple cells (entire equation).
   */
  function pulseCells(cells) {
    for (const c of cells) pulseCell(c.row, c.col);
  }

  window.AMath = window.AMath || {};
  window.AMath.animations = {
    animateScore: animateScore,
    confettiBurst: confettiBurst,
    bingoBanner: bingoBanner,
    pulseCell: pulseCell,
    pulseCells: pulseCells,
  };
})();
