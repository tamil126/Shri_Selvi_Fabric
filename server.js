const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(express.json());
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

// MySQL Connection
const dbConfig = {
    host: "localhost",
    user: "root",
    password: "",
    database: "shri_selvi_fabric"
};

let database;

function handleDisconnect() {
    database = mysql.createConnection(dbConfig);

    database.connect(error => {
        if (error) {
            console.error("Error connecting to database:", error);
            setTimeout(handleDisconnect, 2000); // Attempt to reconnect after 2 seconds
        } else {
            console.log("Database is connected");
        }
    });

    database.on("error", error => {
        console.error("Database error:", error);
        if (error.code === "PROTOCOL_CONNECTION_LOST" || error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
            handleDisconnect();
        } else {
            throw error;
        }
    });
}

handleDisconnect();

const uploadFolders = {
    transactions: 'public/transactions_files',
    weavers: 'public/weavers_files',
    sareeDesigns: 'public/saree_design_files'
};

Object.values(uploadFolders).forEach(folder => {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
});

function getUploadFolder(endpoint) {
    return uploadFolders[endpoint] || 'public/uploads';
}

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ?';
    database.query(sql, [username], (error, result) => {
        if (error) {
            console.error("Database query error:", error);
            res.send({ status: "error" });
        } else if (result.length > 0) {
            const { username: dbUsername, password: dbPassword, id } = result[0];
            if (dbUsername === username && dbPassword === password) {
                res.send({ status: "success", id });
            } else {
                res.send({ status: "invalid_user" });
            }
        } else {
            res.send({ status: "empty_set" });
        }
    });
});

