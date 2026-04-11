const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const SQL_FILE = path.join(ROOT, 'sql', 'peliculas.sql');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'ultrapelis.db');

if (!fs.existsSync(SQL_FILE)) {
  throw new Error(`No existe el archivo SQL base: ${SQL_FILE}`);
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sqlText = fs.readFileSync(SQL_FILE, 'utf8');
const db = new Database(DB_FILE);
db.exec(sqlText);
db.close();

console.log(`Base de datos reiniciada en ${DB_FILE}`);
