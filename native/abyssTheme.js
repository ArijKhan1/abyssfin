(function() {
    const CDN_ABYSS_CSS_URL = 'https://cdn.jsdelivr.net/gh/AumGupta/abyss-jellyfin@main/abyss.css';
    const THEME_LINK_ID = 'abyssfin-theme';

    function shouldInjectTheme() {
        if (window.jmpInfo?.settings?.main?.enableAbyssTheme === false) {
            return false;
        }

        const path = window.location.pathname || '';
        const href = window.location.href || '';
        return !path.includes('find-webclient.html')
            && !path.includes('offline-library.html')
            && !href.includes('offline-library.html');
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

    function injectBundledTheme(cssText) {
        if (!cssText || document.getElementById(THEME_LINK_ID)) {
            return Boolean(document.getElementById(THEME_LINK_ID));
        }

        const style = document.createElement('style');
        style.id = THEME_LINK_ID;
        style.textContent = cssText;
        document.head.appendChild(style);
        return true;
    }

    function injectLinkedTheme(url) {
        if (!url || document.getElementById(THEME_LINK_ID)) {
            return Boolean(document.getElementById(THEME_LINK_ID));
        }

        const link = document.createElement('link');
        link.id = THEME_LINK_ID;
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
        return true;
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
        if (customUrl && customUrl.trim()) {
            injectLinkedTheme(customUrl.trim());
            return;
        }

        const useBundled = window.jmpInfo?.settings?.main?.useBundledAbyssTheme !== false;
        if (useBundled && window.jmpInfo?.bundledAbyssCss) {
            injectBundledTheme(window.jmpInfo.bundledAbyssCss);
            return;
        }

        injectLinkedTheme(CDN_ABYSS_CSS_URL);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectAbyssTheme);
    } else {
        injectAbyssTheme();
    }
})();
