const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) throw new Error("ADMIN_PASSWORD and SESSION_SECRET are required.");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProduction ? { rejectUnauthorized: false } : false });
const slots = new Set(["Morning", "Evening"]);
const locations = new Set(["Main Centre", "North Centre", "West Centre"]);
const bookingStatuses = new Set(["pending", "confirmed", "cancelled"]);

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
  description VARCHAR(300) NOT NULL DEFAULT '',
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description VARCHAR(300) NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(80) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  preferred_date DATE NOT NULL,
  preferred_time VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location VARCHAR(80) NOT NULL DEFAULT 'Main Centre';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'website';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS booking_blocks (
  id BIGSERIAL PRIMARY KEY,
  booking_date DATE NOT NULL,
  booking_end_date DATE NOT NULL,
  slot VARCHAR(40),
  location VARCHAR(80),
  reason VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_blocks_unique ON booking_blocks (booking_date, booking_end_date, COALESCE(slot, ''), COALESCE(location, ''));
`;

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
function validDate(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split("-").map(Number), date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; }
function localToday() { const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(); const part = type => parts.find(value => value.type === type).value; return `${part("year")}-${part("month")}-${part("day")}`; }
const bookingAttempts = new Map();
function limitBookings(req, res, next) { const now = Date.now(), key = req.ip || "unknown", attempts = (bookingAttempts.get(key) || []).filter(time => now - time < 900000); if (attempts.length >= 10) return res.status(429).json({ error: "Too many booking attempts. Please try again later." }); attempts.push(now); bookingAttempts.set(key, attempts); next(); }
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
app.post("/api/bookings", limitBookings, async (req, res, next) => { try { const name = clean(req.body.name, 80), mobile = phone(req.body.phone), date = clean(req.body.date, 10), slot = clean(req.body.slot, 40), location = clean(req.body.location, 80), website = clean(req.body.website, 100); if (website) return res.status(400).json({ error: "Unable to submit this booking." }); if (name.length < 2 || mobile.length < 10 || !validDate(date) || date < localToday() || !slots.has(slot) || !locations.has(location)) return res.status(400).json({ error: "Please provide valid booking details." }); const result = await pool.query("INSERT INTO bookings(full_name,phone,preferred_date,preferred_time,location) SELECT $1::varchar(80),$2::varchar(20),$3::date,$4::varchar(40),$5::varchar(80) WHERE NOT EXISTS (SELECT 1 FROM booking_blocks WHERE $3::date BETWEEN booking_date AND booking_end_date AND (slot IS NULL OR slot=$4::varchar(40)) AND (location IS NULL OR location=$5::varchar(80))) RETURNING id", [name, mobile, date, slot, location]); if (!result.rowCount) return res.status(409).json({ error: "The doctor is unavailable for this date, slot, or centre. Please choose another option." }); res.status(201).json({ message: "Booking request received." }); } catch (error) { next(error); } });
app.get("/api/bookings", admin, async (req, res, next) => { try { const values = [], where = []; if (validDate(req.query.from)) { values.push(req.query.from); where.push(`preferred_date >= $${values.length}`); } if (validDate(req.query.to)) { values.push(req.query.to); where.push(`preferred_date <= $${values.length}`); } if (locations.has(req.query.location)) { values.push(req.query.location); where.push(`location = $${values.length}`); } if (bookingStatuses.has(req.query.status)) { values.push(req.query.status); where.push(`status = $${values.length}`); } if (typeof req.query.q === "string" && req.query.q.trim()) { values.push(`%${req.query.q.trim().slice(0, 80)}%`); where.push(`full_name ILIKE $${values.length}`); } const filter = where.length ? `WHERE ${where.join(" AND ")}` : ""; const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1), limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25)), offset = (page - 1) * limit; const count = await pool.query(`SELECT COUNT(*) total FROM bookings ${filter}`, values); const result = await pool.query(`SELECT id,full_name,phone,TO_CHAR(preferred_date,'YYYY-MM-DD') preferred_date,preferred_time,location,status,source,notes FROM bookings ${filter} ORDER BY preferred_date,created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]); res.json({ bookings: result.rows, total: Number(count.rows[0].total), page, limit }); } catch (error) { next(error); } });
app.post("/api/bookings/admin", admin, sameOrigin, async (req, res, next) => { try { const name = clean(req.body.name, 80), mobile = phone(req.body.phone), date = clean(req.body.date, 10), slot = clean(req.body.slot, 40), location = clean(req.body.location, 80), notes = clean(req.body.notes, 1000); if (name.length < 2 || mobile.length < 10 || !validDate(date) || !slots.has(slot) || !locations.has(location)) return res.status(400).json({ error: "Please provide valid booking details." }); const result = await pool.query("INSERT INTO bookings(full_name,phone,preferred_date,preferred_time,location,source,notes) SELECT $1::varchar(80),$2::varchar(20),$3::date,$4::varchar(40),$5::varchar(80),'admin',$6::text WHERE NOT EXISTS (SELECT 1 FROM booking_blocks WHERE $3::date BETWEEN booking_date AND booking_end_date AND (slot IS NULL OR slot=$4::varchar(40)) AND (location IS NULL OR location=$5::varchar(80))) RETURNING id", [name, mobile, date, slot, location, notes]); if (!result.rowCount) return res.status(409).json({ error: "The doctor is unavailable for this date, slot, or centre." }); res.status(201).json({ ok: true }); } catch (error) { next(error); } });
app.patch("/api/bookings/:id", admin, sameOrigin, async (req, res, next) => { try { const bookingId = id(req.params.id), name = clean(req.body.name, 80), mobile = phone(req.body.phone), date = clean(req.body.date, 10), slot = clean(req.body.slot, 40), location = clean(req.body.location, 80), status = clean(req.body.status, 20), notes = clean(req.body.notes, 1000); if (!bookingId || name.length < 2 || mobile.length < 10 || !validDate(date) || !slots.has(slot) || !locations.has(location) || !bookingStatuses.has(status)) return res.status(400).json({ error: "Please provide valid booking details." }); const result = await pool.query("UPDATE bookings SET full_name=$2::varchar(80),phone=$3::varchar(20),preferred_date=$4::date,preferred_time=$5::varchar(40),location=$6::varchar(80),status=$7::varchar(20),notes=$8::text WHERE id=$1::bigint AND NOT EXISTS (SELECT 1 FROM booking_blocks WHERE $4::date BETWEEN booking_date AND booking_end_date AND (slot IS NULL OR slot=$5::varchar(40)) AND (location IS NULL OR location=$6::varchar(80))) RETURNING id", [bookingId, name, mobile, date, slot, location, status, notes]); if (!result.rowCount) return res.status(409).json({ error: "The doctor is unavailable for this date, slot, or centre." }); res.json({ ok: true }); } catch (error) { next(error); } });
app.delete("/api/bookings/:id", admin, sameOrigin, async (req, res, next) => { try { const bookingId = id(req.params.id); if (!bookingId) return res.status(400).json({ error: "Invalid booking." }); await pool.query("DELETE FROM bookings WHERE id=$1", [bookingId]); res.json({ ok: true }); } catch (error) { next(error); } });
app.get("/api/booking-blocks", admin, async (req, res, next) => { try { const result = await pool.query("SELECT id,TO_CHAR(booking_date,'YYYY-MM-DD') booking_date,TO_CHAR(booking_end_date,'YYYY-MM-DD') booking_end_date,slot,location,reason FROM booking_blocks ORDER BY booking_date,location NULLS FIRST,slot NULLS FIRST"); res.json({ blocks: result.rows }); } catch (error) { next(error); } });
app.post("/api/booking-blocks", admin, sameOrigin, async (req, res, next) => { try { const date = clean(req.body.date, 10), endDate = clean(req.body.endDate || req.body.date, 10), slot = clean(req.body.slot, 40) || null, location = clean(req.body.location, 80) || null, reason = clean(req.body.reason, 200); if (!validDate(date) || !validDate(endDate) || endDate < date || (slot && !slots.has(slot)) || (location && !locations.has(location))) return res.status(400).json({ error: "Please select a valid date range and availability details." }); await pool.query("INSERT INTO booking_blocks(booking_date,booking_end_date,slot,location,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [date, endDate, slot, location, reason]); res.status(201).json({ ok: true }); } catch (error) { next(error); } });
app.delete("/api/booking-blocks/:id", admin, sameOrigin, async (req, res, next) => { try { const blockId = id(req.params.id); if (!blockId) return res.status(400).json({ error: "Invalid block." }); await pool.query("DELETE FROM booking_blocks WHERE id=$1", [blockId]); res.json({ ok: true }); } catch (error) { next(error); } });

app.get("/api/patients", admin, async (req, res, next) => { try { const result = await pool.query("SELECT id,full_name,phone,notes,created_at FROM patients ORDER BY full_name LIMIT 100"); res.json({ patients: result.rows }); } catch (error) { next(error); } });
app.post("/api/patients", admin, sameOrigin, async (req, res, next) => { try { const name = clean(req.body.full_name, 80), mobile = phone(req.body.phone), notes = clean(req.body.notes, 2000); if (name.length < 2 || mobile.length < 10) return res.status(400).json({ error: "Enter a valid patient name and phone." }); const result = await pool.query("INSERT INTO patients(full_name,phone,notes) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET full_name=EXCLUDED.full_name,notes=EXCLUDED.notes RETURNING id", [name, mobile, notes]); res.status(201).json({ id: result.rows[0].id }); } catch (error) { next(error); } });
app.get("/api/medicines", admin, async (req, res, next) => { try { const result = await pool.query("SELECT id,name FROM medicines ORDER BY name"); res.json({ medicines: result.rows }); } catch (error) { next(error); } });
app.get("/api/invoices", admin, async (req, res, next) => { try { const result = await pool.query("SELECT i.id,i.invoice_no,i.description,i.total,TO_CHAR(i.created_at,'YYYY-MM-DD') created_at,p.full_name,p.phone FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY i.created_at DESC LIMIT 100"); res.json({ invoices: result.rows }); } catch (error) { next(error); } });
app.post("/api/invoices", admin, sameOrigin, async (req, res, next) => { try { const patientId = id(req.body.patient_id), description = clean(req.body.description, 300), total = Number(req.body.total); if (!patientId || !Number.isFinite(total) || total < 0 || total > 99999999) return res.status(400).json({ error: "Choose a patient and enter a valid total." }); const result = await pool.query("INSERT INTO invoices(patient_id,invoice_no,description,total) VALUES($1,$2,$3,$4) RETURNING id,invoice_no", [patientId, "INV-" + Date.now(), description, total]); res.status(201).json({ id: result.rows[0].id, number: result.rows[0].invoice_no }); } catch (error) { if (error.code === "23503") return res.status(400).json({ error: "Selected patient does not exist." }); next(error); } });
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
