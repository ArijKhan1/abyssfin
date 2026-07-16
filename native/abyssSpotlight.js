(function() {
    const STYLE_ID = 'abyssfin-spotlight-styles';
    const IFRAME_CLASS = 'featurediframe';

    function isEnabled() {
        return window.jmpInfo?.settings?.main?.enableAbyssSpotlight !== false;
    }

    function isJellyfinClient() {
        const path = window.location.pathname || '';
        return path.includes('/web') && !path.includes('find-webclient.html');
    }

    function getWebBase() {
        const match = window.location.pathname.match(/^(.*\/web)\/?/);
        return match ? match[1] : '/web';
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

    function injectSpotlight(homeTab) {
        if (homeTab.querySelector(`.${IFRAME_CLASS}`)) {
            return true;
        }

        injectStyles();

        const iframe = document.createElement('iframe');
        iframe.className = IFRAME_CLASS;
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('title', 'Abyss Spotlight');
        iframe.src = `${getWebBase()}/ui/spotlight.html`;

        iframe.addEventListener('error', () => {
            console.warn('Abyssfin: Spotlight iframe failed to load. Ensure Abyss server setup installed spotlight files in jellyfin-web/ui/.');
        });

        homeTab.insertBefore(iframe, homeTab.firstChild);
        syncIframeVisibility(homeTab, iframe);
        console.log('Abyssfin: injected Spotlight banner');
        return true;
    }

    function tryInject() {
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

        if (tryInject()) {
            return;
        }

        const observer = new MutationObserver(() => {
            if (tryInject()) {
                observer.disconnect();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.setTimeout(() => observer.disconnect(), 120000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
