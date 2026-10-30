const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const db = require('./database');
const { signToken, verifyToken, requireRole, createRateLimiter } = require('./auth');

const { run, get, all } = db.q;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configure Google OAuth Client
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(express.json({ limit: '2mb' })); // Increased limit to support base64 profile image uploads
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 15 });

// ---------- helpers ----------
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const PLATE_RE = /^[A-Z0-9][A-Z0-9 -]{1,11}$/;
const normalizePlate = (v) => clean(v, 12).toUpperCase();
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// Ensure Profile_Picture column exists in PASSENGER table
db.ready.then(async () => {
    try {
        await run(`ALTER TABLE PASSENGER ADD COLUMN Profile_Picture TEXT`);
    } catch (e) {
        // Column likely already exists
    }
});

// SQLite CURRENT_TIMESTAMP is UTC without a "Z"; make it unambiguous for browsers.
function toIso(ts) {
    if (!ts) return null;
    const s = String(ts);
    const d = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? new Date(s.replace(' ', 'T') + 'Z') : new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------- REAL-TIME TELEMETRY ----------
const activeBuses = new Map(); // plateNumber -> bus (includes private fields)
const STALE_BUS_MS = 2 * 60 * 1000;

const publicBus = ({ socketId, driverId, lastSeen, ...rest }) => rest; // never leak internals

// Identify the socket (drivers/authority send a token; passengers connect anonymously).
io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    socket.data.user = verifyToken(token) || null;
    next();
});

function removeBus(plateNumber) {
    if (activeBuses.delete(plateNumber)) {
        io.emit('busOffline', { plateNumber });
        io.emit('busCountUpdate', { count: activeBuses.size });
    }
}

io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user && user.role === 'authority') socket.join('authority');

    socket.emit('busCountUpdate', { count: activeBuses.size });

    socket.on('updateLocation', (data) => {
        if (!user || user.role !== 'driver') {
            return socket.emit('broadcastRejected', { message: 'Sign in as an approved driver to broadcast.' });
        }
        if (!user.plateNumber) {
            return socket.emit('broadcastRejected', { message: 'No bus is assigned to your account.' });
        }
        if (!data || typeof data !== 'object') return;

        const lat = Number(data.latitude ?? data.lat);
        const lng = Number(data.longitude ?? data.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

        // Plate and driver identity come from the verified token, not from the client.
        const plateNumber = user.plateNumber;
        const existing = activeBuses.get(plateNumber);
        if (existing && existing.driverId !== user.id && existing.socketId !== socket.id) {
            return socket.emit('broadcastRejected', { message: `Bus ${plateNumber} is already broadcasting.` });
        }

        const speed = Math.min(200, Math.max(0, Number(data.speed) || 0));
        const bus = {
            plateNumber,
            driverName: user.name,
            routeNumber: clean(data.routeNumber, 20),
            origin: clean(data.origin, 60),
            destination: clean(data.destination, 60),
            direction: String(data.direction).toLowerCase() === 'inbound' ? 'inbound' : 'outbound',
            lat, lng, latitude: lat, longitude: lng, // both spellings: different pages read different names
            speed,
            timestamp: Date.now(),
            // private
            socketId: socket.id,
            driverId: user.id,
            lastSeen: Date.now()
        };

        const isNew = !existing;
        activeBuses.set(plateNumber, bus);
        io.emit('busLocationUpdated', publicBus(bus));
        if (isNew) io.emit('busCountUpdate', { count: activeBuses.size });
    });

    socket.on('stopLocationBroadcast', () => {
        // A socket can only stop its own bus.
        for (const [plate, bus] of activeBuses) {
            if (bus.socketId === socket.id) removeBus(plate);
        }
    });

    socket.on('disconnect', () => {
        for (const [plate, bus] of activeBuses) {
            if (bus.socketId === socket.id) removeBus(plate);
        }
    });
});

