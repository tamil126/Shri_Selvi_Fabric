const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("mysql");
const fileUpload = require("express-fileupload");

const connect = express();
connect.use(cors());
connect.use(bodyParser.json());
connect.use(express.json());
connect.use(express.static('public'));
connect.use(bodyParser.urlencoded({ extended: true }));
connect.use(fileUpload());

// MySQL Connection
let database = db.createConnection({
    host: "localhost",
    user: "root",
    port: 3306,
    password: "", // Enter your MySQL password here
    database: "shri_selvi_fabric"
});

database.connect(function (error) {
    if (error) {
        console.error("Error connecting to database:", error);
    } else {
        console.log("Database is connected")
    }
});

// Login endpoint
connect.post('/login', (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ?';
    database.query(sql, [username], (error, result) => {
        if (error) {
            console.error("Database query error:", error);
            res.send({ status: "error" });
        } else if (result.length > 0) {
            const { username: username1, password: password1, id } = result[0];
            if (username1 === username && password1 === password) {
                res.send({ status: "success", id });
            } else {
                res.send({ status: "invalid_user" });
            }
        } else {
            res.send({ status: "empty_set" });
        }
    });
});

// POST endpoint for submitting transactions
connect.post('/api/transactions', (req, res) => {
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.file : null; // Get uploaded file if exists

    // Prepare SQL query
    const sql = `INSERT INTO transactions (date, type, amount, category, subCategory, description, file) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const values = [date, type, amount, category, subCategory, description, file ? file.name : null]; // Save the file name instead of file data

    // Execute the query
    database.query(sql, values, (error, result) => {
        if (error) {
            console.error("Error inserting transaction:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            // Upload file if exists
            if (file) {
                file.mv(`public/${file.name}`, (error) => {
                    if (error) {
                        console.error("Error uploading file:", error);
                        res.status(500).json({ error: "Error uploading file" });
                    } else {
                        console.log("File uploaded successfully");
                        res.status(200).json({ message: "Transaction added successfully", fileUploaded: true });
                    }
                });
            } else {
                res.status(200).json({ message: "Transaction added successfully", fileUploaded: false });
            }
        }
    });
});


// GET endpoint for fetching recent transactions
connect.get('/api/transactions', (req, res) => {
    database.query('SELECT * FROM transactions', (error, results) => {
        if (error) {
            console.error("Error fetching recent transactions:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json(results);
        }
    });
});

// Endpoint for adding a weaver
connect.post('/api/weavers', (req, res) => {
    const {
        date,
        weaverName,
        loomName,
        loomNumber,
        address,
        mobileNumber1,
        mobileNumber2,
        reference
    } = req.body;

    // Extract document from request
    const document = req.files ? req.files.document : null;

    // Get the original file name
    const originalFileName = document ? document.name : null;

    const sql = 'INSERT INTO weavers (date, weaverName, loomName, loomNumber, address, mobileNumber1, mobileNumber2, reference, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const values = [date, weaverName, loomName, loomNumber, address, mobileNumber1, mobileNumber2, reference, originalFileName];

    database.query(sql, values, (error, result) => {
        if (error) {
            console.error("Error adding weaver:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            // Upload document if exists
            if (document) {
                document.mv(`public/${document.name}`, (error) => {
                    if (error) {
                        console.error("Error uploading document:", error);
                        res.status(500).json({ error: "Error uploading document" });
                    } else {
                        console.log("Document uploaded successfully");
                        res.status(201).json({ message: "Weaver added successfully" });
                    }
                });
            } else {
                res.status(201).json({ message: "Weaver added successfully" });
            }
        }
    });
});




// Get all weavers
connect.get('/api/weavers', (req, res) => {
    database.query('SELECT * FROM weavers', (error, results) => {
        if (error) {
            console.error("Error fetching weavers:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json(results);
        }
    });
});

connect.get('/api/weavers/:id', (req, res) => {
    database.query('SELECT * FROM weavers', (error, results) => {
        if (error) {
            console.error("Error fetching weavers:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json(results);
        }
    });
});

// Endpoint for adding a saree design
connect.post('/api/saree-design', (req, res) => {
    const { weaverId, loomNumber } = req.body;
    const image = req.files ? req.files.image : null;

    // Insert the data into the saree_design table
    const sql = 'INSERT INTO saree_design (weaver_id, loom_number, image) VALUES (?, ?, ?)';
    const values = [weaverId, loomNumber, image ? image.name : null];

    database.query(sql, values, (error, result) => {
        if (error) {
            console.error("Error inserting saree design:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            // Upload image if exists
            if (image) {
                image.mv(`public/${image.name}`, (error) => {
                    if (error) {
                        console.error("Error uploading image:", error);
                        res.status(500).json({ error: "Error uploading image" });
                    } else {
                        console.log("Image uploaded successfully");
                        res.status(201).json({ message: "Saree design added successfully" });
                    }
                });
            } else {
                res.status(201).json({ message: "Saree design added successfully" });
            }
        }
    });
});

connect.listen(3662, () => {
    console.log("Your server is running")
});
