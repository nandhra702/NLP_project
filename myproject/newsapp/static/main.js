// ═══════════════════════════════════════════════════════
//  PALLADIUM — main.js
//  Three.js globe + Supabase live news + similar articles
// ═══════════════════════════════════════════════════════

// ── Supabase init ──────────────────────────────────────
const SUPABASE_URL = "https://efxvszgpxdkmmlkeexyb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmeHZzemdweGRrbW1sa2VleHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MjA2NDEsImV4cCI6MjA5MDA5NjY0MX0.OcG3Xm5-NEFEcIew1I2M-zUTRgrrG4V27ZOCytVzKFM";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Scene ──────────────────────────────────────────────
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.z = 3;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// ── Stars ──────────────────────────────────────────────
const starGeo = new THREE.BufferGeometry();
const starCount = 7000;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount * 3; i++) {
    starPos[i] = (Math.random() - 0.5) * 200;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));

const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.7 })
);
scene.add(stars);

// ── Globe ──────────────────────────────────────────────
const textureLoader = new THREE.TextureLoader();
const globeTexture = textureLoader.load("static/equitangular_daymap.jpg");

const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshPhongMaterial({
        map: globeTexture,
        shininess: 30,
        specular: new THREE.Color(0x222244),
    })
);
scene.add(globe);

// Subtle atmosphere glow
const atmosGeo = new THREE.SphereGeometry(1.03, 64, 64);
const atmosMat = new THREE.MeshBasicMaterial({
    color: 0x3311aa,
    transparent: true,
    opacity: 0.07,
    side: THREE.FrontSide,
});
scene.add(new THREE.Mesh(atmosGeo, atmosMat));

// ── Lighting ───────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
sunLight.position.set(5, 3, 5);
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x6633ff, 0.4);
rimLight.position.set(-5, -2, -3);
scene.add(rimLight);

// ── Helpers ───────────────────────────────────────────
function latLonToVector3(lat, lon, radius = 1.02) {
    const phi   = (90 - lat)  * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
    );
}

// ── Countries & markers ───────────────────────────────
const countries = [
    { name: "India",     lat: 20.6,   lon: 78.96   },
    { name: "Russia",    lat: 61.52,  lon: 105.318 },
    { name: "China",     lat: 35.86,  lon: 104.19  },
    { name: "USA",       lat: 38.895, lon: -77.036 },
    { name: "Australia", lat: -25.27, lon: 133.775 },
];

const COL_DEFAULT  = new THREE.Color(0x15dc51);
const COL_HOVER    = new THREE.Color(0xf718f7);
const COL_ACTIVE   = new THREE.Color(0xff88ff);

const markerGeo = new THREE.SphereGeometry(0.022, 12, 12);
const markers   = [];
let   activeMarker = null;

countries.forEach(c => {
    const ringGeo = new THREE.RingGeometry(0.03, 0.048, 24);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x15dc51,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(latLonToVector3(c.lat, c.lon, 1.021));
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    ring.userData.isRing = true;
    scene.add(ring);

    const mat    = new THREE.MeshBasicMaterial({ color: COL_DEFAULT });
    const marker = new THREE.Mesh(markerGeo, mat);
    marker.position.copy(latLonToVector3(c.lat, c.lon));
    marker.userData = { country: c.name, ring };
    scene.add(marker);
    markers.push(marker);
});

// ── Drag state ────────────────────────────────────────
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let prevMouseX = 0, prevMouseY = 0;
let rotX = 0, rotY = 0;
const DRAG_THRESHOLD = 4;

// ── Raycaster ─────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

// ── Camera animation state ────────────────────────────
let targetRotX   = null, targetRotY = null;
let targetZoom   = 3;
let camOffX      = 0,  camOffY    = 0;
let tgtOffX      = 0,  tgtOffY    = 0;

// ── Coords HUD ────────────────────────────────────────
const coordsEl = document.getElementById('globeCoords');
function updateCoords(lat, lon) {
    const latStr = lat >= 0 ? `${lat.toFixed(1)}°N` : `${Math.abs(lat).toFixed(1)}°S`;
    const lonStr = lon >= 0 ? `${lon.toFixed(1)}°E` : `${Math.abs(lon).toFixed(1)}°W`;
    coordsEl.textContent = `LAT ${latStr} · LON ${lonStr}`;
}

