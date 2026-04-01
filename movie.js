(() => {
  const ua = (navigator.userAgent || "").toLowerCase();
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTvDevice =
    /smart-tv|smarttv|hbbtv|tizen|web0s|webos|viera|aft|roku|googletv|fire tv|android tv|bravia|crkey/i.test(
      ua
    );
  const lowCpu = Number(navigator.hardwareConcurrency || 0) > 0 && Number(navigator.hardwareConcurrency || 0) <= 4;
  const lowMem = Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory || 0) <= 2;
  const isCompatMode = prefersReducedMotion || isTvDevice || lowCpu || lowMem;

  const buttons = Array.from(document.querySelectorAll('.server-btn'));
  const frame = document.getElementById('player-iframe');
  const note = document.getElementById('player-note');
  const backLink = document.querySelector('.topbar .card-button[href*="index.html"]');
  const reportForm = document.getElementById('report-form');
  const reportEmail = document.getElementById('report-email');
  const reportMessage = document.getElementById('report-message');
  const reportCopy = document.getElementById('report-copy');
  const reportMailto = document.getElementById('report-mailto');
  const reportStatus = document.getElementById('report-status');
  const castOpenApp = document.getElementById('cast-open-app');
  const castCopyPage = document.getElementById('cast-copy-page');
  const castGetApp = document.getElementById('cast-get-app');
  const castStatus = document.getElementById('cast-status');
  const fallbackList = [
    '../../img/poster-fallback.svg',
    '../img/poster-fallback.svg',
    '/img/poster-fallback.svg',
  ].join('|');

  const applyPosterFallback = (img) => {
    if (!img) return;
    const swap = () => {
      const list = (img.dataset.fallbacks || img.dataset.fallback || fallbackList || '')
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean);
      const idx = Number.parseInt(img.dataset.fallbackIndex || '0', 10) || 0;
      const next = list[idx] || null;
      if (!next) return;
      img.dataset.fallbackIndex = String(idx + 1);
      img.src = next;
    };
    if (!img.getAttribute('src') || img.getAttribute('src').trim() === '') {
      swap();
    }
    img.addEventListener('error', swap, { once: true });
  };

  const getMovieId = () => {
    const bodyId = document.body.getAttribute('data-movie-id');
    if (bodyId) return bodyId;
    const path = window.location.pathname.split('/').pop() || '';
    const fromPath = path.replace(/\.html$/i, '');
    return fromPath || 'pelicula';
  };

  const safeGet = (storage, key) => {
    try {
      return storage.getItem(key);
    } catch (_) {
      return null;
    }
  };

  const safeSet = (storage, key, value) => {
    try {
      storage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  };

  const updateViews = () => {
    const movieId = getMovieId();
    const key = `ultrapelis_views_${movieId}`;
    const viewedSessionKey = `ultrapelis_viewed_${movieId}`;
    const formatter = new Intl.NumberFormat('es-MX');
    const current = Number.parseInt(safeGet(localStorage, key) || '0', 10) || 0;

    // Avoid counting multiple times when user refreshes the same tab.
    const alreadyCountedInSession = safeGet(sessionStorage, viewedSessionKey) === '1';
    const next = alreadyCountedInSession ? current : current + 1;

    if (!alreadyCountedInSession) {
      safeSet(localStorage, key, String(next));
      safeSet(sessionStorage, viewedSessionKey, '1');
    }

    const grid = document.querySelector('.info-grid');
    if (!grid) return;

    let card = grid.querySelector('[data-views]');
    if (!card) {
      card = document.createElement('div');
      card.className = 'info-card info-card-views';
      card.setAttribute('data-views', 'true');
      const icon = document.createElement('span');
      icon.className = 'views-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '👁';
      const h3 = document.createElement('h3');
      h3.textContent = 'Vistas';
      const p = document.createElement('p');
      p.id = 'views-count';
      p.setAttribute('aria-live', 'polite');
      card.appendChild(icon);
      card.appendChild(h3);
      card.appendChild(p);
      grid.appendChild(card);
    }

    const countEl = card.querySelector('#views-count');
    if (countEl) {
      countEl.textContent = formatter.format(next);
    }

    if (!alreadyCountedInSession) {
      const slug = encodeURIComponent(movieId);
      fetch(`/api/peliculas/${slug}/view`, { method: 'POST' })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!payload || typeof payload.views !== 'number') return;
          const mergedViews = Math.max(payload.views, next);
          if (countEl) {
            countEl.textContent = formatter.format(mergedViews);
          }
          safeSet(localStorage, key, String(mergedViews));
        })
        .catch(() => {});
    }
  };

  updateViews();

  const enhanceInfoCards = () => {
    const grid = document.querySelector('.info-grid');
    if (!grid) return;
    grid.querySelectorAll('.info-card').forEach((card) => {
      const title = card.querySelector('h3')?.textContent?.toLowerCase() || '';
      const value = card.querySelector('p')?.textContent?.trim() || '';
      if (title.includes('reparto') || value.length >= 80) {
        card.classList.add('info-card-wide');
      }
    });
  };

  enhanceInfoCards();

  const setupBackLink = () => {
    if (!backLink) return;
    const params = new URLSearchParams(window.location.search);
    const returnParams = new URLSearchParams();
    const q = params.get('q');
    const genre = params.get('genre');
    const page = params.get('page');

    if (q) returnParams.set('q', q);
    if (genre) returnParams.set('genre', genre);
    if (page) returnParams.set('page', page);

    const baseHref = (backLink.getAttribute('href') || '../../index.html').split('?')[0];
    if (returnParams.toString()) {
      backLink.setAttribute('href', `${baseHref}?${returnParams.toString()}#catalog`);
      return;
    }
    backLink.setAttribute('href', `${baseHref}#catalog`);
  };

  setupBackLink();
  document.querySelectorAll('img').forEach((img) => applyPosterFallback(img));

  const buildReportText = () => {
    const titleEl = document.getElementById('movie-title');
    const title = titleEl ? titleEl.textContent.trim() : 'Pelicula';
    const email = reportEmail ? reportEmail.value.trim() : '';
    const message = reportMessage ? reportMessage.value.trim() : '';
    const url = window.location.href;
    return [
      `Titulo: ${title}`,
      `URL: ${url}`,
      email ? `Correo: ${email}` : 'Correo: (no proporcionado)',
      'Problema:',
      message || '(sin descripcion)',
    ].join('\n');
  };

  const setCastStatus = (text) => {
    if (!castStatus) return;
    castStatus.textContent = text;
  };

  const getActiveVideoUrl = () => {
    const activeBtn = buttons.find((btn) => btn.classList.contains('is-active')) || buttons[0];
    if (activeBtn && activeBtn.dataset && activeBtn.dataset.src) {
      return activeBtn.dataset.src;
    }
    if (frame && frame.getAttribute('src')) {
      return frame.getAttribute('src');
    }
    return '';
  };

  const buildIntentUrl = (pageUrl) => {
    const raw = String(pageUrl || '').trim();
    if (!raw) return '';
    const scheme = raw.startsWith('https://') ? 'https' : 'http';
    const noScheme = raw.replace(/^https?:\/\//, '');
    const fallback = encodeURIComponent(raw);
    return `intent://${noScheme}#Intent;scheme=${scheme};package=com.instantbits.cast.webvideo;S.browser_fallback_url=${fallback};end`;
  };

  const copyText = async (text, successMsg) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCastStatus(successMsg);
        return true;
      }
    } catch (_) {}
    setCastStatus('No se pudo copiar. Selecciona el texto manualmente.');
    return false;
  };

  if (castCopyPage) {
    castCopyPage.addEventListener('click', async () => {
      await copyText(window.location.href, 'Enlace de la pagina copiado.');
    });
  }

  if (castOpenApp) {
    castOpenApp.addEventListener('click', () => {
      const pageUrl = window.location.href;
      const intentUrl = buildIntentUrl(pageUrl);
      if (!intentUrl) {
        setCastStatus('No se pudo preparar el enlace para la app.');
        return;
      }
      const isAndroid = /android/i.test(navigator.userAgent || '');
      if (isAndroid) {
        window.location.href = intentUrl;
        setCastStatus('Abriendo Web Video Cast...');
        return;
      }
      setCastStatus('Esta opcion esta disponible en Android.');
    });
  }

  const setReportStatus = (text) => {
    if (!reportStatus) return;
    reportStatus.textContent = text;
  };

  if (reportCopy) {
    reportCopy.addEventListener('click', async () => {
      try {
        const text = buildReportText();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          setReportStatus('Reporte copiado al portapapeles.');
        } else {
          setReportStatus('No se pudo copiar. Selecciona el texto manualmente.');
        }
      } catch (_) {
        setReportStatus('No se pudo copiar. Selecciona el texto manualmente.');
      }
    });
  }

  if (!buttons.length || !frame) return;
  frame.setAttribute('loading', 'lazy');
  if (isCompatMode) {
    document.body.classList.add('compat-mode');
  }

  const setActive = (btn) => {
    buttons.forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActive(btn);
      const src = btn.dataset.src || '';
      if (src) {
        frame.src = src;
        if (note) note.textContent = 'Reproduciendo desde el servidor seleccionado.';
      } else {
        frame.src = 'about:blank';
        if (note) note.textContent = 'Servidor sin enlace. Agrega un enlace legal.';
      }
    });
  });

  const activeButton = buttons.find((btn) => btn.classList.contains('is-active')) || buttons[0];
  if (activeButton) {
    const src = activeButton.dataset.src || '';
    setActive(activeButton);
    if (src && !isCompatMode) {
      frame.src = src;
      if (note) note.textContent = 'Reproduciendo desde el servidor seleccionado.';
    } else if (src && isCompatMode) {
      frame.src = 'about:blank';
      if (note) note.textContent = 'Dispositivo en modo compatibilidad: toca un servidor para cargar el reproductor.';
    } else {
      frame.src = 'about:blank';
      if (note) note.textContent = 'Servidor sin enlace. Agrega un enlace legal.';
    }
  }

  // try to append a trailer button automatically by querying our backend
  const addTrailerButton = async () => {
    const list = document.querySelector('.server-list');
    if (!list) return;
    // don't add if one already exists
    if (list.querySelector('button[data-trailer]')) return;
    const titleEl = document.getElementById('movie-title');
    const title = titleEl ? titleEl.textContent.trim() : '';
    if (!title) return;
    try {
      const resp = await fetch(`/api/youtube-search?q=${encodeURIComponent(title + ' trailer')}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.videoId) {
        const btn = document.createElement('button');
        btn.className = 'server-btn';
        btn.type = 'button';
        btn.setAttribute('data-src', `https://www.youtube.com/embed/${data.videoId}`);
        btn.setAttribute('data-trailer', 'true');
        btn.textContent = 'Trailer';
        list.appendChild(btn);
        btn.addEventListener('click', () => {
          setActive(btn);
          frame.src = btn.dataset.src;
          if (note) note.textContent = 'Reproduciendo trailer.';
        });
      }
    } catch (_) {
      // ignore failures
    }
  };

  if (reportForm) {
    reportForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = buildReportText();
      if (!reportMessage || !reportMessage.value.trim()) {
        setReportStatus('Describe el problema para poder ayudarte.');
        return;
      }
      const subject = encodeURIComponent('Reporte de problema en Ultrapelis');
      const body = encodeURIComponent(text);
      const mailto = `mailto:soporteultrapelis@gmail.com?subject=${subject}&body=${body}`;
      if (reportMailto) {
        reportMailto.setAttribute('href', mailto);
      }
      if (typeof window !== 'undefined') {
        window.location.href = mailto;
        // Fallback: trigger the link in case the navigation is intercepted.
        if (reportMailto && typeof reportMailto.click === 'function') {
          reportMailto.click();
        }
      }
      setReportStatus('Abriendo tu app de correo para enviar el reporte.');
    });
  }

  addTrailerButton();
})();
