// ===========================================================
// CINE CORNETA - SCRIPT PRINCIPAL
// Versión: 9.8 (ArtPlayer + Worker Integrado)
// ===========================================================

// ===========================================================
// 1. IMPORTS
// ===========================================================
import { API_URL, firebaseConfig, UI, THEMES } from './core/config.js';
import { logError, ErrorHandler } from './utils/logger.js';
import CacheManager from './utils/cache-manager.js';
import ModalManager from './utils/modal-manager.js';
import ContentManager from './utils/content-manager.js';
import ThemeManager, { updateThemeAssets } from './utils/theme-manager.js';
import LazyImageLoader from './utils/lazy-loader.js';
import { initUniverses, renderUniversesHub } from './features/universes.js';

// Instancias vacías (se llenan abajo)
let cacheManager;
let modalManager;
let lazyLoader;
let contentManager;

// ==========================================
// PEGAR ESTO ANTES DE 'let playerModule = null;'
// ==========================================
function checkUserLogin() {
    const user = JSON.parse(localStorage.getItem('cineCornetoUser'));
    
    // Mantener estructura de appState.user incluso sin usuario logueado
    if (typeof appState !== 'undefined') {
        if (user) {
            appState.user = {
                ...user,
                watchlist: appState.user?.watchlist || new Set(),
                historyListenerRef: appState.user?.historyListenerRef || null
            };
        } else {
            appState.user = {
                watchlist: new Set(),
                historyListenerRef: null
            };
        }
    }

    // 1. Saludo Escritorio
    if (typeof DOM !== 'undefined' && DOM.userGreeting) {
        DOM.userGreeting.textContent = user ? `Hola, ${user.username}` : '';
    }

    // 2. Email en Profile Hub Móvil
    const profileHubEmail = document.getElementById('profile-hub-email');
    if (profileHubEmail) {
        if (user) {
            profileHubEmail.textContent = user.email;
            profileHubEmail.style.display = 'block';
        } else {
            profileHubEmail.textContent = 'Visitante';
            profileHubEmail.style.display = 'block';
        }
    }

    // 3. Menús
    if (typeof DOM !== 'undefined') {
        if (user) {
            if(DOM.loginBtn) DOM.loginBtn.style.display = 'none';
            if(DOM.userMenuContainer) DOM.userMenuContainer.style.display = 'block';
        } else {
            if(DOM.loginBtn) DOM.loginBtn.style.display = 'block';
            if(DOM.userMenuContainer) DOM.userMenuContainer.style.display = 'none';
            if(DOM.userMenuDropdown && DOM.userMenuDropdown.classList) DOM.userMenuDropdown.classList.remove('show');
        }
    }
}

// Módulos dinámicos
let playerModule = null;
let profileModule = null;
let rouletteModule = null;
let reviewsModule = null; 
let iptvModule = null;
let universesModule = null;
let reportsModule = null;

async function getPlayerModule() {
    if (playerModule) return playerModule;
    const module = await import('./features/player.js?v=15');
    module.initPlayer({
        appState, DOM, ErrorHandler, auth, db,
        addToHistoryIfLoggedIn, switchView,
        THEMES,
        closeAllModals: () => modalManager.closeAll(), 
        openDetailsModal
    });
    playerModule = module;
    return playerModule;
}

async function getProfileModule() {
    if (profileModule) return profileModule;
    const module = await import('./features/profile.js?v=8');
    module.initProfile({
        appState, DOM, auth, db, switchView, ErrorHandler
    });
    profileModule = module;
    module.setupUserDropdown();
    return profileModule;
}

async function getRouletteModule() {
    if (rouletteModule) return rouletteModule;
    const module = await import('./features/roulette.js?v=8');
    module.initRoulette({
        appState, DOM, createMovieCardElement, openDetailsModal, auth, db,
        getPlayerModule, addToHistoryIfLoggedIn
    });
    rouletteModule = module;
    return module;
}

async function getReviewsModule() {
    if (reviewsModule) return reviewsModule;
    const module = await import('./features/reviews.js?v=8');
    module.initReviews({
        appState, DOM, auth, db, ErrorHandler, ModalManager, openConfirmationModal
    });
    reviewsModule = module;
    return module;
}


async function getUniversesModule() {
    if (universesModule) return universesModule;
    const module = await import('./features/universes.js?v=8');
    module.initUniverses({ appState, switchView });
    universesModule = module;
    return module;
}

async function getReportsModule() {
    if (reportsModule) return reportsModule;
    const module = await import('./features/reports.js?v=' + Date.now());
    module.initReports({ appState, DOM, auth, db, ErrorHandler });
    reportsModule = module;
    return module;
}

// ===========================================================
// 1. ESTADO GLOBAL Y CONFIGURACIÓN
// ===========================================================
const appState = {
    content: {
        movies: {},
        series: {},
        sagas: {},       
        sagasList: [],   
        seriesEpisodes: {},
        seasonPosters: {},
        seasonOrder: {}, 
        metadata: { movies: {}, series: {} },
        averages: {}     
    },
    ui: {
        heroMovieIds: [],
        contentToDisplay: [],
        currentIndex: 0,
        heroInterval: null,
        activeSagaId: null
    },
    user: {
        watchlist: new Set(),
        historyListenerRef: null
    },
    player: {
        state: {},
        activeSeriesId: null,
        pendingHistorySave: null,
        episodeOpenTimer: null,
        historyUpdateDebounceTimer: null,
        activeCineInstance: null // 🔥 NUEVO: Referencia a la instancia de ArtPlayer
    },
    flags: {
        isLoadingMore: false,
        pendingUpdate: false
    },
    hero: {
        preloadedImages: new Map(),
        currentIndex: 0,
        isTransitioning: false
    }
};

window.appState = appState; // Exponer a módulos


