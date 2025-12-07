// server.js - Updated AMS server with web form support
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { Fhir } = require('fhir');
const path = require('path');

const app = express();
const fhir = new Fhir();
// AHCI
const sqlite3 = require('sqlite3').verbose();
const AHCI_DB_PATH = path.join(__dirname, 'ichi.db');

// ========== Define Mongoose Schema FIRST ==========
// Define Appointment schema
const appointmentSchema = new mongoose.Schema({
  resourceType: String,
  status: String,
  start: Date,
  end: Date,
  participants: Array,
  patientName: String,
  doctorName: String,
  diagnosis: String,
  raw: Object
});

// Create Appointment model AFTER schema is defined
const Appointment = mongoose.model('Appointment', appointmentSchema);

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/ams')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// ========== Middleware ==========
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// ========== SQLite Database ==========
// Open SQLite connection (shared)
const ichiDb = new sqlite3.Database(AHCI_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Failed to open ichi.db:', err.message);
  } else {
    console.log('Connected to ichi.db');
  }
});

// Utility: run a query that returns rows as a Promise
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
// IMPORTANT: Define specific routes BEFORE parameterized routes

// Search route FIRST
app.get('/ichi/search', async (req, res) => {
  try {
    console.log('Search endpoint called with query:', req.query); // Debug log
    
    const q = (req.query.q || '').trim();
    console.log('Search term:', q); // Debug log
    
    if (!q) return res.status(400).json({ error: 'Missing query parameter q' });

    // Use parameterized LIKE search; add wildcards
    const term = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    console.log('Processed term:', term); // Debug log
    
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);

    const sql = `SELECT Code, Title FROM ICHI
                 WHERE Title LIKE ? ESCAPE '\\'
                 ORDER BY Code
                 LIMIT ?`;
    console.log('SQL query:', sql); // Debug log
    
    const rows = await dbAll(ichiDb, sql, [term, limit]);
    console.log('Found rows:', rows.length); // Debug log

    res.json({
      query: q,
      count: rows.length,
      results: rows
    });
  } catch (err) {
    console.error('Error /ichi/search', err);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// Single code route SECOND
app.get('/ichi/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const sql = `SELECT Code, Title FROM ICHI WHERE Code = ? LIMIT 1`;
    const row = await dbGet(ichiDb, sql, [code]);

    if (!row) return res.status(404).json({ error: 'Code not found' });
    res.json(row);
  } catch (err) {
    console.error('Error /ichi/:code', err);
    res.status(500).json({ error: 'Failed to fetch code' });
  }
});

// List route THIRD
app.get('/ichi', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const sort = (req.query.sort === 'Title') ? 'Title' : 'Code';

    // Ensure only Code and Title are returned
    const sql = `SELECT Code, Title FROM ICHI
                 ORDER BY ${sort} LIMIT ? OFFSET ?`;
    const rows = await dbAll(ichiDb, sql, [limit, offset]);

    res.json({
      count: rows.length,
      limit,
      offset,
      results: rows
    });
  } catch (err) {
    console.error('Error /ichi:', err);
    res.status(500).json({ error: 'Failed to query AHCI database' });
  }
});

// ========== Appointment Routes ==========
// Serve HTML form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function to convert EHR data to FHIR
function convertEHRtoFHIR(ehrData) {
  // Map EHR status to FHIR status
  const statusMap = {
    'scheduled': 'booked',
    'confirmed': 'booked',
    'arrived': 'arrived',
    'completed': 'fulfilled',
    'cancelled': 'cancelled',
    'noshow': 'noshow',
    'pending': 'pending'
  };

  const fhirStatus = statusMap[ehrData.status] || 'booked';
  
  // Create FHIR Appointment
  const appointment = {
    resourceType: 'Appointment',
    id: `appt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: fhirStatus,
    serviceType: [{
      text: 'Medical Consultation'
    }],
    start: new Date(ehrData.startDateTime).toISOString(),
    end: new Date(ehrData.endDateTime).toISOString(),
    minutesDuration: parseInt(ehrData.duration) || 30,
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

  // Add diagnosis if provided
  if (ehrData.diagnosis) {
    appointment.reasonCode = [{
      text: ehrData.diagnosis
    }];
  }

  // Add priority if provided
  if (ehrData.priority) {
    appointment.priority = parseInt(ehrData.priority);
  }

  return appointment;
}

// New endpoint for web form submission
app.post('/book-appointment', async (req, res) => {
  try {
    console.log('Received EHR data:', req.body);

    // Convert EHR data to FHIR
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

    // Save to MongoDB
    const newAppointment = new Appointment({
      resourceType: fhirAppointment.resourceType,
      status: fhirAppointment.status,
      start: fhirAppointment.start,
      end: fhirAppointment.end,
      participants: fhirAppointment.participant,
      patientName: req.body.patientName,
      doctorName: req.body.doctorName,
      diagnosis: req.body.diagnosis,
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

// Endpoint for AMS clients to sync appointments
app.get('/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ start: -1 });
    res.json({
      count: appointments.length,
      appointments: appointments
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

// Optional: close DB on process exit
process.on('SIGINT', () => {
  ichiDb.close((err) => {
    if (err) console.error('Error closing ichi.db:', err.message);
    else console.log('Closed ichi.db');
    process.exit(0);
  });
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`AMS Server running on http://localhost:${PORT}`);
  console.log(`Web form available at http://localhost:${PORT}`);
  console.log(`ICHI endpoints available at:`);
  console.log(`  http://localhost:${PORT}/ichi`);
  console.log(`  http://localhost:${PORT}/ichi/search?q=appendicitis`);
  console.log(`  http://localhost:${PORT}/ichi/AA01`);
});