// database.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'bus_tracker.db'), (err) => {
    if (err) {
        console.error('Failed to connect to SQLite database:', err.message);
    } else {
        console.log('Connected to bus_tracker.db SQLite database.');
    }
});

db.serialize(async () => {
  // PASSENGER
  db.run(`CREATE TABLE IF NOT EXISTS PASSENGER (
    Passenger_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL,
    E_mail TEXT UNIQUE NOT NULL,
    Phone_Number TEXT NOT NULL,
    Password TEXT NOT NULL,
    Status TEXT DEFAULT 'active'
  )`);

  // DRIVER
  db.run(`CREATE TABLE IF NOT EXISTS DRIVER (
    Driver_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL,
    Phone_Number TEXT UNIQUE NOT NULL,
    License_No TEXT UNIQUE NOT NULL,
    Password TEXT NOT NULL,
    Status TEXT DEFAULT 'pending'
  )`);

  // ROUTE
  db.run(`CREATE TABLE IF NOT EXISTS ROUTE (
    Route_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Route_Name TEXT NOT NULL,
    Start_Point TEXT NOT NULL,
    End_Point TEXT NOT NULL
  )`);

  // NEW: ROUTE SHAPES (Stores GeoJSON Polylines)
  db.run(`CREATE TABLE IF NOT EXISTS ROUTE_SHAPE (
    Shape_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Route_Number TEXT UNIQUE NOT NULL,
    Origin TEXT,
    Destination TEXT,
    Shape_GeoJSON TEXT NOT NULL
  )`);

  // BUS
  db.run(`CREATE TABLE IF NOT EXISTS BUS (
    Bus_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Plate_No TEXT UNIQUE NOT NULL,
    Capacity INTEGER NOT NULL,
    Route_ID INTEGER,
    FOREIGN KEY(Route_ID) REFERENCES ROUTE(Route_ID)
  )`);

  // TRANSPORT AUTHORITY
  db.run(`CREATE TABLE IF NOT EXISTS TRANSPORT_AUTHORITY (
    Authority_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL,
    Role TEXT NOT NULL,
    Password TEXT NOT NULL
  )`);

  // TRIP
  db.run(`CREATE TABLE IF NOT EXISTS TRIP (
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

  // INCIDENT REPORT
  db.run(`CREATE TABLE IF NOT EXISTS INCIDENT_REPORT (
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

  // INQUIRIES
  db.run(`CREATE TABLE IF NOT EXISTS INQUIRY (
    Inquiry_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    User_Type TEXT NOT NULL,
    User_ID INTEGER NOT NULL,
    Subject TEXT NOT NULL,
    Message TEXT NOT NULL,
    Status TEXT DEFAULT 'Pending',
    Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // REMOVAL HISTORY
  db.run(`CREATE TABLE IF NOT EXISTS REMOVAL_HISTORY (
    Removal_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    User_Type TEXT NOT NULL,
    User_ID INTEGER NOT NULL,
    User_Name TEXT NOT NULL,
    Reason TEXT NOT NULL,
    Removed_By INTEGER,
    Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(Removed_By) REFERENCES TRANSPORT_AUTHORITY(Authority_ID)
  )`);

  // Default Authority Account
  const defaultHash = await bcrypt.hash('adminpassword', 10);
  db.run(`INSERT OR IGNORE INTO TRANSPORT_AUTHORITY (Authority_ID, Name, Role, Password) 
          VALUES (1, 'Admin Official', 'Super Admin', ?)`, [defaultHash]);

  // Seed Routes
  db.run(`INSERT OR IGNORE INTO ROUTE (Route_ID, Route_Name, Start_Point, End_Point) VALUES 
    (1, '138 Colombo - Maharagama', 'Pettah', 'Maharagama'),
    (2, '100 Colombo - Panadura', 'Pettah', 'Panadura'),
    (3, '177 Kaduwela - Kollupitiya', 'Kaduwela', 'Kollupitiya')`);
});

module.exports = db;