const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const fileUpload = require("express-fileupload");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const jwt = require('jsonwebtoken');
// const bcrypt = require('bcrypt');
// require('dotenv').config();

const app = express();
app.use(cors({
    origin: 'https://newrainbowsarees.in',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

const AWS_ACCESS_KEY_ID="AKIA2UC3F5GS5WWU3VQQ";
const AWS_SECRET_ACCESS_KEY="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";
const AWS_REGION="ap-south-1";


const s3Client = new S3Client({
    region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
    }
});

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "Tamils@126",
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
        handleDisconnect();
    }
}

handleDisconnect();

const generateUniqueName = (length = 6) => {
    return uuidv4().replace(/-/g, '').substring(0, length);
};

const uploadToS3 = async (file, folder = 'transactions') => {
    try{
        const uniqueFileName = `${generateUniqueName()}_${file.name}`;
        const params = {
            Bucket: 'newrainsarees',
            Key: `${folder}/${uniqueFileName}`,
            Body: file.data
        };
        const command = new PutObjectCommand(params);
        const response = await s3Client.send(command);
        return {
            Location: `https://${params.Bucket}.s3.${AWS_REGION}.amazonaws.com/${params.Key}`,
            uniqueFileName
        };
    }catch(error){
        console.error("Error uploading to S3:", error);
        throw new Error("Failed to upload file to S3");
    }
};

