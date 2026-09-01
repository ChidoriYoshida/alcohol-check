/* アルコールチェック記録簿 - フロントエンドロジック（GitHub Pages + Apps Script版） */

const PASSCODE_STORAGE_KEY = "alcohol-check-passcode";
let passcode = localStorage.getItem(PASSCODE_STORAGE_KEY) || "";

let staff = [];
let leaders = [];
let currentTab = "input";
let ledgerMonth = new Date().toISOString().slice(0, 7);
let inputState = { method: "device", judge: null, date: todayStr(), photo: null };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- API HELPERS ---------- */
async function apiGet(action, params) {
  const usp = new URLSearchParams({ action, passcode, ...(params || {}) });
  const res = await fetch(`${API_URL}?${usp.toString()}`);
  return res.json();
}

async function apiPost(action, payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action, passcode, ...(payload || {}) }),
  });
  return res.json();
}

/* ---------- LOGIN ---------- */
async function tryLogin(code) {
  const testPasscode = code;
  const usp = new URLSearchParams({ action: "staff", passcode: testPasscode });
  const res = await fetch(`${API_URL}?${usp.toString()}`);
  const data = await res.json();
  return data.ok === true;
}

async function initLogin() {
  const errorEl = document.getElementById("login-error");
  if (passcode) {
    const ok = await tryLogin(passcode);
    if (ok) {
      showApp();
      return;
    }
  }
  document.getElementById("passcode-submit").addEventListener("click", async () => {
    const val = document.getElementById("passcode-input").value.trim();
    if (!val) return;
    errorEl.classList.remove("show");
    const btn = document.getElementById("passcode-submit");
    btn.disabled = true; btn.textContent = "確認中...";
    const ok = await tryLogin(val);
    btn.disabled = false; btn.textContent = "入る";
    if (ok) {
      passcode = val;
      localStorage.setItem(PASSCODE_STORAGE_KEY, val);
      showApp();
    } else {
      errorEl.classList.add("show");
    }
  });
  document.getElementById("passcode-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("passcode-submit").click();
  });
}

function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";
  init();
}

/* ---------- TOAST ---------- */
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ---------- INPUT TAB ---------- */
function renderInput() {
  const main = document.getElementById("main");
  if (staff.length === 0) {
    main.innerHTML = `<div class="card"><p class="empty-state">まだ運転者が登録されていません。<br>「担当者管理」タブから登録してください。</p></div>`;
    return;
  }
  if (leaders.length === 0) {
    main.innerHTML = `<div class="card"><p class="empty-state">検査はリーダーまたはその代理者のみ行えます。<br>「担当者管理」タブで先にリーダー・代理者を登録してください。</p></div>`;
    return;
  }
  main.innerHTML = `
    <div class="shared-note">この記録はチーム全員で共有されます。写真は撮影から約2か月で自動的に削除されますが、数値・判定などの記録は永久に保存されます。</div>
    <div class="card">
      <div class="field">
        <label>日付</label>
        <input type="date" id="f-date" value="${inputState.date}">
      </div>
      <div class="field">
        <label>対象者（運転者）</label>
        <select id="f-name">${staff.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>検査方法</label>
        <div class="seg">
          <button type="button" data-method="device" class="${inputState.method === "device" ? "active" : ""}">検知器</button>
          <button type="button" data-method="visual" class="${inputState.method === "visual" ? "active" : ""}">目視</button>
        </div>
      </div>
      <div class="field" id="method-input"></div>
      <div class="field">
        <label>写真（検知器の表示・任意）</label>
        <div id="photo-field"></div>
        <input type="file" id="f-photo" accept="image/*" capture="environment" style="display:none;">
      </div>
      <div class="field">
        <label>検査担当者（リーダー・代理者のみ）</label>
        <select id="f-checker">${leaders.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")}</select>
      </div>
      <button class="submit-btn" id="save-btn">記録する</button>
      <div class="readout" id="readout"></div>
    </div>
  `;
  renderMethodInput();
  renderPhotoField();

  document.getElementById("f-date").addEventListener("change", (e) => { inputState.date = e.target.value; });
  main.querySelectorAll("[data-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      inputState.method = btn.dataset.method;
      inputState.judge = null;
      renderInput();
    });
  });
  document.getElementById("f-photo").addEventListener("change", onPhotoSelected);
  document.getElementById("save-btn").addEventListener("click", onSave);
}

