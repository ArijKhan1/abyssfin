(function() {
    const OFFLINE_LIBRARY_URL = 'qrc:///web-client/extension/offline-library.html';

    function getApiClient() {
        return window.ApiClient;
    }

    function getServerBase() {
        const apiClient = getApiClient();
        return apiClient?.serverAddress?.() || window.jmpInfo?.settings?.main?.userWebClient || '';
    }

    function getAccessToken() {
        const apiClient = getApiClient();
        return apiClient?.accessToken?.() || '';
    }

    function getCurrentItem() {
        const pm = window.playbackManager;
        const state = pm?.getPlayerState?.();
        return state?.NowPlayingItem || null;
    }

    function getCurrentMediaSource() {
        const pm = window.playbackManager;
        return pm?._currentMediaSource || pm?._currentPlayer?._mediaSource || null;
    }

    let offlinePlayInFlight = false;

    function whenDomReady(callback) {
        if (window.abyssfinDom?.whenReady)
            return window.abyssfinDom.whenReady(callback);
        if (document.body)
            callback();
        else if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        else
            window.setTimeout(callback, 0);
    }

    function ensureToastHost() {
        let host = document.getElementById('abyssfin-download-toasts');
        if (host)
            return host;
        if (!document.body)
            return null;
        host = document.createElement('div');
        host.id = 'abyssfin-download-toasts';
        host.className = 'download-toast-host';
        document.body.appendChild(host);
        return host;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function showToast(title, message, kind) {
        whenDomReady(() => {
            const host = ensureToastHost();
            if (!host)
                return;
            const toast = document.createElement('div');
            toast.className = 'download-toast' + (kind ? ` ${kind}` : '');
            toast.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message || '')}`;
            host.appendChild(toast);
            window.setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(8px)';
                toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                window.setTimeout(() => toast.remove(), 260);
            }, kind === 'error' ? 6000 : 4200);
        });
    }

    async function downloadItem(item, mediaSource) {
        const api = await window.apiPromise;
        const accessToken = getAccessToken();
        const serverUrl = getServerBase();

        if (!item?.Id || !accessToken || !serverUrl) {
            window.alert('Connect to your Jellyfin server before downloading.');
            return;
        }

        if (item.Type !== 'Movie' && item.Type !== 'Episode') {
            window.alert('Only movies and individual episodes can be downloaded for offline viewing.');
            return;
        }

        api.download.startDownload({
            item,
            mediaSource: mediaSource || item.MediaSources?.[0] || null,
            accessToken,
            serverUrl
        });
    }

    function injectDownloadButtonStyles() {
        if (document.getElementById('abyssfin-download-styles'))
            return;
        const style = document.createElement('style');
        style.id = 'abyssfin-download-styles';
        style.textContent = `
            #abyssfin-download-btn {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 2147482000;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 999px;
                padding: 12px 18px;
                background: rgba(16, 16, 26, 0.94);
                color: #fff;
                font: 600 13px/1 system-ui, -apple-system, sans-serif;
                cursor: pointer;
                box-shadow: 0 12px 32px rgba(0,0,0,0.35);
            }
            #abyssfin-download-btn:hover {
                background: rgba(168, 93, 195, 0.42);
            }
            #abyssfin-download-btn.is-active {
                border-color: rgba(168, 93, 195, 0.45);
                box-shadow: 0 0 0 1px rgba(168, 93, 195, 0.18), 0 12px 32px rgba(0,0,0,0.35);
            }
            .download-toast-host {
                position: fixed;
                left: 20px;
                bottom: 76px;
                z-index: 2147483000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            }
            .download-toast {
                min-width: 260px;
                max-width: 360px;
                padding: 12px 14px;
                border-radius: 14px;
                background: rgba(16, 16, 26, 0.94);
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
                color: #fff;
                font: 500 12px/1.45 system-ui, -apple-system, sans-serif;
                pointer-events: auto;
                transition: opacity 0.25s ease, transform 0.25s ease;
            }
            .download-toast strong {
                display: block;
                margin-bottom: 4px;
                font-size: 13px;
            }
            .download-toast.success {
                border-color: rgba(72, 180, 120, 0.35);
            }
            .download-toast.error {
                border-color: rgba(255, 120, 120, 0.35);
            }
        `;
        document.head.appendChild(style);
    }

    function updateDownloadButton(api) {
        const button = document.getElementById('abyssfin-download-btn');
        const dl = window.abyssfinDownload;
        if (!button || !api?.download || !dl)
            return;

        const active = dl.activeCount(api.download);
        const ready = dl.completedCount(api.download);

        if (active > 0) {
            button.classList.add('is-active');
            button.textContent = `Downloading (${active})`;
        } else if (ready > 0) {
            button.classList.remove('is-active');
            button.textContent = `Download for offline · ${ready} saved`;
        } else {
            button.classList.remove('is-active');
            button.textContent = 'Download for offline';
        }
    }

    function injectDownloadButton() {
        if (document.getElementById('abyssfin-download-btn'))
            return;

        injectDownloadButtonStyles();

        const button = document.createElement('button');
        button.id = 'abyssfin-download-btn';
        button.type = 'button';
        button.textContent = 'Download for offline';

        button.addEventListener('click', async () => {
            const item = getCurrentItem();
            const mediaSource = getCurrentMediaSource();
            if (!item) {
                window.alert('Start playing a movie or episode first, then download it for offline viewing.');
                return;
            }
            button.disabled = true;
            try {
                await downloadItem(item, mediaSource);
            } catch (error) {
                console.error('[Abyssfin offline]', error);
                showToast('Download failed', error?.message || 'Something went wrong.', 'error');
            } finally {
                button.disabled = false;
                const api = await window.apiPromise;
                updateDownloadButton(api);
            }
        });

        whenDomReady(() => document.body.appendChild(button));
    }

    function isOfflineLibraryPage() {
        return window.location.href.includes('offline-library.html');
    }

    function waitForPlaybackManager(callback, attempts = 100) {
        if (window.playbackManager) {
            callback(window.playbackManager);
            return;
        }
        if (attempts <= 0)
            return;
        window.setTimeout(() => waitForPlaybackManager(callback, attempts - 1), 200);
    }

    function resolveMpvPlayer(playbackManager) {
        if (window.abyssfinPlayback?.resolveMpvPlayer)
            return window.abyssfinPlayback.resolveMpvPlayer(playbackManager);
        return null;
    }

    function releaseScrollLock() {
        window.abyssfinPlayback?.releaseScrollLock?.();
    }

    function normalizeLocalPath(path) {
        if (window.abyssfinPaths?.normalizeLocalPath)
            return window.abyssfinPaths.normalizeLocalPath(path);
        if (path == null || path === '')
            return '';
        return typeof path === 'string' ? path : String(path);
    }

    function toFileUrl(path) {
        return window.abyssfinPlayback?.toFileUrl?.(path)
            || normalizeLocalPath(path);
    }

    function buildOfflinePlayOptions(itemId, api) {
        const download = api?.download;
        const dl = window.abyssfinDownload;
        if (!download || !itemId)
            return null;

        const mediaPath = normalizeLocalPath(
            dl?.getLocalPath
                ? dl.getLocalPath(download, itemId)
                : (typeof download.getLocalPath === 'function' ? download.getLocalPath(itemId) : '')
        );
        if (!mediaPath)
            return null;

        const playback = dl?.getLocalPlayback
            ? dl.getLocalPlayback(download, itemId)
            : null;
        let item = playback?.metadata;
        if (typeof item === 'string') {
            try {
                item = JSON.parse(item);
            } catch (error) {
                item = null;
            }
        }

        const entries = dl?.listDownloads?.(download) || [];
        const summary = entries.find(row => row.itemId === itemId) || {};

        if (!item || typeof item !== 'object' || !item.Id) {
            item = {
                Id: itemId,
                Name: playback?.title || summary.title || 'Offline video',
                Type: summary.type || 'Episode',
                MediaType: 'Video',
                MediaSources: [{
                    Id: itemId,
                    Path: mediaPath,
                    Container: 'mkv',
                    MediaStreams: []
                }]
            };
        }

        if (!item.MediaType)
            item.MediaType = 'Video';

        if (!item.ServerId) {
            const serverId = window.ApiClient?.serverId?.() || window.ApiClient?._serverInfo?.Id;
            if (serverId)
                item.ServerId = serverId;
        }

        const mediaSource = item.MediaSources?.[0] || {
            Id: itemId,
            Path: mediaPath,
            Container: item.Container || 'mkv',
            MediaStreams: []
        };

        const serverUrl = getServerBase() || window.jmpInfo?.settings?.main?.userWebClient || '';
        const url = toFileUrl(mediaPath);

        return {
            item,
            mediaSource,
            url,
            mediaPath,
            fullscreen: true,
            playerStartPositionTicks: 0,
            autoplay: true,
            mediaType: 'Video',
            type: 'video'
        };
    }

    function buildOfflinePlayUrl(serverUrl, itemId) {
        return serverUrl.replace(/\/$/, '');
    }

    function getPendingPlayItemId(api) {
        if (typeof api?.download?.pendingPlayItemId === 'function') {
            const pending = api.download.pendingPlayItemId();
            if (pending)
                return pending;
        }

        return sessionStorage.getItem('abyssfinPendingPlayItemId') || '';
    }

    function clearPendingPlayItemId(api) {
        if (typeof api?.download?.takePendingPlayItemId === 'function')
            api.download.takePendingPlayItemId();
        sessionStorage.removeItem('abyssfinPendingPlayItemId');
    }

    function queuePendingPlayItem(itemId, api) {
        if (typeof api?.download?.setPendingPlayItemId === 'function')
            api.download.setPendingPlayItemId(itemId);
        sessionStorage.setItem('abyssfinPendingPlayItemId', itemId);
    }

    async function startJellyfinOfflinePlayback(playOptions) {
        const pm = window.playbackManager;
        if (!pm)
            return false;

        playOptions.url = toFileUrl(playOptions.mediaPath);
        playOptions.fullscreen = true;

        if (!playOptions.url) {
            console.warn('[Abyssfin offline] missing local media path');
            releaseScrollLock();
            return false;
        }

        const player = resolveMpvPlayer(pm);
        if (!player?.play) {
            console.warn('[Abyssfin offline] MPV player unavailable');
            return false;
        }

        window.abyssfinPlayback?.attachOfflinePlayer?.(pm, player, playOptions);

        try {
            await Promise.race([
                player.play(playOptions),
                new Promise((_, reject) => {
                    window.setTimeout(() => reject(new Error('offline playback timeout')), 15000);
                })
            ]);
            return true;
        } catch (error) {
            console.warn('[Abyssfin offline] mpv player.play failed', error);
            releaseScrollLock();
            return false;
        }
    }

    async function tryPlayPendingItem(retry = 0) {
        if (offlinePlayInFlight)
            return false;

        const api = await window.apiPromise;
        const itemId = getPendingPlayItemId(api);
        if (!itemId)
            return false;

        if (!window.abyssfinPlayback?.isJellyfinPlaybackReady?.()) {
            if (retry < 120) {
                window.setTimeout(() => { void tryPlayPendingItem(retry + 1); }, 250);
                return false;
            }
            showToast('Playback failed', 'Could not start the Jellyfin player for this download.', 'error');
            clearPendingPlayItemId(api);
            releaseScrollLock();
            return false;
        }

        const playOptions = buildOfflinePlayOptions(itemId, api);
        if (!playOptions) {
            showToast('Playback failed', 'This download is not available on this device.', 'error');
            clearPendingPlayItemId(api);
            releaseScrollLock();
            return false;
        }

        offlinePlayInFlight = true;
        let started = false;
        try {
            started = await startJellyfinOfflinePlayback(playOptions);
        } finally {
            offlinePlayInFlight = false;
        }

        if (!started) {
            if (retry < 120) {
                window.setTimeout(() => { void tryPlayPendingItem(retry + 1); }, 250);
                return false;
            }
            showToast('Playback failed', 'Could not start the Jellyfin player for this download.', 'error');
            clearPendingPlayItemId(api);
            releaseScrollLock();
            return false;
        }

        clearPendingPlayItemId(api);
        console.log('[Abyssfin offline] local playback started for', itemId);
        return true;
    }

    async function playLocalItem(itemId) {
        const api = await window.apiPromise;
        if (!itemId || typeof api?.download?.playLocal !== 'function') {
            showToast('Playback failed', 'Download playback is unavailable.', 'error');
            return false;
        }

        const started = api.download.playLocal(itemId);
        if (!started)
            showToast('Playback failed', 'This download is not available on this device.', 'error');
        return !!started;
    }

    function showPlaybackFailed() {
        showToast('Playback failed', 'This download is not available on this device.', 'error');
    }

    function redirectToOfflineLibraryIfNeeded() {
        if (navigator.onLine)
            return;

        const href = window.location.href;
        if (href.includes('offline-library.html') || href.includes('find-webclient.html'))
            return;

        if (window.abyssfinDownload?.hasDownloads(window.api?.download))
            window.location.href = OFFLINE_LIBRARY_URL;
        else
            window.location.href = 'qrc:///web-client/extension/find-webclient.html';
    }

    window.abyssfinOffline = {
        openLibrary() {
            window.location.href = OFFLINE_LIBRARY_URL;
        },
        playLocalItem(itemId) {
            return playLocalItem(itemId);
        },
        showPlaybackFailed() {
            showPlaybackFailed();
        },
        tryPlayPending() {
            return tryPlayPendingItem();
        },
        downloadCurrentItem() {
            return downloadItem(getCurrentItem(), getCurrentMediaSource());
        },
        async downloadFromUrl(url, suggestedTitle) {
            const api = await window.apiPromise;
            api.download.startDownloadFromJellyfinUrl(
                url,
                suggestedTitle || '',
                getAccessToken()
            );
        }
    };

    window.addEventListener('offline', redirectToOfflineLibraryIfNeeded);

    (async () => {
        const api = await window.apiPromise;
        releaseScrollLock();
        if (!api?.download) {
            console.warn('[Abyssfin offline] download API unavailable');
            return;
        }

        if (!isOfflineLibraryPage()) {
            if (!window.jmpInfo?.nativeDownloadHub)
                injectDownloadButton();
            updateDownloadButton(api);
            redirectToOfflineLibraryIfNeeded();
            waitForPlaybackManager(() => { void tryPlayPendingItem(); });
        }

        if (api.download.downloadsChanged?.connect) {
            api.download.downloadsChanged.connect(() => updateDownloadButton(api));
        }

        if (api.download.downloadProgress?.connect) {
            api.download.downloadProgress.connect(() => {
                updateDownloadButton(api);
            });
        }

        if (api.download.downloadComplete?.connect) {
            api.download.downloadComplete.connect((itemId) => {
                const dl = window.abyssfinDownload;
                const downloads = dl ? dl.listDownloads(api.download) : [];
                const entry = downloads.find(row => row.itemId === itemId) || {};
                showToast('Download complete', `${entry.title || 'Media'} is ready to watch offline.`, 'success');
                updateDownloadButton(api);
            });
        }

        if (api.download.downloadFailed?.connect) {
            api.download.downloadFailed.connect((itemId, error) => {
                showToast('Download failed', error || 'Could not save this item for offline viewing.', 'error');
                updateDownloadButton(api);
            });
        }
    })();
})();
