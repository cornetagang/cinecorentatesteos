// ===========================================================
// MÓDULO DEL REPRODUCTOR (V3 - ARTPLAYER + SRT/ASS SPLIT)
// ===========================================================

import { logError } from '../utils/logger.js'; 
import { WORKER_URL } from "../core/config.js";
import ContentManager from '../utils/content-manager.js';

// ─── Constantes para SubtitlesOctopus ────────────────────────
// ✅ FIX: unpkg evita el error "Corrupted brotli dictionary" de jsDelivr
const OCTOPUS_WORKER = "https://unpkg.com/libass-wasm@4/dist/js/subtitles-octopus-worker.js";
const OCTOPUS_WASM   = "https://unpkg.com/libass-wasm@4/dist/js/subtitles-octopus-worker.wasm";

let shared; 

// 1. INICIALIZACIÓN
export function initPlayer(dependencies) {
    shared = dependencies;
}

// ===========================================================
// 🛠️ CLASE CINEPLAYER (Artplayer + Worker Integration)
// ===========================================================
function isDriveId(id) {
    // Google Drive IDs: empiezan con '1' y tienen >= 25 chars alfanuméricos
    return typeof id === 'string' && id.startsWith('1') && id.length >= 25 && /^[A-Za-z0-9_-]+$/.test(id);
}

function buildWorkerUrl(type, driveId) {
    if (!driveId) return null;
    // ✅ Query params: /?id=<fileId>&type=video|sub
    // El Worker detecta type=sub para forzar Content-Type: text/plain
    return `${WORKER_URL}/?id=${driveId}&type=${type}`;
}

function buildErrorHTML(message = "No se pudo cargar el video.") {
    return `
      <div class="player-error" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:white; background:#000;">
        <i class="fas fa-exclamation-circle" style="font-size: 40px; color: #e50914; margin-bottom: 15px;"></i>
        <p style="font-weight: bold; font-size: 18px; margin-bottom: 5px;">Error de reproducción</p>
        <p style="color: #aaa; margin-bottom: 15px;">${message}</p>
        <button onclick="location.reload()" style="background:#e50914; border:none; padding:8px 16px; color:white; border-radius:5px; cursor:pointer;">Reintentar</button>
      </div>`;
}

function destroyPrevious(container) {
    if (container._artInstance) {
        container._artInstance.destroy(false);
        container._artInstance = null;
    }
    if (container._octopusInstance) {
        container._octopusInstance.dispose();
        container._octopusInstance = null;
    }
}

class CinePlayer {
    constructor(containerSelector, options = {}) {
        this.container = typeof containerSelector === "string" ? document.querySelector(containerSelector) : containerSelector;
        if (!this.container) throw new Error(`[CinePlayer] Contenedor no encontrado: ${containerSelector}`);
        
        this.container.classList.add("cine-player-wrapper");
        this.options = options;
        this.art = null;
        this.octopus = null;
        // ✅ FIX: Contador para cancelar llamadas a _mountOctopus que quedaron en vuelo
        this._mountId = 0;
    }

    // ===========================================================
    // 🎯 REGLAS DE SUBTÍTULOS:
    //   subType === 'srt' → Ruta Liviana: art.subtitle.url nativo
    //                       Sin WASM. Ideal para móviles. Prioridad.
    //   subType === 'ass' → Ruta Avanzada: SubtitlesOctopus WASM
    //                       Solo cuando el contenido lo necesita.
    //   !subId            → Sin subtítulos, no se intenta nada.
    // ===========================================================
    async load({ videoId, subId = null, subType = null, title = "", poster = "" }) {
        destroyPrevious(this.container);
        this.container.innerHTML = "";

        if (!videoId) {
            this.showError("ID de video no proporcionado.");
            return;
        }

        // Si NO es un ID de Google Drive, caemos al iframe clásico
        if (!isDriveId(videoId)) {
            this._mountIframeFallback(videoId);
            return;
        }

        const videoUrl = buildWorkerUrl("video", videoId);
        const subUrl   = subId ? buildWorkerUrl("sub", subId) : null;

        // Normalizar subType para comparaciones seguras
        const resolvedSubType = subUrl
            ? (ContentManager.getSubtitleConfig({ subId, subType }).subType)
            : null;

        const available = await this._pingWorker(videoUrl);
        if (!available) {
            this.showError("El servidor de video no está disponible. Intenta más tarde.");
            return;
        }

        const artConfig = {
            container: this.container,
            url: videoUrl,
            title,
            poster,
            theme: '#e50914',
            volume: 1,
            autoplay: false,
            pip: true,
            autoSize: true,
            autoHeight: true,
            fastForward: true,
            backdrop: true,         // ✅ Activado
            lock: true,             // ✅ Activado (botón lock en móvil)
            autoMini: false,
            autoPlayback: true,     // ✅ Recuerda posición por URL (localStorage)
            miniProgressBar: true,  // ✅ Activado
            autoOrientation: true,  // ✅ Activado (rotación automática móvil)
            screenshot: false,
            hotkey: true,
            mutex: true,
            fullscreen: true,
            fullscreenWeb: true,
            lang: navigator.language.toLocaleLowerCase() || "es",
            moreVideoAttr: { 
                crossOrigin: "anonymous",  // ✅ Seguridad CORS
                playsinline: true, 
                preload: "metadata" 
            },

            // 🟢 RUTA LIVIANA (SRT): Configuración nativa en artConfig
            // ArtPlayer maneja el SRT sin WASM, perfecto para móviles
            ...(resolvedSubType === 'srt' && subUrl ? {
                subtitle: {
                    url: subUrl,
                    type: 'srt',
                    encoding: 'utf-8',
                    escape: false,
                    style: {
                        color: '#ffffff',
                        fontSize: '20px',
                        textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                    }
                }
            } : {}),

            // 🛠️ PANEL DE AJUSTES — ancho fijo 260px (no flota feo en móvil)
            setting: true, 
            settings: [
                {
                    width: 260,   // ✅ Fijo en 260px
                    html: 'Velocidad',
                    tooltip: '1.0x',
                    name: 'playbackRate',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
                    selector: [
                        { url: '0.5',  html: '0.5x' },
                        { url: '0.75', html: '0.75x' },
                        { default: true, url: '1.0', html: 'Normal' },
                        { url: '1.25', html: '1.25x' },
                        { url: '1.5',  html: '1.5x' },
                        { url: '2.0',  html: '2.0x' },
                    ],
                    onSelect: function (item) {
                        this.playbackRate = parseFloat(item.url);
                        return item.html;
                    },
                },
                {
                    width: 260,   // ✅ Fijo en 260px
                    html: 'Relación de Aspecto',
                    name: 'aspectRatio',
                    selector: [
                        { default: true, html: 'Default', url: 'default' },
                        { html: '16:9', url: '16:9' },
                        { html: '4:3',  url: '4:3'  },
                    ],
                    onSelect: function (item) {
                        this.aspectRatio = item.url;
                        return item.html;
                    },
                },

                // 📝 TAMAÑO DE SUBTÍTULOS — solo activo en ruta SRT (motor nativo)
                // Para ASS/Octopus el tamaño viene definido en el propio archivo .ass
                ...(resolvedSubType === 'srt' && subUrl ? [{
                    width: 260,
                    html: 'Tamaño Subtítulos',
                    tooltip: 'Mediano',
                    name: 'subtitleSize',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
                    selector: [
                        { url: '14px', html: 'Pequeño'  },
                        { url: '18px', html: 'Mediano', default: true },
                        { url: '24px', html: 'Grande'  },
                        { url: '30px', html: 'Extra'   },
                    ],
                    onSelect: function (item) {
                        this.subtitle.style({ fontSize: item.url });
                        return item.html;
                    },
                }] : []),
            ],

            // 🎨 Menú click derecho personalizado
            contextmenu: [
                {
                    html: 'Cine Corneta Player',
                    click: function (contextmenu) {
                        console.info('Reproductor oficial');
                        contextmenu.show = false;
                    },
                }
            ],

            ...this.options,
        };

        const art = new Artplayer(artConfig);
        this.art = art;
        this.container._artInstance = art;

        // ─── Asignación de subtítulos según tipo ─────────────────
        if (subUrl) {
            if (resolvedSubType === 'srt') {
                // 🟢 RUTA LIVIANA: ya configurado en artConfig.subtitle
                art.on('ready', () => {
                    art.subtitle.show = true;
                    // Asegurar estilo inicial coherente con el CSS de móvil
                    art.subtitle.style({
                        color: '#ffffff',
                        fontSize: '18px',
                        textShadow: '1px 1px 3px rgba(0,0,0,0.9)',
                    });
                });
            } else {
                // 🔴 RUTA AVANZADA (ASS): SubtitlesOctopus con WASM
                art.on("ready", () => this._mountOctopus(art.video, subUrl));
                art.on("seek",  () => { if (this.octopus) this.octopus.setCurrentTime(art.currentTime); });
            }
        }

        art.on("error", (err) => {
            console.error("[CinePlayer] Error:", err);
            const msg = err?.message?.includes("403") ? "Acceso denegado." 
                      : err?.message?.includes("404") ? "Archivo no encontrado." 
                      : "Ocurrió un error al reproducir.";
            this.showError(msg);
        });

        this._observeResize();

        // ─── Orientación forzada al entrar en pantalla completa (móvil) ───
        // autoOrientation:true ya rota el layout; esto además bloquea el SO.
        art.on('fullscreen', (isFullscreen) => {
            if (!window.screen?.orientation?.lock) return; // desktop / no soportado
            if (isFullscreen) {
                screen.orientation.lock('landscape').catch(() => {
                    // Silencioso: algunos browsers bloquean sin gesto previo
                });
            } else {
                screen.orientation.unlock();
            }
        });

        return art;
    }

