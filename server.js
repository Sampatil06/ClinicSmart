const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) throw new Error("ADMIN_PASSWORD and SESSION_SECRET are required.");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProduction ? { rejectUnauthorized: false } : false });

const schema = `
CREATE TABLE IF NOT EXISTS patients (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(80) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS medicines (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  prescription_no VARCHAR(40) NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS prescription_items (
  id BIGSERIAL PRIMARY KEY,
  prescription_id BIGINT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_name VARCHAR(120) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  instructions VARCHAR(300) NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS invoices (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  invoice_no VARCHAR(40) NOT NULL UNIQUE,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(80) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  preferred_date DATE NOT NULL,
  preferred_time VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/") || req.path === "/admin") res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "20kb" }));

const clean = (value, max) => typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, max) : "";
const id = (value) => /^\d+$/.test(String(value)) ? Number(value) : null;
const phone = (value) => typeof value === "string" ? value.replace(/\D/g, "").slice(0, 15) : "";
const sign = (value) => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
function readCookie(req, name) { const item = (req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith(name + "=")); return item ? decodeURIComponent(item.slice(name.length + 1)) : ""; }
function admin(req, res, next) {
  const [value, signature] = readCookie(req, "clinic_admin").split(".");
  if (!value || !signature || Buffer.byteLength(signature) !== Buffer.byteLength(sign(value)) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(value)))) return res.status(401).json({ error: "Sign in required." });
  try { if (JSON.parse(Buffer.from(value, "base64url").toString()).exp < Date.now()) throw Error(); next(); } catch { return res.status(401).json({ error: "Session expired." }); }
}
function sameOrigin(req, res, next) {
  if (!isProduction) return next();
  const expected = req.protocol + "://" + req.get("host");
  if (req.get("origin") !== expected) return res.status(403).json({ error: "Invalid request origin." });
  next();
}

app.post("/api/login", sameOrigin, (req, res) => {
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const expected = process.env.ADMIN_PASSWORD;
  if (password.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected))) return res.status(401).json({ error: "Invalid password." });
  const value = Buffer.from(JSON.stringify({ exp: Date.now() + 28800000 })).toString("base64url");
  res.setHeader("Set-Cookie", "clinic_admin=" + value + "." + sign(value) + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800" + (isProduction ? "; Secure" : ""));
  res.json({ ok: true });
});
app.post("/api/logout", admin, sameOrigin, (req, res) => { res.setHeader("Set-Cookie", "clinic_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/session", admin, (req, res) => res.json({ authenticated: true }));
app.post("/api/bookings", async (req, res, next) => { try { const name = clean(req.body.full_name, 80), mobile = phone(req.body.phone), date = clean(req.body.preferred_date, 10), preferredTime = clean(req.body.preferred_time, 40); if (name.length < 2 || mobile.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !preferredTime) return res.status(400).json({ error: "Enter valid booking details." }); await pool.query("INSERT INTO bookings(full_name,phone,preferred_date,preferred_time) VALUES($1,$2,$3,$4)", [name, mobile, date, preferredTime]); res.status(201).json({ message: "Booking request received." }); } catch (error) { next(error); } });
app.get("/api/bookings", admin, async (req, res, next) => { try { const result = await pool.query("SELECT id,full_name,phone,TO_CHAR(preferred_date,'YYYY-MM-DD') preferred_date,preferred_time,status FROM bookings ORDER BY created_at DESC LIMIT 100"); res.json({ bookings: result.rows }); } catch (error) { next(error); } });

app.get("/api/patients", admin, async (req, res, next) => { try { const result = await pool.query("SELECT id,full_name,phone,notes,created_at FROM patients ORDER BY full_name LIMIT 100"); res.json({ patients: result.rows }); } catch (error) { next(error); } });
app.post("/api/patients", admin, sameOrigin, async (req, res, next) => { try { const name = clean(req.body.full_name, 80), mobile = phone(req.body.phone), notes = clean(req.body.notes, 2000); if (name.length < 2 || mobile.length < 10) return res.status(400).json({ error: "Enter a valid patient name and phone." }); const result = await pool.query("INSERT INTO patients(full_name,phone,notes) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET full_name=EXCLUDED.full_name,notes=EXCLUDED.notes RETURNING id", [name, mobile, notes]); res.status(201).json({ id: result.rows[0].id }); } catch (error) { next(error); } });
app.get("/api/medicines", admin, async (req, res, next) => { try { const result = await pool.query("SELECT id,name FROM medicines ORDER BY name"); res.json({ medicines: result.rows }); } catch (error) { next(error); } });
app.post("/api/medicines", admin, sameOrigin, async (req, res, next) => { try { const name = clean(req.body.name, 120); if (!name) return res.status(400).json({ error: "Enter a medicine name." }); await pool.query("INSERT INTO medicines(name) VALUES($1)", [name]); res.status(201).json({ ok: true }); } catch (error) { if (error.code === "23505") return res.status(409).json({ error: "Medicine already exists." }); next(error); } });
app.delete("/api/medicines/:id", admin, sameOrigin, async (req, res, next) => { try { const medicineId = id(req.params.id); if (!medicineId) return res.status(400).json({ error: "Invalid medicine." }); await pool.query("DELETE FROM medicines WHERE id=$1", [medicineId]); res.json({ ok: true }); } catch (error) { next(error); } });
app.post("/api/prescriptions", admin, sameOrigin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const patientId = id(req.body.patient_id), notes = clean(req.body.notes, 2000), items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!patientId || !items.length) return res.status(400).json({ error: "Choose a patient and add medicine." });
    await client.query("BEGIN");
    const prescription = await client.query("INSERT INTO prescriptions(patient_id,prescription_no,notes) VALUES($1,$2,$3) RETURNING id,prescription_no", [patientId, "RX-" + Date.now(), notes]);
    for (const item of items) { const name = clean(item.name, 120), quantity = Number(item.quantity), instructions = clean(item.instructions, 300); if (!name || !Number.isFinite(quantity) || quantity <= 0) throw Error("Invalid prescription item."); await client.query("INSERT INTO prescription_items(prescription_id,medicine_name,quantity,instructions) VALUES($1,$2,$3,$4)", [prescription.rows[0].id, name, quantity, instructions]); }
    await client.query("COMMIT"); res.status(201).json({ id: prescription.rows[0].id, number: prescription.rows[0].prescription_no });
  } catch (error) { await client.query("ROLLBACK"); if (error.message === "Invalid prescription item.") return res.status(400).json({ error: error.message }); next(error); } finally { client.release(); }
});

app.use(express.static(path.join(__dirname, "public"), { index: false, dotfiles: "deny" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: "Something went wrong." }); });
pool.query(schema).then(() => app.listen(process.env.PORT || 3000, () => console.log("Clinic template started"))).catch(error => { console.error("Database setup failed", error); process.exit(1); });