function renderMethodInput() {
  const wrap = document.getElementById("method-input");
  if (inputState.method === "device") {
    wrap.innerHTML = `<label>検知器数値（mg/L）</label><input type="number" step="0.01" min="0" id="f-value" placeholder="0.00">`;
    document.getElementById("f-value").addEventListener("input", (e) => updateDeviceReadout(parseFloat(e.target.value)));
  } else {
    wrap.innerHTML = `
      <label>目視判定</label>
      <div class="judge-row">
        <button type="button" class="judge-btn ok" id="judge-ok">○ 酒気帯びなし</button>
        <button type="button" class="judge-btn ng" id="judge-ng">× 酒気帯びあり</button>
      </div>`;
    document.getElementById("judge-ok").addEventListener("click", () => { inputState.judge = "ok"; syncJudgeButtons(); });
    document.getElementById("judge-ng").addEventListener("click", () => { inputState.judge = "ng"; syncJudgeButtons(); });
  }
}

function syncJudgeButtons() {
  document.getElementById("judge-ok").classList.toggle("active", inputState.judge === "ok");
  document.getElementById("judge-ng").classList.toggle("active", inputState.judge === "ng");
}

function updateDeviceReadout(value) {
  const el = document.getElementById("readout");
  if (isNaN(value)) { el.className = "readout"; el.textContent = ""; return; }
  if (value >= 0.15) {
    el.className = "readout show ng";
    el.textContent = `数値 ${value.toFixed(2)}mg/L → 運転不可（×）`;
    inputState.judge = "ng";
  } else {
    el.className = "readout show ok";
    el.textContent = `数値 ${value.toFixed(2)}mg/L → 運転可（○）`;
    inputState.judge = "ok";
  }
}

function renderPhotoField() {
  const wrap = document.getElementById("photo-field");
  if (inputState.photo) {
    wrap.innerHTML = `
      <div class="photo-preview-wrap">
        <img src="${inputState.photo}" alt="検査時の写真プレビュー">
        <button type="button" class="photo-remove" id="photo-remove" aria-label="写真を削除">×</button>
      </div>`;
    document.getElementById("photo-remove").addEventListener("click", () => { inputState.photo = null; renderPhotoField(); });
  } else {
    wrap.innerHTML = `<div class="photo-box" id="photo-box">タップして写真を撮影・選択</div>`;
    document.getElementById("photo-box").addEventListener("click", () => document.getElementById("f-photo").click());
  }
}

async function onPhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const wrap = document.getElementById("photo-field");
  wrap.innerHTML = `<div class="photo-compressing">写真を処理中...</div>`;
  try {
    inputState.photo = await compressImage(file, 900, 0.65);
  } catch (err) {
    showToast("写真の読み込みに失敗しました");
  }
  renderPhotoField();
  e.target.value = "";
}

