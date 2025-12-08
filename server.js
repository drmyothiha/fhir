// server.js - Refactored AMS server with HTTPS and proper ICHI/FHIR mapping
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { Fhir } = require('fhir');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const fhir = new Fhir();

// ========== SQLite (ICHI) ==========
const sqlite3 = require('sqlite3').verbose();
// Use your actual table name. If you've kept the slimmed table name as "ICHI", leave as-is.
// Otherwise set to "LinearizationMiniOutput_ICHI_e".
const ICHI_TABLE = 'ICHI';
const AHCI_DB_PATH = path.join(__dirname, 'ichi.db');

// ========== HTTPS Configuration with mkcert ==========
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'localhost+2-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'localhost+2.pem')),
  requestCert: false,
  rejectUnauthorized: false // dev only
};

// ========== Mongoose Schema and Model ==========
const appointmentSchema = new mongoose.Schema({
  resourceType: String,
  status: String,
  start: Date,
  end: Date,
  participants: Array,
  patientName: String,
  doctorName: String,
  diagnosis: String,
  procedureCode: String,     // <-- added
  raw: Object
});

const Appointment = mongoose.model('Appointment', appointmentSchema);

const cors = require('cors');

app.use(cors({
  origin: 'http://localhost:3000', // React app URL
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/ams')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// ========== Middleware ==========
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Simple request logging
app.use((req, res, next) => {
  const protocol = req.secure ? 'HTTPS' : 'HTTP';
  console.log(`${new Date().toISOString()} - ${protocol} ${req.method} ${req.url}`);
  next();
});

// ========== SQLite Database ==========
const ichiDb = new sqlite3.Database(AHCI_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Failed to open ichi.db:', err.message);
  } else {
    console.log('Connected to ichi.db');
  }
});

// Promise wrappers
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// ========== ICHI ROUTES ==========
// Define specific routes BEFORE parameterized routes

// Search route FIRST
app.get('/ichi/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter q' });

    // Escape wildcards
    const term = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);

    // Only return cleaned Title and Code; optionally filter by DepthInKind=1
    const sql = `
      SELECT LTRIM(REPLACE(Title, '-', ''), ' ') AS Title, Code
FROM ${ICHI_TABLE}
WHERE DepthInKind = '1' AND Title LIKE ? ESCAPE '\\'
ORDER BY Code
LIMIT ?
    `;

    const rows = await dbAll(ichiDb, sql, [term, limit]);

    res.json({
      query: q,
      count: rows.length,
      results: rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// Single code route SECOND
app.get('/ichi/:code', async (req, res) => {
  try {
    const code = (req.params.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Missing code parameter' });

    const sql = `
      SELECT Code, BlockId, Title, ClassKind, DepthInKind
      FROM ${ICHI_TABLE}
      WHERE Code = ? LIMIT 1
    `;
    const row = await dbGet(ichiDb, sql, [code]);

    if (!row) return res.status(404).json({ error: 'Code not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch code', details: err.message });
  }
});

// List route THIRD
app.get('/ichi', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const sortColumn = (req.query.sort === 'Title') ? 'Title' : 'Code'; // whitelist

    const sql = `
      SELECT Code, BlockId, Title, ClassKind, DepthInKind
      FROM ${ICHI_TABLE}
      ORDER BY ${sortColumn} LIMIT ? OFFSET ?
    `;
    const rows = await dbAll(ichiDb, sql, [limit, offset]);

    res.json({
      count: rows.length,
      limit,
      offset,
      results: rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to query ICHI database', details: err.message });
  }
});

// ========== Appointment Routes ==========
// Serve HTML form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper: Convert EHR data to FHIR Appointment
function convertEHRtoFHIR(ehrData) {
  const statusMap = {
    scheduled: 'booked',
    confirmed: 'booked',
    arrived: 'arrived',
    completed: 'fulfilled',
    cancelled: 'cancelled',
    noshow: 'noshow',
    pending: 'pending'
  };
  const fhirStatus = statusMap[ehrData.status] || 'booked';

  const appointment = {
    resourceType: 'Appointment',
    id: `appt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    status: fhirStatus,
    serviceType: [{ text: 'Medical Consultation' }],
    start: new Date(ehrData.startDateTime).toISOString(),
    end: new Date(ehrData.endDateTime).toISOString(),
    minutesDuration: parseInt(ehrData.duration, 10) || 30,
    created: new Date().toISOString(),
    comment: ehrData.notes || '',
    participant: [
      {
        actor: {
          reference: `Patient/${ehrData.patientId}`,
          display: ehrData.patientName
        },
        status: 'accepted',
        required: 'required'
      },
      {
        actor: {
          reference: `Practitioner/${ehrData.doctorId}`,
          display: ehrData.doctorName
        },
        status: 'accepted',
        required: 'required'
      }
    ]
  };

  // reasonCode: diagnosis + ICHI procedure code if present
  if (ehrData.diagnosis || ehrData.procedureCode) {
    const reason = {
      text: ehrData.diagnosis || ''
    };
    if (ehrData.procedureCode) {
      reason.coding = [{
        system: 'https://icd.who.int/devct11/ichi/en/current',
        code: ehrData.procedureCode,
        display: ehrData.diagnosis || ''
      }];
    }
    appointment.reasonCode = [reason];
  }

  if (ehrData.priority) {
    appointment.priority = parseInt(ehrData.priority, 10);
  }

  return appointment;
}

// Book appointment
app.post('/book-appointment', async (req, res) => {
  try {
    console.log('Received EHR data:', req.body);

    const fhirAppointment = convertEHRtoFHIR(req.body);
    console.log('Converted FHIR:', JSON.stringify(fhirAppointment, null, 2));

    // Validate FHIR resource
    const result = fhir.validate(fhirAppointment);
    console.log('Validation result:', result);

    if (!result.valid) {
      console.log('Validation errors:', result.errors);
      return res.status(400).json({
        success: false,
        error: 'FHIR Validation Failed',
        details: result.errors,
        warnings: result.warnings
      });
    }

    // Persist to MongoDB (store procedureCode explicitly)
    const newAppointment = new Appointment({
      resourceType: fhirAppointment.resourceType,
      status: fhirAppointment.status,
      start: fhirAppointment.start,
      end: fhirAppointment.end,
      participants: fhirAppointment.participant,
      patientName: req.body.patientName,
      doctorName: req.body.doctorName,
      diagnosis: req.body.diagnosis,
      procedureCode: req.body.procedureCode || null, // <-- added
      raw: fhirAppointment
    });

    await newAppointment.save();

    console.log('Appointment stored successfully:', newAppointment._id);

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully!',
      appointmentId: newAppointment._id,
      fhirResource: fhirAppointment
    });

  } catch (error) {
    console.error('Error booking appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Get all pending appointments
app.get('/appointments/pending', async (req, res) => {
  try {
    // Filter appointments by 'pending' status
    const pendingAppointments = await Appointment.find({ 
      status: 'pending' 
    }).sort({ start: 1 }); // Sort by start time, ascending (earliest first)

    res.json({
      count: pendingAppointments.length,
      appointments: pendingAppointments
    });
  } catch (error) {
    console.error('Error fetching pending appointments:', error);
    res.status(500).json({ 
      error: 'Failed to fetch pending appointments',
      details: error.message 
    });
  }
});

// List appointments
app.get('/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ start: -1 });
    res.json({
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get single appointment
app.get('/appointments/:id', async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

// Graceful shutdown: close SQLite on SIGINT
process.on('SIGINT', () => {
  ichiDb.close((err) => {
    if (err) console.error('Error closing ichi.db:', err.message);
    else console.log('Closed ichi.db');
    process.exit(0);
  });
});

// ========== HTTPS Servers ==========
const HTTPS_PORT = 443;
const HTTP_PORT = 80;

const httpsServer = https.createServer(sslOptions, app);

const http = require('http');
const httpApp = express();
httpApp.use((req, res) => {
  res.redirect(`https://${req.headers.host}${req.url}`);
});

http.createServer(httpApp).listen(HTTP_PORT, () => {
  console.log(`HTTP redirect server running on port ${HTTP_PORT}`);
});

httpsServer.listen(HTTPS_PORT, () => {
  console.log(`✅ AMS HTTPS Server running on https://localhost:${HTTPS_PORT}`);
  console.log(`✅ Web form available at https://localhost:${HTTPS_PORT}`);
  console.log(`✅ ICHI endpoints available at:`);
  console.log(`   https://localhost:${HTTPS_PORT}/ichi`);
  console.log(`   https://localhost:${HTTPS_PORT}/ichi/search?q=appendix`);
  console.log(`   https://localhost:${HTTPS_PORT}/ichi/IAA.BA.BC`);
  console.log(`\n⚠️  IMPORTANT: If using port 443, you may need to run with sudo`);
  console.log(`   Alternatively, use a different port like 8443`);
});