const DOM = {
    preloader: document.getElementById('preloader'),
    pageWrapper: document.querySelector('.page-wrapper'),
    header: document.querySelector('.main-header'),
    heroSection: document.getElementById('hero-section'),
    carouselContainer: document.getElementById('carousel-container'),
    gridContainer: document.getElementById('full-grid-container'),
    myListContainer: document.getElementById('my-list-container'),
    historyContainer: document.getElementById('history-container'),
    
    // --- SECCIÓN RESEÑAS ---
    reviewsContainer: document.getElementById('reviews-container'),
    reviewsGrid: document.getElementById('reviews-grid'),
    reviewModal: document.getElementById('review-form-modal'),
    reviewForm: document.getElementById('review-submission-form'),
    openReviewBtn: document.getElementById('open-review-modal-btn'),

    detailsModal: document.getElementById('details-modal'),
    cinemaModal: document.getElementById('cinema'),
    rouletteModal: document.getElementById('roulette-modal'),
    seriesPlayerModal: document.getElementById('series-player-page'),
    authModal: document.getElementById('auth-modal'),
    confirmationModal: document.getElementById('confirmation-modal'),
    searchInput: document.getElementById('search-input'),
    filterControls: document.getElementById('filter-controls'),
    
    // --- FILTROS ---
    genreFilter: document.getElementById('genre-filter'),
    langFilter: document.getElementById('lang-filter'),
    sortBy: document.getElementById('sort-by'),
    ucmSortButtonsContainer: document.getElementById('ucm-sort-buttons'),
    ucmSortButtons: document.querySelectorAll('.sort-btn'),
    
    // --- AUTH ---
    authButtons: document.getElementById('auth-buttons'),
    loginBtnHeader: document.getElementById('login-btn-header'),
    registerBtnHeader: document.getElementById('register-btn-header'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    switchAuthModeLink: document.getElementById('switch-auth-mode'),
    loginError: document.getElementById('login-error'),
    registerError: document.getElementById('register-error'),
    registerUsernameInput: document.getElementById('register-username'),
    registerEmailInput: document.getElementById('register-email'),
    registerPasswordInput: document.getElementById('register-password'),
    loginEmailInput: document.getElementById('login-email'),
    loginPasswordInput: document.getElementById('login-password'),
    
    // --- PERFIL ---
    userProfileContainer: document.getElementById('user-profile-container'),
    userGreetingBtn: document.getElementById('user-greeting'),
    userMenuDropdown: document.getElementById('user-menu-dropdown'),
    myListNavLink: document.getElementById('my-list-nav-link'),
    historyNavLink: document.getElementById('history-nav-link'),
    profileUsername: document.getElementById('profile-username'),
    profileEmail: document.getElementById('profile-email'),
    settingsUsernameInput: document.getElementById('settings-username-input'),
    updateUsernameBtn: document.getElementById('update-username-btn'),
    settingsPasswordInput: document.getElementById('settings-password-input'),
    updatePasswordBtn: document.getElementById('update-password-btn'),
    settingsFeedback: document.getElementById('settings-feedback'),
    confirmDeleteBtn: document.getElementById('confirm-delete-btn'),
    cancelDeleteBtn: document.getElementById('cancel-delete-btn'),
    
    // --- MÓVIL ---
    hamburgerBtn: document.getElementById('menu-toggle'),
    mobileNavPanel: document.getElementById('mobile-nav-panel'),
    closeNavBtn: document.querySelector('.close-nav-btn'),
    menuOverlay: document.getElementById('menu-overlay')
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// ===========================================================
// 2. INICIO Y CARGA DE DATOS (🆕 MEJORADO CON CACHÉ)
// ===========================================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('force_update')) {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            preloader.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
                    <div class="spinner" style="margin-bottom: 20px;"></div>
                    <h2 class="loading-text" style="font-size: 2rem; color: var(--text-light); margin: 0;">REFRESCANDO CONTENIDO</h2>
                    <p style="color: var(--text-muted); margin-top: 10px; font-size: 1.1rem;">Aplicando la última versión...</p>
                </div>
            `;
        }
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
    }

    cacheManager = new CacheManager();
    lazyLoader = new LazyImageLoader();
    
    modalManager = ModalManager;
    contentManager = ContentManager;

    // Parchear ModalManager.closeAll para destruir instancias de Artplayer y timers
    const _originalCloseAll = ModalManager.closeAll.bind(ModalManager);
    ModalManager.closeAll = () => {
        if (appState?.player?.movieHistoryTimer) {
            clearTimeout(appState.player.movieHistoryTimer);
            appState.player.movieHistoryTimer = null;
        }
        // 🔥 NUEVO: Destruir el reproductor si está activo
        if (appState?.player?.activeCineInstance) {
            appState.player.activeCineInstance.destroy();
            appState.player.activeCineInstance = null;
        }
        _originalCloseAll();
    };

    updateThemeAssets();
    fetchInitialDataWithCache();
    checkResetPasswordMode();

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    const cinemaEl = document.getElementById('cinema');
    if (cinemaEl) {
        new MutationObserver(async mutations => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'class' && cinemaEl.classList.contains('show')) {
                    const titleEl = cinemaEl.querySelector('#cinema-title');
                    const contentTitle = titleEl?.textContent || '';
                    const contentId = cinemaEl.dataset.contentId || '';
                    const controls = cinemaEl.querySelector('.cinema-controls');
                    if (controls && contentTitle) {
                        const reports = await getReportsModule();
                        reports.injectReportButtonInCinema(contentId, contentTitle);
                    }
                }
            }
        }).observe(cinemaEl, { attributes: true });
    }

    const seriesModal = document.getElementById('series-player-page');
    if (seriesModal) {
        new MutationObserver(async mutations => {
            for (const m of mutations) {
                if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
                if (seriesModal.classList.contains('show')) {
                    const rptMod = await getReportsModule();
                    setTimeout(() => rptMod.syncSeriesReportButton(), 400);
                }
            }
        }).observe(seriesModal, { attributes: true });

        seriesModal.addEventListener('click', async e => {
            const isNavBtn   = e.target.closest('.episode-nav-btn');
            const isEpisode  = e.target.closest('.episode-card, .episode-item, [data-episode]');
            if (isNavBtn || isEpisode) {
                const rptMod = await getReportsModule();
                setTimeout(() => rptMod.syncSeriesReportButton(), 350);
            }
        });
    }
});

function preloadImage(url) {
    return new Promise((resolve) => {
        if (!url) { resolve(); return; }
        const img = new Image();
        img.src = url;
        img.onload = () => resolve();
        img.onerror = () => resolve(); 
    });
}

async function fetchInitialDataWithCache() {
    const cores = navigator.hardwareConcurrency || 4; 
    if (cores <= 4) {
        console.log(`💻 Hardware modesto detectado (${cores} núcleos): Activando Modo Rendimiento.`);
        document.body.classList.add('low-spec');
    } else {
        console.log(`🚀 Hardware potente detectado (${cores} núcleos): Gráficos en Ultra.`);
        document.body.classList.remove('low-spec');
    }

    const startLoadTime = Date.now();

    if (typeof db !== 'undefined') {
        const updatesRef = db.ref('system_metadata/last_update');
        updatesRef.on('value', (snapshot) => {
            const serverLastUpdate = Number(snapshot.val()); 
            const localRaw = localStorage.getItem('local_last_update');
            const localLastUpdate = localRaw ? Number(localRaw) : 0;

            if (serverLastUpdate > localLastUpdate) {
                const isWatching = document.body.classList.contains('modal-open');

                if (isWatching) {
                    localStorage.setItem('pending_reload', 'true');
                    localStorage.setItem('local_last_update', serverLastUpdate);
                    refreshDataInBackground(); 
                } else {
                    safeClearStorage();
                    localStorage.setItem('local_last_update', serverLastUpdate);
                    
                    const url = new URL(window.location.href);
                    url.searchParams.set('force_update', Date.now());
                    window.location.href = url.toString();
                }
            } 
            else if (serverLastUpdate && localLastUpdate === 0) {
                localStorage.setItem('local_last_update', serverLastUpdate);
            }
        });
    }

    const processData = (data) => {
        window.processDataPublic = processData; 
        appState.content.movies = data.allMovies || {};
        appState.content.series = data.series || {};
        appState.content.seriesEpisodes = data.episodes || {};
        appState.content.seasonPosters = data.posters || {};
        
        appState.content.seasonOrder = {};

        function smartSeasonSort(keys, postersData) {
            if (postersData) {
                const withOrder = keys.filter(k => postersData[k]?.orden !== undefined && postersData[k]?.orden !== '');
                if (withOrder.length > 0) {
                    return keys.slice().sort((a, b) => {
                        const oA = postersData[a]?.orden !== undefined && postersData[a]?.orden !== '' ? Number(postersData[a].orden) : 999;
                        const oB = postersData[b]?.orden !== undefined && postersData[b]?.orden !== '' ? Number(postersData[b].orden) : 999;
                        return oA - oB;
                    });
                }
            }
            const nonNumeric = keys.filter(k => isNaN(k));
            const numeric = keys.filter(k => !isNaN(k)).sort((a, b) => Number(a) - Number(b));
            return [...nonNumeric, ...numeric];
        }

        for (const seriesId in data.episodes) {
            const seasons = data.episodes[seriesId];
            const postersData = data.posters?.[seriesId];
            appState.content.seasonOrder[seriesId] = smartSeasonSort(Object.keys(seasons), postersData);
        }

        for (const seriesId in data.posters) {
            const posterSeasons = Object.keys(data.posters[seriesId]);
            const postersData = data.posters[seriesId];
            if (appState.content.seasonOrder[seriesId]) {
                posterSeasons.forEach(key => {
                    if (!appState.content.seasonOrder[seriesId].includes(key)) {
                        appState.content.seasonOrder[seriesId].push(key);
                    }
                });
                appState.content.seasonOrder[seriesId] = smartSeasonSort(appState.content.seasonOrder[seriesId], postersData);
            } else {
                appState.content.seasonOrder[seriesId] = smartSeasonSort(posterSeasons, postersData);
            }
        }
        
        appState.content.sagasList = Object.values(data.sagas_list || {});
        
        if (appState.content.sagasList.length > 0) {
            appState.content.sagasList.forEach(saga => {
                if (data[saga.id]) {
                    appState.content.sagas[saga.id] = data[saga.id];
                }
            });
        }
    };

    const setupAndShow = async (movieMeta, seriesMeta) => {
        appState.content.metadata.movies = movieMeta || {};
        appState.content.metadata.series = seriesMeta || {};

        setupHero();
        generateCarousels();
        setupEventListeners();
        setupNavigation();
        setupAuthListeners();
        setupSearch();
        setupPageVisibilityHandler();

        const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter || 'all';
        const isSaga = appState.content.sagas[activeFilter];

        if (['movie', 'series'].includes(activeFilter) || isSaga) {
            applyAndDisplayFilters(activeFilter);
        } else if (activeFilter === 'sagas') {
            switchView('sagas');
        }

        const timeElapsed = Date.now() - startLoadTime;
        const remainingTime = Math.max(0, 800 - timeElapsed);
        await new Promise(r => setTimeout(r, remainingTime));

        requestAnimationFrame(() => {
            if (DOM.pageWrapper) DOM.pageWrapper.style.display = 'block';
            setTimeout(() => {
                if (DOM.pageWrapper) DOM.pageWrapper.classList.add('visible'); 
                if (DOM.preloader) DOM.preloader.classList.add('fade-out');
            }, 50);
            setTimeout(() => { if(DOM.preloader) DOM.preloader.remove(); }, 800); 
        });
    };

    const cachedContent = cacheManager.get(cacheManager.keys.content);
    const cachedMetadata = cacheManager.get(cacheManager.keys.metadata);

    if (cachedContent) {
        console.log('✓ Iniciando desde caché...');
        processData(cachedContent);
        await getReviewsModule();
        await setupAndShow(cachedMetadata?.movies, cachedMetadata?.series);
        refreshDataInBackground(); 
        
        const user = auth.currentUser;
        if (user) {
            db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
            });
        }
    } else {
        try {
            console.log('⟳ Descargando base de datos completa...');
            const [series, episodes, allMovies, posters, sagasListData, movieMeta, seriesMeta] = await Promise.all([
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=allMovies&order=desc`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=PostersTemporadas`),
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`),
                db.ref('movie_metadata').once('value').then(s => s.val() || {}),
                db.ref('series_metadata').once('value').then(s => s.val() || {})
            ]);

            const sagasArray = Object.values(sagasListData || {});
            const sagasRequests = sagasArray.map(saga => 
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`)
                .then(data => ({ id: saga.id, data: data }))
            );

            const sagasResults = await Promise.all(sagasRequests);

            const freshContent = { 
                allMovies, series, episodes, posters, 
                sagas_list: sagasListData 
            };

            sagasResults.forEach(item => {
                freshContent[item.id] = item.data;
            });
            
            const freshMetadata = { movies: movieMeta, series: seriesMeta };

            processData(freshContent);
            cacheManager.set(cacheManager.keys.content, freshContent);
            cacheManager.set(cacheManager.keys.metadata, freshMetadata);
            
            await getReviewsModule();
            
            if (!localStorage.getItem('local_last_update')) {
                localStorage.setItem('local_last_update', Date.now());
            }

            await setupAndShow(freshMetadata.movies, freshMetadata.series);
            
            const user = auth.currentUser;
            if (user) {
                db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
                    if (snapshot.exists()) generateContinueWatchingCarousel(snapshot);
                });
            }

        } catch (error) {
            console.error('✗ Error crítico en carga inicial:', error);
            if (DOM.preloader) DOM.preloader.innerHTML = `
                <div style="text-align: center; color: white;">
                    <p>Error de conexión</p>
                    <button onclick="location.reload()" class="btn-primary" style="margin-top:10px;">Reintentar</button>
                </div>`;
        }
    }
}

async function refreshDataInBackground() {
    try {
        const [series, episodes, allMovies, posters, sagasListData] = await Promise.all([
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=allMovies&order=desc`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=PostersTemporadas`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`)
        ]);

        const sagasArray = Object.values(sagasListData || {});
        const sagasRequests = sagasArray.map(saga => 
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`)
            .then(data => ({ id: saga.id, data: data }))
        );

        const sagasResults = await Promise.all(sagasRequests);

        const freshContent = { 
            allMovies, series, episodes, posters, 
            sagas_list: sagasListData 
        };

        sagasResults.forEach(item => {
            freshContent[item.id] = item.data;
        });

        cacheManager.set(cacheManager.keys.content, freshContent);
        console.log('✓ Caché actualizada en segundo plano (Sagas Dinámicas)');
    } catch (e) { console.warn('No se pudo actualizar background', e); }
}

// ===========================================================
// 3. NAVEGACIÓN Y MANEJO DE VISTAS
// ===========================================================
function setupNavigation() {
    const navContainers = document.querySelectorAll('.main-nav ul, .mobile-nav ul, .bottom-nav, #profile-hub-container, .header-right');
    
    navContainers.forEach(container => {
        if (container) { 
            container.addEventListener('click', handleFilterClick);
        }
    });
    
    const openMenu = () => { 
        if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.add('is-open'); 
        if (DOM.menuOverlay) DOM.menuOverlay.classList.add('active'); 
    };
    const closeMenu = () => { 
        if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.remove('is-open'); 
        if (DOM.menuOverlay) DOM.menuOverlay.classList.remove('active'); 
    };

    if (DOM.hamburgerBtn) DOM.hamburgerBtn.addEventListener('click', openMenu);
    if (DOM.closeNavBtn) DOM.closeNavBtn.addEventListener('click', closeMenu);
    if (DOM.menuOverlay) DOM.menuOverlay.addEventListener('click', closeMenu);
}

async function handleFilterClick(event) {
    const link = event.target.closest('a');
    if (!link || !link.dataset.filter) return;

    event.preventDefault();

    if (DOM.mobileNavPanel) DOM.mobileNavPanel.classList.remove('is-open');
    if (DOM.menuOverlay) DOM.menuOverlay.classList.remove('active');
    if (DOM.userMenuDropdown) DOM.userMenuDropdown.classList.remove('show');

    const filter = link.dataset.filter;

    if (filter === 'roulette') {
        const roulette = await getRouletteModule();
        roulette.openRouletteModal();
        return;
    }

    if (link.classList.contains('active') && !['history', 'my-list', 'profile', 'profile-hub', 'settings'].includes(filter)) return;

    document.querySelectorAll('a[data-filter]').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`a[data-filter="${filter}"]`).forEach(l => l.classList.add('active'));

    if (DOM.searchInput) DOM.searchInput.value = '';
    switchView(filter);
}

function updateActiveNav(filter) {
    if (filter === 'roulette') return;

    document.querySelectorAll('a[data-filter]').forEach(link => {
        link.classList.remove('active');
    });
    
    if (filter) {
        const selector = `a[data-filter="${filter}"]`;
        document.querySelectorAll(selector).forEach(link => link.classList.add('active'));
    }
}

async function switchView(filter) {
    if (filter === 'roulette') {
        const roulette = await getRouletteModule();
        roulette.openRouletteModal();
        return; 
    }

    console.log(`Switched to: ${filter}`);
    appState.currentFilter = filter;
    
    updateActiveNav(filter);

    const containers = [
        document.getElementById('hero-section'),
        document.getElementById('carousel-container'),
        document.getElementById('full-grid-container'),
        document.getElementById('my-list-container'),
        document.getElementById('history-container'),
        document.getElementById('profile-container'),
        document.getElementById('settings-container'),
        document.getElementById('profile-hub-container'),
        document.getElementById('sagas-hub-container'),
        document.getElementById('reviews-container'),
        document.getElementById('reports-container'),
        document.getElementById('live-tv-section'),
        document.getElementById('iptv-section'),
        document.getElementById('series-player-page')
    ];

    containers.forEach(el => { 
        if(el) el.style.display = 'none'; 
    });

    const filterControls = document.getElementById('filter-controls');
    if (filterControls) filterControls.style.display = 'none';
    document.body.classList.remove('has-saga-bg');
    document.body.style.removeProperty('--saga-banner');

    const ucmButtons = document.getElementById('ucm-sort-buttons');
    if (ucmButtons) ucmButtons.style.display = 'none';

    const backSagaBtn = document.getElementById('back-to-sagas-btn');
    if (backSagaBtn) backSagaBtn.style.display = 'none';

    const liveVideo = document.getElementById('embedded-live-video');
    if (liveVideo) {
        liveVideo.pause();
        liveVideo.removeAttribute('src'); 
        liveVideo.load();
    }
    if (window.hlsLiveInstance) {
        window.hlsLiveInstance.destroy();
        window.hlsLiveInstance = null;
    }

    if (filter === 'all') {
        if(DOM.heroSection) DOM.heroSection.style.display = 'flex';
        if(DOM.carouselContainer) DOM.carouselContainer.style.display = 'block';
        return;
    } 
    
    if (filter === 'sagas') {
        const hub = document.getElementById('sagas-hub-container');
        if (hub) {
            hub.style.display = 'block';
            getUniversesModule().then(m => m.renderUniversesHub());
        }
        return;
    }

    const isDynamicSaga = appState.content.sagas && appState.content.sagas[filter];

    if (filter === 'movie' || filter === 'series' || isDynamicSaga) {
        if(DOM.gridContainer) DOM.gridContainer.style.display = 'block';
        if(filterControls) filterControls.style.display = 'flex';

        if (isDynamicSaga) {
            const sagaConfig = appState.content.sagasList.find(s => s.id === filter);
            if (sagaConfig?.banner) {
                document.body.style.setProperty('--saga-banner', `url(${sagaConfig.banner})`);
                document.body.classList.add('has-saga-bg');
            }
        }

        const backBtn = document.getElementById('back-to-sagas-btn');
        if (backBtn) {
            backBtn.style.display = isDynamicSaga ? 'flex' : 'none';
            backBtn.onclick = () => switchView('sagas');
        }
        
        appState.ui.activeSagaId = isDynamicSaga ? filter : null;

        if (DOM.sortBy) DOM.sortBy.value = 'recent';
        const sortText = document.getElementById('sort-text');
        if (sortText) sortText.textContent = 'Recientes';
        const requestFilterEl = document.getElementById('request-filter');
        const requestTextEl = document.getElementById('request-text');
        if (requestFilterEl) requestFilterEl.value = 'all';
        if (requestTextEl) requestTextEl.textContent = 'Pedidos';
        populateFilters(filter); 
        applyAndDisplayFilters(filter);
        return;
    }
    
    if (filter === 'my-list') {
        if(document.getElementById('my-list-container')) {
            document.getElementById('my-list-container').style.display = 'block';
            displayMyListView();
        }
        return;
    } 
    
    if (filter === 'history') {
        if(document.getElementById('history-container')) {
            document.getElementById('history-container').style.display = 'block';
            renderHistory();
        }
        return;
    } 
    
    if (filter === 'reviews') {
        const reviewsContainer = document.getElementById('reviews-container');
        if(reviewsContainer) {
            reviewsContainer.style.display = 'block';
            reviewsContainer.style.marginTop = '0';
            if (reviewsModule && reviewsModule.renderReviewsGrid) {
                reviewsModule.renderReviewsGrid();
            }
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
    }

    if (filter === 'reports') {
        const rptContainer = document.getElementById('reports-container');
        if (rptContainer) {
            rptContainer.style.display = 'block';
            rptContainer.style.padding = '30px clamp(15px, 4vw, 60px)';
            rptContainer.innerHTML = `
                <div class="reports-page-header">
                    <h1 class="reports-page-title"><i class="fas fa-flag"></i> Reportes</h1>
                    <p class="reports-page-subtitle">Problemas reportados por los usuarios</p>
                </div>
                <div id="reports-admin-body"></div>
            `;
            const rptBody = document.getElementById('reports-admin-body');
            const rptMod = await getReportsModule();
            await rptMod.renderAdminReports(rptBody);
        }
        window.scrollTo(0, 0);
        return;
    }

    if (filter === 'profile-hub' || filter === 'profile' || filter === 'settings') {
        const containerMap = {
            'profile-hub': 'profile-hub-container',
            'profile': 'profile-container',
            'settings': 'settings-container'
        };
        const container = document.getElementById(containerMap[filter]);
        if (container) {
            container.style.display = 'block';
            if (filter === 'profile') getProfileModule().then(m => m.renderProfile());
            if (filter === 'settings') getProfileModule().then(m => m.renderSettings());
        }
        return;
    }

    if (filter === 'search') {
        if(DOM.gridContainer) DOM.gridContainer.style.display = 'block';

        const idsToHide = [
            'filter-controls',
            'genre-dropdown-visual',
            'lang-dropdown-visual',
            'sort-dropdown-visual',
            'letter-dropdown-visual',
            'request-dropdown-visual',
            'ucm-sort-buttons',
            'back-to-sagas-btn',
            'pagination-controls'
        ];

        idsToHide.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.setProperty('display', 'none', 'important');
        });

        return;
    }

    window.scrollTo(0, 0);
}

// ==========================================
// FILTROS EN CASCADA
// ==========================================
function refreshDependentFilters(type, activeGenre, activeLang) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas?.[type];
    if (!sourceData) return;

    const sagaConfig = appState.content.sagasList?.find(s => s.id === type) || {};
    const confGenres = (sagaConfig.genres_filter || 'si').toLowerCase().trim();

    let filtered = Object.entries(sourceData);

    if (confGenres !== 'no' && activeGenre && activeGenre !== 'all') {
        const gVal = activeGenre.toLowerCase().trim();
        filtered = filtered.filter(([, item]) => {
            if (confGenres === 'fases') {
                const fase = String(item.fase || '').trim();
                if (gVal === 'saga_infinity') return ['1','2','3'].includes(fase);
                if (gVal === 'saga_multiverse') return ['4','5','6'].includes(fase);
                return fase === gVal;
            }
            const genresStr = String(item.genres || '').toLowerCase();
            const titleStr  = String(item.title  || '').toLowerCase();
            return genresStr.includes(gVal) || titleStr.includes(gVal);
        });
    }

    let filteredByLang = filtered;
    if (activeLang && activeLang !== 'all') {
        const lVal = activeLang.toLowerCase().trim();
        filteredByLang = filtered.filter(([, item]) => {
            const lang = String(item.language || item.idioma || item.audio || '').toLowerCase();
            return lang.includes(lVal);
        });
    }

    const langList   = document.getElementById('lang-menu-list');
    const langFilter = DOM.langFilter;
    if (langList && langFilter) {
        langList.innerHTML = '';
        langFilter.innerHTML = '<option value="all">Todos</option>';
        langList.appendChild(_makeFilterItem('all', 'Todos', 'lang'));

        const langs = new Set();
        filtered.forEach(([, item]) => {
            const raw = item.language || item.idioma || item.audio || '';
            String(raw).split(';').map(l => l.trim()).filter(Boolean).forEach(l => langs.add(l));
        });
        Array.from(langs).sort().forEach(lang => {
            langList.appendChild(_makeFilterItem(lang, lang, 'lang'));
            langFilter.innerHTML += `<option value="${lang}">${lang}</option>`;
        });
    }
}

function _makeFilterItem(value, label, menuType) {
    const div = document.createElement('div');
    div.className = 'dropdown-item';
    if (value) div.dataset.value = value;
    div.textContent = label;
    div.onclick = (e) => {
        e.stopPropagation();
        const currentType = appState.ui.activeSagaId || appState.currentFilter || 'movie';
        if (menuType === 'lang') {
            document.getElementById('lang-text').textContent = label === 'Todos' ? 'Idioma' : label.split(' (')[0];
            DOM.langFilter.value = value;
            document.getElementById('lang-dropdown-visual')?.classList.remove('open');
            applyAndDisplayFilters(currentType);
        }
    };
    return div;
}

// ==========================================
// FUNCIÓN: POPULAR FILTROS 
// ==========================================
function populateFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas[type];

    const sagaConfig = appState.content.sagasList.find(s => s.id === type) || {};
    const confGenres = (sagaConfig.genres_filter || 'si').toLowerCase().trim();
    const confSortBtn = (sagaConfig.sort_buttons || 'no').toLowerCase().trim();
    const confLang = (sagaConfig.lang_filter || 'si').toLowerCase().trim();

    const genreVisual = document.getElementById('genre-dropdown-visual');
    const sortVisual  = document.getElementById('sort-dropdown-visual');
    const langVisual  = document.getElementById('lang-dropdown-visual');
    const letterVisual = document.getElementById('letter-dropdown-visual');

    const genreList = document.getElementById('genre-menu-list');
    const langList  = document.getElementById('lang-menu-list');
    const letterList = document.getElementById('letter-menu-list');
    const requestList = document.getElementById('request-menu-list');
    
    const letterSelect = document.getElementById('letter-filter');
    const requestSelect = document.getElementById('request-filter');
    const requestVisual = document.getElementById('request-dropdown-visual');

    const controlsContainer = document.getElementById('filter-controls');
    if (controlsContainer) controlsContainer.style.display = 'flex';

    const createItem = (value, label, menuType, isGroup = false, imgUrl = null) => {
        const div = document.createElement('div');
        div.className = isGroup ? 'dropdown-group-title' : 'dropdown-item';
        if (value) div.dataset.value = value; 

        if (isGroup && imgUrl) {
            div.innerHTML = `<img src="${imgUrl}" class="dropdown-group-logo" alt="${label}">`;
            div.classList.add('has-logo');
        } else {
            div.textContent = label;
        }

        if (isGroup && value) div.style.cursor = "pointer";

        div.onclick = (e) => {
            e.stopPropagation();

            if (menuType === 'genre') {
                document.getElementById('genre-text').textContent = label === 'Todos' ? 'Géneros' : label.split(' (')[0];
                DOM.genreFilter.value = value;
                if (genreVisual) genreVisual.classList.remove('open');
            } else if (menuType === 'lang') {
                document.getElementById('lang-text').textContent = label === 'Todos' ? 'Idioma' : label.split(' (')[0];
                DOM.langFilter.value = value;
                if (langVisual) langVisual.classList.remove('open');
            } else if (menuType === 'request') {
                document.getElementById('request-text').textContent = label === 'Todos' ? 'Pedidos' : label.split(' (')[0];
                if (requestSelect) requestSelect.value = value;
                if (requestVisual) requestVisual.classList.remove('open');
            } else {
                document.getElementById('sort-text').textContent = label;
                DOM.sortBy.value = value;
                if (sortVisual) sortVisual.classList.remove('open');
            }

            if (menuType !== 'sort' && menuType !== 'letter') {
                const activeGenre   = DOM.genreFilter?.value || 'all';
                const activeLang    = DOM.langFilter?.value  || 'all';
                const activeRequest = requestSelect?.value   || 'all';

                const sub = (g, l, r) => {
                    let items = Object.entries(sourceData);
                    if (confGenres !== 'no' && g !== 'all') {
                        const gv = g.toLowerCase().trim();
                        items = items.filter(([, d]) => {
                            if (confGenres === 'fases') {
                                const f = String(d.fase||'').trim();
                                if (gv==='saga_infinity')   return ['1','2','3'].includes(f);
                                if (gv==='saga_multiverse') return ['4','5','6'].includes(f);
                                return f === gv;
                            }
                            return String(d.genres||'').toLowerCase().includes(gv) ||
                                   String(d.title ||'').toLowerCase().includes(gv);
                        });
                    }
                    if (l !== 'all') {
                        const lv = l.toLowerCase().trim();
                        items = items.filter(([, d]) =>
                            String(d.language||d.idioma||d.audio||'').toLowerCase().includes(lv));
                    }
                    if (r !== 'all') {
                        items = items.filter(([, d]) => (d.pedido||'').trim() === r);
                    }
                    return items;
                };

                if (confLang === 'si' && langList && DOM.langFilter) {
                    const langCounts = new Map();
                    sub(activeGenre, 'all', activeRequest).forEach(([,d]) =>
                        String(d.language||d.idioma||d.audio||'')
                            .split(';').map(s=>s.trim()).filter(Boolean).forEach(l => {
                                langCounts.set(l, (langCounts.get(l) || 0) + 1);
                            })
                    );
                    langList.innerHTML = '';
                    DOM.langFilter.innerHTML = '<option value="all">Todos</option>';
                    langList.appendChild(createItem('all', 'Todos', 'lang'));
                    [...langCounts.keys()].sort().forEach(l => {
                        const lbl = `${l} (${langCounts.get(l)})`;
                        langList.appendChild(createItem(l, lbl, 'lang'));
                        DOM.langFilter.innerHTML += `<option value="${l}">${lbl}</option>`;
                    });
                    if (activeLang !== 'all' && !langCounts.has(activeLang)) {
                        DOM.langFilter.value = 'all';
                        document.getElementById('lang-text').textContent = 'Idioma';
                    } else {
                        DOM.langFilter.value = activeLang;
                    }
                }

                if (requestList && requestSelect) {
                    const requestCounts = new Map();
                    sub(activeGenre, activeLang, 'all').forEach(([,d]) => {
                        const p = d.pedido?.trim();
                        if (p) requestCounts.set(p, (requestCounts.get(p) || 0) + 1);
                    });
                    requestList.innerHTML = '';
                    requestSelect.innerHTML = '<option value="all">Todos</option>';
                    requestList.appendChild(createItem('all', 'Todos', 'request'));
                    [...requestCounts.keys()].sort().forEach(n => {
                        const lbl = `${n} (${requestCounts.get(n)})`;
                        requestList.appendChild(createItem(n, lbl, 'request'));
                        requestSelect.innerHTML += `<option value="${n}">${lbl}</option>`;
                    });
                    if (requestVisual) requestVisual.style.display = requestCounts.size === 0 ? 'none' : 'block';
                    if (activeRequest !== 'all' && !requestCounts.has(activeRequest)) {
                        requestSelect.value = 'all';
                        document.getElementById('request-text').textContent = 'Pedidos';
                    } else {
                        requestSelect.value = activeRequest;
                    }
                }

                if ((type==='movie'||type==='series') && confGenres!=='no' && confGenres!=='fases' && genreList) {
                    const genreCounts = new Map();
                    sub('all', activeLang, activeRequest).forEach(([,d]) =>
                        String(d.genres||'').split(';').map(s=>s.trim()).filter(Boolean).forEach(g => {
                            genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
                        })
                    );
                    genreList.innerHTML = '';
                    DOM.genreFilter.innerHTML = '<option value="all">Todos</option>';
                    genreList.appendChild(createItem('all', 'Todos', 'genre'));
                    [...genreCounts.keys()].sort().forEach(g => {
                        const lbl = `${g} (${genreCounts.get(g)})`;
                        genreList.appendChild(createItem(g, lbl, 'genre'));
                        DOM.genreFilter.innerHTML += `<option value="${g}">${lbl}</option>`;
                    });
                    if (activeGenre !== 'all' && !genreCounts.has(activeGenre)) {
                        DOM.genreFilter.value = 'all';
                        document.getElementById('genre-text').textContent = 'Géneros';
                    } else {
                        DOM.genreFilter.value = activeGenre;
                    }
                }
            }

            applyAndDisplayFilters(type);
        };
        return div;
    };

    if (genreVisual) genreVisual.style.display = (confGenres !== 'no') ? 'block' : 'none';
    if (langVisual) langVisual.style.display = (confLang === 'si') ? 'block' : 'none';
    if (letterVisual) letterVisual.style.display = 'block';
    if (requestVisual) requestVisual.style.display = (type === 'movie' || type === 'series') ? 'block' : 'none';
    
    const ucmButtons = document.getElementById('ucm-sort-buttons');
    const isDynamicSaga = (type !== 'movie' && type !== 'series');

    if (ucmButtons) {
        ucmButtons.style.display = (confSortBtn === 'si') ? 'flex' : 'none';
        if (sortVisual) {
            if (confSortBtn === 'si') {
                sortVisual.style.display = 'none';
            } else if (isDynamicSaga && confSortBtn === 'no') {
                sortVisual.style.display = 'none';
            } else {
                sortVisual.style.display = 'block';
            }
        }
    } else {
        if (sortVisual) {
            sortVisual.style.display = (isDynamicSaga && confSortBtn === 'no') ? 'none' : 'block';
        }
    }

    if (confGenres !== 'no') {
        genreList.innerHTML = '';
        DOM.genreFilter.innerHTML = `<option value="all">Todos</option>`; 
        
        if (confGenres === 'fases') {
            genreList.appendChild(createItem('all', 'Todas las Fases', 'genre'));
            document.getElementById('genre-text').textContent = "Todas las Fases";
            
            const estructuraSagas = [
                { id: 'saga_infinity', titulo: "Saga del Infinito", img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056286/InfinitySaga2_t3ixis.svg", fases: ['1', '2', '3'] },
                { id: 'saga_multiverse', titulo: "Saga del Multiverso", img: "https://res.cloudinary.com/djhgmmdjx/image/upload/v1764056259/MultiverseSaga2_waggse.svg", fases: ['4', '5', '6'] }
            ];

            const fasesDisponibles = new Set(Object.values(sourceData).map(i => String(i.fase || '').trim()).filter(Boolean));

            estructuraSagas.forEach(saga => {
                genreList.appendChild(createItem(saga.id, saga.titulo, 'genre', true, saga.img));
                DOM.genreFilter.innerHTML += `<option value="${saga.id}">${saga.titulo}</option>`;
                saga.fases.forEach(f => { 
                    if(fasesDisponibles.has(f)) {
                        genreList.appendChild(createItem(f, `Fase ${f}`, 'genre'));
                        DOM.genreFilter.innerHTML += `<option value="${f}">Fase ${f}</option>`;
                    }
                });
            });

        } else if (confGenres === 'sagas') {
            genreList.appendChild(createItem('all', 'Todas las Sagas', 'genre'));
            document.getElementById('genre-text').textContent = "Todas las Sagas";
            
            genreList.appendChild(createItem('Harry Potter', 'Harry Potter', 'genre'));
            genreList.appendChild(createItem('Animales Fantásticos', 'Animales Fantásticos', 'genre'));
            DOM.genreFilter.innerHTML += `<option value="Harry Potter">Harry Potter</option>`;
            DOM.genreFilter.innerHTML += `<option value="Animales Fantásticos">Animales Fantásticos</option>`;

        } else if (confGenres === 'eras') {
            genreList.appendChild(createItem('all', 'Todas las Eras', 'genre'));
            document.getElementById('genre-text').textContent = "Todas las Eras";
            
            const eras = [{ id: 'republic', label: 'La República' }, { id: 'empire', label: 'El Imperio' }, { id: 'rebellion', label: 'La Rebelión' }];
            eras.forEach(e => {
                genreList.appendChild(createItem(e.id, e.label, 'genre'));
                DOM.genreFilter.innerHTML += `<option value="${e.id}">${e.label}</option>`;
            });

        } else {
            const genreCounts = new Map();
            Object.values(sourceData).forEach(item => {
                String(item.genres||'').split(';').map(g=>g.trim()).filter(Boolean).forEach(g => {
                    genreCounts.set(g, (genreCounts.get(g)||0) + 1);
                });
            });
            genreList.appendChild(createItem('all', 'Todos', 'genre'));
            document.getElementById('genre-text').textContent = "Géneros";

            [...genreCounts.keys()].sort().forEach(g => {
                const lbl = `${g} (${genreCounts.get(g)})`;
                genreList.appendChild(createItem(g, lbl, 'genre'));
                DOM.genreFilter.innerHTML += `<option value="${g}">${lbl}</option>`;
            });
        }
    }

    if (confLang === 'si' && langList) {
        langList.innerHTML = '';
        DOM.langFilter.innerHTML = `<option value="all">Todos</option>`;
    
    langList.appendChild(createItem('all', 'Todos', 'lang'));
    document.getElementById('lang-text').textContent = "Idioma";
    
    const langCounts = new Map();
    Object.values(sourceData).forEach(item => {
        const rawLang = item.language || item.idioma || item.audio || "";
        if (rawLang && String(rawLang).trim() !== "") {
            String(rawLang).split(';').map(l => l.trim()).filter(Boolean).forEach(lang => {
                langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
            });
        }
    });

    [...langCounts.keys()].sort().forEach(lang => {
        const lbl = `${lang} (${langCounts.get(lang)})`;
        langList.appendChild(createItem(lang, lbl, 'lang'));
        DOM.langFilter.innerHTML += `<option value="${lang}">${lbl}</option>`;
    });
    }

    const sortList = document.getElementById('sort-menu-list');
    
    if (confSortBtn === 'si') {
        const btnRelease = document.querySelector('.sort-btn[data-sort="release"]');
        const btnChrono = document.querySelector('.sort-btn[data-sort="chronological"]');
        
        if (btnRelease && btnChrono) {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btnRelease.classList.add('active');
            
            if (DOM.sortBy) DOM.sortBy.value = 'release';
        }
    }

    if (confSortBtn === 'no' && sortList) {
        sortList.innerHTML = '';

        if (DOM.sortBy) DOM.sortBy.innerHTML = ''; 
        
        const sortOptions = [
            {val:'recent', label:'Recientes'},
            {val:'title-asc', label:'Título (A-Z)'}, 
            {val:'title-desc', label:'Título (Z-A)'},
            {val:'year-desc', label:'Año (Desc.)'}, 
            {val:'year-asc', label:'Año (Asc.)'}
        ];

        if (type !== 'series') {
            sortOptions.push(
                {val:'duration-asc', label:'- Duración'}, 
                {val:'duration-desc', label:'+ Duración'}
            );
        }

        sortOptions.push(
            {val:'rating-desc', label:'★ Mayor Reseña'},
            {val:'rating-asc',  label:'★ Menor Reseña'}
        );
        
        sortOptions.forEach(o => {
            sortList.appendChild(createItem(o.val, o.label, 'sort'));

            if (DOM.sortBy) {
                const option = document.createElement('option');
                option.value = o.val;
                option.textContent = o.label;
                DOM.sortBy.appendChild(option);
            }
        });
    }

    if (letterList && letterSelect) {
        letterList.innerHTML = '';
        letterSelect.innerHTML = `<option value="all">Todas</option>`;
        
        letterList.appendChild(createItem('all', 'Todas', 'letter'));
        
        const firstLetters = new Set();
        let hasNumbers = false;
        
        Object.values(sourceData).forEach(item => {
            if (item.title) {
                const firstChar = String(item.title).trim().charAt(0).toUpperCase();
                if (firstChar) {
                    if (!isNaN(parseInt(firstChar))) {
                        hasNumbers = true;
                    } else if (/[A-Z]/.test(firstChar)) {
                        firstLetters.add(firstChar);
                    }
                }
            }
        });
        
        if (hasNumbers) {
            letterList.appendChild(createItem('#', '0-9', 'letter'));
            letterSelect.innerHTML += `<option value="#">0-9</option>`;
        }
        
        Array.from(firstLetters).sort().forEach(letter => {
            letterList.appendChild(createItem(letter, letter, 'letter'));
            letterSelect.innerHTML += `<option value="${letter}">${letter}</option>`;
        });
    }

    if (requestList && requestSelect) {
        document.getElementById('request-text').textContent = 'Pedidos';
        requestList.innerHTML = '';
        requestSelect.innerHTML = '<option value="all">Todos</option>';
        requestList.appendChild(createItem('all', 'Todos', 'request'));

        const requestCounts = new Map();
        Object.values(sourceData).forEach(item => {
            const p = item.pedido?.trim();
            if (p) requestCounts.set(p, (requestCounts.get(p) || 0) + 1);
        });

        [...requestCounts.keys()].sort().forEach(name => {
            const lbl = `${name} (${requestCounts.get(name)})`;
            requestList.appendChild(createItem(name, lbl, 'request'));
            requestSelect.innerHTML += `<option value="${name}">${lbl}</option>`;
        });

        if (requestVisual) requestVisual.style.display = requestCounts.size === 0 ? 'none' : 'block';
    }

    const configDropdown = (trigger, visual) => {
        if (!trigger) return;
        const newTrigger = trigger.cloneNode(true);
        trigger.parentNode.replaceChild(newTrigger, trigger);
        newTrigger.onclick = (e) => { 
            e.stopPropagation(); 
            [genreVisual, sortVisual, langVisual, letterVisual, requestVisual].forEach(v => {
                if(v && v !== visual) v.classList.remove('open');
            });
            visual.classList.toggle('open'); 
        };
    };

    if(document.getElementById('genre-trigger')) configDropdown(document.getElementById('genre-trigger'), genreVisual);
    if(document.getElementById('sort-trigger')) configDropdown(document.getElementById('sort-trigger'), sortVisual);
    if(document.getElementById('lang-trigger')) configDropdown(document.getElementById('lang-trigger'), langVisual); 
    if(document.getElementById('letter-trigger')) configDropdown(document.getElementById('letter-trigger'), letterVisual);
    if(document.getElementById('request-trigger')) configDropdown(document.getElementById('request-trigger'), requestVisual);
}

// ==========================================
// FUNCIÓN: APLICAR Y MOSTRAR
// ==========================================
async function applyAndDisplayFilters(type) {
    let sourceData;
    if (type === 'movie') sourceData = appState.content.movies;
    else if (type === 'series') sourceData = appState.content.series;
    else sourceData = appState.content.sagas[type]; 

    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl || !sourceData) return;

    const sagaConfig = appState.content.sagasList.find(s => s.id === type) || {};
    const confGenres = (sagaConfig.genres_filter || 'si').toLowerCase().trim();
    const confSortBtn = (sagaConfig.sort_buttons || 'no').toLowerCase().trim();
    const confLang   = (sagaConfig.lang_filter || 'si').toLowerCase().trim();

    let sortByValue = (confSortBtn === 'si') ? 
        (document.querySelector('.sort-btn.active')?.dataset.sort || 'release') : 
        (DOM.sortBy.value || 'recent');
        
    const letterFilterVal = document.getElementById('letter-filter')?.value || 'all';
    const requestFilterVal = document.getElementById('request-filter')?.value || 'all';

    gridEl.innerHTML = `<div style="width:100%;height:60vh;display:flex;justify-content:center;align-items:center;grid-column:1/-1;"><p class="loading-text">Cargando...</p></div>`;

    let content = Object.entries(sourceData);
    const isDynamicSaga = (type !== 'movie' && type !== 'series');
    
    if (isDynamicSaga) content.reverse();
    
    content.forEach((item, index) => { item[1]._originalIndex = index; });

    if (confGenres !== 'no' && DOM.genreFilter.value !== 'all') {
        const filterVal = DOM.genreFilter.value.toLowerCase().trim();
        
        content = content.filter(([id, item]) => {
            if (confGenres === 'fases') {
                const fase = String(item.fase || '').trim();
                if (filterVal === 'saga_infinity') return ['1','2','3'].includes(fase);
                if (filterVal === 'saga_multiverse') return ['4','5','6'].includes(fase);
                return fase === filterVal;
            }
            const genresStr = String(item.genres || '').toLowerCase();
            const titleStr = String(item.title || '').toLowerCase();
            return genresStr.includes(filterVal) || titleStr.includes(filterVal);
        });
    }

    if (confLang === 'si' && DOM.langFilter && DOM.langFilter.value !== 'all') {
    const langVal = DOM.langFilter.value.toLowerCase().trim();
    content = content.filter(([id, item]) => {
            const itemLang = String(item.language || item.idioma || item.audio || '').toLowerCase();
            return itemLang.includes(langVal);
        });
    }

    if (letterFilterVal !== 'all') {
        content = content.filter(([id, item]) => {
            const firstChar = String(item.title || '').trim().charAt(0).toUpperCase();
            if (letterFilterVal === '#') return !isNaN(parseInt(firstChar));
            return firstChar === letterFilterVal;
        });
    }

    if (requestFilterVal !== 'all') {
        content = content.filter(([, item]) => (item.pedido || '').trim() === requestFilterVal);
    }

    if (sortByValue === 'rating-desc' || sortByValue === 'rating-asc') {
        content = content.filter(([id]) => {
            const rating = parseFloat(appState.content.averages[id]);
            return rating > 0;
        });
    }

    content.sort((a, b) => {
        const idA = a[0]; const idB = b[0];
        const aData = a[1]; const bData = b[1];

        let result = 0; 

        if (isDynamicSaga) {
            const getOrderValue = (data) => {
                const orderVal = data.order || data.number || data.id || data.stage || data.episode;
                if (orderVal !== undefined) {
                    const numVal = Number(orderVal);
                    if (!isNaN(numVal)) return numVal;
                }
                return data._originalIndex || 0;
            };
            
            result = getOrderValue(aData) - getOrderValue(bData);
            
            if (result !== 0) return result;
        }

        if (sortByValue === 'recent' || sortByValue === 'release') {
            
            const typeA = (aData.type === 'series' || appState.content.series[idA]) ? 'series' : 'movie';
            const typeB = (bData.type === 'series' || appState.content.series[idB]) ? 'series' : 'movie';

            const timeA = getLatestUpdateTimestamp(idA, aData, typeA);
            const timeB = getLatestUpdateTimestamp(idB, bData, typeB);

            if (timeA !== timeB) {
                result = timeB - timeA; 
            }

            else if (timeA > 0) { 
                const getScore = (id, data, t) => {
                    if (isDateRecent(data.date_added)) return 3; 
                    if (t === 'series' && hasRecentSeasonFromPosters(id)) return 2; 
                    if (t === 'series' && hasRecentEpisodes(id)) return 1; 
                    return 0;
                };
                result = getScore(idB, bData, typeB) - getScore(idA, aData, typeA);
            }

            else {
                result = (Number(bData.tr) || 0) - (Number(aData.tr) || 0);
            }
        }

        else if (sortByValue === 'chronological') {
            result = (Number(aData.cronologia) || 9999) - (Number(bData.cronologia) || 9999);
        }
        else if (sortByValue === 'year-asc') {
            result = (Number(aData.year) || 9999) - (Number(bData.year) || 9999);
        }
        else if (sortByValue === 'year-desc') {
            result = (Number(bData.year) || 0) - (Number(aData.year) || 0);
        }
        else if (sortByValue === 'title-asc') {
            result = (aData.title || '').localeCompare(bData.title || '');
        }
        else if (sortByValue === 'title-desc') {
            result = (bData.title || '').localeCompare(aData.title || '');
        }
        else if (sortByValue === 'duration-asc' || sortByValue === 'duration-desc') {
            const getMinutes = (item) => {
                const d = String(item.duration || item.duracion || '').toLowerCase().trim();
                if (!d) return 0;

                let minutes = 0;
                const h = d.match(/(\d+)\s*h/);
                const m = d.match(/(\d+)\s*m/);
                if (h) minutes += parseInt(h[1]) * 60;
                if (m) minutes += parseInt(m[1]);

                if (!h && !m) {
                    const num = parseInt(d.replace(/\D/g, '')); 
                    if (!isNaN(num)) minutes = num;
                }
                return minutes;
            };

            const minA = getMinutes(aData);
            const minB = getMinutes(bData);

            if (sortByValue === 'duration-asc') result = minA - minB; 
            if (sortByValue === 'duration-desc') result = minB - minA; 
        }
        else if (sortByValue === 'rating-desc' || sortByValue === 'rating-asc') {
            const ratingA = parseFloat(appState.content.averages[idA]) || 0;
            const ratingB = parseFloat(appState.content.averages[idB]) || 0;
            const hasA = ratingA > 0;
            const hasB = ratingB > 0;
            if (!hasA && !hasB) result = 0;
            else if (!hasA) result = 1;
            else if (!hasB) result = -1;
            else if (sortByValue === 'rating-desc') result = ratingB - ratingA;
            else result = ratingA - ratingB;
        }

        return result;
    });

    if (sortByValue === 'chronological') {
        const expandedContent = [];
        
        content.forEach(([id, item]) => {
            const multiChrono = item.cronologiaMulti || item.cronologia_multi; 
            
            if (multiChrono) {
                const seriesPosters = appState.content.seasonPosters[id] || {};

                const getSeasonPoster = (num) => {
                    const p = seriesPosters[num];
                    if (!p) return item.poster; 
                    return (typeof p === 'object') ? p.posterUrl : p;
                };

                const t1 = { 
                    ...item, 
                    title: `${item.title} (T1)`,
                    poster: getSeasonPoster(1) 
                };
                expandedContent.push([id, t1]); 

                String(multiChrono).split(',').map(c => c.trim()).forEach((chronoVal, index) => {
                    const sNum = index + 2; 
                    const tNext = { 
                        ...item, 
                        title: `${item.title} (T${sNum})`, 
                        cronologia: chronoVal,
                        poster: getSeasonPoster(sNum) 
                    };
                    expandedContent.push([id, tNext]); 
                });

            } else { 
                expandedContent.push([id, item]); 
            }
        });

        expandedContent.sort((a, b) => (Number(a[1].cronologia)||99999) - (Number(b[1].cronologia)||99999));
        content = expandedContent;
    }

    appState.ui.contentToDisplay = content;
    appState.ui.currentIndex = 0; 
    setupPaginationControls();

    const firstPageItems = content.slice(0, UI.ITEMS_PER_LOAD);
    const imagePromises = firstPageItems.map(([id, item]) => preloadImage(item.poster));

    try { await Promise.race([Promise.all(imagePromises), new Promise(r => setTimeout(r, 1000))]); } catch (e) {}

    renderCurrentPage();
}

function setupEventListeners() {
    console.log('⚙️ Configurando Event Listeners...');
    document.addEventListener('click', handleGlobalClick);

    const navLinks = document.querySelectorAll('.main-nav a, .bottom-nav .nav-link, .profile-hub-menu-item');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const filter = link.dataset.filter;
            
            switchView(filter);
            
            const dropdown = document.getElementById('user-menu-dropdown');
            if (dropdown && dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            }
        });
    });

    const mobileRouletteBtn = document.querySelector('.mobile-roulette-btn');
    if (mobileRouletteBtn) {
        mobileRouletteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('roulette');
        });
    }

    DOM.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            DOM.searchInput.value = '';
            DOM.searchInput.blur();
            const currentFilter = document.querySelector('.main-nav a.active')?.dataset.filter || 'all';
            switchView(currentFilter);
        }
    });

    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.dropdown-trigger');
        const dropdown = e.target.closest('.custom-dropdown');
        
        if (trigger) {
            e.stopPropagation(); 
            const menu = dropdown.querySelector('.dropdown-menu');
            
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });
            
            if (menu) menu.classList.toggle('show');
        } else {
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                m.classList.remove('show');
            });
        }
    });

    document.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;

        const dropdown = item.closest('.custom-dropdown');
        if (!dropdown) return;

        let selectId = '';
        let triggerTextId = '';

        if (dropdown.id === 'genre-dropdown-visual') {
            selectId = 'genre-filter';
            triggerTextId = 'genre-text';
        } else if (dropdown.id === 'lang-dropdown-visual') {
            selectId = 'lang-filter';
            triggerTextId = 'lang-text';
        } else if (dropdown.id === 'sort-dropdown-visual') {
            selectId = 'sort-by';
            triggerTextId = 'sort-text';
        }

        if (!selectId) return;

        dropdown.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        
        const triggerText = document.getElementById(triggerTextId);
        if (triggerText) triggerText.textContent = item.textContent;

        const hiddenSelect = document.getElementById(selectId);
        if (hiddenSelect) {
            hiddenSelect.value = item.dataset.value;
            
            const currentType = appState.ui.activeSagaId || 'movie'; 
            let sourceData = null;

            if (currentType === 'movie') sourceData = appState.content.movies;
            else if (currentType === 'series') sourceData = appState.content.series;
            else if (currentType === 'ucm') sourceData = appState.content.ucm;
            else if (appState.content.sagas[currentType]) sourceData = appState.content.sagas[currentType];

            if (sourceData) {
                applyAndDisplayFilters(currentType);
            }
        }
    });

    const backSagaBtn = document.getElementById('back-to-sagas-btn');
    if (backSagaBtn) {
        backSagaBtn.addEventListener('click', () => switchView('sagas'));
    }

    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (btn.closest('#review-form-modal')) {
                e.preventDefault();
                e.stopPropagation();
                const reviewModal = document.getElementById('review-form-modal');
                if (reviewModal) reviewModal.classList.remove('show');
                const cinemaOpen = document.getElementById('cinema')?.classList.contains('show');
                const seriesOpen = document.getElementById('series-player-modal')?.classList.contains('show');
                if (!cinemaOpen && !seriesOpen) document.body.classList.remove('modal-open');
                return;
            }

            ModalManager.closeAll();
            const cinema = document.getElementById('cinema');
            if (cinema) {
                const iframe = cinema.querySelector('iframe');
                if (iframe) iframe.src = '';
                const video = cinema.querySelector('video');
                if (video) video.pause();
                
                // 🔥 Destruir ArtPlayer
                if (appState?.player?.activeCineInstance) {
                    appState.player.activeCineInstance.destroy();
                    appState.player.activeCineInstance = null;
                }
            }
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            if (e.target.id === 'review-form-modal') {
                e.target.classList.remove('show');
                const cinemaOpen = document.getElementById('cinema')?.classList.contains('show');
                const seriesOpen = document.getElementById('series-player-modal')?.classList.contains('show');
                if (!cinemaOpen && !seriesOpen) document.body.classList.remove('modal-open');
                return;
            }

            if (e.target.id === 'series-player-page') return;

            ModalManager.closeAll();
        }
    });

    const loginHeader = document.getElementById('login-btn-header');
    const regHeader = document.getElementById('register-btn-header');

    if (loginHeader) {
        loginHeader.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.openAuthModal) window.openAuthModal(true);
        });
    }
    if (regHeader) {
        regHeader.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.openAuthModal) window.openAuthModal(false);
        });
    }

    const loginBtnHub = document.getElementById('login-btn-hub');
    if (loginBtnHub) {
        loginBtnHub.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.openAuthModal) window.openAuthModal(true);
        });
    }

    const registerBtnHub = document.getElementById('register-btn-hub');
    if (registerBtnHub) {
        registerBtnHub.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.openAuthModal) window.openAuthModal(false);
        });
    }

    document.addEventListener('click', (e) => {
        const header = e.target.closest('.accordion-header');
        if (header) {
            const item = header.parentElement;
            const isActive = item.classList.contains('active');
            
            const parentAccordion = item.closest('.schedule-accordion');
            if (parentAccordion) {
                parentAccordion.querySelectorAll('.accordion-item').forEach(el => {
                    el.classList.remove('active');
                });
            }
            
            if (!isActive) {
                item.classList.add('active');
            }
        }
    });

    window.addEventListener('scroll', () => {
        if (DOM.header) {
            if (window.scrollY > 50) {
                DOM.header.classList.add('scrolled');
            } else {
                DOM.header.classList.remove('scrolled');
            }
        }
    });

    const sortButtons = document.querySelectorAll('.sort-btn');
    if (sortButtons.length > 0) {
        sortButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                sortButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const currentSagaId = appState.ui.activeSagaId; 
                
                if (currentSagaId) {
                    const sagaData = appState.content.sagas[currentSagaId] || appState.content.ucm;
                    if (sagaData) {
                        applyAndDisplayFilters(currentSagaId);
                    }
                }
            });
        });
    }
}

function handleFullscreenChange() {
    const lockOrientation = async () => {
        try {
            if (screen.orientation && typeof screen.orientation.lock === 'function') {
                await screen.orientation.lock('landscape');
            }
        } catch (err) { 
            console.error('No se pudo bloquear la orientación:', err); 
        }
    };
    const unlockOrientation = () => {
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
            screen.orientation.unlock();
        }
    };
    if (document.fullscreenElement) {
        lockOrientation();
    } else {
        unlockOrientation();
    }

    let _lastColumns = UI.getColumns();
    let _resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            const newCols = UI.getColumns();
            if (newCols !== _lastColumns) {
                _lastColumns = newCols;
                if (appState.ui.contentToDisplay && appState.ui.contentToDisplay.length > 0) {
                    appState.ui.currentIndex = 0;
                    setupPaginationControls();
                    renderCurrentPage();
                }
            }
        }, 250);
    });
}

function setupPaginationControls() {
    let paginationContainer = document.getElementById('pagination-controls');
    
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.id = 'pagination-controls';
        paginationContainer.className = 'pagination-container';
        DOM.gridContainer.appendChild(paginationContainer);
    }

    paginationContainer.innerHTML = `
        <button id="prev-page-btn" class="pagination-btn"><i class="fas fa-chevron-left"></i> Anterior</button>
        <span id="page-info" class="pagination-info">Página 1 de 1</span>
        <button id="next-page-btn" class="pagination-btn">Siguiente <i class="fas fa-chevron-right"></i></button>
    `;

    document.getElementById('prev-page-btn').onclick = () => changePage(-1);
    document.getElementById('next-page-btn').onclick = () => changePage(1);
}

async function changePage(direction) {
    const totalPages = Math.ceil(appState.ui.contentToDisplay.length / UI.ITEMS_PER_LOAD);
    const newPage = appState.ui.currentIndex + direction;

    if (newPage >= 0 && newPage < totalPages) {
        appState.ui.currentIndex = newPage;

        const headerOffset = 80; 
        const elementPosition = DOM.gridContainer.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: "smooth" });

        const gridEl = DOM.gridContainer.querySelector('.grid');
        if (gridEl) {
            gridEl.innerHTML = `
                <div style="
                    width: 100%; 
                    height: 60vh; 
                    display: flex; 
                    justify-content: center; 
                    align-items: center; 
                    grid-column: 1 / -1; 
                ">
                    <div class="loading-text">Cargando...</div>
                </div>`;
        }

        const start = appState.ui.currentIndex * UI.ITEMS_PER_LOAD;
        const end = start + UI.ITEMS_PER_LOAD;
        const nextItems = appState.ui.contentToDisplay.slice(start, end);

        const imagePromises = nextItems.map(([id, item]) => preloadImage(item.poster));
        
        try {
            await Promise.race([
                Promise.all(imagePromises),
                new Promise(r => setTimeout(r, 3000))
            ]);
        } catch (e) { console.warn("Tardó mucho en cargar página"); }

        renderCurrentPage();
    }
}

function renderCurrentPage() {
    const gridEl = DOM.gridContainer.querySelector('.grid');
    if (!gridEl) return;

    gridEl.innerHTML = '';

    const start = appState.ui.currentIndex * UI.ITEMS_PER_LOAD;
    const end = start + UI.ITEMS_PER_LOAD;
    const itemsPage = appState.ui.contentToDisplay.slice(start, end);

    const activeFilter = document.querySelector('.main-nav a.active, .mobile-nav a.active')?.dataset.filter;

    itemsPage.forEach(([id, item], index) => {
        let type = 'movie'; 

        if (activeFilter === 'series') {
            type = 'series';
        } else if (activeFilter === 'ucm') {
            if (item.type === 'series' || appState.content.seriesEpisodes[id]) {
                type = 'series';
            } else {
                type = 'movie';
            }
        } else {
            if (appState.content.series[id] || item.type === 'series' || item.type === 'serie') {
                type = 'series';
            }
        }

        const card = createMovieCardElement(id, item, type, 'grid', false); 
        
        const delay = index * 40; 
        card.style.animationDelay = `${delay}ms`;

        gridEl.appendChild(card);
    });

    updatePaginationUI();
}

function updatePaginationUI() {
    const totalPages = Math.ceil(appState.ui.contentToDisplay.length / UI.ITEMS_PER_LOAD);
    const currentPage = appState.ui.currentIndex + 1; 
    
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');

    if (pageInfo) pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
    if (prevBtn) prevBtn.disabled = (currentPage === 1);
    if (nextBtn) nextBtn.disabled = (currentPage === totalPages || totalPages === 0);
    
    const container = document.getElementById('pagination-controls');
    if (container) {
        container.style.display = (totalPages <= 1) ? 'none' : 'flex';
    }
}

function handleGlobalClick(event) {
    const profileContainer = document.getElementById('user-profile-container');
    const dropdown = document.getElementById('user-menu-dropdown');
    
    if (dropdown && dropdown.classList.contains('show')) {
        if (!profileContainer.contains(event.target)) {
            dropdown.classList.remove('show');
        }
    }

    const searchContainer = document.getElementById('search-container');
    const searchInput = document.getElementById('search-input');

    const removeHistoryBtn = event.target.closest('.btn-remove-history');
    
    if (removeHistoryBtn) {
        event.preventDefault();
        event.stopPropagation();
        
        const entryKey = removeHistoryBtn.dataset.key;
        
        if (entryKey) {
            openConfirmationModal(
                'Borrar del Historial',
                '¿Quieres eliminar este título de tu historial de reproducción?',
                () => removeFromHistory(entryKey)
            );
        }
        return;
    }
}

function preloadHeroImages(movieIds) {
    movieIds.forEach((movieId) => {
        const movieData = appState.content.movies[movieId];
        if (!movieData) return;
        const imagesToPreload = [
            { type: 'banner', url: movieData.banner },
            { type: 'poster', url: movieData.poster }
        ];
        imagesToPreload.forEach(({ type, url }) => {
            if (!url) return;
            const img = new Image();
            img.onload = () => {
                const key = `${movieId}_${type}`;
                appState.hero.preloadedImages.set(key, url);
            };
            img.src = url;
        });
    });
}

function setupHero() {
    clearInterval(appState.ui.heroInterval);
    if (!DOM.heroSection) return;
    
    DOM.heroSection.innerHTML = `<div class="hero-content"><div id="hero-title-container"></div><p id="hero-synopsis"></p><div class="hero-buttons"></div></div><div class="guirnalda-container"></div>`;
    
    const getHeroScore = (id, item, type) => {
        const tr = Number(item.tr) || 0;
        
        const lastUpdate = getLatestUpdateTimestamp(id, item, type);
        const now = Date.now();
        const diffDays = (now - lastUpdate) / (1000 * 60 * 60 * 24);
        
        if (diffDays <= 7 && diffDays >= 0) {
            return tr + 100000; 
        }
        return tr; 
    };

    const topMovies = Object.entries(appState.content.movies)
        .map(([id, item]) => ({ 
            id, 
            type: 'movie', 
            score: getHeroScore(id, item, 'movie') 
        }))
        .sort((a, b) => b.score - a.score); 

    const topSeries = Object.entries(appState.content.series)
        .map(([id, item]) => ({ 
            id, 
            type: 'series', 
            score: getHeroScore(id, item, 'series') 
        }))
        .sort((a, b) => b.score - a.score);

    const mixedHeroItems = [];
    const itemsPerCategory = 8; 
    
    for (let i = 0; i < itemsPerCategory; i++) {
        if (topMovies[i]) mixedHeroItems.push(topMovies[i]);
        if (topSeries[i]) mixedHeroItems.push(topSeries[i]);
    }

    appState.ui.heroItems = mixedHeroItems;

    if (mixedHeroItems.length > 0) {
        preloadHeroImages(mixedHeroItems);
        changeHeroMovie(mixedHeroItems[0]); 
        startHeroInterval(); 
    } else {
       DOM.heroSection.style.display = 'none'; 
    }
}

function startHeroInterval() {
    clearInterval(appState.ui.heroInterval);
    let currentHeroIndex = 0;
    if (!appState.ui.heroItems || appState.ui.heroItems.length === 0) return;
    
    appState.ui.heroInterval = setInterval(() => {
        if (window._heroEditPaused) return; 
        currentHeroIndex = (currentHeroIndex + 1) % appState.ui.heroItems.length;
        appState.ui.currentHeroIndex = currentHeroIndex;
        changeHeroMovie(appState.ui.heroItems[currentHeroIndex]);
    }, 8000); 
}

function changeHeroMovie(itemObj) {
    if (appState.hero.isTransitioning || !itemObj) return;
    
    const { id, type } = itemObj; 
    const heroContent = DOM.heroSection.querySelector('.hero-content');
    
    let data = null;
    if (type === 'movie') data = appState.content.movies[id];
    else if (type === 'series') data = appState.content.series[id];

    if (!heroContent || !data) return;

    appState.hero.isTransitioning = true;
    heroContent.classList.add('hero-fading');

    setTimeout(() => {
        const isMobile = window.innerWidth < 992;
        const imageType = isMobile ? 'poster' : 'banner';
        const cacheKey = `${id}_${imageType}`;
        
        const imageUrl = appState.hero.preloadedImages.get(cacheKey) || 
                        (isMobile ? data.poster : data.banner);
        
        DOM.heroSection.style.backgroundImage = `url(${imageUrl})`;
        
        heroContent.style.opacity = '0';
        heroContent.style.transition = 'opacity 0.3s ease';

        const heroTitleContainer = heroContent.querySelector('#hero-title-container');
        if (data.logoUrl) {
            heroTitleContainer.innerHTML = `<div class="hero-logo-container"><img src="${data.logoUrl}" alt="${data.title}" class="hero-logo-img"></div>`;
            const heroLogoContainer = heroTitleContainer.querySelector('.hero-logo-container');
            const heroSlot = getLogoSlot('hero');
            loadLogoSettings(id, heroLogoContainer, () => {
                heroContent.style.opacity = '1';
                const user = auth.currentUser;
                if (user && user.email === 'baquezadat@gmail.com') {
                    initLogoEditor(id, heroLogoContainer, heroSlot);
                }
            }, heroSlot);
        } else {
            heroTitleContainer.innerHTML = `<h1 class="hero-title-text">${data.title}</h1>`;
            heroContent.style.opacity = '1';
        }
        heroContent.querySelector('#hero-synopsis').textContent = data.synopsis;

        const heroButtons = heroContent.querySelector('.hero-buttons');
        heroButtons.innerHTML = ''; 

        const playButton = document.createElement('button');
        playButton.className = 'btn btn-play';
        playButton.innerHTML = `<i class="fas fa-play"></i> ${isMobile ? 'Ver' : 'Ver Ahora'}`;
        playButton.onclick = async () => { 
            const player = await getPlayerModule();
            if (type === 'series') {
                player.openSeriesPlayer(id);
            } else {
                player.openPlayerModal(id, data.title.replace(/'/g, "\\'"));
            }
        };

        const infoButton = document.createElement('button');
        infoButton.className = 'btn btn-info';
        infoButton.textContent = isMobile ? 'Más Info' : 'Más Información';
        infoButton.onclick = () => openDetailsModal(id, type);

        heroButtons.appendChild(playButton);
        heroButtons.appendChild(infoButton);

        const user = auth.currentUser;
        if (user) { 
            const listBtn = document.createElement('button');
            const isInList = appState.user.watchlist.has(id);
            const iconClass = isInList ? 'fa-check' : 'fa-plus';
            
            listBtn.className = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
            listBtn.setAttribute('data-content-id', id);
            listBtn.title = "Añadir a Mi Lista";
            listBtn.innerHTML = `<i class="fas ${iconClass}"></i>`;
            
            listBtn.onclick = (e) => {
                e.stopPropagation(); 
                handleWatchlistClick(listBtn);
            };

            heroButtons.appendChild(listBtn);
        }

        heroContent.classList.remove('hero-fading');
        appState.hero.isTransitioning = false;
    }, 300);
}

function generateCarousels() {
    const container = DOM.carouselContainer;
    container.innerHTML = '';

    createCarouselSection('Películas Nuevas', appState.content.movies);
    createCarouselSection('Series Nuevas', appState.content.series);
}

function createCarouselSection(title, dataSource) {
    if (!dataSource || Object.keys(dataSource).length === 0) return;

    const section = document.createElement('section');
    section.classList.add('carousel');

    const titleEl = document.createElement('h2');
    titleEl.classList.add('carousel-title');
    titleEl.textContent = title;
    section.appendChild(titleEl);

    const track = document.createElement('div');
    track.classList.add('carousel-track');

    let entries = Object.entries(dataSource);

    entries.sort((a, b) => {
        const idA = a[0]; const idB = b[0];
        const aData = a[1]; const bData = b[1];
        
        const typeA = title.toLowerCase().includes('serie') ? 'series' : 'movie';
        const typeB = typeA;

        const timeA = getLatestUpdateTimestamp(idA, aData, typeA);
        const timeB = getLatestUpdateTimestamp(idB, bData, typeB);

        if (timeA !== timeB) return timeB - timeA;

        if (timeA > 0) {
             const getScore = (id, data) => {
                if (isDateRecent(data.date_added)) return 3;
                if (hasRecentSeasonFromPosters(id)) return 2;
                if (hasRecentEpisodes(id)) return 1;
                return 0;
            };
            return getScore(idB, bData) - getScore(idA, aData);
        }

        return (Number(bData.tr) || 0) - (Number(aData.tr) || 0);
    });

    entries.slice(0, 8).forEach(([id, item]) => {
        const type = title.includes('Serie') ? 'series' : 'movie';
        const card = createMovieCardElement(id, item, type, 'carousel', false);
        track.appendChild(card);
    });

    section.appendChild(track);
    DOM.carouselContainer.appendChild(section);
}

function setupSearch() {
    if (!DOM.searchInput) return;
    let isSearchActive = false;

    const norm = str => String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') 
        .replace(/[^a-z0-9\s]/g, '');    

    DOM.searchInput.addEventListener('input', () => {
        const searchTerm = norm(DOM.searchInput.value.trim());
        if (searchTerm === '') {
            const gridEl = DOM.gridContainer.querySelector('.grid');
            if (gridEl) {
                gridEl.style.display = '';
                gridEl.style.justifyContent = '';
                gridEl.style.alignItems = '';
            }

            if (isSearchActive) {
                const activeNav = document.querySelector('.main-nav a.active, .mobile-nav a.active');
                switchView(activeNav ? activeNav.dataset.filter : 'all');
                isSearchActive = false;
            }
            return;
        }
        isSearchActive = true;
        
        let allContent = { ...appState.content.movies, ...appState.content.series };

        if (appState.content.sagas) {
            Object.values(appState.content.sagas).forEach(sagaItems => {
                if (sagaItems) {
                    Object.assign(allContent, sagaItems);
                }
            });
        }

        if (appState.content.ucm) Object.assign(allContent, appState.content.ucm);

        const filtered = Object.entries(allContent).filter(([id, item]) => {
            if (norm(item.title || '').includes(searchTerm)) return true;
            const isSerie = !!appState.content.series[id] || item.type === 'series' || item.type === 'serie';
            if (isSerie) return norm(item.secondTitle || '').includes(searchTerm);
            return norm(id).includes(searchTerm);
        });

        const seenTitles = new Set();
        const results = filtered.filter(([id, item]) => {
        const titleKey = norm(item.title).trim();
            if (seenTitles.has(titleKey)) return false;
                seenTitles.add(titleKey);
            return true;
        });

    displaySearchResults(results);
        });
    }

function displaySearchResults(results) {
    switchView('search');
    const gridEl = DOM.gridContainer.querySelector('.grid');
    
    if (DOM.gridContainer) DOM.gridContainer.style.display = 'block';
    
    if (!gridEl) return;
    gridEl.innerHTML = '';
    
    if (results.length > 0) {
        gridEl.style.display = 'grid';
        results.forEach(([id, item]) => {
            const type = appState.content.series[id] ? 'series' : 'movie';
            gridEl.appendChild(createMovieCardElement(id, item, type, 'grid', false));
        });
    } else {
        gridEl.style.display = 'flex';
        gridEl.style.justifyContent = 'center';
        gridEl.style.alignItems = 'center';
        gridEl.innerHTML = `<p style="color: var(--text-muted); text-align: center;">No se encontraron resultados.</p>`;
    }
}

function generateContinueWatchingCarousel(snapshot) {
    const user = auth.currentUser;
    
    const existingCarousel = document.getElementById('continue-watching-carousel');
    if (existingCarousel) {
        existingCarousel.remove();
    }

    const carouselContainer = document.getElementById('carousel-container');
    
    if (!user || !carouselContainer || !snapshot.exists()) {
        return;
    }

    let historyItems = [];
    snapshot.forEach(child => {
        const item = child.val();
        historyItems.push({
            key: child.key,
            ...item
        });
    });
    
    historyItems.reverse();
    
    const SPECIAL_KEYWORDS = ['pelicula', 'película', 'especial', 'tespecial', 'movie', 'special', 'ova'];
    const isSpecialSeason = (season) => {
        if (season == null) return false;
        const s = String(season).toLowerCase();
        return SPECIAL_KEYWORDS.some(kw => s.includes(kw));
    };
    const seriesOnly = historyItems.filter(item =>
        item.type === 'series' && !isSpecialSeason(item.season)
    );
    
    const seriesToShow = seriesOnly.slice(0, 15);
    
    if (seriesToShow.length === 0) {
        return;
    }

    const carouselEl = document.createElement('div');
    carouselEl.id = 'continue-watching-carousel';
    carouselEl.className = 'carousel'; 
    
    carouselEl.innerHTML = `
        <h3 class="carousel-title">Continuar Viendo</h3>
        <div class="carousel-track"></div>
    `;
    
    const track = carouselEl.querySelector('.carousel-track');
    
    seriesToShow.forEach(historyItem => {
        let seriesData = findContentData(historyItem.contentId);
        
        if (!seriesData) {
            return;
        }
        
        let episodeData = null;
        let episodeThumbnail = null;
        let episodeTitle = null;
        
        if (historyItem.season != null && historyItem.lastEpisode != null) {
            const seriesEpisodes = appState.content.seriesEpisodes[historyItem.contentId];
            if (seriesEpisodes && seriesEpisodes[historyItem.season]) {
                const episodes = seriesEpisodes[historyItem.season];
                if (episodes && episodes[historyItem.lastEpisode]) {
                    episodeData = episodes[historyItem.lastEpisode];
                    episodeThumbnail = episodeData.thumbnail || episodeData.poster;
                    episodeTitle = episodeData.title;
                }
            }
        }
        
        const totalSeasons = Object.keys(appState.content.seriesEpisodes[historyItem.contentId] || {}).length;
        const card = createMovieCardElement(
            historyItem.contentId, 
            seriesData, 
            'series', 
            'carousel', 
            false, 
            {
                source: 'continuar-viendo',
                season: historyItem.season,
                lastEpisode: historyItem.lastEpisode,
                episodeThumbnail: episodeThumbnail,
                episodeTitle: episodeTitle,
                seriesTitle: seriesData.title, 
                historyKey: historyItem.key,
                totalSeasons: totalSeasons     
            }
        );
        
        track.appendChild(card);
    });
    
    carouselContainer.prepend(carouselEl);
}

window.generateContinueWatchingCarousel = generateContinueWatchingCarousel;

function createContinueWatchingCard(itemData) {
    const card = document.createElement('div');
    card.className = 'continue-watching-card';
    card.onclick = async () => { 
        const player = await getPlayerModule();
        player.openPlayerToEpisode(itemData.contentId, itemData.season, itemData.episodeIndexToOpen);
    };
    card.innerHTML = `
        <img src="${itemData.thumbnail}" class="cw-card-thumbnail" alt="">
        <div class="cw-card-overlay"></div>
        <div class="cw-card-info">
            <h4 class="cw-card-title">${itemData.title}</h4>
            <p class="cw-card-subtitle">${itemData.subtitle}</p>
        </div>
        <div class="cw-card-play-icon"><i class="fas fa-play"></i></div>
    `;
    return card;
}

function closeAllModals() {
    const seriesPage = document.getElementById('series-player-page');
    if (seriesPage && seriesPage.classList.contains('active')) {
        seriesPage.classList.remove('active', 'season-grid-view', 'player-layout-view');
        seriesPage.style.display = 'none';
        if (appState?.player) appState.player.activeSeriesId = null;
        if (typeof switchView === 'function') switchView(appState?.currentFilter || 'all');
    }

    document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
        const iframe = modal.querySelector('iframe');
        if (iframe) iframe.src = '';
        
        // 🔥 Destruir ArtPlayer globalmente
        if (appState?.player?.activeCineInstance) {
            appState.player.activeCineInstance.destroy();
            appState.player.activeCineInstance = null;
        }
    });
    document.body.classList.remove('modal-open');

    if (typeof shared !== 'undefined' && shared.appState && shared.appState.player) {
        shared.appState.player.activeSeriesId = null;
        if (shared.appState.player.movieHistoryTimer) {
            clearTimeout(shared.appState.player.movieHistoryTimer);
            shared.appState.player.movieHistoryTimer = null;
        }
    }

    if (localStorage.getItem('pending_reload') === 'true') {
        localStorage.removeItem('pending_reload');
        safeClearStorage();
        
        setTimeout(() => {
            const url = new URL(window.location.href);
            url.searchParams.set('force_update', Date.now());
            window.location.href = url.toString();
        }, 300);
    }
}

async function openDetailsModal(id, type, triggerElement = null) {
    try {
        const modal = DOM.detailsModal;
        const panel = modal.querySelector('.details-panel'); 
        const detailsButtons = document.getElementById('details-buttons');
        const posterImg = document.getElementById('details-poster-img');

        let data = findContentData(id);

        if (!data) {
            if (appState.content.movies[id]) data = appState.content.movies[id];
            else if (appState.content.series[id]) data = appState.content.series[id];
            
            if (!data) {
                ErrorHandler.show('content', 'No se pudo cargar la información del título.');
                return;
            }
        }
        
        if (appState.content.series[id]) {
            data = { ...data, ...appState.content.series[id] };
        }

        const isSeries = (type === 'series' || !!appState.content.series[id] || data.type === 'series' || data.type === 'serie');
        
        const detailsTitleEl = document.getElementById('details-title');
        let logoSettingsPromise = Promise.resolve();
        if (data.logoUrl) {
            detailsTitleEl.innerHTML = `<div class="details-logo-container"><img src="${data.logoUrl}" alt="${data.title || ''}" class="details-logo-img"></div>`;
            const logoContainer = detailsTitleEl.querySelector('.details-logo-container');
            const modalSlot = getLogoSlot('modal');
            logoSettingsPromise = new Promise(resolve => {
                loadLogoSettings(id, logoContainer, resolve, modalSlot);
            });
        } else {
            detailsTitleEl.textContent = data.title || '';
        }
        
        let fullSynopsis = data.synopsis || 'Sin descripción.';
        
        if (!isSeries) {
            const maxChars = 280; 
            if (fullSynopsis.length > maxChars) {
                fullSynopsis = fullSynopsis.substring(0, maxChars).trim() + "...";
            }
        }

        document.getElementById('details-synopsis').textContent = fullSynopsis;
        
        const isVetada = !isSeries && data.estado && data.estado.toLowerCase() === 'vetada';
        if (posterImg) {
            posterImg.src = data.poster || '';
            if (isVetada) {
                posterImg.style.filter = 'grayscale(100%)';
            } else {
                posterImg.style.filter = 'none';
            }
        }

        const detailsMeta = modal.querySelector('.details-meta');
        
        if (detailsMeta) {
            detailsMeta.innerHTML = ''; 

            const modalRating = appState.content.averages[id];
            if (modalRating) {
                const ratingBadge = document.createElement('span');
                ratingBadge.className = 'modal-rating-badge';
                if (reviewsModule && reviewsModule.getStarsHTML) {
                    ratingBadge.innerHTML = reviewsModule.getStarsHTML(modalRating, false);
                } else {
                    ratingBadge.innerHTML = `<i class="fas fa-star" style="color:#ffd700"></i> ${modalRating}`;
                }
                detailsMeta.appendChild(ratingBadge);

                const reviewCount = appState.content.reviewCounts && appState.content.reviewCounts[id];
                if (reviewCount) {
                    const countBadge = document.createElement('button');
                    countBadge.className = 'modal-review-count';
                    countBadge.innerHTML = `<i class="fas fa-comment-dots" style="margin-right:5px; color:#a78bfa;"></i>${reviewCount} ${reviewCount === 1 ? 'reseña' : 'reseñas'}`;
                    countBadge.title = 'Ver todas las reseñas';
                    countBadge.addEventListener('click', () => {
                        const contentTitle = data.title || '';
                        if (reviewsModule && reviewsModule.openContentReviews) {
                            reviewsModule.openContentReviews(id, contentTitle);
                        }
                    });
                    detailsMeta.appendChild(countBadge);
                }
            }

            const isProximamente = !isSeries && data.estado && data.estado.toLowerCase() !== 'vetada' && data.estado.toLowerCase() !== 'mantenimiento' && data.estado.trim() !== '';
            if (isSeries || isVetada || isProximamente) {
                if (data.year) {
                    const yearPill = document.createElement('span');
                    yearPill.className = 'meta-pill';
                    yearPill.textContent = data.year;
                    detailsMeta.appendChild(yearPill);
                }
            }

            const langVal = data.language || data.idioma || data.audio;

            let genresVal = null;
            if (data.genres) {
                if (Array.isArray(data.genres)) {
                    genresVal = data.genres.join(', ');
                } else if (typeof data.genres === 'string') {
                    genresVal = data.genres.replace(/;/g, ', ');
                }
            }

            const normStr = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
            const rawAltTitle = isSeries ? (data.secondTitle || '') : id;
            const originalTitle = rawAltTitle && normStr(rawAltTitle) !== normStr(data.title || '') ? rawAltTitle : null;

            const metaItems = [
                { val: langVal, class: 'meta-pill' },
                { val: genresVal, class: 'meta-pill' }
            ];

            if (originalTitle) {
                const origSpan = document.createElement('span');
                origSpan.className = 'meta-pill original-title-pill';
                origSpan.title = 'Título original';
                origSpan.innerHTML = `<i class="fas fa-film" style="margin-right:5px;opacity:0.7;"></i>${originalTitle}`;
                detailsMeta.insertBefore(origSpan, detailsMeta.firstChild);
            }

            metaItems.forEach(item => {
                if(item.val) {
                    const span = document.createElement('span');
                    span.className = item.class;
                    span.textContent = item.val;
                    detailsMeta.appendChild(span);
                }
            });
        }

        const _bannerUrl = (data.banner && data.banner.length > 5) ? data.banner : null;
        if (panel) {
            panel.style.backgroundImage = 'none';
            panel.style.backgroundColor = '#1a1a1a';
        }

        if (detailsButtons) {
            detailsButtons.innerHTML = '';

            const getProximamenteLabel = (estado) => {
                if (!estado) return null;
                const val = estado.trim();
                const lower = val.toLowerCase();
                if (lower === 'vetada') return null;
                if (lower === 'mantenimiento') return null; 
                if (lower === 'proximamente' || lower === 'próximamente') return 'Próximamente';
                if (/\d/.test(val)) return `Próximamente el ${val}`;
                return `Próximamente en ${val}`;
            };

            const isMantenimiento = !isSeries && data.estado && data.estado.toLowerCase() === 'mantenimiento';
            const proximamenteLabel = !isSeries && data.estado ? getProximamenteLabel(data.estado) : null;

            if (isVetada) {
                const vetadaMsg = document.createElement('div');
                vetadaMsg.className = 'vetada-message';
                vetadaMsg.innerHTML = `
                    <i class="fas fa-lock"></i>
                    <span>No disponible</span>
                `;
                detailsButtons.appendChild(vetadaMsg);
                
                vetadaMsg.style.cssText = `
                    background: linear-gradient(135deg, #1a1a1a, #4a0000);
                    border: 2px solid #ff4444;
                    color: #ff4444;
                    padding: 15px 25px;
                    border-radius: 8px;
                    font-size: 1rem;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    text-shadow: 0 0 10px rgba(255, 68, 68, 0.5);
                    cursor: not-allowed;
                `;
            } else if (proximamenteLabel) {
                const proxMsg = document.createElement('div');
                proxMsg.className = 'vetada-message proximamente-message';
                proxMsg.innerHTML = `
                    <i class="fas fa-clock"></i>
                    <span>${proximamenteLabel}</span>
                `;
                proxMsg.style.cssText = `
                    background: linear-gradient(135deg, #0d1b2a, #1a3a5c);
                    border: 2px solid #4a9eff;
                    color: #4a9eff;
                    padding: 15px 25px;
                    border-radius: 8px;
                    font-size: 1rem;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    cursor: not-allowed;
                    width: 100%;
                    justify-content: center;
                `;
                detailsButtons.appendChild(proxMsg);
            } else if (isMantenimiento) {
                const mantMsg = document.createElement('div');
                mantMsg.className = 'vetada-message mantenimiento-message';
                mantMsg.innerHTML = `<i class="fas fa-wrench"></i><span>En mantenimiento</span>`;
                mantMsg.style.cssText = `
                    background: linear-gradient(135deg, #1a1500, #3a2e00);
                    border: 2px solid #f5a623;
                    color: #f5a623;
                    padding: 15px 25px;
                    border-radius: 8px;
                    font-size: 1rem;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    cursor: not-allowed;
                    width: 100%;
                    justify-content: center;
                `;
                detailsButtons.appendChild(mantMsg);
            } else {
                const playBtn = document.createElement('button');
                playBtn.className = 'btn btn-play';
                playBtn.innerHTML = `<i class="fas fa-play"></i> Ver ahora`;
                playBtn.onclick = async () => {
                    ModalManager.closeAll();
                    const player = await getPlayerModule();
                    
                    if (isSeries) {
                        player.openSeriesPlayer(id);
                    } else {
                        player.openPlayerModal(id, data.title);
                    }
                };
                detailsButtons.appendChild(playBtn);

            if (isSeries) {
                const episodes = appState.content.seriesEpisodes[id] || {};
                
                const randomVal = String(data.randomValue || data.random || '').trim().toLowerCase();
                const isRandomEnabled = ['si', 'sí', 'yes', 'true', '1'].includes(randomVal);
                
                if (isRandomEnabled) {
                    const randomBtn = document.createElement('button');
                    randomBtn.className = 'btn btn-random';
                    randomBtn.innerHTML = `<i class="fas fa-random"></i> Aleatorio`;
                    randomBtn.onclick = async () => {
                        const allEpisodes = [];
                        const episodesData = appState.content.seriesEpisodes[id] || {};
                        
                        Object.keys(episodesData).forEach(seasonKey => {
                            const episodesArray = episodesData[seasonKey];
                            if (Array.isArray(episodesArray)) {
                                episodesArray.forEach((episode, index) => {
                                    if (episode && episode.videoId) {
                                        allEpisodes.push({
                                            season: seasonKey,
                                            episodeIndex: index,
                                            episodeNum: index + 1,
                                            data: episode
                                        });
                                    }
                                });
                            }
                        });

                        if (allEpisodes.length === 0) {
                            ErrorHandler.show('content', 'No hay episodios disponibles.');
                            return;
                        }

                        const randomIndex = Math.floor(Math.random() * allEpisodes.length);
                        const selected = allEpisodes[randomIndex];

                        ModalManager.closeAll();
                        const player = await getPlayerModule();
                        player.openPlayerToEpisode(id, selected.season, selected.episodeIndex);
                    };
                    detailsButtons.appendChild(randomBtn);
                }
                
                if (Object.keys(episodes).length > 1) {
                    const infoBtn = document.createElement('button');
                    infoBtn.className = 'btn btn-info';
                    infoBtn.innerHTML = `<i class="fas fa-list"></i> Temporadas`;
                    infoBtn.onclick = async () => {
                        ModalManager.closeAll();
                        const player = await getPlayerModule();
                        player.openSeriesPlayer(id, true);
                    };
                    detailsButtons.appendChild(infoBtn);
                }
            }

            if (auth.currentUser) {
                const inList = appState.user.watchlist.has(id);
                const listBtn = document.createElement('button');
                listBtn.className = `btn btn-watchlist ${inList ? 'in-list' : ''}`;
                listBtn.innerHTML = `<i class="fas ${inList ? 'fa-check' : 'fa-plus'}"></i>`;
                listBtn.dataset.contentId = id;
                
                listBtn.onclick = (e) => {
                    e.stopPropagation();
                    handleWatchlistClick(listBtn);
                };
                detailsButtons.appendChild(listBtn);
            }
            } 

            const reviewBtn = document.createElement('button');
            reviewBtn.className = 'btn btn-review btn-icon-only';
            reviewBtn.innerHTML = `<i class="fas fa-star"></i>`;
            reviewBtn.title = 'Reseñar'; 
            
            reviewBtn.onclick = async () => {
                if (!auth.currentUser) {
                    openConfirmationModal("Inicia Sesión", "Necesitas cuenta para reseñar.", () => openAuthModal(true));
                    return;
                }

                const reviews = await getReviewsModule();

                ModalManager.closeAll();

                setTimeout(() => {
                    reviews.openReviewModal(true, {
                        contentId: id,
                        contentTitle: data.title,
                        contentType: isSeries ? 'series' : 'movie'
                    });
                }, 100);
            };
            detailsButtons.appendChild(reviewBtn);

            if (!isSeries && auth.currentUser) {
                const roulette = await getRouletteModule();
                const isWatched = roulette.isMovieWatched ? roulette.isMovieWatched(id) : false;
                const eyeBtn = document.createElement('button');
                eyeBtn.className = `btn btn-icon-only btn-roulette-eye ${isWatched ? 'is-watched' : ''}`;
                eyeBtn.innerHTML = `<i class="fas ${isWatched ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
                eyeBtn.title = isWatched ? 'Quitar de vistas (volverá a la ruleta)' : 'Marcar como vista (no saldrá en la ruleta)';
                eyeBtn.onclick = async () => {
                    const nowWatched = eyeBtn.classList.contains('is-watched');
                    if (nowWatched) {
                        await roulette.unmarkMovieFromRoulette(id);
                        eyeBtn.classList.remove('is-watched');
                        eyeBtn.innerHTML = `<i class="fas fa-eye-slash"></i>`;
                        eyeBtn.title = 'Marcar como vista (no saldrá en la ruleta)';
                    } else {
                        await roulette.markMovieAsWatched(id);
                        eyeBtn.classList.add('is-watched');
                        eyeBtn.innerHTML = `<i class="fas fa-eye"></i>`;
                        eyeBtn.title = 'Quitar de vistas (volverá a la ruleta)';
                    }
                };
                detailsButtons.appendChild(eyeBtn);
            }

            const adminUser = auth.currentUser;
            if (adminUser && adminUser.email === 'baquezadat@gmail.com') {
                const logoContainer = document.getElementById('details-title')
                    ?.querySelector('.details-logo-container');
                if (logoContainer && !logoContainer.dataset.editorActive) {
                    initLogoEditor(id, logoContainer, getLogoSlot('modal'));
                }
            }
        } 

        const _showModal = () => {
            if (panel && _bannerUrl) {
                panel.style.backgroundImage = `url(${_bannerUrl})`;
            }
            modal.classList.add('show');
            document.body.classList.add('modal-open');
        };

        const bannerPromise = _bannerUrl
            ? new Promise(resolve => {
                const preload = new Image();
                const timeout = setTimeout(resolve, 1500); 
                preload.onload  = () => { clearTimeout(timeout); resolve(); };
                preload.onerror = () => { clearTimeout(timeout); resolve(); };
                preload.src = _bannerUrl;
            })
            : Promise.resolve();

        Promise.all([bannerPromise, logoSettingsPromise]).then(_showModal);

    } catch (e) {
        console.error("Error abriendo detalles:", e);
        if (window.logError) window.logError(e, 'Open Details');
    }
}

