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
    const applyTheme = (t) => {
        root.dataset.theme = t;
        syncThemeBtn();
    };
    // Like the portfolio: with motion on, the new theme spreads out in a circle from the button. Without a button
    // to start from (a system change, or catching up after a back/forward), it switches at once.
    const setTheme = (t, remember, origin) => {
        if (remember) store('theme', t);
        if (!origin || !root.classList.contains('motion') || !document.startViewTransition) {
            applyTheme(t);
            return;
        }
        const vt = document.startViewTransition(() => applyTheme(t));
        vt.ready.then(() => {
            const { x, y } = origin;
            const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
            root.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
                { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
            );
        }).catch(() => {});
        // If the browser never paints the transition (background tab, busy renderer), switch anyway
        setTimeout(() => { if (root.dataset.theme !== t) applyTheme(t); }, 300);
    };
    themeBtn.addEventListener('click', () => {
        const r = themeBtn.getBoundingClientRect();
        setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
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
    // Turning motion on mustn't hide what's already on screen or passed
    const showOnScreen = (extra = '') => {
        document.querySelectorAll('.rv:not(.in), .r-sign:not(.in)').forEach((el) => {
            if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('in', ...extra.split(' ').filter(Boolean));
        });
    };
    contrastBtn.addEventListener('click', () => {
        const more = !root.classList.contains('contrast');
        root.classList.toggle('contrast', more);
        store('contrast', more ? 'more' : 'normal');
        syncToggles();
    });
    motionBtn.addEventListener('click', () => {
        const on = !root.classList.contains('motion');
        if (on) showOnScreen();
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

    // The résumé can be opened ahead of time (the portfolio has Chrome and Edge load it when a visitor hovers a link
    // to it) or come back from the back/forward cache. Either way it picks up any switch flipped in the meantime.
    const resync = () => {
        const t = stored('theme');
        setTheme(t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark', false);
        const c = stored('contrast');
        root.classList.toggle('contrast', c ? c === 'more' : matchMedia('(prefers-contrast: more)').matches);
        const m = stored('motion');
        const on = m ? m === 'on' : !matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (on && !root.classList.contains('motion')) showOnScreen();
        root.classList.toggle('motion', on);
        syncToggles();
    };
    document.addEventListener('prerenderingchange', resync);
    window.addEventListener('pageshow', (e) => { if (e.persisted) resync(); });

    // Arriving with a page transition, the transition brings the sheet in, so what's on the first screen shows at
    // once instead of rising in after it
    if (root.classList.contains('arrived')) showOnScreen('now');
    window.addEventListener('pagereveal', (e) => { if (e.viewTransition) showOnScreen('now'); });

    // Sections and roles rise in as they're reached, and the signature signs itself at the end. A role shows as soon
    // as any of it comes into view, so a long one starting near the bottom of a phone screen doesn't leave a gap.
    // This watches even with motion off (nothing is hidden then), so turning motion on later never hides anything.
    const reveal = (threshold) => new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('in');
            obs.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold });
    const sections = reveal(0);
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