// ── Mouse events ──────────────────────────────────────
renderer.domElement.addEventListener("mousedown", e => {
    isDragging  = true;
    dragStartX  = e.clientX;
    dragStartY  = e.clientY;
    prevMouseX  = e.clientX;
    prevMouseY  = e.clientY;
});

renderer.domElement.addEventListener("mousemove", e => {
    if (isDragging) {
        const dx = e.clientX - prevMouseX;
        const dy = e.clientY - prevMouseY;
        rotY += dx * 0.004;
        rotX += dy * 0.004;
        rotX  = Math.max(-1.2, Math.min(1.2, rotX));
        targetRotX = null;
        targetRotY = null;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
    } else {
        mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(markers);
        markers.forEach(m => {
            if (m !== activeMarker) m.material.color.copy(COL_DEFAULT);
        });
        if (hits.length > 0 && hits[0].object !== activeMarker) {
            hits[0].object.material.color.copy(COL_HOVER);
            renderer.domElement.style.cursor = 'pointer';
        } else if (hits.length === 0) {
            renderer.domElement.style.cursor = 'grab';
        }
    }
});

renderer.domElement.addEventListener("mouseup", e => {
    const movedX = Math.abs(e.clientX - dragStartX);
    const movedY = Math.abs(e.clientY - dragStartY);
    if (movedX < DRAG_THRESHOLD && movedY < DRAG_THRESHOLD) handleClick(e);
    isDragging = false;
});

renderer.domElement.addEventListener("mouseleave", () => {
    isDragging = false;
    renderer.domElement.style.cursor = 'grab';
    markers.forEach(m => {
        if (m !== activeMarker) m.material.color.copy(COL_DEFAULT);
    });
});

renderer.domElement.addEventListener("touchstart", e => {
    const t = e.touches[0];
    isDragging = true;
    dragStartX = prevMouseX = t.clientX;
    dragStartY = prevMouseY = t.clientY;
}, { passive: true });

renderer.domElement.addEventListener("touchmove", e => {
    if (!isDragging) return;
    const t = e.touches[0];
    rotY += (t.clientX - prevMouseX) * 0.004;
    rotX += (t.clientY - prevMouseY) * 0.004;
    rotX  = Math.max(-1.2, Math.min(1.2, rotX));
    prevMouseX = t.clientX;
    prevMouseY = t.clientY;
    targetRotX = null; targetRotY = null;
}, { passive: true });

renderer.domElement.addEventListener("touchend", e => {
    const t = e.changedTouches[0];
    const movedX = Math.abs(t.clientX - dragStartX);
    const movedY = Math.abs(t.clientY - dragStartY);
    if (movedX < DRAG_THRESHOLD && movedY < DRAG_THRESHOLD) handleClick(t);
    isDragging = false;
});

// ── Click handler ─────────────────────────────────────
function handleClick(e) {
    mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(markers);
    if (hits.length > 0) {
        const marker = hits[0].object;
        if (activeMarker && activeMarker !== marker) {
            activeMarker.material.color.copy(COL_DEFAULT);
        }
        activeMarker = marker;
        marker.material.color.copy(COL_ACTIVE);
        focusOnMarker(marker);
        openSidePanel(marker.userData.country);
    }
}

// ── Camera focus ──────────────────────────────────────
function focusOnMarker(marker) {
    const v = marker.position.clone().normalize();
    targetRotX = Math.asin(v.y);
    targetRotY = Math.atan2(v.x, v.z);
    targetZoom = 2.2;
    tgtOffX    = -0.6;
    tgtOffY    = 0;
}

// ── Global news store ─────────────────────────────────
let currentNewsItems = [];

