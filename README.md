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

2. **Install Dependencies:**
   ```bash
   npm install

3. **Set up environment variables:**
Create a .env file in the root directory with your setup details:
```bash
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=ceybus_db
```
4. **Database Configuration:**
Import your database schema into MySQL to initialize the necessary tables for routes, stops, and schedules.

5. **Start the application:**
```bash
# Development mode
npm run dev

# Production mode
npm start
```
6. **View the application:**
Open your browser and navigate to
```bash
http://localhost:3000
```

**Repository Structure**
```bash
CeyBus/
├── public/
│   ├── index.html       # Map interface and socket client script
│   ├── css/             # Application styles
│   └── js/              # Frontend logic
├── src/
│   ├── config/          # Database configuration
│   ├── controllers/     # Controller handlers
│   ├── routes/          # Express route definitions
│   └── socket/          # Socket.io event handlers
├── .gitignore
├── package.json
└── README.md
```
**License**
Distributed under the MIT License.

**Screenshots**
<img width="3199" height="1597" alt="Screenshot 2026-10-01 115735" src="https://github.com/user-attachments/assets/c4406aa7-0591-427c-a9d9-e80827545f4f" />

<img width="3199" height="1611" alt="Screenshot 2026-10-01 115724" src="https://github.com/user-attachments/assets/00dfdd8c-26de-4e99-ba0e-5754c94113a9" />

<img width="3199" height="1611" alt="Screenshot 2026-10-01 115707" src="https://github.com/user-attachments/assets/707f28c9-36d2-4615-95db-e5420b583be0" />