const deleteFromS3 = async (fileUrl) => {
    try {
        const fileName = fileUrl.split('/').slice(-2).join('/');
        const params = {
            Bucket: 'newrainsarees',
            Key: fileName
        };
        const command = new DeleteObjectCommand(params);
        await s3Client.send(command);
    } catch (error) {
        console.error("Error deleting from S3:", error);
        throw new Error("Failed to delete file from S3");
    }
};

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

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username =?';
    try {
      const [result] = await database.query(sql, [username]);
      console.log('Database query result:', result);
      if (result.length > 0) {
        const { username: dbUsername, password: dbPassword, id } = result[0];
        console.log('Comparing passwords:', password, dbPassword);
        if (dbUsername === username && dbPassword === password) {
          const token = generateToken(id);
          console.log('Generated token:', token);
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

function generateToken(id) {
    const secretKey = '4S$eJ#8dLpR5tY3uI2oP1nGfE6cD5bA';
    const token = jwt.sign({ id }, secretKey, { expiresIn: '2s' });
    return token;
}

// Middleware to create table only when explicitly requested
const checkAndCreateTable = async (tableName) => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS \`location_${tableName}\` (
            id INT AUTO_INCREMENT PRIMARY KEY,
            date DATE NOT NULL,
            type VARCHAR(255) NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            category VARCHAR(255),
            subCategory VARCHAR(255),
            description TEXT,
            file VARCHAR(255)
        );
    `;
    await database.query(createTableQuery);
};

// POST createTable
app.post('/api/transactions/checkAndCreateTable', async (req, res) => {
    const { tableName } = req.body;
    try {
        await checkAndCreateTable(tableName);
        res.status(200).json({ message: "Table created successfully" });
    } catch (error) {
        console.error('Error creating table:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST transaction
app.post('/api/transactions/:location', async (req, res) => {
    const { location } = req.params;
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files : null;

    try {
        const sql = `INSERT INTO \`location_${location}\` (date, type, amount, category, subCategory, description, file) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const fileDetails = file ? await uploadToS3(file, 'transactions') : null;
        const values = [date, type, amount, category, subCategory, description, fileDetails ? fileDetails.uniqueFileName : null];
       	console.log("Inserting into database with values:", values);
        await database.query(sql, values);
        res.status(200).json({ message: "Transaction added successfully", fileUploaded: !!file });
    } catch (error) {
        console.error("Error inserting transaction:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// PUT transaction
app.put('/api/transactions/:location/:id', async (req, res) => {
    const { location, id } = req.params;
    const { date, type, amount, category, subCategory, description } = req.body;
    const file = req.files ? req.files.files : null;

    console.log("Update request received:", req.body, req.files);

    try {
        const [originalFileResult] = await database.query(`SELECT file FROM \`location_${location}\` WHERE id = ?`, [id]);
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

        const sql = `UPDATE \`location_${location}\` SET date=?, type=?, amount=?, category=?, subCategory=?, description=?, file=? WHERE id=?`;
        const values = [date, type, amount, category, subCategory, description, uniqueFileName, id];
        console.log("Updating database with values:", values);
        await database.query(sql, values);
        res.status(200).json({ message: "Transaction updated successfully", fileUploaded: !!file, fileUrl });
    } catch (error) {
        console.error("Error updating transaction:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET all locations
app.get('/api/locations', async (req, res) => {
    try {
        const [results] = await database.query('SHOW TABLES');
        const locations = results
            .map(row => Object.values(row)[0])
            .filter(tableName => tableName.startsWith('location_'))  // Filter tables by prefix
            .map(tableName => tableName.replace('location_', ''));  // Remove prefix for display
        res.json({ locations });
    } catch (error) {
        console.error("Error fetching locations:", error.message);
        console.error("Stack trace:", error.stack);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET transactions
app.get('/api/transactions/:location', async (req, res) => {
    const { location } = req.params;
    try {
        const [results] = await database.query(`SELECT * FROM \`location_${location}\``);
        const formattedResults = results.map(transaction => ({
            ...transaction,
            date: new Date(transaction.date).toISOString().split('T')[0]
        }));
        res.json(formattedResults);
    } catch (error) {
        console.error("Error fetching recent transactions:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Get categories and subcategories
app.get('/api/categories/:location', async (req, res) => {
    const { location } = req.params;
    try {
        const [categoryResults] = await database.execute('SELECT DISTINCT category FROM `location_' + location + '`');
        const [subCategoryResults] = await database.execute('SELECT DISTINCT subCategory FROM `location_' + location + '`');

        const categories = categoryResults.map(row => row.category);
        const subCategories = subCategoryResults.map(row => row.subCategory);

        res.json({ categories, subCategories });
    } catch (error) {
        console.error('Error fetching categories and subcategories:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin verify password
app.post('/api/admin/verifyPassword', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await database.execute('SELECT * FROM users WHERE username =?', [username]);
        if (rows.length > 0) {
            const user = rows[0];
            if (user.password === password) {
                res.json({ success: true });
            } else {
                res.json({ success: false, message: 'Invalid password' });
            }
        } else {
            res.json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        console.error('Error verifying password:', error);
        res.status(500).json({ error: 'Internal server error' });
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
        const [rows] = await database.query('SELECT DISTINCT loomType FROM looms WHERE loomType IS NOT NULL AND loomType != "other"');
        res.json(rows.map(row => row.loomType));
    } catch (err) {
        console.error('Error fetching loom types:', err);
        res.status(500).json({ message: 'Error fetching loom types' });
    }
});

app.get('/api/jacquardTypes', async (req, res) => {
    try {
        const [rows] = await database.query('SELECT DISTINCT jacquardType FROM looms WHERE jacquardType IS NOT NULL AND jacquardType != "other"');
        res.json(rows.map(row => row.jacquardType));
    } catch (error) {
        console.error('Error fetching jacquard types:', error);
        res.status(500).json({ message: 'Error fetching jacquard types' });
    }
});

app.get('/api/designNames', async (req, res) => {
    try {
        const [rows] = await database.query('SELECT DISTINCT designName FROM designs WHERE designName IS NOT NULL AND designName != "other"');
        res.json(rows.map(row => row.designName));
    } catch (error) {
        console.error('Error fetching design names:', error);
        res.status(500).json({ message: 'Error fetching design names' });
    }
});

app.post('/api/weavers', async (req, res) => {
    console.log("Body: ",req.body);
    console.log("Files: ",req.files);
    const { weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description } = req.body;
    // const idProof = req.files ? req.files.idProof : null;

    
    let idProof;
    if (!req.files || !req.files.idProof) {
        return res.status(400).json({ error: "No ID Proof uploaded" });
    }

    idProof = req.files.idProof;
    console.log("idProof:", idProof);
    const [existingWeavers] = await database.query('SELECT * FROM weavers WHERE weaverName = ? OR loomName = ?', [weaverName, loomName]);
    if (existingWeavers.length > 0) {
        return res.status(400).json({ error: "Weaver name or Loom name already exists" });
    }

    try {
        const uploadResult = await uploadToS3(idProof, 'weavers');
        await database.query('INSERT INTO weavers (weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, idProof) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, uploadResult.Location]);
        res.status(200).json({ message: "Weaver added successfully", fileUploaded: true });
    } catch (error) {
        console.error("Error inserting weaver:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.put('/api/weavers/:id', async (req, res) => {
    const { weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description } = req.body;
    let idProofUrl = null;

    if (req.files && req.files.idProof) {
        try {
            const s3Result = await uploadToS3(req.files.idProof, 'weavers');
            idProofUrl = s3Result.Location;
        } catch (error) {
            return res.status(500).send('Error uploading to S3: ' + error.message);
        }
    }

    const [existingWeavers] = await database.query('SELECT * FROM weavers WHERE (weaverName = ? OR loomName = ?) AND id != ?', [weaverName, loomName, req.params.id]);
    if (existingWeavers.length > 0) {
        return res.status(400).json({ error: "Weaver name or Loom name already exists" });
    }

    const query = "UPDATE weavers SET weaverName = ?, loomName = ?, address = ?, area = ?, mobileNumber1 = ?, mobileNumber2 = ?, reference = ?, description = ?, idProof = ? WHERE id = ?";
    try {
        await database.query(query, [weaverName, loomName, address, area, mobileNumber1, mobileNumber2, reference, description, idProofUrl, req.params.id]);
        res.status(200).json({ message: "Weaver updated successfully" });
    } catch (error) {
        console.error("Error updating weaver:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/api/looms', async (req, res) => {
    const { loomName, loomNumber, loomType, jacquardType, hooks, description, newLoomType, newJacquardType } = req.body;

    const loomTypeToSave = loomType === 'other' ? newLoomType : loomType;
    const jacquardTypeToSave = jacquardType === 'other' ? newJacquardType : jacquardType;

    if (loomTypeToSave === 'other' || jacquardTypeToSave === 'other') {
        return res.status(400).json({ error: "Invalid loom or jacquard type" });
    }

    const [existingLooms] = await database.query('SELECT * FROM looms WHERE loomName = ?', [loomName]);
    if (existingLooms.length > 0) {
        return res.status(400).json({ error: "Loom name already exists" });
    }

    try {
        const [result] = await database.query('INSERT INTO looms (loomName, loomNumber, loomType, jacquardType, hooks, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())', [loomName, loomNumber, loomTypeToSave, jacquardTypeToSave, hooks, description]);

        res.status(200).json({ message: "Loom added successfully" });
    } catch (error) {
        console.error("Error inserting loom:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.put('/api/looms/:id', async (req, res) => {
    const { loomName, loomNumber, loomType, jacquardType, hooks, description } = req.body;

    const [existingLooms] = await database.query('SELECT * FROM looms WHERE loomName = ? AND id != ?', [loomName, req.params.id]);
    if (existingLooms.length > 0) {
        return res.status(400).json({ error: "Loom name already exists" });
    }

    const loomTypeValue = loomType === 'other' ? req.body.newLoomType : loomType;
    const jacquardTypeValue = jacquardType === 'other' ? req.body.newJacquardType : jacquardType;

    if (loomType === 'other') {
        await database.query('INSERT INTO looms (loomType) VALUES (?)', [req.body.newLoomType]);
    }

    if (jacquardType === 'other') {
        await database.query('INSERT INTO looms (jacquardType) VALUES (?)', [req.body.newJacquardType]);
    }

    const query = "UPDATE looms SET loomName = ?, loomNumber = ?, loomType = ?, jacquardType = ?, hooks = ?, description = ?, updatedAt = NOW() WHERE id = ?";
    try {
        await database.query(query, [loomName, loomNumber, loomTypeValue, jacquardTypeValue, hooks, description, req.params.id]);
        res.status(200).json({ message: "Loom updated successfully" });
    } catch (error) {
        console.error("Error updating loom:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/api/designs', async (req, res) => {
    const { loomName, loomNumber, designName, designBy, newDesignName } = req.body;
    const planSheet = req.files ? req.files.planSheet : null;
    const designUpload = req.files ? req.files.designUpload : null;

    if (!planSheet || !designUpload) {
        return res.status(400).json({ error: "Plan Sheet or Design Upload not provided" });
    }

    const designNameToSave = designName === 'other' ? newDesignName : designName;

    try {
        const planSheetUploadResult = await uploadToS3(planSheet, 'designs');
        const designUploadResult = await uploadToS3(designUpload, 'designs');
        const [result] = await database.query('INSERT INTO designs (loomName, loomNumber, planSheet, designName, designBy, designUpload, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())', [loomName, loomNumber, planSheetUploadResult.Location, designNameToSave, designBy, designUploadResult.Location]);

        res.status(200).json({ message: "Design added successfully", fileUploaded: true });
    } catch (error) {
        console.error("Error inserting design:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.put('/api/designs/:id', async (req, res) => {
    const { loomName, loomNumber, designName, designBy } = req.body;
    let planSheetUrl = null;
    let designUploadUrl = null;

    if (req.files && req.files.planSheet) {
        try {
            const s3Result = await uploadToS3(req.files.planSheet, 'designs');
            planSheetUrl = s3Result.Location;
        } catch (error) {
            return res.status(500).send('Error uploading to S3: ' + error.message);
        }
    }

    if (req.files && req.files.designUpload) {
        try {
            const s3Result = await uploadToS3(req.files.designUpload, 'designs');
            designUploadUrl = s3Result.Location;
        } catch (error) {
            return res.status(500).send('Error uploading to S3: ' + error.message);
        }
    }

    const query = "UPDATE designs SET loomName = ?, loomNumber = ?, designName = ?, designBy = ?, planSheet = COALESCE(?, planSheet), designUpload = COALESCE(?, designUpload), updatedAt = NOW() WHERE id = ?";
    try {
        await database.query(query, [loomName, loomNumber, designName, designBy, planSheetUrl, designUploadUrl, req.params.id]);
        res.status(200).json({ message: "Design updated successfully" });
    } catch (error) {
        console.error("Error updating design:", error);
        res.status(500).json({ error: "Internal server error" });
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
