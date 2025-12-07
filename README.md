# 🏥 AMS Server (Anesthesia Management System)

An Express.js + MongoDB + SQLite server for managing medical appointments and browsing WHO ICHI (International Classification of Health Interventions) codes.  
Supports HTTPS with mkcert, FHIR validation, and RESTful API endpoints for both appointments and ICHI search.

---

## ✨ Features
- **FHIR-compliant Appointment booking** with validation using the `fhir` Node module.
- **MongoDB storage** of appointments, including diagnosis and procedure codes.
- **ICHI code search** backed by SQLite database (`ichi.db`).
- **HTTPS support** using mkcert certificates.
- **REST API endpoints** for appointments and ICHI browsing.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (>= 18)
- MongoDB (local or remote)
- SQLite3
- mkcert (for local HTTPS certificates)

### Installation
```bash
git clone https://github.com/your-org/ams-server.git
cd ams-server
npm install
Certificates
Generate local certificates with mkcert:

bash
mkcert localhost 127.0.0.1 ::1
Place the generated .pem files in the project root.

Run Server
bash
node server.js ```
By default:

HTTPS server runs on https://localhost:443

HTTP server on port 80 redirects to HTTPS

📖 API Documentation
ICHI Endpoints
Search ICHI codes
Code
GET /ichi/search?q={term}&limit={n}
Search titles by keyword.

Returns cleaned Title and Code.

Get single ICHI code
Code
GET /ichi/:code
Retrieve details for a specific code.

List ICHI codes
Code
GET /ichi?limit={n}&offset={m}&sort={field}
Paginated list of codes.

Sort by Code or Title.

Appointment Endpoints
Book appointment
Code
POST /book-appointment
Create a new appointment.

Converts EHR payload to FHIR, validates, and stores in MongoDB.

Request Body Example:
```bash
json
{
  "patientId": "P001",
  "patientName": "မောင်သူရိန်လင်း",
  "doctorId": "DOC001",
  "doctorName": "Dr. Aung Ko Win",
  "diagnosis": "Percutaneous drainage of appendix",
  "procedureCode": "KBO.JB.AE",
  "duration": "45",
  "startDateTime": "2025-12-08T10:07",
  "endDateTime": "2025-12-08T10:52",
  "priority": "2",
  "status": "scheduled",
  "notes": "RLQ pain, fever, nausea..."
}```
List appointments
Code
GET /appointments
Retrieve all appointments, sorted by start date descending.

Get single appointment
Code
GET /appointments/:id
Retrieve a specific appointment by MongoDB _id.

🛠️ Tech Stack
Express.js – REST API framework

MongoDB + Mongoose – Appointment storage

SQLite3 – ICHI code database

FHIR Node module – Validation of FHIR resources

mkcert + HTTPS – Secure local development

📌 Notes
Replace http://who.int/ICHI with the official ICHI URI if available.

Titles in /ichi/search are cleaned of leading dashes/spaces.

Run with sudo if binding to port 443, or change to 8443 for non-root use.

📄 License
MIT License. 
