// ===========================================================
// VARIABLES GLOBALES Y ENLACE API
// ===========================================================
let movieDatabase = {}, seriesDatabase = {}, seriesEpisodesData = {}, allMoviesFull = {};
const API_URL = 'https://script.google.com/macros/s/AKfycbw2htAwcmR48wYvELXyTIKQmWtwu_zgqZH8uSivzpgOitcYYNXKGDIEnrDvtQIpydJA/exec';
const playerState = {};

// ===========================================================
// VARIABLES DE ESTADO
// ===========================================================
let heroInterval;
let isHeroIntervalPaused = false;
let heroMovieIds = [];

// ===========================================================
// INICIO DE LA APLICACIÓN
// ===========================================================
document.addEventListener('DOMContentLoaded', () => {
    const preloader = document.getElementById('preloader');
    const pageWrapper = document.querySelector('.page-wrapper');
    const API_TIMEOUT = 15000; // 15 segundos de espera máxima

    const fetchWithTimeout = (url, options, timeout) => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('La solicitud ha tardado demasiado (Timeout)'));
            }, timeout);

            fetch(url, options).then(
                response => {
                    clearTimeout(timer);
                    resolve(response);
                },
                err => {
                    clearTimeout(timer);
                    reject(err);
                }
            );
        });
    };
    
    const showError = (message, details) => {
        console.error(message, details);
        const spinner = preloader.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';

        preloader.innerHTML += `
            <div style="text-align: center; color: var(--text-muted); padding: 20px;">
                <p style="font-size: 1.2rem; margin-bottom: 10px;">${message}</p>
                <p style="font-size: 0.9rem;">Detalles: ${details}</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background-color: var(--primary-red); border: none; color: white; border-radius: 5px; cursor: pointer;">
                    Intentar de nuevo
                </button>
            </div>`;
        preloader.classList.remove('fade-out');
        preloader.style.opacity = 1;
        preloader.style.visibility = 'visible';
    };

    Promise.all([
        fetchWithTimeout(`${API_URL}?data=series`, {}, API_TIMEOUT),
        fetchWithTimeout(`${API_URL}?data=episodes`, {}, API_TIMEOUT),
        fetchWithTimeout(`${API_URL}?data=allMovies`, {}, API_TIMEOUT)
    ])
    .then(responses => {
        return Promise.all(responses.map(res => {
            if (!res.ok) {
                return Promise.reject(new Error(`Error en la respuesta de la API (Status: ${res.status})`));
            }
            return res.text().then(text => {
                const contentType = (res.headers && typeof res.headers.get === 'function') ? (res.headers.get('content-type') || '') : '';
                if (!contentType.includes('application/json')) {
                    const snippet = String(text).replace(/\s+/g, ' ').slice(0, 300);
                    return Promise.reject(new Error(
                        `Respuesta inesperada desde la API. Content-Type: ${contentType}. Primeros caracteres: ${snippet}`
                    ));
                }
                try {
                    const parsed = JSON.parse(text);
                    return parsed;
                } catch (e) {
                    return Promise.reject(new Error(`JSON inválido: ${e.message}`));
                }
            });
        }));
    })
    .then(([series, episodes, allMovies]) => {
        if (typeof allMovies !== 'object' || allMovies === null) {
            throw new Error("Los datos de películas recibidos no son válidos");
        }
        if (typeof series !== 'object' || series === null) {
            throw new Error("Los datos de series recibidos no son válidos");
        }

        seriesDatabase = series;
        seriesEpisodesData = episodes;
        allMoviesFull = allMovies;

        const movieEntries = Object.keys(allMoviesFull)
            .sort((a, b) => allMoviesFull[b].tr - allMoviesFull[a].tr)
            .slice(0, 7)
            .map(key => [key, allMoviesFull[key]]);
        movieDatabase = Object.fromEntries(movieEntries);
            
        const criticalImageUrls = new Set();
        const firstMovieId = Object.keys(movieDatabase)[0];
        if (firstMovieId && movieDatabase[firstMovieId]) {
            criticalImageUrls.add(movieDatabase[firstMovieId].poster);
            criticalImageUrls.add(movieDatabase[firstMovieId].banner);
        }
        Object.keys(movieDatabase).slice(0, 6).forEach(id => {
            if (movieDatabase[id] && movieDatabase[id].poster) {
                criticalImageUrls.add(movieDatabase[id].poster);
            }
        });

        const preloadImages = (urls) => {
            const promises = Array.from(urls).map(url => new Promise((resolve) => {
                const img = new Image();
                img.onload = resolve;
                img.onerror = resolve;
                img.src = url;
            }));
            return Promise.all(promises);
        };

        return preloadImages(criticalImageUrls).then(() => {
            setupApp();
            preloader.classList.add('fade-out');
            preloader.addEventListener('transitionend', () => preloader.remove());
            pageWrapper.style.display = 'block';
        });
    })
    .catch(error => {
        const details = error && error.message ? error.message : String(error);
        showError("No se pudo cargar el contenido.", details);
    });
});