// ===========================================================
// 6. AUTENTICACIÓN Y DATOS DE USUARIO
// ===========================================================
function setupAuthListeners() {
    const setupPasswordToggle = (inputId, iconId) => {
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if (input && icon) {
            const newIcon = icon.cloneNode(true);
            icon.parentNode.replaceChild(newIcon, icon);
            
            newIcon.addEventListener('click', () => {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                newIcon.classList.toggle('fa-eye');
                newIcon.classList.toggle('fa-eye-slash');
            });
        }
    };
    setupPasswordToggle('login-password', 'toggle-login-pass');
    setupPasswordToggle('register-password', 'toggle-register-pass');

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const recoveryForm = document.getElementById('recovery-form');
    const authSwitch = document.querySelector('.auth-switch');

    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
        forgotLink.onclick = (e) => {
            e.preventDefault();
            loginForm.style.display = 'none';
            registerForm.style.display = 'none';
            recoveryForm.style.display = 'flex'; 
            recoveryForm.style.flexDirection = 'column';
            if (authSwitch) authSwitch.style.display = 'none';
        };
    }

    const backToLogin = document.getElementById('back-to-login-link');
    if (backToLogin) {
        backToLogin.onclick = (e) => {
            e.preventDefault();
            recoveryForm.style.display = 'none';
            loginForm.style.display = 'flex';
            if (authSwitch) authSwitch.style.display = 'block';
        };
    }

    if (DOM.loginBtnHeader) DOM.loginBtnHeader.onclick = (e) => { e.preventDefault(); openAuthModal(true); };
    if (DOM.registerBtnHeader) DOM.registerBtnHeader.onclick = (e) => { e.preventDefault(); openAuthModal(false); };
    
    if (DOM.switchAuthModeLink) {
        DOM.switchAuthModeLink.onclick = (e) => {
            e.preventDefault();
            const isLogin = loginForm.style.display !== 'none';
            openAuthModal(!isLogin);
        };
    }

    if (DOM.loginForm) {
    DOM.loginForm.onsubmit = (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        
        const errorEl = document.getElementById('login-error'); 
        
        auth.signInWithEmailAndPassword(email, pass)
            .then(() => { 
                ModalManager.closeAll(); 
                DOM.loginForm.reset(); 
            })
            .catch(() => { 
                errorEl.textContent = "Credenciales incorrectas."; 
                errorEl.style.display = 'block'; 
            });
        };
    }

    if (DOM.registerForm) {
        DOM.registerForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            const username = document.getElementById('register-username').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            
            const errorEl = document.getElementById('register-error');

            if (errorEl) {
                errorEl.style.display = 'none';
                errorEl.textContent = '';
            }

            auth.createUserWithEmailAndPassword(email, password)
                .then((userCredential) => userCredential.user.updateProfile({ displayName: username }))
                .then(() => { 
                    ModalManager.closeAll(); 
                    DOM.registerForm.reset(); 
                    ErrorHandler.show('auth', '¡Cuenta creada con éxito!', 3000);
                })
                .catch((err) => { 
                    if (errorEl) {
                        errorEl.textContent = err.message;
                        errorEl.style.display = 'block'; 
                    }
                });
        });
    }

    if (recoveryForm) {
        recoveryForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('recovery-email-input').value;
            const msgElement = document.getElementById('recovery-message');
            
            if(msgElement) {
                msgElement.style.display = 'none';
                msgElement.textContent = '';
            }
            
            auth.sendPasswordResetEmail(email)
                .then(() => {
                    if (msgElement) {
                        msgElement.style.color = '#4cd137'; 
                        msgElement.textContent = `Enlace enviado a ${email}`;
                        msgElement.style.display = 'block'; 
                    }
                })
                .catch((error) => {
                    if (msgElement) {
                        msgElement.style.color = '#ff4d4d'; 
                        if (error.code === 'auth/user-not-found') {
                            msgElement.textContent = "Correo no registrado.";
                        } else {
                            msgElement.textContent = "Error al enviar. Intenta nuevamente.";
                        }
                        msgElement.style.display = 'block'; 
                    }
                });
        });
    }

    auth.onAuthStateChanged(updateUIAfterAuthStateChange);
    
    const handleLogout = (e) => { e.preventDefault(); auth.signOut().then(() => location.reload()); };
    const btnLogout = document.getElementById('logout-btn');
    if (btnLogout) { btnLogout.parentNode.replaceChild(btnLogout.cloneNode(true), btnLogout).addEventListener('click', handleLogout); }
}

