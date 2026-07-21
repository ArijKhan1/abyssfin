(function() {
    const OVERLAY_ID = 'abyssfin-pip-controls';

    function createOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            return document.getElementById(OVERLAY_ID);
        }

        const style = document.createElement('style');
        style.textContent = `
            #${OVERLAY_ID} {
                position: fixed;
                top: 14px;
                right: 14px;
                z-index: 2147483000;
                display: none;
                gap: 10px;
                pointer-events: auto;
                padding: 8px;
                border-radius: 18px;
                background: rgba(18, 18, 28, 0.55);
                border: 1px solid rgba(255, 255, 255, 0.14);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
                backdrop-filter: blur(18px) saturate(140%);
                -webkit-backdrop-filter: blur(18px) saturate(140%);
            }
            #${OVERLAY_ID}.visible { display: flex; }
            #${OVERLAY_ID} button {
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 999px;
                padding: 9px 15px;
                font: 600 12px/1 system-ui, -apple-system, sans-serif;
                color: #fff;
                background: rgba(255, 255, 255, 0.06);
                cursor: pointer;
                transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
            }
            #${OVERLAY_ID} button:hover {
                background: rgba(168, 93, 195, 0.88);
                border-color: rgba(255, 255, 255, 0.18);
                transform: translateY(-1px);
            }
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.textContent = 'Skip Intro';
        skipBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const pm = window.playbackManager;
            if (pm && window.abyssfinPlayback?.skipIntro(pm)) {
                skipBtn.textContent = 'Skipped';
                window.setTimeout(() => { skipBtn.textContent = 'Skip Intro'; }, 1500);
            }
        });

        const exitBtn = document.createElement('button');
        exitBtn.type = 'button';
        exitBtn.textContent = 'Exit PiP';
        exitBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            window.api?.window?.togglePiP?.();
        });

        overlay.appendChild(skipBtn);
        overlay.appendChild(exitBtn);
        document.body.appendChild(overlay);
        return overlay;
    }

    function setVisible(visible) {
        const overlay = createOverlay();
        overlay.classList.toggle('visible', visible);
    }

    (async () => {
        const api = await window.apiPromise;
        const whenDomReady = window.abyssfinDom?.whenReady || ((callback) => {
            if (document.body)
                callback();
            else
                document.addEventListener('DOMContentLoaded', callback, { once: true });
        });
        whenDomReady(() => createOverlay());

        if (!api?.window)
            return;

        const sync = () => setVisible(Boolean(api.window.pipMode));
        sync();

        if (api.window.pipModeChanged?.connect)
            api.window.pipModeChanged.connect(sync);
    })();
})();