// ===========================================================
// SETUP INICIAL DE LA APP
// ===========================================================
function setupApp() {
    setupHero();
    generateCarousels();
    setupRouletteLogic();
    setupNavigation();
    setupKeydownListener();
    setupSearch();
    setupScrollListeners();

    const genreFilter = document.getElementById('genre-filter');
    const sortBy = document.getElementById('sort-by');
    genreFilter.addEventListener('change', handleFilterChange);
    sortBy.addEventListener('change', handleFilterChange);

    switchView('all');
}

// ===========================================================
// MANEJADORES DE EVENTOS
// ===========================================================
function setupScrollListeners() {
    window.addEventListener('scroll', () => {
        const header = document.querySelector('.main-header');
        const isModalOpen = document.querySelector('.modal.show');
        
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }

        if (heroInterval) {
            
        if (window.scrollY > 50 && !isHeroIntervalPaused && !isModalOpen) {
                clearInterval(heroInterval);
                isHeroIntervalPaused = true;

            }

        else if (window.scrollY <= 50 && isHeroIntervalPaused) {
                startHeroInterval();
            }
        }
    }, { passive: true });
}

function setupKeydownListener() {
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const openModal = document.querySelector('.modal.show');
        if (openModal) {
            const closeButton = openModal.querySelector('.close-btn');
            if (closeButton) closeButton.click();
        }
    });
}

// ===========================================================
// NAVEGACIÓN
// ===========================================================
function setupNavigation() {
    const hamburgerBtn = document.getElementById('menu-toggle');
    const mobileNavPanel = document.getElementById('mobile-nav-panel');
    const closeNavBtn = mobileNavPanel.querySelector('.close-nav-btn');
    const menuOverlay = document.getElementById('menu-overlay');
    const mobileNavContainer = mobileNavPanel.querySelector('.mobile-nav ul');
    const desktopNavContainer = document.querySelector('.main-nav ul');

    function openMenu() {
        if (mobileNavPanel) mobileNavPanel.classList.add('is-open');
        if (menuOverlay) menuOverlay.classList.add('active');
    }

    function closeMenu() {
        if (mobileNavPanel) mobileNavPanel.classList.remove('is-open');
        if (menuOverlay) menuOverlay.classList.remove('active');
    }

    function handleFilterClick(event) {
        const linkClickeado = event.target.closest('a');
        if (!linkClickeado) return;
        event.preventDefault();
        const filter = linkClickeado.dataset.filter;
        closeMenu();

        if (filter === 'roulette') {
            openRouletteModal();
            return;
        }

        if (linkClickeado.classList.contains('active')) return;
        document.querySelectorAll('.main-nav a, .mobile-nav a').forEach(link => link.classList.remove('active'));
        document.querySelectorAll(`a[data-filter="${filter}"]`).forEach(link => link.classList.add('active'));
        document.getElementById('search-input').value = '';
        switchView(filter);
    }

    if (hamburgerBtn) hamburgerBtn.addEventListener('click', openMenu);
    if (closeNavBtn) closeNavBtn.addEventListener('click', closeMenu);
    if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);
    if (desktopNavContainer) desktopNavContainer.addEventListener('click', handleFilterClick);
    if (mobileNavContainer) mobileNavContainer.addEventListener('click', handleFilterClick);
}

function handleFilterChange() {
    const activeNav = document.querySelector('.main-nav a.active, .mobile-nav a.active');
    const type = activeNav.dataset.filter;
    applyAndDisplayFilters(type);
}

// ===========================================================
// BÚSQUEDA
// ===========================================================
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    let isSearchActive = false;
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase().trim();
        if (searchTerm === '') {
            if (isSearchActive) {
                const activeNav = document.querySelector('.main-nav a.active, .mobile-nav a.active');
                switchView(activeNav ? activeNav.dataset.filter : 'all');
                isSearchActive = false;
            }
            return;
        }
        isSearchActive = true;
        const allContent = { ...allMoviesFull, ...seriesDatabase };
        const results = Object.entries(allContent).filter(([id, item]) => 
            item.title.toLowerCase().includes(searchTerm)
        );
        displaySearchResults(results);
    });
}