function openAuthModal(isLogin) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const recoveryForm = document.getElementById('recovery-form');
    const authSwitch = document.querySelector('.auth-switch');
    const switchLink = document.getElementById('switch-auth-mode');
    const modal = document.getElementById('auth-modal');

    if (recoveryForm) recoveryForm.style.display = 'none';
    if (authSwitch) authSwitch.style.display = 'block';

    if (loginForm) loginForm.style.display = isLogin ? 'flex' : 'none';
    if (registerForm) registerForm.style.display = isLogin ? 'none' : 'flex';

    if (switchLink) {
        switchLink.textContent = isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia Sesión';
    }

    ['login-error', 'register-error', 'recovery-message'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
    });
    
    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.classList.add('fa-eye');
        icon.classList.remove('fa-eye-slash');
    });

    if (modal) modal.classList.add('show');
    document.body.classList.add('modal-open');
}

window.openAuthModal = openAuthModal;

function updateUIAfterAuthStateChange(user) {
    const loggedInElements = [DOM.userProfileContainer, DOM.myListNavLink, DOM.historyNavLink, DOM.myListNavLinkMobile, DOM.historyNavLinkMobile];
    const loggedOutElements = [DOM.authButtons];

    const hubLoggedIn = document.getElementById('hub-logged-in-content');
    const hubGuest = document.getElementById('hub-guest-content');
    const hubEmail = document.getElementById('profile-hub-email');

    const resetNavigationActiveState = () => {
        document.querySelectorAll('.main-nav a, .bottom-nav .nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('a[data-filter="all"]').forEach(l => l.classList.add('active'));
    };

    if (user) {
        loggedInElements.forEach(el => el && (el.style.display = 'flex'));
        loggedOutElements.forEach(el => el && (el.style.display = 'none'));
        
        const userName = user.displayName || user.email.split('@')[0];
        if (DOM.userGreetingBtn) DOM.userGreetingBtn.textContent = `Hola, ${userName}`;
        
        if (hubLoggedIn) hubLoggedIn.style.display = 'block';
        if (hubGuest) hubGuest.style.display = 'none';
        if (hubEmail) hubEmail.textContent = user.email;

        db.ref(`users/${user.uid}/watchlist`).once('value', snapshot => {
            appState.user.watchlist = snapshot.exists() ? new Set(Object.keys(snapshot.val())) : new Set();
        });

        setupRealtimeHistoryListener(user);
        getProfileModule();


        const ADMIN_EMAIL_REPORTS = 'baquezadat@gmail.com';
        const reportsNavLink = document.getElementById('reports-nav-link');
        if (reportsNavLink) {
            if (user.email === ADMIN_EMAIL_REPORTS) {
                reportsNavLink.style.display = 'flex';
                firebase.database().ref('reports').orderByChild('status').equalTo('pending').on('value', snap => {
                    const badge = document.getElementById('reports-badge');
                    if (badge) {
                        const count = snap.numChildren();
                        if (count > 0) {
                            badge.textContent = count;
                            badge.style.display = 'inline-flex';
                        } else {
                            badge.style.display = 'none';
                        }
                    }
                });

            } else {
                reportsNavLink.style.display = 'none';
            }
        }

        resetNavigationActiveState(); 
        switchView('all'); 

    } else {
        loggedInElements.forEach(el => el && (el.style.display = 'none'));
        loggedOutElements.forEach(el => el && (el.style.display = 'flex'));

        const reportsNavLinkOut = document.getElementById('reports-nav-link');
        if (reportsNavLinkOut) reportsNavLinkOut.style.display = 'none';
        
        if (hubLoggedIn) hubLoggedIn.style.display = 'none';
        if (hubGuest) hubGuest.style.display = 'block';
        if (hubEmail) hubEmail.textContent = 'Visitante';
        
        appState.user.watchlist.clear();
        
        if (appState.user.historyListenerRef) {
            appState.user.historyListenerRef.off('value');
            appState.user.historyListenerRef = null;
        }
        
        const continueWatchingCarousel = document.getElementById('continue-watching-carousel');
        if (continueWatchingCarousel) continueWatchingCarousel.remove();

        resetNavigationActiveState(); 
        switchView('all');
    }
}

function addToHistoryIfLoggedIn(contentId, type, episodeInfo = {}) {
    const user = auth.currentUser;
    if (!user) return;

    let itemData = null;
    if (typeof findContentData === 'function') {
        itemData = findContentData(contentId);
    } 
    if (!itemData && appState.content.series[contentId]) {
        itemData = appState.content.series[contentId];
    }
    if (!itemData && appState.content.movies[contentId]) {
        itemData = appState.content.movies[contentId];
    }
    if (!itemData) return;

    let posterUrl = itemData.poster;
    const isSeries = type === 'series' || type === 'serie';

    if (isSeries && episodeInfo.season) {
        const seasonPosterEntry = appState.content.seasonPosters[contentId]?.[episodeInfo.season];
        if (seasonPosterEntry) {
            posterUrl = (typeof seasonPosterEntry === 'object') ? seasonPosterEntry.posterUrl : seasonPosterEntry;
        }
    }

    const historyKey = contentId; 

    const totalSeasonsForTitle = Object.keys(appState.content.seriesEpisodes[contentId] || {}).length;
    const historyTitle = isSeries
        ? (totalSeasonsForTitle > 1 ? `${itemData.title}: T${episodeInfo.season}` : itemData.title)
        : itemData.title;

    const historyEntry = {
        type: isSeries ? 'series' : 'movie',
        contentId: contentId,
        title: historyTitle,
        poster: posterUrl,
        viewedAt: firebase.database.ServerValue.TIMESTAMP, 
        season: isSeries ? episodeInfo.season : null,       
        lastEpisode: isSeries ? episodeInfo.index : null    
    };

    db.ref(`users/${user.uid}/history/${historyKey}`).set(historyEntry);
}

// ===========================================================
// FUNCIÓN PARA BORRAR DEL HISTORIAL (ANIMACIÓN SUAVE)
// ===========================================================
async function removeFromHistory(entryKey) {
    const user = auth.currentUser;
    if (!user) return;

    await Promise.all([
        db.ref(`users/${user.uid}/history/${entryKey}`).remove(),
        db.ref(`users/${user.uid}/roulette_watched/${entryKey}`).remove()
    ]);
    try {
        const roulette = await getRouletteModule();
        if (roulette.unmarkMovieFromRoulette) await roulette.unmarkMovieFromRoulette(entryKey);
    } catch(e) {}

    const historyGrid = DOM.historyContainer.querySelector('.grid');
    
    const btnPressed = historyGrid.querySelector(`.btn-remove-history[data-key="${entryKey}"]`);
    
    if (btnPressed) {
        const cardToRemove = btnPressed.closest('.movie-card');
        
        if (cardToRemove) {
            cardToRemove.style.pointerEvents = 'none';
            
            cardToRemove.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            cardToRemove.style.opacity = '0';
            cardToRemove.style.transform = 'scale(0.8) translateY(20px)';
            
            setTimeout(() => {
                if (cardToRemove.parentNode) cardToRemove.remove();
                
                if (historyGrid.children.length === 0) {
                    historyGrid.innerHTML = `<p class="empty-message" style="opacity:0; transition: opacity 0.5s;">Tu historial está vacío.</p>`;
                    requestAnimationFrame(() => {
                        const msg = historyGrid.querySelector('.empty-message');
                        if(msg) msg.style.opacity = '1';
                    });
                }
            }, 400); 
        }
    } else {
        renderHistory();
    }
}

function handleWatchlistClick(button) {
    const user = auth.currentUser;
    if (!user) {
        openConfirmationModal(
            "Acción Requerida",
            "Debes iniciar sesión para usar esta función.",
            () => openAuthModal(true)
        );
        return;
    }
    
    const contentId = button.dataset.contentId;
    const isInList = appState.user.watchlist.has(contentId);

    if (isInList) {
        openConfirmationModal(
            'Eliminar de Mi Lista',
            '¿Estás seguro de que quieres eliminar este item de tu lista?',
            () => removeFromWatchlist(contentId)
        );
    } else {
        addToWatchlist(contentId);
    }
}

async function addToWatchlist(contentId) {
    const user = auth.currentUser;
    if (!user) return;

    await ErrorHandler.firebaseOperation(async () => {
        await db.ref(`users/${user.uid}/watchlist/${contentId}`).set(true);
        appState.user.watchlist.add(contentId);
        
        document.querySelectorAll(`.btn-watchlist[data-content-id="${contentId}"]`).forEach(button => {
            button.classList.add('in-list');
            button.innerHTML = '<i class="fas fa-check"></i>';
        });
    });
}

async function removeFromWatchlist(contentId) {
    const user = auth.currentUser;
    if (!user) return;
    
    const safeId = String(contentId);

    await ErrorHandler.firebaseOperation(async () => {
        await db.ref(`users/${user.uid}/watchlist/${safeId}`).remove();
        appState.user.watchlist.delete(safeId);
        
        document.querySelectorAll(`.btn-watchlist[data-content-id="${safeId}"]`).forEach(button => {
            button.classList.remove('in-list');
            button.innerHTML = '<i class="fas fa-plus"></i>';
        });
        
        const myListContainer = document.getElementById('my-list-container');
        
        if (myListContainer && myListContainer.style.display !== 'none') {
            
            const cardToRemove = myListContainer.querySelector(`.movie-card[data-content-id="${safeId}"]`);
            
            if (cardToRemove) {
                cardToRemove.style.pointerEvents = 'none';
                
                cardToRemove.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                cardToRemove.style.opacity = '0';
                cardToRemove.style.transform = 'scale(0.8) translateY(20px)';
                
                setTimeout(() => {
                    if (cardToRemove.parentNode) {
                        cardToRemove.parentNode.removeChild(cardToRemove);
                    }
                    
                    if (appState.user.watchlist.size === 0) {
                        const grid = myListContainer.querySelector('.grid');
                        if (grid) {
                            grid.innerHTML = `<p class="empty-message" style="opacity:0; transition: opacity 0.5s;">Tu lista está vacía.</p>`;
                            requestAnimationFrame(() => {
                                const msg = grid.querySelector('.empty-message');
                                if(msg) msg.style.opacity = '1';
                            });
                        }
                    }
                }, 400); 
            } else {
                console.warn("Tarjeta no encontrada en el DOM, forzando repintado...");
                displayMyListView();
            }
        }
    });
}

// ===========================================================
// 📝 MI LISTA INTELIGENTE 
// ===========================================================
let myListDataCache = [];
let myListRenderedCount = 0;

function displayMyListView() {
    const user = auth.currentUser;
    const myListGrid = DOM.myListContainer.querySelector('.grid');
    
    const existingBtn = document.getElementById('mylist-load-more-btn');
    if (existingBtn) existingBtn.remove();
    
    if (!user) {
        myListGrid.innerHTML = `<p class="empty-message">Debes iniciar sesión para ver tu lista.</p>`;
        return;
    }
    
    if (!appState.user.watchlist || appState.user.watchlist.size === 0) {
        myListGrid.innerHTML = `<p class="empty-message">Tu lista está vacía. Agrega contenido para verlo aquí.</p>`;
        return;
    }
    
    myListGrid.innerHTML = `<div class="spinner" style="margin: 50px auto;"></div>`;

    let allContent = { 
        ...appState.content.movies, 
        ...appState.content.series 
    };
    
    if (appState.content.sagas) {
        Object.values(appState.content.sagas).forEach(sagaItems => {
            if (sagaItems) {
                Object.assign(allContent, sagaItems);
            }
        });
    }

    myListDataCache = [];
    
    const watchlistIDs = Array.from(appState.user.watchlist).reverse();

    watchlistIDs.forEach(contentId => {
        const data = allContent[contentId];
        if (data) {
            let type = 'movie';
            if (appState.content.series[contentId] || data.type === 'series' || appState.content.seriesEpisodes[contentId]) {
                type = 'series';
            }
            
            myListDataCache.push({ id: contentId, data: data, type: type });
        }
    });

    myListGrid.innerHTML = '';
    myListRenderedCount = 0;

    if (myListDataCache.length === 0) {
        myListGrid.innerHTML = `<p class="empty-message">No se encontraron datos (¿Quizás los items ya no existen?).</p>`;
        return;
    }

    appendMyListBatch();
}

function appendMyListBatch() {
    const myListGrid = DOM.myListContainer.querySelector('.grid');
    const BATCH_SIZE = UI.ITEMS_PER_LOAD || 24;
    
    const nextBatch = myListDataCache.slice(myListRenderedCount, myListRenderedCount + BATCH_SIZE);
    
    if (nextBatch.length === 0) return;

    const fragment = document.createDocumentFragment();

    nextBatch.forEach((item) => {
        const card = createMovieCardElement(item.id, item.data, item.type, 'grid', false, { source: 'my-list' });
        fragment.appendChild(card);
    });

    myListGrid.appendChild(fragment);
    myListRenderedCount += nextBatch.length;

    let loadBtn = document.getElementById('mylist-load-more-btn');
    
    if (myListRenderedCount < myListDataCache.length) {
        if (!loadBtn) {
            loadBtn = document.createElement('button');
            loadBtn.id = 'mylist-load-more-btn';
            loadBtn.className = 'btn btn-primary'; 
            loadBtn.innerHTML = 'Cargar más <i class="fas fa-chevron-down"></i>';
            loadBtn.style.cssText = "display: block; margin: 30px auto; min-width: 200px;";
            loadBtn.onclick = appendMyListBatch; 
            DOM.myListContainer.appendChild(loadBtn);
        } else {
            DOM.myListContainer.appendChild(loadBtn);
        }
    } else {
        if (loadBtn) loadBtn.remove();
    }
}

// ===========================================================
// 🧠 HISTORIAL INTELIGENTE 
// ===========================================================
let historyDataCache = [];
let historyRenderedCount = 0;

function renderHistory() {
    const user = auth.currentUser;
    const historyGrid = DOM.historyContainer.querySelector('.grid');
    
    const existingBtn = document.getElementById('history-load-more-btn');
    if (existingBtn) existingBtn.remove();
    
    if (!user) {
        historyGrid.innerHTML = `<p class="empty-message">Debes iniciar sesión para ver tu historial.</p>`;
        return;
    }
    
    historyGrid.innerHTML = `<div class="spinner" style="margin: 50px auto;"></div>`;

    db.ref(`users/${user.uid}/history`).orderByChild('viewedAt').once('value', snapshot => {
        if (!snapshot.exists()) {
            historyGrid.innerHTML = `<p class="empty-message">Tu historial está vacío.</p>`;
            return;
        }

        historyDataCache = [];
        snapshot.forEach(child => {
            const item = child.val();
            item.key = child.key; 
            historyDataCache.push(item);
        });
        
        historyDataCache.reverse(); 
        
        historyGrid.innerHTML = '';
        historyRenderedCount = 0;

        appendHistoryBatch();
    });
}

function appendHistoryBatch() {
    const historyGrid = DOM.historyContainer.querySelector('.grid');
    const BATCH_SIZE = 24; 
    
    const nextBatch = historyDataCache.slice(historyRenderedCount, historyRenderedCount + BATCH_SIZE);
    
    if (nextBatch.length === 0) return;

    const fragment = document.createDocumentFragment();

    nextBatch.forEach((item) => {
        const options = {
            source: 'history',
            season: item.season
        };
        const card = createMovieCardElement(item.contentId, item, item.type, 'grid', false, options);
        
        const removeButton = document.createElement('button');
        removeButton.className = 'btn-remove-history';
        removeButton.dataset.key = item.key;
        removeButton.innerHTML = `<i class="fas fa-times"></i>`;
        card.appendChild(removeButton);

        const infoOverlay = document.createElement('div');
        infoOverlay.className = 'history-item-overlay';
        const dateStr = item.viewedAt ? new Date(item.viewedAt).toLocaleDateString() : 'Reciente';
        infoOverlay.innerHTML = `<h4 class="history-item-title">${item.title}</h4><p class="history-item-date">Visto: ${dateStr}</p>`;
        card.appendChild(infoOverlay);

        fragment.appendChild(card);
    });

    historyGrid.appendChild(fragment);
    historyRenderedCount += nextBatch.length;

    let loadBtn = document.getElementById('history-load-more-btn');
    
    if (historyRenderedCount < historyDataCache.length) {
        if (!loadBtn) {
            loadBtn = document.createElement('button');
            loadBtn.id = 'history-load-more-btn';
            loadBtn.className = 'btn btn-primary'; 
            loadBtn.innerHTML = 'Cargar más <i class="fas fa-chevron-down"></i>';
            loadBtn.style.cssText = "display: block; margin: 30px auto; min-width: 200px;";
            loadBtn.onclick = appendHistoryBatch; 
            DOM.historyContainer.appendChild(loadBtn);
        } else {
            DOM.historyContainer.appendChild(loadBtn);
        }
    } else {
        if (loadBtn) loadBtn.remove();
    }
}

function setupRealtimeHistoryListener(user) {
    if (appState.user.historyListenerRef) {
        appState.user.historyListenerRef.off('value');
    }

    if (user) {
        appState.user.historyListenerRef = db.ref(`users/${user.uid}/history`).orderByChild('viewedAt');
        
        appState.user.historyListenerRef.on('value', (snapshot) => {
            console.log('🔔 Historial actualizado - Regenerando carrusel...');
            clearTimeout(appState.player.historyUpdateDebounceTimer);

            appState.player.historyUpdateDebounceTimer = setTimeout(() => {
                console.log('📺 Items en historial:', snapshot.numChildren());
                generateContinueWatchingCarousel(snapshot);
                if (DOM.historyContainer && DOM.historyContainer.style.display === 'block') {
                    renderHistory();
                }
            }, 250);
        });
    }
}

// ===========================================================
// 7. MODAL DE CONFIRMACIÓN
// ===========================================================
document.addEventListener('DOMContentLoaded', () => {
    if (DOM.confirmDeleteBtn && DOM.cancelDeleteBtn && DOM.confirmationModal) {
        DOM.confirmDeleteBtn.addEventListener('click', () => {
            if (typeof DOM.confirmationModal.onConfirm === 'function') {
                DOM.confirmationModal.onConfirm();
                hideConfirmationModal();
            }
        });

        DOM.cancelDeleteBtn.addEventListener('click', () => hideConfirmationModal());
    }
});

function hideConfirmationModal() {
    DOM.confirmationModal.classList.remove('show');
    DOM.confirmationModal.onConfirm = null;
    document.getElementById('confirm-delete-btn').textContent = "Confirmar";
    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }
}

function openConfirmationModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmation-modal');
    if (!modal) return;

    const titleEl = modal.querySelector('h2');
    const messageEl = modal.querySelector('p');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    DOM.confirmationModal.onConfirm = onConfirm;

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function getLatestSeriesDate(seriesId) {
    const allEpisodes = appState.content.seriesEpisodes[seriesId];
    if (!allEpisodes) return 0;

    let flatEpisodes = [];
    if (Array.isArray(allEpisodes)) {
        flatEpisodes = allEpisodes;
    } else {
        flatEpisodes = Object.values(allEpisodes).flat();
    }

    let maxDate = 0;
    const now = new Date();
    const DAYS_THRESHOLD = 5; 

    flatEpisodes.forEach(ep => {
        if (!ep.releaseDate) return;
        const rDate = new Date(ep.releaseDate);
        if (isNaN(rDate.getTime())) return;

        const diffTime = now - rDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= DAYS_THRESHOLD && diffDays >= 0 && rDate.getTime() > maxDate) {
            maxDate = rDate.getTime();
        }
    });

    return maxDate;
}

function isDateRecent(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return false; 
    
    const now = new Date();
    const diffTime = now - date;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays <= 5 && diffDays >= 0; 
}

function hasRecentSeasonFromPosters(seriesId) {
    const posters = appState.content.seasonPosters[seriesId];
    if (!posters) return false;

    return Object.values(posters).some(seasonData => {
        const date = (typeof seasonData === 'object') ? seasonData.date_added : null;
        return isDateRecent(date);
    });
}

