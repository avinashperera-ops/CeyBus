// database.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'bus_tracker.db'), (err) => {
    if (err) console.error('Failed to connect to SQLite database:', err.message);
    else console.log('Connected to bus_tracker.db SQLite database.');
});

// Promise helpers (sqlite3 is callback-based)
const run = (sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));

async function addColumnIfMissing(table, column, definition) {
    const cols = await all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

async function init() {
    await run('PRAGMA foreign_keys = ON');

    await run(`CREATE TABLE IF NOT EXISTS PASSENGER (
        Passenger_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT NOT NULL,
        E_mail TEXT UNIQUE NOT NULL,
        Phone_Number TEXT NOT NULL,
        Password TEXT NOT NULL,
        Status TEXT DEFAULT 'active'
    )`);

    await run(`CREATE TABLE IF NOT EXISTS DRIVER (
        Driver_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT NOT NULL,
        Phone_Number TEXT UNIQUE NOT NULL,
        License_No TEXT UNIQUE NOT NULL,
        Password TEXT NOT NULL,
        Status TEXT DEFAULT 'pending'
    )`);

    await run(`CREATE TABLE IF NOT EXISTS ROUTE (
        Route_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Route_Name TEXT NOT NULL,
        Start_Point TEXT NOT NULL,
        End_Point TEXT NOT NULL
    )`);

    // GeoJSON polylines for each bus route number
    await run(`CREATE TABLE IF NOT EXISTS ROUTE_SHAPE (
        Shape_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Route_Number TEXT UNIQUE NOT NULL,
        Origin TEXT,
        Destination TEXT,
        Shape_GeoJSON TEXT NOT NULL
    )`);

    await run(`CREATE TABLE IF NOT EXISTS BUS (
        Bus_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Plate_No TEXT UNIQUE NOT NULL,
        Capacity INTEGER NOT NULL,
        Route_ID INTEGER,
        FOREIGN KEY(Route_ID) REFERENCES ROUTE(Route_ID)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS TRANSPORT_AUTHORITY (
        Authority_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT UNIQUE NOT NULL,
        Role TEXT NOT NULL,
        Password TEXT NOT NULL
    )`);

    await run(`CREATE TABLE IF NOT EXISTS TRIP (
        Trip_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Start_Time TEXT,
        End_Time TEXT,
        Status TEXT DEFAULT 'Active',
        Bus_ID INTEGER,
        Driver_ID INTEGER,
        Route_ID INTEGER,
        FOREIGN KEY(Bus_ID) REFERENCES BUS(Bus_ID),
        FOREIGN KEY(Driver_ID) REFERENCES DRIVER(Driver_ID),
        FOREIGN KEY(Route_ID) REFERENCES ROUTE(Route_ID)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS INCIDENT_REPORT (
        Report_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Description TEXT NOT NULL,
        Status TEXT DEFAULT 'Open',
        Report_Type TEXT DEFAULT 'Accident',
        Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        Passenger_ID INTEGER,
        Trip_ID INTEGER,
        FOREIGN KEY(Passenger_ID) REFERENCES PASSENGER(Passenger_ID),
        FOREIGN KEY(Trip_ID) REFERENCES TRIP(Trip_ID)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS INQUIRY (
        Inquiry_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        User_Type TEXT NOT NULL,
        User_ID INTEGER NOT NULL,
        Subject TEXT NOT NULL,
        Message TEXT NOT NULL,
        Status TEXT DEFAULT 'Pending',
        Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(`CREATE TABLE IF NOT EXISTS REMOVAL_HISTORY (
        Removal_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        User_Type TEXT NOT NULL,
        User_ID INTEGER NOT NULL,
        User_Name TEXT NOT NULL,
        Reason TEXT NOT NULL,
        Removed_By INTEGER,
        Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(Removed_By) REFERENCES TRANSPORT_AUTHORITY(Authority_ID)
    )`);

    // ---- Migrations for databases created before these columns existed ----
    await addColumnIfMissing('DRIVER', 'Plate_No', 'TEXT');                // bus the driver operates
    await addColumnIfMissing('INCIDENT_REPORT', 'Plate_No', 'TEXT');
    await addColumnIfMissing('INCIDENT_REPORT', 'Route_Number', 'TEXT');
    await addColumnIfMissing('INCIDENT_REPORT', 'Driver_ID', 'INTEGER');
    await addColumnIfMissing('TRANSPORT_AUTHORITY', 'Official_ID', 'TEXT'); // login id shown on the NTC form
    await addColumnIfMissing('TRANSPORT_AUTHORITY', 'PIN', 'TEXT');         // hashed 6-digit security PIN
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_authority_official ON TRANSPORT_AUTHORITY(Official_ID)');

    // ---- Default authority account (created only if missing) ----
    const adminPassword = process.env.ADMIN_PASSWORD || 'adminpassword';
    const adminPin = process.env.ADMIN_PIN || '123456';

    const admin = await get('SELECT * FROM TRANSPORT_AUTHORITY WHERE Authority_ID = 1');
    if (!admin) {
        await run(
            `INSERT INTO TRANSPORT_AUTHORITY (Authority_ID, Name, Role, Password, Official_ID, PIN)
             VALUES (1, 'Admin Official', 'Super Admin', ?, 'NTC-ADM-001', ?)`,
            [await bcrypt.hash(adminPassword, 10), await bcrypt.hash(adminPin, 10)]
        );
    } else {
        if (!admin.Official_ID) {
            await run(`UPDATE TRANSPORT_AUTHORITY SET Official_ID = 'NTC-ADM-001' WHERE Authority_ID = 1`);
        }
        if (!admin.PIN) {
            await run(`UPDATE TRANSPORT_AUTHORITY SET PIN = ? WHERE Authority_ID = 1`, [await bcrypt.hash(adminPin, 10)]);
        }
    }
    if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_PIN) {
        console.warn('WARNING: default authority credentials may be in use. Set ADMIN_PASSWORD / ADMIN_PIN before first run and change them before deployment.');
    }

    await run(`INSERT OR IGNORE INTO ROUTE (Route_ID, Route_Name, Start_Point, End_Point) VALUES
        (1, '138 Colombo - Maharagama', 'Pettah', 'Maharagama'),
        (2, '100 Colombo - Panadura', 'Pettah', 'Panadura'),
        (3, '177 Kaduwela - Kollupitiya', 'Kaduwela', 'Kollupitiya')`);
}

// Await db.ready before relying on tables (server start and the seed script both do).
db.q = { run, get, all };
db.ready = init();
db.ready.catch((err) => {
    console.error('Database initialisation failed:', err);
    process.exit(1);
});

module.exports = db;
