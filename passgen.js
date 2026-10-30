const bcrypt = require('bcrypt');
bcrypt.hash('Nimalavinash@123', 10, (err, hash) => {
    console.log(hash);
});