function hasRecentEpisodes(seriesId) {
    const allEpisodes = appState.content.seriesEpisodes[seriesId];
    if (!allEpisodes) return false;

    let flatEpisodes = [];
    if (Array.isArray(allEpisodes)) {
        flatEpisodes = allEpisodes;
    } else {
        flatEpisodes = Object.values(allEpisodes).flat();
    }

    return flatEpisodes.some(ep => isDateRecent(ep.releaseDate));
}

// -----------------------------------------------------------
// 2. FUNCIÓN DE CREACIÓN DE TARJETAS (ACTUALIZADA)
// -----------------------------------------------------------
function createMovieCardElement(id, data, type, layout = 'carousel', lazy = false, options = {}) {
    const card = document.createElement('div');
    card.className = `movie-card ${layout === 'carousel' ? 'carousel-card' : ''}`;
    card.dataset.contentId = id;

    let badgesAccumulator = ''; 
    const isNewContent = isDateRecent(data.date_added);

    if (options.source !== 'continuar-viendo') {
        if (type === 'series') {
            const hasNewSeason = hasRecentSeasonFromPosters(id); 
            const hasNewEp = hasRecentEpisodes(id);              
            
            if (isNewContent) badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
            if (hasNewSeason) badgesAccumulator += `<div class="new-episode-badge badge-season">NUEVA TEMP</div>`;
            
            if (hasNewEp && !hasNewSeason) badgesAccumulator += `<div class="new-episode-badge badge-episode">NUEVO CAP</div>`;
        } else {
            if (data.estado && data.estado.toLowerCase() === 'vetada') {
                badgesAccumulator += `<div class="new-episode-badge badge-vetada">VETADA</div>`;
            }
            else if (data.estado && data.estado.toLowerCase() === 'mantenimiento') {
                badgesAccumulator += `<div class="new-episode-badge badge-mantenimiento">MANT.</div>`;
            }
            else if (data.estado && data.estado.trim() !== '') {
                badgesAccumulator += `<div class="new-episode-badge badge-proximamente">PRÓXIMO</div>`;
            }
            else if (isNewContent) {
                badgesAccumulator += `<div class="new-episode-badge badge-estreno">ESTRENO</div>`;
            }
        }
    }

    let ribbonHTML = badgesAccumulator !== '' ? `<div class="badges-container">${badgesAccumulator}</div>` : '';

    card.onclick = (e) => {
        if (e.target.closest('.btn-watchlist') || e.target.closest('.btn-remove-history') || e.target.closest('.btn-remove-continue-watching')) return;
        
        const seasonMatch = data.title.match(/\(T(\d+)\)$/);
        if (seasonMatch) {
            (async () => { const player = await getPlayerModule(); player.openSeriesPlayerDirectlyToSeason(id, seasonMatch[1]); })();
        } else if (options.source === 'continuar-viendo' && type === 'series' && options.season != null && options.lastEpisode != null) {
            (async () => { const player = await getPlayerModule(); player.openPlayerToEpisode(id, options.season, options.lastEpisode); })();
        } else if (options.source === 'history' && type === 'series' && options.season) {
            (async () => { const player = await getPlayerModule(); player.openSeriesPlayerDirectlyToSeason(id, options.season); })();
        } else {
            openDetailsModal(id, type);
        }
    };
    
    let watchlistBtnHTML = '';
    
    if (options.source === 'continuar-viendo' && options.historyKey) {
        watchlistBtnHTML = `<button class="btn-remove-continue-watching" data-history-key="${options.historyKey}"><i class="fas fa-times"></i></button>`;
    } else if(auth.currentUser && options.source !== 'history'){
        const isInList = appState.user.watchlist.has(id);
        
        let iconClass = isInList ? 'fa-check' : 'fa-plus';
        if (options.source === 'my-list') iconClass = 'fa-times'; 

        const inListClass = isInList ? 'in-list' : '';
        
        watchlistBtnHTML = `<button class="btn-watchlist ${inListClass}" data-content-id="${id}"><i class="fas ${iconClass}"></i></button>`;
    }

    let imageUrl = data.poster;
    
    if (options.source === 'continuar-viendo' && options.episodeThumbnail) {
        imageUrl = options.episodeThumbnail;
    }
    
    if (typeof imageUrl === 'object' && imageUrl?.posterUrl) imageUrl = imageUrl.posterUrl;
    if (!imageUrl) imageUrl = data.banner || '';

    const img = new Image();
    img.onload = () => {
        const placeholder = card.querySelector('.img-container-placeholder');
        if(placeholder) placeholder.replaceWith(img);
        card.classList.add('img-loaded');
        
        const isVetada = type === 'movie' && data.estado && data.estado.toLowerCase() === 'vetada';
        if (isVetada) {
            img.style.filter = 'grayscale(100%)';
        }
    };
    img.src = imageUrl; 
    img.alt = data.title;

    const ratingHTML = reviewsModule && reviewsModule.getStarsHTML
        ? `<div class="card-rating-container">${reviewsModule.getStarsHTML(appState.content.averages[id], true)}</div>`
        : '<div class="card-rating-container"></div>';

    card.innerHTML = `${ribbonHTML}<div class="img-container-placeholder"></div>${ratingHTML}${watchlistBtnHTML}`;

    if (options.source === 'continuar-viendo' && (options.episodeTitle || options.seriesTitle)) {
        const overlay = document.createElement('div');
        overlay.className = 'continue-watching-overlay';
        
        let episodeInfo = '';
        if (options.season != null && options.lastEpisode != null) {
            const episodeNum = parseInt(options.lastEpisode) + 1; 
            episodeInfo = (options.totalSeasons > 1)
                ? `T${options.season} E${episodeNum}`
                : `Episodio ${episodeNum}`;
        }
        
        overlay.innerHTML = `
            <div class="cw-overlay-content">
                <p class="cw-series-title">${options.seriesTitle || data.title}</p>
                <p class="cw-episode-number">${episodeInfo}</p>
                ${options.episodeTitle ? `<p class="cw-episode-title">${options.episodeTitle}</p>` : ''}
            </div>
        `;
        card.appendChild(overlay);
    }

    const watchBtn = card.querySelector('.btn-watchlist');
    if (watchBtn) {
        watchBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation(); 
            handleWatchlistClick(watchBtn);
        };
    }
    
    const removeBtn = card.querySelector('.btn-remove-continue-watching');
    if (removeBtn) {
        removeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const seriesTitle = options.seriesTitle || data.title;
            openConfirmationModal(
                'Eliminar de Continuar Viendo',
                `¿Estás seguro de que quieres eliminar "${seriesTitle}" de tu historial?`,
                () => removeFromContinueWatching(removeBtn.dataset.historyKey, card)
            );
        };
    }

    return card;
}

