(function() {
    function ticksToMs(ticks) {
        if (ticks === undefined || ticks === null) {
            return null;
        }
        return Math.floor(Number(ticks) / 10000);
    }

    function isIntroSegment(segment) {
        const type = segment?.Type ?? segment?.SegmentType;
        return type === 'Intro' || type === 5 || String(type).toLowerCase() === 'intro';
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

    function seekPastIntroChapter(playbackManager, item, player, mediaSource) {
        const chapters = mediaSource?.Chapters || item?.Chapters;
        if (!Array.isArray(chapters)) {
            return false;
        }

        const introIndex = chapters.findIndex((chapter) => /intro/i.test(chapter.Name || ''));
        if (introIndex < 0) {
            return false;
        }

        const introChapter = chapters[introIndex];
        let endMs = ticksToMs(introChapter.EndPositionTicks);
        if (endMs === null && introIndex + 1 < chapters.length) {
            endMs = ticksToMs(chapters[introIndex + 1].StartPositionTicks);
        }

        if (endMs === null) {
            return false;
        }

        return seekPlayback(playbackManager, endMs, player);
    }

    async function seekPastIntroSegment(playbackManager, item, player) {
        const apiClient = window.ApiClient;
        if (!apiClient?.getJSON || !item?.Id) {
            return false;
        }

        try {
            const response = await apiClient.getJSON(
                apiClient.getUrl(`MediaSegments/${item.Id}`, { IncludeSegmentTypes: 'Intro' })
            );
            const segments = response?.Items || response || [];
            const intro = Array.isArray(segments)
                ? segments.find(isIntroSegment)
                : null;
            const endMs = ticksToMs(intro?.EndTicks || intro?.EndPositionTicks);
            if (endMs === null) {
                return false;
            }
            return seekPlayback(playbackManager, endMs, player);
        } catch (error) {
            console.warn('Abyssfin: MediaSegments intro skip failed', error);
            return false;
        }
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
            if (!playbackManager) {
                return false;
            }

            if (clickSkipIntroButton()) {
                return true;
            }

            const player = playbackManager._currentPlayer;
            const state = playbackManager.getPlayerState();
            const item = state?.NowPlayingItem;
            if (!item) {
                return false;
            }

            const mediaSource = playbackManager._currentMediaSource
                || player?._mediaSource
                || player?._currentMediaSource;

            const embeddedSegments = mediaSource?.MediaSegments || item.MediaSegments;
            if (Array.isArray(embeddedSegments)) {
                const intro = embeddedSegments.find(isIntroSegment);
                const endMs = ticksToMs(intro?.EndTicks || intro?.EndPositionTicks);
                if (endMs !== null && seekPlayback(playbackManager, endMs, player)) {
                    return true;
                }
            }

            if (seekPastIntroChapter(playbackManager, item, player, mediaSource)) {
                return true;
            }

            void seekPastIntroSegment(playbackManager, item, player);
            return false;
        }
    };
})();