function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("image decode failed"));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else { w = Math.round(w * (maxDim / h)); h = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onSave() {
  const date = document.getElementById("f-date").value;
  const name = document.getElementById("f-name").value;
  const checker = document.getElementById("f-checker").value;
  if (!date || !name) { showToast("日付と対象者を確認してください"); return; }
  if (!checker) { showToast("検査担当者（リーダー・代理者）を選択してください"); return; }

  let value = null;
  if (inputState.method === "device") {
    const raw = document.getElementById("f-value").value;
    if (raw === "") { showToast("数値を入力してください"); return; }
    value = parseFloat(raw);
  }
  if (!inputState.judge) { showToast("判定を確認してください"); return; }

  const btn = document.getElementById("save-btn");
  btn.disabled = true; btn.textContent = "保存中...";

  let ok = false;
  try {
    const result = await apiPost("saveEntry", {
      date, name, method: inputState.method, value, judge: inputState.judge,
      checker, photo: inputState.photo || null,
    });
    ok = result.ok === true;
  } catch (e) { ok = false; }

  btn.disabled = false; btn.textContent = "記録する";

  if (ok) {
    showToast(`${name}さんの記録を保存しました`);
    inputState.judge = null;
    inputState.photo = null;
    document.getElementById("f-checker").value = checker;
    renderMethodInput();
    renderPhotoField();
    const r = document.getElementById("readout");
    r.className = "readout"; r.textContent = "";
  } else {
    showToast("保存に失敗しました。もう一度お試しください");
  }
}

/* ---------- LEDGER TAB ---------- */
async function renderLedger() {
  const main = document.getElementById("main");
  main.innerHTML = `<div class="card"><p class="empty-state">読み込み中...</p></div>`;

  const [year, mon] = ledgerMonth.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();

  let entries = {};
  try {
    const result = await apiGet("entries", { month: ledgerMonth });
    if (result.ok) {
      (result.entries || []).forEach((e) => { entries[`${e.date}|${e.name}`] = e; });
    }
  } catch (e) { /* leave empty on failure */ }

  if (staff.length === 0) {
    main.innerHTML = `<div class="card"><p class="empty-state">担当者が登録されていません。</p></div>`;
    return;
  }

  let rows = "";
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${ledgerMonth}-${String(d).padStart(2, "0")}`;
    let cells = "";
    for (const name of staff) {
      const e = entries[`${dateStr}|${name}`];
      if (!e || e.judge === "" || e.judge === undefined) {
        cells += `<td class="empty">・</td>`;
      } else {
        const cls = e.judge === "ng" ? "ng" : "ok";
        const label = e.method === "device" ? Number(e.value).toFixed(2) : (e.judge === "ng" ? "×" : "○");
        const camBadge = e.photoUrl ? '<span class="cam-badge">📷</span>' : "";
        if (e.photoUrl) {
          cells += `<td class="${cls}" data-date="${dateStr}" data-name="${escapeHtml(name)}" style="cursor:pointer;">${label}${camBadge}</td>`;
        } else {
          cells += `<td class="${cls}">${label}</td>`;
        }
      }
    }
    rows += `<tr><td class="date-col">${d}</td>${cells}</tr>`;
  }

  main.innerHTML = `
    <div class="month-nav">
      <button id="prev-month">‹</button>
      <div class="label">${year}年${mon}月</div>
      <button id="next-month">›</button>
    </div>
    <div class="ledger-toolbar"><button class="print-btn" id="print-btn">🖨 この月を印刷</button></div>
    <div class="print-title">${year}年${mon}月　アルコール検査記録簿</div>
    <div class="ledger-wrap">
      <table class="ledger">
        <thead><tr><th>日</th>${staff.map((s) => `<th>${escapeHtml(s)}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="legend">
      <span><span class="dot ok"></span>運転可（○ / 0.15未満）</span>
      <span><span class="dot ng"></span>運転不可（× / 0.15以上）</span>
      <span>・ 未記録</span>
      <span>📷 写真あり（タップで表示・撮影から2か月で自動削除）</span>
    </div>
  `;

  document.getElementById("prev-month").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("next-month").addEventListener("click", () => shiftMonth(1));
  document.getElementById("print-btn").addEventListener("click", () => window.print());

  main.querySelectorAll("td[data-date]").forEach((td) => {
    td.addEventListener("click", () => {
      const e = entries[`${td.dataset.date}|${td.dataset.name}`];
      if (e) openLightbox(e, td.dataset.date, td.dataset.name);
    });
  });
}

function shiftMonth(delta) {
  const [y, m] = ledgerMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  ledgerMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  renderLedger();
}

function openLightbox(entry, dateStr, name) {
  const lb = document.getElementById("lightbox");
  document.getElementById("lightbox-img").src = entry.photoUrl;
  const resultText = entry.method === "device"
    ? `検知器 ${Number(entry.value).toFixed(2)}mg/L（${entry.judge === "ng" ? "運転不可" : "運転可"}）`
    : `目視（${entry.judge === "ng" ? "運転不可" : "運転可"}）`;
  document.getElementById("lightbox-meta").textContent = `${dateStr}　${name}　${resultText}　担当：${entry.checker}`;
  lb.classList.add("show");
}
function closeLightbox() { document.getElementById("lightbox").classList.remove("show"); }

/* ---------- STAFF TAB ---------- */
function renderStaff() {
  const main = document.getElementById("main");
  main.innerHTML = `
    <p class="hint">運転者は検査を受ける人、リーダー・代理者は検査を行える人です。数値チェックと目視検査は、リーダーまたはその代理者のみ実施できます。</p>
    <div class="card">
      <label style="margin-bottom:10px;">運転者（検査対象）</label>
      <ul class="staff-list" id="staff-ul">
        ${staff.length === 0 ? '<li style="color:var(--ink-soft);border:none;">まだ登録がありません</li>' : staff.map((s, i) => `<li><span>${escapeHtml(s)}</span><button data-idx="${i}">削除</button></li>`).join("")}
      </ul>
      <div class="add-row"><input type="text" id="new-staff" placeholder="氏名を入力"><button id="add-staff">追加</button></div>
    </div>
    <div class="card">
      <label style="margin-bottom:10px;">リーダー・代理者（検査担当者）</label>
      <ul class="staff-list" id="leader-ul">
        ${leaders.length === 0 ? '<li style="color:var(--ink-soft);border:none;">まだ登録がありません</li>' : leaders.map((l, i) => `<li><span>${escapeHtml(l)}</span><button data-idx="${i}">削除</button></li>`).join("")}
      </ul>
      <div class="add-row"><input type="text" id="new-leader" placeholder="氏名を入力"><button id="add-leader">追加</button></div>
    </div>
  `;

  main.querySelectorAll("#staff-ul button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = staff[parseInt(btn.dataset.idx)];
      if (confirm(`「${name}」を削除しますか？（過去の記録は残ります）`)) {
        await apiPost("removeStaff", { name });
        await loadStaffAndLeaders();
        renderStaff();
      }
    });
  });
  document.getElementById("add-staff").addEventListener("click", async () => {
    const input = document.getElementById("new-staff");
    const name = input.value.trim();
    if (!name) { showToast("氏名を入力してください"); return; }
    if (staff.includes(name)) { showToast("すでに登録されています"); return; }
    await apiPost("addStaff", { name });
    await loadStaffAndLeaders();
    renderStaff();
    showToast(`${name}さんを追加しました`);
  });

  main.querySelectorAll("#leader-ul button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = leaders[parseInt(btn.dataset.idx)];
      if (confirm(`「${name}」をリーダー・代理者から削除しますか？（過去の記録は残ります）`)) {
        await apiPost("removeLeader", { name });
        await loadStaffAndLeaders();
        renderStaff();
      }
    });
  });
  document.getElementById("add-leader").addEventListener("click", async () => {
    const input = document.getElementById("new-leader");
    const name = input.value.trim();
    if (!name) { showToast("氏名を入力してください"); return; }
    if (leaders.includes(name)) { showToast("すでに登録されています"); return; }
    await apiPost("addLeader", { name });
    await loadStaffAndLeaders();
    renderStaff();
    showToast(`${name}さんをリーダー・代理者に追加しました`);
  });
}

/* ---------- TAB SWITCHING ---------- */
async function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "input") renderInput();
  else if (tab === "ledger") await renderLedger();
  else if (tab === "staff") renderStaff();
}

async function loadStaffAndLeaders() {
  try {
    const result = await apiGet("staff");
    if (result.ok) {
      staff = result.staff || [];
      leaders = result.leaders || [];
    }
  } catch (e) {
    showToast("データの読み込みに失敗しました");
  }
}

async function init() {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });

  await loadStaffAndLeaders();
  switchTab("input");
}

initLogin();
