const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const fileUpload = require("express-fileupload");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const jwt = require('jsonwebtoken');
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

async function handleDisconnect() {
    try {
        database = await mysql.createConnection(dbConfig);
        console.log("Database is connected");
        database.on("error", async (error) => {
            console.error("Database error:", error);
            if (error.code === "PROTOCOL_CONNECTION_LOST" || error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
                await handleDisconnect();
            } else {
                throw error;
            }
        });
    } catch (error) {
        console.error("Error connecting to database:", error);
        setTimeout(handleDisconnect, 1000);
    }
}

handleDisconnect();

const generateUniqueName = (length = 15) => {
    return uuidv4().replace(/-/g, '').substring(0, length);
};

const uploadToS3 = async (file, folder = 'transactions') => {
    const uniqueFileName = `${generateUniqueName()}_${file.name}`;
    const params = {
        Bucket: 'newrainsarees',
        Key: `${folder}/${uniqueFileName}`,
        Body: file.data
    };
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    return {
        Location: `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`,
        uniqueFileName
    };
};

const deleteFromS3 = async (fileUrl) => {
    const fileName = fileUrl.split('/').slice(-2).join('/');
    const params = {
        Bucket: 'newrainsarees',
        Key: fileName
    };
    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
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
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username =?';
    try {
        const [result] = await database.query(sql, [username]);
        if (result.length > 0) {
            const { username: dbUsername, password: dbPassword, id } = result[0];
            if (dbUsername === username && dbPassword === password) {
                const token = generateToken(id); // Generate a token for the user
                res.send({ status: "success", token }); 
            } else {
                res.send({ status: "invalid_user" });
            }
        } else {
            res.send({ status: "empty_set" });
        }
    } catch (error) {
        console.error("Database query error:", error);
        res.send({ status: "error" });
    }
});

// Generate a token
function generateToken(id) {
    const secretKey = '4S$eJ#8dLpR5tY3uI2oP1nGfE6cD5bA';
    const token = jwt.sign({ id }, secretKey, { expiresIn: '1y' });
    return token;
}