function displaySearchResults(results) {
    const gridContainer = document.querySelector('#full-grid-container .grid');
    document.getElementById('hero-section').style.display = 'none';
    document.getElementById('carousel-container').style.display = 'none';
    document.getElementById('full-grid-container').style.display = 'block';

    gridContainer.innerHTML = '';

    if (results.length === 0) {
        gridContainer.style.display = 'flex';
        gridContainer.style.justifyContent = 'center';
        gridContainer.style.alignItems = 'center';
        gridContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center;">No se encontraron resultados.</p>`;
    } else {
        gridContainer.style.display = 'grid';
        gridContainer.style.justifyContent = 'initial';
        gridContainer.style.alignItems = 'initial';

        results.forEach(([id, item]) => {
            const type = seriesDatabase[id] ? 'series' : 'movie-grid';
            gridContainer.appendChild(createMovieCardElement(id, item, type, true));
        });
    }
}

// ===========================================================
// VISTAS Y CONTENIDO DINÁMICO
// ===========================================================
function setupHero() {
    const heroSection = document.getElementById('hero-section');
    if (!heroSection) return;
    heroSection.innerHTML = `<div class="hero-content"><h1 id="hero-title"></h1><p id="hero-synopsis"></p><div class="hero-buttons"></div></div>`;
    
    heroMovieIds = Object.keys(movieDatabase); 

    if (heroMovieIds.length > 0) {
        shuffleArray(heroMovieIds);
        changeHeroMovie(0, heroMovieIds);
        startHeroInterval(); 
    } else {
       heroSection.style.display = 'none'; 
    }
}

function startHeroInterval() {
    clearInterval(heroInterval);
    isHeroIntervalPaused = false;
    let currentHeroIndex = 0;

    if (heroMovieIds.length === 0) return;

    heroInterval = setInterval(() => {
        currentHeroIndex = (currentHeroIndex + 1) % heroMovieIds.length;
        changeHeroMovie(currentHeroIndex, heroMovieIds);
    }, 7000);
}

function changeHeroMovie(index, ids) {
    const heroSection = document.getElementById('hero-section');
    const heroContent = heroSection.querySelector('.hero-content');
    if (!heroContent || !ids) return;
    const movieId = ids[index];
    const movieData = movieDatabase[movieId];
    if (!movieData) return;
    const imageUrl = window.innerWidth < 992 ? movieData.poster : movieData.banner;
    
    heroContent.style.opacity = 0;

    setTimeout(() => {
        heroSection.style.backgroundImage = `url(${imageUrl})`;
        heroContent.querySelector('#hero-title').textContent = movieData.title;
        heroContent.querySelector('#hero-synopsis').textContent = movieData.synopsis;
        const heroButtons = heroContent.querySelector('.hero-buttons');
        heroButtons.innerHTML = '';
        
        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn-play';
        playBtn.innerHTML = `<i class="fas fa-play"></i> Ver Ahora`;
        playBtn.addEventListener('click', () => openPlayerModal(movieId));

        const infoBtn = document.createElement('button');
        infoBtn.className = 'btn btn-info';
        infoBtn.innerHTML = `Más Información`;
        infoBtn.addEventListener('click', () => openDetailsModal(movieId, 'movie'));

        heroButtons.appendChild(playBtn);
        heroButtons.appendChild(infoBtn);
        
        heroContent.style.opacity = 1;
    }, 500);
}

function generateCarousels() {
    const container = document.getElementById('carousel-container');
    container.innerHTML = '';
    const recentMovieIds = Object.keys(movieDatabase);
    if (recentMovieIds.length > 0) {
        const movieCarouselEl = document.createElement('div');
        movieCarouselEl.className = 'carousel';
        movieCarouselEl.dataset.type = 'movie';
        movieCarouselEl.innerHTML = `<h3 class="carousel-title">Agregadas Recientemente</h3><div class="carousel-track-container"><div class="carousel-track"></div></div>`;
        const movieTrack = movieCarouselEl.querySelector('.carousel-track');
        recentMovieIds.forEach(id => movieTrack.appendChild(createMovieCardElement(id, movieDatabase[id], 'movie', false)));
        container.appendChild(movieCarouselEl);
    }
} 

