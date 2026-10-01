# CeyBus

CeyBus is a web application designed for real-time public transit tracking. It helps commuters monitor bus locations on a live map, view active route paths, and get calculated arrival times and status updates for approaching vehicles.

---

## Key Features

- **Live GPS Updates:** Displays bus positions on an interactive dark-themed map using Socket.io for real-time data streaming.
- **Dynamic Route Mapping:** Draws full route paths when a specific transit line (such as Route 100, 101, or 138) is selected.
- **User Geolocation:** Detects the passenger's current location via browser coordinates to show distance relative to nearby buses.
- **ETA and Status Tracking:** Uses distance algorithms based on route waypoints and the Haversine formula to check whether a bus is on its way or has already passed, providing updated arrival estimates.
- **Commuter Control Panel:** A side panel showing route selection options, user location status, and details for the selected bus.

---

## Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+), Leaflet.js
- **Backend:** Node.js, Express.js, Socket.io
- **Database:** MySQL
- **Map Tiles:** CARTO Dark Matter

---

## Getting Started

### Prerequisites

You will need the following installed on your system:

- Node.js (v14.x or higher)
- npm
- MySQL Server

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/](https://github.com/)<YOUR_GITHUB_USERNAME>/CeyBus.git
   cd CeyBus
