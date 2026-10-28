// CeyBus landing-page live map.
// Wrapped in an IIFE so its variables never collide with the inline script in index.html
// (a top-level `const socket` in both files caused a SyntaxError that killed the page script).
(function () {
    'use strict';

    const mapEl = document.getElementById('map');
    if (!mapEl || typeof L === 'undefined') return;

    // ---- Map ---------------------------------------------------------------
    const map = L.map('map', { scrollWheelZoom: false }).setView([6.9271, 79.8612], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Don't hijack page scrolling on the landing page: zoom with the wheel only after clicking the map.
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());

    // ---- State -------------------------------------------------------------
    const socket = window.ceybusSocket || io();
    const activeBusMarkers = new Map();
    let currentRouteLayer = null;
    let currentRouteKey = null;

    // ---- Helpers -----------------------------------------------------------
    // Accept either {lat,lng} or {latitude,longitude}, and different route field names.
    function getCoords(bus) {
        const lat = bus.lat ?? bus.latitude;
        const lng = bus.lng ?? bus.longitude;
        return (typeof lat === 'number' && typeof lng === 'number') ? [lat, lng] : null;
    }

    function getRoute(bus) {
        return bus.routeNumber || bus.route_number || bus.route || '';
    }

    // Keep letters/digits/hyphens so "1-1" stays "1-1" (stripping to digits turned it into "11").
    function normalizeRoute(input) {
        const raw = (input && typeof input === 'object') ? getRoute(input) : input;
        return String(raw || '').replace(/^route\s*/i, '').trim();
    }

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function clearRoute() {
        if (currentRouteLayer) map.removeLayer(currentRouteLayer);
        currentRouteLayer = null;
        currentRouteKey = null;
    }

    // ---- Route polyline ----------------------------------------------------
    function loadBusRouteOnMap(routeInput) {
        const route = normalizeRoute(routeInput);
        if (!route) return;
        if (route === currentRouteKey) return; // already drawn / loading: avoid refetch + re-zoom

        clearRoute();
        currentRouteKey = route;

        fetch(`/api/routes/${encodeURIComponent(route)}/shape`)
            .then(res => res.json())
            .then(data => {
                if (currentRouteKey !== route) return; // user picked another route meanwhile
                if (!data.success || !data.geojson) {
                    console.warn(`No route shape found for Route ${route}`, data.message || '');
                    currentRouteKey = null;
                    return;
                }
                currentRouteLayer = L.geoJSON(data.geojson, {
                    style: { color: '#2563eb', weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }
                }).addTo(map);

                const bounds = currentRouteLayer.getBounds();
                if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
            })
            .catch(err => {
                console.error('Error fetching route shape:', err);
                if (currentRouteKey === route) currentRouteKey = null;
            });
    }
    window.loadBusRouteOnMap = loadBusRouteOnMap;

    // ---- Markers -----------------------------------------------------------
    function upsertBusMarker(bus) {
        const plate = bus.plateNumber;
        const coords = getCoords(bus);
        if (!plate || !coords) return;

        const route = getRoute(bus);
        const popup = `<b>Bus ${escapeHtml(plate)}</b><br>Route: ${escapeHtml(route || 'N/A')}`;

        let marker = activeBusMarkers.get(plate);
        if (marker) {
            marker.setLatLng(coords);
            marker.setPopupContent(popup);
            marker._ceybusRoute = route;
        } else {
            marker = L.marker(coords).bindPopup(popup).addTo(map);
            marker._ceybusRoute = route;
            // Draw the route only for the bus the visitor clicks (auto-drawing on every ping
            // made the line and zoom jump around as soon as two buses were online).
            marker.on('click', () => loadBusRouteOnMap(marker._ceybusRoute));
            activeBusMarkers.set(plate, marker);
        }
    }

    // ---- Realtime ----------------------------------------------------------
    socket.on('busLocationUpdated', upsertBusMarker);

    socket.on('busOffline', (data) => {
        const marker = data && activeBusMarkers.get(data.plateNumber);
        if (marker) {
            map.removeLayer(marker);
            activeBusMarkers.delete(data.plateNumber);
        }
    });

    // ---- Initial state -----------------------------------------------------
    fetch('/api/buses/active')
        .then(res => res.json())
        .then(buses => { if (Array.isArray(buses)) buses.forEach(upsertBusMarker); })
        .catch(err => console.error('Error fetching active buses:', err));

    // Optional: any element with data-route-number highlights that route on click.
    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-route-number]');
        if (el) loadBusRouteOnMap(el.dataset.routeNumber);
    });
})();
