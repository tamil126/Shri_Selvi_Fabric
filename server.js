const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql");
const fileUpload = require("express-fileupload");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
require('dotenv').config();

const app = express();
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

// Configure AWS SDK v3
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

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
            setTimeout(handleDisconnect, 2000); 
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

// Function to upload file to S3
const uploadToS3 = async (file, folder = 'transactions') => {
    const uniqueFileName = `${folder}/${Date.now()}_${uuidv4()}_${file.name}`;
    const params = {
        Bucket: 'newrainsarees',
        Key: uniqueFileName,
        Body: file.data
    };
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    return {
        Location: `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`,
        uniqueFileName
    };
};

// Utility function to format date to YYYY-MM-DD
const formatDate = (date) => {
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) 
        month = '0' + month;
    if (day.length < 2) 
        day = '0' + day;

    return [year, month, day].join('-');
};

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
app.post('/api/transactions', async (req, res) => {
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files : null;

    if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    try {
        const { Location, uniqueFileName } = await uploadToS3(file, 'transactions');
        const formattedDate = formatDate(date);
        const sql = `INSERT INTO transactions (date, type, amount, category, subCategory, description, file) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const values = [formattedDate, type, amount, category, subCategory, description, uniqueFileName];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error inserting transaction:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            res.status(200).json({ message: "Transaction added successfully", fileUploaded: true, fileUrl: Location });
        });
    } catch (error) {
        console.error("Error uploading to S3:", error);
        res.status(500).json({ error: "Error uploading file" });
    }
});

// PUT transaction
app.put('/api/transactions/:id', async (req, res) => {
    const { id } = req.params;
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files : null;

    // Fetch original file name
    const getOriginalFileSQL = 'SELECT file FROM transactions WHERE id = ?';
    database.query(getOriginalFileSQL, [id], async (error, results) => {
        if (error) {
            console.error("Error fetching original file:", error);
            return res.status(500).json({ error: "Internal server error" });
        }

        const originalFile = results[0]?.file;
        let fileUrl = originalFile;
        let uniqueFileName = originalFile;

        if (file) {
            try {
                const uploadResult = await uploadToS3(file, 'transactions');
                fileUrl = uploadResult.Location;
                uniqueFileName = uploadResult.uniqueFileName;
            } catch (error) {
                console.error("Error uploading to S3:", error);
                return res.status(500).json({ error: "Error uploading file" });
            }
        }

        const formattedDate = formatDate(date);
        const sql = `UPDATE transactions SET date=?, type=?, amount=?, category=?, subCategory=?, description=?, file=? WHERE id=?`;
        const values = [formattedDate, type, amount, category, subCategory, description, uniqueFileName, id];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error updating transaction:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            res.status(200).json({ message: "Transaction updated successfully", fileUploaded: !!file, fileUrl });
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
            // Ensure dates are formatted correctly before sending them to the frontend
            const formattedResults = results.map(transaction => ({
                ...transaction,
                date: formatDate(transaction.date)
            }));
            res.json(formattedResults);
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
app.post('/api/weavers', async (req, res) => {
    const { date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description } = req.body;
    const file = req.files ? req.files.idProof : null;

    try {
        let fileUrl = '';
        if (file) {
            const uniqueFileName = `${Date.now()}_${uuidv4()}_${file.name}`;
            const uploadResult = await uploadToS3(file, uniqueFileName);
            fileUrl = uploadResult.Location;
        }

        const sql = `INSERT INTO weavers (date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, fileUrl];

        database.query(sql, values, (error, result) => {
            if (error) {
                console.error("Error inserting weaver:", error);
                return res.status(500).json({ error: "Internal server error" });
            }

            res.status(200).json({ message: "Weaver added successfully", fileUploaded: !!file });
        });
    } catch (error) {
        console.error("Error uploading to S3:", error);
        res.status(500).json({ error: "Error uploading file" });
    }
});
// Endpoint to update a weaver
app.put('/api/weavers/:id', async (req, res) => {
    const { id } = req.params;
    const { date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description } = req.body;
    const idProof = req.files ? req.files.idProof : null;

    let idProofUrl = null;
    if (idProof) {
        try {
            const uploadResult = await uploadToS3(idProof, 'weavers');
            idProofUrl = uploadResult.Location;
        } catch (error) {
            console.error('Error uploading ID proof to S3:', error);
            return res.status(500).json({ error: 'Error uploading ID proof' });
        }
    }

    const sql = 'UPDATE weavers SET date=?, weaverName=?, loomName=?, address=?, area=?, mobileNumber1=?, mobileNumber2=?, reference=?, description=?, idProof=? WHERE id=?';
    const values = [date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, idProofUrl, id];

    database.query(sql, values, (error, result) => {
        if (error) {
            console.error('Error updating weaver:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }

        res.status(200).json({ message: 'Weaver updated successfully' });
    });
});

// Endpoint to get all weavers
app.get('/api/weavers', (req, res) => {
    database.query('SELECT * FROM weavers', (error, results) => {
        if (error) {
            console.error('Error fetching weavers:', error);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.json(results);
        }
    });
});

// Endpoint to add a loom
app.post('/api/looms', (req, res) => {
    const { loomName, loomNumber, loomType, jacquardType, hooks, description } = req.body;

    const sql = 'INSERT INTO looms (loomName, loomNumber, loomType, jacquardType, hooks, description) VALUES (?, ?, ?, ?, ?, ?)';
    const values = [loomName, loomNumber, loomType, jacquardType, hooks, description];

    database.query(sql, values, (error, result) => {
        if (error) {
            console.error('Error inserting loom:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }

        res.status(200).json({ message: 'Loom added successfully', id: result.insertId });
    });
});

// PUT loom
app.put('/api/looms/:id', async (req, res) => {
    const { id } = req.params;
    const { loomName, loomNumber, loomType, loomTypeOther, jacquardType, jacquardTypeOther, hooks, description } = req.body;

    const finalLoomType = loomType === 'other' ? loomTypeOther : loomType;
    const finalJacquardType = jacquardType === 'other' ? jacquardTypeOther : jacquardType;

    const sql = `UPDATE looms SET loomName=?, loomNumber=?, loomType=?, jacquardType=?, hooks=?, description=? WHERE id=?`;
    const values = [loomName, loomNumber, finalLoomType, finalJacquardType, hooks, description, id];

    database.query(sql, values, (error, result) => {
        if (error) {
            console.error("Error updating loom:", error);
            return res.status(500).json({ error: "Internal server error" });
        }

        res.status(200).json({ message: "Loom updated successfully" });
    });
});

// Endpoint to get all looms
app.get('/api/looms', (req, res) => {
    database.query('SELECT * FROM looms', (error, results) => {
        if (error) {
            console.error('Error fetching looms:', error);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.json(results);
        }
    });
});

// Endpoint to add a design
app.post('/api/designs', async (req, res) => {
    const { loomName, loomNumber, designName, designBy } = req.body;
    const planSheet = req.files ? req.files.planSheet : null;
    const designUpload = req.files ? req.files.designUpload : null;

    let planSheetUrl = null;
    if (planSheet) {
        try {
            const uploadResult = await uploadToS3(planSheet, 'designs');
            planSheetUrl = uploadResult.Location;
        } catch (error) {
            console.error('Error uploading plan sheet to S3:', error);
            return res.status(500).json({ error: 'Error uploading plan sheet' });
        }
    }

    let designUploadUrl = null;
    if (designUpload) {
        try {
            const uploadResult = await uploadToS3(designUpload, 'designs');
            designUploadUrl = uploadResult.Location;
        } catch (error) {
            console.error('Error uploading design to S3:', error);
            return res.status(500).json({ error: 'Error uploading design' });
        }
    }

    const sql = 'INSERT INTO designs (loomName, loomNumber, planSheet, designName, designBy, designUpload) VALUES (?, ?, ?, ?, ?, ?)';
    const values = [loomName, loomNumber, planSheetUrl, designName, designBy, designUploadUrl];

    database.query(sql, values, (error, result) => {
        if (error) {
            console.error('Error inserting design:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }

        res.status(200).json({ message: 'Design added successfully', id: result.insertId });
    });
});

// Endpoint to update a design
app.put('/api/designs/:id', async (req, res) => {
    const { id } = req.params;
    const { loomName, loomNumber, designName, designBy } = req.body;
    const planSheet = req.files ? req.files.planSheet : null;
    const designUpload = req.files ? req.files.designUpload : null;

    let planSheetUrl = null;
    if (planSheet) {
        try {
            const uploadResult = await uploadToS3(planSheet, 'designs');
            planSheetUrl = uploadResult.Location;
        } catch (error) {
            console.error('Error uploading plan sheet to S3:', error);
            return res.status(500).json({ error: 'Error uploading plan sheet' });
        }
    }

    let designUploadUrl = null;
    if (designUpload) {
        try {
            const uploadResult = await uploadToS3(designUpload, 'designs');
            designUploadUrl = uploadResult.Location;
        } catch (error) {
            console.error('Error uploading design to S3:', error);
            return res.status(500).json({ error: 'Error uploading design' });
        }
    }

    const sql = 'UPDATE designs SET loomName=?, loomNumber=?, planSheet=?, designName=?, designBy=?, designUpload=? WHERE id=?';
    const values = [loomName, loomNumber, planSheetUrl, designName, designBy, designUploadUrl, id];

    database.query(sql, values, (error, result) => {
        if (error) {
            console.error('Error updating design:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }

        res.status(200).json({ message: 'Design updated successfully' });
    });
});

// Endpoint to get all designs
app.get('/api/designs', (req, res) => {
    database.query('SELECT * FROM designs', (error, results) => {
        if (error) {
            console.error('Error fetching designs:', error);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.json(results);
        }
    });
});

const port = 3662;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
