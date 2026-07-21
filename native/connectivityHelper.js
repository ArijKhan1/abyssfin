window.jmpCheckServerConnectivity = (() => {
    let activeController = null;

    const checkFunc = async function(url) {
        // Abort any in-progress check
        if (activeController) {
            activeController.abort();
        }

        // Wait for API
        let attempts = 0;
        while (!window.api && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        if (!window.api) {
            throw new Error('WebChannel not available');
        }

        // Create abort controller for this check
        const controller = new AbortController();
        activeController = controller;

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, value) => {
                if (settled)
                    return;
                settled = true;
                window.clearTimeout(timeoutId);
                if (handler) {
                    window.api.system.serverConnectivityResult.disconnect(handler);
                    handler = null;
                }
                if (activeController === controller)
                    activeController = null;
                fn(value);
            };

            const timeoutId = window.setTimeout(() => {
                finish(reject, new Error('Connection timed out'));
            }, 90000);

            // Handle abort
            controller.signal.addEventListener('abort', () => {
                finish(reject, new Error('Connection cancelled'));
            });

            let handler = (resultUrl, success, resolvedUrl) => {
                if (resultUrl === url && !controller.signal.aborted) {
                    if (success)
                        finish(resolve, resolvedUrl);
                    else
                        finish(reject, new Error('Connection failed'));
                }
            };

            window.api.system.serverConnectivityResult.connect(handler);
            window.api.system.checkServerConnectivity(url);
        });
    };

    // Expose abort function for cancellation
    checkFunc.abort = () => {
        if (activeController) {
            activeController.abort();
            activeController = null;
        }
    };

    return checkFunc;
})();

window.jmpFetchPage = (() => {
    let fetchInProgress = false;

    return async function(url) {
        if (fetchInProgress) {
            throw new Error('Page fetch already in progress');
        }

        // Wait for API
        let attempts = 0;
        while (!window.api && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        if (!window.api) {
            throw new Error('WebChannel not available');
        }

        fetchInProgress = true;

        return new Promise((resolve, reject) => {
            const handler = (html, finalUrl, hadCSP) => {
                window.api.system.pageContentReady.disconnect(handler);
                fetchInProgress = false;
                resolve({ html, finalUrl, hadCSP });
            };
            window.api.system.pageContentReady.connect(handler);
            window.api.system.fetchPageForCSPWorkaround(url);
        });
    };
})();
