// server.js - Updated AMS server with web form support
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { Fhir } = require('fhir');
const path = require('path');

const app = express();
const fhir = new Fhir();

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/ams')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

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

const Appointment = mongoose.model('Appointment', appointmentSchema);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

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

// Existing endpoint to accept FHIR Appointment (direct FHIR clients)
app.post('/fhir/Appointment', async (req, res) => {
  try {
    const appointment = req.body;
    console.log('Direct FHIR Appointment received:', appointment);

    // Validate FHIR resource
    const result = fhir.validate(appointment);
    console.log('Validation result:', result);

    if (!result.valid) {
      console.log('Validation errors:', result.errors);
      return res.status(400).json({
        error: 'FHIR Validation Failed',
        details: result.errors,
        warnings: result.warnings
      });
    }

    // Extract participant names
    let patientName = '';
    let doctorName = '';
    
    if (appointment.participant) {
      appointment.participant.forEach(p => {
        if (p.actor && p.actor.display) {
          if (p.actor.reference && p.actor.reference.startsWith('Patient/')) {
            patientName = p.actor.display;
          } else if (p.actor.reference && p.actor.reference.startsWith('Practitioner/')) {
            doctorName = p.actor.display;
          }
        }
      });
    }

    // Save to MongoDB
    const newAppointment = new Appointment({
      resourceType: appointment.resourceType,
      status: appointment.status,
      start: appointment.start,
      end: appointment.end,
      participants: appointment.participant,
      patientName: patientName,
      doctorName: doctorName,
      diagnosis: appointment.reasonCode ? appointment.reasonCode[0]?.text : '',
      raw: appointment
    });

    await newAppointment.save();

    res.status(201).json({
      message: 'Appointment accepted',
      appointmentId: newAppointment._id
    });

  } catch (error) {
    console.error('Error saving FHIR appointment:', error);
    res.status(500).json({ error: 'Internal server error' });
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

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`AMS Server running on http://localhost:${PORT}`);
  console.log(`Web form available at http://localhost:${PORT}`);
});