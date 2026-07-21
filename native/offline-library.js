(function() {
    function readValue(component, name) {
        if (!component)
            return undefined;
        const value = component[name];
        if (typeof value === 'function')
            return value.call(component);
        return value;
    }

    function getBridge() {
        if (window.abyssfinDownload)
            return window.abyssfinDownload;

        return {
            libraryPath(component) {
                return readValue(component, 'libraryPath') || '';
            },
            listDownloads(component) {
                let jsonText = readValue(component, 'downloadsJson');
                if (!jsonText && typeof component?.listDownloadsJson === 'function')
                    jsonText = component.listDownloadsJson();

                if (jsonText) {
                    try {
                        const parsed = JSON.parse(jsonText);
                        if (Array.isArray(parsed))
                            return parsed.map(normalizeEntry).filter(Boolean);
                    } catch (error) {
                        console.warn('[Abyssfin offline-library] downloadsJson parse failed', error);
                    }
                }

                if (typeof component?.listDownloads !== 'function')
                    return [];
                const raw = component.listDownloads();
                return (Array.isArray(raw) ? raw : Array.from(raw))
                    .map(normalizeEntry)
                    .filter(Boolean);
            }
        };
    }

    function normalizeEntry(entry) {
        if (!entry || typeof entry !== 'object')
            return null;

        const status = entry.status || entry.Status || 'downloading';

        const item = entry.item && typeof entry.item === 'object' ? entry.item : {};

        return {
            ...entry,
            itemId: entry.itemId || entry.Id || '',
            title: entry.title || entry.Name || 'Download',
            type: entry.type || item.Type || '',
            seriesName: entry.seriesName || item.SeriesName || '',
            seriesId: entry.seriesId || item.SeriesId || '',
            seasonNumber: Number(entry.seasonNumber ?? item.ParentIndexNumber) || 0,
            episodeNumber: Number(entry.episodeNumber ?? item.IndexNumber) || 0,
            status
        };
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024 * 1024)
            return `${Math.max(1, Math.round(value / 1024))} KB`;
        if (value < 1024 * 1024 * 1024)
            return `${(value / (1024 * 1024)).toFixed(1)} MB`;
        return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function formatDate(iso) {
        if (!iso)
            return '';
        try {
            return new Date(iso).toLocaleString();
        } catch (error) {
            return iso;
        }
    }

    function playDownload(entry) {
        if (window.abyssfinOffline?.playLocalItem)
            return window.abyssfinOffline.playLocalItem(entry.itemId);
        console.error('[Abyssfin offline-library] playLocalItem unavailable');
    }

    function isEpisode(entry) {
        return (entry.type || '').toLowerCase() === 'episode'
            || (entry.seasonNumber > 0 && entry.episodeNumber > 0);
    }

    function episodeLabel(entry) {
        const season = entry.seasonNumber;
        const episode = entry.episodeNumber;
        if (season > 0 && episode > 0) {
            const prefix = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
            const parts = String(entry.title || '').split('—');
            const name = parts.length > 1 ? parts.slice(1).join('—').trim() : '';
            return name ? `${prefix} — ${name}` : prefix;
        }
        return entry.title || 'Episode';
    }

    function groupLibraryEntries(entries) {
        const movies = [];
        const showMap = new Map();

        for (const entry of entries) {
            if (isEpisode(entry) && (entry.seriesId || entry.seriesName)) {
                const key = entry.seriesId || entry.seriesName;
                if (!showMap.has(key)) {
                    showMap.set(key, {
                        seriesId: entry.seriesId,
                        seriesName: entry.seriesName || 'Series',
                        episodes: []
                    });
                }
                showMap.get(key).episodes.push(entry);
            } else {
                movies.push(entry);
            }
        }

        const shows = Array.from(showMap.values()).sort((a, b) =>
            a.seriesName.localeCompare(b.seriesName));

        for (const show of shows) {
            show.episodes.sort((a, b) => {
                const seasonDiff = (a.seasonNumber || 0) - (b.seasonNumber || 0);
                if (seasonDiff !== 0)
                    return seasonDiff;
                return (a.episodeNumber || 0) - (b.episodeNumber || 0);
            });
        }

        movies.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
        return { movies, shows };
    }

    function buildCard(entry, api, options = {}) {
        const card = document.createElement('div');
        card.className = 'card' + (entry.status === 'downloading' ? ' is-downloading' : '');
        if (options.compact)
            card.classList.add('card-compact');

        const meta = document.createElement('div');
        meta.className = 'card-meta';

        const titleRow = document.createElement('div');
        titleRow.className = 'card-title-row';

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = options.displayTitle || entry.title || 'Download';

        const pill = document.createElement('span');
        pill.className = 'status-pill ' + (entry.status === 'downloading' ? 'downloading' : 'ready');
        pill.textContent = entry.status === 'downloading' ? 'Downloading' : 'Ready';

        titleRow.appendChild(title);
        titleRow.appendChild(pill);
        meta.appendChild(titleRow);

        const subtitle = document.createElement('div');
        subtitle.className = 'card-subtitle';

        if (entry.status === 'downloading') {
            const progressTrack = document.createElement('div');
            progressTrack.className = 'progress-track';
            const progressFill = document.createElement('div');
            progressFill.className = 'progress-fill';
            const progress = Number(entry.progress) || 0;
            progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
            progressTrack.appendChild(progressFill);
            meta.appendChild(progressTrack);

            const received = Number(entry.bytesReceived) || 0;
            const total = Number(entry.bytesTotal) || 0;
            subtitle.textContent = total > 0
                ? `${progress}% complete · ${formatBytes(received)} / ${formatBytes(total)}`
                : `Preparing download · ${formatBytes(received)} received`;
        } else {
            subtitle.textContent = `${formatBytes(entry.fileSize)} · Saved ${formatDate(entry.downloadedAt)}`;
        }

        meta.appendChild(subtitle);

        const actions = document.createElement('div');
        actions.className = 'card-actions';

        if (entry.status === 'downloading') {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'cancel-btn';
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', () => {
                api.download.cancelDownload(entry.itemId);
            });
            actions.appendChild(cancelBtn);
        } else {
            const playBtn = document.createElement('button');
            playBtn.className = 'play-btn';
            playBtn.type = 'button';
            playBtn.textContent = 'Play';
            playBtn.addEventListener('click', () => {
                playDownload(entry);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.type = 'button';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', async () => {
                if (!window.confirm(`Delete "${entry.title}" from this device?`))
                    return;
                api.download.deleteDownload(entry.itemId);
            });

            actions.appendChild(playBtn);
            actions.appendChild(deleteBtn);
        }

        card.appendChild(meta);
        card.appendChild(actions);
        return card;
    }

    function buildShowGroup(show, api) {
        const group = document.createElement('div');
        group.className = 'show-group';

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'show-group-header';
        header.setAttribute('aria-expanded', 'true');

        const title = document.createElement('span');
        title.className = 'show-group-title';
        title.textContent = show.seriesName;

        const count = document.createElement('span');
        count.className = 'show-group-count';
        count.textContent = `${show.episodes.length} episode${show.episodes.length === 1 ? '' : 's'}`;

        const chevron = document.createElement('span');
        chevron.className = 'show-group-chevron';
        chevron.textContent = '▾';

        header.appendChild(title);
        header.appendChild(count);
        header.appendChild(chevron);

        const episodes = document.createElement('div');
        episodes.className = 'show-group-episodes';

        for (const entry of show.episodes) {
            episodes.appendChild(buildCard(entry, api, {
                compact: true,
                displayTitle: episodeLabel(entry)
            }));
        }

        header.addEventListener('click', () => {
            const expanded = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
            episodes.hidden = expanded;
            chevron.textContent = expanded ? '▸' : '▾';
        });

        group.appendChild(header);
        group.appendChild(episodes);
        return group;
    }

    function setPanelVisibility({ loading, queue, library, empty, error }) {
        document.getElementById('loading-state').hidden = !loading;
        document.getElementById('queue-section').hidden = !queue;
        document.getElementById('library-section').hidden = !library;
        document.getElementById('empty-state').hidden = !empty;
        document.getElementById('error-state').hidden = !error;
    }

    function showError(message) {
        document.getElementById('error-message').textContent = message;
        setPanelVisibility({ loading: false, queue: false, library: false, empty: false, error: true });
    }

    async function renderDownloads(api) {
        const queueList = document.getElementById('queue-list');
        const libraryList = document.getElementById('download-list');
        const libraryPathEl = document.getElementById('library-path');
        const queueCount = document.getElementById('queue-count');
        const libraryCount = document.getElementById('library-count');
        const statusLine = document.getElementById('status-line');
        const dl = getBridge();

        if (!api?.download) {
            showError('Offline downloads are unavailable in this view. Try restarting Abyssfin.');
            return;
        }

        let downloads = [];
        try {
            downloads = dl.listDownloads(api.download).map(normalizeEntry).filter(Boolean);
        } catch (error) {
            console.error('[Abyssfin offline-library] listDownloads failed', error);
            showError(error?.message || 'Failed to read downloads from this device.');
            return;
        }

        const active = downloads.filter(entry => entry.status === 'downloading');
        const ready = downloads.filter(entry => entry.status === 'complete');

        const path = dl.libraryPath(api.download);
        if (libraryPathEl && path)
            libraryPathEl.textContent = `Stored in: ${path}`;

        queueList.innerHTML = '';
        libraryList.innerHTML = '';

        for (const entry of active)
            queueList.appendChild(buildCard(entry, api));

        const grouped = groupLibraryEntries(ready);
        for (const show of grouped.shows)
            libraryList.appendChild(buildShowGroup(show, api));

        if (grouped.movies.length > 0) {
            if (grouped.shows.length > 0) {
                const moviesHeading = document.createElement('div');
                moviesHeading.className = 'library-subheading';
                moviesHeading.textContent = 'Movies';
                libraryList.appendChild(moviesHeading);
            }
            for (const entry of grouped.movies)
                libraryList.appendChild(buildCard(entry, api));
        }

        queueCount.textContent = `${active.length} active`;
        libraryCount.textContent = `${ready.length} saved`;

        if (downloads.length === 0) {
            statusLine.textContent = navigator.onLine
                ? 'No downloads saved yet on this device.'
                : 'You are offline. Save downloads while online to watch them here.';
            setPanelVisibility({ loading: false, queue: false, library: false, empty: true, error: false });
            return;
        }

        statusLine.textContent = navigator.onLine
            ? `${ready.length} ready · ${active.length} downloading · files are saved on this device.`
            : `You are offline. ${ready.length} download(s) are available on this device.`;

        setPanelVisibility({
            loading: false,
            queue: active.length > 0,
            library: ready.length > 0,
            empty: false,
            error: false
        });
    }

    (async () => {
        try {
            const api = await window.apiPromise;
            window.abyssfinPlayback?.releaseScrollLock?.();
            const statusLine = document.getElementById('status-line');
            statusLine.textContent = 'Loading your downloads…';

            document.getElementById('back-online').addEventListener('click', () => {
                const savedServer = window.jmpInfo?.settings?.main?.userWebClient;
                if (savedServer && navigator.onLine)
                    window.location.href = savedServer;
                else
                    window.location.href = 'qrc:///web-client/extension/find-webclient.html';
            });

            document.getElementById('refresh-downloads').addEventListener('click', () => renderDownloads(api));

            if (api.download.downloadsChanged?.connect)
                api.download.downloadsChanged.connect(() => renderDownloads(api));

            let progressRenderTimer = null;
            if (api.download.downloadProgress?.connect) {
                api.download.downloadProgress.connect(() => {
                    if (progressRenderTimer)
                        return;
                    progressRenderTimer = window.setTimeout(() => {
                        progressRenderTimer = null;
                        renderDownloads(api);
                    }, 500);
                });
            }

            await renderDownloads(api);
        } catch (error) {
            console.error('[Abyssfin offline-library]', error);
            showError(error?.message || 'Failed to load offline downloads.');
        }
    })();
})();
