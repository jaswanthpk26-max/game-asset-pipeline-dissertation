require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });
const app = express();
app.use(express.json());
app.use(express.static('../frontend'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.post('/upload-version-file', upload.single('versionFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            message: 'No file uploaded'
        });
    }

    res.json({
        message: 'File uploaded successfully',
        filePath: '/uploads/' + req.file.filename
    });
});
app.post('/upload-preview', upload.single('previewFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            message: 'No preview image uploaded'
        });
    }

    res.json({
        message: 'Preview image uploaded successfully',
        previewPath: '/uploads/' + req.file.filename
    });
});
const PORT = 3000;
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});
db.connect((err) => {
    if (err) {
        console.log('Database connection failed!');
        console.log(err);
    } else {
        console.log('Connected to MySQL Database!');
    }
});
app.get('/', (req, res) => {
    res.send('Welcome to the Game Asset Pipeline System!');
});
app.get('/users', (req, res) => {
    const sql = 'SELECT * FROM Users';

    db.query(sql, (err, results) => {
        if (err) {
            console.log(err);
            res.status(500).send('Failed to retrieve users');
        } else {
            res.json(results);
        }
    });
});
app.get('/projects', (req, res) => {
    const sql = 'SELECT * FROM Projects';

    db.query(sql, (err, results) => {
        if (err) {
            console.log(err);
            res.status(500).send('Failed to retrieve projects');
        } else {
            res.json(results);
        }
    });
});

app.get('/assets', (req, res) => {
    const sql = 'SELECT * FROM Assets';

    db.query(sql, (err, results) => {
        if (err) {
            console.log(err);
            res.status(500).send('Failed to retrieve assets');
        } else {
            res.json(results);
        }
    });
});

app.put('/assets/:id/status', (req, res) => {
    const assetId = req.params.id;
    const { status } = req.body;

    // Step 1: Get the current status before changing it
    const getAssetSql = 'SELECT Status FROM Assets WHERE Asset_ID = ?';

    db.query(getAssetSql, [assetId], (err, assets) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: 'Failed to read asset' });
        }

        if (assets.length === 0) {
            return res.status(404).json({ message: 'Asset not found' });
        }

        const oldStatus = assets[0].Status;

        // Step 2: Update the asset status
        const updateSql = `
            UPDATE Assets
            SET Status = ?
            WHERE Asset_ID = ?
        `;

        db.query(updateSql, [status, assetId], (err, result) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ message: 'Failed to update asset status' });
            }

            // Step 3: Record the change in the audit trail
            const activitySql = `
                INSERT INTO Asset_Activity
                (Asset_ID, User_ID, Old_Status, New_Status)
                VALUES (?, ?, ?, ?)
            `;

            db.query(
                activitySql,
                [assetId, 1, oldStatus, status],
                (activityErr) => {
                    if (activityErr) {
                        console.log('Audit trail error:', activityErr);
                    }

                    // Step 4: Create notification
                    const notificationMessage =
                        `Asset ID ${assetId} status changed from ${oldStatus} to ${status}`;

                    const notificationSql = `
                        INSERT INTO Notifications (User_ID, Message)
                        VALUES (?, ?)
                    `;

                    db.query(
                        notificationSql,
                        [1, notificationMessage],
                        (notificationErr) => {
                            if (notificationErr) {
                                console.log(notificationErr);
                            }

                            res.json({
                                message: 'Asset status updated successfully'
                            });
                        }
                    );
                }
            );
        });
    });
});

app.post('/assets', (req, res) => {
    const { assetName, assetType, filePath, previewPath, status } = req.body;

    const sql = `
        INSERT INTO Assets
(Asset_Name, Asset_Type, File_Path, Preview_Path, Project_ID, Uploaded_By, Status)
VALUES (?, ?, ?, ?, 1, 1, ?)
    `;

   db.query(sql, [assetName, assetType, filePath, previewPath, status], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).json({ message: 'Failed to add asset' });
        } else {
            res.json({ message: 'Asset added successfully' });
        }
    });
});
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM Users WHERE Email = ? AND Password = ?';

    db.query(sql, [email, password], (err, results) => {
if (err) {
    console.log(err);
    res.status(500).json({ message: 'Database error' });
} else if (results.length > 0) {
    res.json({ message: 'Login successful', user: results[0] });
} else {
    res.status(401).json({ message: 'Invalid email or password' });
}
});
});

app.post('/assets/:assetId/versions', (req, res) => {
    const assetId = req.params.assetId;
    const { versionNumber, filePath, notes } = req.body;

    const sql = `
        INSERT INTO Asset_Versions
        (Asset_ID, Version_Number, File_Path, Notes)
        VALUES (?, ?, ?, ?)
    `;

    db.query(sql, [assetId, versionNumber, filePath, notes], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).json({
                message: 'Failed to add asset version'
            });
        }

        res.json({
            message: 'Asset version added successfully'
        });
    });
});
app.get('/assets/:assetId/versions', (req, res) => {
    const assetId = req.params.assetId;

    const sql = `
        SELECT * FROM Asset_Versions
        WHERE Asset_ID = ?
        ORDER BY Version_Number DESC
    `;

    db.query(sql, [assetId], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({
                message: 'Failed to load asset versions'
            });
        }

        res.json(results);
    });
});
app.post('/notifications', (req, res) => {
    const { userId, message } = req.body;

    const sql = `
        INSERT INTO Notifications
        (User_ID, Message)
        VALUES (?, ?)
    `;

    db.query(sql, [userId, message], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).json({
                message: 'Failed to create notification'
            });
        }

        res.json({
            message: 'Notification created successfully'
        });
    });
});
app.get('/notifications/:userId', (req, res) => {
    const userId = req.params.userId;

    const sql = `
        SELECT * FROM Notifications
        WHERE User_ID = ?
        ORDER BY Created_At DESC
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({
                message: 'Failed to retrieve notifications'
            });
        }

        res.json(results);
    });
});

app.put('/notifications/:notificationId/read', (req, res) => {
    const notificationId = req.params.notificationId;

    const sql = `
        UPDATE Notifications
        SET Is_Read = TRUE
        WHERE Notification_ID = ?
    `;

    db.query(sql, [notificationId], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).json({
                message: 'Failed to mark notification as read'
            });
        }

        res.json({
            message: 'Notification marked as read'
        });
    });
});
app.get('/asset-activity', (req, res) => {
    const sql = `
        SELECT
            aa.Activity_ID,
            aa.Asset_ID,
            a.Asset_Name,
            aa.Old_Status,
            aa.New_Status,
            aa.Changed_At,
            aa.User_ID,
            u.Full_Name AS User_Name,
            u.Role AS User_Role
        FROM Asset_Activity aa
        JOIN Assets a ON aa.Asset_ID = a.Asset_ID
        LEFT JOIN Users u ON aa.User_ID = u.User_ID
        ORDER BY aa.Changed_At DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({
                message: 'Failed to load asset activity'
            });
        }

        res.json(results);
    });
});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

