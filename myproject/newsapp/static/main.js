// ═══════════════════════════════════════════════════════
//  PALLADIUM — main.js
//  Three.js globe + UI interactions
// ═══════════════════════════════════════════════════════

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

// Marker colours
const COL_DEFAULT  = new THREE.Color(0x15dc51);
const COL_HOVER    = new THREE.Color(0xf718f7);
const COL_ACTIVE   = new THREE.Color(0xff88ff);

const markerGeo = new THREE.SphereGeometry(0.022, 12, 12);
const markers   = [];
let   activeMarker = null;

countries.forEach(c => {
    // Pulsing ring behind each marker
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

    // Dot
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
const DRAG_THRESHOLD = 4; // px

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

        // Cancel smooth focus if user drags manually
        targetRotX = null;
        targetRotY = null;

        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
    } else {
        // Hover check
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

    if (movedX < DRAG_THRESHOLD && movedY < DRAG_THRESHOLD) {
        // It's a click, not a drag
        handleClick(e);
    }
    isDragging = false;
});

renderer.domElement.addEventListener("mouseleave", () => {
    isDragging = false;
    renderer.domElement.style.cursor = 'grab';
    markers.forEach(m => {
        if (m !== activeMarker) m.material.color.copy(COL_DEFAULT);
    });
});

// Touch support
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

        // Restore previous active
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

// ── Supabase (credentials injected later) ────────────
const SUPABASE_URL = "";
const SUPABASE_KEY = "";
// const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const countryTableMap = {
    'USA':       'USA_news',
    'Russia':    'Russia_news',
    'India':     'India_news',
    'Australia': 'Australia_news',
    'China':     'China_news',
};

// ── Side panel ────────────────────────────────────────
async function openSidePanel(countryName) {
    const panel   = document.getElementById("infoPanel");
    const title   = document.getElementById("countryTitle");
    const content = document.getElementById("panelContent");

    title.textContent = countryName;
    panel.style.width = `${parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 420}px`;

    // Loading state
    content.innerHTML = `
        <div class="loader-wrap">
            <div class="loader"></div>
            <p>Fetching dispatches…</p>
        </div>`;

    try {
        /* ── Uncomment when credentials are ready ──
        const tableName = countryTableMap[countryName];
        if (!tableName) throw new Error('No table for this country');

        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;
        displayNewsData(data);
        */

        // Placeholder until credentials provided
        displayPlaceholder(countryName);

    } catch (err) {
        console.error('Supabase error:', err);
        content.innerHTML = `<p style="color:#ff8888;font-size:0.8rem;">Could not load dispatches. Check console.</p>`;
    }
}

// ── Placeholder content (remove when DB connected) ───
function displayPlaceholder(country) {
    const content = document.getElementById("panelContent");
    const items = [
        { headline: `Breaking: Major development reported across ${country}`, tags: ['politics'] },
        { headline: `Economic outlook shifts as analysts revise forecasts`, tags: ['economy', 'finance'] },
        { headline: `Cultural event draws international attention`, tags: ['culture'] },
        { headline: `Infrastructure update announced by officials`, tags: ['infrastructure'] },
        { headline: `Regional tensions prompt diplomatic discussions`, tags: ['diplomacy', 'international'] },
    ];
    currentNewsItems = items;
    renderNewsItems(items, true);
}

// ── Global news store ─────────────────────────────────
let currentNewsItems = [];

// ── Display real data ─────────────────────────────────
function displayNewsData(newsItems) {
    if (!newsItems || newsItems.length === 0) {
        document.getElementById("panelContent").innerHTML =
            '<p class="panel-hint">No dispatches available for this region.</p>';
        return;
    }
    currentNewsItems = newsItems;
    renderNewsItems(newsItems, false);
}