// Drop buses that stopped sending updates (phone lost signal, GPS off, ...)
setInterval(() => {
    const cutoff = Date.now() - STALE_BUS_MS;
    for (const [plate, bus] of activeBuses) {
        if (bus.lastSeen < cutoff) removeBus(plate);
    }
}, 15000).unref();

// ---------- PUBLIC API ----------
app.get('/api/buses/active', (req, res) => {
    res.json(Array.from(activeBuses.values()).map(publicBus));
});

// List of routes that have a drawable shape (used by the driver console dropdown)
app.get('/api/routes', async (req, res) => {
    try {
        const rows = await all('SELECT Route_Number, Origin, Destination FROM ROUTE_SHAPE ORDER BY Route_Number');
        res.json(rows.map((r) => ({ routeNumber: r.Route_Number, origin: r.Origin || '', destination: r.Destination || '' })));
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Database query error.');
    }
});

// GeoJSON route line for Leaflet
app.get('/api/routes/:routeNumber/shape', async (req, res) => {
    const raw = clean(req.params.routeNumber, 40).replace(/^route\s*/i, '');
    if (!raw) return fail(res, 400, 'Route number required.');

    try {
        const sql = 'SELECT Shape_GeoJSON, Origin, Destination FROM ROUTE_SHAPE WHERE Route_Number = ? COLLATE NOCASE';
        let row = await get(sql, [raw]);

        if (!row) {
            // "138/2" or "1-1" -> try the leading number ("138", "1") before giving up
            const lead = (raw.match(/^\d+/) || [])[0];
            if (lead && lead !== raw) row = await get(sql, [lead]);
        }
        if (!row) return fail(res, 404, `Route ${raw} shape not found.`);

        let geojson;
        try {
            geojson = JSON.parse(row.Shape_GeoJSON);
        } catch {
            return fail(res, 500, 'Invalid GeoJSON string format.');
        }

        res.set('Cache-Control', 'public, max-age=3600');
        res.json({ success: true, routeNumber: raw, origin: row.Origin, destination: row.Destination, geojson });
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Database query error.');
    }
});

// ---------- AUTH ----------
async function bindPlateToDriver(driverId, plateNumber) {
    await run('INSERT OR IGNORE INTO BUS (Plate_No, Capacity) VALUES (?, 50)', [plateNumber]);
    await run('UPDATE DRIVER SET Plate_No = ? WHERE Driver_ID = ?', [plateNumber, driverId]);
}

app.post('/api/auth/driver', authLimiter, async (req, res) => {
    try {
        const { isRegistration } = req.body || {};
        const identifier = clean(req.body.identifier, 30);
        const password = String(req.body.password ?? '');
        const plateNumber = normalizePlate(req.body.plateNumber);

        if (!identifier || !password) return fail(res, 400, 'Identifier and password are required.');
        if (plateNumber && !PLATE_RE.test(plateNumber)) return fail(res, 400, 'Invalid bus plate number.');

        if (isRegistration) {
            const fullName = clean(req.body.fullName, 100);
            const licenseNo = clean(req.body.licenseNo, 20).toUpperCase();

            if (!fullName || !licenseNo) return fail(res, 400, 'Full Name and Driving License Number are required.');
            if (!plateNumber) return fail(res, 400, 'Bus plate number is required.');
            if (!identifier) return fail(res, 400, 'Enter a valid identifier or email.');
            if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters.');

            const hash = await bcrypt.hash(password, 10);
            try {
                const result = await run(
                    `INSERT INTO DRIVER (Name, Phone_Number, License_No, Password, Status, Plate_No)
                     VALUES (?, ?, ?, ?, 'pending', ?)`,
                    [fullName, identifier, licenseNo, hash, plateNumber]
                );
                await run('INSERT OR IGNORE INTO BUS (Plate_No, Capacity) VALUES (?, 50)', [plateNumber]);
                return res.json({
                    success: true,
                    message: 'Application submitted. You can sign in once the transport authority approves it.',
                    driver: { id: result.lastID, status: 'pending' }
                });
            } catch (err) {
                if (String(err.message).includes('UNIQUE')) {
                    return fail(res, 409, 'Phone Number or License Number already registered.');
                }
                throw err;
            }
        }

        // ---- sign in ----
        const driver = await get('SELECT * FROM DRIVER WHERE Phone_Number = ? OR License_No = ?', [identifier, identifier.toUpperCase()]);
        const match = driver && await bcrypt.compare(password, driver.Password);
        if (!match) return fail(res, 401, 'Invalid phone number or password.');

        if (driver.Status !== 'approved') {
            return fail(res, 403, driver.Status === 'pending'
                ? 'Your application is still pending approval by the transport authority.'
                : 'This driver account is not active.');
        }

        let plate = driver.Plate_No;
        if (!plate && plateNumber) {          
            await bindPlateToDriver(driver.Driver_ID, plateNumber);
            plate = plateNumber;
        }

        const token = signToken({ role: 'driver', id: driver.Driver_ID, name: driver.Name, plateNumber: plate || null });
        res.json({
            success: true,
            token,
            driver: {
                id: driver.Driver_ID, name: driver.Name, fullName: driver.Name, phone: driver.Phone_Number,
                license: driver.License_No, status: driver.Status, plateNumber: plate || ''
            }
        });
    } catch (err) {
        console.error('Driver auth error:', err);
        fail(res, 500, 'Server error.');
    }
});

