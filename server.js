require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin Configuration
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'wotosafety';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Nishant123@';
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-Memory Active Admin Sessions Map: token -> { username, expiresAt }
const activeSessions = new Map();

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (session.expiresAt < now) {
      activeSessions.delete(token);
    }
  }
}, 30 * 60 * 1000); // Clean every 30 mins

// Enable request logging, CORS, JSON parsing, and Form URL parsing
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure directories exist (handling serverless / read-only filesystem environments)
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
const UPLOADS_DIR = isServerless ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, 'uploads');
const DATA_DIR = isServerless ? path.join(os.tmpdir(), 'data') : path.join(__dirname, 'data');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Database files
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Helper to read JSON database files
const readDatabase = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
};

// Helper to write JSON database files
const writeDatabase = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing to ${filePath}:`, error);
  }
};

// Multer storage configuration for handling resume file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Multer upload filter & limits (limit to 5MB, PDF/DOC/DOCX files)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and Word documents (.doc, .docx) are allowed.'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Authentication Middleware for Admin Protection
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

  const session = activeSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) activeSessions.delete(token);
    return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
  }

  req.adminUser = session.username;
  next();
};

// Serve static frontend files (index.html, styles.css, script.js, images)
app.use(express.static(__dirname));

// Route: Redirect /admin to admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==========================================
// ADMIN AUTHENTICATION ROUTES
// ==========================================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  // Verify credentials
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_EXPIRY_MS;

    activeSessions.set(token, {
      username,
      expiresAt
    });

    return res.json({
      success: true,
      token,
      username,
      expiresAt
    });
  }

  return res.status(401).json({ success: false, error: 'Invalid username or password.' });
});

// Verify Admin Session Token
app.get('/api/admin/verify', requireAdminAuth, (req, res) => {
  res.json({
    success: true,
    valid: true,
    username: req.adminUser
  });
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    activeSessions.delete(token);
  }
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ==========================================
// PROTECTED ADMIN DATA & RESUME ROUTES
// ==========================================

// Get Admin Dashboard Data (Protected)
app.get('/api/admin/data', requireAdminAuth, (req, res) => {
  const applications = readDatabase(APPLICATIONS_FILE);
  const messages = readDatabase(MESSAGES_FILE);
  res.json({
    success: true,
    applications,
    messages
  });
});

// Secure Resume File Download (Protected)
app.get('/api/admin/resume/:filename', requireAdminAuth, (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent path traversal
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File not found.' });
  }

  res.download(filePath);
});

// ==========================================
// PUBLIC USER API ROUTES
// ==========================================

// Contact Form Submissions (Public)
app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, subject, and message are required.' });
  }

  const messages = readDatabase(MESSAGES_FILE);
  const newMessage = {
    id: Date.now() + '-' + Math.round(Math.random() * 1000),
    name,
    email,
    subject: subject || 'No Subject',
    message,
    timestamp: new Date().toISOString()
  };

  messages.unshift(newMessage);
  writeDatabase(MESSAGES_FILE, messages);

  res.status(201).json({ success: true, message: 'Message stored successfully!' });
});

// Job Application Form Submissions (Public)
app.post('/api/apply', upload.single('resumeFile'), (req, res) => {
  try {
    const { name, email, phone, city, education, position, skills, experience, portfolio, why } = req.body;

    if (!name || !email || !phone || !city || !education || !position || !skills || !experience || !portfolio || !why || !req.file) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ success: false, error: 'All fields, including resume file upload, are required.' });
    }

    const applications = readDatabase(APPLICATIONS_FILE);
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
      resume: req.file ? {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size
      } : null,
      timestamp: new Date().toISOString()
    };

    applications.unshift(newApplication);
    writeDatabase(APPLICATIONS_FILE, applications);

    res.status(201).json({ success: true, message: 'Application submitted successfully!' });
  } catch (err) {
    console.error('Error handling application:', err);
    res.status(500).json({ success: false, error: err.message || 'An error occurred during submission.' });
  }
});

// Fallback Route to serve index.html for undefined frontend routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`  WOTO Safety Backend Running at: http://localhost:${PORT}`);
  console.log(`  Admin Dashboard Available at: http://localhost:${PORT}/admin`);
  console.log(`  Admin Username: ${ADMIN_USERNAME}`);
  console.log(`===================================================`);
});

module.exports = app;
