(function() {
    const STYLE_ID = 'abyssfin-spotlight-styles';
    const FALLBACK_ID = 'abyssfin-spotlight-fallback';
    const IFRAME_CLASS = 'featurediframe';

    function isEnabled() {
        return window.jmpInfo?.settings?.main?.enableAbyssSpotlight !== false;
    }

    function isJellyfinClient() {
        const path = window.location.pathname || '';
        const href = window.location.href || '';
        return path.includes('/web')
            && !path.includes('find-webclient.html')
            && !href.includes('offline-library.html');
    }

    function getWebBase() {
        const match = window.location.pathname.match(/^(.*\/web)\/?/);
        return match ? match[1] : '/web';
    }

    function getServerBase() {
        const path = window.location.pathname.replace(/\/web(\/.*)?$/, '');
        return window.location.origin + path;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${IFRAME_CLASS} {
                width: 100%;
                display: block;
                border: 0;
                margin: 0;
                padding: 0;
                height: 70vh;
                min-height: 420px;
                max-height: 680px;
            }
            #${FALLBACK_ID} {
                width: 100%;
                margin: 0 0 24px 0;
                padding: 0;
            }
            #${FALLBACK_ID} .abyssfin-spotlight-title {
                font: 700 1.4rem/1.2 system-ui, -apple-system, sans-serif;
                margin: 0 0 12px 4px;
                color: #fff;
            }
            #${FALLBACK_ID} .abyssfin-spotlight-row {
                display: flex;
                gap: 14px;
                overflow-x: auto;
                padding-bottom: 8px;
                scroll-snap-type: x mandatory;
            }
            #${FALLBACK_ID} .abyssfin-spotlight-card {
                flex: 0 0 220px;
                scroll-snap-align: start;
                border-radius: 12px;
                overflow: hidden;
                background: rgba(255,255,255,0.06);
                cursor: pointer;
                transition: transform 120ms ease;
            }
            #${FALLBACK_ID} .abyssfin-spotlight-card:hover { transform: translateY(-2px); }
            #${FALLBACK_ID} .abyssfin-spotlight-card img {
                width: 100%;
                aspect-ratio: 16 / 9;
                object-fit: cover;
                display: block;
                background: #111;
            }
            #${FALLBACK_ID} .abyssfin-spotlight-card .meta {
                padding: 10px 12px 12px;
            }
            #${FALLBACK_ID} .abyssfin-spotlight-card .name {
                font: 600 0.95rem/1.25 system-ui, -apple-system, sans-serif;
                color: #fff;
            }
            #${FALLBACK_ID} .abyssfin-spotlight-card .sub {
                margin-top: 4px;
                font: 400 0.8rem/1.3 system-ui, -apple-system, sans-serif;
                color: rgba(255,255,255,0.65);
            }
            @media (min-width: 1400px) {
                .${IFRAME_CLASS} { height: 72vh; max-height: 760px; }
            }
            @media (min-width: 1920px) {
                .${IFRAME_CLASS} { height: 68vh; max-height: 860px; }
            }
            @media (max-width: 1024px) and (orientation: portrait) {
                .${IFRAME_CLASS} { height: 90vh; min-height: 320px; max-height: 720px; }
            }
            @media (max-width: 1024px) and (orientation: landscape) {
                .${IFRAME_CLASS} { height: 100vh; min-height: 280px; max-height: 420px; }
            }
            @media (max-width: 600px) and (orientation: portrait) {
                .${IFRAME_CLASS} { height: 90vh; min-height: 260px; max-height: 720px; }
            }
            @media (max-width: 900px) and (orientation: landscape) and (max-height: 500px) {
                .${IFRAME_CLASS} { height: 100vh; min-height: 200px; }
            }
        `;
        document.head.appendChild(style);
    }

    function syncIframeVisibility(homeTab, iframe) {
        const update = () => {
            iframe.style.display = homeTab.classList.contains('is-active') ? 'block' : 'none';
        };
        update();
        new MutationObserver(update).observe(homeTab, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    function imageUrl(item, width) {
        const tags = item.ImageTags || {};
        let imageType = 'Primary';
        let tag = tags.Primary;
        if (!tag && tags.Backdrop) {
            imageType = 'Backdrop';
            tag = tags.Backdrop;
        } else if (!tag && tags.Thumb) {
            imageType = 'Thumb';
            tag = tags.Thumb;
        }
        if (!tag || !item.Id) {
            return '';
        }
        return `${getServerBase()}/Items/${item.Id}/Images/${imageType}?fillHeight=320&fillWidth=${width}&tag=${tag}&quality=90`;
    }

    function openItem(item) {
        if (!item?.Id) {
            return;
        }
        window.location.hash = `#/details?id=${item.Id}`;
    }

    async function fetchSpotlightItems() {
        const apiClient = window.ApiClient;
        if (!apiClient?.getCurrentUserId) {
            return [];
        }

        const userId = apiClient.getCurrentUserId();
        const requests = [
            apiClient.getJSON(apiClient.getUrl(`Users/${userId}/Items`, {
                IncludeItemTypes: 'Movie,Series',
                SortBy: 'DateCreated',
                SortOrder: 'Descending',
                Recursive: true,
                Limit: 12,
                Fields: 'PrimaryImageAspectRatio,Overview',
                ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb'
            })),
            apiClient.getJSON(apiClient.getUrl(`Users/${userId}/Items/Resume`, {
                Limit: 8,
                Fields: 'PrimaryImageAspectRatio,Overview',
                ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb'
            }))
        ];

        const results = await Promise.allSettled(requests);
        const merged = [];
        const seen = new Set();

        for (const result of results) {
            if (result.status !== 'fulfilled') {
                continue;
            }
            const items = result.value?.Items || [];
            for (const item of items) {
                if (!item?.Id || seen.has(item.Id)) {
                    continue;
                }
                seen.add(item.Id);
                merged.push(item);
            }
        }

        return merged.slice(0, 12);
    }

    function renderFallback(homeTab, items) {
        if (!items.length || document.getElementById(FALLBACK_ID)) {
            return false;
        }

        injectStyles();

        const container = document.createElement('section');
        container.id = FALLBACK_ID;

        const title = document.createElement('h2');
        title.className = 'abyssfin-spotlight-title';
        title.textContent = 'Spotlight';
        container.appendChild(title);

        const row = document.createElement('div');
        row.className = 'abyssfin-spotlight-row';

        for (const item of items) {
            const card = document.createElement('article');
            card.className = 'abyssfin-spotlight-card';
            card.addEventListener('click', () => openItem(item));

            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = item.Name || '';
            img.src = imageUrl(item, 440);
            card.appendChild(img);

            const meta = document.createElement('div');
            meta.className = 'meta';

            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = item.Name || 'Untitled';
            meta.appendChild(name);

            const sub = document.createElement('div');
            sub.className = 'sub';
            sub.textContent = item.Type === 'Series'
                ? (item.ProductionYear ? `Series · ${item.ProductionYear}` : 'Series')
                : (item.ProductionYear ? `Movie · ${item.ProductionYear}` : 'Movie');
            meta.appendChild(sub);

            card.appendChild(meta);
            row.appendChild(card);
        }

        container.appendChild(row);
        homeTab.insertBefore(container, homeTab.firstChild);
        console.log('Abyssfin: injected Spotlight fallback carousel');
        return true;
    }

    async function injectFallback(homeTab) {
        try {
            const items = await fetchSpotlightItems();
            return renderFallback(homeTab, items);
        } catch (error) {
            console.warn('Abyssfin: Spotlight fallback failed', error);
            return false;
        }
    }

    function injectSpotlightIframe(homeTab) {
        if (homeTab.querySelector(`.${IFRAME_CLASS}`) || document.getElementById(FALLBACK_ID)) {
            return true;
        }

        injectStyles();

        const iframe = document.createElement('iframe');
        iframe.className = IFRAME_CLASS;
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('title', 'Abyss Spotlight');
        iframe.src = `${getWebBase()}/ui/spotlight.html`;

        homeTab.insertBefore(iframe, homeTab.firstChild);
        syncIframeVisibility(homeTab, iframe);
        console.log('Abyssfin: injected Spotlight banner');
        return true;
    }

    async function injectSpotlight(homeTab) {
        if (homeTab.querySelector(`.${IFRAME_CLASS}`) || document.getElementById(FALLBACK_ID)) {
            return true;
        }

        const spotlightUrl = `${getWebBase()}/ui/spotlight.html`;
        try {
            const response = await fetch(spotlightUrl, {
                method: 'HEAD',
                credentials: 'include',
                cache: 'no-store'
            });
            if (!response.ok) {
                console.warn('Abyssfin: Spotlight page unavailable, using API fallback');
                return injectFallback(homeTab);
            }
        } catch (error) {
            console.warn('Abyssfin: Spotlight probe failed, using API fallback', error);
            return injectFallback(homeTab);
        }

        return injectSpotlightIframe(homeTab);
    }

    async function tryInject() {
        if (!isEnabled() || !isJellyfinClient()) {
            return false;
        }

        const homeTab = document.getElementById('homeTab');
        if (!homeTab) {
            return false;
        }

        return injectSpotlight(homeTab);
    }

    function start() {
        if (!isEnabled() || !isJellyfinClient()) {
            return;
        }

        void tryInject().then((injected) => {
            if (injected) {
                return;
            }

            const observer = new MutationObserver(() => {
                void tryInject().then((success) => {
                    if (success) {
                        observer.disconnect();
                    }
                });
            });

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });

            window.setTimeout(() => observer.disconnect(), 120000);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