// POST transaction
app.post('/api/transactions', async (req, res) => {
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files : null;

    try {
        const formattedDate = formatDate(date);
        const sql = `INSERT INTO transactions (date, type, amount, category, subCategory, description, file) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const values = [formattedDate, type, amount, category, subCategory, description, file ? (await uploadToS3(file, 'transactions')).uniqueFileName : null];

        await database.query(sql, values);
        res.status(200).json({ message: "Transaction added successfully", fileUploaded: !!file });
    } catch (error) {
        console.error("Error inserting transaction:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// PUT transaction
app.put('/api/transactions/:id', async (req, res) => {
    const { id } = req.params;
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files : null;

    try {
        const [originalFileResult] = await database.query('SELECT file FROM transactions WHERE id = ?', [id]);
        const originalFile = originalFileResult[0]?.file;

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

        await database.query(sql, values);
        res.status(200).json({ message: "Transaction updated successfully", fileUploaded: !!file, fileUrl });
    } catch (error) {
        console.error("Error updating transaction:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET recent transactions
app.get('/api/transactions', async (req, res) => {
    try {
        const [results] = await database.query('SELECT * FROM transactions');
        const formattedResults = results.map(transaction => ({
            ...transaction,
            date: formatDate(transaction.date)
        }));
        res.json(formattedResults);
    } catch (error) {
        console.error("Error fetching recent transactions:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Get distinct categories and subcategories
app.get('/api/categories', async (req, res) => {
    const categoriesQuery = 'SELECT DISTINCT category FROM transactions';
    const subCategoriesQuery = 'SELECT DISTINCT subCategory FROM transactions';

    try {
        const [categoryResults] = await database.query(categoriesQuery);
        const [subCategoryResults] = await database.query(subCategoriesQuery);

        const categories = categoryResults.map(result => result.category);
        const subCategories = subCategoryResults.map(result => result.subCategory);

        res.json({ categories, subCategories });
    } catch (error) {
        console.error("Error fetching categories and subcategories:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/weavers', async (req, res) => {
    try {
        const [results] = await database.query('SELECT * FROM weavers');
        res.json(results);
    } catch (error) {
        console.error("Error fetching weavers:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/looms', async (req, res) => {
    try {
        const [results] = await database.query('SELECT * FROM looms');
        res.json(results);
    } catch (error) {
        console.error("Error fetching looms:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/designs', async (req, res) => {
    try {
        const [results] = await database.query('SELECT * FROM designs');
        res.json(results);
    } catch (error) {
        console.error("Error fetching designs:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/loomTypes', async (req, res) => {
    try {
        const [rows] = await database.query('SELECT DISTINCT loomType FROM looms WHERE loomType IS NOT NULL');
        res.json(rows.map(row => row.loomType));
    } catch (err) {
        console.error('Error fetching loom types:', err);
        res.status(500).json({ message: 'Error fetching loom types' });
    }
});

app.get('/api/jacquardTypes', async (req, res) => {
    try {
        const [rows] = await database.query('SELECT DISTINCT jacquardType FROM looms WHERE jacquardType IS NOT NULL');
        res.json(rows.map(row => row.jacquardType));
    } catch (error) {
        console.error('Error fetching jacquard types:', error);
        res.status(500).json({ message: 'Error fetching jacquard types' });
    }
});

app.get('/api/designNames', async (req, res) => {
    try {
        const [rows] = await database.query('SELECT DISTINCT designName FROM designs WHERE designName IS NOT NULL');
        res.json(rows.map(row => row.designName));
    } catch (error) {
        console.error('Error fetching design names:', error);
        res.status(500).json({ message: 'Error fetching design names' });
    }
});

app.post('/api/weavers', async (req, res) => {
    const { date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description } = req.body;
    const idProof = req.files ? req.files.idProof : null;

    if (!idProof) {
        return res.status(400).json({ error: "No ID Proof uploaded" });
    }

    try {
        const uploadResult = await uploadToS3(idProof, 'weavers');
        const [result] = await database.query('INSERT INTO weavers (date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, idProof) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, uploadResult.Location]);

        res.status(200).json({ message: "Weaver added successfully", fileUploaded: true });
    } catch (error) {
        console.error("Error inserting weaver:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.put('/api/weavers/:id', async (req, res) => {
    const { date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description } = req.body;
    let idProofUrl = null;

    if (req.files && req.files.idProof) {
        try {
            const s3Result = await uploadToS3(req.files.idProof, 'weavers');
            idProofUrl = s3Result.Location;
        } catch (error) {
            return res.status(500).send('Error uploading to S3: ' + error.message);
        }
    }

    const query = "UPDATE weavers SET date = ?, weaverName = ?, loomName = ?, address = ?, area = ?, mobileNumber1 = ?, mobileNumber2 = ?, reference = ?, description = ?, idProof = ? WHERE id = ?";
    try {
        await database.query(query, [date, weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, idProofUrl, req.params.id]);
        res.status(200).json({ message: "Weaver updated successfully" });
    } catch (error) {
        console.error("Error updating weaver:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/api/looms', async (req, res) => {
    const { loomName, loomNumber, loomType, jacquardType, hooks, description } = req.body;

    try {
        const [result] = await database.query('INSERT INTO looms (loomName, loomNumber, loomType, jacquardType, hooks, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())', [loomName, loomNumber, loomType, jacquardType, hooks, description]);

        res.status(200).json({ message: "Loom added successfully" });
    } catch (error) {
        console.error("Error inserting loom:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.put('/api/looms/:id', async (req, res) => {
    const { loomName, loomNumber, loomType, jacquardType, hooks, description } = req.body;
    const query = "UPDATE looms SET loomName = ?, loomNumber = ?, loomType = ?, jacquardType = ?, hooks = ?, description = ?, updatedAt = NOW() WHERE id = ?";
    try {
        await database.query(query, [loomName, loomNumber, loomType, jacquardType, hooks, description, req.params.id]);
        res.status(200).json({ message: "Loom updated successfully" });
    } catch (error) {
        console.error("Error updating loom:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/api/designs', async (req, res) => {
    const { loomName, loomNumber, designName, designBy } = req.body;
    const planSheet = req.files ? req.files.planSheet : null;
    const designUpload = req.files ? req.files.designUpload : null;

    if (!planSheet || !designUpload) {
        return res.status(400).json({ error: "Plan Sheet or Design Upload not provided" });
    }

    try {
        const planSheetUploadResult = await uploadToS3(planSheet, 'designs');
        const designUploadResult = await uploadToS3(designUpload, 'designs');
        const [result] = await database.query('INSERT INTO designs (loomName, loomNumber, planSheet, designName, designBy, designUpload, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())', [loomName, loomNumber, planSheetUploadResult.Location, designName, designBy, designUploadResult.Location]);

        res.status(200).json({ message: "Design added successfully", fileUploaded: true });
    } catch (error) {
        console.error("Error inserting design:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Add new loom type
app.post('/api/loomTypes', async (req, res) => {
    try {
        const { value } = req.body;
        await database.query('INSERT INTO loomTypes (loomType) VALUES (?)', [value]);
        res.json(value);
    } catch (error) {
        console.error('Error adding loom type:', error);
        res.status(500).json({ message: 'Error adding loom type' });
    }
});

// Add new jacquard type
app.post('/api/jacquardTypes', async (req, res) => {
    try {
        const { value } = req.body;
        await database.query('INSERT INTO jacquardTypes (jacquardType) VALUES (?)', [value]);
        res.json(value);
    } catch (error) {
        console.error('Error adding jacquard type:', error);
        res.status(500).json({ message: 'Error adding jacquard type' });
    }
});

// Add new design name
app.post('/api/designNames', async (req, res) => {
    try {
        const { value } = req.body;
        await database.query('INSERT INTO designNames (designName) VALUES (?)', [value]);
        res.json(value);
    } catch (error) {
        console.error('Error adding design name:', error);
        res.status(500).json({ message: 'Error adding design name' });
    }
});

app.post('/api/saree-designs', async (req, res) => {
    const { loomName, loomNumber } = req.body;
    const mainImage = req.files ? req.files.mainImage : null;
    const munthiImage = req.files ? req.files.munthiImage : null;
    const blouseImage = req.files ? req.files.blouseImage : null;
    const openImage = req.files ? req.files.openImage : null;
    const colorSetImage = req.files ? req.files.colorSetImage : null;

    try {
        const mainImageResult = mainImage ? await uploadToS3(mainImage, 'saree-designs') : null;
        const munthiImageResult = munthiImage ? await uploadToS3(munthiImage, 'saree-designs') : null;
        const blouseImageResult = blouseImage ? await uploadToS3(blouseImage, 'saree-designs') : null;
        const openImageResult = openImage ? await uploadToS3(openImage, 'saree-designs') : null;
        const colorSetImageResult = colorSetImage ? await uploadToS3(colorSetImage, 'saree-designs') : null;

        const sql = `INSERT INTO saree_designs (loomName, loomNumber, mainImage, munthiImage, blouseImage, openImage, colorSetImage, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
        const values = [loomName, loomNumber, mainImageResult ? mainImageResult.Location : null, munthiImageResult ? munthiImageResult.Location : null, blouseImageResult ? blouseImageResult.Location : null, openImageResult ? openImageResult.Location : null, colorSetImageResult ? colorSetImageResult.Location : null];

        await database.execute(sql, values);
        res.status(200).json({ message: "Saree design added successfully", fileUploaded: !!mainImageResult || !!munthiImageResult || !!blouseImageResult || !!openImageResult || !!colorSetImageResult });
    } catch (error) {
        console.error("Error uploading to S3:", error);
        res.status(500).json({ error: "Error uploading file" });
    }
});

app.put('/api/saree-designs/:id', async (req, res) => {
    const { id } = req.params;
    const { field } = req.body;
    const file = req.files ? req.files[field] : null;

    if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    try {
        const [oldImages] = await database.execute('SELECT * FROM saree_designs WHERE id = ?', [id]);

        if (!oldImages.length) {
            return res.status(404).json({ error: "Design not found" });
        }

        if (oldImages[0][field]) {
            await deleteFromS3(oldImages[0][field]);
        }

        const newImageResult = await uploadToS3(file, 'saree-designs');

        const sql = `UPDATE saree_designs SET ${field} = ?, updatedAt = NOW() WHERE id = ?`;
        const values = [newImageResult.Location, id];

        await database.execute(sql, values);
        res.status(200).json({ message: "Image replaced successfully" });
    } catch (error) {
        console.error("Error replacing image:", error);
        res.status(500).json({ error: "Error replacing image" });
    }
});

app.delete('/api/saree-designs/:id/:field', async (req, res) => {
    const { id, field } = req.params;

    try {
        const [oldImages] = await database.execute('SELECT * FROM saree_designs WHERE id = ?', [id]);

        if (!oldImages.length) {
            return res.status(404).json({ error: "Design not found" });
        }

        const imageField = oldImages[0][field];

        if (imageField) {
            await deleteFromS3(imageField);

            const sql = `UPDATE saree_designs SET ${field} = NULL WHERE id = ?`;
            await database.execute(sql, [id]);

            res.status(200).json({ message: "Image deleted successfully" });
        } else {
            res.status(404).json({ error: "Image not found" });
        }
    } catch (error) {
        console.error("Error deleting image from S3:", error);
        res.status(500).json({ error: "Error deleting file" });
    }
});

// Route to get filtered saree designs by loom number
app.get('/api/saree-designs', async (req, res) => {
    const { loomNumber } = req.query;

    if (!loomNumber) {
        return res.status(400).json({ error: "Loom number is required" });
    }

    try {
        const [rows] = await database.execute(
            'SELECT sd.*, l.loomName FROM saree_designs sd JOIN looms l ON sd.loomName = l.loomName WHERE sd.loomNumber = ?',
            [loomNumber]
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching saree designs:', error);
        res.status(500).json({ error: "Error fetching saree designs" });
    }
});

app.get('/api/recent-saree-designs', async (req, res) => {
    const sql = 'SELECT sd.*, l.loomName FROM saree_designs sd JOIN looms l ON sd.loomName = l.loomName ORDER BY sd.createdAt DESC LIMIT 10';
    try {
        const [results] = await database.execute(sql);
        res.status(200).json(results);
    } catch (error) {
        console.error("Error fetching recent saree designs:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/loom-numbers/:loomName', async (req, res) => {
    const { loomName } = req.params;
    const sql = 'SELECT MAX(loomNumber) AS loomNumber FROM looms WHERE loomName = ?';

    try {
        const [results] = await database.execute(sql, [loomName]);
        res.status(200).json(results);
    } catch (error) {
        console.error("Error fetching loom numbers:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

const port = 3662;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
