// server.js

const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql');

const app = express();
const port = 5000;

app.use(bodyParser.json());

// MySQL Connection
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'shri_selvi_fabric'
});

connection.connect();

// Login endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // Find user by username
    connection.query('SELECT * FROM users WHERE username = ?', [username], (error, results, fields) => {
        if (error) {
            return res.status(500).json({ message: 'Internal server error' });
        }

        if (results.length === 0) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        const user = results[0];

        // Validate password
        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ id: user.id, username: user.username }, 'secret_key', { expiresIn: '1h' });

        res.json({ token });
    });
});

// Get recent transactions
app.get('/api/transactions', (req, res) => {
    connection.query('SELECT * FROM transactions ORDER BY date DESC LIMIT 10', (error, results, fields) => {
        if (error) {
            return res.status(500).json({ message: 'Internal server error' });
        }
        res.json(results);
    });
});

// Add new transaction
app.post('/api/transactions', (req, res) => {
    const { date, amount, type, category, subCategory, description } = req.body;
    const newTransaction = { date, amount, type, category, subCategory, description };
    connection.query('INSERT INTO transactions SET ?', newTransaction, (error, results, fields) => {
        if (error) {
            return res.status(500).json({ message: 'Internal server error' });
        }
        res.json({ message: 'Transaction added successfully' });
    });
});

// Update transaction
app.put('/api/transactions/:id', (req, res) => {
    const { date, amount, type, category, subCategory, description } = req.body;
    const transactionId = req.params.id;
    const updatedTransaction = { date, amount, type, category, subCategory, description };
    connection.query('UPDATE transactions SET ? WHERE id = ?', [updatedTransaction, transactionId], (error, results, fields) => {
        if (error) {
            return res.status(500).json({ message: 'Internal server error' });
        }
        res.json({ message: 'Transaction updated successfully' });
    });
});

// Delete transaction
app.delete('/api/transactions/:id', (req, res) => {
    const transactionId = req.params.id;
    connection.query('DELETE FROM transactions WHERE id = ?', [transactionId], (error, results, fields) => {
        if (error) {
            return res.status(500).json({ message: 'Internal server error' });
        }
        res.json({ message: 'Transaction deleted successfully' });
    });
});


app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
});