    _mountIframeFallback(videoId) {
        let src = `https://streamtape.com/e/${videoId}/`;
        if (/^\d+$/.test(videoId)) src = `https://ok.ru/videoembed/${videoId}?nochat=1`;
        
        this.container.innerHTML = `<iframe src="${src}" style="width:100%; height:100%; border:none;" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`;
    }

    // ✅ FIX: ID de llamada para cancelar llamadas stale de _mountOctopus
    // Resuelve el TypeError "Cannot read properties of null (reading 'postMessage')"
    // que ocurría al cambiar episodio antes de que el worker terminara de inicializar
    async _mountOctopus(videoElement, subUrl) {
        const myId = ++this._mountId;

        const workerBlobUrl = await this._toBlobUrl(OCTOPUS_WORKER, 'application/javascript');

        if (myId !== this._mountId || !this.container) {
            if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
            return;
        }

        if (!workerBlobUrl) {
            console.warn("[CinePlayer] No se pudo cargar el worker de subtítulos ASS.");
            return;
        }

        let subBlobUrl = null;
        let workerBlobToRevoke = workerBlobUrl;

        try {
            const subResp = await fetch(subUrl);
            if (!subResp.ok) throw new Error(`HTTP ${subResp.status}`);

            if (myId !== this._mountId || !this.container) {
                URL.revokeObjectURL(workerBlobUrl);
                return;
            }

            const assContent = await subResp.text();
            subBlobUrl = URL.createObjectURL(new Blob([assContent], { type: "text/plain" }));

            this.octopus = new SubtitlesOctopus({
                video: videoElement,
                subUrl: subBlobUrl,
                workerUrl: workerBlobUrl,
                wasmUrl: OCTOPUS_WASM,
                renderMode: "wasm-blend",
                onReady: () => {
                    if (subBlobUrl)          { URL.revokeObjectURL(subBlobUrl);          subBlobUrl = null; }
                    if (workerBlobToRevoke)  { URL.revokeObjectURL(workerBlobToRevoke);  workerBlobToRevoke = null; }
                },
            });
            this.container._octopusInstance = this.octopus;
        } catch (err) {
            console.warn("[CinePlayer] Error cargando subtítulos ASS:", err);
            if (subBlobUrl)         URL.revokeObjectURL(subBlobUrl);
            if (workerBlobToRevoke) URL.revokeObjectURL(workerBlobToRevoke);
        }
    }