async function removeFromContinueWatching(historyKey, cardElement) {
    const user = auth.currentUser;
    if (!user || !historyKey) return;
    
    try {
        cardElement.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'scale(0.8) translateY(20px)';
        
        await db.ref(`users/${user.uid}/history/${historyKey}`).remove();
        
        setTimeout(() => {
            if (cardElement.parentNode) {
                cardElement.remove();
            }
            
            const carousel = document.getElementById('continue-watching-carousel');
            if (carousel) {
                const track = carousel.querySelector('.carousel-track');
                if (track && track.children.length === 0) {
                    carousel.remove();
                }
            }
        }, 400);
        
        console.log('✅ Removido de Continuar Viendo:', historyKey);
    } catch (error) {
        console.error('❌ Error al remover de Continuar Viendo:', error);
    }
}

function getLatestUpdateTimestamp(id, data, type) {
    let maxTimestamp = 0;

    if (data.date_added) {
        const d = new Date(data.date_added); 
        if (!isNaN(d.getTime()) && isDateRecent(data.date_added)) {
            maxTimestamp = Math.max(maxTimestamp, d.getTime());
        }
    }

    if (type === 'movie') return maxTimestamp;

    const posters = appState.content.seasonPosters[id];
    if (posters) {
        Object.values(posters).forEach(p => {
            if (typeof p === 'object' && p.date_added) {
                const d = new Date(p.date_added);
                if (!isNaN(d.getTime()) && isDateRecent(p.date_added)) {
                    maxTimestamp = Math.max(maxTimestamp, d.getTime());
                }
            }
        });
    }

    const allEpisodes = appState.content.seriesEpisodes[id];
    if (allEpisodes) {
        const flatEpisodes = Array.isArray(allEpisodes) ? allEpisodes : Object.values(allEpisodes).flat();
        flatEpisodes.forEach(ep => {
            if (ep.releaseDate) {
                const d = new Date(ep.releaseDate);
                if (!isNaN(d.getTime()) && isDateRecent(ep.releaseDate)) {
                    maxTimestamp = Math.max(maxTimestamp, d.getTime());
                }
            }
        });
    }

    return maxTimestamp;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// ===========================================================
// 10. 🎯 EXPORTAR PARA USO GLOBAL 
// ===========================================================
window.ErrorHandler = ErrorHandler;
window.cacheManager = cacheManager;
window.lazyLoader = lazyLoader;
window.showCacheStats = () => {
    const stats = {
        itemCount: localStorage.length,
        version: cacheManager.version,
        contentCached: !!cacheManager.get(cacheManager.keys.content),
        metadataCached: !!cacheManager.get(cacheManager.keys.metadata)
    };
    console.table(stats);
    return stats;
};

function setupPageVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(appState.ui.heroInterval);
            document.body.classList.add('tab-inactive');
            
        } else {
            document.body.classList.remove('tab-inactive');
            
            setTimeout(() => {
                startHeroInterval();
                
                if (DOM.heroSection) {
                    DOM.heroSection.style.transform = 'translateZ(0)'; 
                }
            }, 1000); 
        }
    });
}

window.closeAllModals = closeAllModals;


function setupRatingsListener() {
    console.log('ℹ️ setupRatingsListener: Ya configurado en el módulo de reviews');
}

function getStarsHTML(rating, isSmall = true) {
    if (reviewsModule && reviewsModule.getStarsHTML) {
        return reviewsModule.getStarsHTML(rating, isSmall);
    }
    if (!rating || rating === "0.0" || rating === 0) return '';
    return `
        <div class="star-rating-display ${isSmall ? 'small' : 'large'}" 
             title="${rating} de 5 estrellas">
            <i class="fas fa-star"></i>
            <span class="rating-number">${rating}</span>
        </div>
    `;
}

function updateVisibleRatings() {
    document.querySelectorAll('.movie-card').forEach(card => {
        const contentId = card.dataset.contentId;
        const ratingContainer = card.querySelector('.card-rating-container');
        
        if (ratingContainer && contentId && appState.content.averages) {
            const rating = appState.content.averages[contentId];
            ratingContainer.innerHTML = getStarsHTML(rating, true);
        }
    });
}

