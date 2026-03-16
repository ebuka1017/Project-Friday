// ═══════════════════════════════════════════════════════════════════════
// renderer/rich-media.js — Rich Media Detection & Rendering
// Detects YouTube, Spotify, and generic URLs to render interactive cards.
// ═══════════════════════════════════════════════════════════════════════

export function classifyURL(url) {
    if (/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/.test(url)) {
        const id = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/)[1];
        return { type: 'youtube', id };
    }
    if (/open\.spotify\.com\/(track|album|playlist|episode|show)\/([\w]+)/.test(url)) {
        const match = url.match(/spotify\.com\/(track|album|playlist|episode|show)\/([\w]+)/);
        return { type: 'spotify', kind: match[1], id: match[2] };
    }
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) {
        return { type: 'image' };
    }
    if (/^https?:\/\//.test(url)) {
        return { type: 'url' };
    }
    return { type: 'text' };
}

export function renderYouTube(id) {
    const wrap = document.createElement('div');
    wrap.className = 'rm-embed rm-youtube';
    wrap.innerHTML = `
        <div class="rm-yt-thumb" style="position:relative;cursor:pointer">
            <img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" style="width:100%;display:block;border-radius:10px">
            <div class="rm-play-btn">▶</div>
        </div>`;
    
    wrap.querySelector('.rm-yt-thumb').onclick = function() {
        this.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1" 
            style="width:100%;aspect-ratio:16/9;border:none;border-radius:10px" 
            allow="autoplay;fullscreen" allowfullscreen></iframe>`;
    };
    return wrap;
}

export function renderSpotify(kind, id) {
    const heights = { track: 80, album: 380, playlist: 380, episode: 232, show: 232 };
    const el = document.createElement('iframe');
    el.className = 'rm-embed rm-spotify';
    el.src = `https://open.spotify.com/embed/${kind}/${id}?theme=0`;
    el.width = '100%';
    el.height = heights[kind] ?? 232;
    el.style.border = 'none';
    el.style.borderRadius = '12px';
    el.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    el.loading = 'lazy';
    return el;
}

export function renderImage(url) {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'rm-inline-img';
    img.style.cssText = 'max-width:100%;border-radius:10px;cursor:zoom-in;display:block;margin-top:8px';
    img.loading = 'lazy';
    img.onclick = () => {
        const lb = document.createElement('div');
        lb.className = 'rm-lightbox';
        lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out';
        lb.innerHTML = `<img src="${url}" style="max-width:90vw;max-height:90vh;border-radius:12px">`;
        lb.onclick = () => lb.remove();
        document.body.appendChild(lb);
    };
    return img;
}

export async function renderLinkPreview(url) {
    const card = document.createElement('div');
    card.className = 'rm-link-card';
    card.innerHTML = '<div class="rm-skeleton"></div>';

    try {
        const meta = await window.friday.fetchLinkPreview(url);
        card.innerHTML = `
            ${meta.image ? `<img src="${meta.image}" class="rm-card-img" onerror="this.remove()">` : ''}
            <div class="rm-card-body">
                <div class="rm-card-source">
                    <img src="${meta.favicon}" width="14" onerror="this.remove()">
                    <span>${new URL(url).hostname.replace('www.', '')}</span>
                </div>
                <div class="rm-card-title">${meta.title || url}</div>
                ${meta.description ? `<div class="rm-card-desc">${meta.description}</div>` : ''}
            </div>`;
    } catch (e) {
        card.innerHTML = `<div class="rm-card-body"><div class="rm-card-title">${url}</div></div>`;
    }

    card.onclick = () => window.friday.openExternal(url);
    return card;
}

export async function enrichMessage(container) {
    const urlRegex = /https?:\/\/[^\s"<>]+/g;
    const text = container.textContent;
    const urls = [...new Set(text.match(urlRegex) || [])];

    for (const url of urls) {
        const classification = classifyURL(url);
        let node;
        
        // Check iframely if its a generic URL
        if (classification.type === 'url') {
            const iframelyData = await window.friday.fetchIframely(url).catch(() => null);
            if (iframelyData && iframelyData.html) {
                node = document.createElement('div');
                node.className = 'rm-embed rm-iframely';
                node.innerHTML = iframelyData.html;
                node.querySelectorAll('iframe').forEach(f => {
                    f.style.cssText = 'width:100%;border:none;border-radius:10px';
                });
            } else {
                node = await renderLinkPreview(url);
            }
        } else if (classification.type === 'youtube') {
            node = renderYouTube(classification.id);
        } else if (classification.type === 'spotify') {
            node = renderSpotify(classification.kind, classification.id);
        } else if (classification.type === 'image') {
            node = renderImage(url);
        }
        
        if (node) {
            container.appendChild(node);
        }
    }
}
