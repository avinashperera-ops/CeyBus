// fetchRoutes.js — downloads Sri Lankan bus route relations from OpenStreetMap (Overpass)
// and saves the RAW response to sri_lanka_raw_routes.json, which seed_routes.js reads.
//   npm run fetch-routes && npm run seed
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// "out body; >; out skel qt;" returns the relations plus their member ways and nodes.
// osmtogeojson needs those nodes to rebuild geometry (the old "out geom" output is a different
// shape that seed_routes.js could not read, so routes.json was never actually used).
const overpassQuery = `
[out:json][timeout:180];
relation["route"="bus"](5.9,79.5,9.9,81.9);
out body;
>;
out skel qt;
`;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OUTPUT_PATH = path.join(__dirname, 'sri_lanka_raw_routes.json');

async function fetchSriLankaBusRoutes() {
    console.log('Fetching Sri Lankan bus routes from the OpenStreetMap Overpass API...');

    try {
        const response = await axios.post(
            OVERPASS_URL,
            `data=${encodeURIComponent(overpassQuery)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'CeyBus/1.0 (student project)' // Overpass rejects requests without one (HTTP 406)
                },
                timeout: 180000
            }
        );

        const elements = response.data && response.data.elements;
        if (!Array.isArray(elements) || elements.length === 0) {
            throw new Error('Overpass returned no elements.');
        }

        const relations = elements.filter((e) => e.type === 'relation').length;
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(response.data));
        console.log(`Saved ${elements.length} elements (${relations} bus relations) to sri_lanka_raw_routes.json`);
        console.log('Now run: npm run seed');
    } catch (error) {
        if (error.response) {
            console.error(`Error fetching route data: server responded with status ${error.response.status}`);
        } else {
            console.error('Error fetching route data:', error.message);
        }
        process.exitCode = 1;
    }
}

fetchSriLankaBusRoutes();
