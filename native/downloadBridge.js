(function() {
    function whenDomReady(callback) {
        if (document.body)
            callback();
        else if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        else
            window.setTimeout(callback, 0);
    }

    window.abyssfinDom = { whenReady: whenDomReady };

    function normalizeLocalPath(path) {
        if (path == null || path === '')
            return '';
        if (typeof path === 'string') {
            if (path === '[object Object]')
                return '';
            return path;
        }
        if (typeof path === 'object') {
            if (typeof path.mediaPath === 'string')
                return path.mediaPath;
            if (typeof path.path === 'string')
                return path.path;
            if (typeof path.toString === 'function') {
                const text = path.toString();
                if (text && text !== '[object Object]')
                    return text;
            }
        }
        const text = String(path);
        return text === '[object Object]' ? '' : text;
    }

    window.abyssfinPaths = { normalizeLocalPath };

    function readValue(component, name) {
        if (!component)
            return undefined;
        const value = component[name];
        if (typeof value === 'function')
            return value.call(component);
        return value;
    }

    function normalizeList(raw) {
        if (!raw)
            return [];
        if (Array.isArray(raw))
            return raw;
        if (typeof raw.length === 'number')
            return Array.from(raw);
        return [];
    }

    function normalizeEntry(entry) {
        if (!entry || typeof entry !== 'object')
            return null;

        const status = entry.status || entry.Status || 'downloading';

        return {
            ...entry,
            itemId: entry.itemId || entry.Id || '',
            title: entry.title || entry.Name || 'Download',
            type: entry.type || entry.Type || '',
            seriesName: entry.seriesName || entry.SeriesName || '',
            seriesId: entry.seriesId || entry.SeriesId || '',
            seasonNumber: Number(entry.seasonNumber ?? entry.ParentIndexNumber) || 0,
            episodeNumber: Number(entry.episodeNumber ?? entry.IndexNumber) || 0,
            status
        };
    }

    window.abyssfinDownload = {
        libraryPath(component) {
            return readValue(component, 'libraryPath') || '';
        },
        activeCount(component) {
            return Number(readValue(component, 'activeDownloadCount')) || 0;
        },
        completedCount(component) {
            return Number(readValue(component, 'completedDownloadCount')) || 0;
        },
        hasDownloads(component) {
            if (typeof component?.hasDownloads === 'function')
                return component.hasDownloads();
            return this.completedCount(component) > 0;
        },
        getLocalPath(component, itemId) {
            if (!component || !itemId)
                return '';
            if (typeof component.getLocalPath !== 'function')
                return '';
            return normalizeLocalPath(component.getLocalPath(itemId));
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
                    console.warn('[Abyssfin downloadBridge] downloadsJson parse failed', error);
                }
            }

            if (typeof component?.listDownloads !== 'function')
                return [];

            return normalizeList(component.listDownloads())
                .map(normalizeEntry)
                .filter(Boolean);
        },
        getLocalPlayback(component, itemId) {
            if (!component || !itemId)
                return null;

            const mediaPath = this.getLocalPath(component, itemId);
            if (!mediaPath)
                return null;

            let jsonText = '';
            if (typeof component.getLocalPlaybackJson === 'function')
                jsonText = component.getLocalPlaybackJson(itemId);

            if (jsonText) {
                try {
                    const parsed = JSON.parse(jsonText);
                    if (parsed && typeof parsed === 'object') {
                        parsed.mediaPath = normalizeLocalPath(parsed.mediaPath);
                        if (parsed.metadata)
                            return parsed;
                    }
                } catch (error) {
                    console.warn('[Abyssfin downloadBridge] getLocalPlaybackJson parse failed', error);
                }
            }

            if (typeof component.getLocalPlayback === 'function') {
                const playback = component.getLocalPlayback(itemId);
                if (playback && typeof playback === 'object') {
                    playback.mediaPath = playback.mediaPath || mediaPath;
                    if (playback.metadata)
                        return playback;
                }
            }

            return { mediaPath };
        }
    };
})();
