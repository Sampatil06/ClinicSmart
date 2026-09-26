const $ = selector => document.querySelector(selector);
let patients = [], medicines = [], prescriptionItems = [], bookingPage = 1;

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "Request failed.");
  return data;
}
function message(text, success = false) { const target = $("#message"); target.textContent = text; target.classList.toggle("success", success); }
function addText(parent, tag, text) { const item = document.createElement(tag); item.textContent = text; parent.append(item); return item; }
function patientOptions() { return '<option value="">Choose patient</option>' + patients.map(patient => `<option value="${patient.id}">${patient.full_name}</option>`).join(""); }
function monthFilter() { const now = new Date(), from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to = `${now.getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`; $("#filterFrom").value = from; $("#filterTo").value = to; }

async function loadBookings(page = bookingPage) {
  bookingPage = page;
  const query = new URLSearchParams({ page: String(page), limit: "25" });
  [["q", "#filterName"], ["from", "#filterFrom"], ["to", "#filterTo"], ["location", "#filterLocation"], ["status", "#filterStatus"]].forEach(([key, selector]) => { if ($(selector).value) query.set(key, $(selector).value); });
  const { bookings, total, limit } = await api(`/api/bookings?${query}`), body = $("#bookingRows");
  body.replaceChildren();
  if (!bookings.length) { const row = document.createElement("tr"), cell = document.createElement("td"); cell.colSpan = 8; cell.textContent = "No bookings found."; row.append(cell); body.append(row); }
  bookings.forEach(booking => {
    const row = document.createElement("tr");
    [booking.preferred_date, booking.full_name, booking.phone, booking.preferred_time, booking.location, booking.source, booking.status].forEach(value => addText(row, "td", value));
    const actions = document.createElement("td"), edit = document.createElement("button"), remove = document.createElement("button");
    edit.type = remove.type = "button"; edit.textContent = "Edit"; remove.textContent = "Delete"; remove.className = "danger";
    edit.onclick = () => openEdit(booking); remove.onclick = async () => { if (!confirm(`Delete booking for ${booking.full_name}?`)) return; try { await api(`/api/bookings/${booking.id}`, { method: "DELETE" }); await loadBookings(bookingPage); message("Booking deleted.", true); } catch (error) { message(error.message); } };
    actions.append(edit, remove); row.append(actions); body.append(row);
  });
  const pages = Math.max(1, Math.ceil(total / limit)); $("#pageInfo").textContent = `Page ${bookingPage} of ${pages} (${total} bookings)`; $("#previousPage").disabled = bookingPage <= 1; $("#nextPage").disabled = bookingPage >= pages;
}
async function loadBlocks() {
  const { blocks } = await api("/api/booking-blocks"), list = $("#blockList"); list.replaceChildren();
  if (!blocks.length) addText(list, "li", "No blocked availability.");
  blocks.forEach(block => { const item = document.createElement("li"), text = document.createElement("span"), button = document.createElement("button"), range = block.booking_date === block.booking_end_date ? block.booking_date : `${block.booking_date} to ${block.booking_end_date}`; text.textContent = `${range} — ${block.slot || "All slots"} · ${block.location || "All centres"}${block.reason ? ` — ${block.reason}` : ""}`; button.type = "button"; button.textContent = "Unblock"; button.onclick = async () => { try { await api(`/api/booking-blocks/${block.id}`, { method: "DELETE" }); await loadBlocks(); message("Availability unblocked.", true); } catch (error) { message(error.message); } }; item.append(text, button); list.append(item); });
}
async function loadClinicData() {
  const [patientResponse, medicineResponse, invoiceResponse] = await Promise.all([api("/api/patients"), api("/api/medicines"), api("/api/invoices")]);
  patients = patientResponse.patients; medicines = medicineResponse.medicines;
  const patientList = $("#patientList"), medicineList = $("#medicineList"), invoiceList = $("#invoiceList"); patientList.replaceChildren(); medicineList.replaceChildren(); invoiceList.replaceChildren();
  patients.forEach(patient => { const item = document.createElement("li"); item.innerHTML = `<b></b><br>`; item.querySelector("b").textContent = patient.full_name; item.append(document.createTextNode(patient.phone)); patientList.append(item); });
  medicines.forEach(medicine => { const item = document.createElement("li"), button = document.createElement("button"); item.append(document.createTextNode(medicine.name + " ")); button.type = "button"; button.textContent = "Remove"; button.onclick = async () => { try { await api(`/api/medicines/${medicine.id}`, { method: "DELETE" }); await loadClinicData(); } catch (error) { message(error.message); } }; item.append(button); medicineList.append(item); });
  invoiceResponse.invoices.forEach(invoice => { const item = document.createElement("li"); addText(item, "b", `${invoice.invoice_no} — ₹${Number(invoice.total).toFixed(2)}`); item.append(document.createElement("br"), document.createTextNode(`${invoice.full_name} · ${invoice.created_at}`), document.createElement("br"), document.createTextNode(invoice.description || "No description")); invoiceList.append(item); });
  if (!invoiceResponse.invoices.length) addText(invoiceList, "li", "No invoices yet.");
  $("#prescriptionPatient").innerHTML = patientOptions(); $("#invoicePatient").innerHTML = patientOptions(); $("#prescriptionMedicine").innerHTML = '<option value="">Choose medicine</option>' + medicines.map(medicine => `<option value="${medicine.id}">${medicine.name}</option>`).join("");
}
async function loadAll() { await Promise.all([loadBookings(), loadBlocks(), loadClinicData()]); }
function openEdit(booking) { const form = $("#editBookingForm"); ["id", "name", "phone", "date", "slot", "location", "status", "notes"].forEach(field => { const key = { name: "full_name", phone: "phone", date: "preferred_date", slot: "preferred_time" }[field] || field; form.elements[field].value = booking[key] || ""; }); form.dataset.previousStatus = booking.status; $("#editBooking").showModal(); }

