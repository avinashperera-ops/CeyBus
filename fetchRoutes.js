const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Overpass API Query for all bus routes in Sri Lanka (Bounding Box: [5.9, 79.5, 9.9, 81.9])
const overpassQuery = `
[out:json][timeout:180];
(
  relation["route"="bus"](5.9,79.5,9.9,81.9);
);
out geom;
`;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function fetchSriLankaBusRoutes() {
  console.log('Fetching Sri Lankan bus routes from OpenStreetMap Overpass API...');
  
  try {
    const response = await axios.post(
      OVERPASS_URL, 
      `data=${encodeURIComponent(overpassQuery)}`, 
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          // Custom User-Agent prevents the HTTP 406 Error
          'User-Agent': 'BeepBusTracker/1.0 (Contact: admin@beep.local)'
        },
        timeout: 180000 // 3 minutes timeout for heavy route datasets
      }
    );

    const elements = response.data.elements;
    console.log(`Retrieved ${elements.length} raw transport relations.`);

    const routesMap = {};

    elements.forEach(relation => {
      const tags = relation.tags || {};
      const ref = tags.ref || tags.route_ref; // e.g., "138", "100", "101"
      const name = tags.name || (tags.from && tags.to ? `${tags.from} - ${tags.to}` : `Route ${ref}`);

      if (!ref) return;

      const pathCoordinates = [];
      if (relation.members) {
        relation.members.forEach(member => {
          if (member.type === 'way' && member.geometry) {
            member.geometry.forEach(point => {
              pathCoordinates.push([point.lat, point.lon]);
            });
          }
        });
      }

      if (pathCoordinates.length > 0) {
        const routeKey = ref.trim().toUpperCase();

        if (!routesMap[routeKey]) {
          routesMap[routeKey] = {
            routeNumber: routeKey,
            routeName: name,
            operator: tags.operator || 'SLTB / Private',
            path: pathCoordinates
          };
        } else {
          routesMap[routeKey].path = routesMap[routeKey].path.concat(pathCoordinates);
        }
      }
    });

    const outputPath = path.join(__dirname, 'routes.json');
    fs.writeFileSync(outputPath, JSON.stringify(routesMap, null, 2));
    
    console.log(`Success! Saved ${Object.keys(routesMap).length} unique Sri Lankan bus routes to routes.json`);

  } catch (error) {
    if (error.response) {
      console.error(`Error fetching route data: Server responded with status ${error.response.status}`);
    } else {
      console.error('Error fetching route data:', error.message);
    }
  }
}

fetchSriLankaBusRoutes();