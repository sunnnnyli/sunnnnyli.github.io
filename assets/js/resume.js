// Résumé page: the theme toggle, the Print button, and the offline cache shared with the main page.
(() => {
    const root = document.documentElement;
    const themeBtn = document.querySelector('.theme-btn');
    const themeMeta = document.querySelector('meta[name="theme-color"]');

    const syncThemeBtn = () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        themeBtn.setAttribute('aria-label', `Switch to ${next} theme`);
        themeBtn.title = `Switch to ${next} theme`;
        themeMeta.content = root.dataset.theme === 'dark' ? '#1c1c1d' : '#f2f4f6';
    };
    const setTheme = (t, remember) => {
        root.dataset.theme = t;
        if (remember) { try { localStorage.setItem('theme', t); } catch (e) {} }
        syncThemeBtn();
    };
    themeBtn.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true));
    // Follow system changes until the visitor picks a theme themselves
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        let saved = null;
        try { saved = localStorage.getItem('theme'); } catch (err) {}
        if (!saved) setTheme(e.matches ? 'light' : 'dark', false);
    });
    syncThemeBtn();

    // Print sends the PDF itself (the same file as the PDF button) to the printer, by loading it into a hidden frame
    // and printing that. Safari, and pages opened straight from disk, can't print a PDF that way, so there it opens
    // in a new tab to print from.
    const printBtn = document.querySelector('[data-print]');
    const pdf = printBtn.dataset.print;
    const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
    printBtn.addEventListener('click', () => {
        const openIt = () => window.open(pdf, '_blank', 'noopener');
        if (isSafari || location.protocol === 'file:') {
            openIt();
            return;
        }
        document.getElementById('pdf-print')?.remove();
        const frame = document.createElement('iframe');
        frame.id = 'pdf-print';
        frame.title = 'Résumé PDF for printing';
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
        frame.addEventListener('load', () => {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch (e) {
                openIt();
            }
        }, { once: true });
        frame.src = pdf;
        document.body.append(frame);
    });

    if ('serviceWorker' in navigator && window.isSecureContext) {
        window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
    }
})();
