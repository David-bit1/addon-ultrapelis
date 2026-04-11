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
  const scrollBehavior = isCompatMode ? "auto" : "smooth";
  const fallbackPoster = (() => {
    const path = window.location.pathname || "/";
    if (path.includes("/peliculas/")) return "../../img/poster-fallback.svg";
    return "img/poster-fallback.svg";
  })();
  if (isCompatMode) {
    document.body.classList.add("compat-mode");
  }

  // --- Selección de elementos del DOM ---
  const input = document.getElementById("search-input");
  const cards = Array.from(document.querySelectorAll(".catalog-card"));
  const seriesCards = Array.from(document.querySelectorAll(".series-card"));
  const sectionsToHide = Array.from(
    document.querySelectorAll('[data-hide-on-search="true"]')
  );
  const suggestions = document.getElementById("search-suggestions");
  const searchForm = document.querySelector(".search");
  const pagination = document.getElementById("catalog-pagination");
  const exploreBtn = document.getElementById("explore-btn");
  const catalogSection = document.getElementById("catalog");
  const trendingBtn = document.getElementById("trending-btn");
  const randomBtn = document.getElementById("random-btn");
  const chips = Array.from(document.querySelectorAll(".genre-chip"));
  const recentRow = document.getElementById("recent-row");
  const recentPrevBtn = document.querySelector('.scroll-btn[data-target="recent-row"][data-dir="left"]');
  const recentNextBtn = document.querySelector('.scroll-btn[data-target="recent-row"][data-dir="right"]');
  const catalogGrid = document.getElementById("catalog-grid");
  const heroSection = document.querySelector('.hero[data-hide-on-search="true"]');
  const featuredSection = document.querySelector('section.featured[data-hide-on-search="true"]');
  const featuredRow = document.getElementById("featured-row");
  const featuredPrevBtn = document.querySelector('.scroll-btn[data-dir="left"]');
  const featuredNextBtn = document.querySelector('.scroll-btn[data-dir="right"]');
  const seriesPopularGrid = document.getElementById("series-popular-grid");
  const seriesRecentGrid = document.getElementById("series-recent-grid");
  const seriesCatalogGrid = document.getElementById("series-grid");
  const recentEpisodesRow = document.getElementById("recent-episodes-row");
  const recentEpisodesPrevBtn = document.querySelector('.scroll-btn[data-target="recent-episodes-row"][data-dir="left"]');
  const recentEpisodesNextBtn = document.querySelector('.scroll-btn[data-target="recent-episodes-row"][data-dir="right"]');
  const mobileMq = window.matchMedia("(max-width: 900px)");
  const tabButtons = Array.from(document.querySelectorAll(".section-tabs .tab-btn"));
  const tabSections = Array.from(document.querySelectorAll("[data-tab-section]"));
  let didAutoScroll = false;
  let currentTab = "peliculas";
  let isSearchForced = false;
  let currentPage = 1;
  const pageSize = 40;
  let featuredTimer = null;
  let heroBannerTimer = null;

  if (!cards.length) return;

  const setActiveTab = (tab) => {
    if (!tab) return;
    currentTab = tab;
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", isActive);
      if (isActive) {
        btn.setAttribute("aria-current", "page");
      } else {
        btn.removeAttribute("aria-current");
      }
    });
    tabSections.forEach((section) => {
      const sections = (section.dataset.tabSection || "")
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
      section.style.display = sections.includes(tab) ? "" : "none";
    });
  };

  if (tabButtons.length && tabSections.length) {
    setActiveTab("peliculas");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveTab(btn.dataset.tab);
        currentPage = 1;
        applyFilterAndPagination();
      });
    });
  }

  // --- Funciones de utilidad ---
  const normalize = (text) => text.toLowerCase().trim();

  const getItems = () =>
    cards
      // Extrae datos de cada tarjeta de película en el catálogo.
      .map((card) => {
        const titleEl = card.querySelector(".catalog-title");
        const badgeEl = card.querySelector(".catalog-badge");
        const metaEl = card.querySelector(".catalog-meta");
        const imgEl = card.querySelector("img");
        const meta = metaEl ? metaEl.textContent : "";
        const linkEl = card.querySelector(".catalog-button");
        const href = linkEl ? linkEl.getAttribute("href") || "" : "";
        return {
          title: titleEl ? titleEl.textContent.trim() : "",
          badge: badgeEl ? badgeEl.textContent.trim() : "",
          meta,
          img: imgEl ? imgEl.getAttribute("src") : "",
          imgAlt: imgEl ? imgEl.getAttribute("alt") || "" : "",
          href,
          card,
        };
      })
      .filter((item) => item.title);

  const applyPosterFallback = (img) => {
    if (!img) return;
    const swap = () => {
      const list = (img.dataset.fallbacks || img.dataset.fallback || fallbackPoster || "")
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
      const idx = Number.parseInt(img.dataset.fallbackIndex || "0", 10) || 0;
      const next = list[idx] || null;
      if (!next) return;
      img.dataset.fallbackIndex = String(idx + 1);
      img.src = next;
    };
    if (!img.getAttribute("src") || img.getAttribute("src").trim() === "") {
      swap();
    }
    img.addEventListener("error", swap, { once: true });
  };

  const buildQuicklook = (card, config) => {
    if (!card || card.querySelector(".card-quicklook")) return;
    const title = card.querySelector(config.titleSel)?.textContent?.trim() || "Titulo";
    const meta = card.querySelector(config.metaSel)?.textContent?.trim() || "";
    const yearMatch = title.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : "";

    const quicklook = document.createElement("div");
    quicklook.className = "card-quicklook";
    quicklook.innerHTML = [
      `<div class="quicklook-title">${title}</div>`,
      `<div class="quicklook-meta">${year ? `${year} • ` : ""}${meta}</div>`,
      '<div class="quicklook-synopsis">Cargando sinopsis...</div>',
    ].join("");
    card.appendChild(quicklook);
  };

  const loadQuicklookSynopsis = async (card, config) => {
    if (!card || card.dataset.quicklookLoaded || card.dataset.quicklookLoading) return;
    const linkEl = card.querySelector(config.linkSel);
    const synopsisEl = card.querySelector(".quicklook-synopsis");
    const href = linkEl ? linkEl.getAttribute("href") || "" : "";
    if (!href || !synopsisEl) return;

    card.dataset.quicklookLoading = "1";
    try {
      const response = await fetch(href, { credentials: "same-origin" });
      if (!response.ok) throw new Error("No se pudo cargar la sinopsis");
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const synopsis =
        doc.querySelector(".synopsis")?.textContent?.trim() ||
        "Sinopsis no disponible.";
      synopsisEl.textContent = synopsis;
      card.dataset.quicklookLoaded = "1";
    } catch (error) {
      synopsisEl.textContent = "Sinopsis no disponible.";
    } finally {
      delete card.dataset.quicklookLoading;
    }
  };

  const attachQuicklook = (card, config) => {
    if (!card || card.dataset.quicklookReady) return;
    card.dataset.quicklookReady = "1";
    buildQuicklook(card, config);
    const trigger = () => loadQuicklookSynopsis(card, config);
    card.addEventListener("mouseenter", trigger, { passive: true });
    card.addEventListener("focusin", trigger);
  };

  document.querySelectorAll("img").forEach((img) => applyPosterFallback(img));

  const items = getItems();
  items.forEach((item) => applyPosterFallback(item.card.querySelector("img")));
  cards.forEach((card) =>
    attachQuicklook(card, {
      titleSel: ".catalog-title",
      metaSel: ".catalog-meta",
      linkSel: ".catalog-button",
    })
  );
  const getItemByHref = (href) => items.find((item) => item.href === href) || null;
  const applyFeaturedRanks = () => {
    // Asigna y muestra un número de ranking a las 10 películas destacadas.
    // Los 3 primeros tienen un estilo especial.
    if (!featuredRow) return;
    const featuredCards = Array.from(featuredRow.querySelectorAll(".featured-card")).slice(0, 10);
    featuredCards.forEach((card, index) => {
      card.classList.remove("rank-top-1", "rank-top-2", "rank-top-3");
      card.setAttribute("data-rank", String(index + 1));
      if (index === 0) card.classList.add("rank-top-1");
      if (index === 1) card.classList.add("rank-top-2");
      if (index === 2) card.classList.add("rank-top-3");
      const currentRank = card.querySelector(".featured-rank");
      if (currentRank) currentRank.remove();
      const posterEl = card.querySelector(".featured-poster");
      if (!posterEl) return;
      const rankEl = document.createElement("span");
      rankEl.className = "featured-rank";
      rankEl.textContent = `#${index + 1}`;
      posterEl.appendChild(rankEl);
    });
  };

  if (featuredRow) {
    featuredRow.querySelectorAll(".featured-card").forEach((card) => {
      attachQuicklook(card, {
        titleSel: ".featured-title",
        metaSel: ".featured-meta",
        linkSel: ".featured-button",
      });
    });
  }

  if (recentRow) {
    recentRow.querySelectorAll(".featured-card").forEach((card) => {
      attachQuicklook(card, {
        titleSel: ".featured-title",
        metaSel: ".featured-meta",
        linkSel: ".featured-button",
      });
    });
  }

  seriesCards.forEach((card) =>
    attachQuicklook(card, {
      titleSel: ".series-title",
      metaSel: ".series-meta",
      linkSel: ".series-button",
    })
  );

  const fillFeaturedToTenFromCatalog = () => {
    // Si la sección de destacadas tiene menos de 10 películas, la completa con películas del catálogo.
    if (!featuredRow) return;
    const existingHrefs = new Set(
      Array.from(featuredRow.querySelectorAll(".featured-button"))
        .map((link) => link.getAttribute("href") || "")
        .filter(Boolean)
    );

    if (existingHrefs.size >= 10) return;

    const catalogCandidates = items
      .filter((item) => item.href && !existingHrefs.has(item.href))
      .slice(0, 20);

    for (const item of catalogCandidates) {
      if (existingHrefs.size >= 10) break;
      const article = document.createElement("article");
      article.className = 'featured-card';
      article.setAttribute('role', 'listitem');

      const posterHtml = `<div class="featured-poster"><img alt="${item.imgAlt || item.title}" loading="lazy" src="${item.img || ''}"/></div>`;
      const titleHtml = `<div class="featured-title">${item.title}</div>`;
      const metaHtml = `<div class="featured-meta">${item.meta || 'N/D'}</div>`;
      const buttonHtml = `<a class="featured-button" href="${item.href}">Ver ahora</a>`;

      article.innerHTML = [posterHtml, titleHtml, metaHtml, buttonHtml].join('');
      featuredRow.appendChild(article);
      applyPosterFallback(article.querySelector("img"));
      attachQuicklook(article, {
        titleSel: ".featured-title",
        metaSel: ".featured-meta",
        linkSel: ".featured-button",
      });
      existingHrefs.add(item.href);
    }
  };

  const loadPopularFeatured = async () => {
    // Carga las películas populares desde la API y las renderiza en la sección de destacadas.
    // Si la API falla o devuelve menos de 10, se completa con películas del catálogo.
    if (!featuredRow) return;
    try {
      const response = await fetch("/api/populares?limit=10", { cache: "no-store" });
      if (!response.ok) return;
      const popular = await response.json();
      if (!Array.isArray(popular) || !popular.length) return;

      featuredRow.innerHTML = "";
      popular.slice(0, 10).forEach((movie, index) => {
        const title = (movie && movie.titulo ? String(movie.titulo) : "Sin titulo").trim();
        const category = movie && movie.categoria_nombre ? String(movie.categoria_nombre).trim() : "";
        const duration = movie && movie.duracion ? String(movie.duracion).trim() : "";
        const meta = [category, duration].filter(Boolean).join(" • ") || "N/D";
        const poster = movie && movie.poster_url ? String(movie.poster_url) : "";
        const categorySlug = movie && movie.categoria_slug ? String(movie.categoria_slug).trim() : "";
        const slug = movie && movie.slug ? String(movie.slug).trim() : "";
        if (!categorySlug || !slug) return;
        const href = `peliculas/${categorySlug}/${slug}.html`;

        const article = document.createElement("article");
        article.className = "featured-card";
        article.setAttribute("role", "listitem");

        const posterWrap = document.createElement("div");
        posterWrap.className = "featured-poster";
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = `Poster de ${title}`;
        img.src = poster;
        applyPosterFallback(img);
        posterWrap.appendChild(img);

        const titleEl = document.createElement("div");
        titleEl.className = "featured-title";
        titleEl.textContent = title;

        const metaEl = document.createElement("div");
        metaEl.className = "featured-meta";
        metaEl.textContent = meta;

        const link = document.createElement("a");
        link.className = "featured-button";
        link.href = href;
        link.textContent = "Ver ahora";

        article.appendChild(posterWrap);
        article.appendChild(titleEl);
        article.appendChild(metaEl);
        article.appendChild(link);
        featuredRow.appendChild(article);
        attachQuicklook(article, {
          titleSel: ".featured-title",
          metaSel: ".featured-meta",
          linkSel: ".featured-button",
        });
      });
      fillFeaturedToTenFromCatalog();
      applyFeaturedRanks();
    } catch (_) {}
  };

  const renderSeriesCard = (serie) => {
    if (!serie) return null;
    const title = (serie.title ? String(serie.title) : "Serie").trim();
    const slug = (serie.slug ? String(serie.slug) : "").trim();
    if (!slug) return null;
    const poster = serie.poster ? String(serie.poster) : "";
    const genres = Array.isArray(serie.genres) ? serie.genres : [];
    const meta = genres.length ? genres.join(" • ") : "N/D";
    const href = `series/${slug}.html`;

    const article = document.createElement("article");
    article.className = "series-card";

    const posterWrap = document.createElement("div");
    posterWrap.className = "series-poster";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = `Poster de ${title}`;
    img.src = poster;
    applyPosterFallback(img);
    posterWrap.appendChild(img);

    const titleEl = document.createElement("div");
    titleEl.className = "series-title";
    titleEl.textContent = title;

    const metaEl = document.createElement("div");
    metaEl.className = "series-meta";
    metaEl.textContent = meta;

    const link = document.createElement("a");
    link.className = "series-button";
    link.href = href;
    link.textContent = "Ver serie";

    article.appendChild(posterWrap);
    article.appendChild(titleEl);
    article.appendChild(metaEl);
    article.appendChild(link);

    attachQuicklook(article, {
      titleSel: ".series-title",
      metaSel: ".series-meta",
      linkSel: ".series-button",
    });

    return article;
  };

  const applySeriesPopularRanks = () => {
    if (!seriesPopularGrid) return;
    const cards = Array.from(seriesPopularGrid.querySelectorAll(".series-card")).slice(0, 10);
    cards.forEach((card, index) => {
      card.classList.remove("rank-top-1", "rank-top-2", "rank-top-3");
      card.setAttribute("data-rank", String(index + 1));
      if (index === 0) card.classList.add("rank-top-1");
      if (index === 1) card.classList.add("rank-top-2");
      if (index === 2) card.classList.add("rank-top-3");
      const currentRank = card.querySelector(".series-rank");
      if (currentRank) currentRank.remove();
      const posterEl = card.querySelector(".series-poster");
      if (!posterEl) return;
      const rankEl = document.createElement("span");
      rankEl.className = "series-rank";
      rankEl.textContent = `#${index + 1}`;
      posterEl.appendChild(rankEl);
    });
  };

  const getFallbackSeriesCards = () => {
    const sources = [seriesRecentGrid, seriesCatalogGrid].filter(Boolean);
    if (!sources.length) return [];
    const seen = new Set();
    const cards = [];
    sources.forEach((source) => {
      source.querySelectorAll(".series-card").forEach((card) => {
        const link = card.querySelector(".series-button");
        const href = link ? link.getAttribute("href") || "" : "";
        if (href && seen.has(href)) return;
        if (href) seen.add(href);
        cards.push(card);
      });
    });
    return cards;
  };

  const fillPopularSeriesFallback = (limit = 10) => {
    if (!seriesPopularGrid) return false;
    const cards = getFallbackSeriesCards();
    if (!cards.length) return false;
    seriesPopularGrid.innerHTML = "";
    cards.slice(0, limit).forEach((card) => {
      const clone = card.cloneNode(true);
      seriesPopularGrid.appendChild(clone);
      attachQuicklook(clone, {
        titleSel: ".series-title",
        metaSel: ".series-meta",
        linkSel: ".series-button",
      });
    });
    applySeriesPopularRanks();
    return true;
  };

  const loadPopularSeries = async () => {
    if (!seriesPopularGrid) return;
    try {
      const response = await fetch("/api/series/populares?limit=10", { cache: "no-store" });
      if (!response.ok) {
        fillPopularSeriesFallback();
        return;
      }
      const popular = await response.json();
      if (!Array.isArray(popular) || !popular.length) {
        fillPopularSeriesFallback();
        return;
      }
      seriesPopularGrid.innerHTML = "";
      popular.slice(0, 10).forEach((serie) => {
        const card = renderSeriesCard(serie);
        if (card) seriesPopularGrid.appendChild(card);
      });
      seriesPopularGrid.querySelectorAll(".series-card").forEach((card) => {
        attachQuicklook(card, {
          titleSel: ".series-title",
          metaSel: ".series-meta",
          linkSel: ".series-button",
        });
      });
      applySeriesPopularRanks();
      if (!seriesPopularGrid.children.length) {
        fillPopularSeriesFallback();
      }
    } catch (_) {}
  };
  const initialParams = new URLSearchParams(window.location.search);
  const hasInitialState =
    initialParams.has("q") || initialParams.has("genre") || initialParams.has("page");
  const navEntries =
    typeof performance !== "undefined" && performance.getEntriesByType
      ? performance.getEntriesByType("navigation")
      : [];
  const navEntry = navEntries[0];
  const isReload = navEntry && navEntry.type === "reload";

  const renderSuggestions = (query) => {
    // Muestra una lista de sugerencias de búsqueda mientras el usuario escribe.
    // Las sugerencias se basan en los títulos de las películas del catálogo.
    if (!suggestions) return;
    suggestions.innerHTML = "";
    if (!query) {
      suggestions.classList.remove("open");
      return;
    }

    const matches = items
      .filter((item) => normalize(item.title).includes(query))
      .slice(0, 8);

    if (matches.length === 0) {
      suggestions.classList.remove("open");
      return;
    }

    matches.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestion-item";
      const thumb = document.createElement("img");
      thumb.className = "suggestion-thumb";
      thumb.src = item.img || "";
      thumb.alt = item.imgAlt || item.title;
      thumb.loading = "lazy";
      applyPosterFallback(thumb);

      const text = document.createElement("span");
      text.className = "suggestion-text";
      text.textContent = item.title;

      btn.appendChild(thumb);
      btn.appendChild(text);

      if (item.badge) {
        const tag = document.createElement("span");
        tag.className = "suggestion-tag";
        tag.textContent = item.badge;
        const badgeKind = normalize(item.badge);
        if (badgeKind.includes("popular")) {
          tag.classList.add("is-popular");
        } else if (badgeKind.includes("nueva") || badgeKind.includes("nuevo")) {
          tag.classList.add("is-new");
        }
        btn.appendChild(tag);
      }

      btn.addEventListener("click", () => {
        input.value = item.title;
        currentPage = 1;
        applyFilterAndPagination();
        suggestions.classList.remove("open");
        input.focus();
        if (catalogSection) {
          catalogSection.scrollIntoView({
            behavior: scrollBehavior,
            block: "start",
          });
        }
      });

      suggestions.appendChild(btn);
    });

    suggestions.classList.add("open");
  };

  const matchesGenre = (metaText, genre) => {
    // Comprueba si los metadatos de una película (ej. "Accion • 2h 8m") contienen un género específico.
    if (genre === "all") return true;
    const genres = metaText
      .split(/[•|]/)
      .map((g) => normalize(g))
      .filter(Boolean);
    return genres.includes(normalize(genre));
  };

  const getActiveGenre = () => {
    const activeChip = chips.find((c) => c.classList.contains("is-active"));
    return activeChip ? activeChip.dataset.genre : "all";
  };

  const buildReturnSearch = () => {
    // Construye una cadena de consulta (query string) para preservar el estado de búsqueda (término, género, página).
    const params = new URLSearchParams();
    const query = input ? input.value.trim() : "";
    const genre = getActiveGenre();
    if (query) params.set("q", query);
    if (genre && genre !== "all") params.set("genre", genre);
    if (currentPage > 1) params.set("page", String(currentPage));
    return params.toString();
  };

  const applyStateFromUrl = () => {
    // Lee los parámetros de la URL y aplica el estado de búsqueda correspondiente (rellena el input, activa el chip de género, etc.).
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q");
    const genre = params.get("genre");
    const page = Number.parseInt(params.get("page") || "1", 10);

    if (input && query) {
      input.value = query;
    }

    if (genre) {
      const chip = chips.find((c) => c.dataset.genre === genre);
      if (chip) {
        chips.forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
      }
    }

    if (Number.isFinite(page) && page > 0) {
      currentPage = page;
    }
  };

  const renderPagination = (totalItems) => {
    // Dibuja los botones de paginación basados en el número total de resultados y la página actual.
    if (!pagination) return;
    pagination.innerHTML = "";
    const totalPages = Math.ceil(totalItems / pageSize);
    if (totalPages <= 1) {
      pagination.style.display = "none";
      return;
    }
    pagination.style.display = "flex";
    for (let i = 1; i <= totalPages; i += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "page-btn";
      if (i === currentPage) btn.classList.add("is-active");
      btn.textContent = String(i);
      btn.addEventListener("click", () => {
        currentPage = i;
        applyFilterAndPagination();
        if (catalogSection) {
          catalogSection.scrollIntoView({ behavior: scrollBehavior, block: "start" });
        }
      });
      pagination.appendChild(btn);
    }
  };

  const applyFilterAndPagination = () => {
    // Función principal que filtra las tarjetas de película visibles según el término de búsqueda y el género activo.
    // También maneja la lógica de paginación para mostrar solo los resultados de la página actual.
    const query = input ? normalize(input.value) : "";
    const activeChip = chips.find((c) => c.classList.contains("is-active"));
    const activeGenre = activeChip ? activeChip.dataset.genre : "all";

    const isSearching = Boolean(query || isSearchForced);
    document.body.classList.toggle("is-searching", isSearching);
    sectionsToHide.forEach((section) => {
      section.style.display = isSearching ? "none" : "";
    });

    if (currentTab === "series") {
      const filteredSeries = [];
      seriesCards.forEach((card) => {
        const titleEl = card.querySelector(".series-title");
        const metaEl = card.querySelector(".series-meta");
        const title = titleEl ? normalize(titleEl.textContent) : "";
        const meta =
          card.dataset.genres && card.dataset.genres.trim() !== ""
            ? card.dataset.genres
            : metaEl
              ? metaEl.textContent
              : "";
        const matchQuery = query === "" || title.includes(query);
        const matchGenre = matchesGenre(meta, activeGenre);
        if (matchQuery && matchGenre) filteredSeries.push(card);
      });
      seriesCards.forEach((card) => {
        card.style.display = "none";
      });
      filteredSeries.forEach((card) => {
        card.style.display = "";
      });
      if (pagination) pagination.style.display = "none";
      renderSuggestions(query);
      return;
    }

    const filtered = [];
    cards.forEach((card) => {
      const titleEl = card.querySelector(".catalog-title");
      const metaEl = card.querySelector(".catalog-meta");
      const title = titleEl ? normalize(titleEl.textContent) : "";
      const meta = metaEl ? metaEl.textContent : "";
      const matchQuery = query === "" || title.includes(query);
      const matchGenre = matchesGenre(meta, activeGenre);
      if (matchQuery && matchGenre) filtered.push(card);
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = 1;
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;

    cards.forEach((card) => {
      card.style.display = "none";
    });
    filtered.slice(start, end).forEach((card) => {
      card.style.display = "";
    });

    if (catalogGrid) {
      const isCompact = total > 0 && total <= 3;
      catalogGrid.classList.toggle("compact-results", isCompact);
    }

    if (query && catalogSection && !didAutoScroll) {
      catalogSection.scrollIntoView({ behavior: scrollBehavior, block: "start" });
      didAutoScroll = true;
    }

    renderSuggestions(query);
    renderPagination(total);
  };

  // --- Configuración de Event Listeners ---
  if (input) {
    input.addEventListener("input", () => {
      if (!input.value.trim()) {
        isSearchForced = false;
      }
      currentPage = 1;
      applyFilterAndPagination();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        isSearchForced = true;
        currentPage = 1;
        applyFilterAndPagination();
        input.blur();
      }
    });
  }

  const runSearch = (event) => {
    if (event) event.preventDefault();
    isSearchForced = true;
    currentPage = 1;
    applyFilterAndPagination();
    if (input) {
      input.blur();
    }
  };

  if (searchForm) {
    searchForm.addEventListener("submit", runSearch);
    const searchBtn = searchForm.querySelector('button[type="submit"]');
    if (searchBtn) {
      searchBtn.addEventListener("click", runSearch);
    }
  }

  if (suggestions) {
    document.addEventListener("click", (event) => {
      const target = event.target;
      const inSearchField =
        target && target.closest ? target.closest(".search-field") : null;
      if (!inSearchField) {
        suggestions.classList.remove("open");
      }
    });
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      currentPage = 1;
      applyFilterAndPagination();
    });
  });

  if (exploreBtn && catalogSection) {
    exploreBtn.addEventListener("click", () => {
      catalogSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (trendingBtn && featuredSection) {
    trendingBtn.addEventListener("click", () => {
      featuredSection.scrollIntoView({ behavior: scrollBehavior, block: "start" });
    });
  }

  if (randomBtn) {
    const closeGenrePicker = () => {
      const existing = document.getElementById("random-genre-picker");
      if (existing) existing.remove();
    };

    const pickRandomByGenre = (genre) => {
      // Filtra las películas por el género seleccionado y navega a una de ellas al azar.
      const pool = cards.filter((card) => {
        const metaEl = card.querySelector(".catalog-meta");
        const meta = metaEl ? metaEl.textContent : "";
        return matchesGenre(meta, genre);
      });

      if (!pool.length) return;

      const selected = pool[Math.floor(Math.random() * pool.length)];
      const movieLink = selected.querySelector(".catalog-button");
      if (!movieLink) return;

      const href = movieLink.getAttribute("href");
      if (!href) return;

      // Navega a la película seleccionada, preservando el estado de búsqueda actual en la URL
      // para que el botón "Volver" funcione correctamente.
      const cleanHref = href.split("?")[0].split("#")[0];
      const returnSearch = buildReturnSearch();
      window.location.href = returnSearch ? `${cleanHref}?${returnSearch}` : cleanHref;
    };

    const openGenrePicker = () => {
      // Muestra un modal para que el usuario elija un género antes de seleccionar una película aleatoria.
      closeGenrePicker();

      const overlay = document.createElement("div");
      overlay.id = "random-genre-picker";
      overlay.className = "random-genre-picker";

      const modalHtml = [
        '<div class="random-genre-modal" role="dialog" aria-modal="true" aria-label="Elegir genero para pelicula aleatoria">',
          '<h3>Elige un genero</h3>',
          '<p>Te mostrare una pelicula al azar segun el genero.</p>',
          '<div class="random-genre-options"></div>',
          '<button type="button" class="random-genre-cancel">Cancelar</button>',
        '</div>'
      ].join('');
      overlay.innerHTML = modalHtml;

      const optionsWrap = overlay.querySelector(".random-genre-options");
      const genres = chips
        .map((chip) => ({
          genre: chip.dataset.genre || "all",
          label: (chip.textContent || "").trim() || "Todos",
        }))
        .filter((item) => item.genre && item.genre !== "all");

      const seenGenres = new Set();
      genres.forEach((item) => {
        if (seenGenres.has(item.genre)) return;
        seenGenres.add(item.genre);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "random-genre-option";
        btn.textContent = item.label;
        btn.addEventListener("click", () => {
          closeGenrePicker();
          pickRandomByGenre(item.genre);
        });
        optionsWrap.appendChild(btn);
      });

      overlay.querySelector(".random-genre-cancel")?.addEventListener("click", closeGenrePicker);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeGenrePicker();
      });

      document.body.appendChild(overlay);
    };

    randomBtn.addEventListener("click", () => {
      openGenrePicker();
    });
  }

  // --- Lógica para el carrusel de "Destacadas" ---
  const getFeaturedStep = () => {
    if (!featuredRow) return 240;
    const firstCard = featuredRow.querySelector(".featured-card");
    if (!firstCard) return 240;
    const styles = window.getComputedStyle(featuredRow);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "16") || 16;
    return firstCard.getBoundingClientRect().width + gap;
  };

  const scrollFeaturedBy = (direction) => {
    if (!featuredRow) return;
    const maxScrollLeft = featuredRow.scrollWidth - featuredRow.clientWidth;
    if (maxScrollLeft <= 0) return;
    const step = getFeaturedStep();
    let nextLeft = featuredRow.scrollLeft + step * direction;
    if (direction > 0 && nextLeft >= maxScrollLeft - 2) {
      nextLeft = 0;
    } else if (direction < 0 && nextLeft <= 0) {
      nextLeft = maxScrollLeft;
    }
      featuredRow.scrollTo({ left: nextLeft, behavior: scrollBehavior });
  };

  const stopFeaturedAuto = () => {
    if (!featuredTimer) return;
    window.clearInterval(featuredTimer);
    featuredTimer = null;
  };

  const startFeaturedAuto = () => {
    if (!featuredRow || featuredTimer) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || mobileMq.matches) return;
    if (isCompatMode) return;
    featuredTimer = window.setInterval(() => {
      scrollFeaturedBy(1);
    }, 4200);
  };

  const pauseFeaturedAutoTemporarily = () => {
    stopFeaturedAuto();
    window.setTimeout(startFeaturedAuto, 5200);
  };

  if (featuredRow) {
    fillFeaturedToTenFromCatalog();
    applyFeaturedRanks();
    loadPopularFeatured();
    loadPopularSeries();

    featuredNextBtn?.addEventListener("click", () => {
      scrollFeaturedBy(1);
      pauseFeaturedAutoTemporarily();
    });

    featuredPrevBtn?.addEventListener("click", () => {
      scrollFeaturedBy(-1);
      pauseFeaturedAutoTemporarily();
    });

    featuredRow.addEventListener("pointerenter", stopFeaturedAuto);
    featuredRow.addEventListener("pointerleave", startFeaturedAuto);
    featuredRow.addEventListener("touchstart", pauseFeaturedAutoTemporarily, {
      passive: true,
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopFeaturedAuto();
      } else {
        startFeaturedAuto();
      }
    });

    mobileMq.addEventListener("change", () => {
      if (mobileMq.matches) {
        stopFeaturedAuto();
      } else {
        startFeaturedAuto();
      }
    });

    startFeaturedAuto();
  }

  if (recentRow) {
    const RECENT_LIMIT = 20;
    let lastRecentHrefs = new Set();
    
    const renderRecentCards = (recentItems) => {
      const limited = recentItems.slice(0, RECENT_LIMIT);
      
      recentRow.innerHTML = "";
      limited.forEach((item) => {
        if (!item || !item.href || !item.title) return; // Salta si faltan datos esenciales.
        const article = document.createElement("article");
        article.className = "featured-card";
        article.setAttribute("role", "listitem");

        const posterHtml = `<div class="featured-poster"><img alt="${item.imgAlt}" loading="lazy" src="${item.img || ''}"/></div>`;
        const titleHtml = `<div class="featured-title">${item.title}</div>`;
        const metaHtml = `<div class="featured-meta">${item.meta || 'N/D'}</div>`;
        const buttonHtml = `<a class="featured-button" href="${item.href}">Ver ahora</a>`;

        article.innerHTML = [posterHtml, titleHtml, metaHtml, buttonHtml].join('');
        recentRow.appendChild(article);
        applyPosterFallback(article.querySelector("img"));
      });
      
      // Actualizar set de hrefs para detectar cambios
      lastRecentHrefs = new Set(limited.map(item => item.href).filter(Boolean));
    };

    const renderRecentFallback = () => {
      // Como alternativa si la API falla, ordena las películas localmente
      // usando la fecha de modificación del archivo HTML.
      const recentItems = items
        .filter((item) => item.href)
        .map((item) => {
          const mtime = item.card
            ? Number(item.card.getAttribute('data-mtime') || '0')
            : 0;
          return { ...item, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, RECENT_LIMIT);
      renderRecentCards(recentItems);
    };

    const loadRecentFromApi = async () => {
      // Carga las películas más recientes desde la API y las renderiza.
      try {
        const response = await fetch(`/api/recientes?limit=${RECENT_LIMIT}`, { cache: "no-store" });
        if (!response.ok) {
          renderRecentFallback();
          return;
        }
        const recent = await response.json();
        if (!Array.isArray(recent) || !recent.length) {
          renderRecentFallback();
          return;
        }
        
        const recentItems = recent
          .map((movie) => {
            const categorySlug = movie && movie.categoria_slug ? String(movie.categoria_slug).trim() : "";
            const slug = movie && movie.slug ? String(movie.slug).trim() : "";
            if (!categorySlug || !slug) return null;
            const href = `peliculas/${categorySlug}/${slug}.html`;
            const existing = getItemByHref(href);
            const title = movie?.titulo ? String(movie.titulo).trim() : existing?.title || "";
            if (!title) return null;
            const item = {
              href,
              title,
              meta:
                [
                  movie?.categoria_nombre ? String(movie.categoria_nombre).trim() : "",
                  movie?.duracion ? String(movie.duracion).trim() : "",
                ]
                  .filter(Boolean)
                  .join(" • ") || existing?.meta || "N/D",
              img: movie && movie.poster_url ? String(movie.poster_url) : existing?.img || "",
              imgAlt: `Poster de ${title}`,
            };
            return item;
          })
          .filter(Boolean);
        
        if (!recentItems.length) return renderRecentFallback();
        
        renderRecentCards(recentItems.slice(0, RECENT_LIMIT));
      } catch (_) {
        renderRecentFallback();
      }
    };

    renderRecentFallback();
    loadRecentFromApi();

    // Busca actualizaciones de películas recientes cada 10 segundos si la pestaña está visible.
    setInterval(() => {
      if (!document.hidden) {
        loadRecentFromApi();
      }
    }, 10000);

    const getScrollStep = (row) => {
      const firstCard = row.querySelector(".featured-card");
      if (!firstCard) return 240;
      const styles = window.getComputedStyle(row);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "16") || 16;
      return firstCard.getBoundingClientRect().width + gap;
    };

    const scrollRowBy = (row, direction) => {
      if (!row) return;
      const maxScrollLeft = row.scrollWidth - row.clientWidth;
      if (maxScrollLeft <= 0) return;
      const step = getScrollStep(row);
      let nextLeft = row.scrollLeft + step * direction;
      if (direction > 0 && nextLeft >= maxScrollLeft - 2) {
        nextLeft = 0;
      } else if (direction < 0 && nextLeft <= 0) {
        nextLeft = maxScrollLeft;
      }
      row.scrollTo({ left: nextLeft, behavior: scrollBehavior });
    };

    recentNextBtn?.addEventListener("click", () => scrollRowBy(recentRow, 1));
    recentPrevBtn?.addEventListener("click", () => scrollRowBy(recentRow, -1));
    recentEpisodesNextBtn?.addEventListener("click", () => scrollRowBy(recentEpisodesRow, 1));
    recentEpisodesPrevBtn?.addEventListener("click", () => scrollRowBy(recentEpisodesRow, -1));
  }

  // --- Lógica para el banner rotativo del héroe ---
  const stopHeroBannerAuto = () => {
    if (!heroBannerTimer) return;
    window.clearInterval(heroBannerTimer);
    heroBannerTimer = null;
  };

  const startHeroBannerAuto = (advance) => {
    if (heroBannerTimer) return;
    heroBannerTimer = window.setInterval(advance, 3000);
  };

  if (heroSection && !isCompatMode) {
    // Lista de imágenes de fondo para el banner.
    const banners = [
      "https://4kwallpapers.com/images/wallpapers/jurassic-world-3840x2160-21375.jpg",
      "https://4kwallpapers.com/images/wallpapers/lilo-stitch-2025-3840x2160-20079.jpg",
      "https://4kwallpapers.com/images/wallpapers/godzilla-godzilla-x-3840x2160-13585.jpg",
      "https://4kwallpapers.com/images/wallpapers/john-wick-chapter-4-3840x2160-10664.jpg",
      "https://4kwallpapers.com/images/wallpapers/a-minecraft-movie-3840x2160-21613.jpg",
      "https://4kwallpapers.com/images/wallpapers/deadpool-wolverine-3840x2160-17624.jpg",
    ];

    // Crea dos "diapositivas" para una transición suave (fade).
    const rotator = document.createElement("div");
    rotator.className = "hero-bg-rotator";
    const slideA = document.createElement("div");
    slideA.className = "hero-bg-slide is-active";
    const slideB = document.createElement("div");
    slideB.className = "hero-bg-slide";
    rotator.appendChild(slideA);
    rotator.appendChild(slideB);
    heroSection.prepend(rotator);

    let activeSlide = slideA;
    let inactiveSlide = slideB;
    let currentBannerIndex = 0;

    slideA.style.backgroundImage = `url("${banners[currentBannerIndex]}")`;

    const advanceBanner = () => {
      // Cambia a la siguiente imagen en la lista.
      if (!banners.length) return;
      currentBannerIndex = (currentBannerIndex + 1) % banners.length;
      inactiveSlide.style.backgroundImage = `url("${banners[currentBannerIndex]}")`;
      inactiveSlide.classList.add("is-active");
      activeSlide.classList.remove("is-active");
      const prev = activeSlide;
      activeSlide = inactiveSlide;
      inactiveSlide = prev;
    };

    // Pausa la rotación cuando el usuario interactúa con el banner.
    heroSection.addEventListener("pointerenter", stopHeroBannerAuto);
    heroSection.addEventListener("pointerleave", () => startHeroBannerAuto(advanceBanner));
    heroSection.addEventListener("touchstart", stopHeroBannerAuto, { passive: true });
    heroSection.addEventListener("touchend", () => startHeroBannerAuto(advanceBanner), {
      passive: true,
    });

    // Pausa la rotación si la pestaña del navegador no está visible.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopHeroBannerAuto();
      } else {
        startHeroBannerAuto(advanceBanner);
      }
    });

    startHeroBannerAuto(advanceBanner);
  }

  // --- Interceptación de clics en enlaces ---
  // Modifica los enlaces de las películas para incluir el estado de búsqueda actual.
  document.addEventListener("click", (event) => {
    const target = event.target;
    const link = target && target.closest ? target.closest("a[href]") : null;
    if (!link) return;
    if (link.target === "_blank") return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || !href.includes("peliculas/")) return;

    const cleanHref = href.split("?")[0].split("#")[0];
    const returnSearch = buildReturnSearch();
    link.setAttribute("href", returnSearch ? `${cleanHref}?${returnSearch}` : cleanHref);
  });

  // --- Inicialización ---
  if (hasInitialState && !isReload) {
    applyStateFromUrl();
  }
  applyFilterAndPagination();
  if (hasInitialState && !isReload && catalogSection) {
    catalogSection.scrollIntoView({ behavior: "auto", block: "start" });
    didAutoScroll = true;
  }
})();
