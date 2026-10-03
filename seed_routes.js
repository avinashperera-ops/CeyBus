// seed_routes.js
const fs = require('fs');
const path = require('path');
const osmtogeojson = require('osmtogeojson');
const db = require('./database');

function seedRoutes() {
    const jsonPath = path.join(__dirname, 'sri_lanka_raw_routes.json');

    if (!fs.existsSync(jsonPath)) {
        console.error('Error: sri_lanka_raw_routes.json not found!');
        process.exit(1);
    }

    console.log('Reading raw Overpass file...');
    const rawContent = fs.readFileSync(jsonPath, 'utf8');
    const rawData = JSON.parse(rawContent);

    console.log('Converting OSM data to GeoJSON...');
    const geojson = osmtogeojson(rawData);

    console.log(`Processing ${geojson.features.length} features...`);

    const stmt = db.prepare(`
        INSERT INTO ROUTE_SHAPE (Route_Number, Origin, Destination, Shape_GeoJSON)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(Route_Number) DO UPDATE SET
            Origin = excluded.Origin,
            Destination = excluded.Destination,
            Shape_GeoJSON = excluded.Shape_GeoJSON
    `);

    let savedCount = 0;

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        for (const feature of geojson.features) {
            const props = feature.properties || {};
            const routeNumber = props.ref || props['route_ref'] || props.name;

            if (routeNumber && (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')) {
                const origin = props.from || '';
                const destination = props.to || '';
                const shapeJson = JSON.stringify(feature.geometry);

                stmt.run(String(routeNumber).trim(), origin, destination, shapeJson);
                savedCount++;
            }
        }

        db.run("COMMIT", (err) => {
            if (err) {
                console.error('Failed to commit transaction:', err.message);
            } else {
                console.log(`Successfully seeded ${savedCount} route shapes into bus_tracker.db SQLite database!`);
            }
        });
    });

    stmt.finalize();
}

// Give SQLite a moment to complete database table initialization
setTimeout(seedRoutes, 1000);