$("#loginForm").onsubmit = async event => { event.preventDefault(); try { await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) }); $("#login").hidden = true; $("#app").hidden = false; $("#logout").hidden = false; monthFilter(); await loadAll(); } catch (error) { $("#error").textContent = error.message; } };
$("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); location.reload(); };
document.querySelectorAll(".nav").forEach(button => button.onclick = () => document.querySelectorAll(".nav,.pane").forEach(item => item.classList.toggle("active", item.dataset.pane === button.dataset.pane)));
$("#bookingFilters").onsubmit = event => { event.preventDefault(); loadBookings(1).catch(error => message(error.message)); };
$("#previousPage").onclick = () => loadBookings(bookingPage - 1).catch(error => message(error.message)); $("#nextPage").onclick = () => loadBookings(bookingPage + 1).catch(error => message(error.message));
$("#manualBookingForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { await api("/api/bookings/admin", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadBookings(); message("Booking added.", true); } catch (error) { message(error.message); } };
$("#blockForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { await api("/api/booking-blocks", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadBlocks(); message("Availability blocked.", true); } catch (error) { message(error.message); } };
$("#cancelEdit").onclick = () => $("#editBooking").close();
$("#editBookingForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form)); try { await api(`/api/bookings/${data.id}`, { method: "PATCH", body: JSON.stringify(data) }); $("#editBooking").close(); await loadBookings(bookingPage); message("Booking updated.", true); } catch (error) { message(error.message); } };
$("#patientForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { await api("/api/patients", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadClinicData(); message("Patient saved.", true); } catch (error) { message(error.message); } };
$("#medicineForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { await api("/api/medicines", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadClinicData(); message("Medicine added.", true); } catch (error) { message(error.message); } };
$("#invoiceForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { const result = await api("/api/invoices", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await loadClinicData(); message(`Invoice ${result.number} created.`, true); } catch (error) { message(error.message); } };
$("#addItem").onclick = () => { const select = $("#prescriptionMedicine"), name = select.options[select.selectedIndex]?.text, quantity = $("#prescriptionQuantity").value, instructions = $("#prescriptionInstructions").value; if (!select.value) return; prescriptionItems.push({ name, quantity, instructions }); $("#prescriptionItems").replaceChildren(...prescriptionItems.map(item => { const row = document.createElement("li"); row.textContent = `${item.name} — ${item.quantity} unit(s) — ${item.instructions}`; return row; })); };
$("#prescriptionForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; try { await api("/api/prescriptions", { method: "POST", body: JSON.stringify({ patient_id: form.patient_id.value, notes: form.notes.value, items: prescriptionItems }) }); prescriptionItems = []; form.reset(); $("#prescriptionItems").replaceChildren(); message("Prescription created.", true); } catch (error) { message(error.message); } };
api("/api/session").then(async () => { $("#login").hidden = true; $("#app").hidden = false; $("#logout").hidden = false; monthFilter(); await loadAll(); }).catch(() => {});
