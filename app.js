const board = document.getElementById("board");
const counts = document.getElementById("counts");
const drawer = document.getElementById("drawer");
const turnSelect = document.getElementById("turn-select");
const turnView = document.getElementById("turn-view");
const addDialog = document.getElementById("add-dialog");
const addForm = document.getElementById("add-form");

let source = "";
let openId = null;
let detailRequest = 0;
let refreshRequest = 0;
let actionPending = false;
const gate = document.getElementById("gate");
let token = gate ? sessionStorage.getItem("plate-token") || "" : "";
if (gate) {
  const url = new URL(location.href);
  token = url.searchParams.get("token") || token;
  if (token) sessionStorage.setItem("plate-token", token);
  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    history.replaceState(null, "", url);
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${window.ATTENTION_API_URL || ""}${path}`, {
    ...options,
    headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...options.headers},
  });
  if (response.status === 401 && gate) gate.hidden = false;
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response;
}
function showError(error) {
  document.getElementById("board-error").textContent = error.message || "Unable to update the board. Please retry.";
}
function closeDrawer() {
  drawer.hidden = true;
  openId = null;
  detailRequest++;
}


function relTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(Math.abs(diff) / 60000);
  const future = diff < 0;
  if (min < 1) return future ? "in <1m" : "just now";
  if (min < 60) return future ? `in ${min}m` : `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return future ? `in ${hr}h` : `${hr}h ago`;
  const days = Math.round(hr / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function triggerText(p) {
  if (p.next_attention_at) return `Returns ${relTime(p.next_attention_at)}`;
  if (p.next_attention_condition) return p.next_attention_condition;
  return "";
}

function card(p) {
  const el = document.createElement("button");
  el.className = "card";
  el.type = "button";
  el.dataset.status = p.risk_signal ? "stale" : p.attention_state;
  el.innerHTML = `
    <div class="meta">
      <span>${esc(p.source)}</span>
      <span>${esc(p.attention_state === "done" ? `Finished ${relTime(p.finished_at)}${p.finish_time_estimated ? " (estimated)" : ""}` : p.risk_signal || triggerText(p) || relTime(p.last_turn_at))}</span>
    </div>
    <h3>${esc(p.chat_name)}</h3>
    <p class="summary">${esc(p.last_summary || p.task)}</p>
    ${p.next_step ? `<p class="summary">Next: ${esc(p.next_step)}</p>` : ""}
  `;
  el.addEventListener("click", () => openPlate(p.id).catch(showError));
  return el;
}

function render(plates) {
  const active = plates.filter((p) => p.attention_state !== "done");
  const groups = {
    now: active.filter((p) => p.attention_state === "now"),
    review: active.filter((p) => p.attention_state === "review"),
    working: active.filter((p) => p.attention_state === "working" && !p.risk_signal),
    waiting: active.filter((p) => ["waiting", "sleeping"].includes(p.attention_state) && !p.risk_signal),
    risk: active.filter((p) => p.risk_signal),
    done: plates.filter(p => p.attention_state === "done" && !p.acknowledged_at && p.source !== "linear")
      .sort((a,b) => new Date(b.finished_at) - new Date(a.finished_at) || a.id.localeCompare(b.id)),
  };

  counts.innerHTML = `
    <span>${groups.now.length} need me</span>
    <span>${groups.review.length} review</span>
    <span>${groups.risk.length} at risk</span>
    <span>${groups.done.length} done to process</span>
  `;

  for (const col of board.querySelectorAll(".col")) {
    const key = col.dataset.col;
    const wrap = col.querySelector(".cards");
    wrap.innerHTML = "";
    if (!groups[key]?.length) {
      wrap.innerHTML = `<p class="empty">None</p>`;
      continue;
    }
    for (const p of groups[key]) wrap.append(card(p));
  }
}

async function refresh() {
  if (gate && !token) { gate.hidden = false; return; }
  const request = ++refreshRequest;
  const q = source ? `?source=${encodeURIComponent(source)}` : "";
  const res = await api(`/api/plates${q}`);
  const data = await res.json();
  if (request !== refreshRequest) return;
  if (gate) gate.hidden = true;
  document.getElementById("board-error").textContent = "";
  render(data.plates);
  if (openId && !actionPending) {
    if (data.plates.some(p => p.id === openId)) await openPlate(openId, true);
    else closeDrawer();
  }
}

async function openPlate(id, silent = false) {
  if (actionPending) return;
  openId = id;
  const request = ++detailRequest;
  const res = await api(`/api/plates/${encodeURIComponent(id)}`);
  const { plate, turns } = await res.json();
  if (request !== detailRequest || openId !== id || actionPending) return;
  drawer.hidden = false;
  if (!silent) document.getElementById("d-error").textContent = "";
  document.getElementById("d-kicker").textContent =
    `${plate.source} · ${plate.attention_state} · ${plate.turn_count} turns${plate.risk_signal ? ` · ${plate.risk_signal}` : ""}`;
  document.getElementById("d-name").textContent = plate.chat_name;
  document.getElementById("d-task").textContent = plate.task;
  document.getElementById("d-outcome").textContent = `Outcome: ${plate.intended_outcome}`;
  document.getElementById("d-next").textContent = plate.attention_state === "done"
    ? "Ready to process. Open the source, then mark done when you have finished."
    : `Next: ${plate.next_step || "—"} · Actor: ${plate.next_actor}`;
  document.getElementById("d-trigger").textContent = plate.attention_state === "done"
    ? `Finished: ${new Date(plate.finished_at).toLocaleString()}${plate.finish_time_estimated ? " (estimated from historical records)" : ""}`
    : plate.next_attention_at
    ? `Return: ${new Date(plate.next_attention_at).toLocaleString()}`
    : plate.next_attention_condition ? `Return when: ${plate.next_attention_condition}` : "";

  const previousTurn = silent ? turnSelect.value : null;
  turnSelect.innerHTML = turns.map((t, i) =>
    `<option value="${t.id}" ${i === turns.length - 1 ? "selected" : ""}>Turn ${t.turn_index} · ${relTime(t.created_at)}</option>`).join("");
  if (!turns.length) {
    turnSelect.innerHTML = `<option>No turns yet</option>`;
    turnView.textContent = "Waiting for the first update.";
  } else {
    if (previousTurn && turns.some(t => t.id === previousTurn)) turnSelect.value = previousTurn;
    showTurn(turns.find(t => t.id === turnSelect.value) || turns.at(-1));
  }
  turnSelect.onchange = () => {
    const t = turns.find((x) => x.id === turnSelect.value);
    if (t) showTurn(t);
  };

  const actions = document.getElementById("d-actions");
  actions.innerHTML = "";
  const buttons = plate.source === "linear" ? [] : plate.attention_state === "done" ? [
    ["Mark done", {expected_finished_at: plate.finished_at, expected_completion_version: plate.completion_version}, "acknowledge"],
    ["Resume agent", {attention_state:"working",next_actor:"agent",status:"running",action_required:"resumed"}],
  ] : [
    ["Needs me", { attention_state: "now", next_actor: "david", human_action_required: "Review and decide next action", next_step: "Review this item" }],
    ["Review", { attention_state: "review", next_actor: "david", human_action_required: "Review completed work" }],
    ["Resume agent", { attention_state: "working", next_actor: "agent", status: "running", action_required: "resumed" }],
    ["Finish work", { attention_state: "done", status: "done" }],
  ];
  for (const [label, body, action] of buttons) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", async () => {
      if (actionPending) return;
      actionPending = true;
      detailRequest++;
      actions.querySelectorAll("button").forEach(button => button.disabled = true);
      b.textContent = "Saving…";
      document.getElementById("d-error").textContent = "";
      try {
        await api(`/api/plates/${encodeURIComponent(id)}${action ? `/${action}` : ""}`, {
          method: action ? "POST" : "PATCH",
          headers: {"content-type":"application/json"},
          body: JSON.stringify(body),
        });
        if (action === "acknowledge" && openId === id) closeDrawer();
        actionPending = false;
        await refresh();
      } catch (error) {
        if (openId === id) document.getElementById("d-error").textContent = error.message;
        else showError(error);
      } finally {
        actionPending = false;
        actions.querySelectorAll("button").forEach(button => button.disabled = false);
        b.textContent = label;
      }
    });
    actions.append(b);
  }
  if (plate.locator && /^(https?:|codex:|cursor:)/i.test(plate.locator)) {
    const link = document.createElement("a");
    link.className = "outcome";
    link.href = plate.locator;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open source work";
    actions.prepend(link);
  } else {
    const missing = document.createElement("p");
    missing.className = "outcome";
    missing.textContent = "No source link recorded for this chat.";
    actions.prepend(missing);
  }
  if (plate.linear_issue) {
    const issue = document.createElement("p");
    issue.className = "outcome";
    issue.textContent = `Linear: ${plate.linear_issue}`;
    actions.prepend(issue);
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
    refresh().catch(showError);
  });
});

document.getElementById("drawer-close").addEventListener("click", () => {
  closeDrawer();
});

document.getElementById("add-btn").addEventListener("click", () => addDialog.showModal());

addForm.addEventListener("submit", async (e) => {
  if (e.submitter?.id !== "add-save") return;
  e.preventDefault();
  const fd = new FormData(addForm);
  const body = Object.fromEntries(fd.entries());
  if (!body.locator) delete body.locator;
  try {
  await api("/api/plates/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  addDialog.close();
  addForm.reset();
  await refresh();
  } catch (error) {
    showError(error);
    addDialog.close();
  }
});

if (gate) document.getElementById("gate-form").addEventListener("submit", event => {
  event.preventDefault();
  token = new FormData(event.target).get("token");
  sessionStorage.setItem("plate-token", token);
  refresh().catch(showError);
});
refresh().catch(showError);
setInterval(() => { if (!actionPending) refresh().catch(showError); }, 2500);
