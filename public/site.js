const form = document.querySelector("#bookingForm"), message = document.querySelector("#bookingMessage"), dialog = document.querySelector("#bookingSuccess");
const today = new Date();
const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
if (form) form.elements.date.min = localDate;
document.querySelector("#closeBookingSuccess")?.addEventListener("click", () => dialog?.close());
dialog?.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
form?.addEventListener("submit", async event => {
  event.preventDefault(); message.textContent = ""; message.className = "";
  const button = form.querySelector("button"), data = Object.fromEntries(new FormData(form));
  if (data.website) return;
  if (data.name.trim().length < 2 || data.phone.replace(/\D/g, "").length < 10 || !data.date || data.date < localDate || !data.slot || !data.location) { message.textContent = "Please enter valid appointment details."; return; }
  button.disabled = true;
  try { const response = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), result = await response.json().catch(() => ({})); if (!response.ok) throw Error(result.error || "Unable to send request."); form.reset(); dialog?.showModal(); } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
});
