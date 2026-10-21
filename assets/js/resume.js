// Résumé page: the theme, contrast, and motion toggles (shared with the portfolio), the scroll reveals and reading
// progress, the Back and Print buttons, and the offline cache.
(() => {
    const root = document.documentElement;
    // Saved choices, shared with the portfolio. Storage can be blocked, e.g. in some private windows.
    const stored = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
    const store = (key, value) => { try { localStorage.setItem(key, value); } catch (e) {} };
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
        if (remember) store('theme', t);
        syncThemeBtn();
    };
    themeBtn.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true));
    // Follow system changes until the visitor picks a theme themselves
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!stored('theme')) setTheme(e.matches ? 'light' : 'dark', false);
    });
    syncThemeBtn();

    // Contrast and motion toggles, remembered the same way as on the rest of the site
    const contrastBtn = document.querySelector('.contrast-btn');
    const motionBtn = document.querySelector('.motion-btn');
    const syncToggles = () => {
        const more = root.classList.contains('contrast');
        contrastBtn.setAttribute('aria-pressed', String(more));
        contrastBtn.title = more ? 'Turn high contrast off' : 'More contrast';
        const still = !root.classList.contains('motion');
        motionBtn.setAttribute('aria-pressed', String(still));
        motionBtn.title = still ? 'Turn animations back on' : 'Reduce motion';
    };
    contrastBtn.addEventListener('click', () => {
        const more = !root.classList.contains('contrast');
        root.classList.toggle('contrast', more);
        store('contrast', more ? 'more' : 'normal');
        syncToggles();
    });
    motionBtn.addEventListener('click', () => {
        const on = !root.classList.contains('motion');
        // Turning motion on mustn't hide what's already on screen or passed
        if (on) {
            document.querySelectorAll('.rv:not(.in), .r-sign:not(.in)').forEach((el) => {
                if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('in');
            });
        }
        root.classList.toggle('motion', on);
        store('motion', on ? 'on' : 'off');
        syncToggles();
    });
    // Contrast follows system changes until the visitor picks for themselves
    matchMedia('(prefers-contrast: more)').addEventListener('change', (e) => {
        if (stored('contrast')) return;
        root.classList.toggle('contrast', e.matches);
        syncToggles();
    });
    syncToggles();

    // Sections and roles rise in as they're reached, and the signature signs itself at the end. This watches even
    // with motion off (nothing is hidden then), so turning motion on later never hides anything.
    const reveal = (threshold) => new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('in');
            obs.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold });
    const sections = reveal(0.12);
    const signoff = reveal(0.6);
    // A beat after load, so the first screen's sections follow the header in
    setTimeout(() => {
        document.querySelectorAll('.rv').forEach((el) => sections.observe(el));
        document.querySelectorAll('.r-sign').forEach((el) => signoff.observe(el));
    }, 350);

    // Reading progress: the browser tracks it in CSS where it can; elsewhere the script follows the scroll
    if (!(window.CSS && CSS.supports && CSS.supports('animation-timeline', 'scroll()'))) {
        const fill = document.querySelector('.r-progress span');
        let queued = false;
        const update = () => {
            queued = false;
            const max = document.documentElement.scrollHeight - window.innerHeight;
            fill.style.setProperty('--scroll', max > 0 ? (window.scrollY / max).toFixed(4) : '0');
        };
        window.addEventListener('scroll', () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(update);
        }, { passive: true });
        update();
    }

    // Back to the site: coming from the portfolio in this tab, step back in history, so it returns to where you were
    document.querySelector('.r-back').addEventListener('click', (e) => {
        let from = null;
        try { from = document.referrer ? new URL(document.referrer) : null; } catch (err) {}
        if (from && from.origin === location.origin && /\/(index\.html)?$/.test(from.pathname) && history.length > 1) {
            e.preventDefault();
            history.back();
            return;
        }
        // Otherwise (opened from disk, where browsers don't say where you came from), leave a note for the
        // portfolio to put the visitor back where they were
        try { sessionStorage.setItem('fromResume', '1'); } catch (err) {}
    });

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
