(() => {
  const dataEl = document.getElementById('series-data');
  const seasonSelect = document.getElementById('season-select');
  const episodeList = document.getElementById('episode-list');
  const frame = document.getElementById('player-iframe');
  const note = document.getElementById('player-note');
  const sourceList = document.getElementById('source-list');
  const seasonRating = document.getElementById('season-rating');
  const seriesViews = document.getElementById('series-views');
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

  if (!dataEl || !seasonSelect || !episodeList) return;

  let series;
  try {
    series = JSON.parse(dataEl.textContent || '{}');
  } catch (_) {
    return;
  }

  const seriesTitle = typeof series.title === 'string' ? series.title.trim() : '';
  const seasons = Array.isArray(series.seasons) ? series.seasons : [];
  if (!seasons.length) return;
  const params = new URLSearchParams(window.location.search || '');
  const requestedSeasonRaw = params.get('season');
  const requestedEpisodeRaw = params.get('episode');
  const requestedSeason = requestedSeasonRaw ? Number.parseInt(requestedSeasonRaw, 10) : null;
  const requestedEpisode = requestedEpisodeRaw ? Number.parseInt(requestedEpisodeRaw, 10) : null;
  let pendingEpisode = Number.isFinite(requestedEpisode) ? requestedEpisode : null;
  const seriesSlug = (document.body && document.body.dataset ? document.body.dataset.movieId : '') || '';
  const seriesKey = seriesTitle
    ? `ultrapelis_series_season_${seriesTitle.toLowerCase().replace(/\s+/g, '-')}`
    : 'ultrapelis_series_season';

  const buildSeriesDetails = () => {
    if (document.getElementById('series-details-title')) return;
    const synopsisTitle = document.getElementById('synopsis-title');
    const synopsisSection = synopsisTitle ? synopsisTitle.closest('.movie-details') : null;
    if (!synopsisSection) return;
    const totalSeasons = seasons.length;
    const totalEpisodes = seasons.reduce((sum, season) => {
      const list = Array.isArray(season.episodes) ? season.episodes : [];
      return sum + list.length;
    }, 0);
    const lastSeason = seasons[seasons.length - 1]?.number || totalSeasons;
    const ratings = seasons
      .map((season) => Number(season.rating))
      .filter((value) => Number.isFinite(value));
    const avgRating = ratings.length
      ? `${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)}/10`
      : 'N/D';

    const section = document.createElement('section');
    section.className = 'movie-details';
    section.setAttribute('aria-labelledby', 'series-details-title');
    section.innerHTML = `
      <h2 id="series-details-title">Ficha tecnica</h2>
      <div class="info-grid">
        <div class="info-card"><h3>Temporadas</h3><p>${totalSeasons}</p></div>
        <div class="info-card"><h3>Episodios</h3><p>${totalEpisodes || 'N/D'}</p></div>
        <div class="info-card"><h3>Ultima temporada</h3><p>${lastSeason}</p></div>
        <div class="info-card"><h3>Calificacion promedio</h3><p>${avgRating}</p></div>
        <div class="info-card info-card-views" data-views="true">
          <span class="views-icon" aria-hidden="true">👁</span>
          <h3>Vistas</h3>
          <p id="series-views-count" aria-live="polite">0</p>
        </div>
      </div>
    `;
    synopsisSection.parentNode.insertBefore(section, synopsisSection);
    if (seriesViews) {
      seriesViews.textContent = '';
      seriesViews.style.display = 'none';
    }
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

  const updateSeriesViews = () => {
    if (!seriesSlug) return;
    const key = `ultrapelis_series_views_${seriesSlug}`;
    const viewedSessionKey = `ultrapelis_series_viewed_${seriesSlug}`;
    const formatter = new Intl.NumberFormat('es-MX');
    const current = Number.parseInt(safeGet(localStorage, key) || '0', 10) || 0;
    const alreadyCounted = safeGet(sessionStorage, viewedSessionKey) === '1';
    const next = alreadyCounted ? current : current + 1;
    if (!alreadyCounted) {
      safeSet(localStorage, key, String(next));
      safeSet(sessionStorage, viewedSessionKey, '1');
    }
    const viewsTarget = document.getElementById('series-views-count') || seriesViews;
    if (viewsTarget) {
      if (viewsTarget === seriesViews) {
        viewsTarget.textContent = `Vistas: ${formatter.format(next)}`;
      } else {
        viewsTarget.textContent = formatter.format(next);
      }
    }

    if (!alreadyCounted) {
      const slug = encodeURIComponent(seriesSlug);
      fetch(`/api/series/${slug}/view`, { method: 'POST' })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!payload || typeof payload.views !== 'number') return;
          const merged = Math.max(payload.views, next);
          if (viewsTarget) {
            if (viewsTarget === seriesViews) {
              viewsTarget.textContent = `Vistas: ${formatter.format(merged)}`;
            } else {
              viewsTarget.textContent = formatter.format(merged);
            }
          }
          safeSet(localStorage, key, String(merged));
        })
        .catch(() => {});
    }
  };

  buildSeriesDetails();
  updateSeriesViews();

  const setPlayerSource = (src, label) => {
    if (frame) {
      frame.src = src || '';
    }
    if (note) {
      note.textContent = src
        ? `Reproduciendo ${label || 'fuente seleccionada'}.`
        : 'Episodio sin enlace. Agrega un enlace legal.';
    }
  };

  const renderSources = (sources, fallbackSrc) => {
    if (!sourceList) return;
    sourceList.innerHTML = '';
    const list = Array.isArray(sources) && sources.length
      ? sources
      : fallbackSrc
        ? [{ label: 'Servidor 1', src: fallbackSrc }]
        : [];
    if (!list.length) return;
    list.forEach((source, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'server-btn';
      btn.textContent = source.label || `Servidor ${idx + 1}`;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.server-btn.is-active').forEach((el) => {
          el.classList.remove('is-active');
        });
        btn.classList.add('is-active');
        setPlayerSource(source.src || '', source.label || `Servidor ${idx + 1}`);
      });
      sourceList.appendChild(btn);
    });
    const firstBtn = sourceList.querySelector('.server-btn');
    if (firstBtn) firstBtn.classList.add('is-active');
    const first = list[0];
    setPlayerSource(first ? first.src : '', first ? first.label : '');
  };

  const setCastStatus = (text) => {
    if (!castStatus) return;
    castStatus.textContent = text;
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

  const getActiveEpisodeLabel = () => {
    const active = episodeList ? episodeList.querySelector('.episode-card.is-active') : null;
    if (!active) return 'Episodio no seleccionado';
    const number = active.querySelector('.episode-number')?.textContent?.trim() || '';
    const title = active.querySelector('.episode-title')?.textContent?.trim() || '';
    return [number, title].filter(Boolean).join(' - ');
  };

  const getActiveSourceLabel = () => {
    const active = sourceList ? sourceList.querySelector('.server-btn.is-active') : null;
    return active ? active.textContent.trim() : 'Servidor no seleccionado';
  };

  const buildReportText = () => {
    const titleEl = document.getElementById('series-title');
    const title = titleEl ? titleEl.textContent.trim() : 'Serie';
    const email = reportEmail ? reportEmail.value.trim() : '';
    const message = reportMessage ? reportMessage.value.trim() : '';
    const url = window.location.href;
    return [
      `Serie: ${title}`,
      `Episodio: ${getActiveEpisodeLabel()}`,
      `Servidor: ${getActiveSourceLabel()}`,
      `URL: ${url}`,
      email ? `Correo: ${email}` : 'Correo: (no proporcionado)',
      'Problema:',
      message || '(sin descripcion)',
    ].join('\n');
  };

  const setReportStatus = (text) => {
    if (!reportStatus) return;
    reportStatus.textContent = text;
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
        if (reportMailto && typeof reportMailto.click === 'function') {
          reportMailto.click();
        }
      }
      setReportStatus('Abriendo tu app de correo para enviar el reporte.');
    });
  }

  const addTrailerSource = async () => {};

  const renderEpisodes = (season) => {
    episodeList.innerHTML = '';
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    if (seasonRating) {
      const rating = Number(season.rating || 0);
      seasonRating.textContent = rating > 0 ? `Calificacion temporada: ${rating.toFixed(1)}/10` : '';
    }
    episodeList.classList.toggle('is-scroll', episodes.length >= 5);
    if (!episodes.length) {
      const empty = document.createElement('div');
      empty.className = 'episode-empty';
      empty.textContent = 'Aun no hay episodios cargados para esta temporada.';
      episodeList.appendChild(empty);
      if (note) {
        note.textContent = 'Agrega enlaces de episodios para habilitar la reproduccion.';
      }
      if (frame) {
        frame.src = 'about:blank';
      }
      if (sourceList) {
        sourceList.innerHTML = '';
      }
      return;
    }
    episodes.forEach((ep, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'episode-card';
      card.setAttribute('role', 'listitem');
      const episodeNumber = Number(ep.number || idx + 1);
      card.dataset.episodeNumber = String(episodeNumber);
      card.dataset.seasonNumber = String(season.number || idx + 1);
      card.dataset.src = ep.src || '';
      const epRating = Number(ep.rating || 0);
      const ratingLabel = epRating > 0 ? `${epRating.toFixed(1)}/10` : '';
      card.innerHTML = `
        <div class="episode-number">T${season.number} • E${episodeNumber}</div>
        <div class="episode-title">${ep.title || `Episodio ${episodeNumber}`}</div>
        ${ratingLabel ? `<div class="episode-rating">Calificacion: ${ratingLabel}</div>` : ''}
      `;
      card.addEventListener('click', () => {
        document.querySelectorAll('.episode-card.is-active').forEach((el) => {
          el.classList.remove('is-active');
        });
        card.classList.add('is-active');
        renderSources(ep.sources, card.dataset.src || '');
      });
      episodeList.appendChild(card);
    });
    let targetCard = null;
    if (pendingEpisode != null) {
      targetCard = episodeList.querySelector(`.episode-card[data-episode-number="${pendingEpisode}"]`);
      pendingEpisode = null;
    }
    const firstCard = targetCard || episodeList.querySelector('.episode-card');
    if (firstCard) firstCard.click();

    if (episodes.length >= 5) {
      requestAnimationFrame(() => {
        const cards = Array.from(episodeList.querySelectorAll('.episode-card'));
        const fourth = cards[3];
        if (!fourth) return;
        const listRect = episodeList.getBoundingClientRect();
        const fourthRect = fourth.getBoundingClientRect();
        const height = Math.max(0, fourthRect.bottom - listRect.top);
        episodeList.style.maxHeight = `${Math.ceil(height)}px`;
      });
    } else {
      episodeList.style.maxHeight = '';
    }
  };

  seasons.forEach((season, idx) => {
    const option = document.createElement('option');
    option.value = String(idx);
    option.textContent = `Temporada ${season.number || idx + 1}`;
    seasonSelect.appendChild(option);
  });

  const getSavedSeasonIndex = () => {
    try {
      const raw = localStorage.getItem(seriesKey);
      const idx = Number.parseInt(raw || '', 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < seasons.length) return idx;
    } catch (_) {}
    return 0;
  };

  const getRequestedSeasonIndex = () => {
    if (!Number.isFinite(requestedSeason)) return null;
    const byNumber = seasons.findIndex((season) => Number(season.number) === requestedSeason);
    if (byNumber >= 0) return byNumber;
    const byIndex = requestedSeason - 1;
    if (byIndex >= 0 && byIndex < seasons.length) return byIndex;
    return null;
  };

  const saveSeasonIndex = (idx) => {
    try {
      localStorage.setItem(seriesKey, String(idx));
    } catch (_) {}
  };

  seasonSelect.addEventListener('change', () => {
    const idx = Number.parseInt(seasonSelect.value, 10);
    const season = seasons[idx] || seasons[0];
    saveSeasonIndex(idx);
    renderEpisodes(season);
  });

  const requestedIdx = getRequestedSeasonIndex();
  const initialIdx = requestedIdx != null ? requestedIdx : getSavedSeasonIndex();
  seasonSelect.value = String(initialIdx);
  renderEpisodes(seasons[initialIdx] || seasons[0]);
})();