function switchView(filter) {
    const carouselContainer = document.getElementById('carousel-container');
    const fullGridContainer = document.getElementById('full-grid-container');
    const heroSection = document.getElementById('hero-section');
    const filterControls = document.getElementById('filter-controls');

    heroSection.style.display = 'none';
    carouselContainer.style.display = 'none';
    fullGridContainer.style.display = 'none';
    filterControls.style.display = 'none';

    resetFilters();

    if (filter === 'all') {
        heroSection.style.display = 'flex';
        carouselContainer.style.display = 'block';
    } else if (filter === 'movie') {
        fullGridContainer.style.display = 'block';
        filterControls.style.display = 'flex';
        populateFullMovieGrid();
    } else if (filter === 'series') {
        fullGridContainer.style.display = 'block';
        filterControls.style.display = 'flex';
        populateFullSeriesGrid();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateFullMovieGrid() {
    populateFilters('movie');
    applyAndDisplayFilters('movie');
}

function populateFullSeriesGrid() {
    populateFilters('series');
    applyAndDisplayFilters('series');
}

function populateFilters(type) {
    const sourceData = (type === 'movie') ? allMoviesFull : seriesDatabase;
    const genreFilter = document.getElementById('genre-filter');
    const genres = new Set();
    for (const id in sourceData) {
        if (Array.isArray(sourceData[id].genres)) {
            sourceData[id].genres.forEach(genre => genres.add(genre));
        }
    }
    const sortedGenres = Array.from(genres).sort();
    genreFilter.innerHTML = `<option value="all">Todos los géneros</option>`;
    sortedGenres.forEach(genre => {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = genre;
        genreFilter.appendChild(option);
    });
}

function applyAndDisplayFilters(type) {
    const sourceData = (type === 'movie') ? allMoviesFull : seriesDatabase;
    const gridContainer = document.querySelector('#full-grid-container .grid');
    const selectedGenre = document.getElementById('genre-filter').value;
    const sortByValue = document.getElementById('sort-by').value;

    let content = Object.entries(sourceData);
    if (selectedGenre !== 'all') {
        content = content.filter(([id, item]) => 
            item.genres && item.genres.includes(selectedGenre)
        );
    }

    switch (sortByValue) {
        case 'title-asc':
            content.sort((a, b) => a[1].title.localeCompare(b[1].title));
            break;
        case 'title-desc':
            content.sort((a, b) => b[1].title.localeCompare(a[1].title));
            break;
        case 'year-desc':
            content.sort((a, b) => b[1].year - a[1].year);
            break;
        case 'year-asc':
            content.sort((a, b) => a[1].year - b[1].year); 
            break;
        case 'recent':
            content.sort((a, b) => b[1].tr - a[1].tr);
            break;
    }

    gridContainer.innerHTML = '';
    if (content.length > 0) {
        const cardType = (type === 'movie') ? 'movie-grid' : 'series';
        content.forEach(([id, item]) => {
            gridContainer.appendChild(createMovieCardElement(id, item, cardType, true));
        });
    } else {
        gridContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; grid-column: 1 / -1;">No se encontraron resultados.</p>`;
    }
}

function resetFilters() {
    document.getElementById('genre-filter').value = 'all';
    document.getElementById('sort-by').value = 'recent';
}
// ===========================================================
// MODALES
// ===========================================================

function openRouletteModal() {
    if (!allMoviesFull) {
        alert("Las películas aún se están cargando, por favor espera un segundo.");
        return;
    }
    const rouletteModal = document.getElementById('roulette-modal');
    if (rouletteModal) {
        document.body.classList.add('modal-open');
        rouletteModal.classList.add('show');
        if (window.loadRouletteMovies) {
            window.loadRouletteMovies();
        }
    }
}

function closeRouletteModal() {
    const rouletteModal = document.getElementById('roulette-modal');
    if (rouletteModal) rouletteModal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

function openDetailsModal(id, type) {
    let data;
    if (type.startsWith('movie')) {
        data = (allMoviesFull && allMoviesFull[id]) ? allMoviesFull[id] : movieDatabase[id];
    } else {
        data = seriesDatabase[id];
    }
    if (!data) return;

    const modal = document.getElementById('details-modal');

    modal.innerHTML = `
        <div class="details-panel" style="background-image: url('${data.banner}')">
            <button class="close-btn" aria-label="Cerrar detalles">X</button>
            <div class="details-content">
                <div class="details-poster">
                    <img id="details-poster-img" src="${data.poster}" alt="Poster de ${data.title}">
                </div>
                <div class="details-info">
                    <h2 id="details-title">${data.title}</h2>
                    <div class="details-meta">
                        <span id="details-year">${data.year || ''}</span>
                        <span id="details-genres">${Array.isArray(data.genres) ? data.genres.join(' • ') : ''}</span>
                    </div>
                    <div class="description-wrapper">
                        <p id="details-synopsis" class="description-truncated">${data.synopsis || ''}</p>
                    </div>
                    <div id="details-buttons"></div>
                </div>
            </div>
        </div>`;

    const closeBtn = modal.querySelector('.close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeDetailsModal);

    const buttonsContainer = modal.querySelector('#details-buttons');
    if (type.startsWith('movie')) {
        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn-play';
        playBtn.innerHTML = `<i class="fas fa-play"></i> Ver Ahora`;
        playBtn.addEventListener('click', () => openPlayerModal(id));
        buttonsContainer.appendChild(playBtn);
    } else {
        const episodesBtn = document.createElement('button');
        episodesBtn.className = 'btn btn-episodes';
        episodesBtn.innerHTML = `<i class="fas fa-bars"></i> Ver Episodios`;
        episodesBtn.addEventListener('click', () => {
            closeDetailsModal();
            openSeriesPlayer(id);
        });
        buttonsContainer.appendChild(episodesBtn);
    }

    initializeShowMore(modal);

    document.body.classList.add('modal-open');
    modal.classList.add('show');
}

function closeDetailsModal() {
    const modal = document.getElementById('details-modal');
    modal.classList.remove('show');
    modal.innerHTML = '';
    document.body.classList.remove('modal-open');
}

function openPlayerModal(movieId) {
    closeDetailsModal();
    const cinemaModal = document.getElementById('cinema');
    const iframe = cinemaModal.querySelector('iframe');
    const movieData = allMoviesFull[movieId] || movieDatabase[movieId];

    if (!movieData || !movieData.driveId) {
        console.error("No se encontró el ID de Drive para esta película.");
        alert("Error: No se pudo encontrar el video de la película.");
        return;
    }

    iframe.src = `https://www.2embed.cc/embed/${movieData.driveId}`;
    document.body.classList.add('modal-open');
    cinemaModal.classList.add('show');
    cinemaModal.querySelector('.close-btn').addEventListener('click', () => closePlayerModal());
}

function closePlayerModal() {
    const cinemaModal = document.getElementById('cinema');
    const iframe = cinemaModal.querySelector('iframe');
    if (iframe) iframe.src = '';
    cinemaModal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

function setupRouletteLogic() {
    const rouletteModal = document.getElementById('roulette-modal');
    const spinButton = document.getElementById('spin-roulette-btn');
    const rouletteTrack = document.getElementById('roulette-carousel-track');
    const closeBtn = rouletteModal.querySelector('.close-btn');

    if (!rouletteModal || !spinButton || !rouletteTrack || !closeBtn) {
        return;
    }

    const cardWidth = 150;
    const cardMargin = 10;
    const cardTotalWidth = cardWidth + (cardMargin * 2);
    let finalPickIndex = -1;
    let selectedMovie = null;

    closeBtn.addEventListener('click', closeRouletteModal);

    window.loadRouletteMovies = function() {
        rouletteTrack.classList.remove('is-spinning');
        spinButton.disabled = false;
        rouletteTrack.style.transition = 'none';
        rouletteTrack.innerHTML = '';
        
        if (!allMoviesFull || Object.keys(allMoviesFull).length < 5) {
            rouletteTrack.innerHTML = `<p style="color:white;text-align:center;">No hay suficientes películas.</p>`;
            spinButton.disabled = true;
            return;
        }

        const allMovieIds = Object.keys(allMoviesFull);
        const moviesForRoulette = Array.from({ length: 50 }, () => {
            const randomIndex = Math.floor(Math.random() * allMovieIds.length);
            const movieId = allMovieIds[randomIndex];
            return { id: movieId, data: allMoviesFull[movieId] };
        });

        finalPickIndex = Math.floor(Math.random() * (moviesForRoulette.length - 10)) + 5;
        selectedMovie = moviesForRoulette[finalPickIndex];

        moviesForRoulette.forEach(movie => {
            rouletteTrack.appendChild(createMovieCardElement(movie.id, movie.data, 'roulette', true));
        });
        
        setTimeout(() => {
            const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
            const initialOffset = (wrapperWidth / 2) - (cardTotalWidth * 2.5);
            rouletteTrack.style.transform = `translateX(${initialOffset}px)`;
        }, 100);
    }
    
    spinButton.addEventListener('click', () => {
        if (!selectedMovie) return;
        spinButton.disabled = true;
        rouletteTrack.classList.add('is-spinning');

        const wrapperWidth = rouletteTrack.parentElement.offsetWidth;
        const centerOfFinalCard = (cardTotalWidth * finalPickIndex) + (cardTotalWidth / 2);
        const targetPosition = (wrapperWidth / 2) - centerOfFinalCard;
        const randomJitter = Math.floor(Math.random() * (cardWidth / 2)) - (cardWidth / 4);
        const finalPosition = targetPosition + randomJitter;
        
        rouletteTrack.style.transition = 'transform 8s cubic-bezier(0.1, 0, 0.2, 1)';
        rouletteTrack.style.transform = `translateX(${finalPosition}px)`;

        rouletteTrack.addEventListener('transitionend', () => {
            rouletteTrack.classList.remove('is-spinning');
            setTimeout(() => {
                closeRouletteModal();
                openDetailsModal(selectedMovie.id, 'movie');
            }, 500);
        }, { once: true });
    });
}

// ===========================================================
// LÓGICA DEL REPRODUCTOR DE SERIES
// ===========================================================
function openSeriesPlayer(seriesId) {
    const dataSet = seriesEpisodesData[seriesId];
    const modal = document.getElementById('series-player-modal');
    
    if (!dataSet) {
        modal.innerHTML = `<div class="player-layout-container" style="text-align:center;justify-content:center;"><button class="close-btn" aria-label="Cerrar reproductor">X</button><h2>Error</h2><p>No se encontraron episodios.</p></div>`;
        document.body.classList.add('modal-open');
        modal.classList.add('show');
        modal.querySelector('.close-btn').addEventListener('click', () => handleSeriesModalClose(seriesId));
        return;
    }

    const hasSeasonPosters = dataSet.seasons && Object.values(dataSet.seasons).some(s => s.poster);

    modal.innerHTML = `
        <button class="close-btn" aria-label="Cerrar reproductor de series">X</button>
        <div class="player-layout-container">
            <div class="player-container">
                <h2 id="${seriesId}-cinema-title" class="player-title"></h2>
                <div id="${seriesId}-lang-controls" class="lang-controls"></div>
                <div class="screen">
                    <iframe id="video-frame-${seriesId}" src="" allowfullscreen></iframe>
                </div>
                <div class="pagination-controls">
                    <button class="episode-nav-btn" id="${seriesId}-prev-btn"><i class="fas fa-chevron-left"></i> Anterior</button>
                    <span id="${seriesId}-page-indicator" class="page-indicator"></span>
                    <button class="episode-nav-btn" id="${seriesId}-next-btn">Siguiente <i class="fas fa-chevron-right"></i></button>
                </div>
            </div>
            <div class="episode-sidebar">
                <h2 id="${seriesId}-sidebar-title">Temporadas</h2>
                <div id="${seriesId}-seasons-list" class="seasons-list-container"></div>
                <div id="${seriesId}-episode-list" class="episode-list-container"></div>
            </div>
        </div>
    `;
    
    document.body.classList.add('modal-open');
    modal.classList.add('show');
    
    document.querySelector(`#series-player-modal .close-btn`).addEventListener('click', () => handleSeriesModalClose(seriesId));
    document.getElementById(`${seriesId}-prev-btn`).addEventListener('click', () => navigateEpisode(seriesId, -1));
    document.getElementById(`${seriesId}-next-btn`).addEventListener('click', () => navigateEpisode(seriesId, 1));

    if (hasSeasonPosters) {
        modal.classList.add('season-selection-active');
        populateSeasonsMenu(seriesId);
    } else {
        modal.classList.remove('season-selection-active');
        const seasonKeys = dataSet.seasons ? Object.keys(dataSet.seasons) : Object.keys(dataSet);
        const initialSeason = seasonKeys[0];
        
        const episodeToOpen = loadProgress(seriesId, initialSeason);
        
        populateEpisodeList(seriesId, initialSeason);
        openEpisode(seriesId, initialSeason, episodeToOpen);
    }
}

function handleSeriesModalClose(seriesId) {
    const modal = document.getElementById('series-player-modal');
    const iframeId = `video-frame-${seriesId}`;
    const iframe = document.getElementById(iframeId);

    const dataSet = seriesEpisodesData[seriesId];
    const hasSeasonGrid = dataSet && dataSet.seasons && Object.values(dataSet.seasons).some(s => s.poster);
    const isShowingEpisodes = !modal.classList.contains('season-selection-active');

    if (hasSeasonGrid && isShowingEpisodes) {
        if (iframe) iframe.src = '';
        modal.classList.add('season-selection-active');
        const cinemaTitle = document.getElementById(`${seriesId}-cinema-title`);
        if (cinemaTitle) cinemaTitle.textContent = '';
        const sidebarTitle = document.getElementById(`${seriesId}-sidebar-title`);
        if (sidebarTitle) sidebarTitle.textContent = 'Temporadas';
        playerState[seriesId] = { season: null, episodeIndex: null };
    } else {
        if (iframe) iframe.src = '';
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
        setTimeout(() => {
            modal.innerHTML = '';
        }, 300);
    }
}

function populateSeasonsMenu(seriesId) {
    const container = document.getElementById(`${seriesId}-seasons-list`);
    if(!container) return;
    
    const seriesData = seriesEpisodesData[seriesId];
    container.innerHTML = '';

    const seasons = Object.keys(seriesData.seasons).sort((a, b) => parseInt(a) - parseInt(b));
    seasons.forEach(seasonNum => {
        const seasonData = seriesData.seasons[seasonNum];
        const card = document.createElement('div');
        card.className = 'season-card';
        card.addEventListener('click', () => selectSeason(seriesId, seasonNum));
        card.innerHTML = `<img src="${seasonData.poster}" alt="Temporada ${seasonNum}" class="season-card-poster" loading="lazy">`;
        container.appendChild(card);
    });
}

function selectSeason(seriesId, seasonNum) {
    document.getElementById('series-player-modal').classList.remove('season-selection-active');
    
    const episodeToOpen = loadProgress(seriesId, seasonNum);
    
    populateEpisodeList(seriesId, seasonNum);
    openEpisode(seriesId, seasonNum, episodeToOpen);
}

function populateEpisodeList(seriesId, seasonNum) {
    const container = document.getElementById(`${seriesId}-episode-list`);
    const episodes = seriesEpisodesData[seriesId]?.seasons?.[seasonNum]?.episodes || seriesEpisodesData[seriesId]?.[seasonNum];
    
    container.innerHTML = '';
    if (!episodes || episodes.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-muted);">No se encontraron episodios.</p>`;
        return;
    }

    episodes.forEach((episode, index) => {
        const card = document.createElement('div');
        card.className = 'episode-card';
        card.id = `${seriesId}-episode-${String(seasonNum).replace(/\s/g, '')}-${index}`;
        card.addEventListener('click', () => openEpisode(seriesId, seasonNum, index));
        
        const thumbnailSrc = episode.thumbnail || '';
        card.innerHTML = `
            <img src="${thumbnailSrc}" alt="${episode.title}" class="episode-card-thumb" loading="lazy">
            <div class="episode-card-details">
                <h3>${index + 1}. ${episode.title}</h3>
                <p class="episode-description">${episode.description || ''}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

function openEpisode(seriesId, season, episodeIndex) {
    const episodeData = seriesEpisodesData[seriesId];
    const episodes = episodeData?.seasons?.[season]?.episodes || episodeData?.[season];
    const episode = episodes?.[episodeIndex];
    if (!episode) return;

    saveProgress(seriesId, season, episodeIndex);
    
    document.getElementById(`${seriesId}-sidebar-title`).textContent = 'Episodios';
    
    document.querySelectorAll(`#${seriesId}-episode-list .episode-card.active`).forEach(c => c.classList.remove('active'));
    const activeCard = document.getElementById(`${seriesId}-episode-${String(season).replace(/\s/g, '')}-${episodeIndex}`);
    if(activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    playerState[seriesId] = { season, episodeIndex };
    
    const iframe = document.getElementById(`video-frame-${seriesId}`);
    const langControlsContainer = document.getElementById(`${seriesId}-lang-controls`);
    langControlsContainer.innerHTML = '';

    let initialVideoId = null;

    if (episode.videos && Object.keys(episode.videos).length > 1) {
        const languages = Object.keys(episode.videos);
        
        const defaultLang = languages.includes('LAT') ? 'LAT' : languages[0];
        initialVideoId = episode.videos[defaultLang];

        languages.forEach(lang => {
            const videoId = episode.videos[lang];
            const btn = document.createElement('button');
            btn.className = 'lang-btn';
            btn.textContent = lang;
            if (lang === defaultLang) {
                btn.classList.add('active');
            }
            
            btn.addEventListener('click', () => {
                iframe.src = `https://www.2embed.cc/embed/${videoId}`;
                langControlsContainer.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            langControlsContainer.appendChild(btn);
        });

    } else {
        initialVideoId = episode.driveId;
    }

    if (initialVideoId) {
        iframe.src = `https://www.2embed.cc/embed/${initialVideoId}`;
    } else {
        iframe.src = '';
        console.error("ID de video no encontrado para este episodio.");
    }
    
    document.getElementById(`${seriesId}-cinema-title`).textContent = `T${season} E${episodeIndex + 1} - ${episode.title}`;
    updateNavButtons(seriesId, season, episodeIndex);
}

function navigateEpisode(seriesId, direction) {
    const { season, episodeIndex } = playerState[seriesId];
    const episodeData = seriesEpisodesData[seriesId];
    const episodes = episodeData?.seasons?.[season]?.episodes || episodeData?.[season];
    const newIndex = episodeIndex + direction;
    if (newIndex >= 0 && newIndex < episodes.length) {
        openEpisode(seriesId, season, newIndex);
    }
}

function updateNavButtons(seriesId, season, episodeIndex) {
    const episodeData = seriesEpisodesData[seriesId];
    const totalEpisodes = episodeData?.seasons?.[season]?.episodes?.length || episodeData?.[season]?.length;
    document.getElementById(`${seriesId}-prev-btn`).disabled = (episodeIndex === 0);
    document.getElementById(`${seriesId}-next-btn`).disabled = (episodeIndex === totalEpisodes - 1);
}

function saveProgress(seriesId, season, episodeIndex) {
    try {
        const progressData = JSON.parse(localStorage.getItem(`${seriesId}Progress`)) || {};
        progressData[season] = episodeIndex;
        localStorage.setItem(`${seriesId}Progress`, JSON.stringify(progressData));
    } catch (e) { 
        console.error(`Error al guardar progreso:`, e); 
    }
}

function loadProgress(seriesId, season) {
    try {
        const progressData = JSON.parse(localStorage.getItem(`${seriesId}Progress`)) || {};
        return progressData[season] || 0;
    } catch (e) {
        console.error("Error al cargar progreso:", e);
        return 0;
    }
}

// ===========================================================
// FUNCIONES DE UTILIDAD
// ===========================================================
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function createMovieCardElement(id, data, type, lazy) {
    const card = document.createElement('div');
    const cardClass = (type.includes('grid') || type === 'roulette' || type === 'series') ? 'movie-card' : 'carousel-card';
    card.className = cardClass;
    
    if (type !== 'roulette') {
        card.addEventListener('click', () => {
            if (type.includes('series')) {
                openSeriesPlayer(id);
            } else {
                openDetailsModal(id, 'movie');
            }
        });
    }

    const img = document.createElement('img');
    img.src = data.poster;
    img.alt = data.title;
    if (lazy) img.loading = 'lazy';
    card.appendChild(img);
    return card;
}

function initializeShowMore(modalElement) {
    const description = modalElement.querySelector('#details-synopsis');
    const wrapper = modalElement.querySelector('.description-wrapper');

    if (!description || !wrapper) return;

    const existingButton = wrapper.querySelector('.toggle-description-btn');
    if (existingButton) {
        existingButton.remove();
    }
    
    description.classList.remove('description-truncated', 'expanded');
    description.style.maxHeight = '';


    const isOverflowing = description.scrollHeight > 65;

    if (isOverflowing) {
        description.classList.add('description-truncated');
        
        const toggleButton = document.createElement('button');
        toggleButton.innerText = 'Ver más...';
        toggleButton.className = 'toggle-description-btn';
        
        wrapper.appendChild(toggleButton);

        toggleButton.addEventListener('click', () => {
            if (description.classList.contains('description-truncated')) {
                description.classList.remove('description-truncated');
                description.classList.add('expanded');
                toggleButton.innerText = 'Ver menos';
            } else {
                description.classList.remove('expanded');
                description.classList.add('description-truncated');
                toggleButton.innerText = 'Ver más...';
            }
        });
    }
}