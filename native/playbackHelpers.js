(function() {
    function ticksToMs(ticks) {
        if (ticks === undefined || ticks === null) {
            return null;
        }
        return Math.floor(Number(ticks) / 10000);
    }

    function segmentTypeName(segment) {
        const type = segment?.Type ?? segment?.SegmentType;
        if (typeof type === 'number') {
            const names = ['unknown', 'commercial', 'preview', 'recap', 'outro', 'intro'];
            return names[type] || 'unknown';
        }
        return String(type || '').toLowerCase();
    }

    function isIntroSegment(segment) {
        return segmentTypeName(segment) === 'intro';
    }

    function isOutroSegment(segment) {
        const name = segmentTypeName(segment);
        return name === 'outro' || name === 'credits' || name === 'ending';
    }

    function isRecapSegment(segment) {
        return segmentTypeName(segment) === 'recap';
    }

    function segmentBoundsMs(segment) {
        if (!segment)
            return null;
        const startMs = ticksToMs(segment.StartTicks ?? segment.StartPositionTicks ?? segment.Start);
        const endMs = ticksToMs(segment.EndTicks ?? segment.EndPositionTicks ?? segment.End);
        if (endMs === null)
            return null;
        return { startMs: startMs == null ? 0 : startMs, endMs };
    }

    function seekPlayback(playbackManager, positionMs, player) {
        const duration = playbackManager.duration();
        if (!duration) {
            return false;
        }
        const percent = (positionMs * 10000) / duration * 100;
        playbackManager.seekPercent(percent, player || playbackManager._currentPlayer);
        return true;
    }

    function clickSkipIntroButton() {
        const skipSelectors = [
            '.btnSkipIntro',
            '.buttonSkipIntro',
            '.skip-intro-button',
            '[data-action="skip-intro"]',
            'button[class*="skip" i][class*="intro" i]'
        ];

        for (const selector of skipSelectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null && !btn.disabled) {
                btn.click();
                return true;
            }
        }
        return false;
    }

    function chapterMatches(chapter, pattern) {
        return pattern.test(chapter?.Name || '');
    }

    function seekPastMatchingChapter(playbackManager, item, player, mediaSource, pattern) {
        const chapters = mediaSource?.Chapters || item?.Chapters;
        if (!Array.isArray(chapters)) {
            return false;
        }

        const matchIndex = chapters.findIndex((chapter) => chapterMatches(chapter, pattern));
        if (matchIndex < 0) {
            return false;
        }

        const chapter = chapters[matchIndex];
        let endMs = ticksToMs(chapter.EndPositionTicks);
        if (endMs === null && matchIndex + 1 < chapters.length) {
            endMs = ticksToMs(chapters[matchIndex + 1].StartPositionTicks);
        }

        if (endMs === null) {
            return false;
        }

        return seekPlayback(playbackManager, endMs, player);
    }

    function seekPastIntroChapter(playbackManager, item, player, mediaSource) {
        return seekPastMatchingChapter(playbackManager, item, player, mediaSource, /intro/i);
    }

    function collectEmbeddedSegments(item, mediaSource) {
        const embedded = mediaSource?.MediaSegments || item?.MediaSegments;
        return Array.isArray(embedded) ? embedded : [];
    }

    async function fetchMediaSegments(item) {
        const apiClient = window.ApiClient;
        if (!apiClient?.getJSON || !item?.Id) {
            return [];
        }

        try {
            const response = await apiClient.getJSON(
                apiClient.getUrl(`MediaSegments/${item.Id}`)
            );
            const segments = response?.Items || response || [];
            return Array.isArray(segments) ? segments : [];
        } catch (error) {
            console.warn('Abyssfin: MediaSegments fetch failed', error);
            return [];
        }
    }

    function skipEmbeddedSegment(playbackManager, item, player, mediaSource, predicate) {
        const match = collectEmbeddedSegments(item, mediaSource).find(predicate);
        const bounds = segmentBoundsMs(match);
        if (!bounds)
            return false;
        return seekPlayback(playbackManager, bounds.endMs, player);
    }

    async function seekPastNamedSegment(playbackManager, item, player, predicate) {
        const segments = await fetchMediaSegments(item);
        const match = segments.find(predicate);
        const bounds = segmentBoundsMs(match);
        if (!bounds)
            return false;
        return seekPlayback(playbackManager, bounds.endMs, player);
    }

    function currentPlaybackContext(playbackManager) {
        if (!playbackManager)
            return null;
        const player = playbackManager._currentPlayer;
        const state = typeof playbackManager.getPlayerState === 'function'
            ? playbackManager.getPlayerState()
            : null;
        const item = state?.NowPlayingItem;
        if (!item)
            return null;
        const mediaSource = playbackManager._currentMediaSource
            || player?._mediaSource
            || player?._currentMediaSource
            || player?._currentPlayOptions?.mediaSource;
        return { player, item, mediaSource, state };
    }

    function skipByKind(playbackManager, kind) {
        const context = currentPlaybackContext(playbackManager);
        if (!context)
            return false;

        const { player, item, mediaSource } = context;
        const predicates = {
            intro: { match: isIntroSegment, chapter: /intro/i, button: clickSkipIntroButton },
            recap: { match: isRecapSegment, chapter: /recap/i, button: null },
            credits: { match: isOutroSegment, chapter: /(credit|outro|ending)/i, button: clickSkipCreditsButton }
        };
        const spec = predicates[kind];
        if (!spec)
            return false;

        if (spec.button && spec.button())
            return true;
        if (skipEmbeddedSegment(playbackManager, item, player, mediaSource, spec.match))
            return true;
        if (seekPastMatchingChapter(playbackManager, item, player, mediaSource, spec.chapter))
            return true;
        void seekPastNamedSegment(playbackManager, item, player, spec.match);
        return false;
    }

    function clickSkipCreditsButton() {
        const skipSelectors = [
            '.btnSkipCredits',
            '.buttonSkipOutro',
            '.skip-credits-button',
            '[data-action="skip-credits"]',
            'button[class*="skip" i][class*="credit" i]',
            'button[class*="skip" i][class*="outro" i]'
        ];

        for (const selector of skipSelectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null && !btn.disabled) {
                btn.click();
                return true;
            }
        }
        return false;
    }

    function releaseScrollLock() {
        document.body?.classList.remove('hide-scroll');
    }

    function resolveMpvPlayer(playbackManager) {
        if (!playbackManager)
            return null;

        if (typeof playbackManager.getPlayers === 'function') {
            const players = playbackManager.getPlayers() || [];
            const found = players.find(player => player?.id === 'mpvvideoplayer');
            if (found)
                return found;
        }

        if (playbackManager._currentPlayer?.id === 'mpvvideoplayer')
            return playbackManager._currentPlayer;

        return null;
    }

    function isMpvBackendReady() {
        const player = window.api?.player;
        if (!player)
            return false;
        if (typeof player.isMpvReady === 'function')
            return !!player.isMpvReady();
        const ready = player.mpvReady;
        return ready === true || ready === 1;
    }

    function isJellyfinPlaybackReady() {
        return Boolean(
            window.playbackManager
            && window.api?.player
            && isMpvBackendReady()
            && resolveMpvPlayer(window.playbackManager)
        );
    }

    function toFileUrl(path) {
        const normalizedPath = window.abyssfinPaths?.normalizeLocalPath
            ? window.abyssfinPaths.normalizeLocalPath(path)
            : (path == null ? '' : String(path));
        if (!normalizedPath)
            return '';
        if (normalizedPath.startsWith('file://'))
            return normalizedPath;
        const slashPath = normalizedPath.replace(/\\/g, '/');
        return 'file://' + encodeURI(slashPath).replace(/#/g, '%23');
    }

    function attachOfflinePlayer(playbackManager, player, playOptions) {
        if (!playbackManager || !player || !playOptions)
            return;

        playbackManager._currentPlayer = player;
        playbackManager._currentMediaSource = playOptions.mediaSource;
    }

    function buildStreamHeaders() {
        const headers = { 'User-Agent': jmpInfo.userAgent };
        const token = window.ApiClient?.accessToken?.() || '';
        if (token) {
            headers['X-Emby-Token'] = token;
        }
        const serverUrl = window.ApiClient?.serverAddress?.() || '';
        if (serverUrl) {
            headers['Referer'] = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
        }
        return headers;
    }

    window.abyssfinPlayback = {
        releaseScrollLock,
        isJellyfinPlaybackReady,
        toFileUrl,
        resolveMpvPlayer,
        attachOfflinePlayer,
        buildStreamHeaders,
        skipIntro(playbackManager) {
            return skipByKind(playbackManager, 'intro');
        },
        skipCredits(playbackManager) {
            return skipByKind(playbackManager, 'credits');
        },
        skipRecap(playbackManager) {
            return skipByKind(playbackManager, 'recap');
        },
        currentPlaybackContext,
        fetchMediaSegments,
        collectEmbeddedSegments,
        segmentBoundsMs,
        isIntroSegment,
        isOutroSegment,
        isRecapSegment,
        ticksToMs
    };
})();
