const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

// MySQL Connection
const database = mysql.createConnection({
    host: "localhost",
    user: "root",
    port: 3306,
    password: "",
    database: "shri_selvi_fabric"
});

database.connect(error => {
    if (error) {
        console.error("Error connecting to database:", error);
    } else {
        console.log("Database is connected");
    }
});

// app.use(express.static(path.join(__dirname, 'frontend/shri_selvi_fabric/build')));

// app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, 'frontend/shri_selvi_fabric/build', 'index.html'));
//   });

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
app.post('/login', (req, res) => {
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
    const file = req.files ? req.files.file : null;

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
    const file = req.files ? req.files.file : null;

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

// POST design
app.post('/api/designs', (req, res) => {
    const { loomId, designName, designBy } = req.body;
    const planSheet = req.files ? req.files.planSheet : null;
    const design = req.files ? req.files.design : null;

    if (!planSheet || !design) {
        return res.status(400).json({ error: "Both plan sheet and design files must be uploaded" });
    }

    const uploadFolder = getUploadFolder('designs');
    const planSheetUploadPath = path.join(uploadFolder, planSheet.name);
    const designUploadPath = path.join(uploadFolder, design.name);

    planSheet.mv(planSheetUploadPath, error => {
        if (error) {
            console.error("Error uploading plan sheet:", error);
            return res.status(500).json({ error: "Error uploading plan sheet" });
        }

        design.mv(designUploadPath, error => {
            if (error) {
                console.error("Error uploading design:", error);
                return res.status(500).json({ error: "Error uploading design" });
            }

            console.log("Files uploaded successfully");
            const sql = 'INSERT INTO designs (loomId, planSheet, designName, designBy, design) VALUES (?, ?, ?, ?, ?)';
            const values = [loomId, planSheet.name, designName, designBy, design.name];

            database.query(sql, values, (error, result) => {
                if (error) {
                    console.error("Error adding design:", error);
                    return res.status(500).json({ error: "Internal server error" });
                }

                res.status(201).json({ message: "Design added successfully" });
            });
        });
    });
});

// PUT design
app.put('/api/designs/:id', (req, res) => {
    const { id } = req.params;
    const { loomId, designName, designBy } = req.body;
    const planSheet = req.files ? req.files.planSheet : null;
    const design = req.files ? req.files.design : null;

    // Fetch original files names
    const getOriginalFilesSQL = 'SELECT planSheet, design FROM designs WHERE id = ?';
    database.query(getOriginalFilesSQL, [id], (error, results) => {
        if (error) {
            console.error("Error fetching original files:", error);
            return res.status(500).json({ error: "Internal server error" });
        }

        const originalPlanSheet = results[0]?.planSheet;
        const originalDesign = results[0]?.design;
        const uploadFolder = getUploadFolder('designs');
        const planSheetUploadPath = planSheet ? path.join(uploadFolder, planSheet.name) : null;
        const designUploadPath = design ? path.join(uploadFolder, design.name) : null;

        const sql = `UPDATE designs SET loomId=?, designName=?, designBy=?, planSheet=?, design=? WHERE id=?`;
        const values = [loomId, designName, designBy, planSheet ? planSheet.name : originalPlanSheet, design ? design.name : originalDesign, id];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error updating design:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            if (planSheet || design) {
                // Delete old files if new ones are uploaded
                if (originalPlanSheet) {
                    fs.unlink(path.join(uploadFolder, originalPlanSheet), error => {
                        if (error) {
                            console.error("Error deleting old plan sheet:", error);
                        }
                    });
                }

                if (originalDesign) {
                    fs.unlink(path.join(uploadFolder, originalDesign), error => {
                        if (error) {
                            console.error("Error deleting old design:", error);
                        }
                    });
                }

                // Move the new files to the upload folder
                if (planSheet) {
                    planSheet.mv(planSheetUploadPath, error => {
                        if (error) {
                            console.error("Error uploading plan sheet:", error);
                            return res.status(500).json({ error: "Error uploading plan sheet" });
                        }
                    });
                }

                if (design) {
                    design.mv(designUploadPath, error => {
                        if (error) {
                            console.error("Error uploading design:", error);
                            return res.status(500).json({ error: "Error uploading design" });
                        }
                    });
                }

                console.log("Files uploaded successfully");
                res.status(200).json({ message: "Design updated successfully", filesUploaded: true });
            } else {
                res.status(200).json({ message: "Design updated successfully", filesUploaded: false });
            }
        });
    });
});