// POST transaction
app.post('/api/transactions', (req, res) => {
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files[0] : null;

    if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const uploadFolder = getUploadFolder('transactions');
    const fileUploadPath = path.join(uploadFolder, file.name);

    file.mv(fileUploadPath, error => {
        if (error) {
            console.error("Error uploading file:", error);
            return res.status(500).json({ error: "Error uploading file" });
        }

        console.log("File uploaded successfully");
        const sql = `INSERT INTO transactions (date, type, amount, category, subCategory, description, file) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const values = [date, type, amount, category, subCategory, description, file.name];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error inserting transaction:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            res.status(200).json({ message: "Transaction added successfully", fileUploaded: true });
        });
    });
});

// PUT transaction
app.put('/api/transactions/:id', (req, res) => {
    const { id } = req.params;
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files[0] : null;

    // Fetch original file name
    const getOriginalFileSQL = 'SELECT file FROM transactions WHERE id = ?';
    database.query(getOriginalFileSQL, [id], (error, results) => {
        if (error) {
            console.error("Error fetching original file:", error);
            return res.status(500).json({ error: "Internal server error" });
        }

        const originalFile = results[0]?.file;
        const uploadFolder = getUploadFolder('transactions');
        const fileUploadPath = file ? path.join(uploadFolder, file.name) : null;

        const sql = `UPDATE transactions SET date=?, type=?, amount=?, category=?, subCategory=?, description=?, file=? WHERE id=?`;
        const values = [date, type, amount, category, subCategory, description, file ? file.name : originalFile, id];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error updating transaction:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            if (file) {
                // Delete old file if a new one is uploaded
                if (originalFile) {
                    fs.unlink(path.join(uploadFolder, originalFile), error => {
                        if (error) {
                            console.error("Error deleting old file:", error);
                        }
                    });
                }

                // Move the new file to the upload folder
                file.mv(fileUploadPath, error => {
                    if (error) {
                        console.error("Error uploading file:", error);
                        return res.status(500).json({ error: "Error uploading file" });
                    }

                    console.log("File uploaded successfully");
                    res.status(200).json({ message: "Transaction updated successfully", fileUploaded: true });
                });
            } else {
                res.status(200).json({ message: "Transaction updated successfully", fileUploaded: false });
            }
        });
    });
});

// GET recent transactions
app.get('/api/transactions', (req, res) => {
    database.query('SELECT * FROM transactions', (error, results) => {
        if (error) {
            console.error("Error fetching recent transactions:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json(results);
        }
    });
});

// Get distinct categories and subcategories
app.get('/api/categories', (req, res) => {
    const categoriesQuery = 'SELECT DISTINCT category FROM transactions';
    const subCategoriesQuery = 'SELECT DISTINCT subCategory FROM transactions';

    database.query(categoriesQuery, (categoryError, categoryResults) => {
        if (categoryError) {
            console.error("Error fetching categories:", categoryError);
            return res.status(500).json({ error: "Internal server error" });
        }

        database.query(subCategoriesQuery, (subCategoryError, subCategoryResults) => {
            if (subCategoryError) {
                console.error("Error fetching subcategories:", subCategoryError);
                return res.status(500).json({ error: "Internal server error" });
            }

            const categories = categoryResults.map(result => result.category);
            const subCategories = subCategoryResults.map(result => result.subCategory);

            res.json({ categories, subCategories });
        });
    });
});

// POST weavers
app.post('/api/weavers', (req, res) => {
    const { date, weaverName, loomName, loomNumber, address, mobileNumber1, mobileNumber2, reference } = req.body;
    const document = req.files ? req.files.document : null;

    if (!document) {
        return res.status(400).json({ error: "No document uploaded" });
    }

    const uploadFolder = getUploadFolder('weavers');
    const fileUploadPath = path.join(uploadFolder, document.name);

    document.mv(fileUploadPath, error => {
        if (error) {
            console.error("Error uploading document:", error);
            return res.status(500).json({ error: "Error uploading document" });
        }

        console.log("Document uploaded successfully");
        const sql = 'INSERT INTO weavers (date, weaverName, loomName, loomNumber, address, mobileNumber1, mobileNumber2, reference, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const values = [date, weaverName, loomName, loomNumber, address, mobileNumber1, mobileNumber2, reference, document.name];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error adding weaver:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            res.status(201).json({ message: "Weaver added successfully" });
        });
    });
});

// PUT weaver
app.put('/api/weavers/:id', (req, res) => {
    const { id } = req.params;
    const { date, weaverName, loomName, loomNumber, address, mobileNumber1, mobileNumber2, reference } = req.body;
    const document = req.files ? req.files.document : null;

    // Fetch original document name
    const getOriginalFileSQL = 'SELECT document FROM weavers WHERE id = ?';
    database.query(getOriginalFileSQL, [id], (error, results) => {
        if (error) {
            console.error("Error fetching original document:", error);
            return res.status(500).json({ error: "Internal server error" });
        }

        const originalDocument = results[0]?.document;
        const uploadFolder = getUploadFolder('weavers');
        const fileUploadPath = document ? path.join(uploadFolder, document.name) : null;

        const sql = `UPDATE weavers SET date=?, weaverName=?, loomName=?, loomNumber=?, address=?, mobileNumber1=?, mobileNumber2=?, reference=?, document=? WHERE id=?`;
        const values = [date, weaverName, loomName, loomNumber, address, mobileNumber1, mobileNumber2, reference, document ? document.name : originalDocument, id];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error updating weaver:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            if (document) {
                // Delete old document if a new one is uploaded
                if (originalDocument) {
                    fs.unlink(path.join(uploadFolder, originalDocument), error => {
                        if (error) {
                            console.error("Error deleting old document:", error);
                        }
                    });
                }

                // Move the new document to the upload folder
                document.mv(fileUploadPath, error => {
                    if (error) {
                        console.error("Error uploading document:", error);
                        return res.status(500).json({ error: "Error uploading document" });
                    }

                    console.log("Document uploaded successfully");
                    res.status(200).json({ message: "Weaver updated successfully", fileUploaded: true });
                });
            } else {
                res.status(200).json({ message: "Weaver updated successfully", fileUploaded: false });
            }
        });
    });
});

// GET weavers
app.get('/api/weavers', (req, res) => {
    database.query('SELECT * FROM weavers', (error, results) => {
        if (error) {
            console.error("Error fetching weavers:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json(results);
        }
    });
});

// GET weaver by ID
app.get('/api/weavers/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'SELECT * FROM weavers WHERE id = ?';
    database.query(sql, [id], (error, results) => {
        if (error) {
            console.error("Error fetching weaver:", error);
            res.status(500).json({ error: "Internal server error" });
        } else if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.status(404).json({ error: "Weaver not found" });
        }
    });
});

// DELETE weaver by ID
app.delete('/api/weavers/:id', (req, res) => {
    const { id } = req.params;

    // Fetch document name before deleting
    const getDocumentSQL = 'SELECT document FROM weavers WHERE id = ?';
    database.query(getDocumentSQL, [id], (error, results) => {
        if (error) {
            console.error("Error fetching document:", error);
            return res.status(500).json({ error: "Internal server error" });
        }

        const document = results[0]?.document;
        const sql = 'DELETE FROM weavers WHERE id = ?';

        database.query(sql, [id], (error, result) => {
            if (error) {
                console.error("Error deleting weaver:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            if (document) {
                const uploadFolder = getUploadFolder('weavers');
                fs.unlink(path.join(uploadFolder, document), error => {
                    if (error) {
                        console.error("Error deleting document:", error);
                    }
                });
            }

            res.status(200).json({ message: "Weaver deleted successfully" });
        });
    });
});

const port = 3662;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