app.post('/api/auth/passenger', authLimiter, async (req, res) => {
    try {
        const { isRegistration } = req.body || {};
        const password = String(req.body.password ?? '');
        const identifier = clean(req.body.identifier || req.body.email || req.body.phone, 120);

        if (!identifier || !password) return fail(res, 400, 'Email/phone and password are required.');

        if (isRegistration) {
            const name = clean(req.body.name, 100);
            const email = clean(req.body.email || identifier, 120).toLowerCase();
            const phone = clean(req.body.phone, 20);

            if (!name || !email || !phone) return fail(res, 400, 'Name, email and phone are required.');
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.');
            if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters.');

            try {
                const result = await run(
                    `INSERT INTO PASSENGER (Name, E_mail, Phone_Number, Password, Status, Profile_Picture) VALUES (?, ?, ?, ?, 'active', ?)`,
                    [name, email, phone, await bcrypt.hash(password, 10), '']
                );
                const passenger = { id: result.lastID, name, email, phone, profilePicture: '' };
                return res.json({ success: true, token: signToken({ role: 'passenger', id: passenger.id, name }), passenger });
            } catch (err) {
                if (String(err.message).includes('UNIQUE')) return fail(res, 409, 'Email already registered.');
                throw err;
            }
        }

        const passenger = await get(
            'SELECT * FROM PASSENGER WHERE E_mail = ? COLLATE NOCASE OR Phone_Number = ?',
            [identifier, identifier]
        );
        const match = passenger && await bcrypt.compare(password, passenger.Password);
        if (!match) return fail(res, 401, 'Invalid email/phone or password.');
        if (passenger.Status && passenger.Status !== 'active') return fail(res, 403, 'This account is not active.');

        res.json({
            success: true,
            token: signToken({ role: 'passenger', id: passenger.Passenger_ID, name: passenger.Name }),
            passenger: { 
                id: passenger.Passenger_ID, 
                name: passenger.Name, 
                email: passenger.E_mail, 
                phone: passenger.Phone_Number, 
                profilePicture: passenger.Profile_Picture || '' 
            }
        });
    } catch (err) {
        console.error('Passenger auth error:', err);
        fail(res, 500, 'Server error.');
    }
});

