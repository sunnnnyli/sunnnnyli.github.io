(() => {
    const root = document.documentElement;
    let motion = root.classList.contains('motion');
    const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
    // Saved choices (theme, contrast, motion). Storage can be blocked, e.g. in some private windows.
    const stored = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
    const store = (key, value) => { try { localStorage.setItem(key, value); } catch (e) {} };
    // Browsers with scroll-driven animations track each scene's progress in CSS (see "Scroll timelines" in styles.css),
    // so the script only measures scenes and cards itself where that isn't supported.
    const sda = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline', 'view()'));
    const isMac = /Mac|iPhone|iPad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
    // Tilt only follows a mouse or trackpad
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

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
    matchMedia('(min-width: 1061px)').addEventListener('change', () => setMenu(false));

    const nav = document.querySelector('.nav');
    // The bar's full height. It slims down once the page scrolls, but sections are still measured against the full bar.
    const NAV_H = nav.offsetHeight;
    const jobsEl = document.querySelector('.jobs');
    const jobEls = [...jobsEl.querySelectorAll('.job')];
    const scenes = [...document.querySelectorAll('[data-scene]')];
    const gallery = document.querySelector('.gallery');
    const cards = [...document.querySelectorAll('.card')];

    const fmt = (el, v) => `${el.dataset.prefix || ''}${Math.round(v).toLocaleString('en-US')}${el.dataset.suffix || ''}`;

    // Toolkit skills become buttons before the marquees copy them (see "Toolkit: where each skill was used")
    document.querySelectorAll('.marquee-track li').forEach((li) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'skill';
        b.setAttribute('aria-pressed', 'false');
        b.textContent = li.textContent;
        li.replaceChildren(b);
    });

    /* ---------- Motion-only setup (runs once, the first time motion is on) ---------- */
    // Wraps each word of an element's text in the span make(word, index) returns, keeping any markup around the words
    const wrapWords = (el, make) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        let i = 0;
        nodes.forEach((node) => {
            const frag = document.createDocumentFragment();
            node.textContent.split(/(\s+)/).forEach((part) => {
                if (!part) return;
                if (/^\s+$/.test(part)) { frag.append(' '); return; }
                frag.append(make(part, i++));
            });
            node.replaceWith(frag);
        });
        return i;
    };

    // Which line each word of a split headline sits on, so the lines can rise one after another. It's measured as
    // the headline comes into view, since where the lines break depends on the screen width and the fonts.
    const numberLines = (headline) => {
        let line = -1;
        let top = -Infinity;
        headline.querySelectorAll('.hl-w').forEach((w) => {
            if (w.offsetTop > top + 2) {
                line++;
                top = w.offsetTop;
            }
            w.style.setProperty('--line', line);
        });
    };
    // Section labels ("01 | Impact") resolve from scrambled characters, a letter at a time, as they come into view.
    // Screen readers get the real label throughout; the scrambled copy is hidden from them.
    const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&*+=<>/';
    const DIGITS = '0123456789';
    const decode = (label) => {
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('.visually-hidden') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
        });
        const parts = [];
        while (walker.nextNode()) parts.push({ node: walker.currentNode, text: walker.currentNode.textContent });
        parts.forEach((part) => {
            const range = document.createRange();
            range.selectNodeContents(part.node);
            part.real = document.createElement('span');
            part.real.className = 'visually-hidden';
            part.real.textContent = part.text;
            part.fake = document.createElement('span');
            part.fake.className = 'decoding';
            part.fake.setAttribute('aria-hidden', 'true');
            part.fake.style.width = `${range.getBoundingClientRect().width}px`;
            part.node.replaceWith(part.real, part.fake);
        });
        const count = parts.reduce((n, part) => n + part.text.length, 0);
        const start = performance.now();
        let shown = -Infinity;
        const step = (now) => {
            const t = now - start;
            const done = !motion || t > 180 + count * 45;
            if (now - shown > 50 || done) {
                shown = now;
                let k = 0;
                parts.forEach((part) => {
                    part.fake.textContent = [...part.text].map((ch) => {
                        const settled = done || ch === ' ' || t >= 180 + k * 45;
                        k++;
                        if (settled) return ch;
                        const set = /\d/.test(ch) ? DIGITS : GLYPHS;
                        return set[Math.floor(Math.random() * set.length)];
                    }).join('');
                });
            }
            if (!done) {
                requestAnimationFrame(step);
                return;
            }
            parts.forEach((part) => {
                part.real.replaceWith(part.node);
                part.fake.remove();
            });
        };
        requestAnimationFrame(step);
    };
    const reveal = (el) => {
        if (el.classList.contains('split')) numberLines(el);
        if (el.classList.contains('eyebrow')) decode(el);
        el.classList.add('in');
    };

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
            const n = wrapWords(el, (word, i) => {
                const s = document.createElement('span');
                s.className = 'w';
                s.style.setProperty('--i', i);
                s.textContent = word;
                return s;
            });
            el.style.setProperty('--n', n);
            // Each highlight's underline draws as its words light up, so it needs its first word and how many it has
            el.querySelectorAll('.hl').forEach((hl) => {
                const words = hl.querySelectorAll('.w');
                if (!words.length) return;
                hl.style.setProperty('--i0', words[0].style.getPropertyValue('--i'));
                hl.style.setProperty('--c', words.length);
            });
        });

        // Section headlines: each word sits in its own clipped box, so it can rise into view from behind its edge
        document.querySelectorAll('.headline').forEach((h) => {
            wrapWords(h, (word) => {
                const box = document.createElement('span');
                box.className = 'hl-w';
                const s = document.createElement('span');
                s.textContent = word;
                box.append(s);
                return box;
            });
            h.classList.add('split');
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
            // The copies are only there for the loop, so keyboard focus skips their buttons
            track.querySelectorAll('[aria-hidden="true"] button').forEach((b) => { b.tabIndex = -1; });
        });

        // Reveal on enter
        const revealer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                reveal(entry.target);
                revealer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
        document.querySelectorAll('.rv, .rv-scale').forEach((el) => revealer.observe(el));

        // Experience: light up the bullet in the middle of the screen
        const focus = new IntersectionObserver((entries) => {
            entries.forEach((entry) => entry.target.classList.toggle('on', entry.isIntersecting));
        }, { rootMargin: '-32% 0px -32% 0px' });
        document.querySelectorAll('.feats li').forEach((li) => focus.observe(li));

        // Impact numbers roll into place like an odometer: each digit is a strip of 0-9 (twice over) that slides up
        // to its value, the later digits spinning a little longer. Screen readers get the plain number.
        // First load only; switching motion on later keeps the plain numbers.
        if (initial) {
            const rollers = document.querySelectorAll('[data-count]');
            rollers.forEach((el) => {
                const text = fmt(el, Number(el.dataset.count));
                const plain = document.createElement('span');
                plain.className = 'visually-hidden';
                plain.textContent = text;
                const odo = document.createElement('span');
                odo.className = 'odo';
                odo.setAttribute('aria-hidden', 'true');
                let place = 0;
                [...text].forEach((ch) => {
                    if (!/\d/.test(ch)) {
                        odo.append(ch);
                        return;
                    }
                    const col = document.createElement('span');
                    col.className = 'odo-col';
                    col.style.setProperty('--n', ch);
                    col.style.setProperty('--i', place++);
                    const strip = document.createElement('span');
                    strip.className = 'odo-strip';
                    strip.textContent = [...'01234567890123456789'].join('\n');
                    col.append(strip);
                    odo.append(col);
                });
                el.replaceChildren(plain, odo);
            });
            const roller = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    roller.unobserve(entry.target);
                    entry.target.classList.add('rolled');
                });
            }, { threshold: 0.6 });
            rollers.forEach((el) => roller.observe(el));
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
    let lastTlLen = null;
    const measureLayout = () => {
        const y = window.scrollY;
        // Experience timeline: each dot's center on the page, read from the CSS so the two always agree
        const dot = getComputedStyle(jobEls[0], '::before');
        const dotOff = parseFloat(dot.top) + parseFloat(dot.height) / 2;
        lay = {
            docH: document.documentElement.scrollHeight,
            width: navTrack.offsetWidth,
            // Less any slide-in offset still to go (Contact's, see .rise in styles.css), so it's where the section settles
            secTops: checkpoints.map(({ sec }) => sec.getBoundingClientRect().top + y - NAV_H - (parseFloat(getComputedStyle(sec).translate.split(' ')[1]) || 0)),
            tabX: checkpoints.map(({ a }) => a.offsetLeft + a.offsetWidth / 2),
            dots: jobEls.map((job) => job.getBoundingClientRect().top + y + dotOff),
        };
        const len = `${(lay.dots[lay.dots.length - 1] - lay.dots[0]).toFixed(1)}px`;
        if (len !== lastTlLen) {
            lastTlLen = len;
            jobsEl.style.setProperty('--tl-len', len);
        }
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
    let lastSlim = null;
    let lastTl = null;
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
        // The top bar slims once the page moves and grows back at the very top
        const slim = y > 40;
        if (slim !== lastSlim) {
            lastSlim = slim;
            nav.classList.toggle('slim', slim);
        }
        // Experience timeline: the line fills down to the middle of the screen, and each dot it reaches lights up
        if (motion) {
            const { dots } = lay;
            const line = y + vh * 0.5;
            const tl = clamp((line - dots[0]) / Math.max(1, dots[dots.length - 1] - dots[0])).toFixed(4);
            if (tl !== lastTl) {
                lastTl = tl;
                jobsEl.style.setProperty('--tl', tl);
            }
            jobEls.forEach((job, i) => {
                const lit = line >= dots[i];
                if (job._lit === lit) return;
                job._lit = lit;
                job.classList.toggle('lit', lit);
            });
        }
        const scroll = max > 0 ? (y / max).toFixed(4) : '0';
        if (scroll !== lastScroll) {
            lastScroll = scroll;
            nav.style.setProperty('--scroll', scroll);
            toTop.style.setProperty('--scroll', scroll); // fills the ring around the phone's back-to-top button
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
        const navH = NAV_H;
        const mark = [...document.querySelectorAll('main h1, main h2, .story-text, .tile, .job-side, .feats li, .card, .marquee, .contact-sub')]
            .find((el) => el.getBoundingClientRect().bottom > navH);
        const before = mark ? mark.getBoundingClientRect().top : 0;

        motion = on;
        root.classList.toggle('motion', on);
        store('motion', on ? 'on' : 'off');

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
                if (el.getBoundingClientRect().top < window.innerHeight) reveal(el);
            });
        }

        syncMotionBtn();
        request();
    };

    motionBtn.addEventListener('click', () => setMotion(!motion));

    /* ---------- Back to top (phones) ---------- */
    const toTop = document.querySelector('.to-top');

    /* ---------- Project panels ---------- */
    // With motion on, a card grows into its write-up and shrinks back into place on close (a view transition).
    // Without view transitions, or when the card isn't on screen (opened from the command menu), the panel slides in.
    const panelCard = new Map();
    const onScreen = (el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    };
    let morphing = false;
    const morph = (from, to, update) => {
        if (morphing || !motion || !document.startViewTransition) {
            update();
            return;
        }
        morphing = true;
        root.classList.add('vt-morph');
        from.classList.add('morphing');
        const vt = document.startViewTransition(() => {
            from.classList.remove('morphing');
            update();
            to.classList.add('morphing');
        });
        const done = () => {
            to.classList.remove('morphing');
            root.classList.remove('vt-morph');
            morphing = false;
        };
        vt.ready.catch(() => {});
        vt.finished.then(done, done);
    };
    // Each write-up has its own link (#vm, #pocer, #journal). Opening one puts its link in the address bar,
    // closing it puts the address back, and visiting the link opens the write-up straight away.
    const slugOf = (panel) => panel.id.replace(/^panel-/, '');
    const panelFromHash = () => {
        let slug = '';
        try { slug = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
        const el = slug && document.getElementById(`panel-${slug}`);
        return el && el.classList.contains('panel') ? el : null;
    };
    const showPanelUrl = (panel) => {
        const hash = `#${slugOf(panel)}`;
        panel._returnUrl = location.hash === hash ? location.pathname + location.search : location.href;
        if (location.hash !== hash) history.replaceState(history.state, '', hash);
    };
    // Inside a write-up, the headings, paragraphs, and chips below the first screen rise in as you scroll to them.
    // What's on screen when it opens shows at once.
    const partsOf = (panel) => panel.querySelectorAll('.panel-inner > :is(h3, p:not(.panel-meta), .chips, .panel-next)');
    const settleParts = (panel) => {
        panel.scrollTop = 0;
        if (!motion) return;
        if (!panel._parts) {
            panel._parts = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.remove('now');
                    entry.target.classList.add('in');
                    panel._parts.unobserve(entry.target);
                });
            }, { root: panel, rootMargin: '0px 0px -6% 0px' });
        }
        const fold = panel.clientHeight * 0.94;
        partsOf(panel).forEach((el) => {
            const shown = el.offsetTop < fold;
            el.classList.add('pr');
            el.classList.toggle('in', shown);
            el.classList.toggle('now', shown);
            if (!shown) panel._parts.observe(el);
        });
    };
    const openPanel = (panel) => {
        if (panel.open) return;
        const card = panelCard.get(panel);
        const grow = motion && !!document.startViewTransition && !morphing && !!card && onScreen(card);
        panel.classList.toggle('grown', grow);
        panel._shrink = grow; // closing shrinks it back into its card
        const show = () => {
            panel.showModal();
            settleParts(panel);
        };
        if (grow) morph(card, panel, show);
        else show();
        showPanelUrl(panel);
    };
    const closePanel = (panel) => {
        if (!panel.open) return;
        const card = panelCard.get(panel);
        if (panel._shrink && card && onScreen(card)) morph(panel, card, () => panel.close());
        else panel.close();
    };
    // "Next project" at the end of each write-up steps through them in card order without closing. The page behind
    // moves to that project's card, so closing still shrinks back into the right one.
    const panels = [...document.querySelectorAll('.panel')];
    const switchPanel = (from, to) => {
        const returnUrl = from._returnUrl; // closing the next one puts the address back to where the first began
        from.close();
        const card = panelCard.get(to);
        if (card) scrollToCard(card, 'instant');
        to.classList.remove('grown');
        to._shrink = motion && !!card; // closePanel checks the card is on screen by then
        to.showModal();
        settleParts(to);
        showPanelUrl(to);
        to._returnUrl = returnUrl;
    };
    panels.forEach((panel, i) => {
        const next = panels[(i + 1) % panels.length];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'panel-next';
        btn.innerHTML = '<span class="panel-next-label">Next project</span> <span class="panel-next-name"></span>';
        btn.querySelector('.panel-next-name').textContent = next.querySelector('h2').textContent;
        btn.insertAdjacentHTML('beforeend', '<span class="chev" aria-hidden="true">→</span>');
        btn.addEventListener('click', () => switchPanel(panel, next));
        panel.querySelector('.panel-inner').append(btn);
    });
    document.querySelectorAll('[data-panel]').forEach((btn) => {
        const panel = document.getElementById(btn.dataset.panel);
        panelCard.set(panel, btn.closest('.card'));
        btn.addEventListener('click', () => openPanel(panel));
    });
    document.querySelectorAll('.panel').forEach((panel) => {
        panel.querySelector('.panel-close').addEventListener('click', () => closePanel(panel));
        // A thin line along the top fills as the write-up is read
        const progress = document.createElement('div');
        progress.className = 'panel-progress';
        progress.setAttribute('aria-hidden', 'true');
        progress.append(document.createElement('span'));
        panel.prepend(progress);
        let readTick = false;
        panel.addEventListener('scroll', () => {
            if (readTick) return;
            readTick = true;
            requestAnimationFrame(() => {
                readTick = false;
                const max = panel.scrollHeight - panel.clientHeight;
                panel.style.setProperty('--read', max > 0 ? clamp(panel.scrollTop / max).toFixed(4) : '0');
            });
        }, { passive: true });
        // A click on the dimmed backdrop (outside the sheet) closes it too.
        panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(panel); });
        // Esc shrinks it back into its card as well
        panel.addEventListener('cancel', (e) => {
            if (!panel._shrink) return;
            e.preventDefault();
            closePanel(panel);
        });
        panel.addEventListener('close', () => {
            if (location.hash === `#${slugOf(panel)}`) history.replaceState(history.state, '', panel._returnUrl || location.pathname + location.search);
        });

        // Copy link: a link that opens this write-up directly
        const linkBtn = panel.querySelector('.panel-link');
        const linkLabel = linkBtn.querySelector('.panel-link-label');
        const linkStatus = panel.querySelector('.panel-status');
        let linkTimer;
        linkBtn.addEventListener('click', async () => {
            const ok = await copyText(`${location.origin}${location.pathname}#${slugOf(panel)}`);
            linkBtn.classList.toggle('copied', ok);
            if (ok) tap();
            linkLabel.textContent = ok ? 'Copied' : 'Copy failed';
            linkStatus.textContent = ok ? 'Link copied' : 'Could not copy the link';
            clearTimeout(linkTimer);
            linkTimer = setTimeout(() => {
                linkBtn.classList.remove('copied');
                linkLabel.textContent = 'Copy link';
                linkStatus.textContent = '';
            }, 2000);
        });
    });
    // Phones: the write-up sheet can be pulled down from its top to close. It follows the finger, closes past a
    // quarter of its height (or on a quick flick), and springs back otherwise. Scrolling inside it works as usual.
    const sheetLayout = matchMedia('(max-width: 760px)');
    panels.forEach((panel) => {
        let startY = 0;
        let startT = 0;
        let pull = 0;
        let state = 'idle'; // 'maybe' until the first move shows which way the finger is going, then 'drag'
        const setPull = (px) => {
            pull = px;
            panel.style.transform = px ? `translateY(${px}px)` : '';
            panel.style.setProperty('--pull', (px / panel.offsetHeight).toFixed(3));
        };
        panel.addEventListener('touchstart', (e) => {
            state = sheetLayout.matches && e.touches.length === 1 && panel.scrollTop <= 0 ? 'maybe' : 'idle';
            startY = e.touches[0].clientY;
            startT = performance.now();
        }, { passive: true });
        panel.addEventListener('touchmove', (e) => {
            if (state === 'idle') return;
            const dy = e.touches[0].clientY - startY;
            if (state === 'maybe') {
                if (Math.abs(dy) < 6) return;
                state = dy > 0 ? 'drag' : 'idle'; // a push up is an ordinary scroll
                if (state === 'idle') return;
                panel.style.transition = 'none';
            }
            e.preventDefault();
            setPull(Math.max(0, dy));
        }, { passive: false });
        const release = () => {
            if (state !== 'drag') {
                state = 'idle';
                return;
            }
            state = 'idle';
            const flick = pull / Math.max(1, performance.now() - startT) > 0.6;
            const close = pull > panel.offsetHeight * 0.25 || (flick && pull > 40);
            panel.style.transition = motion ? 'transform 0.28s cubic-bezier(0.2, 0.7, 0.3, 1)' : 'none';
            if (close) {
                let closed = false;
                const done = () => {
                    if (closed) return;
                    closed = true;
                    panel.close();
                    panel.style.transition = '';
                    setPull(0);
                };
                if (!motion) {
                    done();
                    return;
                }
                setPull(panel.offsetHeight);
                panel.addEventListener('transitionend', done, { once: true });
                setTimeout(done, 400); // in case the slide never reports finishing
            } else {
                setPull(0);
            }
        };
        panel.addEventListener('touchend', release);
        panel.addEventListener('touchcancel', release);
    });

    // A write-up link followed while the page is already open
    window.addEventListener('hashchange', () => {
        const panel = panelFromHash();
        if (panel && !panel.open) openPanel(panel);
    });

    /* ---------- Footer: last updated ---------- */
    // GitHub Pages sends the deploy date; a local file reports "now", so keep the written date then.
    const lastMod = new Date(document.lastModified);
    if (!Number.isNaN(lastMod.getTime()) && Date.now() - lastMod.getTime() > 120000) {
        document.getElementById('updated').textContent = lastMod.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    /* ---------- Copy email ---------- */
    // A light tap of vibration when something's copied on a touch screen that supports it (Android; iPhones don't
    // allow it, so it does nothing there)
    const tap = () => {
        if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) {
            try { navigator.vibrate(12); } catch (e) {}
        }
    };
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
            (document.querySelector('dialog[open]') || document.body).append(t); // a box outside an open dialog can't be selected
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
            if (ok) tap();
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
    const schemeMeta = document.querySelector('meta[name="color-scheme"]');
    let theme = root.dataset.theme;
    const favicon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    const favDark = favicon ? favicon.href : '';
    const favLight = favicon ? new URL(favicon.dataset.light, document.baseURI).href : '';
    // Safari on iPhone and iPad colors its bars from the solid boxes at the screen's edges (see .edge in styles.css),
    // but only looks at them again when a fixed box comes or goes, so a theme change adds one for a moment. Safari can't
    // read them while an animated switch runs, so then it adds one when the switch ends.
    let switching = false;
    const retint = () => {
        if (switching || !CSS.supports('-webkit-touch-callout', 'none')) return;
        const probe = document.createElement('div');
        probe.className = 'edge-probe';
        document.body.append(probe);
        requestAnimationFrame(() => requestAnimationFrame(() => probe.remove()));
    };
    const syncThemeBtn = () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        themeBtn.setAttribute('aria-label', `Switch to ${next} theme`);
        themeBtn.title = `Switch to ${next} theme`;
        themeMeta.content = theme === 'dark' ? '#1c1c1d' : '#f2f4f6';
        schemeMeta.content = theme;
        if (favicon) favicon.href = theme === 'dark' ? favDark : favLight;
        retint();
    };
    const setTheme = (t, remember, origin) => {
        theme = t;
        if (remember) store('theme', t);
        const apply = () => { root.dataset.theme = theme; syncThemeBtn(); };
        // The new theme spreads out in a circle from the button; instant otherwise or with motion off.
        if (motion && document.startViewTransition) {
            switching = true;
            const vt = document.startViewTransition(apply);
            vt.finished.finally(() => {
                switching = false;
                retint();
            }).catch(() => {});
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
        if (!stored('theme')) setTheme(e.matches ? 'light' : 'dark', false);
    });
    syncThemeBtn();
    syncMotionBtn();

    /* ---------- More contrast ---------- */
    // The toggle remembers the visitor's choice; until they make one, it follows their system setting.
    const contrastBtn = document.querySelector('.contrast-btn');
    let contrast = root.classList.contains('contrast');
    const syncContrastBtn = () => {
        contrastBtn.setAttribute('aria-pressed', String(contrast));
        contrastBtn.title = contrast ? 'Turn high contrast off' : 'More contrast';
    };
    const setContrast = (on, remember) => {
        contrast = on;
        root.classList.toggle('contrast', on);
        if (remember) store('contrast', on ? 'more' : 'normal');
        syncContrastBtn();
    };
    contrastBtn.addEventListener('click', () => setContrast(!contrast, true));
    // Coming back from the résumé, the browser can restore this page just as it was left, so it picks up any switch
    // flipped over there
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        const t = stored('theme');
        const nextTheme = t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        if (nextTheme !== theme) {
            theme = nextTheme;
            root.dataset.theme = theme;
            syncThemeBtn();
        }
        const c = stored('contrast');
        const more = c ? c === 'more' : matchMedia('(prefers-contrast: more)').matches;
        if (more !== contrast) setContrast(more, false);
        const m = stored('motion');
        setMotion(m ? m === 'on' : !matchMedia('(prefers-reduced-motion: reduce)').matches);
    });
    matchMedia('(prefers-contrast: more)').addEventListener('change', (e) => {
        if (!stored('contrast')) setContrast(e.matches, false);
    });
    syncContrastBtn();

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
    // Late fonts change line lengths, so measure again once they're in
    if (document.fonts) document.fonts.ready.then(() => { layoutGallery(); measureLayout(); request(); });

    /* ---------- Looping animations rest while off screen ---------- */
    // The intro's glow and ring, the project diagrams, and the toolkit marquees pause whenever they're out of view
    // The first time a project diagram comes into view it draws itself in (see "Diagrams draw in" in styles.css)
    const idleObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            e.target.classList.toggle('idle', !e.isIntersecting);
            if (e.isIntersecting && e.target.matches('.art-dg')) e.target.classList.add('drawn');
        });
    });
    // Each part of a diagram gets its place across it (--x, 0 to 1) so the drawing builds left to right, and each
    // connecting line a length of 1 so it can draw along itself
    document.querySelectorAll('.art-dg svg').forEach((svg) => {
        const width = svg.viewBox.baseVal.width || 300;
        [...svg.children].forEach((el) => {
            if (el.matches('.dg-line')) el.setAttribute('pathLength', '1');
            try {
                const b = el.getBBox();
                el.style.setProperty('--x', clamp((b.x + b.width / 2) / width).toFixed(2));
            } catch (err) {}
        });
    });
    document.querySelectorAll('.hero-sticky, .art-dg, .marquee').forEach((el) => idleObserver.observe(el));

    /* ---------- Toolkit marquees answer the scroll ---------- */
    // Scrolling gives the skill rows a push: they run faster in the direction the page moves (backwards when
    // scrolling up), then ease back to their usual drift.
    const tracks = [...document.querySelectorAll('.marquee-track')];
    let push = 0; // extra speed on top of the usual 1x
    let pushY = window.scrollY;
    let pushT = performance.now();
    let pushing = false;
    const setRate = (rate) => tracks.forEach((t) => t.getAnimations().forEach((a) => a.updatePlaybackRate(rate)));
    const easePush = () => {
        push *= 0.92;
        if (Math.abs(push) < 0.02) {
            push = 0;
            pushing = false;
            setRate(1);
            return;
        }
        setRate(1 + push);
        requestAnimationFrame(easePush);
    };
    window.addEventListener('scroll', () => {
        const now = performance.now();
        const speed = (window.scrollY - pushY) / Math.max(8, now - pushT); // px per ms
        pushY = window.scrollY;
        pushT = now;
        if (!motion || tracks.every((t) => t.parentElement.classList.contains('idle'))) return;
        push += (clamp(speed * 2.5, -4, 5) - push) * 0.4;
        if (!pushing) {
            pushing = true;
            requestAnimationFrame(easePush);
        }
    }, { passive: true });

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
        contrast: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
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
        const list = [];
        checkpoints.forEach(({ a }) => list.push({
            group: 'Go to', label: a.textContent.trim(), keys: a.hash === '#top' ? 'top intro home start hero story' : a.hash.slice(1), icon: ICON.go, nav: a.hash,
        }));
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
        [['Résumé', 'a[href="resume.html"]', 'resume cv pdf', true], ['GitHub', 'a[href*="github.com/"]', 'code repos'], ['LinkedIn', 'a[href*="linkedin.com/"]', 'profile']]
            .forEach(([name, sel, keys, sameTab]) => {
                const href = firstHref(sel);
                const run = sameTab ? () => { location.href = href; } : () => { window.open(href, '_blank', 'noopener'); };
                if (href) list.push({ group: 'Actions', label: `Open ${name}`, keys, icon: ICON.open, run });
            });
        const next = theme === 'dark' ? 'light' : 'dark';
        list.push({ group: 'Actions', label: `Switch to ${next} theme`, keys: 'dark light mode color', icon: ICON.theme, run: () => { setTheme(next, true); } });
        list.push({ group: 'Actions', label: motion ? 'Turn animations off' : 'Turn animations back on', keys: 'reduce motion animation', icon: ICON.motion, run: () => { setMotion(!motion); } });
        list.push({ group: 'Actions', label: contrast ? 'Turn high contrast off' : 'Turn high contrast on', keys: 'contrast accessibility readability', icon: ICON.contrast, run: () => { setContrast(!contrast, true); } });
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
            else openPanel(cmd.panel);
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

    /* ---------- Signature hand-off ---------- */
    // Once the footer's signature is on screen it takes over: the top bar shows my name in type for the moment,
    // and the footer's signature signs itself. Scrolling back up hands the signature back to the top bar.
    const footSig = document.querySelector('.footer-name .sig');
    if (footSig) new IntersectionObserver(([entry]) => root.classList.toggle('handoff', entry.isIntersecting)).observe(footSig);

    /* ---------- Spotlight and gentle 3D tilt ---------- */
    // The portrait, project cards, impact and education tiles, and toolkit skills lean toward a mouse pointer while a
    // soft glare slides across them, and cards and tiles light up under it. One listener covers them all (the
    // marquee's copied skills too), and it reads and writes at most once per frame.
    const TILT = [['.hero-photo', 10], ['.card', 5], ['.tile', 5], ['.skill', 12]]; // the most each one leans, in degrees
    const tiltTargets = TILT.map(([sel]) => sel).join(', ');
    let tiltEl = null;
    let lastPointer = null;
    let pointerQueued = false;
    const untilt = () => {
        if (!tiltEl) return;
        tiltEl.classList.remove('tilted');
        tiltEl.style.setProperty('--rx', '0deg');
        tiltEl.style.setProperty('--ry', '0deg');
        tiltEl = null;
    };
    const followPointer = () => {
        pointerQueued = false;
        const e = lastPointer;
        const el = e.target.closest(tiltTargets);
        if (el !== tiltEl) untilt();
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (el.classList.contains('spot')) {
            el.style.setProperty('--mx', `${e.clientX - r.left}px`);
            el.style.setProperty('--my', `${e.clientY - r.top}px`);
        }
        if (!motion || e.pointerType !== 'mouse' || !finePointer.matches) return;
        const [, max] = TILT.find(([sel]) => el.matches(sel));
        const x = clamp((e.clientX - r.left) / r.width) - 0.5;
        const y = clamp((e.clientY - r.top) / r.height) - 0.5;
        // Wide or tall things lean less along that side, so a full-width tile doesn't swing out at its edges
        el.style.setProperty('--rx', `${(-y * max * Math.min(1, 640 / r.height)).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${(x * max * Math.min(1, 640 / r.width)).toFixed(2)}deg`);
        el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
        el.classList.add('tilted');
        tiltEl = el;
    };
    document.addEventListener('pointermove', (e) => {
        lastPointer = e;
        if (pointerQueued) return;
        pointerQueued = true;
        requestAnimationFrame(followPointer);
    }, { passive: true });
    // Settle back when the pointer leaves the window, or when scrolling moves things out from under it
    document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) untilt(); });
    window.addEventListener('scroll', untilt, { passive: true });

    /* ---------- Page dots for the swipeable project row ---------- */
    // Shown when the row scrolls sideways on its own (phones, or with motion off) instead of following the page.
    const row = gallery.querySelector('.gallery-sticky');
    const dotRow = gallery.querySelector('.gallery-dots');
    const offCenter = (card) => {
        const r = row.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return c.left + c.width / 2 - (r.left + r.width / 2);
    };
    const scrollRowTo = (card) => {
        if (pinnedDist === null) row.scrollBy({ left: offCenter(card), behavior: motion ? 'smooth' : 'auto' });
    };
    // Brings a project card into view: when the row is pinned it slides with the page, so scroll the page to
    // where the card reaches the middle; otherwise scroll down to the row and then along it.
    const scrollToCard = (card, behavior = motion ? 'smooth' : 'auto') => {
        if (pinnedDist !== null) {
            const top = gallery.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: top + clamp(card._c, 0, pinnedDist), behavior });
        } else {
            row.scrollIntoView({ behavior, block: 'start' });
            row.scrollBy({ left: offCenter(card), behavior });
        }
    };
    let dotQueued = false;
    let currentDot = -1;
    // Where the last click is headed, so quick repeat clicks on an arrow keep stepping while the row is still sliding
    let aimed = null;
    let aimTimer;
    const aimAt = (i) => {
        aimed = clamp(i, 0, cards.length - 1);
        clearTimeout(aimTimer);
        aimTimer = setTimeout(() => { aimed = null; }, 900);
        scrollRowTo(cards[aimed]);
    };
    const arrow = (dir, label, path) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gallery-arrow';
        b.setAttribute('aria-label', label);
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
        b.addEventListener('click', () => aimAt((aimed !== null ? aimed : currentDot) + dir));
        return b;
    };
    const prevBtn = arrow(-1, 'Previous project', 'M15 5l-7 7 7 7');
    const nextBtn = arrow(1, 'Next project', 'M9 5l7 7-7 7');
    const dotList = document.createElement('span');
    dotList.className = 'gallery-dot-list';
    const pageDots = cards.map((card, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gallery-dot';
        b.setAttribute('aria-label', `Project ${i + 1} of ${cards.length}: ${card.querySelector('h3').textContent.trim()}`);
        b.addEventListener('click', () => aimAt(i));
        dotList.append(b);
        return b;
    });
    dotRow.append(prevBtn, dotList, nextBtn);
    const syncDots = () => {
        dotQueued = false;
        let best = 0;
        let bestOff = Infinity;
        cards.forEach((card, i) => {
            const off = Math.abs(offCenter(card));
            if (off < bestOff) {
                bestOff = off;
                best = i;
            }
        });
        if (best === currentDot) return;
        currentDot = best;
        pageDots.forEach((d, i) => {
            if (i === best) d.setAttribute('aria-current', 'true');
            else d.removeAttribute('aria-current');
        });
        // At either end the arrow dims but keeps focus, so keyboard users aren't dropped back to the top of the page
        prevBtn.setAttribute('aria-disabled', String(best === 0));
        nextBtn.setAttribute('aria-disabled', String(best === cards.length - 1));
    };
    const queueDots = () => {
        if (dotQueued) return;
        dotQueued = true;
        requestAnimationFrame(syncDots);
    };
    row.addEventListener('scroll', queueDots, { passive: true });
    window.addEventListener('resize', queueDots);
    syncDots();

    /* ---------- Toolkit: where each skill was used ---------- */
    // Picking a skill marks the roles and projects that used it (each lists its skills in data-skills)
    // and lists them under the toolkit as links that jump there.
    const work = [...document.querySelectorAll('[data-skills]')].map((el) => ({
        el,
        name: el.dataset.name,
        kind: el.classList.contains('job') ? 'Role' : 'Project',
        skills: el.dataset.skills.split(',').map((x) => x.trim()),
    }));
    // Toolkit names that the chips on the page spell differently
    const chipNames = { 'Git/GitHub': ['Git'], 'Forge (Foundry)': ['Forge'], Flask: ['Flask API'] };
    // What this site itself is built with
    const siteSkills = ['HTML/CSS', 'JavaScript'];
    const siteSource = 'https://github.com/sunnnnyli/sunnnnyli.github.io';
    const hits = document.querySelector('.skill-hits');
    const toolkitHint = document.querySelector('.toolkit-hint');
    let picked = null;
    let pickedFrom = null;

    const flash = (el) => {
        el.classList.remove('flash');
        void el.offsetWidth; // restarts the pulse if it's already running
        el.classList.add('flash');
        clearTimeout(el._flash);
        el._flash = setTimeout(() => el.classList.remove('flash'), 1500);
    };

    const showWork = (el) => {
        if (el.classList.contains('card')) {
            scrollToCard(el);
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
            el.focus({ preventScroll: true });
        } else {
            goTo(`#${el.id}`);
        }
        flash(el);
    };

    const pick = (label) => {
        picked = picked === label ? null : label;
        document.querySelectorAll('.skill').forEach((b) => {
            const on = b.textContent === picked;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on));
        });
        const names = picked ? [picked, ...(chipNames[picked] || [])] : [];
        work.forEach(({ el, skills }) => {
            el.classList.toggle('skill-hit', skills.includes(picked));
            el.querySelectorAll('.chips li').forEach((li) => li.classList.toggle('chip-hit', names.includes(li.textContent.trim())));
        });
        hits.replaceChildren();
        if (!picked) return;

        const found = work.filter((w) => w.skills.includes(picked));
        const onSite = siteSkills.includes(picked);
        const lead = document.createElement('p');
        lead.className = 'skill-lead';
        const name = document.createElement('strong');
        name.textContent = picked;
        lead.append(name, found.length || onSite ? ' shows up in' : ' is in my toolkit, but not in the work shown here.');
        hits.append(lead);

        if (found.length || onSite) {
            const list = document.createElement('ul');
            list.className = 'skill-links';
            const add = (kind, label, href, go) => {
                const a = document.createElement('a');
                a.className = 'skill-link';
                a.href = href;
                const k = document.createElement('span');
                k.className = 'skill-kind';
                k.textContent = kind;
                a.append(k, label);
                if (go) {
                    a.addEventListener('click', (e) => {
                        e.preventDefault();
                        go();
                    });
                } else {
                    a.target = '_blank';
                    a.rel = 'noopener';
                }
                const li = document.createElement('li');
                li.append(a);
                list.append(li);
            };
            found.forEach((w) => add(w.kind, w.name, `#${w.el.id}`, () => showWork(w.el)));
            if (onSite) add('Code', 'This site', siteSource);
            hits.append(list);
        }

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'skill-clear';
        clear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>Clear';
        clear.addEventListener('click', () => {
            pick(picked);
            if (pickedFrom) pickedFrom.focus();
        });
        hits.append(clear);
    };

    document.querySelector('.toolkit').addEventListener('click', (e) => {
        const b = e.target.closest('.skill');
        if (!b) return;
        // Keyboard focus returns to the real button later, not one of the marquee's hidden copies
        pickedFrom = b.closest('[aria-hidden="true"]')
            ? [...document.querySelectorAll('.skill')].find((x) => x.textContent === b.textContent && !x.closest('[aria-hidden="true"]'))
            : b;
        pick(b.textContent);
    });
    if (toolkitHint) toolkitHint.hidden = false;

    /* ---------- A hidden surprise: ↑ ↑ ↓ ↓ ← → ← → B A ---------- */
    const toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.append(toastEl);
    let toastTimer;
    const toast = (text) => {
        toastEl.textContent = text;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
    };

    // Confetti in honey and coral, drawn on a canvas that removes itself once the last piece has fallen
    const confetti = () => {
        const cv = document.createElement('canvas');
        cv.className = 'confetti';
        cv.setAttribute('aria-hidden', 'true');
        document.body.append(cv);
        const W = window.innerWidth;
        const H = window.innerHeight;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = W * dpr;
        cv.height = H * dpr;
        const ctx = cv.getContext('2d');
        ctx.scale(dpr, dpr);
        const colors = ['#e0b25c', '#f3d08f', '#c99a4e', '#a84a33', '#d98a76', '#f0a08a'];
        const power = Math.sqrt(H / 800);
        const bits = [];
        // Two bursts, one from each bottom corner, aimed up and inward
        [[0, -60], [W, -120]].forEach(([x0, aim]) => {
            for (let i = 0; i < 90; i++) {
                const a = ((aim + (Math.random() - 0.5) * 40) * Math.PI) / 180;
                const speed = (16 + Math.random() * 12) * power;
                bits.push({
                    x: x0,
                    y: H + 10,
                    vx: Math.cos(a) * speed,
                    vy: Math.sin(a) * speed,
                    w: 6 + Math.random() * 6,
                    h: 4 + Math.random() * 6,
                    r: Math.random() * Math.PI,
                    vr: (Math.random() - 0.5) * 0.3,
                    flip: Math.random() * Math.PI,
                    vf: 0.08 + Math.random() * 0.12,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    round: Math.random() < 0.3,
                });
            }
        });
        const t0 = performance.now();
        let last = t0;
        const step = (now) => {
            const dt = Math.min(3, (now - last) / 16.67);
            last = now;
            const age = now - t0;
            ctx.clearRect(0, 0, W, H);
            ctx.globalAlpha = age > 3800 ? Math.max(0, 1 - (age - 3800) / 700) : 1;
            let falling = 0;
            bits.forEach((b) => {
                // Air slows the pieces more on the way down, so they flutter instead of dropping
                b.vx *= Math.pow(0.985, dt);
                b.vy = b.vy * Math.pow(b.vy < 0 ? 0.985 : 0.95, dt) + 0.32 * dt;
                b.x += (b.vx + Math.sin(b.flip) * 0.6) * dt;
                b.y += b.vy * dt;
                b.r += b.vr * dt;
                b.flip += b.vf * dt;
                if (b.y < H + 20) falling++;
                ctx.save();
                ctx.translate(b.x, b.y);
                ctx.rotate(b.r);
                ctx.scale(1, Math.cos(b.flip));
                ctx.fillStyle = b.color;
                if (b.round) {
                    ctx.beginPath();
                    ctx.arc(0, 0, b.h / 2 + 1, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
                }
                ctx.restore();
            });
            if (falling && age < 4500) requestAnimationFrame(step);
            else cv.remove();
        };
        requestAnimationFrame(step);
    };

    const secret = 'arrowup arrowup arrowdown arrowdown arrowleft arrowright arrowleft arrowright b a';
    let typed = [];
    document.addEventListener('keydown', (e) => {
        if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
        typed = [...typed, e.key.toLowerCase()].slice(-10);
        if (typed.join(' ') !== secret) return;
        typed = [];
        toast('You found my secret. Thanks for poking around!');
        if (motion) confetti();
    });

    /* ---------- Links to sections ---------- */
    // A small link button beside each section's label copies a link straight to that section
    const LINK_ICON = '<svg class="i-link" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.6l-1.3 1.3"/><path d="M14 10.5a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.6l1.3-1.3"/></svg>';
    const CHECK_ICON = '<svg class="i-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    checkpoints.forEach(({ a, sec }) => {
        const label = sec.querySelector('.eyebrow');
        if (!label) return;
        const name = a.textContent.trim();
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'anchor-btn';
        b.title = 'Copy link';
        b.setAttribute('aria-label', `Copy a link to ${name}`);
        b.innerHTML = LINK_ICON + CHECK_ICON;
        label.after(b);
        let timer;
        b.addEventListener('click', async () => {
            const ok = await copyText(`${location.origin}${location.pathname}#${sec.id}`);
            b.classList.toggle('copied', ok);
            if (ok) tap();
            toast(ok ? `Link to ${name} copied` : 'Couldn’t copy the link');
            clearTimeout(timer);
            timer = setTimeout(() => b.classList.remove('copied'), 1800);
        });
    });

    /* ---------- Dot grid in the intro ---------- */
    // With a mouse and motion on, the intro's dots are drawn on a canvas, so the ones near the pointer can light up
    // in the accent color and ease outward a little. Dots behind the text stay quiet, so it's always easy to read.
    // It only draws while something is changing.
    const dotGrid = document.querySelector('.dot-grid');
    if (dotGrid && finePointer.matches) {
        const cv = document.createElement('canvas');
        cv.setAttribute('aria-hidden', 'true');
        dotGrid.append(cv);
        dotGrid.classList.add('live');
        const ctx = cv.getContext('2d');
        const GAP = 28; // the CSS grid's spacing, so the canvas dots sit exactly where the CSS ones were
        const REACH = 150; // how far from the pointer the dots respond
        const CLEAR = 24; // dots fade out over this distance as they get near text
        const pt = { x: 0, y: 0, tx: 0, ty: 0, k: 0, tk: 0 };
        let w = 0;
        let h = 0;
        let dpr = 1;
        let ink = '';
        let glow = '';
        let raf = 0;
        const readColors = () => {
            const cs = getComputedStyle(root);
            ink = cs.getPropertyValue('--ink-rgb').trim();
            glow = cs.getPropertyValue('--accent-rgb').trim();
        };
        const fit = () => {
            dpr = Math.min(2, window.devicePixelRatio || 1);
            w = dotGrid.clientWidth;
            h = dotGrid.clientHeight;
            cv.width = Math.round(w * dpr);
            cv.height = Math.round(h * dpr);
        };
        // The boxes of every line of text in the intro (and the proverb), relative to the dot grid
        const textBoxes = () => {
            const g = dotGrid.getBoundingClientRect();
            const range = document.createRange();
            const boxes = [];
            document.querySelectorAll('.hero-copy > *, .hero-quote').forEach((el) => {
                range.selectNodeContents(el);
                [...range.getClientRects()].forEach((r) => {
                    if (r.width && r.height) boxes.push([r.left - g.left, r.top - g.top, r.right - g.left, r.bottom - g.top]);
                });
            });
            return boxes;
        };
        const nearText = (boxes, x, y) => {
            let d = Infinity;
            for (const [l, t, r, b] of boxes) {
                d = Math.min(d, Math.hypot(Math.max(l - x, 0, x - r), Math.max(t - y, 0, y - b)));
                if (d === 0) break;
            }
            return clamp(d / CLEAR);
        };
        const draw = () => {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            const boxes = pt.k > 0.01 ? textBoxes() : [];
            // Resting dots go in one path; the ones near the pointer are drawn after, bigger and in the accent color
            const lit = [];
            ctx.beginPath();
            for (let y = GAP / 2; y < h; y += GAP) {
                for (let x = GAP / 2; x < w; x += GAP) {
                    const dx = x - pt.x;
                    const dy = y - pt.y;
                    const d = Math.hypot(dx, dy);
                    let t = pt.k * clamp(1 - d / REACH);
                    if (t >= 0.01) t *= nearText(boxes, x, y);
                    if (t < 0.01) {
                        ctx.moveTo(x + 1, y);
                        ctx.arc(x, y, 1, 0, Math.PI * 2);
                    } else {
                        const e = t * t * (3 - 2 * t);
                        const push = d ? (e * 6) / d : 0;
                        lit.push([x + dx * push, y + dy * push, 1 + e * 1.2, e]);
                    }
                }
            }
            ctx.fillStyle = `rgba(${ink}, 0.05)`;
            ctx.fill();
            lit.forEach(([x, y, r, e]) => {
                ctx.fillStyle = `rgba(${glow}, ${(0.06 + e * 0.45).toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            });
        };
        const tick = () => {
            raf = 0;
            pt.x += (pt.tx - pt.x) * 0.22;
            pt.y += (pt.ty - pt.y) * 0.22;
            pt.k += (pt.tk - pt.k) * 0.12;
            const settled = Math.abs(pt.tk - pt.k) < 0.005 && Math.abs(pt.tx - pt.x) < 0.3 && Math.abs(pt.ty - pt.y) < 0.3;
            if (settled) pt.k = pt.tk;
            draw();
            if (!settled) raf = requestAnimationFrame(tick);
        };
        const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };
        const area = document.querySelector('.hero-sticky');
        area.addEventListener('pointermove', (e) => {
            if (!motion || e.pointerType !== 'mouse') return;
            const r = dotGrid.getBoundingClientRect();
            pt.tx = e.clientX - r.left;
            pt.ty = e.clientY - r.top;
            // Coming in fresh, the glow starts at the pointer instead of sliding over from where it last was
            if (pt.k < 0.01) {
                pt.x = pt.tx;
                pt.y = pt.ty;
            }
            pt.tk = 1;
            wake();
        });
        area.addEventListener('pointerleave', () => {
            pt.tk = 0;
            wake();
        });
        readColors();
        fit();
        draw();
        new ResizeObserver(() => { fit(); draw(); }).observe(dotGrid);
        new MutationObserver(() => { readColors(); draw(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    }

    /* ---------- Offline copy ---------- */
    // sw.js keeps a copy of the site, so repeat visits load fast and it still opens without a connection
    if ('serviceWorker' in navigator && window.isSecureContext) {
        window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
    }

    /* ---------- Pinyin over the proverb ---------- */
    // Hovering the characters shows the pinyin (in CSS). Where that isn't possible a tap toggles it, and a tap anywhere
    // else puts it away. Some phones and phone previews report taps as mouse clicks, so this goes by whether the
    // pinyin is already showing from a hover, not by what kind of pointer the tap says it came from.
    const proverb = document.querySelector('.quote-zh');
    if (proverb) {
        const canHover = matchMedia('(hover: hover)');
        proverb.addEventListener('click', () => {
            if (canHover.matches && proverb.matches(':hover')) return; // a mouse is already showing it
            proverb.classList.toggle('show');
        });
        document.addEventListener('pointerdown', (e) => { if (!proverb.contains(e.target)) proverb.classList.remove('show'); });
    }

    /* ---------- Coming back from the résumé ---------- */
    // The page remembers where it was when the visitor leaves. If they come back through the résumé's Back link
    // without the browser's own Back (see resume.js), it puts them at the same spot, again once the fonts settle.
    window.addEventListener('pagehide', () => {
        try { sessionStorage.setItem('returnY', String(Math.round(window.scrollY))); } catch (e) {}
    });
    let returnY = 0;
    try {
        if (sessionStorage.getItem('fromResume')) returnY = Number(sessionStorage.getItem('returnY')) || 0;
        sessionStorage.removeItem('fromResume');
    } catch (e) {}
    if (returnY) {
        window.scrollTo({ top: returnY, behavior: 'instant' });
        // Text can shift a little as the fonts arrive, so set it once more then, unless the visitor has started scrolling
        let moved = false;
        ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((type) => window.addEventListener(type, () => { moved = true; }, { once: true, passive: true }));
        if (document.fonts) document.fonts.ready.then(() => { if (!moved) window.scrollTo({ top: returnY, behavior: 'instant' }); });
    }

    /* ---------- Arriving on a shared write-up link ---------- */
    // The write-up opens over its project card, so closing it leaves the visitor right at the project
    const linkedPanel = panelFromHash();
    if (linkedPanel) {
        const card = panelCard.get(linkedPanel);
        if (card) scrollToCard(card, 'instant');
        linkedPanel.classList.remove('grown');
        linkedPanel.showModal();
        showPanelUrl(linkedPanel);
    }

    /* ---------- A hello for anyone who opens the developer console ---------- */
    const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#e0b25c';
    console.log('%cHi there, fellow developer!', `font: 600 15px/1.6 system-ui, sans-serif; color: ${accent}`);
    console.log(`This site is plain HTML, CSS, and JavaScript, with no framework and no build step.
Have a look at the source: https://github.com/sunnnnyli/sunnnnyli.github.io
Tip: press ${isMac ? '⌘K' : 'Ctrl+K'} on the page to jump anywhere.
And if you know the old cheat code (↑ ↑ ↓ ↓ ← → ← → B A), give it a try.`);
})();
