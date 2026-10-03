# CeyBus

CeyBus is a real-time public transit tracking and visualization platform built for Sri Lanka's public transport network. It enables commuters to monitor live bus positions, view directional route paths (Outbound/Inbound), track real-time telemetry speed, and calculate ETA estimates along active transit corridors.

---

## Key Features

* **Direction-Aware Animated Route Mapping**: Draws complete bus routes (e.g., Route 100 Pettah ⇌ Panadura) using dual-carriageway Leaflet layers. Dynamically detects Northbound vs. Southbound line segment vectors to stream directional animated dash overlays matching actual bus travel.
* **Live Telemetry & GPS Streaming**: Real-time position, speed (0 km/h stop detection), and heading synchronization via Socket.io.
* **Smart Route & Filter Panel**: Filter live buses across origins, destinations, and specific route identifiers with instant map focus and telemetry overlays.
* **Geofenced Arrival & Distance Tracking**: Calculates real-time distance and ETA estimates relative to user location and route waypoints using Haversine distance matrix logic.
* **OpenStreetMap Transit Ingestion**: Built-in automated seed pipeline that parses raw Sri Lankan OpenStreetMap transport relation data directly into Leaflet-ready GeoJSON structures.

---

## Tech Stack

* **Frontend**: HTML5, CSS3, JavaScript (ES6+), Leaflet.js, Socket.io Client
* **Backend**: Node.js, Express.js, Socket.io
* **Database**: MySQL / Cloud Database Integration
* **GIS & Mapping**: OpenStreetMap Data, GeoJSON, CARTO Basemaps

---

## Technical Highlights & Architecture

### Directional Dash Animation Engine
To handle dual-carriageway roadways and separate return lanes without city-crossing vector artifacts, CeyBus processes GeoJSON line segments individually:
* Evaluates geographic latitude progressions ($\text{lat}_{\text{start}} > \text{lat}_{\text{end}}$) per segment.
* Dynamically assigns CSS keyframe animations (`.route-flow-forward` / `.route-flow-reverse`) based on whether the bus is operating **Outbound** or **Inbound**.

---

## Getting Started

### Prerequisites
* **Node.js**: `v18.x` or higher
* **npm**: `v9.x` or higher
* **MySQL**: Local or cloud-hosted instance

### Local Setup

1. **Clone the Repository**:
   git clone https://github.com/avinashperera-ops/CeyBus.git
   cd CeyBus

2. **Install Dependencies**:
   npm install

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   PORT=3000
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=ceybus_db

4. **Seed Route Data**:
   node seed_routes.js

5. **Run the Application**:
   npm run dev

6. **Access in Browser**:
   Navigate to http://localhost:3000/passenger.html

---

## Repository Structure

CeyBus/
├── public/
│   ├── passenger.html         # Live passenger map & tracking interface
│   ├── app.js                 # Leaflet map instance, socket listeners, and flow animations
│   ├── css/                   # Application styling & CSS dash flow keyframes
│   └── js/                    # Client utility scripts
├── src/
│   ├── config/                # Database connections (MySQL)
│   ├── controllers/           # Route geometry & telemetry handlers
│   ├── routes/                # Express API endpoints (/api/routes/:id/shape)
│   └── socket/                # Socket.io event dispatchers
├── seed_routes.js             # GIS shape importer & route seeder script
├── sri_lanka_raw_routes.json  # Raw OpenStreetMap Sri Lanka transit relation data
├── .env.example               # Environment variables template
├── package.json
└── README.md

---

## License

Distributed under the MIT License.

**Screenshots**
<img width="3199" height="1597" alt="Screenshot 2026-10-01 115735" src="https://github.com/user-attachments/assets/c4406aa7-0591-427c-a9d9-e80827545f4f" />

<img width="3199" height="1611" alt="Screenshot 2026-10-01 115724" src="https://github.com/user-attachments/assets/00dfdd8c-26de-4e99-ba0e-5754c94113a9" />

<img width="3199" height="1611" alt="Screenshot 2026-10-01 115707" src="https://github.com/user-attachments/assets/707f28c9-36d2-4615-95db-e5420b583be0" />
