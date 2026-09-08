(function() {
    const SKIP_MARGIN_MS = 400;
    const CREDITS_FALLBACK_MS = 25000;
    const SLEEP_FADE_MS = 15000;
    const SLEEP_CYCLE = ['off', '15', '30', '45', '60', 'episode'];

    const skipped = {
        intro: new Set(),
        recap: new Set(),
        credits: new Set(),
        prompt: new Set()
    };
    const segmentCache = new Map();
    let activeItemId = '';
    let lyrics = [];
    let lyricsPlain = '';
    let lyricsVisible = true;
    let sleepDeadline = 0;
    let sleepEpisode = false;
    let sleepFading = false;
    let savedVolume = null;
    let lastSleepMode = '';
    let overlayHost = null;
    let promptHost = null;
    let lyricsHost = null;
    let sleepHost = null;
    let toastTimer = null;

    function watchSettings() {
        return window.jmpInfo?.settings?.watch || {};
    }

    function settingOn(key, fallback) {
        const value = watchSettings()[key];
        if (value === undefined || value === null)
            return fallback;
        return value;
    }

    function ensureStyle() {
        if (document.getElementById('abyssfin-watch-style'))
            return;
        const style = document.createElement('style');
        style.id = 'abyssfin-watch-style';
        style.textContent = `
            .abyssfin-watch-toast,
            .abyssfin-watch-prompt,
            .abyssfin-watch-lyrics,
            .abyssfin-watch-sleep {
                font-family: inherit;
                pointer-events: none;
                z-index: 99999;
            }
            .abyssfin-watch-toast {
                position: fixed;
                left: 50%;
                bottom: 18%;
                transform: translateX(-50%);
                background: rgba(22, 22, 34, 0.92);
                color: #fff;
                border: 1px solid rgba(168, 93, 195, 0.45);
                border-radius: 14px;
                padding: 10px 16px;
                font-size: 14px;
            }
            .abyssfin-watch-prompt {
                position: fixed;
                right: 28px;
                bottom: 92px;
                pointer-events: auto;
                background: rgba(22, 22, 34, 0.94);
                color: #fff;
                border: 1px solid rgba(168, 93, 195, 0.4);
                border-radius: 16px;
                padding: 14px 16px;
                min-width: 240px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
            }
            .abyssfin-watch-prompt h3 {
                margin: 0 0 6px;
                font-size: 15px;
            }
            .abyssfin-watch-prompt p {
                margin: 0 0 12px;
                color: rgba(255, 255, 255, 0.7);
                font-size: 12px;
            }
            .abyssfin-watch-prompt .row {
                display: flex;
                gap: 8px;
            }
            .abyssfin-watch-prompt button {
                pointer-events: auto;
                flex: 1;
                border: 0;
                border-radius: 10px;
                padding: 8px 10px;
                background: rgba(168, 93, 195, 0.28);
                color: #fff;
                cursor: pointer;
            }
            .abyssfin-watch-prompt button.primary {
                background: #A85DC3;
            }
            .abyssfin-watch-lyrics {
                position: fixed;
                left: 50%;
                bottom: 11%;
                transform: translateX(-50%);
                max-width: min(720px, 80vw);
                text-align: center;
                color: #fff;
                text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
                font-size: 22px;
                line-height: 1.35;
            }
            .abyssfin-watch-lyrics .next {
                display: block;
                margin-top: 6px;
                font-size: 14px;
                color: rgba(255, 255, 255, 0.55);
            }
            .abyssfin-watch-sleep {
                position: fixed;
                top: 18px;
                right: 18px;
                background: rgba(22, 22, 34, 0.88);
                color: #D8A8F0;
                border-radius: 999px;
                padding: 6px 12px;
                font-size: 12px;
                border: 1px solid rgba(168, 93, 195, 0.35);
            }
            .abyssfin-theme-btn {
                margin-left: 8px;
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(text) {
        ensureStyle();
        if (!overlayHost) {
            overlayHost = document.createElement('div');
            overlayHost.className = 'abyssfin-watch-toast';
            document.body.appendChild(overlayHost);
        }
        overlayHost.textContent = text;
        overlayHost.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            if (overlayHost)
                overlayHost.style.display = 'none';
        }, 2800);
    }

    function hidePrompt() {
        if (promptHost)
            promptHost.style.display = 'none';
    }

    function showPrompt(item) {
        ensureStyle();
        if (!promptHost) {
            promptHost = document.createElement('div');
            promptHost.className = 'abyssfin-watch-prompt';
            promptHost.innerHTML = `
                <h3>Credits</h3>
                <p>Intro Skipper found an ending segment. Jump to the next episode or stay?</p>
                <div class="row">
                    <button class="primary" data-act="next">Next episode</button>
                    <button data-act="stay">Stay</button>
                </div>`;
            promptHost.addEventListener('click', (event) => {
                const act = event.target?.getAttribute?.('data-act');
                if (act === 'next')
                    playNextEpisode();
                if (act === 'stay' || act === 'next')
                    hidePrompt();
            });
            document.body.appendChild(promptHost);
        }
        const name = item?.Name ? ` after ${item.Name}` : '';
        promptHost.querySelector('p').textContent =
            `Ending detected${name}. Next episode uses your current queue.`;
        promptHost.style.display = 'block';
    }

    function setLyricsText(current, next) {
        ensureStyle();
        if (!lyricsHost) {
            lyricsHost = document.createElement('div');
            lyricsHost.className = 'abyssfin-watch-lyrics';
            document.body.appendChild(lyricsHost);
        }
        if (!lyricsVisible || (!current && !lyricsPlain)) {
            lyricsHost.style.display = 'none';
            return;
        }
        lyricsHost.style.display = 'block';
        lyricsHost.innerHTML = current
            ? `${escapeHtml(current)}${next ? `<span class="next">${escapeHtml(next)}</span>` : ''}`
            : escapeHtml(lyricsPlain);
    }

    function setSleepLabel(text) {
        ensureStyle();
        if (!sleepHost) {
            sleepHost = document.createElement('div');
            sleepHost.className = 'abyssfin-watch-sleep';
            document.body.appendChild(sleepHost);
        }
        if (!text) {
            sleepHost.style.display = 'none';
            return;
        }
        sleepHost.style.display = 'block';
        sleepHost.textContent = text;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function playbackManager() {
        return window.playbackManager;
    }

    function playNextEpisode() {
        const manager = playbackManager();
        const player = manager?._currentPlayer;
        if (manager && player && typeof manager.nextTrack === 'function')
            manager.nextTrack(player);
    }

    function currentItem() {
        return window.abyssfinPlayback?.currentPlaybackContext?.(playbackManager())?.item || null;
    }

    function currentMediaSource() {
        return window.abyssfinPlayback?.currentPlaybackContext?.(playbackManager())?.mediaSource || null;
    }

    function positionMs() {
        const manager = playbackManager();
        if (!manager || typeof manager.currentTime !== 'function')
            return 0;
        return Number(manager.currentTime()) || 0;
    }

    function durationMs() {
        const manager = playbackManager();
        const ticks = manager?.duration?.();
        if (!ticks)
            return 0;
        return ticks / 10000;
    }

    function isAudioItem(item) {
        return item?.MediaType === 'Audio' || item?.Type === 'Audio';
    }

    async function segmentsFor(item) {
        if (!item?.Id)
            return [];
        if (segmentCache.has(item.Id))
            return segmentCache.get(item.Id);
        const embedded = window.abyssfinPlayback?.collectEmbeddedSegments?.(item, currentMediaSource()) || [];
        const remote = await window.abyssfinPlayback.fetchMediaSegments(item);
        const merged = [...embedded, ...remote];
        segmentCache.set(item.Id, merged);
        return merged;
    }

    function inBounds(position, bounds) {
        return bounds && position >= bounds.startMs - SKIP_MARGIN_MS && position < bounds.endMs - SKIP_MARGIN_MS;
    }

    async function maybeAutoSkip(item) {
        if (!item?.Id || isAudioItem(item))
            return;
        const helpers = window.abyssfinPlayback;
        const segs = await segmentsFor(item);
        const pos = positionMs();
        const settings = watchSettings();

        if (settings.autoSkipRecap && !skipped.recap.has(item.Id)) {
            const recap = segs.find(helpers.isRecapSegment);
            if (inBounds(pos, helpers.segmentBoundsMs(recap))) {
                skipped.recap.add(item.Id);
                helpers.skipRecap(playbackManager());
                showToast('Skipped recap');
                return;
            }
        }

        if (settings.autoSkipIntro && !skipped.intro.has(item.Id)) {
            const intro = segs.find(helpers.isIntroSegment);
            if (inBounds(pos, helpers.segmentBoundsMs(intro))) {
                skipped.intro.add(item.Id);
                helpers.skipIntro(playbackManager());
                showToast('Skipped intro');
                return;
            }
        }

        const outro = segs.find(helpers.isOutroSegment);
        const outroBounds = helpers.segmentBoundsMs(outro);
        const nearEnd = durationMs() > 0 && durationMs() - pos <= CREDITS_FALLBACK_MS;
        const inCredits = inBounds(pos, outroBounds) || (!outroBounds && settings.promptNextEpisode && nearEnd);

        if (inCredits && !skipped.credits.has(item.Id)) {
            if (settings.autoSkipCredits) {
                skipped.credits.add(item.Id);
                skipped.prompt.add(item.Id);
                showToast('Skipping credits');
                playNextEpisode();
                return;
            }
            if (settings.promptNextEpisode && !skipped.prompt.has(item.Id)) {
                skipped.prompt.add(item.Id);
                showPrompt(item);
            }
        }
    }

    const trackCache = new Map();

    function preferenceKey(item) {
        return item?.SeriesId || item?.Id || '';
    }

    function parseTrackPref(raw) {
        if (!raw)
            return null;
        if (typeof raw === 'object')
            return raw;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function tracksForItem(item) {
        if (!settingOn('rememberSeriesTracks', true) || !item)
            return null;
        const key = preferenceKey(item);
        if (!key)
            return null;
        if (trackCache.has(key))
            return trackCache.get(key);
        return null;
    }

    function rememberTracks(item, patch) {
        if (!settingOn('rememberSeriesTracks', true) || !item)
            return;
        const key = preferenceKey(item);
        if (!key)
            return;
        const next = Object.assign({}, trackCache.get(key) || {}, patch);
        trackCache.set(key, next);
        if (window.api?.settings?.setValue)
            window.api.settings.setValue('trackprefs', key, JSON.stringify(next));
    }

    async function hydrateTracks(item) {
        const key = preferenceKey(item);
        if (!key || trackCache.has(key) || !window.api?.settings?.value)
            return tracksForItem(item);
        return new Promise((resolve) => {
            window.api.settings.value('trackprefs', key, (raw) => {
                const parsed = parseTrackPref(raw);
                if (parsed)
                    trackCache.set(key, parsed);
                resolve(parsed);
            });
        });
    }

    async function loadLyrics(item) {
        lyrics = [];
        lyricsPlain = '';
        if (!settingOn('enableLyricsOverlay', true) || !isAudioItem(item) || !window.ApiClient?.getJSON)
            return;
        try {
            const data = await window.ApiClient.getJSON(window.ApiClient.getUrl(`Items/${item.Id}/Lyrics`));
            const lines = data?.Lyrics || data?.lyrics || [];
            if (Array.isArray(lines) && lines.length) {
                lyrics = lines.map((line) => ({
                    start: Number(line.Start ?? line.StartTicks ?? 0),
                    text: line.Text || line.Value || ''
                })).filter((line) => line.text);
                if (lyrics.length && lyrics[0].start > 10000)
                    lyrics = lyrics.map((line) => ({ start: line.start / 10000, text: line.text }));
            } else if (typeof lines === 'string') {
                lyricsPlain = lines;
            } else if (typeof data === 'string') {
                lyricsPlain = data;
            }
        } catch (error) {
            lyricsPlain = '';
        }
    }

    function updateLyrics() {
        const item = currentItem();
        if (!settingOn('enableLyricsOverlay', true) || !item || !isAudioItem(item) || !lyricsVisible) {
            setLyricsText('', '');
            return;
        }
        if (!lyrics.length) {
            setLyricsText(lyricsPlain, '');
            return;
        }
        const pos = positionMs();
        let index = -1;
        for (let i = 0; i < lyrics.length; i++) {
            const start = lyrics[i].start > 100000 ? lyrics[i].start / 10000 : lyrics[i].start;
            if (start <= pos)
                index = i;
        }
        const current = index >= 0 ? lyrics[index].text : lyrics[0].text;
        const next = index >= 0 && index + 1 < lyrics.length ? lyrics[index + 1].text : '';
        setLyricsText(current, next);
    }

    function sleepMode() {
        return String(settingOn('sleepTimer', 'off') || 'off');
    }

    function applySleepFromSettings() {
        const mode = sleepMode();
        sleepFading = false;
        if (mode === lastSleepMode && mode !== 'off' && (sleepDeadline > Date.now() || sleepEpisode))
            return;
        lastSleepMode = mode;
        if (mode === 'off') {
            sleepDeadline = 0;
            sleepEpisode = false;
            setSleepLabel('');
            restoreVolume();
            return;
        }
        if (mode === 'episode') {
            sleepDeadline = 0;
            sleepEpisode = true;
            setSleepLabel('Sleep: end of episode');
            return;
        }
        const minutes = Number(mode);
        if (!minutes) {
            sleepDeadline = 0;
            sleepEpisode = false;
            setSleepLabel('');
            return;
        }
        sleepEpisode = false;
        sleepDeadline = Date.now() + minutes * 60 * 1000;
        setSleepLabel(`Sleep: ${minutes} min`);
        showToast(`Sleep timer set for ${minutes} minutes`);
    }

    function restoreVolume() {
        const manager = playbackManager();
        const player = manager?._currentPlayer;
        if (savedVolume != null && player && typeof player.setVolume === 'function')
            player.setVolume(savedVolume);
        savedVolume = null;
    }

    function pausePlayback() {
        const manager = playbackManager();
        const player = manager?._currentPlayer;
        if (manager && typeof manager.pause === 'function')
            manager.pause(player);
        else if (player && typeof player.pause === 'function')
            player.pause();
    }

    function startSleepFadeThenPause() {
        if (sleepFading)
            return;
        const manager = playbackManager();
        const player = manager?._currentPlayer;
        if (!player) {
            pausePlayback();
            return;
        }
        sleepFading = true;
        if (settingOn('sleepTimerFade', true) && typeof player.getVolume === 'function') {
            savedVolume = player.getVolume();
            const started = Date.now();
            const from = savedVolume;
            const tick = () => {
                if (!sleepFading)
                    return;
                const t = Math.min(1, (Date.now() - started) / SLEEP_FADE_MS);
                player.setVolume(Math.max(0, from * (1 - t)));
                if (t < 1) {
                    requestAnimationFrame(tick);
                    return;
                }
                pausePlayback();
                restoreVolume();
                sleepFading = false;
                setSleepFromValue('off', false);
                showToast('Sleep timer ended');
            };
            tick();
            return;
        }
        pausePlayback();
        sleepFading = false;
        setSleepFromValue('off', false);
        showToast('Sleep timer ended');
    }

    function setSleepFromValue(value, announce) {
        if (window.jmpInfo?.settings?.watch)
            window.jmpInfo.settings.watch.sleepTimer = value;
        else if (window.api?.settings?.setValue)
            window.api.settings.setValue('watch', 'sleepTimer', value);
        applySleepFromSettings();
        if (announce === false)
            return;
        if (value === 'off')
            showToast('Sleep timer off');
        else if (value === 'episode')
            showToast('Sleep at end of episode');
    }

    function cycleSleep() {
        const current = sleepMode();
        const index = SLEEP_CYCLE.indexOf(current);
        const next = SLEEP_CYCLE[(index + 1) % SLEEP_CYCLE.length];
        setSleepFromValue(next);
    }

    function updateSleep() {
        if (sleepEpisode) {
            const item = currentItem();
            if (!item || isAudioItem(item))
                return;
            const duration = durationMs();
            const pos = positionMs();
            if (duration > 0 && duration - pos <= 1500)
                startSleepFadeThenPause();
            return;
        }
        if (!sleepDeadline) {
            setSleepLabel('');
            return;
        }
        const remaining = sleepDeadline - Date.now();
        if (remaining <= 0) {
            startSleepFadeThenPause();
            return;
        }
        if (remaining <= SLEEP_FADE_MS)
            startSleepFadeThenPause();
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        setSleepLabel(`Sleep in ${minutes}:${String(seconds).padStart(2, '0')}`);
    }

    async function onPlaybackStart() {
        const item = currentItem();
        hidePrompt();
        if (!item) {
            activeItemId = '';
            return;
        }
        if (item.Id !== activeItemId) {
            activeItemId = item.Id;
            skipped.intro.delete(item.Id);
            skipped.recap.delete(item.Id);
            skipped.credits.delete(item.Id);
            skipped.prompt.delete(item.Id);
        }
        if (!lastSleepMode && sleepMode() !== 'off')
            applySleepFromSettings();
        await loadLyrics(item);
        updateLyrics();
        await maybeAutoSkip(item);
        maybeInjectThemeButton();
    }

    async function onTick() {
        const item = currentItem();
        if (!item)
            return;
        await maybeAutoSkip(item);
        updateLyrics();
        updateSleep();
    }

    function toggleLyrics() {
        lyricsVisible = !lyricsVisible;
        if (window.jmpInfo?.settings?.watch)
            window.jmpInfo.settings.watch.enableLyricsOverlay = lyricsVisible;
        updateLyrics();
        showToast(lyricsVisible ? 'Lyrics on' : 'Lyrics off');
    }

    async function playThemeVideos() {
        const item = currentItem() || window.ApiClient?._lastItem;
        const apiClient = window.ApiClient;
        const manager = playbackManager();
        if (!apiClient || !item?.Id || !manager)
            return;
        try {
            const media = await apiClient.getJSON(apiClient.getUrl(`Items/${item.Id}/ThemeMedia`, {
                InheritFromParent: true,
                UserId: apiClient.getCurrentUserId?.()
            }));
            const videos = media?.ThemeVideosResult?.Items || media?.ThemeVideos?.Items || [];
            if (!videos.length) {
                showToast('No OP/ED theme videos on this title');
                return;
            }
            manager.play({ items: videos });
            showToast('Playing OP/ED');
        } catch (error) {
            console.warn('Abyssfin: ThemeMedia failed', error);
            showToast('Could not load AnimeThemes extras');
        }
    }

    function maybeInjectThemeButton() {
        if (!settingOn('enableAnimeThemesButton', true))
            return;
        const host = document.querySelector('.mainDetailButtons, .detailButton-primary, .itemDetailPage .detailButtons');
        if (!host || host.querySelector('.abyssfin-theme-btn'))
            return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button-flat btnPlay detailButton abyssfin-theme-btn';
        button.innerHTML = '<span>OP/ED</span>';
        button.title = 'Play theme videos from the AnimeThemes plugin, if this series has them.';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            playThemeVideos();
        });
        host.appendChild(button);
    }

    const observer = new MutationObserver(() => maybeInjectThemeButton());

    function handleAction(action) {
        const helpers = window.abyssfinPlayback;
        const manager = playbackManager();
        if (action === 'skip_intro')
            helpers?.skipIntro(manager);
        else if (action === 'skip_credits')
            helpers?.skipCredits(manager);
        else if (action === 'skip_recap')
            helpers?.skipRecap(manager);
        else if (action === 'toggle_lyrics')
            toggleLyrics();
        else if (action === 'cycle_sleep')
            cycleSleep();
        else if (action === 'sleep_off')
            setSleepFromValue('off');
        else if (action === 'sleep_end' || action === 'sleep_episode')
            setSleepFromValue('episode');
        else if (String(action).startsWith('sleep_'))
            setSleepFromValue(String(action).slice(6));
        else if (action === 'play_theme')
            void playThemeVideos();
        else
            return false;
        return true;
    }

    window.abyssfinWatch = {
        rememberTracks,
        tracksForItem,
        hydrateTracks,
        handleAction,
        playThemeVideos
    };

    (async () => {
        await window.apiPromise;
        lyricsVisible = settingOn('enableLyricsOverlay', true) !== false;
        observer.observe(document.documentElement, { childList: true, subtree: true });

        const api = window.api;
        if (api?.player?.playing)
            api.player.playing.connect(onPlaybackStart);
        if (api?.player?.positionUpdate)
            api.player.positionUpdate.connect(onTick);
        if (api?.player?.stopped)
            api.player.stopped.connect(() => {
                hidePrompt();
                setLyricsText('', '');
                if (!sleepDeadline && !sleepEpisode)
                    setSleepLabel('');
            });

        window.jmpInfo?.settingsUpdate?.push((section) => {
            if (section === 'watch')
                applySleepFromSettings();
        });
    })();
})();