    /**
     * Descarga un script remoto y lo convierte en blob URL del mismo origen.
     * Parchea rutas relativas internas (.wasm, .js) con URLs absolutas.
     */
    async _toBlobUrl(remoteUrl, mimeType = 'application/javascript') {
        try {
            const resp = await fetch(remoteUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            let text = await resp.text();

            const cdnBase = remoteUrl.substring(0, remoteUrl.lastIndexOf('/') + 1);

            text = text.replace(
                /(['\"`])((?!https?:\/\/|blob:|data:)[^'\"`]*\.(?:wasm|js))(['\"`])/g,
                (match, q1, relativePath, q2) => {
                    if (relativePath.includes('${') || relativePath.includes('+')) return match;
                    return `${q1}${cdnBase}${relativePath}${q2}`;
                }
            );

            return URL.createObjectURL(new Blob([text], { type: mimeType }));
        } catch (err) {
            console.warn(`[CinePlayer] No se pudo descargar ${remoteUrl}:`, err);
            return null;
        }
    }

    async _pingWorker(url) {
        try {
            const resp = await fetch(url, { method: "HEAD" });
            if (resp.ok || resp.status === 206) return true;
            if (resp.status === 405 || resp.status === 501) {
                const r2 = await fetch(url, { headers: { Range: 'bytes=0-0' } });
                return r2.ok || r2.status === 206 || r2.status === 416;
            }
            return false;
        } catch {
            return false;
        }
    }

    _observeResize() {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._resizeObserver = new ResizeObserver(() => { 
            if (this.art && typeof this.art.resize === 'function') {
                this.art.resize(); 
            }
        });
        this._resizeObserver.observe(this.container);
    }

    showError(message) {
        destroyPrevious(this.container);
        this.container.innerHTML = buildErrorHTML(message);
    }

    destroy() {
        // ✅ FIX: Incrementar _mountId cancela cualquier _mountOctopus en vuelo
        this._mountId++;
        this._resizeObserver?.disconnect();
        destroyPrevious(this.container);
        this.container.innerHTML = "";
    }
}


// ===========================================================
// 🌐 HELPER: OBTENER TRACKS DE AUDIO DISPONIBLES DINÁMICAMENTE
// ===========================================================
function getLangTracks(data) {
    const rawEn   = data.videoId_en?.trim()  || '';
    const rawEs   = data.videoId_es?.trim()  || '';
    const rawJp   = data.videoId_jp?.trim()  || data.videoId_alt?.trim() || '';
    const rawMain = data.videoId?.trim()     || '';

    const rawLang = (data.language || data.idioma || data.audio || '').trim();
    const langParts = rawLang
        .split(/[-;|]/)
        .map(l => l.trim())
        .filter(Boolean);

    const SPANISH_LABELS = ['latino', 'español', 'castellano', 'doblado', 'esp'];
    const isSpanish = l => SPANISH_LABELS.some(s => l.toLowerCase().includes(s));

    const spanishLabel   = langParts.find(l => isSpanish(l)) || 'Latino';
    const originalLabels = langParts.filter(l => !isSpanish(l));

    const mainIsSpanish = langParts.length > 0 && langParts.every(l => isSpanish(l));

    const tracks = [];

    if (rawEn) {
        tracks.push({ id: rawEn, lang: 'en', label: originalLabels[0] || 'Original' });
    } else if (rawMain && !mainIsSpanish && !rawEs) {
        tracks.push({ id: rawMain, lang: 'en', label: originalLabels[0] || 'Original' });
    }

    if (rawJp) {
        tracks.push({ id: rawJp, lang: 'jp', label: originalLabels[1] || 'Alt' });
    }

    if (rawEs) {
        tracks.push({ id: rawEs, lang: 'es', label: spanishLabel });
    } else if (rawMain && mainIsSpanish) {
        tracks.push({ id: rawMain, lang: 'es', label: spanishLabel });
    }

    return tracks;
}


function buildLangButtonsHTML(tracks, activeLang, cssClass) {
    if (tracks.length <= 1) return '';
    return `<div class="movie-lang-selection">
        ${tracks.map(t => `
            <button class="${cssClass} ${t.lang === activeLang ? 'active' : ''}" data-lang="${t.lang}">
                ${t.label}
            </button>`).join('')}
    </div>`;
}

// 🔥 BUSCADOR INTELIGENTE EN TODAS LAS SAGAS
function findContentData(id) {
    const content = shared.appState.content;

    if (content.movies && content.movies[id]) return content.movies[id];
    if (content.series && content.series[id]) return content.series[id];
    if (content.ucm    && content.ucm[id])    return content.ucm[id];

    if (content.sagas) {
        for (const sagaKey in content.sagas) {
            const sagaData = content.sagas[sagaKey];
            if (sagaData && sagaData[id]) {
                return sagaData[id];
            }
        }
    }
    return null;
}

function saveProgress(seriesId) {
    try {
        let allProgress = JSON.parse(localStorage.getItem('seriesProgress')) || {};
        if (!allProgress[seriesId]) allProgress[seriesId] = {};
        const currentState = shared.appState.player.state[seriesId];
        allProgress[seriesId][currentState.season] = currentState.episodeIndex;
        localStorage.setItem('seriesProgress', JSON.stringify(allProgress));
    } catch (e) {
        logError(e, 'Player: Save Progress', 'warning');
    }
}

function loadProgress(seriesId, seasonNum) {
    try {
        const allProgress = JSON.parse(localStorage.getItem('seriesProgress'));
        return allProgress?.[seriesId]?.[seasonNum] || 0;
    } catch (e) { return 0; }
}

export function commitAndClearPendingSave() {
    if (shared.appState.player.pendingHistorySave) {
        try {
            shared.addToHistoryIfLoggedIn(
                shared.appState.player.pendingHistorySave.contentId,
                shared.appState.player.pendingHistorySave.type,
                shared.appState.player.pendingHistorySave.episodeInfo
            );
        } catch (e) {
            logError(e, 'Player: History Commit');
        }
        shared.appState.player.pendingHistorySave = null;
    }
}

function _openSeriesPlayerPage() {
    const sections = [
        'hero-section', 'carousel-container', 'full-grid-container',
        'my-list-container', 'history-container', 'profile-container',
        'settings-container', 'profile-hub-container', 'sagas-hub-container',
        'reviews-container', 'reports-container', 'filter-controls',
        'live-tv-section', 'iptv-section'
    ];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const page = shared.DOM.seriesPlayerModal || document.getElementById('series-player-page');
    if (!page) {
        console.error('[Player] #series-player-page no encontrado en el DOM');
        return;
    }
    shared.DOM.seriesPlayerModal = page;

    page.style.display = 'block';
    page.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function closeSeriesPlayerModal() {
    clearTimeout(shared.appState.player.episodeOpenTimer);
    commitAndClearPendingSave();
    const page = shared.DOM.seriesPlayerModal;
    page.classList.remove('active', 'season-grid-view', 'player-layout-view');
    page.style.display = 'none';
    
    if (shared.appState.player.activeCineInstance) {
        shared.appState.player.activeCineInstance.destroy();
        shared.appState.player.activeCineInstance = null;
    }

    shared.appState.player.activeSeriesId = null;
    if (shared.switchView) shared.switchView(shared.appState.currentFilter || 'all');
}

export async function openSeriesPlayer(seriesId, forceSeasonGrid = false) {
    try {
        shared.closeAllModals();
        
        const seriesInfo = findContentData(seriesId); 
        
        if (!seriesInfo) {
            console.warn(`Serie ID no encontrado: ${seriesId}`);
            shared.ErrorHandler.show('content', 'No se encontró la serie.');
            return;
        }

        _openSeriesPlayerPage();
        
        shared.DOM.seriesPlayerModal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <div class="spinner"></div>
            </div>`;

        const seriesEpisodes = shared.appState.content.seriesEpisodes[seriesId] || {};
        const postersData    = shared.appState.content.seasonPosters[seriesId]  || {};
        
        const allSeasonsKeys = [...new Set([...Object.keys(seriesEpisodes), ...Object.keys(postersData)])];

        let orderedKeys;
        if (shared.appState.content.seasonOrder && shared.appState.content.seasonOrder[seriesId]) {
            orderedKeys = shared.appState.content.seasonOrder[seriesId];
        } else {
            orderedKeys = [...allSeasonsKeys].sort((a, b) => {
                const posterA = postersData[a];
                const posterB = postersData[b];
                const ordenA = posterA && typeof posterA === 'object' && posterA.orden !== undefined && posterA.orden !== ''
                    ? Number(posterA.orden) : null;
                const ordenB = posterB && typeof posterB === 'object' && posterB.orden !== undefined && posterB.orden !== ''
                    ? Number(posterB.orden) : null;
                if (ordenA !== null && ordenB !== null) return ordenA - ordenB;
                if (ordenA !== null) return -1;
                if (ordenB !== null) return 1;
                const isNumericA = !isNaN(Number(a)) && String(a).trim() !== '';
                const isNumericB = !isNaN(Number(b)) && String(b).trim() !== '';
                if (isNumericA && isNumericB) return Number(a) - Number(b);
                if (isNumericA) return -1;
                if (isNumericB) return 1;
                return 0;
            });
        }

        const seasonsMapped = orderedKeys
            .filter(k => allSeasonsKeys.includes(k))
            .map(k => ({ key: k, num: !isNaN(k) ? Number(k) : 0 }));

        if (forceSeasonGrid && seasonsMapped.length > 1) {
            renderSeasonGrid(seriesId);
            return;
        }

        let targetSeasonKey = null;

        for (const s of seasonsMapped) {
            const seasonKey = s.key;
            
            const posterEntry = postersData[seasonKey];
            let seasonStatus = '';
            if (posterEntry && typeof posterEntry === 'object') {
                seasonStatus = String(posterEntry.estado || '').toLowerCase().trim();
            }

            const eps = seriesEpisodes[seasonKey];
            const hasEpisodes = eps && (Array.isArray(eps) ? eps.length > 0 : Object.keys(eps).length > 0);

            const isManuallyLocked = seasonStatus !== '' && seasonStatus !== 'disponible';
            const isLocked = isManuallyLocked || (!hasEpisodes && seasonStatus !== 'disponible');

            if (!isLocked) {
                targetSeasonKey = seasonKey;
                break; 
            }
        }

        if (targetSeasonKey) {
            const user = shared.auth.currentUser;
            let lastWatchedEpisode = 0;

            if (user) {
                const savedIndex = loadProgress(seriesId, targetSeasonKey);
                if (savedIndex > 0) lastWatchedEpisode = savedIndex;
            }

            renderEpisodePlayer(seriesId, targetSeasonKey, lastWatchedEpisode);
        } else {
            if (seasonsMapped.length > 0) {
                renderSeasonGrid(seriesId);
            } else {
                shared.DOM.seriesPlayerModal.innerHTML = `
                    <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
                    <div style="text-align:center; padding: 20px; color: white;">
                        <h2>${seriesInfo.title}</h2>
                        <p>Próximamente disponible.</p>
                    </div>`;
                shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
            }
        }

    } catch (error) {
        logError(error, 'Player: Critical Crash');
        shared.ErrorHandler.show('unknown', 'Error al abrir el reproductor de series.');
    }
}

function renderSeasonGrid(seriesId) {
    const seriesInfo = findContentData(seriesId); 
    if (!seriesInfo) return;

    shared.DOM.seriesPlayerModal.className = 'series-player-page active season-grid-view';
    
    shared.DOM.seriesPlayerModal.innerHTML = `
        <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
        <div class="season-grid-container">
            <h2 class="player-title">${seriesInfo.title}</h2>
            <div id="season-grid" class="season-grid"></div>
        </div>
    `;
    
    shared.DOM.seriesPlayerModal.querySelector('.close-btn').onclick = closeSeriesPlayerModal;
    populateSeasonGrid(seriesId);
    shared.appState.player.activeSeriesId = null;
}

function populateSeasonGrid(seriesId) {
    const container = shared.DOM.seriesPlayerModal.querySelector('#season-grid');
    
    function formatSeasonName(seasonKey, seasonNum, customLabel = null) {
        if (customLabel && customLabel.trim()) return customLabel.trim();

        const keyLower = String(seasonKey).toLowerCase();
        
        if (keyLower.includes('pelicula') || keyLower.includes('película') || keyLower === 'pelicula') return 'Película';
        if (keyLower.includes('especial') || keyLower === 'especial') return 'Especial';
        if (keyLower.includes('ova')      || keyLower === 'ova')      return 'OVA';
        if (keyLower.includes('movie')    || keyLower === 'movie')    return 'Película';
        if (keyLower.includes('special')  || keyLower === 'special')  return 'Especial';
        
        return `Temporada ${seasonNum}`;
    }
    
    const episodesData = shared.appState.content.seriesEpisodes[seriesId] || {};
    const postersData  = shared.appState.content.seasonPosters[seriesId]  || {};
    const seriesInfo   = findContentData(seriesId); 
    
    if (!seriesInfo) {
        console.error("No se encontró info para la serie:", seriesId);
        return;
    }

    if (!container) return;
    container.innerHTML = '';

    let allSeasons;

    if (shared.appState.content.seasonOrder && shared.appState.content.seasonOrder[seriesId]) {
        allSeasons = shared.appState.content.seasonOrder[seriesId];
    } else {
        const episodeSeasons = Object.keys(episodesData);
        const posterSeasons  = Object.keys(postersData);
        allSeasons = [...new Set([...episodeSeasons, ...posterSeasons])];
    }

    const seasonsMapped  = allSeasons.map((key) => ({ key, num: !isNaN(key) ? Number(key) : 0 }));
    const totalSeasons   = seasonsMapped.length;

    let columns = 5; 
    if      (totalSeasons <= 5)                        columns = totalSeasons;
    else if (totalSeasons === 6)                       columns = 3;
    else if (totalSeasons === 7 || totalSeasons === 8) columns = 4;
    else                                               columns = 5;

    container.style.gridTemplateColumns = `repeat(${columns}, 200px)`;
    container.style.justifyContent      = 'center';
    container.style.maxWidth            = `${columns * 200 + (columns - 1) * 20}px`; 

    seasonsMapped.forEach(({ key: seasonKey, num: seasonNum }) => {
        const rawEpisodes = episodesData[seasonKey];
        const episodes    = rawEpisodes ? (Array.isArray(rawEpisodes) ? rawEpisodes : Object.values(rawEpisodes)) : [];
        
        let posterUrl         = seriesInfo.poster || '';
        let seasonStatus      = ''; 
        let seasonStatusRaw   = ''; 
        let seasonCustomLabel = ''; 

        const posterEntry = postersData[seasonKey];
        if (posterEntry) {
            if (typeof posterEntry === 'object') {
                posterUrl         = posterEntry.posterUrl || posterEntry.poster || posterUrl;
                seasonStatusRaw   = String(posterEntry.estado   || '').trim();
                seasonStatus      = seasonStatusRaw.toLowerCase();
                seasonCustomLabel = String(posterEntry.etiqueta || '').trim(); 
            } else {
                posterUrl = posterEntry;
            }
        }
        
        const totalEpisodes   = episodes.length;
        const isManuallyLocked = seasonStatus !== '' && seasonStatus !== 'disponible';
        const isEmpty         = (totalEpisodes === 0);
        const isLocked        = isManuallyLocked || (isEmpty && seasonStatus !== 'disponible');
        const seasonLabel     = formatSeasonName(seasonKey, seasonNum, seasonCustomLabel);

        const card = document.createElement('div');
        card.className = `season-poster-card ${isLocked ? 'locked' : ''} ${seasonStatus === 'mantenimiento' ? 'en-mantenimiento' : ''}`;
        
        card.onclick = () => {
            if (isLocked) {
                shared.ErrorHandler.show('content', 'Temporada no disponible aún.');
            } else {
                renderEpisodePlayer(seriesId, seasonKey);
            }
        };

        let overlayText = '';
        if (isLocked) {
            if (seasonStatus === 'mantenimiento') {
                overlayText = 'Mantenimiento';
            } else if (seasonStatus === 'proximamente' || seasonStatus === 'próximamente') {
                overlayText = 'PRÓXIMAMENTE';
            } else if (/\d/.test(seasonStatusRaw)) {
                overlayText = `Próx. ${seasonStatusRaw}`;
            } else if (seasonStatusRaw) {
                overlayText = `Próx. en ${seasonStatusRaw}`;
            } else {
                overlayText = 'PRÓXIMAMENTE';
            }
        } else if (!isNaN(seasonKey)) {
            overlayText = `${totalEpisodes} episodios`;
        }

        card.innerHTML = `
            <img src="${posterUrl}" alt="${seasonLabel}">
            <div class="overlay">
                <h3>${seasonLabel}</h3>
                <p>${overlayText}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

// 5. REPRODUCTOR DE EPISODIOS
export async function renderEpisodePlayer(seriesId, seasonNum, startAtIndex = null) {
    try {
        shared.appState.player.activeSeriesId = seriesId;
        const savedEpisodeIndex  = loadProgress(seriesId, seasonNum);
        const initialEpisodeIndex = startAtIndex !== null ? startAtIndex : savedEpisodeIndex;
        
        const episodes    = shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum] || [];
        const firstEpisode = episodes[0];
        
        if (!firstEpisode) {
            console.error("No hay episodios para renderizar.");
            return;
        }
 
        const seriesTracks    = getLangTracks(firstEpisode);
        const hasLangOptions  = seriesTracks.length > 1;
        
        let savedLang = null;
        try {
            const prefs = JSON.parse(localStorage.getItem('seriesLangPrefs')) || {};
            savedLang = prefs[seriesId];
        } catch(e) {}

        let initialLang = seriesTracks[0]?.lang || 'en';
        if (!hasLangOptions && seriesTracks[0]?.lang === 'es') initialLang = 'es';
        
        if (savedLang && seriesTracks.some(t => t.lang === savedLang)) {
            initialLang = savedLang;
        }
 
        shared.appState.player.state[seriesId] = { 
            season: seasonNum, 
            episodeIndex: initialEpisodeIndex, 
            lang: initialLang 
        };
 
        const seasonLower = String(seasonNum).toLowerCase();
        const isSpecialContent = seasonLower.includes('pelicula')  || 
                                 seasonLower.includes('película')  || 
                                 seasonLower.includes('especial')  || 
                                 seasonLower.includes('ova')       || 
                                 seasonLower.includes('movie')     || 
                                 seasonLower.includes('special');
        
        const isSingleMovie = isSpecialContent && episodes.length === 1;
 
        const postersData = shared.appState.content.seasonPosters[seriesId]?.[seasonNum] || {};
        const seriesInfo  = findContentData(seriesId) || {};
 
        const movieYear      = postersData.year      || postersData.anio     || '';
        const movieDuration  = postersData.duration  || postersData.duracion || '';
        const movieRequester = postersData.pedido    || postersData.pedidoPor || '';
        
        let specificPoster = postersData.poster || postersData.posterUrl;
        if (!specificPoster) specificPoster = seriesInfo.poster; 
 
        const movieSynopsis = postersData.sinopsis || firstEpisode.description || "Sinopsis no disponible.";
        
        const displayTitle = isSpecialContent && firstEpisode.title 
            ? firstEpisode.title 
            : seriesInfo.title || firstEpisode.title || 'Sin título';
        
        const seasonsCount   = Object.keys(shared.appState.content.seriesEpisodes[seriesId] || {}).length;
        const backButtonHTML = seasonsCount > 1 
            ? `<button class="player-back-link back-to-seasons"><i class="fas fa-arrow-left"></i> Temporadas</button>` 
            : '';
 
        shared.DOM.seriesPlayerModal.className = 'series-player-page active player-layout-view';
 
        const finishTime  = movieDuration ? calculateFinishTime(movieDuration) : null;
        const endTimeHTML = finishTime
            ? `<span class="meta-tag" style="display:inline-flex;align-items:center;">
                   <i class="fas fa-flag-checkered" style="color:#ff4d4d;"></i>
                   <span style="opacity:0.9;margin-left:5px;">Terminas de ver a las <strong style="color:#fff;">${finishTime}</strong> aprox.</span>
               </span>`
            : '';
 
        if (isSingleMovie) {
            shared.DOM.seriesPlayerModal.innerHTML = `
                <button class="close-btn streaming-back-btn"><i class="fas fa-arrow-left"></i> Volver</button>
                <div class="player-layout-container movie-mode">
                    <div class="movie-player-container">
                        <h2 id="cinema-title-${seriesId}" class="movie-player-title cinema-title-above">${displayTitle}</h2>
                        <div class="screen"><div id="video-container-${seriesId}" style="width:100%; height:100%; background:#000;"></div></div>
                    </div>
                    <div class="movie-info-sidebar">
                        <div class="movie-info-sidebar-inner">
                            ${backButtonHTML}
                            <div class="movie-poster-container">
                                <img src="${specificPoster}" alt="Poster" onerror="this.src='https://via.placeholder.com/150'">
                            </div>
                            <div class="movie-details-info">
                                <div class="movie-meta-info">
                                    ${movieRequester ? `<span class="meta-tag request-tag"><i class="fas fa-user-circle"></i> ${movieRequester}</span>` : ''}
                                    ${movieYear     ? `<span class="meta-tag"><i class="fas fa-calendar"></i> ${movieYear}</span>`     : ''}
                                    ${movieDuration ? `<span class="meta-tag"><i class="fas fa-clock"></i> ${movieDuration}</span>`    : ''}
                                    ${endTimeHTML}
                                </div>
                                <p id="cinema-synopsis-sp" class="movie-synopsis">${movieSynopsis}</p>
                                <div class="cinema-controls-sp">
                                    <button id="btn-review-player-${seriesId}" class="btn btn-review"><i class="fas fa-star"></i> Escribir Reseña</button>
                                    <button class="btn btn-report-sp"><i class="fas fa-flag"></i> Reportar problema</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
 
        } else {
            let langDropdown = '';
            if (hasLangOptions) {
                const currentLangLabel = seriesTracks.find(t => t.lang === initialLang)?.label || 'Original';
                
                const optionsHtml = seriesTracks.map(t => `
                    <div class="cc-lang-option" data-lang="${t.lang}" style="padding: 10px 15px; cursor: pointer; color: ${t.lang === initialLang ? '#fff' : '#aaa'}; background: ${t.lang === initialLang ? '#e50914' : 'transparent'}; font-size: 11px; font-weight: bold; text-transform: uppercase; transition: 0.2s; border-bottom: 1px solid #222;">
                        ${t.label}
                    </div>
                `).join('');

                langDropdown = `
                    <div class="cc-custom-lang-wrapper" style="position: relative; display: inline-block; font-family: 'Montserrat', sans-serif;">
                        <div class="cc-lang-trigger" style="display: inline-flex; align-items: center; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 7px 12px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                            <i class="fas fa-language" style="color: #e50914; font-size: 14px; margin-right: 8px; pointer-events: none;"></i>
                            <span style="color: #fff; font-size: 12px; font-weight: 700; text-transform: uppercase; padding-right: 10px; letter-spacing: 0.5px; pointer-events: none;">${currentLangLabel}</span>
                            <i class="fas fa-chevron-down" style="font-size: 10px; color: #aaa; pointer-events: none;"></i>
                        </div>
                        <div class="cc-lang-menu" style="display: none; position: absolute; top: calc(100% + 5px); right: 0; background: #141414; border: 1px solid #333; border-radius: 8px; overflow: hidden; z-index: 999999; min-width: 130px; box-shadow: 0 10px 25px rgba(0,0,0,0.9);">
                            ${optionsHtml}
                        </div>
                    </div>
                `;
            }

            const mYear = postersData.year  || postersData.anio   || seriesInfo.year  || seriesInfo.anio || '';
            const mReq  = postersData.pedido || postersData.pedidoPor || seriesInfo.pedido || seriesInfo.requester || '';
            
            const normStr = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
            const rawAltTitle = seriesInfo.secondTitle || seriesId;
            const originalTitle = rawAltTitle && normStr(rawAltTitle) !== normStr(seriesInfo.title || '') ? rawAltTitle : null;

            let genresVal = '';
            if (seriesInfo.genres) {
                genresVal = Array.isArray(seriesInfo.genres) ? seriesInfo.genres.join(', ') : String(seriesInfo.genres).replace(/;/g, ', ');
            }
            const langVal  = seriesInfo.language || seriesInfo.idioma || seriesInfo.audio || '';

            const mReqHtml = mReq  ? `<span>Pedido por: <span style="color:#fff; font-weight:bold;">${mReq}</span></span><span style="font-size:10px; color:#555; margin:0 4px;">●</span>` : '';
            const mYearHtml = mYear ? `<span>Estreno: <span style="color:#fff; font-weight:bold;">${mYear}</span></span><span style="font-size:10px; color:#555; margin:0 4px;">●</span>` : '';
            const logoTheme = shared.THEMES?.normal?.logo || 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209688/vgJjqSM_oicebo.png';

            shared.DOM.seriesPlayerModal.innerHTML = `
                <style>
                    body:has(#series-player-page.active) .bottom-nav { display: none !important; }
                    #series-player-page.player-layout-view {
                        position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                        display: flex !important; flex-direction: column !important; background-color: #0f0f0f !important;
                        z-index: 99999 !important; padding: 0 !important; margin: 0 !important; 
                        width: 100vw !important; height: 100dvh !important; border-radius: 0 !important; 
                        align-items: stretch !important; overflow: hidden !important;
                        overscroll-behavior: none !important;
                    }
                    #series-player-page .player-top-bar, #series-player-page .player-page-wrapper, #series-player-page .nav-buttons-row { display: none !important; }
                    .cc-top-fixed { flex-shrink: 0; display: flex; flex-direction: column; background-color: #0f0f0f; z-index: 10; transition: box-shadow 0.3s ease; }
                    .cc-top-fixed.scrolled { box-shadow: 0 4px 15px rgba(0,0,0,0.6); border-bottom: 1px solid #222; }
                    .cc-nav { display: flex; align-items: center; justify-content: space-between; padding: 10px 15px; padding-top: calc(10px + env(safe-area-inset-top)); border-bottom: 2px solid #e50914; }
                    .cc-logo { height: 22px; }
                    .cc-back-btn { background: transparent; border: none; color: white; font-size: 0.9rem; font-weight: bold; display: flex; align-items: center; gap: 7px; cursor: pointer; padding: 0; }
                    .cc-video-wrap { width: 100%; background: #000; position: relative; padding-top: 56.25%; height: 0; }
                    .cc-details { padding: 15px; }
                    .cc-title-box { position: relative; cursor: pointer; margin-bottom: 0; user-select: none; -webkit-tap-highlight-color: transparent; }
                    .cc-title { font-size: 1.2rem; font-weight: bold; margin: 0 0 4px 0; color: white; line-height: 1.2;}
                    .cc-subtitle { color: #e50914; font-size: 12px; font-weight: bold; margin-bottom: 4px; display: block; }
                    .cc-toggle { position: absolute; bottom: 2px; right: 0; font-size: 14px; color: #8a8a92; font-weight: 500; background: linear-gradient(90deg, rgba(15,15,15,0) 0%, rgba(15,15,15,1) 25%, rgba(15,15,15,1) 100%); padding-left: 25px; padding-right: 2px; z-index: 2; }
                    .cc-scroll { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 15px 15px 40px 15px; display: block !important; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
                    .cc-scroll::-webkit-scrollbar { display: none; }
                    .cc-meta { font-size: 12px; color: #8a8a92; margin-bottom: 15px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; line-height: 1.6; border-bottom: 1px solid #222; padding-bottom: 15px; }
                    .cc-expand { display: none; background-color: #181818; border-radius: 12px; padding: 15px; margin-bottom: 20px; }
                    .cc-desc { font-size: 13px; line-height: 1.5; color: white; margin-bottom: 15px; }
                    .cc-controls { display: flex; align-items: center; justify-content: flex-start; gap: 15px; margin: 10px 0 15px 0; flex-wrap: wrap; overflow: visible; }
                    .cc-controls::-webkit-scrollbar { display: none; }
                    .cc-season-btn { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: bold; cursor: pointer; padding: 8px; border-radius: 8px; background-color: transparent; color: white; margin-left: -8px; }
                    .cc-langs { display: flex; gap: 8px; flex-wrap: nowrap; margin-left: auto; } 
                    .cc-card { display: flex !important; gap: 12px !important; margin-bottom: 16px !important; align-items: center !important; padding: 0 !important; background: transparent !important; border: none !important; cursor: pointer; }
                    .cc-thumb { width: 120px !important; height: 67px !important; border-radius: 8px !important; object-fit: cover !important; border: 2px solid transparent !important; flex-shrink: 0; background: #222;}
                    .cc-card.active .cc-thumb { border: 2px solid #e50914 !important; }
                    .cc-info { display: flex !important; flex-direction: column !important; justify-content: center !important; flex: 1 !important; min-width: 0;}
                    .cc-ep-title { font-size: 0.85rem !important; font-weight: bold !important; color: white !important; margin: 0 0 4px 0 !important; line-height: 1.3;}
                    .cc-card.active .cc-ep-title { color: #e50914 !important; }
                    .cc-ep-desc { font-size: 0.75rem !important; color: #8a8a92 !important; display: -webkit-box !important; -webkit-line-clamp: 2 !important; -webkit-box-orient: vertical !important; overflow: hidden !important; margin: 0 !important; line-height: 1.4;}
                    .cc-sheet-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 3000; display: flex; flex-direction: column; justify-content: flex-end; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
                    .cc-sheet-overlay.active { opacity: 1; pointer-events: auto; }
                    .cc-sheet { background-color: #181818; border-radius: 20px 20px 0 0; padding: 20px 15px calc(20px + env(safe-area-inset-bottom)); max-height: 75vh; display: flex; flex-direction: column; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.1, 0.9, 0.2, 1); width: 100%; box-sizing: border-box; }
                    .cc-sheet-overlay.active .cc-sheet { transform: translateY(0); }
                    .cc-sheet-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; font-size: 18px; font-weight: bold; color: white;}
                    .cc-sheet-close { background: transparent; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0;}
                    .cc-sheet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; overflow-y: auto; padding-bottom: 20px; }
                    .cc-sheet-grid::-webkit-scrollbar { display: none; }
                    .cc-sheet-card { position: relative; border-radius: 8px; overflow: hidden; aspect-ratio: 2/3; cursor: pointer; background-color: #111; border: 2px solid transparent; }
                    .cc-sheet-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
                    .cc-sheet-card .cc-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 60%); display: flex; align-items: flex-end; justify-content: center; padding: 10px; color: white; font-size: 0.8rem; font-weight: bold; text-align: center; }
                    .cc-sheet-card.active-season { border-color: #e50914; }
                </style>

                <div class="cc-top-fixed" id="fixedHeader">
                    <nav class="cc-nav">
                        <img src="${logoTheme}" class="cc-logo">
                        <button class="cc-back-btn streaming-back-btn"><i class="fas fa-times"></i> Cerrar</button>
                    </nav>
                    <div class="cc-video-wrap">
                        <div id="video-container-${seriesId}" style="width:100%; height:100%; background:#000; position:absolute; inset:0;"></div>
                    </div>
                    <div class="cc-details">
                        <div class="cc-title-box" id="toggleDescBtn">
                            <div>
                                <span class="cc-subtitle" id="subTitle">Temporada ${seasonNum}</span>
                                <h1 class="cc-title" id="cinema-title-${seriesId}"></h1>
                            </div>
                            <span class="cc-toggle" id="toggleText">... ver más</span>
                        </div>
                    </div>
                </div>

                <div class="cc-scroll" id="scrollArea">
                    <div class="cc-meta">
                        ${mReqHtml}
                        ${mYearHtml}
                        <span><span style="color:#fff; font-weight:bold;">${seasonsCount}</span> Temporadas</span>
                    </div>

                    <div class="cc-expand" id="expandableArea">
                        <div style="font-size: 12px; color: #ccc; margin-bottom: 15px; display: flex; flex-direction: column; gap: 6px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border-left: 2px solid #e50914;">
                            ${originalTitle ? `<span><i class="fas fa-film" style="color:#8a8a92; width:18px;"></i> ${originalTitle}</span>` : ''}
                            ${genresVal     ? `<span><i class="fas fa-tags" style="color:#8a8a92; width:18px;"></i> ${genresVal}</span>`     : ''}
                            ${langVal       ? `<span><i class="fas fa-language" style="color:#8a8a92; width:18px;"></i> ${langVal}</span>`    : ''}
                        </div>

                        <div class="cc-desc" id="episode-desc-${seriesId}"></div>
                        <button class="vab-btn--report" style="background: rgba(229, 9, 20, 0.1); color: #e50914; border: 1px solid rgba(229, 9, 20, 0.3); border-radius: 18px; padding: 8px 16px; font-size: 13px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; width: fit-content;"><i class="fas fa-flag"></i> Reportar problema</button>
                    </div>
                    
                    <div class="cc-controls">
                        <div class="cc-season-btn" id="seasonSelectorBtn">
                            <span id="seasonBtnText">Temporada ${seasonNum}</span>
                            <i class="fas fa-chevron-down"></i>
                        </div>
                        <div class="cc-langs">
                            ${langDropdown}
                        </div>
                    </div>

                    <div id="episode-list-${seriesId}"></div>
                </div>

                <div class="cc-sheet-overlay" id="seasonModalSheet">
                    <div class="cc-sheet" onclick="event.stopPropagation();">
                        <div class="cc-sheet-header">
                            <span>Temporadas</span>
                            <button class="cc-sheet-close" id="closeSeasonSheetBtn">✕</button>
                        </div>
                        <div class="cc-sheet-grid" id="season-grid-sheet-container"></div>
                    </div>
                </div>
            `;
 
            const scrollArea    = shared.DOM.seriesPlayerModal.querySelector('#scrollArea');
            const fixedHeader   = shared.DOM.seriesPlayerModal.querySelector('#fixedHeader');
            const toggleText    = shared.DOM.seriesPlayerModal.querySelector('#toggleText');
            const toggleDescBtn = shared.DOM.seriesPlayerModal.querySelector('#toggleDescBtn');
            const expandArea    = shared.DOM.seriesPlayerModal.querySelector('#expandableArea');
 
            if (scrollArea && fixedHeader && toggleText) {
                scrollArea.addEventListener('scroll', () => {
                    if (scrollArea.scrollTop > 10) {
                        toggleText.style.opacity       = '0';
                        toggleText.style.pointerEvents = 'none';
                        fixedHeader.classList.add('scrolled');
                    } else {
                        toggleText.style.opacity       = '1';
                        toggleText.style.pointerEvents = 'auto';
                        fixedHeader.classList.remove('scrolled');
                    }
                });
            }
 
            if (toggleDescBtn && expandArea && toggleText && scrollArea) {
                toggleDescBtn.addEventListener('click', () => {
                    if (expandArea.style.display === 'none' || expandArea.style.display === '') {
                        expandArea.style.display = 'block';
                        toggleText.innerHTML     = 'ocultar';
                        scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                        expandArea.style.display = 'none';
                        toggleText.innerHTML     = '... ver más';
                    }
                });
            }
 
            const seasonSelectorBtn        = shared.DOM.seriesPlayerModal.querySelector('#seasonSelectorBtn');
            const seasonModalSheet         = shared.DOM.seriesPlayerModal.querySelector('#seasonModalSheet');
            const closeSeasonSheetBtn      = shared.DOM.seriesPlayerModal.querySelector('#closeSeasonSheetBtn');
            const seasonGridSheetContainer = shared.DOM.seriesPlayerModal.querySelector('#season-grid-sheet-container');
 
            if (seasonSelectorBtn && seasonModalSheet && seasonGridSheetContainer) {
                seasonGridSheetContainer.innerHTML = '';
 
                const seriesEpisodes   = shared.appState.content.seriesEpisodes[seriesId] || {};
                const allSeasonPosters = shared.appState.content.seasonPosters[seriesId]  || {};
                const allSeasonsKeys   = [...new Set([...Object.keys(seriesEpisodes), ...Object.keys(allSeasonPosters)])];
                const orderedKeys      = shared.appState.content.seasonOrder?.[seriesId] || allSeasonsKeys;
                const seasonsMappedSheet = orderedKeys
                    .filter(k => allSeasonsKeys.includes(k))
                    .map(k => ({ key: k, num: !isNaN(k) ? Number(k) : 0 }));
 
                seasonsMappedSheet.forEach(({ key: sKey, num: sNum }) => {
                    const posterEntry = allSeasonPosters[sKey];
                    let posterUrl   = seriesInfo.poster || '';
                    let customLabel = '';
 
                    if (posterEntry && typeof posterEntry === 'object') {
                        posterUrl   = posterEntry.posterUrl || posterEntry.poster || posterUrl;
                        customLabel = posterEntry.etiqueta  || '';
                    } else if (posterEntry) {
                        posterUrl = posterEntry;
                    }
 
                    const sLabel   = customLabel ? customLabel : (sNum === 0 ? 'Especial/Película' : `Temporada ${sNum}`);
                    const isActive = sKey === seasonNum;
 
                    const card = document.createElement('div');
                    card.className = `cc-sheet-card ${isActive ? 'active-season' : ''}`;
                    card.innerHTML = `<img src="${posterUrl}" alt="${sLabel}"><div class="cc-overlay">${sLabel}</div>`;
                    card.addEventListener('click', () => {
                        seasonModalSheet.classList.remove('active');
                        if (scrollArea) scrollArea.style.overflowY = 'auto';
                        if (!isActive) renderEpisodePlayer(seriesId, sKey);
                    });
                    seasonGridSheetContainer.appendChild(card);
                });
 
                seasonSelectorBtn.addEventListener('click', () => {
                    seasonModalSheet.classList.add('active');
                    if (scrollArea) scrollArea.style.overflowY = 'hidden';
                });
                const closeSheet = () => {
                    seasonModalSheet.classList.remove('active');
                    if (scrollArea) scrollArea.style.overflowY = 'auto';
                };
                if (closeSeasonSheetBtn) closeSeasonSheetBtn.addEventListener('click', closeSheet);
                seasonModalSheet.addEventListener('click', closeSheet);
            }
 
            const reportBtnB = shared.DOM.seriesPlayerModal.querySelector('.vab-btn--report');
            if (reportBtnB) {
                reportBtnB.addEventListener('click', async () => {
                    try {
                        const rptMod = await import('./features/reports.js');
                        rptMod.openReportModal({ contentId: seriesId, contentTitle: seriesInfo.title, contentType: 'series' });
                    } catch(e) { console.error('Error al abrir reporte:', e); }
                });
            }
        } 
 
        shared.DOM.seriesPlayerModal.querySelector('.streaming-back-btn').onclick = closeSeriesPlayerModal;
        
        const langWrapper = shared.DOM.seriesPlayerModal.querySelector('.cc-custom-lang-wrapper');
        if (langWrapper) {
            const trigger = langWrapper.querySelector('.cc-lang-trigger');
            const menu    = langWrapper.querySelector('.cc-lang-menu');
            const options = langWrapper.querySelectorAll('.cc-lang-option');

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = menu.style.display === 'block';
                menu.style.display   = isOpen ? 'none' : 'block';
                trigger.style.borderColor = isOpen ? 'rgba(255, 255, 255, 0.15)' : '#e50914';
            });

            document.addEventListener('click', () => {
                if (menu.style.display === 'block') {
                    menu.style.display        = 'none';
                    trigger.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                }
            });

            options.forEach(opt => {
                opt.addEventListener('mouseenter', () => {
                    if (opt.style.background !== 'rgb(229, 9, 20)' && opt.style.background !== '#e50914') {
                        opt.style.background = '#2a2a2a';
                    }
                });
                opt.addEventListener('mouseleave', () => {
                    if (opt.style.background !== 'rgb(229, 9, 20)' && opt.style.background !== '#e50914') {
                        opt.style.background = 'transparent';
                    }
                });
                
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    menu.style.display = 'none';
                    changeLanguage(seriesId, opt.dataset.lang);
                });
            });
        }
        
        const backButton = shared.DOM.seriesPlayerModal.querySelector('.player-back-link.back-to-seasons');
        if (backButton) backButton.onclick = () => renderSeasonGrid(seriesId);
 
        const reviewBtn = shared.DOM.seriesPlayerModal.querySelector(`#btn-review-player-${seriesId}`);
        if (reviewBtn) {
            reviewBtn.onclick = () => {
                let correctTitle = '';
                let correctType  = 'movie';
                if (isSpecialContent || isSingleMovie) {
                    correctTitle = displayTitle;
                    correctType  = 'movie';
                } else {
                    correctTitle = seriesInfo.title || displayTitle;
                    correctType  = 'series';
                }
                if (window.openSmartReviewModal) {
                    window.openSmartReviewModal(seriesId, correctType, correctTitle);
                } else {
                    console.error("La función window.openSmartReviewModal no está definida en script.js");
                }
            };
        }
 
        const reportBtnSp = shared.DOM.seriesPlayerModal.querySelector('.btn-report-sp');
        if (reportBtnSp) {
            reportBtnSp.onclick = async () => {
                try {
                    const rptMod = await import('./features/reports.js');
                    rptMod.openReportModal({ contentId: seriesId, contentTitle: displayTitle, contentType: 'movie' });
                } catch(e) { console.error('Error al abrir reporte:', e); }
            };
        }
 
        if (isSingleMovie) {
            const synopsisEl = shared.DOM.seriesPlayerModal.querySelector('#cinema-synopsis-sp');
            if (synopsisEl) {
                requestAnimationFrame(() => {
                    const isClamped = synopsisEl.scrollHeight > synopsisEl.clientHeight + 2;
                    if (isClamped) {
                        const toggleBtn = document.createElement('button');
                        toggleBtn.className   = 'synopsis-toggle-btn';
                        toggleBtn.textContent = 'Leer sinopsis ▾';
                        toggleBtn.onclick = () => {
                            const isExpanded = synopsisEl.classList.toggle('expanded');
                            toggleBtn.textContent = isExpanded ? 'Ver menos ▴' : 'Leer sinopsis ▾';
                        };
                        synopsisEl.insertAdjacentElement('afterend', toggleBtn);
                    }
                });
            }
        }
 
        if (!isSingleMovie) populateEpisodeList(seriesId, seasonNum);
        openEpisode(seriesId, seasonNum, initialEpisodeIndex);
 
    } catch (e) {
        logError(e, 'Player: Render Episode');
        shared.ErrorHandler.show('content', 'Error al cargar el episodio.');
    }
}

export function populateEpisodeList(seriesId, seasonNum) {
    const container = shared.DOM.seriesPlayerModal.querySelector(`#episode-list-${seriesId}`);
    const episodes  = shared.appState.content.seriesEpisodes[seriesId]?.[seasonNum];
    if (!container || !episodes) return;
 
    container.innerHTML = '';
 
    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber).forEach((episode, index) => {
        const card = document.createElement('div');
        card.className = 'cc-card episode-card'; 
        card.id        = `episode-card-${seriesId}-${seasonNum}-${index}`;
        card.addEventListener('click', () => openEpisode(seriesId, seasonNum, index));
 
        const thumbSrc = episode.thumbnail || episode.thumb || episode.image || '';
        const epNum    = String(episode.episodeNumber || index + 1).padStart(2, '0');
        const desc     = episode.description || episode.synopsis || episode.desc || '';
 
        card.innerHTML = `
            ${thumbSrc
                ? `<img class="cc-thumb ep-thumb" src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="cc-thumb ep-thumb"></div>`
            }
            <div class="cc-info episode-card-info">
                <h3 class="cc-ep-title ep-title">${epNum}. ${episode.title || ''}</h3>
                ${desc ? `<p class="cc-ep-desc episode-description">${desc}</p>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

export function openEpisode(seriesId, season, newEpisodeIndex) {
    const episode = shared.appState.content.seriesEpisodes[seriesId]?.[season]?.[newEpisodeIndex];
    if (!episode) return;

    // ✅ FIX: Commit del episodio ANTERIOR antes de sobreescribir pendingHistorySave.
    // Sin esto, al hacer click en una tarjeta de la lista el historial del ep anterior
    // se perdía (navigateEpisode sí lo llamaba, pero el click directo no).
    commitAndClearPendingSave();

    clearTimeout(shared.appState.player.episodeOpenTimer);
    shared.appState.player.pendingHistorySave = {
        contentId: seriesId,
        type: 'series',
        episodeInfo: { season, index: newEpisodeIndex, title: episode.title || '' }
    };
 
    shared.DOM.seriesPlayerModal.querySelectorAll('.episode-card.active').forEach(c => c.classList.remove('active'));
    const activeCard = shared.DOM.seriesPlayerModal.querySelector(`#episode-card-${seriesId}-${season}-${newEpisodeIndex}`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
 
    shared.appState.player.state[seriesId] = { ...shared.appState.player.state[seriesId], season, episodeIndex: newEpisodeIndex };
    saveProgress(seriesId);
 
    const container = shared.DOM.seriesPlayerModal.querySelector(`#video-container-${seriesId}`);
    const lang      = shared.appState.player.state[seriesId]?.lang || 'es';
 
    let videoId;
    if      (lang === 'en' && episode.videoId_en)                      videoId = episode.videoId_en;
    else if (lang === 'es' && episode.videoId_es)                      videoId = episode.videoId_es;
    else if (lang === 'jp' && (episode.videoId_jp || episode.videoId_alt)) videoId = episode.videoId_jp || episode.videoId_alt;
    else                                                                videoId = episode.videoId;
 
    if (container) {
        if (shared.appState.player.activeCineInstance) {
            shared.appState.player.activeCineInstance.destroy();
            // ✅ FIX: Null explícito. Si new CinePlayer() lanzara una excepción,
            // evitamos que activeCineInstance quede apuntando a la instancia destruida.
            shared.appState.player.activeCineInstance = null;
        }
        
        shared.appState.player.activeCineInstance = new CinePlayer(container);

        // ✅ Extraer subId y subType del episodio usando ContentManager
        const { subId, subType } = ContentManager.getSubtitleConfig(episode);
        
        shared.appState.player.activeCineInstance.load({
            videoId,
            subId,     // Columna E de la Sheet
            subType,   // Columna F: 'srt' → liviano | 'ass' → WASM
            title:  episode.title || `Episodio ${newEpisodeIndex + 1}`,
            poster: episode.thumbnail || episode.thumb || episode.image || ''
        });
    }
 
    const seasonLower      = String(season).toLowerCase();
    const isSpecialContent = seasonLower.includes('pelicula')  || seasonLower.includes('película') || 
                             seasonLower.includes('especial')  || seasonLower.includes('ova')      || 
                             seasonLower.includes('movie')     || seasonLower.includes('special');
 
    const episodeNumber = episode.episodeNumber || newEpisodeIndex + 1;
 
    const subTitleEl  = shared.DOM.seriesPlayerModal.querySelector('#subTitle');
    const titleEl     = shared.DOM.seriesPlayerModal.querySelector(`#cinema-title-${seriesId}`);
    const infoDescEl  = shared.DOM.seriesPlayerModal.querySelector(`#episode-desc-${seriesId}`);
 
    const episodeTitleText = episode.title || `Episodio ${episodeNumber}`;
    const subTitleText     = isSpecialContent ? 'Especial / Película' : `Temporada ${String(season).replace('T', '')} | Ep ${episodeNumber}`;
 
    if (subTitleEl) subTitleEl.textContent = subTitleText;
    if (titleEl)    titleEl.textContent    = episodeTitleText;
    if (infoDescEl) infoDescEl.innerHTML   = `<strong>Sinopsis:</strong><br><br>${episode.description || episode.synopsis || episode.desc || 'No hay descripción disponible para este episodio.'}`;
 
    const langWrapper = shared.DOM.seriesPlayerModal.querySelector('.cc-custom-lang-wrapper');
    if (langWrapper) {
        const triggerSpan = langWrapper.querySelector('.cc-lang-trigger span');
        const options     = langWrapper.querySelectorAll('.cc-lang-option');
        
        options.forEach(opt => {
            if (opt.dataset.lang === lang) {
                opt.style.background = '#e50914';
                opt.style.color      = '#fff';
                opt.classList.add('active');
                if (triggerSpan) triggerSpan.textContent = opt.textContent.trim();
            } else {
                opt.style.background = 'transparent';
                opt.style.color      = '#aaa';
                opt.classList.remove('active');
            }
        });
    }
 
    const scrollAreaEp = shared.DOM.seriesPlayerModal.querySelector('#scrollArea');
    if (scrollAreaEp && window.innerWidth <= 768) {
        scrollAreaEp.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function navigateEpisode(seriesId, direction) {
    commitAndClearPendingSave();
    const { season, episodeIndex } = shared.appState.player.state[seriesId];
    const newIndex      = episodeIndex + direction;
    const seasonEpisodes = shared.appState.content.seriesEpisodes[seriesId][season];
    if (newIndex >= 0 && newIndex < seasonEpisodes.length) {
        openEpisode(seriesId, season, newIndex);
    }
}

function updateNavButtons(seriesId, season, episodeIndex) {
    const totalEpisodes = shared.appState.content.seriesEpisodes[seriesId][season].length;
    const prevBtn = shared.DOM.seriesPlayerModal.querySelector(`#prev-btn-${seriesId}`);
    const nextBtn = shared.DOM.seriesPlayerModal.querySelector(`#next-btn-${seriesId}`);
    
    if (prevBtn) prevBtn.disabled = (episodeIndex === 0);
    if (nextBtn) nextBtn.disabled = (episodeIndex === totalEpisodes - 1);
}

function changeLanguage(seriesId, lang) {
    shared.appState.player.state[seriesId].lang = lang;
    
    try {
        let prefs = JSON.parse(localStorage.getItem('seriesLangPrefs')) || {};
        prefs[seriesId] = lang;
        localStorage.setItem('seriesLangPrefs', JSON.stringify(prefs));
    } catch(e) { console.warn("No se pudo guardar el idioma"); }

    const { season, episodeIndex } = shared.appState.player.state[seriesId];
    openEpisode(seriesId, season, episodeIndex);
}

// 6. REPRODUCTOR DE PELÍCULAS
export function openPlayerModal(movieId, movieTitle) {
    try {
        shared.closeAllModals();
        const movieData = findContentData(movieId);

        if (!movieData || (movieData.estado && movieData.estado.toLowerCase() === 'vetada')) {
            shared.ErrorHandler.show(shared.ErrorHandler.types.CONTENT, 'Película no disponible.');
            return;
        }

        shared.DOM.cinemaModal.classList.add('show');
        document.body.classList.add('modal-open');

        const tracks = getLangTracks(movieData);
        if (tracks.length > 0) {
            loadMovieInPlayer(tracks[0].id, movieId, movieData);
        }

        setupMovieControls(movieId, movieData);
    } catch (e) {
        logError(e, 'Player: Open Modal');
    }
}

function loadMovieInPlayer(videoId, movieId, movieData) {
    const screenDiv = shared.DOM.cinemaModal.querySelector('.screen') || shared.DOM.cinemaModal.querySelector('.video-container');
    if (!screenDiv) return;

    const iframe = screenDiv.querySelector('iframe');
    if (iframe) iframe.remove();
    
    let container = screenDiv.querySelector('.artplayer-container');
    if (!container) {
        container = document.createElement('div');
        container.className   = 'artplayer-container';
        container.style.width  = '100%';
        container.style.height = '100%';
        container.style.background = '#000';
        screenDiv.appendChild(container);
    }

    if (shared.appState.player.activeCineInstance) {
        shared.appState.player.activeCineInstance.destroy();
    }
    
    shared.appState.player.activeCineInstance = new CinePlayer(container);

    // ✅ Extraer subId y subType de la película usando ContentManager
    const { subId, subType } = ContentManager.getSubtitleConfig(movieData);

    shared.appState.player.activeCineInstance.load({
        videoId,
        subId,     // ID de Drive del subtítulo
        subType,   // 'srt' → nativo | 'ass' → WASM
        title:  movieData.title  || '',
        poster: movieData.poster || movieData.image || ''
    });
}

function setupMovieControls(movieId, movieData) {
    const cinemaControls = shared.DOM.cinemaModal.querySelector('.cinema-controls');
    if (!cinemaControls) return;
    
    let controlsHTML = '';
    const user = shared.auth.currentUser;
    
    if (user) {
        const isInList    = shared.appState.user.watchlist.has(movieId);
        const iconClass   = isInList ? 'fa-check' : 'fa-plus';
        const buttonClass = isInList ? 'btn-watchlist in-list' : 'btn-watchlist';
        controlsHTML += `
            <button class="${buttonClass}" data-content-id="${movieId}">
                <i class="fas ${iconClass}"></i> 
                ${isInList ? 'En Mi Lista' : 'Agregar a Mi Lista'}
            </button>
        `;
    }
    
    controlsHTML += `
        <button class="btn-review" data-content-id="${movieId}" data-type="movie">
            <i class="fas fa-star"></i> 
            Escribir Reseña
        </button>
    `;
    
    cinemaControls.innerHTML = controlsHTML;
    
    const reviewBtn = cinemaControls.querySelector('.btn-review');
    if (reviewBtn) {
        reviewBtn.addEventListener('click', () => {
            if (typeof window.openSmartReviewModal === 'function') {
                window.openSmartReviewModal(movieId, 'movie', movieData.title);
            } else {
                console.error("Error: window.openSmartReviewModal no está definida en script.js");
            }
        });
    }
}

export function playRandomEpisode(seriesId) {
    const episodesData = shared.appState.content.seriesEpisodes[seriesId];
    if (!episodesData) {
        shared.ErrorHandler.show('content', 'No hay episodios disponibles para esta serie.');
        return;
    }

    const allEpisodes = Object.entries(episodesData).flatMap(([seasonKey, episodes]) =>
        episodes.map((ep, index) => ({ ...ep, season: seasonKey, index: index }))
    );

    if (allEpisodes.length === 0) {
        shared.ErrorHandler.show('content', 'No se encontraron episodios registrados.');
        return;
    }

    const randomEpisode = allEpisodes[Math.floor(Math.random() * allEpisodes.length)];
    if (typeof openPlayerToEpisode === 'function') {
        shared.closeAllModals(); 
        openPlayerToEpisode(seriesId, randomEpisode.season, randomEpisode.index);
    }
}

export function openSeriesPlayerDirectlyToSeason(seriesId, seasonNum) {
    const seriesInfo = findContentData(seriesId); 
    if (!seriesInfo) return;

    shared.closeAllModals();
    _openSeriesPlayerPage();
    renderEpisodePlayer(seriesId, seasonNum);
}

export function openPlayerToEpisode(seriesId, seasonNum, episodeIndex) {
    const seriesInfo = findContentData(seriesId);
    if (!seriesInfo) return;
    
    shared.closeAllModals();
    _openSeriesPlayerPage();
    renderEpisodePlayer(seriesId, seasonNum, episodeIndex);
}

function calculateFinishTime(durationStr) {
    if (!durationStr) return null;
    
    let hours = 0, minutes = 0, seconds = 0;
    
    durationStr = durationStr.toString().trim();

    if (durationStr.includes(':')) {
        const parts = durationStr.split(':').map(Number);
        if      (parts.length === 3)  { [hours, minutes, seconds] = parts; }
        else if (parts.length === 2)  { if (parts[0] > 7) { [minutes, seconds] = parts; } else { [hours, minutes] = parts; } }
    } else {
        const hMatch = durationStr.match(/(\d+)\s*h/);
        const mMatch = durationStr.match(/(\d+)\s*m/);
        if (hMatch) hours   = parseInt(hMatch[1]);
        if (mMatch) minutes = parseInt(mMatch[1]);
        if (!hMatch && !mMatch && durationStr.includes('min')) {
            const minOnly = parseInt(durationStr);
            if (!isNaN(minOnly)) minutes = minOnly;
        }
    }

    const now        = new Date();
    const durationMs = (hours * 3600000) + (minutes * 60000) + (seconds * 1000);
    const endTime    = new Date(now.getTime() + durationMs);

    return endTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}