// ── Side panel — fetch from Supabase ─────────────────
async function openSidePanel(countryName) {
    const panel   = document.getElementById("infoPanel");
    const title   = document.getElementById("countryTitle");
    const content = document.getElementById("panelContent");

    title.textContent = countryName;
    panel.style.width = window.innerWidth <= 600 ? "100vw" : "420px";

    content.innerHTML = `
        <div class="loader-wrap">
            <div class="loader"></div>
            <p>Fetching dispatches…</p>
        </div>`;

    try {
        const { data, error } = await supabase
            .from('world_news')
            .select('id, headline, description, content, url, source_name, published_at, tags, country')
            .eq('country', countryName)
            .order('published_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!data || data.length === 0) {
            content.innerHTML = `<p class="panel-hint">No dispatches available for this region.</p>`;
            return;
        }

        currentNewsItems = data;
        renderNewsItems(data);

    } catch (err) {
        console.error('Supabase error:', err);
        content.innerHTML = `<p style="color:#ff8888;font-size:0.8rem;">Could not load dispatches.<br>${err.message || ''}</p>`;
    }
}

// ── Render news list ──────────────────────────────────
function renderNewsItems(items) {
    const content = document.getElementById("panelContent");
    let html = '';

    items.forEach((item, idx) => {
        const headline = item.headline || 'Untitled';
        const tags = Array.isArray(item.tags)
            ? item.tags.map(t => `<span class="news-tag">${t}</span>`).join('')
            : '';
        const source = item.source_name
            ? `<span class="news-meta">${item.source_name}</span>` : '';
        const pubDate = item.published_at
            ? `<span class="news-meta">${formatDate(item.published_at)}</span>` : '';

        html += `
            <div class="news-item" data-index="${idx}">
                <h3>${headline}</h3>
                <div class="news-item-meta">${source}${pubDate}</div>
                ${tags ? `<div class="news-tags">${tags}</div>` : ''}
                ${item.url ? `
                    <a class="news-source-link" href="${item.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                        ↗ Original source
                    </a>` : ''}
            </div>`;
    });

    content.innerHTML = html;

    content.querySelectorAll('.news-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx  = parseInt(el.dataset.index);
            const item = currentNewsItems[idx];
            openArticleModal(item);
        });
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Article modal — with similar articles ────────────
async function openArticleModal(item) {
    const modal = document.getElementById('articleModal');

    document.getElementById('modalHeadline').textContent = item.headline || 'Untitled';

    // Build body
    const bodyEl = document.getElementById('modalContent');
    const bodyText = item.content || item.description || '';
    bodyEl.innerHTML = bodyText
        ? `<p style="white-space:pre-wrap;margin-bottom:24px">${bodyText}</p>`
        : '<p style="opacity:.5;margin-bottom:24px">No content available.</p>';

    // Add similar articles placeholder
    bodyEl.innerHTML += `
        <div class="similar-section">
            <div class="similar-eyebrow">RELATED DISPATCHES</div>
            <div id="similarList">
                <div class="loader-wrap" style="padding:24px 0">
                    <div class="loader"></div>
                    <p>Loading related…</p>
                </div>
            </div>
        </div>`;

    const linkEl = document.getElementById('modalLink');
    if (item.url) {
        linkEl.href  = item.url;
        linkEl.style.display = 'inline-flex';
    } else {
        linkEl.style.display = 'none';
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Fetch similar articles
    await loadSimilarArticles(item.id);
}

async function loadSimilarArticles(articleId) {
    const listEl = document.getElementById('similarList');
    if (!listEl) return;

    try {
        // Fetch similar article IDs + scores
        const { data: simRows, error: simErr } = await supabase
            .from('similar_articles')
            .select('similar_article_id, similarity_score')
            .eq('article_id', articleId)
            .order('similarity_score', { ascending: false })
            .limit(5);

        if (simErr) throw simErr;
        if (!simRows || simRows.length === 0) {
            listEl.innerHTML = `<p class="panel-hint" style="font-size:0.72rem">No related dispatches found.</p>`;
            return;
        }

        // Fetch the actual articles
        const ids = simRows.map(r => r.similar_article_id);
        const { data: articles, error: artErr } = await supabase
            .from('world_news')
            .select('id, headline, country, source_name, published_at, url, content, description, tags')
            .in('id', ids);

        if (artErr) throw artErr;

        // Map scores back
        const scoreMap = {};
        simRows.forEach(r => { scoreMap[r.similar_article_id] = r.similarity_score; });

        // Sort by score
        const sorted = (articles || []).sort((a, b) =>
            (scoreMap[b.id] || 0) - (scoreMap[a.id] || 0)
        );

        if (sorted.length === 0) {
            listEl.innerHTML = `<p class="panel-hint" style="font-size:0.72rem">No related dispatches found.</p>`;
            return;
        }

        listEl.innerHTML = sorted.map(art => {
            const score = scoreMap[art.id] || 0;
            const pct   = Math.round(score * 100);
            return `
                <div class="similar-item" data-id="${art.id}">
                    <div class="similar-score-bar">
                        <div class="similar-score-fill" style="width:${pct}%"></div>
                    </div>
                    <div class="similar-country">${art.country} · ${pct}% match</div>
                    <div class="similar-headline">${art.headline || 'Untitled'}</div>
                    ${art.source_name ? `<div class="similar-source">${art.source_name}</div>` : ''}
                </div>`;
        }).join('');

        // Click on similar → open that article
        listEl.querySelectorAll('.similar-item').forEach(el => {
            el.addEventListener('click', () => {
                const id  = parseInt(el.dataset.id);
                const art = sorted.find(a => a.id === id);
                if (art) openArticleModal(art);
            });
        });

    } catch (err) {
        console.error('Similar articles error:', err);
        if (listEl) listEl.innerHTML = `<p style="color:#ff8888;font-size:0.72rem">Could not load related dispatches.</p>`;
    }
}

window.closeArticleModal = function () {
    document.getElementById('articleModal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

document.getElementById('articleModal').addEventListener('click', e => {
    if (e.target === document.getElementById('articleModal')) closeArticleModal();
});

// ── Close panel ───────────────────────────────────────
document.getElementById("closePanel").addEventListener("click", () => {
    document.getElementById("infoPanel").style.width = "0";
    if (activeMarker) {
        activeMarker.material.color.copy(COL_DEFAULT);
        activeMarker = null;
    }
    targetRotX = null; targetRotY = null;
    targetZoom = 3;
    tgtOffX    = 0;
    tgtOffY    = 0;
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('articleModal');
        if (modal.style.display === 'flex') {
            closeArticleModal();
        } else {
            document.getElementById("infoPanel").style.width = "0";
        }
    }
});

// ── Animation loop ────────────────────────────────────
const EASE = 0.07;
let ringPulse = 0;

function animate() {
    requestAnimationFrame(animate);
    ringPulse += 0.03;

    markers.forEach(m => {
        const ring = m.userData.ring;
        if (ring) {
            ring.material.opacity = 0.25 + 0.2 * Math.sin(ringPulse + markers.indexOf(m) * 1.2);
            const s = 1 + 0.12 * Math.sin(ringPulse + markers.indexOf(m) * 1.2);
            ring.scale.setScalar(s);
        }
    });

    if (targetRotX === null && !isDragging) rotY += 0.0008;

    if (targetRotX !== null) {
        rotX += (targetRotX - rotX) * EASE;
        rotY += (targetRotY - rotY) * EASE;
    }

    camOffX += (tgtOffX - camOffX) * EASE;
    camOffY += (tgtOffY - camOffY) * EASE;

    const radius = targetZoom;
    camera.position.x = radius * Math.sin(rotY) * Math.cos(rotX) + camOffX;
    camera.position.y = radius * Math.sin(rotX) + camOffY;
    camera.position.z = radius * Math.cos(rotY) * Math.cos(rotX);
    camera.lookAt(camOffX, camOffY, 0);

    const lat = rotX * (180 / Math.PI);
    const lon = ((rotY * (180 / Math.PI)) % 360 + 360) % 360 - 180;
    updateCoords(-lat, -lon);

    stars.rotation.y += 0.00005;
    renderer.render(scene, camera);
}

animate();

// ── Resize ────────────────────────────────────────────
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    const panel = document.getElementById("infoPanel");
    if (panel.style.width !== "0px" && panel.style.width !== "") {
        panel.style.width = window.innerWidth <= 600 ? "100vw" : "420px";
    }
});