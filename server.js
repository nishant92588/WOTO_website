require('dotenv').config();
const crypto = require('crypto');
if (!globalThis.crypto) globalThis.crypto = crypto;
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const os = require('os');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin Configuration & Secrets
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'wotosafety';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Nishant123@';
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'woto-safety-super-secret-jwt-key-2026-auth';
const JWT_EXPIRY = '7d'; // Admin session stays valid for 7 days

// Enable request logging, CORS, JSON parsing, and Form URL parsing
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Local & Temporary Filesystem Setup (Fallback when MongoDB/Cloudinary are not configured)
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
const UPLOADS_DIR = isServerless ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, 'uploads');
const DATA_DIR = isServerless ? path.join(os.tmpdir(), 'data') : path.join(__dirname, 'data');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Local JSON Database Files
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// ==========================================
// 1. MONGODB ATLAS CONNECTION & SCHEMAS
// ==========================================
let isDbConnected = false;

const connectDB = async () => {
  if (isDbConnected || mongoose.connection.readyState >= 1) {
    return true;
  }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri || mongoUri.trim() === '') {
    return false;
  }

  try {
    const db = await mongoose.connect(mongoUri.trim(), {
      serverSelectionTimeoutMS: 5000,
    });
    isDbConnected = db.connections[0].readyState === 1;
    console.log('✅ Connected to MongoDB Atlas Cloud Database.');
    return true;
  } catch (error) {
    console.error('⚠️ MongoDB Connection Error:', error.message);
    isDbConnected = false;
    return false;
  }
};

// Auto-connect if URI is present
if (process.env.MONGODB_URI) {
  connectDB();
}