window.showNotification = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    const color = type === 'success' ? '#2ecc71' : '#e74c3c';

    toast.innerHTML = `
        <i class="fas ${icon} toast-icon" style="color: ${color}"></i>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOutToast 0.5s ease forwards';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
};

window.openSmartReviewModal = async (contentId, type, title) => {
    if (!firebase.auth().currentUser) {
        if (window.openConfirmationModal) {
            window.openConfirmationModal(
                "Inicia Sesión", 
                "Necesitas una cuenta para escribir reseñas.", 
                () => window.openAuthModal(true)
            );
        }
        return;
    }

    const module = await import('./features/reviews.js?v=8');
    
    module.initReviews({ appState, DOM, auth, db, ErrorHandler: window.ErrorHandler, ModalManager: window.ModalManager }); 
    
    setTimeout(() => {
        module.openReviewModal(true, {
            contentId: contentId,
            contentTitle: title,
            contentType: type
        });
    }, 50);
};

// ===========================================================
// 🚪 LOGOUT 
// ===========================================================

function mostrarModalLogout() {
    console.log('🚀 Mostrando modal de logout');
    
    const confirmModal = document.getElementById('confirmation-modal');
    if (!confirmModal) {
        console.error('❌ Modal no encontrado');
        if (confirm('¿Cerrar sesión?')) {
            ejecutarLogout();
        }
        return;
    }

    const confirmTitle = confirmModal.querySelector('h2');
    const confirmText = confirmModal.querySelector('p');
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    const modalContent = confirmModal.querySelector('.confirmation-modal-content');

    if (confirmTitle) confirmTitle.textContent = '¿Cerrar sesión?';
    if (confirmText) confirmText.textContent = 'Se cerrará tu sesión y volverás al modo invitado.';
    if (confirmBtn) confirmBtn.textContent = 'Cerrar Sesión';
    
    if (modalContent) {
        modalContent.onclick = (e) => {
            e.stopPropagation();
        };
    }
    
    confirmModal.style.display = 'flex';
    confirmModal.style.zIndex = '99999';
    confirmModal.style.pointerEvents = 'auto';
    
    setTimeout(() => {
        document.body.classList.add('modal-open');
        confirmModal.classList.add('show');
    }, 10);

    if (confirmBtn) {
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        let confirmExecuted = false;
        
        const executeConfirm = (e) => {
            if (confirmExecuted) return;
            confirmExecuted = true;
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log('✅ Logout confirmado - EJECUTANDO');
            cerrarModal(confirmModal);
            ejecutarLogout();
        };
        
        newConfirmBtn.addEventListener('touchstart', executeConfirm, { passive: false });
        newConfirmBtn.addEventListener('click', executeConfirm, true);
        newConfirmBtn.onclick = executeConfirm;
    }

    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        let cancelExecuted = false;
        
        const executeCancel = (e) => {
            if (cancelExecuted) return;
            cancelExecuted = true;
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log('❌ Logout cancelado - EJECUTANDO');
            cerrarModal(confirmModal);
        };
        
        newCancelBtn.addEventListener('touchstart', executeCancel, { passive: false });
        newCancelBtn.addEventListener('click', executeCancel, true);
        newCancelBtn.onclick = executeCancel;
    }
    
    confirmModal.onclick = (e) => {
        if (e.target === confirmModal) {
            console.log('🖱️ Click en fondo - cerrando');
            cerrarModal(confirmModal);
        }
    };
}

function cerrarModal(confirmModal) {
    if (!confirmModal) return;
    
    confirmModal.classList.remove('show');
    document.body.classList.remove('modal-open');
    
    setTimeout(() => {
        confirmModal.style.display = 'none';
        confirmModal.style.pointerEvents = 'none';
    }, 300);
}

function ejecutarLogout() {
    console.log('🔓 Ejecutando logout');
    
    if (typeof auth === 'undefined' || !auth) {
        console.warn('⚠️ Auth no disponible, limpiando solo localStorage');
        localStorage.removeItem('cineCornetoUser');
        window.location.reload();
        return;
    }
    
    auth.signOut().then(() => {
        console.log('✅ Sesión cerrada en Firebase');
        localStorage.removeItem('cineCornetoUser');
        
        if (typeof appState !== 'undefined') {
            appState.user = {
                watchlist: new Set(),
                historyListenerRef: null
            };
            
            if (appState.user.historyListenerRef) {
                appState.user.historyListenerRef.off();
                appState.user.historyListenerRef = null;
            }
        }
        
        const profileHubEmail = document.getElementById('profile-hub-email');
        if (profileHubEmail) profileHubEmail.textContent = 'Visitante';
        
        const hubLoggedIn = document.getElementById('hub-logged-in-content');
        const hubGuest = document.getElementById('hub-guest-content');
        if (hubLoggedIn) hubLoggedIn.style.display = 'none';
        if (hubGuest) hubGuest.style.display = 'block';
        
        setTimeout(() => window.location.reload(), 500);
        
    }).catch((error) => {
        console.error('❌ Error:', error);
        localStorage.removeItem('cineCornetoUser');
        window.location.reload();
    });
}

document.addEventListener('click', function(e) {
    const target = e.target;
    
    const logoutBtn = target.closest('#logout-btn') || 
                      target.closest('#logout-btn-hub') || 
                      target.closest('#mobile-logout-btn') ||
                      target.closest('.logout-action') ||
                      target.closest('a[href="#"][id*="logout"]') ||
                      target.closest('.profile-hub-menu-item.logout');
    
    if (logoutBtn) {
        e.preventDefault();
        e.stopPropagation();
        mostrarModalLogout();
        return;
    }
    
}, true);

function attachDirectListeners() {
    const ids = ['logout-btn', 'logout-btn-hub', 'mobile-logout-btn'];
    
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.removeEventListener('click', handleLogoutClick);
            btn.addEventListener('click', handleLogoutClick, true);
            
            btn.removeEventListener('touchstart', handleLogoutClick);
            btn.addEventListener('touchstart', handleLogoutClick, { passive: false });
        }
    });
    
    const logoutLinks = document.querySelectorAll('.profile-hub-menu-item.logout');
    logoutLinks.forEach(link => {
        link.removeEventListener('click', handleLogoutClick);
        link.addEventListener('click', handleLogoutClick, true);
        
        link.removeEventListener('touchstart', handleLogoutClick);
        link.addEventListener('touchstart', handleLogoutClick, { passive: false });
    });
}

function handleLogoutClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    mostrarModalLogout();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachDirectListeners);
} else {
    attachDirectListeners();
}

setTimeout(attachDirectListeners, 1000);

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
                if (node.id === 'logout-btn-hub' || 
                    node.id === 'logout-btn' || 
                    node.classList?.contains('logout')) {
                    attachDirectListeners();
                }
                const logoutBtns = node.querySelectorAll?.('#logout-btn, #logout-btn-hub, .logout');
                if (logoutBtns?.length > 0) {
                    attachDirectListeners();
                }
            }
        });
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// ===========================================================
// LOGO SETTINGS 
// ===========================================================
window._heroEditPaused = false;

function getLogoSlot(base) {
    const device = window.innerWidth <= 768 ? 'mobile' : 'desktop';
    return base + '-' + device;
}

function loadLogoSettings(id, container, callback, slot = 'modal-desktop') {
    const slotRef  = db.ref('logoSettings/' + id + '/' + slot);
    const legacyRef = db.ref('logoSettings/' + id);

    slotRef.once('value').then(snap => {
        const s = snap.val();
        if (s && (s.x !== undefined || s.scale !== undefined)) {
            applyLogoTransform(container, s);
            if (callback) callback();
        } else {
            legacyRef.once('value').then(legacySnap => {
                const legacy = legacySnap.val();
                if (legacy && legacy.x !== undefined) {
                    const slots = ['hero-desktop', 'hero-mobile', 'modal-desktop', 'modal-mobile'];
                    const updates = {};
                    slots.forEach(k => { updates[k] = legacy; });
                    db.ref('logoSettings/' + id).update(updates).catch(() => {});
                    applyLogoTransform(container, legacy);
                }
                if (callback) callback();
            }).catch(() => { if (callback) callback(); });
        }
    }).catch(() => { if (callback) callback(); });
}

function applyLogoTransform(container, s) {
    const { x = 0, y = 0, scale = 1, zIndex = 0 } = s;
    const img = container.querySelector('.details-logo-img, .hero-logo-img');
    if (img) {
        img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        img.style.transformOrigin = 'left bottom';
    }
    container.style.position = 'relative';
    container.style.zIndex = zIndex !== 0 ? zIndex : '';
}

function initLogoEditor(id, container, slot = 'modal') {
    if (container.dataset.editorActive) return;
    container.dataset.editorActive = 'true';

    let state = { x: 0, y: 0, scale: 1, zIndex: 0 };
    const img = container.querySelector('.details-logo-img, .hero-logo-img');

    const readState = () => {
        try {
            const t = img.style.transform || '';
            const tMatch = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
            const sMatch = t.match(/scale\(([^)]+)\)/);
            if (tMatch) { state.x = parseFloat(tMatch[1]); state.y = parseFloat(tMatch[2]); }
            if (sMatch) state.scale = parseFloat(sMatch[1]);
            state.zIndex = parseInt(container.style.zIndex) || 0;
        } catch(e) {}
    };
    readState();

    const editToggle = document.createElement('button');
    editToggle.className = 'logo-edit-toggle';
    editToggle.title = 'Editar logo';
    editToggle.innerHTML = '<i class="fas fa-pen"></i>';

    const heroButtons = document.querySelector('.hero-buttons');
    const detailsButtonsRow = document.getElementById('details-buttons');
    if (slot && slot.includes('hero') && heroButtons) {
        heroButtons.appendChild(editToggle);
    } else if (detailsButtonsRow) {
        detailsButtonsRow.appendChild(editToggle);
    } else {
        container.appendChild(editToggle);
    }

    const panel = document.createElement('div');
    panel.className = 'logo-editor-panel';
    panel.innerHTML = `
        <div class="lep-header">
            <span class="lep-slot-label">${slot.includes('hero') ? '🖼' : '🎬'} ${slot.includes('hero') ? 'Hero' : 'Modal'} · ${slot.includes('mobile') ? '📱 Móvil' : '🖥 PC'}</span>
            <button class="lep-close-btn" title="Cerrar editor">✕</button>
        </div>
        <div class="lep-grid">
            <span class="lep-label">Escala</span>
            <button class="lep-btn" data-action="scale-down">−</button>
            <span class="lep-value" id="lep-scale">${state.scale.toFixed(2)}</span>
            <button class="lep-btn" data-action="scale-up">+</button>

            <span class="lep-label">X</span>
            <button class="lep-btn" data-action="x-left">←</button>
            <span class="lep-value" id="lep-x">${Math.round(state.x)}</span>
            <button class="lep-btn" data-action="x-right">→</button>

            <span class="lep-label">Y</span>
            <button class="lep-btn" data-action="y-up">↑</button>
            <span class="lep-value" id="lep-y">${Math.round(state.y)}</span>
            <button class="lep-btn" data-action="y-down">↓</button>

            <span class="lep-label">Capa</span>
            <button class="lep-btn" data-action="z-down">−</button>
            <span class="lep-value" id="lep-z">${state.zIndex}</span>
            <button class="lep-btn" data-action="z-up">+</button>
        </div>
        <div class="lep-actions">
            <button class="lep-reset-btn">↺ Reset</button>
            <button class="lep-save-btn">Guardar</button>
        </div>
    `;
    document.body.appendChild(panel);

    const updateDisplay = () => {
        panel.querySelector('#lep-scale').textContent = state.scale.toFixed(2);
        panel.querySelector('#lep-x').textContent = Math.round(state.x);
        panel.querySelector('#lep-z').textContent = state.zIndex;
        panel.querySelector('#lep-y').textContent = Math.round(state.y);
        applyLogoTransform(container, state);
    };

    let editMode = false;
    editToggle.addEventListener('click', e => {
        e.stopPropagation();
        editMode = !editMode;
        readState();
        panel.classList.toggle('lep-visible', editMode);
        img.classList.toggle('logo-editing', editMode);
        editToggle.classList.toggle('lep-active', editMode);
        editToggle.innerHTML = editMode ? '✕' : '<i class="fas fa-pen"></i>';
        updateDisplay();

        if (slot.includes('hero')) {
            window._heroEditPaused = editMode;
            if (!editMode) {
                clearInterval(appState.ui.heroInterval);
                appState.ui.heroInterval = setInterval(() => {
                    if (window._heroEditPaused) return;
                    const items = appState.ui.heroItems;
                    if (!items || items.length === 0) return;
                    appState.ui.currentHeroIndex = ((appState.ui.currentHeroIndex || 0) + 1) % items.length;
                    changeHeroMovie(items[appState.ui.currentHeroIndex]);
                }, 8000);
            }
        }
    });

    const STEP = 5;
    panel.addEventListener('click', e => {
        e.stopPropagation();
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        if (action === 'scale-up')   state.scale = Math.min(4, +(state.scale + 0.05).toFixed(2));
        if (action === 'scale-down') state.scale = Math.max(0.1, +(state.scale - 0.05).toFixed(2));
        if (action === 'x-right') state.x += STEP;
        if (action === 'x-left')  state.x -= STEP;
        if (action === 'y-down')  state.y += STEP;
        if (action === 'y-up')    state.y -= STEP;
        if (action === 'z-up')    state.zIndex = Math.min(5, state.zIndex + 1);
        if (action === 'z-down')  state.zIndex = Math.max(-5, state.zIndex - 1);
        updateDisplay();
    });

    let isDragging = false, dragSX, dragSY, dragOX, dragOY;
    img.addEventListener('mousedown', e => {
        if (!editMode) return;
        isDragging = true;
        dragSX = e.clientX; dragSY = e.clientY;
        dragOX = state.x;   dragOY = state.y;
        img.style.cursor = 'grabbing';
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        state.x = dragOX + (e.clientX - dragSX);
        state.y = dragOY + (e.clientY - dragSY);
        updateDisplay();
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) { isDragging = false; img.style.cursor = editMode ? 'grab' : ''; }
    });

    panel.querySelector('.lep-reset-btn').addEventListener('click', e => {
        e.stopPropagation();
        state = { x: 0, y: 0, scale: 1, zIndex: 0 };
        updateDisplay();
    });

    panel.querySelector('.lep-close-btn').addEventListener('click', e => {
        e.stopPropagation();
        editToggle.click();
    });

    const saveBtn = panel.querySelector('.lep-save-btn');
    saveBtn.addEventListener('click', e => {
        e.stopPropagation();
        saveBtn.disabled = true;
        saveBtn.textContent = '...';
        db.ref('logoSettings/' + id + '/' + slot).set(state).then(() => {
            saveBtn.textContent = '✓ Guardado';
            saveBtn.classList.add('lep-saved');
            setTimeout(() => {
                saveBtn.textContent = 'Guardar';
                saveBtn.classList.remove('lep-saved');
                saveBtn.disabled = false;
            }, 2000);
        }).catch(() => {
            saveBtn.textContent = 'Error';
            saveBtn.disabled = false;
        });
    });

    const cleanup = () => {
        editToggle.remove();
        panel.remove();
        container.style.zIndex = '';
        container.style.position = '';
        window._heroEditPaused = false;
        delete container.dataset.editorActive;
    };

    const modalEl = container.closest('.modal');
    if (modalEl) {
        const modalObserver = new MutationObserver(() => {
            if (!modalEl.classList.contains('show')) {
                cleanup();
                modalObserver.disconnect();
            }
        });
        modalObserver.observe(modalEl, { attributes: true, attributeFilter: ['class'] });
    } else {
        const heroObserver = new MutationObserver(() => {
            if (!document.body.contains(container) || !container.querySelector('.hero-logo-img')) {
                cleanup();
                heroObserver.disconnect();
            }
        });
        heroObserver.observe(document.body, { childList: true, subtree: true });
    }
}

function renderSagasHub() {
    const container = document.getElementById('sagas-grid-dynamic');
    if (!container) return;
    const sagas = Object.values(appState.content.sagasList || {});
    sagas.sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
    container.innerHTML = '';
    sagas.forEach(saga => {
        const card = document.createElement('div');
        card.className = 'saga-card';
        card.style.setProperty('--hover-color', saga.color || '#fff');
        if (saga.banner) card.style.backgroundImage = `url('${saga.banner}')`;
        card.onclick = () => switchView(saga.id);
        card.innerHTML = `<img src="${saga.logo}" alt="${saga.title}" class="saga-logo">`;
        container.appendChild(card);
    });
}

export function findContentData(id) {
    // 🔥 Usamos el nuevo gestor de contenido centralizado!
    return ContentManager.findById(id, appState);
}

window.adminForceUpdate = () => { safeClearStorage(); location.reload(); };

window.adminLocalRefresh = async () => {
    const btn = document.getElementById('admin-local-refresh-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }
    try {
        const [series, episodes, allMovies, posters, sagasListData] = await Promise.all([
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=series`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=episodes`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=allMovies&order=desc`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=PostersTemporadas`),
            ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=sagas_list`)
        ]);

        const sagasArray = Object.values(sagasListData || {});
        const sagasResults = await Promise.all(
            sagasArray.map(saga =>
                ErrorHandler.fetchOperation(`${API_URL.BASE_URL}?data=${saga.id}`)
                .then(data => ({ id: saga.id, data }))
            )
        );

        const freshContent = { allMovies, series, episodes, posters, sagas_list: sagasListData };
        sagasResults.forEach(item => { freshContent[item.id] = item.data; });

        processDataPublic(freshContent);
        cacheManager.set(cacheManager.keys.content, freshContent);

        const activeNav = document.querySelector('[data-filter].active');
        const currentFilter = activeNav?.dataset.filter || 'all';
        switchView(currentFilter);

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i>'; }
        ErrorHandler.show('content', '✓ Datos actualizados localmente', 2000);
        console.log('✓ Refresh local completado');
    } catch(e) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i>'; }
        console.error('Error en refresh local:', e);
    }
};

function safeClearStorage() {
    const preserve = [];
    const saved = {};
    preserve.forEach(k => { try { saved[k] = localStorage.getItem(k); } catch {} });
    localStorage.clear();
    preserve.forEach(k => { if (saved[k] != null) localStorage.setItem(k, saved[k]); });
}
window.safeClearStorage = safeClearStorage;

function checkResetPasswordMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');      
    const actionCode = urlParams.get('oobCode'); 

    if (mode === 'resetPassword' && actionCode) {
        
        window.history.replaceState({}, document.title, window.location.pathname);

        const modal = document.getElementById('new-password-modal');
        if (modal) {
            modal.classList.add('show');
            document.body.classList.add('modal-open');
        }

        const toggleIcon = document.getElementById('toggle-new-pass');
        const inputPass = document.getElementById('new-password-input');
        
        if(toggleIcon && inputPass) {
            const newToggle = toggleIcon.cloneNode(true);
            toggleIcon.parentNode.replaceChild(newToggle, toggleIcon);
            
            newToggle.addEventListener('click', () => {
                const isPass = inputPass.type === 'password';
                inputPass.type = isPass ? 'text' : 'password';
                newToggle.classList.toggle('fa-eye');
                newToggle.classList.toggle('fa-eye-slash');
            });
        }

        const form = document.getElementById('new-password-form');
        const feedback = document.getElementById('new-pass-feedback');
        
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const newPassword = inputPass.value;
                const btn = form.querySelector('button');

                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
                feedback.textContent = "";

                try {
                    await auth.confirmPasswordReset(actionCode, newPassword);
                    
                    feedback.style.color = '#4cd137'; 
                    feedback.textContent = "¡Contraseña actualizada correctamente!";
                    btn.textContent = "¡Listo!";
                    
                    setTimeout(() => {
                        modal.classList.remove('show'); 
                        if(window.openAuthModal) window.openAuthModal(true); 
                    }, 2000);

                } catch (error) {
                    console.error("Error reset password:", error);
                    btn.disabled = false;
                    btn.textContent = "Guardar Nueva Contraseña";
                    feedback.style.color = '#ff4d4d'; 
                    
                    if (error.code === 'auth/expired-action-code') {
                        feedback.textContent = "El enlace ha expirado. Solicita uno nuevo.";
                    } else if (error.code === 'auth/invalid-action-code') {
                        feedback.textContent = "El enlace ya fue usado o no es válido.";
                    } else if (error.code === 'auth/weak-password') {
                        feedback.textContent = "La contraseña es muy débil (mínimo 6 caracteres).";
                    } else {
                        feedback.textContent = "Ocurrió un error. Intenta nuevamente.";
                    }
                }
            };
        }
    }
}

window.closeAllModals = () => ModalManager.closeAll();
window.ErrorHandler = ErrorHandler;
window.ContentManager = ContentManager;
window.cacheManager = cacheManager;

console.log('✅ Cine Corneta v9.8 (ArtPlayer) cargado correctamente');