// ---------- GOOGLE AUTH ENDPOINT ----------
app.post('/api/auth/google', authLimiter, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return fail(res, 400, 'Google token is required.');

        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const email = clean(payload.email, 120).toLowerCase();
        const name = clean(payload.name, 100);
        const picture = clean(payload.picture, 500) || '';

        if (!email) return fail(res, 400, 'Google account email not found.');

        let passenger = await get('SELECT * FROM PASSENGER WHERE E_mail = ? COLLATE NOCASE', [email]);

        if (!passenger) {
            const randomPasswordHash = await bcrypt.hash(Math.random().toString(36), 10);
            const result = await run(
                `INSERT INTO PASSENGER (Name, E_mail, Phone_Number, Password, Status, Profile_Picture) VALUES (?, ?, ?, ?, 'active', ?)`,
                [name, email, '', randomPasswordHash, picture]
            );
            passenger = {
                Passenger_ID: result.lastID,
                Name: name,
                E_mail: email,
                Phone_Number: '',
                Profile_Picture: picture
            };
        } else {
            if (picture && (!passenger.Profile_Picture || passenger.Profile_Picture.includes('googleusercontent'))) {
                await run('UPDATE PASSENGER SET Profile_Picture = ? WHERE Passenger_ID = ?', [picture, passenger.Passenger_ID]);
                passenger.Profile_Picture = picture;
            }
        }

        const sessionToken = signToken({ role: 'passenger', id: passenger.Passenger_ID, name: passenger.Name });
        res.json({
            success: true,
            token: sessionToken,
            passenger: {
                id: passenger.Passenger_ID,
                name: passenger.Name,
                email: passenger.E_mail,
                phone: passenger.Phone_Number || '',
                profilePicture: passenger.Profile_Picture || picture
            }
        });
    } catch (err) {
        console.error('Google auth error:', err);
        fail(res, 401, 'Invalid Google authentication token.');
    }
});

// Update Profile Picture endpoint for normal users
app.patch('/api/passenger/profile-picture', requireRole('passenger'), async (req, res) => {
    try {
        const { profilePicture } = req.body;
        if (!profilePicture) return fail(res, 400, 'Profile picture data required.');

        await run('UPDATE PASSENGER SET Profile_Picture = ? WHERE Passenger_ID = ?', [profilePicture, req.user.id]);
        const p = await get('SELECT * FROM PASSENGER WHERE Passenger_ID = ?', [req.user.id]);
        
        res.json({
            success: true,
            passenger: {
                id: p.Passenger_ID,
                name: p.Name,
                email: p.E_mail,
                phone: p.Phone_Number,
                profilePicture: p.Profile_Picture
            }
        });
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Server error updating profile picture.');
    }
});

app.post('/api/auth/authority', authLimiter, async (req, res) => {
    try {
        const officialId = clean(req.body.officialId, 60);
        const password = String(req.body.password ?? '');
        const pin = String(req.body.pin ?? '');
        if (!officialId || !password) return fail(res, 400, 'Service ID and password are required.');

        const official = await get('SELECT * FROM TRANSPORT_AUTHORITY WHERE Official_ID = ? OR Name = ?', [officialId, officialId]);
        const passOk = official && await bcrypt.compare(password, official.Password);
        const pinOk = official && (!official.PIN || (pin && await bcrypt.compare(pin, official.PIN)));
        if (!passOk || !pinOk) return fail(res, 401, 'Invalid credentials.');

        res.json({
            success: true,
            token: signToken({ role: 'authority', id: official.Authority_ID, name: official.Name }),
            official: { id: official.Authority_ID, name: official.Name, role: official.Role }
        });
    } catch (err) {
        console.error('Authority auth error:', err);
        fail(res, 500, 'Server error.');
    }
});

// ---------- PASSENGER: own profile (token required) ----------
const profileOf = (p) => ({
    id: p.Passenger_ID, name: p.Name, email: p.E_mail, phone: p.Phone_Number, profilePicture: p.Profile_Picture || '', status: p.Status || 'active'
});

async function loadPassenger(req, res) {
    const p = await get('SELECT * FROM PASSENGER WHERE Passenger_ID = ?', [req.user.id]);
    if (!p || (p.Status && p.Status !== 'active')) {
        fail(res, 401, 'Authentication required.');
        return null;
    }
    return p;
}