// Mongoose Database Schemas
const MessageSchema = new mongoose.Schema({
  id: { type: String, default: () => Date.now() + '-' + Math.round(Math.random() * 1000) },
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, default: 'No Subject' },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const ApplicationSchema = new mongoose.Schema({
  id: { type: String, default: () => Date.now() + '-' + Math.round(Math.random() * 1000) },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  city: { type: String, default: '' },
  education: { type: String, default: '' },
  position: { type: String, required: true },
  skills: { type: String, default: '' },
  experience: { type: String, default: '' },
  portfolio: { type: String, default: '' },
  why: { type: String, required: true },
  resume: {
    filename: String,
    originalName: String,
    size: Number,
    url: String
  },
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);
const Application = mongoose.models.Application || mongoose.model('Application', ApplicationSchema);

// ==========================================
// 2. LOCAL JSON FALLBACK HELPERS
// ==========================================
const readLocalJSON = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
};

const writeLocalJSON = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing to ${filePath}:`, error);
  }
};

// ==========================================
// 3. FILE UPLOAD (CLOUDINARY / LOCAL DISK)
// ==========================================
let upload;

// Check if Cloudinary is configured
const hasCloudinary = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

if (hasCloudinary) {
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  const cloudStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'woto_safety_resumes',
      resource_type: 'raw',
      allowed_formats: ['pdf', 'doc', 'docx']
    }
  });

  upload = multer({
    storage: cloudStorage,
    limits: { fileSize: 5 * 1024 * 1024 }
  });
  console.log('☁️ Cloudinary Storage enabled for resume uploads.');
} else {
  // Local Disk Storage Fallback
  const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and Word documents (.doc, .docx) are allowed.'));
    }
  };

  upload = multer({
    storage: diskStorage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
  });
}

// ==========================================
// 4. JWT AUTHENTICATION MIDDLEWARE
// ==========================================
const requireAdminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.adminUser = decoded.username;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid. Please log in again.' });
  }
};

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Route: Redirect /team to team.html
app.get('/team', (req, res) => {
  const teamPath = fs.existsSync(path.join(__dirname, 'public', 'team.html'))
    ? path.join(__dirname, 'public', 'team.html')
    : path.join(__dirname, 'team.html');
  res.sendFile(teamPath);
});
// Route: Redirect /admin to admin.html
app.get('/admin', (req, res) => {
  const adminPath = fs.existsSync(path.join(__dirname, 'public', 'admin.html'))
    ? path.join(__dirname, 'public', 'admin.html')
    : path.join(__dirname, 'admin.html');
  res.sendFile(adminPath);
});

// ==========================================
// 5. ADMIN AUTHENTICATION ROUTES
// ==========================================

// Admin Login (Stateless JWT)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign(
      { username: ADMIN_USERNAME, role: 'admin' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    return res.json({
      success: true,
      token,
      username,
      expiresIn: JWT_EXPIRY
    });
  }

  return res.status(401).json({ success: false, error: 'Invalid username or password.' });
});

// Verify Admin Session Token
app.get('/api/admin/verify', requireAdminAuth, (req, res) => {
  res.json({
    success: true,
    valid: true,
    username: req.adminUser,
    isDbConnected: !!process.env.MONGODB_URI
  });
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ==========================================
// 6. PROTECTED ADMIN DATA & RESUME ROUTES
// ==========================================

// Get Admin Dashboard Data
app.get('/api/admin/data', requireAdminAuth, async (req, res) => {
  const dbActive = await connectDB();

  if (dbActive) {
    try {
      const applications = await Application.find().sort({ timestamp: -1 }).lean();
      const messages = await Message.find().sort({ timestamp: -1 }).lean();

      return res.json({
        success: true,
        storageType: 'mongodb',
        applications,
        messages
      });
    } catch (err) {
      console.error('Error fetching from MongoDB:', err);
    }
  }

  // Fallback to local files
  const applications = readLocalJSON(APPLICATIONS_FILE);
  const messages = readLocalJSON(MESSAGES_FILE);

  res.json({
    success: true,
    storageType: 'local',
    applications,
    messages
  });
});

// Secure Resume File Download
app.get('/api/admin/resume/:filename', requireAdminAuth, async (req, res) => {
  const target = req.params.filename;

  // Check if filename is an external Cloudinary / Cloud URL or if we can find it in DB
  const dbActive = await connectDB();
  if (dbActive) {
    try {
      const appRecord = await Application.findOne({
        $or: [
          { 'resume.filename': target },
          { id: target },
          { _id: mongoose.isValidObjectId(target) ? target : null }
        ]
      });

      if (appRecord && appRecord.resume && appRecord.resume.url) {
        return res.redirect(appRecord.resume.url);
      }
    } catch (err) {
      console.error('DB query error on resume fetch:', err);
    }
  }

  const filename = path.basename(target);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Resume file not found on server.' });
  }

  res.download(filePath);
});

// ==========================================
// 7. PUBLIC USER API ROUTES
// ==========================================

// Contact Form Submissions
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, subject, and message are required.' });
  }

  const newMessage = {
    id: Date.now() + '-' + Math.round(Math.random() * 1000),
    name,
    email,
    subject: subject || 'No Subject',
    message,
    timestamp: new Date().toISOString()
  };

  const dbActive = await connectDB();
  if (dbActive) {
    try {
      await Message.create(newMessage);
      return res.status(201).json({ success: true, message: 'Message stored successfully in Cloud Database!' });
    } catch (err) {
      console.error('Error saving message to MongoDB:', err);
    }
  }

  // Fallback to local file
  const messages = readLocalJSON(MESSAGES_FILE);
  messages.unshift(newMessage);
  writeLocalJSON(MESSAGES_FILE, messages);

  res.status(201).json({ success: true, message: 'Message stored successfully!' });
});

// Job Application Form Submissions
app.post('/api/apply', upload.single('resumeFile'), async (req, res) => {
  try {
    const { name, email, phone, city, education, position, skills, experience, portfolio, why } = req.body;

    if (!name || !email || !phone || !city || !education || !position || !skills || !experience || !portfolio || !why || !req.file) {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ success: false, error: 'All fields, including resume file upload, are required.' });
    }

    const resumeData = {
      filename: req.file.filename || req.file.originalname,
      originalName: req.file.originalname,
      size: req.file.size || 0,
      url: req.file.path && req.file.path.startsWith('http') ? req.file.path : null
    };

    const newApplication = {
      id: Date.now() + '-' + Math.round(Math.random() * 1000),
      name,
      email,
      phone,
      city: city || '',
      education: education || '',
      position,
      skills: skills || '',
      experience: experience || '',
      portfolio: portfolio || '',
      why,
      resume: resumeData,
      timestamp: new Date().toISOString()
    };

    const dbActive = await connectDB();
    if (dbActive) {
      try {
        await Application.create(newApplication);
        return res.status(201).json({ success: true, message: 'Application submitted successfully to Cloud Database!' });
      } catch (err) {
        console.error('Error saving application to MongoDB:', err);
      }
    }

    // Fallback to local file
    const applications = readLocalJSON(APPLICATIONS_FILE);
    applications.unshift(newApplication);
    writeLocalJSON(APPLICATIONS_FILE, applications);

    res.status(201).json({ success: true, message: 'Application submitted successfully!' });
  } catch (err) {
    console.error('Error handling application:', err);
    res.status(500).json({ success: false, error: err.message || 'An error occurred during submission.' });
  }
});

// Fallback Route to serve index.html for undefined frontend routes
app.use((req, res) => {
  const indexPath = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

// Global error handler for multer file uploads
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File is too large. Max limit is 5MB.' });
    }
    return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

// Start Server locally or when run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`  WOTO Safety Backend Running at: http://localhost:${PORT}`);
    console.log(`  Admin Dashboard Available at: http://localhost:${PORT}/admin`);
    console.log(`  Storage Mode: ${process.env.MONGODB_URI ? '🟢 MongoDB Atlas Cloud' : '🟡 Local Storage (Add MONGODB_URI to .env for Cloud)'}`);
    console.log(`  Admin Username: ${ADMIN_USERNAME}`);
    console.log(`===================================================`);
  });
}

module.exports = app;
