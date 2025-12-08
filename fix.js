// fixMissingCodes.js
const sqlite3 = require('sqlite3').verbose();

// open your database
const db = new sqlite3.Database('ichi.db');

// function to detect and fix missing codes
function fixCodes() {
  db.serialize(() => {
    // Step 1: read all rows
    db.all("SELECT id, code, title FROM ICHI", [], (err, rows) => {
      if (err) {
        console.error(err);
        return;
      }

      rows.forEach(row => {
        // Example: code = "HFA", title = "Interventions on endocardium"
        // We want to check if there is a parent row with same prefix and longer code
        if (/^[A-Z]+\d*$/.test(row.code)) {
          // find parent with same prefix
          const parent = rows.find(r =>
            r.title.includes(row.title) &&
            r.code.startsWith(row.code) &&
            r.code !== row.code
          );

          if (parent) {
            // Derive corrected code: take parent prefix up to dot
            const correctedCode = parent.code.split('.').slice(0, 2).join('.');
            console.log(`Fixing ${row.code} (${row.title}) -> ${correctedCode}`);

            db.run("UPDATE ICHI SET code = ? WHERE id = ?", [correctedCode, row.id], err2 => {
              if (err2) console.error(err2);
            });
          }
        }
      });
    });
  });
}

fixCodes();
