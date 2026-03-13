window.addEventListener('DOMContentLoaded', () => {
    if (!window.app || typeof window.app.init !== 'function') {
        console.error('App modules failed to load');
        return;
    }

    window.app.init();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
});
