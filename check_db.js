const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('bus_tracker.db');

db.all("SELECT Passenger_ID, Name, E_mail, substr(Password,1,7) AS pw FROM PASSENGER", (e, rows) => {
    console.log('PASSENGERS'); console.table(rows || e);
});
db.all("SELECT Driver_ID, Name, Phone_Number, Status, Plate_No, substr(Password,1,7) AS pw FROM DRIVER", (e, rows) => {
    console.log('DRIVERS'); console.table(rows || e);
});