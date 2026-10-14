const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const aiRoutes = require('./routes/aiRoutes');

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'GROQ_API_KEY'];

const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar]
);

if (missingEnvVars.length > 0) {
    console.error(
        `Missing required environment variables: ${missingEnvVars.join(', ')}`
    );
    process.exit(1);
}

// Connect to MongoDB
connectDB();

const app = express();

// CORS
app.use(
    cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true
    })
);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);

// Frontend build path
const clientBuildPath = path.join(
    __dirname,
    '..',
    'client',
    'ai-cold-mail-generator',
    'dist'
);

// Serve frontend static files
app.use(express.static(clientBuildPath));

// React/Vite fallback for non-API routes
app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    } else {
        next();
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);

    res.status(500).json({
        message: 'Server Error',
        error: err.message
    });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
