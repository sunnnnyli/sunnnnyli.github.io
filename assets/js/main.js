(() => {
    const root = document.documentElement;
    let motion = root.classList.contains('motion');
    const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
    // Runs once the next frame is drawn, when the page's layout is already worked out and reading it costs nothing
    const afterPaint = (fn) => requestAnimationFrame(() => setTimeout(fn));
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
    const jobsEnd = jobsEl.querySelector('.jobs-end'); // the note at the timeline's end
    const scenes = [...document.querySelectorAll('[data-scene]')];
    // Sections whose last screen holds still under the next. Projects does only when its row isn't pinned (phones,
    // see layoutGallery); pinned, the row holds itself.
    const holders = [...document.querySelectorAll('.holds, #projects')];
    const gallery = document.querySelector('.gallery');
    const projects = gallery.closest('section');
    const cards = [...document.querySelectorAll('.card')];

    // An element's top on the page, from layout alone, so nothing an animation moves counts
    const pageTop = (el) => {
        let top = 0;
        for (let e = el; e; e = e.offsetParent) top += e.offsetTop + (e.offsetParent ? e.offsetParent.clientTop : 0); // offsets start inside borders
        return top;
    };

    // Where to scroll so an element sits just clear of the top bar. Worked out with any held content back where it sits
    // on the page (see .holds in styles.css), since held content may be stuck somewhere else right now.
    const scrollTopFor = (el) => {
        root.classList.add('measuring');
        const top = el.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(root).scrollPaddingTop) || 0);
        root.classList.remove('measuring');
        return top;
    };

    // Thousands get commas. Done by hand: the browser's number formatting is slow to start up on phones.
    const fmt = (el, v) => `${el.dataset.prefix || ''}${String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${el.dataset.suffix || ''}`;

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
    // Text resolves from scrambled characters, left to right: the section labels ("01 | Impact") as they come into
    // view, and everything on the first screen as the page opens. It's scrambled from its very first frame,
    // so the real words never show before they decode. Each word keeps its real width while it scrambles (and is cut
    // off at it, see .decoding), so lines never reflow and nothing spills out of a button, and screen readers get the
    // real text throughout (the scrambled copy is hidden from them). Letters scramble into letters of the same case,
    // leaving out the widest (m, w), and narrow letters into narrow ones; digits into digits; Chinese characters into
    // the others around them (the proverb's font only has those); punctuation stays put.
    const GLYPHS = { lower: 'abcdefghijklnopqrstuvxyz', upper: 'ABCDEFGHIJKLNOPQRSTUVXYZ', narrow: 'fijlrt', narrowUpper: 'IJ', digit: '0123456789', sign: '#*+=<>/' };
    const pickFrom = (set) => set[Math.floor(Math.random() * set.length)];
    const CJK = /[\u3400-\u9fff]/;
    // Takes [element, options] pairs and measures them all together, so the page is laid out twice however many there
    // are. lead: how long it stays fully scrambled before the first character settles; span: from the first to the last,
    // or pace per character up to most
    const decodeAll = (list) => {
        const jobs = list.filter(([el]) => el.getClientRects().length) // not shown on this screen size
            .map(([el, opts]) => prepareDecode(el, opts)).filter(Boolean);
        if (!jobs.length) return;
        // Measure every word at once, then fix the widths
        const fit = (words) => {
            words.forEach((w) => { w.fake.textContent = w.text; w.fake.style.width = ''; });
            const widths = words.map((w) => w.fake.getBoundingClientRect().width);
            words.forEach((w, i) => { w.fake.style.width = `${widths[i]}px`; });
        };
        fit(jobs.flatMap((j) => j.words));
        jobs.forEach((j) => j.paint(performance.now() - j.start));
        // Late fonts change the widths, so measure again (with the real words in) and scramble before anything is drawn
        if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => {
            const left = jobs.filter((j) => !j.done);
            fit(left.flatMap((j) => j.words));
            left.forEach((j) => j.paint(performance.now() - j.start));
        });
        jobs.forEach((j) => requestAnimationFrame(j.step));
    };
    const decode = (el, opts) => decodeAll([[el, opts]]);
    // Swaps an element's words for scrambled copies, and returns how to run them
    const prepareDecode = (el, { delay = 0, signs = false, lead = 120, span: spanFor, pace = 45, most = 900 } = {}) => {
        const quiet = !!el.closest('[aria-hidden="true"]'); // already hidden from screen readers, so no real copy needed
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                if (!n.textContent.trim()) return NodeFilter.FILTER_REJECT;
                const skip = n.parentElement.closest('.visually-hidden, .copy-label, [aria-hidden="true"]');
                return skip && skip !== el && el.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            },
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        if (!nodes.length) return;
        const pool = [...new Set(nodes.map((n) => n.textContent).join('').match(new RegExp(CJK.source, 'g')) || [])].join('');
        const parts = [];
        const words = [];
        nodes.forEach((node) => {
            const added = [];
            if (!quiet) {
                const real = document.createElement('span');
                real.className = 'visually-hidden';
                real.textContent = node.textContent;
                added.push(real);
            }
            node.textContent.split(/(\s+)/).forEach((piece) => {
                if (!piece) return;
                if (/^\s+$/.test(piece)) {
                    added.push(document.createTextNode(piece));
                    return;
                }
                const fake = document.createElement('span');
                fake.className = 'decoding';
                fake.setAttribute('aria-hidden', 'true');
                fake.textContent = piece;
                added.push(fake);
                words.push({ fake, text: piece });
            });
            node.replaceWith(...added);
            parts.push({ node, added });
        });
        const count = words.reduce((n, w) => n + w.text.length, 0);
        const span = spanFor || Math.min(count * pace, most); // short labels go a letter at a time, long lines take under a second
        const start = performance.now() + delay;
        const scramble = (ch) => {
            if (CJK.test(ch)) return pickFrom(pool);
            if (/\d/.test(ch)) return pickFrom(GLYPHS.digit);
            if (/[fijlrt]/.test(ch)) return pickFrom(GLYPHS.narrow);
            if (/[IJ]/.test(ch)) return pickFrom(GLYPHS.narrowUpper);
            if (/[A-Z]/.test(ch)) return pickFrom(signs ? GLYPHS.upper + GLYPHS.sign : GLYPHS.upper);
            if (/[a-z]/.test(ch)) return pickFrom(signs ? GLYPHS.lower + GLYPHS.sign : GLYPHS.lower);
            return ch;
        };
        // Every word as it reads t ms in: the letters whose turn has come are real, the rest scrambled
        const paint = (t) => {
            let k = 0;
            words.forEach((w) => {
                w.fake.textContent = [...w.text].map((ch) => (t >= lead + (k++ / Math.max(1, count - 1)) * span ? ch : scramble(ch))).join('');
            });
        };
        const job = { words, start, paint, done: false };
        let shown = performance.now();
        job.step = (now) => {
            job.done = !motion || now - start > lead + span;
            if (job.done) {
                parts.forEach(({ node, added }) => {
                    added[0].before(node);
                    added.forEach((n) => n.remove());
                });
                return;
            }
            if (now - shown > 50) {
                shown = now;
                paint(now - start);
            }
            requestAnimationFrame(job.step);
        };
        return job;
    };
    // The first screen, as the page opens: each part starts as it begins to fade in, a little quicker than further down
    const decodeIntro = () => {
        const list = [];
        const title = document.querySelector('.hero-title > [aria-hidden="true"]');
        // The name's letters rise in out of a blur over about a second, so it stays scrambled until they're clear, then
        // settles a letter at a time
        if (title) list.push([title, { lead: 620, span: 420 }]);
        document.querySelectorAll('.hero .load, .scroll-cue').forEach((el) => {
            list.push([el, { delay: (parseFloat(getComputedStyle(el).getPropertyValue('--d')) || 0) * 1000, pace: 32, most: 650 }]);
        });
        document.querySelectorAll('.nav-steps a, .nav-resume, .nav-resume-sm').forEach((el, i) => list.push([el, { delay: 80 + i * 45, signs: true, pace: 32 }]));
        decodeAll(list);
        root.classList.remove('intro'); // it's all scrambled now, so the text can show (see .intro in styles.css)
    };
    const reveal = (el) => {
        if (el.classList.contains('split')) numberLines(el);
        if (el.classList.contains('eyebrow')) decode(el, { signs: true });
        el.classList.add('in');
    };

    let motionReady = false;
    const initMotion = (initial) => {
        if (motionReady) return;
        motionReady = true;
        // The marquee rows are measured before anything here changes the page, while its layout is still worked out
        const marquees = [...document.querySelectorAll('.marquee-track')].map((track) => {
            const list = track.querySelector('ul');
            return { track, list, setWidth: Math.max(1, list.scrollWidth) };
        });
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
        marquees.forEach(({ track, list, setWidth }) => {
            const originals = [...list.children];
            // Every copy goes in at once (re-measuring each round forced extra layout work)
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

    if (motion) {
        initMotion(true);
        if (!root.classList.contains('again')) decodeIntro(); // back again in the same visit: no opening (see the head)
    }
    // This visit has seen the page open now, so coming back to it skips the opening
    try { sessionStorage.setItem('opened', '1'); } catch (e) {}

    /* ---------- Scroll engine ---------- */
    // Each [data-scene] gets --p (0 → 1). Pinned scenes measure progress through their own height;
    // "enter" scenes measure how far they have risen into the viewport.
    let pinnedDist = null; // how far the pinned gallery scrolls sideways; null when it isn't pinned
    let pinnedHold = 0; // and how long it then holds still while Education rises over it (a screen)
    const layoutGallery = () => {
        // Where the swipeable row is, since measuring below hides the card copies for a moment, which would pull it back
        const rowLeft = gallery.querySelector('.gallery-sticky').scrollLeft;
        pinnedDist = null;
        gallery.classList.remove('gallery--free');
        projects.classList.remove('holds');
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
            projects.classList.add('holds'); // so it holds under Education like the other sections
            gallery.style.height = '';
            sticky.scrollLeft = rowLeft;
            return;
        }
        const dist = Math.max(0, track.offsetWidth - sticky.clientWidth);
        pinnedDist = dist;
        pinnedHold = sticky.offsetHeight;
        // Each card's offset from the middle of the screen before the track slides, for the CSS card scaling (read
        // along with the rest, before anything changes, so the page is only laid out once)
        cards.forEach((card) => { card._c = card.offsetLeft + card.offsetWidth / 2 - window.innerWidth / 2; });
        gallery.style.setProperty('--dist', dist);
        gallery.style.setProperty('--hold', pinnedHold);
        gallery.style.height = `${dist + window.innerHeight + pinnedHold}px`;
        gallery.style.setProperty('--vw', window.innerWidth);
        cards.forEach((card) => card.style.setProperty('--c', card._c.toFixed(1)));
        sticky.scrollLeft = 0; // where the swipeable row was left doesn't carry over to the pinned one
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
    // Whether any held content could be stuck in place right now (see .holds in styles.css). It's only ever kept down at
    // its sticking line, so anything still below that line sits where it belongs on the page, as when the page opens.
    const mayHold = () => motion && holders.some((sec) => {
        const hold = sec.querySelector('.hold');
        return hold.getBoundingClientRect().top <= parseFloat(getComputedStyle(hold).top) + 1;
    });
    const measureLayout = () => {
        // Held content goes back where it sits on the page while it's measured. Only when it needs to, since that
        // makes the browser lay the whole page out twice more.
        const release = mayHold();
        if (release) root.classList.add('measuring');
        // Experience timeline: each dot's center on the page, read from the CSS so the two always agree, and where the
        // line ends: with the last role, so it runs alongside all of it
        const dot = getComputedStyle(jobEls[0], '::before');
        const dotOff = parseFloat(dot.top) + parseFloat(dot.height) / 2;
        const lastJob = jobEls[jobEls.length - 1];
        // With motion, Experience holds still once its content's bottom reaches the bottom of the screen (see .holds in
        // styles.css), with the line's end still a little above it, so the line paces itself to be done by then:
        // tlDone is where the middle of the screen is at that moment
        const hold = jobsEl.closest('.hold');
        const tlEnd = pageTop(lastJob) + lastJob.offsetHeight;
        const holdAt = hold ? pageTop(hold) + hold.offsetHeight - window.innerHeight * 0.5 : tlEnd;
        lay = {
            docH: document.documentElement.scrollHeight,
            width: navTrack.offsetWidth,
            secTops: checkpoints.map(({ sec }) => pageTop(sec) - NAV_H),
            tabX: checkpoints.map(({ a }) => a.offsetLeft + a.offsetWidth / 2),
            dots: jobEls.map((job) => pageTop(job) + dotOff),
            tlEnd,
            tlDone: Math.min(tlEnd, holdAt),
            body: document.body.getBoundingClientRect(),
        };
        if (release) root.classList.remove('measuring');
        const len = `${(lay.tlEnd - lay.dots[0]).toFixed(1)}px`;
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
    let lastEnded = null;
    const frame = () => {
        ticking = false;
        const vh = window.innerHeight;
        const y = window.scrollY;
        if (!lay) measureLayout();
        const max = lay.docH - vh;

        // Read every position first, then write. Mixing the two makes the browser
        // redo the page layout after each change, which is what makes phones stutter.
        const track = measureTrack(y, max);
        const holdCover = motion ? holders.map((sec) => clamp(1 - sec.nextElementSibling.getBoundingClientRect().top / vh)) : [];
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
            const slid = clamp(galleryP * (pinnedDist + pinnedHold) / Math.max(1, pinnedDist)) * pinnedDist; // see --slide
            cardF = cards.map((card) => clamp(1 - Math.abs(card._c - slid) / (window.innerWidth * 0.9)).toFixed(3));
        }

        toTop.classList.toggle('show', y > vh * 1.2);
        // The top bar slims once the page moves and grows back at the very top
        const slim = y > 40;
        if (slim !== lastSlim) {
            lastSlim = slim;
            nav.classList.toggle('slim', slim);
        }
        // Experience timeline: the line fills as the middle of the screen moves down it, done by the time Experience
        // holds still (tlDone), and each dot lights up as the line reaches it
        if (motion) {
            const { dots, tlEnd, tlDone } = lay;
            const tlP = clamp((y + vh * 0.5 - dots[0]) / Math.max(1, tlDone - dots[0]));
            const front = dots[0] + tlP * (tlEnd - dots[0]); // where the line has reached, on the page
            const tl = tlP.toFixed(4);
            if (tl !== lastTl) {
                lastTl = tl;
                jobsEl.style.setProperty('--tl', tl);
            }
            const ended = tlP >= 1; // the line's end
            if (ended !== lastEnded) {
                lastEnded = ended;
                jobsEl.classList.toggle('ended', ended);
                // The note there decodes the first time it shows, like the section labels
                if (ended && jobsEnd && !jobsEnd._decoded) {
                    jobsEnd._decoded = true;
                    decode(jobsEnd, { signs: true });
                }
            }
            jobEls.forEach((job, i) => {
                const lit = front >= dots[i];
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
        holdCover.forEach((c, i) => {
            const sec = holders[i];
            if (sec._cover === c) return;
            sec._cover = c;
            sec.style.setProperty('--cover', c.toFixed(4));
        });
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
            holders.forEach((sec) => { sec.style.removeProperty('--cover'); sec._cover = undefined; });
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
    const partsOf = (panel) => panel.querySelectorAll('.panel-inner > :is(h3, p:not(.panel-meta, .panel-keys), .chips, .panel-next)');
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
    // The write-ups (each opened from its project card); the others, like How this site is built, stand apart
    const projectPanels = [...document.querySelectorAll('.card [data-panel]')].map((btn) => document.getElementById(btn.dataset.panel));
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
    projectPanels.forEach((panel, i) => {
        const next = projectPanels[(i + 1) % projectPanels.length];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'panel-next';
        btn.innerHTML = '<span class="panel-next-label">Next project</span> <span class="panel-next-name"></span>';
        btn.querySelector('.panel-next-name').textContent = next.querySelector('h2').textContent;
        btn.insertAdjacentHTML('beforeend', '<span class="chev" aria-hidden="true">→</span>');
        btn.setAttribute('aria-keyshortcuts', 'ArrowRight');
        btn.addEventListener('click', () => switchPanel(panel, next));
        // Under it (on desktop, see .panel-keys), a quiet note that the arrow keys do the same; screen readers hear it
        // from the button's aria-keyshortcuts instead
        const keys = document.createElement('p');
        keys.className = 'panel-keys';
        keys.setAttribute('aria-hidden', 'true');
        keys.innerHTML = 'Or use <kbd>←</kbd> <kbd>→</kbd> to switch projects';
        panel.querySelector('.panel-inner').append(btn, keys);
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

        // Copy link: a link that opens this write-up directly. On phones with a share sheet it's Share instead, so the
        // write-up can go straight into a message, an email, or LinkedIn; if sharing fails, it copies after all.
        const linkBtn = panel.querySelector('.panel-link');
        const linkLabel = linkBtn.querySelector('.panel-link-label');
        const linkStatus = panel.querySelector('.panel-status');
        const shares = !!navigator.share && matchMedia('(pointer: coarse)').matches;
        if (shares) {
            linkBtn.classList.add('shares');
            linkLabel.textContent = 'Share';
            linkBtn.insertAdjacentHTML('afterbegin', '<svg class="i-share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M7 10H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>');
        }
        let linkTimer;
        linkBtn.addEventListener('click', async () => {
            const url = `${location.origin}${location.pathname}#${slugOf(panel)}`;
            if (shares) {
                try {
                    await navigator.share({ title: `${panel.querySelector('h2').textContent}, by Sunny Li`, url });
                    return;
                } catch (err) {
                    if (err && err.name === 'AbortError') return; // closed without sharing
                }
            }
            const ok = await copyText(url);
            linkBtn.classList.toggle('copied', ok);
            if (ok) {
                tap();
                inkTick(linkBtn);
            }
            linkLabel.textContent = ok ? 'Copied' : 'Copy failed';
            linkStatus.textContent = ok ? 'Link copied' : 'Could not copy the link';
            clearTimeout(linkTimer);
            linkTimer = setTimeout(() => {
                linkBtn.classList.remove('copied');
                linkLabel.textContent = shares ? 'Share' : 'Copy link';
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

    // Project diagrams can play through their stages, one at a time (each part's data-step lists the stages it's lit
    // in), then show whole for a moment and start again: a write-up's for as long as it's open, a card's while the
    // mouse is over the card. With motion off they simply show whole.
    const diagramPlayer = (art, startAfter) => {
        const parts = [...art.querySelectorAll('[data-step]')];
        const stages = Math.max(...parts.flatMap((el) => el.dataset.step.split(' ').map(Number)));
        let stage = 0; // 0 is the whole diagram
        let timer = 0;
        const light = () => {
            art.classList.toggle('focus', stage > 0);
            parts.forEach((el) => el.classList.toggle('on', el.dataset.step.split(' ').includes(String(stage))));
            art.classList.toggle('solo', art.querySelectorAll('.dg-node.on').length === 1);
        };
        const play = () => {
            stage = motion && stage < stages ? stage + 1 : 0;
            light();
            if (motion) timer = setTimeout(play, stage === 0 ? 1600 : stage === stages ? 1800 : 1300);
        };
        const stop = () => {
            clearTimeout(timer);
            stage = 0;
            light();
            art.classList.remove('playing');
        };
        const start = () => {
            stop();
            if (!motion) return;
            // Playing (pauses on the whole diagram included), a card's nodes don't pulse on their own; from now on its
            // parts fade together, not left to right as when it drew in
            art.classList.add('playing', 'played');
            timer = setTimeout(play, startAfter);
        };
        return { start, stop };
    };
    // Each write-up shows its project's diagram under the title, held near the top while the text scrolls under it,
    // playing from the whole diagram each time the write-up opens
    panels.forEach((panel) => {
        const card = panelCard.get(panel);
        const svg = card && card.querySelector('.art-dg svg');
        if (!svg) return;
        const art = document.createElement('div');
        art.className = 'panel-art art-dg drawn';
        art.setAttribute('aria-hidden', 'true');
        art.append(svg.cloneNode(true));
        panel.querySelector('h2').after(art);
        const player = diagramPlayer(art, 700);
        new MutationObserver(() => (panel.open ? player.start() : player.stop())).observe(panel, { attributes: true, attributeFilter: ['open'] });
    });
    // A card's diagram plays while the mouse is over the card (touch screens have no hovering, so theirs rest)
    cards.forEach((card) => {
        const art = card.querySelector('.art-dg');
        if (!art) return;
        const player = diagramPlayer(art, 250);
        card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') player.start(); });
        card.addEventListener('pointerleave', player.stop);
    });

    // With a write-up open, ← and → step to the previous and next project (round, like Next project)
    document.addEventListener('keydown', (e) => {
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
        const from = projectPanels.find((panel) => panel.open);
        if (!from) return;
        e.preventDefault();
        const i = projectPanels.indexOf(from) + (e.key === 'ArrowRight' ? 1 : -1);
        switchPanel(from, projectPanels[(i + projectPanels.length) % projectPanels.length]);
    });

    // A write-up link followed while the page is already open
    window.addEventListener('hashchange', () => {
        const panel = panelFromHash();
        if (panel && !panel.open) openPanel(panel);
    });

    /* ---------- Experience: how long each role lasted ---------- */
    // Worked out from each role's dates ("Jun 2024 – Sep 2026", or "… – Present"), counting both end months the way
    // LinkedIn does, so the current role's keeps itself up to date. A role that hasn't started yet gets none.
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthNumber = (text) => {
        const m = text.trim().match(/^([A-Z][a-z]{2}) (\d{4})$/);
        return m && MONTHS.includes(m[1]) ? Number(m[2]) * 12 + MONTHS.indexOf(m[1]) : null;
    };
    const today = new Date();
    document.querySelectorAll('.job-dates').forEach((el) => {
        const [from = '', to = ''] = el.textContent.split('–');
        const start = monthNumber(from);
        const end = /present/i.test(to) ? today.getFullYear() * 12 + today.getMonth() : monthNumber(to);
        if (start === null || end === null || end < start) return;
        const months = end - start + 1;
        const years = Math.floor(months / 12);
        const rest = months % 12;
        const len = document.createElement('span');
        len.className = 'job-len';
        len.textContent = ` (${[years && `${years} yr${years > 1 ? 's' : ''}`, rest && `${rest} mo${rest > 1 ? 's' : ''}`].filter(Boolean).join(' ')})`;
        el.append(len);
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

    // When something's copied, a check mark is written in ink over the button's icon, the way a teacher ticks a page:
    // pressed at the start, a little heavier at the turn, then flicked up and to the right, thinning until the brush
    // runs dry. It's painted on a small canvas in the button's accent color, with a touch of paper grain rubbed out of
    // it, and the dry bristles break up differently every time. It stays while the button says it's copied, then fades
    // out as the copy icon fades back in. With motion off it's skipped, and the check icon says it alone.
    const inkTick = (() => {
        const TAU = Math.PI * 2;
        const c01 = (x) => Math.max(0, Math.min(1, x));
        const smooth = (x) => { x = c01(x); return x * x * (3 - 2 * x); };
        // The tick's line, in units of its size: a short stroke down, then a long one up and to the right
        const line = [];
        const curve = (a, c, b, n) => {
            for (let i = 0; i <= n; i++) {
                const u = i / n;
                line.push([(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]]);
            }
        };
        curve([-0.95, -0.08], [-0.62, 0.3], [-0.3, 0.64], 60);
        line.pop();
        curve([-0.3, 0.64], [0.22, 0.02], [1.15, -0.92], 160);
        const along = [0];
        for (let i = 1; i < line.length; i++) along.push(along[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
        const total = along[along.length - 1];
        const turn = along[60] / total;
        // Half the stroke's width at each point along it (0 to 1)
        const width = (s) => {
            if (s < turn) {
                const u = s / turn;
                return 0.21 + 0.12 * Math.exp(-u * 9) + 0.04 * u;
            }
            const u = (s - turn) / (1 - turn);
            return 0.27 * Math.pow(1 - u, 0.8) + 0.015 + (u < 0.1 ? 0.03 * (1 - u / 0.1) : 0);
        };
        // How much is written t ms in: the stroke down by 95, a beat at the turn, then the flick, quickening, by 275
        const written = (t) => (t < 95 ? turn * smooth(t / 95) : t < 125 ? turn : turn + (1 - turn) * Math.pow(c01((t - 125) / 150), 1.5));
        const FADE = 450; // ms, once the button's back to its copy icon
        const LONGEST = 6000; // and in any case by then
        let grain = null;
        const runs = new Map();
        let looping = false;

        const paint = (run, t) => {
            const { c, g, R, half, dpr } = run;
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, c.width, c.height);
            g.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
            g.fillStyle = 'rgba(0, 0, 0, 0.92)';
            const upto = written(t) * total;
            let k = 0;
            // Pressed along the line as overlapping dabs; where the brush runs dry, only scattered bristles touch
            for (let i = 1; i < line.length && along[i - 1] < upto; i++) {
                const [x0, y0] = line[i - 1];
                const [x1, y1] = line[i];
                const seg = along[i] - along[i - 1];
                const n = Math.max(1, Math.ceil((seg * R) / 0.3));
                const nx = -(y1 - y0) / seg;
                const ny = (x1 - x0) / seg;
                for (let m = 0; m < n; m++) {
                    const d = along[i - 1] + (seg * m) / n;
                    if (d > upto) break;
                    const s = d / total;
                    const x = (x0 + ((x1 - x0) * m) / n) * R;
                    const y = (y0 + ((y1 - y0) * m) / n) * R;
                    const w = width(s) * R;
                    const dry = s > turn ? c01(((s - turn) / (1 - turn) - 0.5) / 0.5) : 0;
                    if (dry < 0.05) {
                        g.beginPath();
                        g.arc(x, y, w * run.jitter[k++ & 63], 0, TAU);
                        g.fill();
                        continue;
                    }
                    run.hairs.forEach((h) => {
                        if (0.5 + 0.5 * Math.sin(d * R * h.f1 + h.ph) * Math.cos(d * R * h.f2 + h.ph * 2) < dry * 0.85) return;
                        g.beginPath();
                        g.arc(x + nx * h.o * w, y + ny * h.o * w, Math.max(0.35, w * 0.32), 0, TAU);
                        g.fill();
                    });
                }
            }
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalCompositeOperation = 'destination-out';
            g.globalAlpha = 0.14;
            g.drawImage(grain, 0, 0, c.width, c.height);
            g.globalAlpha = 1;
            g.globalCompositeOperation = 'source-in';
            g.fillStyle = run.color;
            g.fillRect(0, 0, c.width, c.height);
            g.globalCompositeOperation = 'source-over';
        };
        const end = (btn) => {
            runs.get(btn).c.remove();
            btn.classList.remove('inking', 'ink-cover');
            runs.delete(btn);
        };
        const step = (now) => {
            runs.forEach((run, btn) => {
                const t = now - run.start;
                if (!run.dry) paint(run, t); // once it's all written, only the fading changes
                run.dry = t > 280;
                if (run.fading === undefined) {
                    if (btn.classList.contains('copied') && t < LONGEST) return;
                    run.fading = now; // the button's gone back to its copy icon
                    return; // drawn hidden for a frame first, so it fades in from there with the tick (see .ink-cover)
                }
                btn.classList.remove('ink-cover'); // the icon comes back; the tick stays put while it fades
                const gone = (now - run.fading) / FADE;
                if (gone >= 1) end(btn);
                else run.c.style.opacity = 1 - smooth(gone);
            });
            if (runs.size) requestAnimationFrame(step);
            else looping = false;
        };

        return (btn) => {
            if (!root.classList.contains('motion')) return;
            if (runs.has(btn)) end(btn); // copied again: a fresh tick
            // The icon steps aside before anything's measured, or the check would be drawn for a moment first
            btn.classList.add('inking', 'ink-cover');
            const icon = [...btn.querySelectorAll('svg')].find((s) => s.getBoundingClientRect().width);
            if (!icon) {
                btn.classList.remove('inking', 'ink-cover');
                return;
            }
            if (!grain) {
                grain = document.createElement('canvas');
                grain.width = grain.height = 48;
                const g = grain.getContext('2d');
                const d = g.createImageData(48, 48);
                for (let i = 3; i < d.data.length; i += 4) d.data[i] = Math.random() * 255;
                g.putImageData(d, 0, 0);
            }
            // Sized to the icon, centered on it, and a little bigger than it, like a mark made over the top
            const box = btn.getBoundingClientRect();
            const at = icon.getBoundingClientRect();
            const R = at.width * 0.78;
            const half = Math.ceil(R * 1.7);
            const dpr = Math.min(3, window.devicePixelRatio || 1);
            const c = document.createElement('canvas');
            c.className = 'ink-tick';
            c.setAttribute('aria-hidden', 'true');
            c.width = c.height = Math.ceil(half * 2 * dpr);
            c.style.width = c.style.height = `${half * 2}px`;
            c.style.left = `${at.left + at.width / 2 - box.left - btn.clientLeft - half}px`;
            c.style.top = `${at.top + at.height / 2 - box.top - btn.clientTop - half}px`;
            btn.append(c);
            const rand = (a, b) => a + Math.random() * (b - a);
            const run = {
                c,
                g: c.getContext('2d'),
                R,
                half,
                dpr,
                color: getComputedStyle(btn).getPropertyValue('--accent').trim(),
                hairs: Array.from({ length: 7 }, (_, j) => ({ o: (j / 6 - 0.5) * 1.7, f1: rand(0.6, 1.4), f2: rand(0.2, 0.5), ph: rand(0, TAU) })),
                jitter: Array.from({ length: 64 }, () => rand(0.93, 1.07)),
                start: performance.now(),
                dry: false,
            };
            paint(run, 0);
            runs.set(btn, run);
            if (!looping) {
                looping = true;
                requestAnimationFrame(step);
            }
        };
    })();
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
            if (ok) {
                tap();
                inkTick(copyBtn);
            }
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

    /* ---------- My local time, under the reply note ---------- */
    // So someone writing from another time zone can tell whether it's the middle of my night. It keeps to the minute,
    // and without the script the line simply isn't there.
    const localTime = document.querySelector('.local-time');
    if (localTime) {
        const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
        const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
        const tick = () => {
            const now = new Date();
            const h = Number(hour.format(now));
            const night = h >= 23 || h < 7;
            localTime.textContent = `It’s ${clock.format(now)} for me in New York${night ? ', so I’ll write back in the morning' : ''}.`;
            localTime.hidden = false;
            setTimeout(tick, 60000 - (now.getTime() % 60000) + 50); // just after the next minute turns
        };
        tick();
    }

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
    let themeSwitch = null;
    const setTheme = (t, remember, origin) => {
        theme = t;
        if (remember) store('theme', t);
        const apply = () => { root.dataset.theme = theme; syncThemeBtn(); };
        // The new theme spreads out from the button like ink soaking into paper (see ink.js); instant otherwise or with
        // motion off.
        if (motion && document.startViewTransition) {
            switching = true;
            const vt = origin && window.spreadTheme ? window.spreadTheme(apply, origin) : document.startViewTransition(apply);
            themeSwitch = vt;
            vt.finished.finally(() => {
                if (themeSwitch !== vt) return; // pressed again mid-switch: the newer one carries on
                switching = false;
                retint();
            }).catch(() => {});
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
    // Each holding section's content needs its height, to know when to stick (see .holds in styles.css)
    const holdSize = new ResizeObserver((entries) => {
        const heights = entries.map((entry) => entry.target.offsetHeight); // all read before any is set
        entries.forEach((entry, i) => entry.target.style.setProperty('--hold-h', `${heights[i]}px`));
    });
    holders.forEach((sec) => holdSize.observe(sec.querySelector('.hold')));
    // Anything that changes the page's size (new widths, pinned heights, late fonts) re-measures the layout. Not its
    // first report, when the page is still the size it was just measured at.
    new ResizeObserver(([entry]) => {
        const box = entry.borderBoxSize && entry.borderBoxSize[0];
        if (box && lay && Math.abs(box.inlineSize - lay.body.width) < 0.01 && Math.abs(box.blockSize - lay.body.height) < 0.01) return;
        measureLayout();
        request();
    }).observe(document.body);
    // Phone browsers resize the window when the address bar slides away on the first scroll.
    // That only changes the height a little, so skip the full re-measure then.
    let lastW = window.innerWidth;
    let lastH = window.innerHeight;
    window.addEventListener('resize', () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w === lastW && Math.abs(h - lastH) < 160) {
            if (pinnedDist !== null) gallery.style.height = `${pinnedDist + h + pinnedHold}px`;
        } else {
            lastW = w;
            lastH = h;
            layoutGallery();
        }
        request();
    });
    // Late fonts change line lengths, so measure again once they're in (if any are still on the way)
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { layoutGallery(); measureLayout(); request(); });

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
    // (every part is measured before any is changed, so the page is laid out once for all of them)
    const dgParts = [...document.querySelectorAll('.art-dg svg')].flatMap((svg) => {
        const width = svg.viewBox.baseVal.width || 300;
        return [...svg.children].map((el) => {
            try {
                const b = el.getBBox();
                return { el, x: clamp((b.x + b.width / 2) / width).toFixed(2) };
            } catch (err) {
                return { el, x: null };
            }
        });
    });
    dgParts.forEach(({ el, x }) => {
        if (el.matches('.dg-line')) el.setAttribute('pathLength', '1');
        if (x !== null) el.style.setProperty('--x', x);
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
        window.scrollTo({ top: scrollTopFor(target), behavior: motion ? 'smooth' : 'auto' });
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
            if (!title) return;
            if (btn.closest('.card')) list.push({ group: 'Projects', label: title.textContent.trim(), keys: 'project read case study', icon: ICON.read, panel });
            else list.push({ group: 'Actions', label: title.textContent.trim(), keys: 'colophon about site source code fonts built', icon: ICON.read, panel });
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
    // The row loops: a copy of every card sits on each side of the real ones, so swiping (or pressing →) past the last
    // card carries on round to the first, and ← from the first comes round to the last. Once a swipe settles on a
    // copy, the row moves to the real card in its place, which looks no different. The copies are only for show:
    // hidden from screen readers, out of reach of the keyboard, and left out of everything else that looks at the
    // cards. The pinned row doesn't show them (.card-loop in styles.css).
    cards.forEach((card, i) => { card._real = i; });
    const copyOf = (card) => {
        const copy = card.cloneNode(true);
        copy.classList.add('card-loop');
        [copy, ...copy.querySelectorAll('[id]')].forEach((el) => el.removeAttribute('id'));
        copy.removeAttribute('data-name');
        copy.removeAttribute('data-skills');
        copy.querySelectorAll('.rv, .rv-scale').forEach((el) => el.classList.add('in'));
        copy.setAttribute('aria-hidden', 'true');
        copy.inert = true;
        copy._real = card._real;
        return copy;
    };
    const ring = [...cards.map(copyOf), ...cards, ...cards.map(copyOf)]; // along the row, left to right
    cards[0].before(...ring.slice(0, cards.length));
    cards[cards.length - 1].after(...ring.slice(cards.length * 2));
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
            const top = pageTop(gallery);
            window.scrollTo({ top: top + clamp(card._c, 0, pinnedDist), behavior });
        } else {
            window.scrollTo({ top: scrollTopFor(row), behavior });
            row.scrollBy({ left: offCenter(card), behavior });
        }
    };
    let dotQueued = false;
    let currentDot = -1;
    // Where the last click is headed, so quick repeat clicks on an arrow keep stepping while the row is still sliding
    let aimed = null;
    let aimTimer;
    const aimAt = (i) => {
        aimed = clamp(i, -cards.length, cards.length * 2 - 1); // past either end: on to the copies there
        clearTimeout(aimTimer);
        aimTimer = setTimeout(() => { aimed = null; }, 900);
        scrollRowTo(ring[aimed + cards.length]);
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
        ring.forEach((card) => {
            if (!card.offsetWidth) return; // a copy, while the row is pinned
            const off = Math.abs(offCenter(card));
            if (off < bestOff) {
                bestOff = off;
                best = card._real;
            }
        });
        if (best === currentDot) return;
        currentDot = best;
        pageDots.forEach((d, i) => {
            if (i === best) d.setAttribute('aria-current', 'true');
            else d.removeAttribute('aria-current');
        });
    };
    const queueDots = () => {
        if (dotQueued) return;
        dotQueued = true;
        requestAnimationFrame(syncDots);
    };
    row.addEventListener('scroll', queueDots, { passive: true });
    window.addEventListener('resize', queueDots);
    afterPaint(syncDots);
    // Once a swipe (or an arrow's slide) comes to rest on a copy, the row moves to the real card in its place
    const settle = () => {
        if (pinnedDist !== null) return;
        let near = null;
        let nearOff = Infinity;
        ring.forEach((card) => {
            const off = Math.abs(offCenter(card));
            if (card.offsetWidth && off < nearOff) {
                nearOff = off;
                near = card;
            }
        });
        if (!near || !near.classList.contains('card-loop')) return;
        row.scrollTo({ left: row.scrollLeft + cards[near._real].offsetLeft - near.offsetLeft, behavior: 'instant' });
        if (aimed !== null) aimed = near._real;
    };
    if ('onscrollend' in window) row.addEventListener('scrollend', settle);
    else {
        let settleTimer;
        row.addEventListener('scroll', () => {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(settle, 150);
        }, { passive: true });
    }
    // The row starts on the real first card, with the last card's copy just showing at its left, and stays on the same
    // card when its size changes. Pinned, it doesn't scroll sideways at all.
    let homed = false;
    const home = () => {
        if (pinnedDist !== null) {
            homed = false;
            return;
        }
        row.scrollTo({ left: row.scrollLeft + offCenter(cards[homed ? Math.max(0, currentDot) : 0]), behavior: 'instant' });
        homed = true;
    };
    new ResizeObserver(() => afterPaint(home)).observe(row);

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

    /* ---------- Impact tiles turn over ---------- */
    // Each tile turns over to the story behind its number on a tap or click anywhere on it (its button does the same
    // from the keyboard, and says which side is showing). The side out of view is inert, so keyboards and screen
    // readers skip it.
    document.querySelectorAll('.tile[data-turn]').forEach((tile) => {
        const btn = tile.querySelector('.tile-turn');
        const [front, story] = tile.querySelectorAll('.tile-face');
        story.inert = true;
        tile.addEventListener('click', () => {
            const turned = tile.classList.toggle('turned');
            btn.setAttribute('aria-pressed', String(turned));
            front.inert = turned;
            story.inert = !turned;
        });
    });

    /* ---------- Notices ---------- */
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

    /* ---------- A hidden surprise: tap the portrait 13 times ---------- */
    // A card is dealt up from the bottom of the screen and a seal reading 福 (good fortune) presses onto it, then it
    // slips away again (tap it to send it off sooner). The seal is an ink impression: its edges are roughened, the ink
    // doesn't quite take in places, and the character and an inner frame are carved out of it. The character's ink is
    // centered on it, placed from the font's own outline of 福 (its pen starts at x, on the baseline y). With motion off, the
    // card simply shows, already stamped, then fades. It's announced to screen readers as it shows.
    const sealCard = document.createElement('div');
    sealCard.className = 'seal-card';
    sealCard.setAttribute('role', 'status');
    sealCard.innerHTML = `<div class="seal-card-text"><p class="seal-card-eye"></p><p class="seal-card-line"></p></div>
        <svg class="seal" viewBox="0 0 120 120" aria-hidden="true">
            <defs>
                <filter id="seal-ink" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4" result="warp"/>
                    <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.6" xChannelSelector="R" yChannelSelector="G" result="rough"/>
                    <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="2" seed="9" result="grain"/>
                    <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -10 6.9" result="voids"/>
                    <feComposite in="rough" in2="voids" operator="in" result="speckled"/>
                    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="2" result="blot"/>
                    <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.8 1.42" result="press"/>
                    <feComposite in="speckled" in2="press" operator="in"/>
                </filter>
                <mask id="seal-carve" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
                    <rect x="0" y="0" width="120" height="120" fill="#fff"/>
                    <rect x="10.5" y="10.5" width="99" height="99" rx="3" fill="none" stroke="#000" stroke-width="2.6"/>
                    <text x="16.79" y="98.14" font-family="Zhi Mang Xing" font-size="96" fill="#000">福</text>
                </mask>
            </defs>
            <g filter="url(#seal-ink)"><rect x="4" y="4" width="112" height="112" rx="7" fill="#b3372a" mask="url(#seal-carve)"/></g>
        </svg>`;
    document.body.append(sealCard);
    const sealEye = sealCard.querySelector('.seal-card-eye');
    const sealLine = sealCard.querySelector('.seal-card-line');
    const seal = sealCard.querySelector('.seal');
    const OFF = 'translateY(calc(100% + 40px))';
    // From Lunar New Year's day through the Lantern Festival (the 15th day), the seal is stamped upside down, the way
    // 福 is hung for the new year. The pun is explained in the developer console (see the hello at the end).
    const NEW_YEARS = ['2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03', '2031-01-23', '2032-02-11', '2033-01-31', '2034-02-19', '2035-02-08', '2036-01-28'];
    const festive = NEW_YEARS.some((d) => {
        const [y, m, day] = d.split('-').map(Number);
        const start = new Date(y, m - 1, day);
        const end = new Date(y, m - 1, day + 15); // the start of the day after the Lantern Festival
        const now = new Date();
        return now >= start && now < end;
    });
    const tilt = festive ? 174 : -6; // a little off square, as a hand would press it
    let sealAnims = [];
    let sealTimer;
    const sealReset = () => {
        sealAnims.forEach((a) => a.cancel());
        sealAnims = [];
    };
    const hideSecret = () => {
        clearTimeout(sealTimer);
        if (!sealCard.classList.contains('on')) return;
        const gone = () => {
            sealReset();
            sealCard.classList.remove('on');
            sealEye.textContent = '';
            sealLine.textContent = '';
            retint(); // on a phone it covered the bottom of the screen, which Safari colors its bar from
        };
        const out = motion
            ? sealCard.animate([{ transform: 'none' }, { transform: OFF }], { duration: 600, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' })
            : sealCard.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
        sealAnims.push(out);
        out.finished.then(gone, () => {});
    };
    const showSecret = () => {
        clearTimeout(sealTimer);
        sealReset();
        sealEye.textContent = 'You found my secret!';
        sealLine.textContent = 'May good fortune find you too.';
        sealCard.classList.add('on');
        retint();
        if (motion) {
            sealAnims.push(
                sealCard.animate([{ transform: OFF }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }),
                // the seal comes down at an angle, presses in, and settles; the card gives a little under it
                seal.animate([
                    { opacity: 0, transform: `scale(1.4) rotate(${tilt - 5}deg)` },
                    { opacity: 0.95, transform: `scale(1.04) rotate(${tilt}deg)`, offset: 0.62 },
                    { opacity: 1, transform: `scale(0.985) rotate(${tilt}deg)`, offset: 0.8 },
                    { opacity: 1, transform: `scale(1) rotate(${tilt}deg)` },
                ], { duration: 380, delay: 800, easing: 'cubic-bezier(0.55, 0, 0.35, 1)', fill: 'both' }),
                sealCard.animate([{ transform: 'none' }, { transform: 'translateY(4px)', offset: 0.35 }, { transform: 'none' }], { duration: 320, delay: 1030, easing: 'ease-out' }),
            );
        } else {
            sealAnims.push(
                sealCard.animate([{ transform: 'none' }], { duration: 1, fill: 'forwards' }),
                seal.animate([{ opacity: 1, transform: `rotate(${tilt}deg)` }], { duration: 1, fill: 'forwards' }),
            );
        }
        sealTimer = setTimeout(hideSecret, motion ? 4400 : 4000);
    };
    sealCard.addEventListener('click', hideSecret);

    // The portrait spins like a coin with each tap or click (with motion on), easing to a stop face up. A tap on its
    // right half pushes that side away, and on its left half the other way. Another tap the same way mid-spin adds a
    // whole turn; one the other way turns it back round, through a whole turn that way (see .photo-coin).
    const photo = document.querySelector('.hero-photo');
    const coin = photo.querySelector('.photo-coin');
    let angle = 0;
    let from = 0;
    let target = 0;
    let spinStart = 0;
    let spinning = false;
    let spinDir = 0;
    const spinFrame = (now) => {
        const t = Math.min(1, (now - spinStart) / 600);
        angle = from + (target - from) * (1 - Math.pow(1 - t, 3));
        coin.style.setProperty('--spin', `${angle.toFixed(2)}deg`);
        if (t < 1) {
            requestAnimationFrame(spinFrame);
            return;
        }
        spinning = false;
        angle = 0; // a whole number of turns: face up, as it started
        coin.style.removeProperty('--spin');
    };
    const spinCoin = (dir) => {
        if (spinning && dir === spinDir) target += 360 * dir;
        else target = (dir > 0 ? Math.ceil(angle / 360) : Math.floor(angle / 360)) * 360 + 360 * dir;
        spinDir = dir;
        from = angle;
        spinStart = performance.now();
        if (spinning) return;
        spinning = true;
        requestAnimationFrame(spinFrame);
    };
    // 13 taps in a row (none more than three seconds apart) show the surprise. The first also asks for the seal's
    // lettering (one character, about 1 KB), in case the browser hasn't fetched it for the hidden card yet.
    let taps = 0;
    let tapTimer;
    photo.addEventListener('click', (e) => {
        const r = photo.getBoundingClientRect();
        if (motion) spinCoin(e.clientX < r.left + r.width / 2 ? -1 : 1);
        if (!taps && document.fonts) document.fonts.load('96px "Zhi Mang Xing"', '福').catch(() => {});
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => { taps = 0; }, 3000);
        if (++taps < 13) return;
        taps = 0;
        showSecret();
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
            if (ok) {
                tap();
                inkTick(b);
            }
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

    /* ---------- Lighter effects on a struggling device ---------- */
    // While the page scrolls, it watches how often frames come late. If over a couple of seconds of scrolling more than a
    // third come slower than 40 a second, it turns on .lite for the rest of the visit (the head scripts carry it to the
    // next page): the blurs, the drifting glow, and the paper grain step aside (see "Lighter effects" in styles.css),
    // the costliest things to repaint, while the motion itself stays. A device that keeps up is left alone.
    if (!root.classList.contains('lite')) {
        let frames = 0;
        let late = 0;
        let watching = false;
        let lastFrame = 0;
        let lastScroll = 0;
        const settled = performance.now() + 2500; // not while the page is still opening
        const watch = (now) => {
            if (lastFrame) {
                const gap = now - lastFrame;
                if (gap < 250) { // a longer gap is a pause (a hidden tab, say), not a slow frame
                    frames++;
                    if (gap > 25) late++;
                }
            }
            lastFrame = now;
            const lite = frames >= 120 && late / frames > 0.35;
            if (lite || frames >= 900) {
                window.removeEventListener('scroll', onScroll);
                if (lite) {
                    root.classList.add('lite');
                    try { sessionStorage.setItem('lite', '1'); } catch (e) {}
                    console.info('Lighter effects on: frames kept coming late on this device, so the blurs, glow, and grain are off.');
                }
                return;
            }
            if (now - lastScroll < 300) requestAnimationFrame(watch);
            else {
                watching = false;
                lastFrame = 0;
            }
        };
        const onScroll = () => {
            const now = performance.now();
            if (now < settled) return;
            lastScroll = now;
            if (watching) return;
            watching = true;
            requestAnimationFrame(watch);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
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

    /* ---------- Coming back to the page ---------- */
    // The page remembers where it was when the visitor leaves, and puts them back at the same spot, before it's first
    // shown, when they return by the résumé's Back link (see resume.js), or by the browser's back button or a reload
    // that loads the page again (rather than restoring it as it was). The browser's own restoring can run before the
    // page has grown to its full height and land short. It's set once more when the fonts settle.
    window.addEventListener('pagehide', () => {
        try { sessionStorage.setItem('returnY', String(Math.round(window.scrollY))); } catch (e) {}
    });
    let returnY = 0;
    try {
        const nav = performance.getEntriesByType('navigation')[0];
        const loadedAgain = nav && (nav.type === 'back_forward' || nav.type === 'reload');
        if (sessionStorage.getItem('fromResume') || loadedAgain) returnY = Number(sessionStorage.getItem('returnY')) || 0;
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
        linkedPanel._shrink = motion && !!card; // closing shrinks it back into its card, like one opened from the card
        linkedPanel.showModal();
        settleParts(linkedPanel);
        showPanelUrl(linkedPanel);
    }

    /* ---------- A hello for anyone who opens the developer console ---------- */
    // (once the page is drawn, so reading the accent color doesn't hold up the first frame)
    afterPaint(() => {
        const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#e0b25c';
        console.log('%cHi there, fellow developer!', `font: 600 15px/1.6 system-ui, sans-serif; color: ${accent}`);
        console.log(`This site is plain HTML, CSS, and JavaScript, with no framework and no build step.
Have a look at the source: https://github.com/sunnnnyli/sunnnnyli.github.io
Tip: press ${isMac ? '⌘K' : 'Ctrl+K'} on the page to jump anywhere.`);
        if (festive) {
            console.log(`%c新年快乐! Happy Lunar New Year!`, `font: 600 13px/1.6 system-ui, sans-serif; color: ${accent}`);
            console.log(`If you find the seal on this page, it's upside down on purpose. Over the new year, 福 (fú, good fortune)
is hung upside down, because "upside down" (倒, dào) sounds just like "has arrived" (到, dào): 福倒了, fortune is upside
down, sounds like 福到了, fortune has arrived.`);
        }
    });
})();
