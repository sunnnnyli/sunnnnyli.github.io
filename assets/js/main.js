(() => {
    const root = document.documentElement;
    let motion = root.classList.contains('motion');
    const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

    document.getElementById('year').textContent = new Date().getFullYear();

    /* ---------- Mobile menu ---------- */
    const menuBtn = document.querySelector('.menu-btn');
    const navLinks = document.getElementById('nav-links');
    const setMenu = (open) => {
        root.classList.toggle('menu-open', open);
        menuBtn.setAttribute('aria-expanded', String(open));
        menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    menuBtn.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')));
    navLinks.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    matchMedia('(min-width: 981px)').addEventListener('change', () => setMenu(false));

    /* ---------- Cursor spotlight ---------- */
    document.querySelectorAll('.spot').forEach((el) => {
        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mx', `${e.clientX - r.left}px`);
            el.style.setProperty('--my', `${e.clientY - r.top}px`);
        });
    });

    const nav = document.querySelector('.nav');
    const scenes = [...document.querySelectorAll('[data-scene]')];
    const gallery = document.querySelector('.gallery');
    const cards = [...document.querySelectorAll('.card')];

    const fmt = (el, v) => `${el.dataset.prefix || ''}${Math.round(v).toLocaleString('en-US')}${el.dataset.suffix || ''}`;

    /* ---------- Motion-only setup (runs once, the first time motion is on) ---------- */
    let motionReady = false;
    const initMotion = (initial) => {
        if (motionReady) return;
        motionReady = true;
        // Hero title: split into per-letter spans, grouped by word so lines still wrap between words.
        const title = document.querySelector('[data-split]');
        const text = title.textContent.trim();
        const holder = document.createElement('span');
        holder.setAttribute('aria-hidden', 'true');
        let ci = 0;
        text.split(' ').forEach((word, wi) => {
            if (wi) holder.append(' ');
            const w = document.createElement('span');
            w.className = 'word';
            [...word].forEach((c) => {
                const s = document.createElement('span');
                s.className = 'ch';
                s.style.setProperty('--i', ci++);
                s.textContent = c;
                w.append(s);
            });
            holder.append(w);
        });
        title.setAttribute('aria-label', text);
        title.replaceChildren(holder);
        title.classList.add('split');

        // Story: wrap every word (keeping highlight spans) so each can light up with scroll.
        document.querySelectorAll('[data-words]').forEach((el) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            let wi = 0;
            nodes.forEach((node) => {
                const frag = document.createDocumentFragment();
                node.textContent.split(/(\s+)/).forEach((part) => {
                    if (!part) return;
                    if (/^\s+$/.test(part)) { frag.append(' '); return; }
                    const s = document.createElement('span');
                    s.className = 'w';
                    s.style.setProperty('--i', wi++);
                    s.textContent = part;
                    frag.append(s);
                });
                node.replaceWith(frag);
            });
            el.style.setProperty('--n', wi);
        });

        // Marquees: repeat items until a row is wider than the screen, then double it for a seamless loop.
        document.querySelectorAll('.marquee-track').forEach((track) => {
            const list = track.querySelector('ul');
            const originals = [...list.children];
            // Measure once, then add every copy in one go (re-measuring each round forced extra layout work).
            const setWidth = Math.max(1, list.scrollWidth);
            const repeats = Math.min(8, Math.max(0, Math.ceil((window.innerWidth * 1.1) / setWidth) - 1));
            const extra = document.createDocumentFragment();
            for (let r = 0; r < repeats; r++) {
                originals.forEach((li) => {
                    const c = li.cloneNode(true);
                    c.setAttribute('aria-hidden', 'true');
                    extra.append(c);
                });
            }
            list.append(extra);
            const copy = list.cloneNode(true);
            copy.setAttribute('aria-hidden', 'true');
            copy.removeAttribute('aria-label');
            track.append(copy);
        });

        // Reveal on enter
        const revealer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('in');
                revealer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
        document.querySelectorAll('.rv, .rv-scale').forEach((el) => revealer.observe(el));

        // Experience: light up the bullet in the middle of the screen
        const focus = new IntersectionObserver((entries) => {
            entries.forEach((entry) => entry.target.classList.toggle('on', entry.isIntersecting));
        }, { rootMargin: '-32% 0px -32% 0px' });
        document.querySelectorAll('.feats li').forEach((li) => focus.observe(li));

        // Count-up numbers (first load only; switching motion on later keeps the final values)
        if (initial) {
            const counters = document.querySelectorAll('[data-count]');
            counters.forEach((el) => { el.textContent = fmt(el, 0); });
            const counter = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    counter.unobserve(entry.target);
                    const el = entry.target;
                    const end = Number(el.dataset.count);
                    if (!motion) {
                        el.textContent = fmt(el, end);
                        return;
                    }
                    const t0 = performance.now();
                    const dur = 1900;
                    const step = (t) => {
                        const k = motion ? Math.min(1, (t - t0) / dur) : 1;
                        const eased = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
                        el.textContent = fmt(el, end * eased);
                        if (k < 1) requestAnimationFrame(step);
                    };
                    requestAnimationFrame(step);
                });
            }, { threshold: 0.6 });
            counters.forEach((el) => counter.observe(el));
        }
    };

    if (motion) initMotion(true);

    /* ---------- Scroll engine ---------- */
    // Each [data-scene] gets --p (0 → 1). Pinned scenes measure progress through their own height;
    // "enter" scenes measure how far they have risen into the viewport.
    let pinnedDist = null; // how far the pinned gallery scrolls sideways; null when it isn't pinned
    const layoutGallery = () => {
        pinnedDist = null;
        gallery.classList.remove('gallery--free');
        if (!motion) {
            gallery.style.height = '';
            return;
        }
        const sticky = gallery.querySelector('.gallery-sticky');
        const track = gallery.querySelector('.gallery-track');
        const progress = gallery.querySelector('.gallery-progress');
        // Pin only if the cards (plus the progress bar under them) fit below the top bar.
        const room = window.innerHeight - parseFloat(getComputedStyle(sticky).paddingTop)
            - progress.offsetHeight - parseFloat(getComputedStyle(progress).marginTop) - 16;
        if (track.offsetHeight > room) {
            gallery.classList.add('gallery--free');
            gallery.style.height = '';
            return;
        }
        const dist = Math.max(0, track.offsetWidth - sticky.clientWidth);
        pinnedDist = dist;
        gallery.style.setProperty('--dist', dist);
        gallery.style.height = `${dist + window.innerHeight}px`;
    };

    const navTrack = document.querySelector('.nav-track');
    const checkpoints = [...navLinks.querySelectorAll('ul a')].map((a) => ({ a, sec: document.querySelector(a.hash) }));

    // Piecewise map from scroll position to the line: the fill hits each tab's center
    // exactly when its section reaches the top bar, and the line's end at the bottom of the page.
    // The same positions decide which tabs are passed and which one is current, so the tabs and line always agree.
    const measureTrack = (y, max) => {
        const width = navTrack.offsetWidth;
        const navH = nav.offsetHeight;
        const pts = [[0, 0]];
        let prev = 0;
        const tops = checkpoints.map(({ a, sec }) => {
            const top = Math.min(max, Math.max(prev, sec.getBoundingClientRect().top + y - navH));
            pts.push([top, a.offsetLeft + a.offsetWidth / 2]);
            prev = top;
            return top;
        });
        if (!width) return { tops, fill: null }; // the line is hidden on small screens
        pts.push([Math.max(max, prev), width]);
        let x = width;
        for (let i = 1; i < pts.length; i++) {
            const [y0, x0] = pts[i - 1];
            const [y1, x1] = pts[i];
            if (y <= y1) {
                x = y1 > y0 ? x0 + (x1 - x0) * (y - y0) / (y1 - y0) : x1;
                break;
            }
        }
        return { tops, fill: clamp(x / width).toFixed(4) };
    };

    let lastFill = null;
    const applyTrack = (y, { tops, fill }) => {
        let current = null;
        checkpoints.forEach(({ a }, i) => {
            const reached = y >= tops[i] - 1;
            a.classList.toggle('reached', reached);
            if (reached) current = a;
        });
        checkpoints.forEach(({ a }) => a.classList.toggle('active', a === current));
        if (fill !== null && fill !== lastFill) {
            lastFill = fill;
            navTrack.style.setProperty('--fill', fill);
        }
    };

    let ticking = false;
    let lastScroll = null;
    const frame = () => {
        ticking = false;
        const vh = window.innerHeight;
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - vh;

        // Read every position first, then write. Mixing the two makes the browser
        // redo the page layout after each change, which is what makes phones stutter.
        const track = measureTrack(y, max);
        const sceneP = motion ? scenes.map((sc) => {
            const r = sc.getBoundingClientRect();
            if (r.bottom < -vh || r.top > vh * 2) return null;
            return sc.dataset.scene === 'enter'
                ? clamp((vh - r.top) / (vh * 0.8))
                : clamp(-r.top / Math.max(1, r.height - vh));
        }) : [];
        let cardF = null;
        if (motion) {
            const gr = gallery.getBoundingClientRect();
            if (gr.bottom > 0 && gr.top < vh) {
                const mid = window.innerWidth / 2;
                cardF = cards.map((card) => {
                    const r = card.getBoundingClientRect();
                    return clamp(1 - Math.abs(r.left + r.width / 2 - mid) / (window.innerWidth * 0.9)).toFixed(3);
                });
            }
        }

        toTop.classList.toggle('show', y > vh * 1.2);
        const scroll = max > 0 ? (y / max).toFixed(4) : '0';
        if (scroll !== lastScroll) {
            lastScroll = scroll;
            nav.style.setProperty('--scroll', scroll);
        }
        applyTrack(y, track);
        sceneP.forEach((p, i) => {
            const sc = scenes[i];
            if (p === null || sc._p === p) return;
            sc._p = p;
            sc.style.setProperty('--p', p.toFixed(4));
        });
        if (cardF) {
            cards.forEach((card, i) => {
                if (card._f === cardF[i]) return;
                card._f = cardF[i];
                card.style.setProperty('--f', cardF[i]);
            });
        }
    };

    const request = () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(frame);
        }
    };

    /* ---------- Reduce motion toggle ---------- */
    const motionBtn = document.querySelector('.motion-btn');
    const syncMotionBtn = () => {
        motionBtn.setAttribute('aria-pressed', String(!motion));
        motionBtn.title = motion ? 'Reduce motion' : 'Turn animations back on';
    };

    const setMotion = (on) => {
        if (on === motion) return;

        // Pinned scenes change the page height, so remember what's at the top of the screen and put it back.
        const navH = nav.offsetHeight;
        const mark = [...document.querySelectorAll('main h1, main h2, .story-text, .tile, .job-side, .feats li, .card, .marquee, .contact-sub')]
            .find((el) => el.getBoundingClientRect().bottom > navH);
        const before = mark ? mark.getBoundingClientRect().top : 0;

        motion = on;
        root.classList.toggle('motion', on);
        try { localStorage.setItem('motion', on ? 'on' : 'off'); } catch (e) {}

        if (on) {
            initMotion(false);
        } else {
            document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = fmt(el, Number(el.dataset.count)); });
            scenes.forEach((sc) => { sc.style.removeProperty('--p'); sc._p = undefined; });
        }

        layoutGallery();
        if (mark) window.scrollTo({ top: window.scrollY + mark.getBoundingClientRect().top - before, behavior: 'instant' });

        // Anything already on screen or scrolled past shouldn't wait for a reveal.
        if (on) {
            document.querySelectorAll('.rv:not(.in), .rv-scale:not(.in)').forEach((el) => {
                if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('in');
            });
        }

        syncMotionBtn();
        request();
    };

    motionBtn.addEventListener('click', () => setMotion(!motion));

    /* ---------- Back to top (phones) ---------- */
    const toTop = document.querySelector('.to-top');

    /* ---------- Project panels ---------- */
    document.querySelectorAll('[data-panel]').forEach((btn) => {
        const panel = document.getElementById(btn.dataset.panel);
        btn.addEventListener('click', () => panel.showModal());
    });
    document.querySelectorAll('.panel').forEach((panel) => {
        panel.querySelector('.panel-close').addEventListener('click', () => panel.close());
        // A click on the dimmed backdrop (outside the sheet) closes it too.
        panel.addEventListener('click', (e) => { if (e.target === panel) panel.close(); });
    });

    /* ---------- Footer: last updated ---------- */
    // GitHub Pages sends the deploy date; a local file reports "now", so keep the written date then.
    const lastMod = new Date(document.lastModified);
    if (!Number.isNaN(lastMod.getTime()) && Date.now() - lastMod.getTime() > 120000) {
        document.getElementById('updated').textContent = lastMod.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    /* ---------- Copy email ---------- */
    document.querySelectorAll('.copy-btn').forEach((copyBtn) => {
        const copyLabel = copyBtn.querySelector('.copy-label');
        const copyStatus = copyBtn.closest('.email-group').querySelector('.copy-status');
        let copyTimer;
        copyBtn.addEventListener('click', async () => {
            const text = copyBtn.dataset.copy;
            // The clipboard API can hang waiting on a permission prompt, so give it a moment, then fall back.
            let ok = false;
            if (navigator.clipboard) {
                ok = await Promise.race([
                    navigator.clipboard.writeText(text).then(() => true, () => false),
                    new Promise((r) => setTimeout(() => r(false), 800)),
                ]);
            }
            if (!ok) {
                // Older browsers and non-secure pages: copy from a hidden text box.
                const t = document.createElement('textarea');
                t.value = text;
                t.setAttribute('readonly', '');
                t.style.cssText = 'position:fixed;opacity:0';
                document.body.append(t);
                t.select();
                try { ok = document.execCommand('copy'); } catch (err) {}
                t.remove();
            }
            copyBtn.classList.toggle('copied', ok);
            copyLabel.textContent = ok ? 'Copied' : 'Copy failed';
            copyStatus.textContent = ok ? 'Email address copied' : 'Could not copy the email address';
            clearTimeout(copyTimer);
            copyTimer = setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyLabel.textContent = 'Copy';
                copyStatus.textContent = '';
            }, 2000);
        });
    });

    /* ---------- Printing: show final numbers, not a count-up in progress ---------- */
    const finishCounters = () => document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = fmt(el, Number(el.dataset.count)); });
    window.addEventListener('beforeprint', finishCounters);
    matchMedia('print').addEventListener('change', (e) => { if (e.matches) finishCounters(); });

    /* ---------- Light / dark theme ---------- */
    const themeBtn = document.querySelector('.theme-btn');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    let theme = root.dataset.theme;
    const favicon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    const favDark = favicon ? favicon.href : '';
    const favLight = favicon ? new URL(favicon.dataset.light, document.baseURI).href : '';
    const syncThemeBtn = () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        themeBtn.setAttribute('aria-label', `Switch to ${next} theme`);
        themeBtn.title = `Switch to ${next} theme`;
        themeMeta.content = theme === 'dark' ? '#1c1c1d' : '#f2f4f6';
        if (favicon) favicon.href = theme === 'dark' ? favDark : favLight;
    };
    const setTheme = (t, remember, origin) => {
        theme = t;
        if (remember) { try { localStorage.setItem('theme', t); } catch (e) {} }
        const apply = () => { root.dataset.theme = theme; syncThemeBtn(); };
        // The new theme spreads out in a circle from the button; instant otherwise or with motion off.
        if (motion && document.startViewTransition) {
            const vt = document.startViewTransition(apply);
            if (origin) {
                vt.ready.then(() => {
                    const { x, y } = origin;
                    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
                    root.animate(
                        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
                        { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
                    );
                }).catch(() => {});
            }
            // If the browser never paints the transition (background tab, busy renderer), apply anyway.
            setTimeout(() => { if (root.dataset.theme !== theme) apply(); }, 300);
        } else {
            apply();
        }
    };
    themeBtn.addEventListener('click', () => {
        const r = themeBtn.getBoundingClientRect();
        setTheme(theme === 'dark' ? 'light' : 'dark', true, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
    // Follow system changes until the visitor picks a theme themselves.
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        let saved = null;
        try { saved = localStorage.getItem('theme'); } catch (err) {}
        if (!saved) setTheme(e.matches ? 'light' : 'dark', false);
    });
    syncThemeBtn();
    syncMotionBtn();

    layoutGallery();
    frame();
    window.addEventListener('scroll', request, { passive: true });
    // Phone browsers resize the window when the address bar slides away on the first scroll.
    // That only changes the height a little, so skip the full re-measure then.
    let lastW = window.innerWidth;
    let lastH = window.innerHeight;
    window.addEventListener('resize', () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w === lastW && Math.abs(h - lastH) < 160) {
            if (pinnedDist !== null) gallery.style.height = `${pinnedDist + h}px`;
        } else {
            lastW = w;
            lastH = h;
            layoutGallery();
        }
        request();
    });

    /* ---------- Project diagrams animate only while on screen ---------- */
    const artObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => e.target.classList.toggle('in-view', e.isIntersecting));
    });
    document.querySelectorAll('.art-dg').forEach((el) => artObserver.observe(el));
    if (document.fonts) document.fonts.ready.then(() => { layoutGallery(); request(); });
})();
