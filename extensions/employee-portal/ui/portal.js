const apiBase = '/api/ext/employee-portal';
const token = window.localStorage.getItem('atlasToken') || window.localStorage.getItem('ATLAS_TOKEN') || '';

function headers() {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

async function loadTickets() {
  const host = document.getElementById('ticketList');
  host.innerHTML = '<p>Loading requests...</p>';
  try {
    const res = await fetch(`${apiBase}/tickets`, { headers: headers() });
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    host.innerHTML = rows.length ? rows.map((row) => `
      <article class="ticket-card">
        <div>
          <strong>${row.RequestNo} - ${row.Destination}</strong>
          <span>${formatDate(row.TravelFromDate)} / ${row.CabinClass} / BHD ${Number(row.EstimatedCostBHD || 0).toFixed(2)}</span>
        </div>
        <span class="status">${row.ApprovalStatus}</span>
      </article>
    `).join('') : '<p>No ticket requests found.</p>';
  } catch (error) {
    host.innerHTML = `<p>${error.message || 'Unable to load requests.'}</p>`;
  }
}

document.getElementById('ticketForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.estimatedCostBHD = Number(payload.estimatedCostBHD || 0);
  const res = await fetch(`${apiBase}/tickets`, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
  if (!res.ok) {
    alert(`Ticket request failed: ${await res.text()}`);
    return;
  }
  event.currentTarget.reset();
  await loadTickets();
});

document.getElementById('refreshTickets').addEventListener('click', loadTickets);
document.getElementById('printContract').addEventListener('click', () => window.print());
void loadTickets();
