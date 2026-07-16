(function() {
    const ABYSS_CSS_URL = 'https://cdn.jsdelivr.net/gh/AumGupta/abyss-jellyfin@main/abyss.css';
    const THEME_LINK_ID = 'abyssfin-theme';

    function shouldInjectTheme() {
        if (window.jmpInfo?.settings?.main?.enableAbyssTheme === false) {
            return false;
        }

        const path = window.location.pathname || '';
        return !path.includes('find-webclient.html');
    }

    function ensureDarkBaseTheme() {
        try {
            const themeKey = 'emby-theme';
            const currentTheme = window.localStorage.getItem(themeKey);
            if (currentTheme !== 'dark') {
                window.localStorage.setItem(themeKey, 'dark');
            }
        } catch (e) {
            console.warn('Abyssfin: unable to set dark base theme', e);
        }
    }

    function injectAbyssTheme() {
        if (!shouldInjectTheme()) {
            return;
        }

        if (document.getElementById(THEME_LINK_ID)) {
            return;
        }

        ensureDarkBaseTheme();

        const customUrl = window.jmpInfo?.settings?.main?.abyssThemeUrl;
        const link = document.createElement('link');
        link.id = THEME_LINK_ID;
        link.rel = 'stylesheet';
        link.href = customUrl && customUrl.trim() ? customUrl.trim() : ABYSS_CSS_URL;
        document.head.appendChild(link);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectAbyssTheme);
    } else {
        injectAbyssTheme();
    }
})();