// ── Render news list ──────────────────────────────────
function renderNewsItems(items, isPlaceholder) {
    const content = document.getElementById("panelContent");

    let html = isPlaceholder
        ? `<p class="panel-hint" style="margin-bottom:18px;font-size:0.7rem;">⚡ Connect Supabase to load live headlines.</p>`
        : '';

    items.forEach((item, idx) => {
        let headlineText, linkUrl;

        if (isPlaceholder) {
            headlineText = item.headline;
            linkUrl      = '#';
        } else {
            const headline = typeof item.headline === 'string'
                ? tryParse(item.headline) : item.headline;
            const link     = typeof item.link === 'string'
                ? tryParse(item.link) : item.link;

            headlineText = typeof headline === 'object'
                ? (headline.text || headline.title || Object.values(headline)[0])
                : headline;
            linkUrl = typeof link === 'object'
                ? (link.url || link.href || Object.values(link)[0])
                : link;
        }

        const tags = (item.tags || []).map(t =>
            `<span class="news-tag">${t}</span>`
        ).join('');

        html += `
            <div class="news-item" data-index="${idx}">
                <h3>${headlineText || 'Untitled'}</h3>
                ${tags ? `<div>${tags}</div>` : ''}
                ${linkUrl && linkUrl !== '#' ? `
                    <a class="news-source-link" href="${linkUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                        ↗ Original source
                    </a>` : ''}
            </div>`;
    });

    content.innerHTML = html;

    // Click listeners
    content.querySelectorAll('.news-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx  = parseInt(el.dataset.index);
            const item = currentNewsItems[idx];

            if (isPlaceholder) {
                openArticleModal(item.headline, 'Connect your Supabase database to display full article content here.', '#');
                return;
            }

            const headline = typeof item.headline === 'string' ? tryParse(item.headline) : item.headline;
            const link     = typeof item.link    === 'string' ? tryParse(item.link)     : item.link;

            const headlineText = typeof headline === 'object'
                ? (headline.text || headline.title || Object.values(headline)[0]) : headline;
            const linkUrl = typeof link === 'object'
                ? (link.url || link.href || Object.values(link)[0]) : link;

            openArticleModal(headlineText, item.content || '', linkUrl);
        });
    });
}

function tryParse(str) {
    try { return JSON.parse(str); } catch { return str; }
}

// ── Article modal ─────────────────────────────────────
function openArticleModal(headline, content, link) {
    const modal = document.getElementById('articleModal');

    document.getElementById('modalHeadline').textContent = headline || 'Untitled';
    document.getElementById('modalContent').innerHTML = content
        ? `<p style="white-space:pre-wrap">${content}</p>`
        : '<p style="opacity:.5">No content available.</p>';

    const linkEl = document.getElementById('modalLink');
    if (link && link !== '#') {
        linkEl.href  = link;
        linkEl.style.display = 'inline-flex';
    } else {
        linkEl.style.display = 'none';
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

window.closeArticleModal = function () {
    document.getElementById('articleModal').style.display = 'none';
    document.body.style.overflow = 'auto';
};

// Close on backdrop click
document.getElementById('articleModal').addEventListener('click', e => {
    if (e.target === document.getElementById('articleModal')) {
        closeArticleModal();
    }
});

// ── Close panel ───────────────────────────────────────
document.getElementById("closePanel").addEventListener("click", () => {
    document.getElementById("infoPanel").style.width = "0";

    // Reset active marker
    if (activeMarker) {
        activeMarker.material.color.copy(COL_DEFAULT);
        activeMarker = null;
    }

    // Reset camera
    targetRotX = null; targetRotY = null;
    targetZoom = 3;
    tgtOffX    = 0;
    tgtOffY    = 0;
});

// ── Keyboard: Escape closes modal / panel ────────────
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

// Ring pulse parameters
let ringPulse = 0;

function animate() {
    requestAnimationFrame(animate);

    ringPulse += 0.03;

    // Pulse rings
    markers.forEach(m => {
        const ring = m.userData.ring;
        if (ring) {
            ring.material.opacity = 0.25 + 0.2 * Math.sin(ringPulse + markers.indexOf(m) * 1.2);
            const s = 1 + 0.12 * Math.sin(ringPulse + markers.indexOf(m) * 1.2);
            ring.scale.setScalar(s);
        }
    });

    // Slow globe auto-rotation when not focused
    if (targetRotX === null && !isDragging) {
        rotY += 0.0008;
    }

    // Smooth to target rotation
    if (targetRotX !== null) {
        rotX += (targetRotX - rotX) * EASE;
        rotY += (targetRotY - rotY) * EASE;
    }

    // Smooth camera offset
    camOffX += (tgtOffX - camOffX) * EASE;
    camOffY += (tgtOffY - camOffY) * EASE;

    // Camera orbit
    const radius = targetZoom;
    camera.position.x = radius * Math.sin(rotY) * Math.cos(rotX) + camOffX;
    camera.position.y = radius * Math.sin(rotX) + camOffY;
    camera.position.z = radius * Math.cos(rotY) * Math.cos(rotX);
    camera.lookAt(camOffX, camOffY, 0);

    // Update coords HUD from camera angle
    const lat = rotX * (180 / Math.PI);
    const lon = ((rotY * (180 / Math.PI)) % 360 + 360) % 360 - 180;
    updateCoords(-lat, -lon);

    // Star slow drift
    stars.rotation.y += 0.00005;

    renderer.render(scene, camera);
}

animate();

// ── Resize ────────────────────────────────────────────
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Panel width on resize ─────────────────────────────
window.addEventListener("resize", () => {
    const panel = document.getElementById("infoPanel");
    if (panel.style.width !== "0px" && panel.style.width !== "") {
        panel.style.width = window.innerWidth <= 600 ? "100vw" : "420px";
    }
});