// POST design
app.post('/api/designs', (req, res) => {
    const { weaverId, designName, designBy, planSheet } = req.body;
    const { loomName, loomNumber } = req.body; // New fields for loom name and number
    const image = req.files ? req.files.image : null;

    if (!image) {
        return res.status(400).json({ error: "No image uploaded" });
    }

    // Get loomId based on weaverId
    const getLoomIdSQL = 'SELECT loomId FROM weavers WHERE id = ?';
    database.query(getLoomIdSQL, [weaverId], (error, results) => {
        if (error) {
            console.error("Error fetching loomId:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
        const loomId = results[0]?.loomId;

        // Fetch loom name and number based on loomId
        const getLoomInfoSQL = 'SELECT name AS loomName, loomNumber FROM loom WHERE id = ?';
        database.query(getLoomInfoSQL, [loomId], (error, results) => {
            if (error) {
                console.error("Error fetching loom info:", error);
                return res.status(500).json({ error: "Internal server error" });
            }
            const { loomName, loomNumber } = results[0] || {};

            const uploadFolder = getUploadFolder('designs');
            const fileUploadPath = path.join(uploadFolder, image.name);

            image.mv(fileUploadPath, error => {
                if (error) {
                    console.error("Error uploading image:", error);
                    return res.status(500).json({ error: "Error uploading image" });
                }

                console.log("Image uploaded successfully");
                const sql = 'INSERT INTO design (loomId, loomName, loomNumber, designName, designBy, planSheet, design) VALUES (?, ?, ?, ?, ?, ?, ?)';
                const values = [loomId, loomName, loomNumber, designName, designBy, planSheet, image.name];

                database.query(sql, values, (error, result) => {
                    if (error) {
                        console.error("Error inserting design:", error);
                        return res.status(500).json({ error: "Internal server error" });
                    }

                    res.status(201).json({ message: "Design added successfully" });
                });
            });
        });
    });
});



// GET designs
app.get('/api/designs', (req, res) => {
    database.query('SELECT * FROM designs', (error, results) => {
        if (error) {
            console.error("Error fetching designs:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json(results);
        }
    });
});

// GET loom numbers for a weaver
app.get('/api/loom-numbers/:weaverId', (req, res) => {
    const { weaverId } = req.params;

    const sql = 'SELECT MAX(loomNumber) AS maxLoomNumber FROM weavers WHERE id = ?';
    database.query(sql, [weaverId], (error, results) => {
        if (error) {
            console.error("Error fetching max loom number:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            const maxLoomNumber = results[0].maxLoomNumber;
            const loomNumbers = Array.from({ length: maxLoomNumber }, (_, index) => `Loom ${index + 1}`);
            res.json(loomNumbers);
        }
    });
});

// POST saree designs
app.post('/api/saree-designs', (req, res) => {
    const { weaverId, loomNumber } = req.body;
    const image = req.files ? req.files.image : null;

    if (!image) {
        return res.status(400).json({ error: "No image uploaded" });
    }

    const uploadFolder = getUploadFolder('sareeDesigns');
    const fileUploadPath = path.join(uploadFolder, image.name);

    image.mv(fileUploadPath, error => {
        if (error) {
            console.error("Error uploading image:", error);
            return res.status(500).json({ error: "Error uploading image" });
        }

        console.log("Image uploaded successfully");
        const sql = 'INSERT INTO sareedesign (weaverId, loomNumber, image) VALUES (?, ?, ?)';
        const values = [weaverId, loomNumber, image.name];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error inserting saree design:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            res.status(201).json({ message: "Saree design added successfully" });
        });
    });
});

// GET saree designs
app.get('/api/saree-designs', (req, res) => {
    const sql = 'SELECT sd.id, sd.weaverId, sd.loomNumber, sd.image, sd.created_at, w.weaverName FROM sareedesign sd JOIN weavers w ON sd.weaverId = w.id';
    database.query(sql, (error, result) => {
        if (error) {
            console.error("Error fetching saree designs:", error);
            res.status(500).json({ error: "Internal server error" });
        } else {
            res.json(result);
        }
    });
});

// Start the server
app.listen(3662, () => {
    console.log("Your server is running on port 3662");
});
