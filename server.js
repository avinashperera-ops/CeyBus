const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for active broadcasting buses
const activeBuses = new Map();

// --- SOCKET.IO REAL-TIME TELEMETRY ENGINE ---
io.on('connection', (socket) => {
    // Send active bus count to connected passenger
    socket.emit('busCountUpdate', { count: activeBuses.size });

    // Handle Driver GPS Telemetry Broadcast
    socket.on('updateLocation', (data) => {
        if (data && data.plateNumber) {
            activeBuses.set(data.plateNumber, {
                ...data,
                socketId: socket.id
            });

            // Broadcast updated location to all passengers
            io.emit('busLocationUpdated', data);
            io.emit('busCountUpdate', { count: activeBuses.size });
        }
    });

    // Handle Driver Stopping Trip Broadcast
    socket.on('stopLocationBroadcast', (data) => {
        if (data && data.plateNumber) {
            activeBuses.delete(data.plateNumber);
            io.emit('busOffline', { plateNumber: data.plateNumber });
            io.emit('busCountUpdate', { count: activeBuses.size });
        }
    });

    // Handle Disconnection (e.g. driver closes tab)
    socket.on('disconnect', () => {
        for (let [plateNumber, bus] of activeBuses.entries()) {
            if (bus.socketId === socket.id) {
                activeBuses.delete(plateNumber);
                io.emit('busOffline', { plateNumber });
                io.emit('busCountUpdate', { count: activeBuses.size });
                break;
            }
        }
    });
});

// Endpoint for passengers to fetch initial active fleet
app.get('/api/buses/active', (req, res) => {
    res.json(Array.from(activeBuses.values()));
});

// ROUTE SHAPES ENDPOINT (Serves static GeoJSON route lines to Leaflet)
// ROUTE SHAPES ENDPOINT
app.get('/api/routes/:routeNumber/shape', (req, res) => {
    const rawRoute = req.params.routeNumber.trim();
    // Extracts numeric value e.g., "Route 100" -> "100"
    const cleanRoute = rawRoute.replace(/[^0-9]/g, '');

    db.get(
        `SELECT Shape_GeoJSON, Origin, Destination FROM ROUTE_SHAPE 
         WHERE Route_Number = ? 
            OR Route_Number = ? 
            OR Route_Number = ?`,
        [rawRoute, cleanRoute, `Route ${cleanRoute}`],
        (err, row) => {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database query error.' });
            }
            if (!row) {
                return res.status(404).json({ success: false, message: `Route ${rawRoute} shape not found.` });
            }

            try {
                const geojson = JSON.parse(row.Shape_GeoJSON);
                res.json({
                    success: true,
                    routeNumber: rawRoute,
                    origin: row.Origin,
                    destination: row.Destination,
                    geojson
                });
            } catch (parseError) {
                res.status(500).json({ success: false, message: 'Invalid GeoJSON string format.' });
            }
        }
    );
});;

// Endpoint for driver incident reporting
app.post('/api/incidents', (req, res) => {
    const { plateNumber, routeNumber, type, details, timestamp } = req.body;
    db.run(
        `INSERT INTO INCIDENT_REPORT (Description, Report_Type, Timestamp) VALUES (?, ?, ?)`,
        [`[Bus ${plateNumber} - Route ${routeNumber}] ${details}`, type, timestamp || new Date().toISOString()],
        function (err) {
            if (err) {
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, reportId: this.lastID });
        }
    );
});

// Driver Auth Endpoint
app.post('/api/auth/driver', async (req, res) => {
    const { isRegistration, identifier, password, fullName, licenseNo, plateNumber } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Phone number and password are required.' });
    }

    if (isRegistration) {
        if (!fullName || !licenseNo) {
            return res.status(400).json({ success: false, message: 'Full Name and Driving License Number are required.' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            db.run(
                `INSERT INTO DRIVER (Name, Phone_Number, License_No, Password, Status) VALUES (?, ?, ?, ?, 'pending')`,
                [fullName, identifier, licenseNo, hashedPassword],
                function (err) {
                    if (err) {
                        if (err.message.includes('UNIQUE')) {
                            return res.status(400).json({ success: false, message: 'Phone Number or License Number already registered.' });
                        }
                        return res.status(500).json({ success: false, message: 'Database error.' });
                    }

                    if (plateNumber) {
                        db.run(`INSERT OR IGNORE INTO BUS (Plate_No, Capacity) VALUES (?, 50)`, [plateNumber]);
                    }

                    return res.json({
                        success: true,
                        message: 'Application submitted successfully!',
                        driver: { id: this.lastID, name: fullName, phone: identifier, license: licenseNo, status: 'pending', plateNumber }
                    });
                }
            );
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Server error.' });
        }
    } else {
        db.get(
            `SELECT * FROM DRIVER WHERE Phone_Number = ? OR License_No = ?`,
            [identifier, identifier],
            async (err, driver) => {
                if (err || !driver) {
                    return res.status(401).json({ success: false, message: 'Driver account not found.' });
                }

                const match = await bcrypt.compare(password, driver.Password);
                if (!match) {
                    return res.status(401).json({ success: false, message: 'Invalid password.' });
                }

                return res.json({
                    success: true,
                    driver: { id: driver.Driver_ID, name: driver.Name, phone: driver.Phone_Number, license: driver.License_No, status: driver.Status }
                });
            }
        );
    }
});

// Passenger Auth Endpoint
app.post('/api/auth/passenger', async (req, res) => {
    const { isRegistration, name, email, phone, password } = req.body;

    if (isRegistration) {
        if (!name || !email || !phone || !password) {
            return res.status(400).json({ success: false, message: 'All details required.' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            db.run(
                `INSERT INTO PASSENGER (Name, E_mail, Phone_Number, Password, Status) VALUES (?, ?, ?, ?, 'active')`,
                [name, email, phone, hashedPassword],
                function (err) {
                    if (err) {
                        return res.status(400).json({ success: false, message: 'Email already registered.' });
                    }
                    return res.json({ success: true, passenger: { id: this.lastID, name, email, phone } });
                }
            );
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Server error.' });
        }
    } else {
        db.get(
            `SELECT * FROM PASSENGER WHERE E_mail = ? OR Phone_Number = ?`,
            [email || phone, email || phone],
            async (err, passenger) => {
                if (err || !passenger) {
                    return res.status(401).json({ success: false, message: 'Passenger account not found.' });
                }
                const match = await bcrypt.compare(password, passenger.Password);
                if (!match) {
                    return res.status(401).json({ success: false, message: 'Invalid password.' });
                }
                return res.json({ success: true, passenger: { id: passenger.Passenger_ID, name: passenger.Name, email: passenger.E_mail } });
            }
        );
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`CeyBus server running on http://localhost:${PORT}`));