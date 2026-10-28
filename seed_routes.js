// seed_routes.js — converts sri_lanka_raw_routes.json (OSM) into ROUTE_SHAPE rows.  Run: npm run seed
const fs = require('fs');
const path = require('path');
const osmtogeojson = require('osmtogeojson');

// Pure function (no DB access): GeoJSON features -> Map(routeRef -> { origin, destination, lines })
function buildRouteShapes(features) {
    const byRef = new Map();

    for (const feature of features) {
        const props = feature.properties || {};
        const geom = feature.geometry;
        if (!geom) continue;

        // Only bus route relations. Individual road ways/nodes can carry a "ref" such as "A4"
        // and used to be saved as bogus routes.
        const fid = String(feature.id || props['@id'] || '');
        if (!fid.startsWith('relation/')) continue;
        if (props.route && props.route !== 'bus') continue;

        let lines;
        if (geom.type === 'LineString') lines = [geom.coordinates];
        else if (geom.type === 'MultiLineString') lines = geom.coordinates;
        else continue;

        // "ref" may hold several numbers ("131, 140, 152"); register the shape under each one.
        const refs = String(props.ref || '').split(/[;,]/).map((r) => r.trim()).filter(Boolean);
        if (refs.length === 0) continue; // relations without a route number can't be looked up

        for (const ref of refs) {
            if (!byRef.has(ref)) byRef.set(ref, { origin: '', destination: '', lines: [], seen: new Set() });
            const entry = byRef.get(ref);

            entry.origin = entry.origin || props.from || '';
            entry.destination = entry.destination || props.to || '';

            // Several relations share a number (one per direction / variant): keep them ALL
            // instead of letting the last one overwrite the others, but skip exact duplicates.
            for (const line of lines) {
                const key = JSON.stringify(line);
                if (!entry.seen.has(key)) {
                    entry.seen.add(key);
                    entry.lines.push(line);
                }
            }
        }
    }
    return byRef;
}

async function seedRoutes() {
    const db = require('./database');
    const { run } = db.q;
    await db.ready;

    const jsonPath = path.join(__dirname, 'sri_lanka_raw_routes.json');
    if (!fs.existsSync(jsonPath)) {
        throw new Error('sri_lanka_raw_routes.json not found! Run: npm run fetch-routes');
    }

    console.log('Reading raw Overpass file...');
    const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    console.log('Converting OSM data to GeoJSON...');
    const geojson = osmtogeojson(rawData);

    const routes = buildRouteShapes(geojson.features);
    console.log(`Found ${routes.size} bus routes with a route number.`);

    await run('BEGIN TRANSACTION');
    try {
        await run('DELETE FROM ROUTE_SHAPE'); // rebuild: clears junk rows from earlier seeds
        for (const [ref, r] of routes) {
            const geometry = r.lines.length === 1
                ? { type: 'LineString', coordinates: r.lines[0] }
                : { type: 'MultiLineString', coordinates: r.lines };
            await run(
                `INSERT INTO ROUTE_SHAPE (Route_Number, Origin, Destination, Shape_GeoJSON) VALUES (?, ?, ?, ?)`,
                [ref, r.origin, r.destination, JSON.stringify(geometry)]
            );
        }
        await run('COMMIT');
        console.log(`Successfully seeded ${routes.size} route shapes into bus_tracker.db`);
    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
    }
}

module.exports = { buildRouteShapes };

if (require.main === module) {
    seedRoutes()
        .then(() => process.exit(0))
        .catch((err) => { console.error('Seeding failed:', err.message); process.exit(1); });
}
