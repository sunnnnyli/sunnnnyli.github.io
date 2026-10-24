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
