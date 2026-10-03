// Initialize Leaflet Map (Centered on Colombo/Moratuwa region)
const map = L.map('map').setView([6.9271, 79.8612], 12);

// Add OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Socket.IO Connection
const socket = io();

// Store active bus markers and current route layer
const activeBusMarkers = new Map();
let currentRouteLayer = null;

// Handle real-time active bus count updates
socket.on('busCountUpdate', (data) => {
    const countElement = document.getElementById('active-bus-count');
    if (countElement) {
        countElement.innerText = `Active Buses: ${data.count}`;
    }
});

// Expose function globally
window.loadBusRouteOnMap = function(routeInput) {
    if (!routeInput) {
        console.warn("loadBusRouteOnMap called with empty route input.");
        return;
    }

    const rawRoute = typeof routeInput === 'object' 
        ? (routeInput.routeNumber || routeInput.route_number || routeInput.route) 
        : routeInput;
        
    const cleanRoute = String(rawRoute).replace(/[^0-9]/g, '');

    console.log(`Fetching route shape for Route ${cleanRoute}...`);

    fetch(`/api/routes/${cleanRoute}/shape`)
        .then(res => res.json())
        .then(data => {
            console.log("Route Shape Data:", data);
            if (!data.success) {
                console.warn(`No route shape found for Route ${cleanRoute}`);
                return;
            }

            // Remove previous route line if present
            if (window.currentRouteLayer) {
                map.removeLayer(window.currentRouteLayer);
            }

            // Draw polyline
            window.currentRouteLayer = L.geoJSON(data.geojson, {
                style: {
                    color: '#2563eb',
                    weight: 6,
                    opacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(map);

            // Zoom map to fit route
            map.fitBounds(window.currentRouteLayer.getBounds(), { padding: [40, 40] });
        })
        .catch(err => console.error('Error fetching route shape:', err));
};

// Helper function to create marker and attach click handler
function createBusMarker(plateNumber, lat, lng, routeNumber) {
    const marker = L.marker([lat, lng])
        .bindPopup(`<b>Bus ${plateNumber}</b><br>Route: ${routeNumber || 'N/A'}`)
        .addTo(map);

    // Fetch and display route shape when bus marker is clicked
    marker.on('click', () => {
        if (routeNumber) {
            loadBusRouteOnMap(routeNumber);
        }
    });

    return marker;
}

// Handle real-time location broadcast from driver
socket.on('busLocationUpdated', (data) => {
    const { plateNumber, lat, lng, routeNumber } = data;

    if (activeBusMarkers.has(plateNumber)) {
        // Move existing bus marker
        const marker = activeBusMarkers.get(plateNumber);
        marker.setLatLng([lat, lng]);
    } else {
        // Create new bus marker with route click listener
        const marker = createBusMarker(plateNumber, lat, lng, routeNumber);
        activeBusMarkers.set(plateNumber, marker);
    }

    // Automatically highlight route line when bus broadcasts
    if (routeNumber) {
        loadBusRouteOnMap(routeNumber);
    }
});

// Handle bus going offline
socket.on('busOffline', (data) => {
    if (activeBusMarkers.has(data.plateNumber)) {
        map.removeLayer(activeBusMarkers.get(data.plateNumber));
        activeBusMarkers.delete(data.plateNumber);
    }
});

// Helper to extract route string regardless of DB naming schema
function extractRouteNumber(data) {
    return data.routeNumber || data.route_number || data.route || '100';
}

// Handle real-time location broadcast from driver
socket.on('busLocationUpdated', (data) => {
    const route = extractRouteNumber(data);
    const { plateNumber, lat, lng } = data;

    if (activeBusMarkers.has(plateNumber)) {
        const marker = activeBusMarkers.get(plateNumber);
        marker.setLatLng([lat, lng]);
    } else {
        const marker = L.marker([lat, lng])
            .bindPopup(`<b>Bus ${plateNumber}</b><br>Route: ${route}`)
            .addTo(map);

        marker.on('click', () => loadBusRouteOnMap(route));
        activeBusMarkers.set(plateNumber, marker);
    }

    // Auto-draw route shape when telemetry updates
    loadBusRouteOnMap(route);
});

// Load initial active buses when page loads
fetch('/api/buses/active')
    .then(res => res.json())
    .then(buses => {
        console.log("Initial Active Buses Data:", buses);
        buses.forEach(bus => {
            if (bus.lat && bus.lng) {
                const route = extractRouteNumber(bus);
                const marker = L.marker([bus.lat, bus.lng])
                    .bindPopup(`<b>Bus ${bus.plateNumber}</b><br>Route: ${route}`)
                    .addTo(map);

                marker.on('click', () => loadBusRouteOnMap(route));
                activeBusMarkers.set(bus.plateNumber, marker);

                // Load route line immediately for active bus
                loadBusRouteOnMap(route);
            }
        });
    })
    .catch(err => console.error('Error fetching active buses:', err));

// Fetch and draw GeoJSON route polyline on Leaflet
function loadBusRouteOnMap(routeInput) {
    if (!routeInput) {
        console.warn("loadBusRouteOnMap called with empty or undefined route identifier:", routeInput);
        return;
    }

    // Handle objects or strings safely
    const rawRoute = typeof routeInput === 'object' ? (routeInput.routeNumber || routeInput.route_number || routeInput.route) : routeInput;
    const cleanRoute = String(rawRoute).replace(/[^0-9]/g, '');

    console.log(`[GeoJSON Request] Fetching shape for clean route: "${cleanRoute}" (raw: "${rawRoute}")`);

    fetch(`/api/routes/${cleanRoute}/shape`)
        .then(res => res.json())
        .then(data => {
            console.log("[GeoJSON Response]", data);
            if (!data.success) {
                console.warn(`No static route shape found for Route ${cleanRoute}:`, data.message);
                return;
            }

            // Remove existing route line from map if present
            if (currentRouteLayer) {
                map.removeLayer(currentRouteLayer);
            }

            // Render route polyline on map
            currentRouteLayer = L.geoJSON(data.geojson, {
                style: {
                    color: '#2563eb', // Blue line
                    weight: 6,
                    opacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(map);

            // Zoom map to fit route path
            map.fitBounds(currentRouteLayer.getBounds(), { padding: [40, 40] });
            console.log("Route shape rendered successfully on map!");
        })
        .catch(err => console.error('Error fetching route shape:', err));
}

// Load initial active buses when page loads
fetch('/api/buses/active')
    .then(res => res.json())
    .then(buses => {
        buses.forEach(bus => {
            if (bus.lat && bus.lng) {
                const marker = createBusMarker(bus.plateNumber, bus.lat, bus.lng, bus.routeNumber);
                activeBusMarkers.set(bus.plateNumber, marker);

                // Highlight route shape for initial active bus automatically
                if (bus.routeNumber) {
                    loadBusRouteOnMap(bus.routeNumber);
                }
            }
        });
    })
    .catch(err => console.error('Error fetching active buses:', err));

// Attach click listener to sidebar bus cards (e.g. Route 100 card)
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', (e) => {
        const card = e.target.closest('.bus-card') || e.target.closest('[data-route-number]');
        if (card) {
            const routeNumber = card.dataset.routeNumber || '100';
            loadBusRouteOnMap(routeNumber);
        }
    });
});