(() => {
    const root = document.documentElement;
    let motion = root.classList.contains('motion');
    const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
    // Browsers with scroll-driven animations track each scene's progress in CSS (see "Scroll timelines" in styles.css),
    // so the script only measures scenes and cards itself where that isn't supported.
    const sda = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline', 'view()'));
    const isMac = /Mac|iPhone|iPad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

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
        // Each card's offset from the middle of the screen before the track slides, for the CSS card scaling.
        gallery.style.setProperty('--vw', window.innerWidth);
        cards.forEach((card) => {
            card._c = card.offsetLeft + card.offsetWidth / 2 - window.innerWidth / 2;
            card.style.setProperty('--c', card._c.toFixed(1));
        });
    };

    const navTrack = document.querySelector('.nav-track');
    const checkpoints = [...navLinks.querySelectorAll('ul a')].map((a) => ({ a, sec: document.querySelector(a.hash) }));

    // Piecewise map from scroll position to the line: the fill hits each tab's center
    // exactly when its section reaches the top bar, and the line's end at the bottom of the page.
    // The same positions decide which tabs are passed and which one is current, so the tabs and line always agree.
    // Section positions, tab positions and page height only change when the layout does,
    // so they're measured then (see the ResizeObserver below), never while scrolling.
    let lay = null;
    const measureLayout = () => {
        const y = window.scrollY;
        const navH = nav.offsetHeight;
        lay = {
            docH: document.documentElement.scrollHeight,
            width: navTrack.offsetWidth,
            secTops: checkpoints.map(({ sec }) => sec.getBoundingClientRect().top + y - navH),
            tabX: checkpoints.map(({ a }) => a.offsetLeft + a.offsetWidth / 2),
        };
    };

    const measureTrack = (y, max) => {
        const { width, secTops, tabX } = lay;
        const pts = [[0, 0]];
        let prev = 0;
        const tops = secTops.map((t, i) => {
            const top = Math.min(max, Math.max(prev, t));
            pts.push([top, tabX[i]]);
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
        if (!lay) measureLayout();
        const max = lay.docH - vh;

        // Read every position first, then write. Mixing the two makes the browser
        // redo the page layout after each change, which is what makes phones stutter.
        const track = measureTrack(y, max);
        const sceneP = motion && !sda ? scenes.map((sc) => {
            const r = sc.getBoundingClientRect();
            if (r.bottom < -vh || r.top > vh * 2) return null;
            return sc.dataset.scene === 'enter'
                ? clamp((vh - r.top) / (vh * 0.8))
                : clamp(-r.top / Math.max(1, r.height - vh));
        }) : [];
        // Cards grow as they near the middle. Worked out from the gallery's progress (the same formula as the CSS),
        // so they never lag a step behind the track after a jump.
        let cardF = null;
        const galleryP = sceneP[scenes.indexOf(gallery)];
        if (motion && !sda && pinnedDist !== null && galleryP != null) {
            cardF = cards.map((card) => clamp(1 - Math.abs(card._c - galleryP * pinnedDist) / (window.innerWidth * 0.9)).toFixed(3));
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
        measureLayout();
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
    const copyText = async (text) => {
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
        return ok;
    };

    document.querySelectorAll('.copy-btn').forEach((copyBtn) => {
        const copyLabel = copyBtn.querySelector('.copy-label');
        const copyStatus = copyBtn.closest('.email-group').querySelector('.copy-status');
        let copyTimer;
        copyBtn.addEventListener('click', async () => {
            const ok = await copyText(copyBtn.dataset.copy);
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
    measureLayout();
    frame();
    window.addEventListener('scroll', request, { passive: true });
    // Anything that changes the page's size (new widths, pinned heights, late fonts) re-measures the layout.
    new ResizeObserver(() => { measureLayout(); request(); }).observe(document.body);
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
    if (document.fonts) document.fonts.ready.then(() => { layoutGallery(); measureLayout(); request(); });

    /* ---------- Command menu (Ctrl+K / ⌘K) ---------- */
    const cmdk = document.getElementById('cmdk');
    const cmdkInput = document.getElementById('cmdk-input');
    const cmdkList = document.getElementById('cmdk-list');
    const cmdkStatus = cmdk.querySelector('.cmdk-status');
    const svg = (paths) => `<svg class="cmdk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    const ICON = {
        go: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
        read: svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 21H20"/>'),
        copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
        open: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
        theme: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
        motion: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
    };
    const firstHref = (sel) => { const a = document.querySelector(sel); return a ? a.href : null; };
    const copyBtnEl = document.querySelector('.copy-btn');
    const email = copyBtnEl ? copyBtnEl.dataset.copy : null;

    const goTo = (hash) => {
        const target = document.querySelector(hash);
        if (!target) return;
        history.pushState(null, '', hash);
        target.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'start' });
        // Keyboard focus moves there too, so Tab carries on from the new spot.
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
    };

    // Built each time the menu opens, so the theme and motion labels match the current state.
    const buildCommands = () => {
        const list = [{ group: 'Go to', label: 'Top of the page', keys: 'intro home start hero', icon: ICON.go, nav: '#top' }];
        checkpoints.forEach(({ a }) => list.push({ group: 'Go to', label: a.textContent.trim(), keys: a.hash.slice(1), icon: ICON.go, nav: a.hash }));
        document.querySelectorAll('[data-panel]').forEach((btn) => {
            const panel = document.getElementById(btn.dataset.panel);
            const title = panel && panel.querySelector('h2, h3');
            if (title) list.push({ group: 'Projects', label: title.textContent.trim(), keys: 'project read case study', icon: ICON.read, panel });
        });
        if (email) {
            list.push({
                group: 'Actions', label: 'Copy email address', hint: email, keys: 'mail contact', icon: ICON.copy,
                run: async () => ((await copyText(email)) ? 'Email copied' : 'Couldn’t copy. Try the button in Contact.'),
            });
        }
        [['Résumé', 'a[href$=".pdf"]', 'resume cv pdf'], ['GitHub', 'a[href*="github.com/"]', 'code repos'], ['LinkedIn', 'a[href*="linkedin.com/"]', 'profile']]
            .forEach(([name, sel, keys]) => {
                const href = firstHref(sel);
                if (href) list.push({ group: 'Actions', label: `Open ${name}`, keys, icon: ICON.open, run: () => { window.open(href, '_blank', 'noopener'); } });
            });
        const next = theme === 'dark' ? 'light' : 'dark';
        list.push({ group: 'Actions', label: `Switch to ${next} theme`, keys: 'dark light mode color', icon: ICON.theme, run: () => { setTheme(next, true); } });
        list.push({ group: 'Actions', label: motion ? 'Turn animations off' : 'Turn animations back on', keys: 'reduce motion animation', icon: ICON.motion, run: () => { setMotion(!motion); } });
        return list.map((c) => ({ ...c, text: `${c.label} ${c.keys} ${c.group}`.toLowerCase() }));
    };

    let commands = [];
    let items = [];
    let active = 0;
    let restoreTo = null;

    const setActive = (i) => {
        if (!items.length) { cmdkInput.removeAttribute('aria-activedescendant'); return; }
        active = (i + items.length) % items.length;
        items.forEach(({ el }, k) => el.setAttribute('aria-selected', String(k === active)));
        cmdkInput.setAttribute('aria-activedescendant', items[active].el.id);
        items[active].el.scrollIntoView({ block: 'nearest' });
    };

    const render = () => {
        const words = cmdkInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const matches = commands.filter((c) => words.every((w) => c.text.includes(w)));
        cmdkList.replaceChildren();
        items = [];
        let groupList = null;
        let groupName = null;
        matches.forEach((c) => {
            if (c.group !== groupName) {
                groupName = c.group;
                const section = document.createElement('li');
                section.setAttribute('role', 'presentation');
                const heading = document.createElement('div');
                heading.className = 'cmdk-group';
                heading.id = `cmdk-g-${groupName.replace(/\W+/g, '-').toLowerCase()}`;
                heading.textContent = groupName;
                groupList = document.createElement('ul');
                groupList.className = 'cmdk-sub';
                groupList.setAttribute('role', 'group');
                groupList.setAttribute('aria-labelledby', heading.id);
                section.append(heading, groupList);
                cmdkList.append(section);
            }
            const idx = items.length;
            const li = document.createElement('li');
            li.className = 'cmdk-item';
            li.id = `cmdk-opt-${idx}`;
            li.setAttribute('role', 'option');
            li.innerHTML = c.icon;
            const label = document.createElement('span');
            label.textContent = c.label;
            li.append(label);
            if (c.hint) {
                const hint = document.createElement('span');
                hint.className = 'cmdk-hint';
                hint.textContent = c.hint;
                li.append(hint);
                li.setAttribute('aria-label', `${c.label}, ${c.hint}`); // so screen readers don't run the two together
            }
            li.addEventListener('pointermove', () => { if (active !== idx) setActive(idx); });
            li.addEventListener('click', () => runCommand(idx));
            items.push({ el: li, cmd: c });
            groupList.append(li);
        });
        if (!items.length) {
            const none = document.createElement('li');
            none.className = 'cmdk-empty';
            none.setAttribute('role', 'presentation');
            none.textContent = 'No matches. Try “projects”, “email”, or “theme”.';
            cmdkList.append(none);
        }
        setActive(0);
    };

    const closeCmdk = () => { if (cmdk.open) cmdk.close(); };
    const openCmdk = () => {
        if (cmdk.open) return;
        restoreTo = document.activeElement;
        setMenu(false);
        commands = buildCommands();
        cmdkInput.value = '';
        cmdkStatus.textContent = '';
        render();
        cmdk.showModal();
        cmdkInput.focus();
    };

    const runCommand = async (i) => {
        const { cmd } = items[i] || {};
        if (!cmd) return;
        if (cmd.nav || cmd.panel) {
            restoreTo = null; // focus moves to the section or panel instead
            closeCmdk();
            if (cmd.nav) goTo(cmd.nav);
            else cmd.panel.showModal();
            return;
        }
        const message = await cmd.run();
        if (message) {
            cmdkStatus.textContent = message;
            setTimeout(closeCmdk, 900);
        } else {
            closeCmdk();
        }
    };

    cmdk.addEventListener('close', () => {
        if (restoreTo && restoreTo.isConnected && restoreTo !== document.body) restoreTo.focus({ preventScroll: true });
        restoreTo = null;
    });
    cmdk.addEventListener('click', (e) => { if (e.target === cmdk) closeCmdk(); }); // a click on the dimmed backdrop
    cmdkInput.addEventListener('input', render);
    cmdkInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); runCommand(active); }
    });
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (cmdk.open) closeCmdk();
            else openCmdk();
        }
    });

    // Footer hint, only on devices with a keyboard and mouse
    const kbdHint = document.querySelector('.footer-kbd');
    if (isMac) document.querySelectorAll('.kbd-mod').forEach((k) => { k.textContent = '⌘'; });
    if (kbdHint && matchMedia('(pointer: fine)').matches) kbdHint.hidden = false;

    /* ---------- A hello for anyone who opens the developer console ---------- */
    const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#e0b25c';
    console.log('%cHi there, fellow developer!', `font: 600 15px/1.6 system-ui, sans-serif; color: ${accent}`);
    console.log(`This site is plain HTML, CSS, and JavaScript, with no framework and no build step.
Have a look at the source: https://github.com/sunnnnyli/sunnnnyli.github.io
Tip: press ${isMac ? '⌘K' : 'Ctrl+K'} on the page to jump anywhere.`);
})();