app.get('/api/passenger/me', requireRole('passenger'), async (req, res) => {
    try {
        const p = await loadPassenger(req, res);
        if (p) res.json({ success: true, passenger: profileOf(p) });
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Server error.');
    }
});

// ---------- DRIVER & INCIDENT APIS ----------
// Updated to include 'Drowsiness' as a valid incident type
const INCIDENT_TYPES = new Set(['Breakdown', 'Accident', 'Delay', 'Emergency', 'Drowsiness']);

function mapIncident(r) {
    let details = r.Description || '';
    let plate = r.Plate_No;
    let route = r.Route_Number;
    const m = /^\[Bus (.+?) - Route (.+?)\]\s*([\s\S]*)$/.exec(details);
    if (m) { plate = plate || m[1]; route = route || m[2]; details = m[3]; }
    return {
        id: r.Report_ID, type: r.Report_Type, details,
        plateNumber: plate || null, routeNumber: route || null,
        status: r.Status, timestamp: toIso(r.Timestamp)
    };
}

app.post('/api/incidents', requireRole('driver'), async (req, res) => {
    try {
        const type = clean(req.body.type, 20);
        const details = clean(req.body.details, 500);
        const routeNumber = clean(req.body.routeNumber, 20);

        if (!INCIDENT_TYPES.has(type)) return fail(res, 400, 'Invalid incident type.');
        if (!details) return fail(res, 400, 'Incident details are required.');

        const result = await run(
            `INSERT INTO INCIDENT_REPORT (Description, Report_Type, Status, Timestamp, Plate_No, Route_Number, Driver_ID)
             VALUES (?, ?, 'Open', ?, ?, ?, ?)`,
            [details, type, new Date().toISOString(), req.user.plateNumber || null, routeNumber || null, req.user.id]
        );

        const row = await get('SELECT * FROM INCIDENT_REPORT WHERE Report_ID = ?', [result.lastID]);
        io.to('authority').emit('newIncidentReported', mapIncident(row));
        res.json({ success: true, reportId: result.lastID });
    } catch (err) {
        console.error('Incident error:', err);
        fail(res, 500, 'Database error');
    }
});

app.get('/api/incidents', requireRole('authority'), async (req, res) => {
    try {
        const rows = await all(
            `SELECT * FROM INCIDENT_REPORT WHERE Status NOT IN ('Resolved', 'Closed')
             ORDER BY Timestamp DESC, Report_ID DESC LIMIT 100`
        );
        res.json(rows.map(mapIncident));
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Database error');
    }
});

app.post('/api/incidents/clear', requireRole('authority'), async (req, res) => {
    try {
        const result = await run(`UPDATE INCIDENT_REPORT SET Status = 'Resolved' WHERE Status NOT IN ('Resolved', 'Closed')`);
        res.json({ success: true, resolved: result.changes });
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Database error');
    }
});

app.get('/api/authority/drivers', requireRole('authority'), async (req, res) => {
    try {
        const rows = await all('SELECT Driver_ID, Name, Phone_Number, License_No, Status, Plate_No FROM DRIVER ORDER BY Driver_ID DESC');
        res.json(rows.map((d) => ({
            id: d.Driver_ID, fullName: d.Name, phone: d.Phone_Number, licenseNo: d.License_No,
            plateNumber: d.Plate_No || '', status: d.Status
        })));
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Database error');
    }
});

app.post('/api/authority/drivers/:id/approve', requireRole('authority'), async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return fail(res, 400, 'Invalid driver id.');
    try {
        const result = await run(`UPDATE DRIVER SET Status = 'approved' WHERE Driver_ID = ?`, [id]);
        if (result.changes === 0) return fail(res, 404, 'Driver not found.');
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        fail(res, 500, 'Database error');
    }
});

app.use('/api', (req, res) => fail(res, 404, 'Not found.'));

app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON body.');
    console.error(err);
    fail(res, 500, 'Server error.');
});

const PORT = process.env.PORT || 3000;
db.ready.then(() => {
    server.listen(PORT, () => console.log(`CeyBus server running on http://localhost:${PORT}`));
});