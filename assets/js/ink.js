// The theme switch's ink wash, shared by the portfolio and the résumé: the new theme spreads out from the button like
// a drop of ink soaking into paper. Each drop is drawn ahead of time into a small image (a round core, lobes around its
// edge, and a fringe of small ones at the front, like ink creeping along the paper's fibers), turned at random so no
// two spread alike. During the switch only that one image grows, as a mask on the new view (with --ink-spread, see
// styles.css), so every frame stays cheap. Browsers without @property get a plain circle instead.
window.spreadTheme = (() => {
    const root = document.documentElement;
    const inky = !!window.CSSPropertyRule;
    const SIZE = 768; // the drop's image, in pixels
    const REACH = 1.15; // how far its widest lobes reach, as a share of the drop's size
    const rule = document.createElement('style');
    document.head.append(rule);
    let next = null; // the next drop, drawn and ready
    let current = null; // the switch that's running

    const draw = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const g = canvas.getContext('2d');
        const unit = SIZE / 2 / REACH;
        const lobes = [[0, 0, 0.9]];
        const turn = Math.random() * Math.PI * 2;
        for (let k = 0; k < 11; k++) {
            const a = turn + (k + (Math.random() - 0.5) * 0.6) * ((Math.PI * 2) / 11);
            const d = 0.42 + Math.random() * 0.28;
            lobes.push([Math.cos(a) * d, Math.sin(a) * d, 0.3 + Math.random() * 0.16]);
        }
        for (let k = 0; k < 14; k++) {
            const a = Math.random() * Math.PI * 2;
            const d = 0.8 + Math.random() * 0.14;
            lobes.push([Math.cos(a) * d, Math.sin(a) * d, 0.06 + Math.random() * 0.07]);
        }
        // Each lobe solid in the middle with a soft edge
        lobes.forEach(([dx, dy, r]) => {
            const x = SIZE / 2 + dx * unit;
            const y = SIZE / 2 + dy * unit;
            const radius = r * unit;
            const fill = g.createRadialGradient(x, y, 0, x, y, radius);
            fill.addColorStop(0, '#000');
            fill.addColorStop(Math.max(0, 1 - (unit * 0.035) / radius), '#000');
            fill.addColorStop(1, 'rgba(0, 0, 0, 0)');
            g.fillStyle = fill;
            g.beginPath();
            g.arc(x, y, radius, 0, Math.PI * 2);
            g.fill();
        });
        return canvas;
    };
    // Draws the next drop while nothing else is going on, and has the browser decode it, so a switch starts at once
    const prepare = () => {
        if (!inky || next) return;
        draw().toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.src = url;
            img.decode().catch(() => {}).then(() => { next = url; });
        });
    };
    if (inky) window.addEventListener('load', () => setTimeout(prepare, 600), { once: true });

    // Runs update() as a theme switch spreading out from origin ({ x, y }, on screen), and returns the transition
    return (update, origin) => {
        const vt = document.startViewTransition(update);
        current = vt;
        const { x, y } = origin;
        const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)); // the farthest corner
        let url = null;
        if (inky) {
            url = next || draw().toDataURL(); // not drawn yet (a switch right as the page opens): draw it now
            next = null;
            const size = `calc(var(--ink-spread) * ${REACH * 2})`;
            const place = `calc(${x}px - var(--ink-spread) * ${REACH}) calc(${y}px - var(--ink-spread) * ${REACH})`;
            rule.textContent = `::view-transition-new(root) { -webkit-mask: url("${url}") no-repeat; mask: url("${url}") no-repeat;`
                + ` -webkit-mask-size: ${size} ${size}; mask-size: ${size} ${size}; -webkit-mask-position: ${place}; mask-position: ${place}; }`;
        }
        let spread = null;
        vt.ready.then(() => {
            if (inky) {
                // Grown until even the core covers the farthest corner, and held there until the switch is over (letting
                // go any sooner would show the old theme again for a frame)
                spread = root.animate(
                    { '--ink-spread': ['0px', `${(far + 30) / 0.865}px`] },
                    { duration: 1100, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'forwards', pseudoElement: '::view-transition-new(root)' }
                );
            } else {
                root.animate(
                    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${far}px at ${x}px ${y}px)`] },
                    { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
                );
            }
        }).catch(() => {});
        vt.finished.finally(() => {
            if (spread) spread.cancel(); // the hold isn't needed once the switch is over
            if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
            // Pressed again mid-switch: the newer switch has put its own drop in place
            if (current !== vt) return;
            rule.textContent = '';
            setTimeout(prepare, 300); // the next drop, once this one is done
        }).catch(() => {});
        return vt;
    };
})();
// Link underlines written with a dry brush, on all three pages. On hover (or keyboard focus), a stroke is drawn left to
// right under the link's text: pressed where the brush lands, drifting up a little the way a hand pulls, and breaking
// into bristles as it runs dry at the end. Each one is a small SVG made fresh for the link's width, so it's never
// stretched and no two are alike, revealed behind a mask the way the brush travels, and it fades when the pointer
// leaves. Touch screens and links that wrap onto two lines keep the plain line (.lk-t in styles.css).
(() => {
    const root = document.documentElement;
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    const TAU = Math.PI * 2;
    const rand = (a, b) => a + Math.random() * (b - a);
    const f = (n) => n.toFixed(2);
    let made = 0;

    // The stroke's outline from its centerline and half-widths: along one side, back along the other, and round where
    // the brush landed
    const outline = (pts, half, to) => {
        const left = [];
        const right = [];
        for (let i = 0; i <= to; i++) {
            const p = pts[i];
            const a = pts[Math.max(i - 1, 0)];
            const b = pts[i + 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const nx = -(b.y - a.y) / len;
            const ny = (b.x - a.x) / len;
            const w = half(p.u);
            left.push(`${f(p.x + nx * w)} ${f(p.y + ny * w)}`);
            right.push(`${f(p.x - nx * w)} ${f(p.y - ny * w)}`);
        }
        const r = f(half(0));
        return `M${left[0]} L${left.join(' L')} L${right.reverse().join(' L')} A${r} ${r} 0 0 1 ${left[0]} Z`;
    };

    const stroke = (width, fontSize) => {
        const T = Math.max(1.6, Math.min(3.6, fontSize * 0.14)); // its thickness
        const H = Math.ceil(T * 5 + 6);
        const y0 = H / 2;
        const x0 = -Math.min(4, width * 0.03); // lands a touch before the first letter
        const x1 = width + Math.min(7, width * 0.05); // and lifts a touch after the last
        const rise = -T * rand(0.3, 0.9);
        const [wave, waves, wavePhase] = [T * rand(0.1, 0.28), rand(0.4, 1), rand(0, TAU)];
        const [push, pushes, pushPhase] = [rand(0.04, 0.1), rand(1.5, 3), rand(0, TAU)];
        const N = Math.max(30, Math.round((x1 - x0) / 2.5));
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const u = i / N;
            pts.push({ u, x: x0 + (x1 - x0) * u, y: y0 + rise * u + wave * Math.sin(TAU * waves * u + wavePhase) });
        }
        // Half the stroke's width along it: pressed at the start, the pressure wavering, lightening toward the end
        const half = (u) => (T / 2) * (u < 0.06 ? 1.4 - 0.4 * (u / 0.06) : 1) * (1 + push * Math.sin(TAU * pushes * u + pushPhase)) * (u > 0.6 ? 1 - ((u - 0.6) / 0.4) * 0.7 : 1);
        let ink = `<path d="${outline(pts, half, Math.round(N * 0.72))}"/>`;
        // The bristles that carry on once the brush runs dry, each skipping where it lifts off the paper
        for (let j = 0; j < 5; j++) {
            const spread = (j / 4 - 0.5) * 1.5;
            const line = [];
            for (let i = Math.round(N * 0.6), end = Math.round(N * rand(0.84, 1)); i <= end; i++) {
                line.push(`${f(pts[i].x)} ${f(pts[i].y + spread * half(pts[i].u))}`);
            }
            const dash = [];
            for (let k = 0, run = rand(4, 10); k < 8; k++, run = Math.max(1.2, run * rand(0.45, 0.8))) dash.push(f(run), f(rand(0.8, 2.5) + k * 0.4));
            ink += `<path d="M${line.join(' L')}" fill="none" stroke="currentColor" stroke-width="${f(rand(0.45, 0.7) * T * 0.45)}" stroke-linecap="round" stroke-dasharray="${dash.join(' ')}" opacity="${f(rand(0.7, 1))}"/>`;
        }
        const pad = 2;
        const left = x0 - pad;
        const L = x1 - x0 + pad * 2;
        const id = `brush-line-${++made}`;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'brush-line');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('viewBox', `${f(left)} 0 ${f(L)} ${H}`);
        // Its size and place set right on it, so icon rules on the link (the résumé's 15px arrows, say) leave it alone
        svg.style.width = `${f(L)}px`;
        svg.style.height = `${H}px`;
        svg.style.left = `${f(left)}px`;
        svg.innerHTML = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${f(left)}" y="0" width="${f(L)}" height="${H}">`
            + `<path d="M${f(left)} ${f(y0)} H${f(left + L)}" stroke="#fff" stroke-width="${H * 2}" fill="none" stroke-dasharray="${f(L)} ${f(L)}" stroke-dashoffset="${f(L)}"/></mask></defs>`
            + `<g fill="currentColor" stroke="none" mask="url(#${id})">${ink}</g>`;
        return { svg, T, H, L, reveal: svg.querySelector('mask path') };
    };

    const showing = new Map();
    const draw = (lk) => {
        if (lk.getClientRects().length !== 1) return; // wrapped onto two lines: the plain line handles that
        const old = showing.get(lk);
        if (old) old.remove();
        // Layout sizes, not on-screen ones, so a tilted card doesn't skew the stroke
        const s = stroke(lk.offsetWidth, parseFloat(getComputedStyle(lk).fontSize));
        s.svg.style.top = `${f(lk.offsetHeight - s.T * 0.5 - s.H / 2)}px`;
        lk.classList.add('brushing');
        lk.append(s.svg);
        showing.set(lk, s.svg);
        if (root.classList.contains('motion')) {
            s.reveal.animate(
                [{ strokeDashoffset: `${f(s.L)}px` }, { strokeDashoffset: '0px' }],
                { duration: Math.min(620, 240 + lk.offsetWidth * 1.6), easing: 'cubic-bezier(0.35, 0.1, 0.25, 1)', fill: 'forwards' }
            );
        } else {
            s.reveal.setAttribute('stroke-dashoffset', '0');
        }
    };
    const lift = (lk) => {
        const svg = showing.get(lk);
        if (!svg) return;
        showing.delete(lk);
        const done = () => {
            svg.remove();
            if (!showing.has(lk)) lk.classList.remove('brushing');
        };
        if (!root.classList.contains('motion')) return done();
        svg.animate({ opacity: [1, 0] }, { duration: 280, easing: 'ease-out' }).finished.then(done, done);
    };

    // A link's underlined text, the way the hover rules in styles.css find it: anywhere in a link, or right inside a button
    const lineOf = (el) => {
        const host = el instanceof Element ? el.closest('a, button') : null;
        const lk = host && host.querySelector(host.tagName === 'A' ? '.lk-t' : ':scope > .lk-t');
        return lk ? { host, lk } : null;
    };
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse' || !fine.matches) return;
        const it = lineOf(e.target);
        if (it && !it.host.contains(e.relatedTarget)) draw(it.lk);
    });
    document.addEventListener('pointerout', (e) => {
        const it = lineOf(e.target);
        if (it && !it.host.contains(e.relatedTarget)) lift(it.lk);
    });
    document.addEventListener('focusin', (e) => {
        const it = lineOf(e.target);
        if (it && it.host === e.target && it.host.matches(':focus-visible')) draw(it.lk);
    });
    document.addEventListener('focusout', (e) => {
        const it = lineOf(e.target);
        if (it && it.host === e.target) lift(it.lk);
    });
})();
