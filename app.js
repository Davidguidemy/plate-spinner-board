const API = "https://hnftwdtweskexxezdjql.supabase.co/functions/v1/plate-spinner";
const board = document.getElementById("board");
const counts = document.getElementById("counts");
const drawer = document.getElementById("drawer");
const turnSelect = document.getElementById("turn-select");
const turnView = document.getElementById("turn-view");
const addDialog = document.getElementById("add-dialog");
const addForm = document.getElementById("add-form");
const gate = document.getElementById("gate");
const gateForm = document.getElementById("gate-form");

let source = "";
let openId = null;
let token = sessionStorage.getItem("plate-token") || new URLSearchParams(location.search).get("token") || "";

function headers() {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...headers(), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    gate.hidden = false;
    throw new Error("unauthorized");
  }
  return res;
}

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function card(plate) {
  const el = document.createElement("button");
  el.className = "card";
  el.type = "button";
  el.dataset.status = plate.status;
  el.innerHTML = `
    <div class="meta">
      <span>${plate.source}</span>
      <span>${plate.action_required ?? relTime(plate.last_turn_at)}</span>
    </div>
    <h3>${escapeHtml(plate.chat_name)}</h3>
    <p class="summary">${escapeHtml(plate.last_summary || plate.task)}</p>
  `;
  el.addEventListener("click", () => openPlate(plate.id));
  return el;
}

function render(plates) {
  const groups = { running: [], stale: [], needs_you: [], done: [] };
  for (const p of plates) groups[p.status]?.push(p);
  counts.innerHTML = `
    <span>${groups.running.length} spinning</span>
    <span>${groups.stale.length} stale</span>
    <span>${groups.needs_you.length} need you</span>
  `;
  for (const col of board.querySelectorAll(".col")) {
    const key = col.dataset.col;
    const wrap = col.querySelector(".cards");
    wrap.innerHTML = "";
    if (!groups[key].length) {
      wrap.innerHTML = `<p class="empty">None</p>`;
      continue;
    }
    for (const p of groups[key]) wrap.append(card(p));
  }
}

async function refresh() {
  if (!token) {
    gate.hidden = false;
    return;
  }
  const q = source ? `?source=${source}` : "";
  const res = await api(`/api/plates${q}`);
  const data = await res.json();
  gate.hidden = true;
  render(data.plates);
  if (openId) {
    const still = data.plates.find((p) => p.id === openId);
    if (still) await openPlate(openId, true);
  }
}

async function openPlate(id, silent = false) {
  openId = id;
  const keepTurnId = silent ? turnSelect.value : null;
  const res = await api(`/api/plates/${id}`);
  const { plate, turns } = await res.json();
  drawer.hidden = false;
  document.getElementById("d-kicker").textContent =
    `${plate.source} · ${plate.status.replace("_", " ")} · ${plate.turn_count} turns`;
  document.getElementById("d-name").textContent = plate.chat_name;
  document.getElementById("d-task").textContent = plate.task;
  document.getElementById("d-outcome").textContent = `Outcome: ${plate.intended_outcome}`;

  if (!turns.length) {
    turnSelect.innerHTML = `<option>No turns yet</option>`;
    turnView.textContent = "Waiting for the first plate_turn write.";
  } else {
    const shown = turns.find((t) => t.id === keepTurnId) ?? turns.at(-1);
    turnSelect.innerHTML = turns
      .map(
        (t) =>
          `<option value="${t.id}" ${t.id === shown.id ? "selected" : ""}>Turn ${t.turn_index} · ${relTime(t.created_at)}</option>`,
      )
      .join("");
    showTurn(shown);
  }
  turnSelect.onchange = () => {
    const t = turns.find((x) => x.id === turnSelect.value);
    if (t) showTurn(t);
  };

  const actions = document.getElementById("d-actions");
  actions.innerHTML = "";
  const buttons = [
    ["Mark needs you", { status: "needs_you" }],
    ["Resume", { status: "running", action_required: "resumed" }],
    ["Mark done", { status: "done" }],
  ];
  for (const [label, body] of buttons) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", async () => {
      await api(`/api/plates/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      refresh();
    });
    actions.append(b);
  }
  if (plate.locator) {
    const loc = document.createElement("p");
    loc.className = "outcome";
    loc.textContent = plate.locator;
    actions.prepend(loc);
  }
  if (!silent) drawer.scrollTop = 0;
}

function showTurn(turn) {
  const extra = turn.action_required ? ` Need: ${turn.action_required}.` : "";
  turnView.textContent = `Turn ${turn.turn_index}. ${turn.summary}${extra}`;
}

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("is-on"));
    btn.classList.add("is-on");
    source = btn.dataset.source;
    refresh();
  });
});

document.getElementById("drawer-close").addEventListener("click", () => {
  drawer.hidden = true;
  openId = null;
});

document.getElementById("add-btn").addEventListener("click", () => addDialog.showModal());

addForm.addEventListener("submit", async (e) => {
  if (e.submitter?.id !== "add-save") return;
  e.preventDefault();
  const fd = new FormData(addForm);
  const body = Object.fromEntries(fd.entries());
  if (!body.locator) delete body.locator;
  await api("/api/plates/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  addDialog.close();
  addForm.reset();
  refresh();
});

gateForm.addEventListener("submit", (e) => {
  e.preventDefault();
  token = new FormData(gateForm).get("token");
  sessionStorage.setItem("plate-token", token);
  refresh().catch(() => {});
});

refresh().catch(() => {});
setInterval(() => {
  if (token) refresh().catch(() => {});
}, 2500);
