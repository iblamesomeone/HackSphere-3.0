/**
 * HackSphere 3.0: Frontend Engine & Real-Time Dashboard Logic
 * 
 * Handles:
 * - API Health check and QuickML status verification
 * - CSV file upload (drag & drop and file picker)
 * - 24-hour manual input table management
 * - 1-Click sample data loading
 * - Chart.js dual-axis load curve & battery SOC progression rendering
 * - Grid state transitions, SOC meters, and critical overload alerts
 * - Audit log console updates
 */

const API_BASE = window.location.origin;

let forecastChart = null;
let currentCsvFile = null;

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  initHealthCheck();
  initTabs();
  initCsvDropZone();
  initManualTable();
  initSampleLoader();
  initAuditLogs();
});

/* ==========================================================================
   1. Health Check & Engine Verification
   ========================================================================== */
async function initHealthCheck() {
  const modelPill = document.getElementById("model-source-pill");
  const modelText = document.getElementById("model-source-text");
  const backendText = document.getElementById("backend-status-text");

  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    backendText.textContent = "Online";

    if (data.quickml_configured) {
      modelPill.className = "status-pill pill-success";
      modelText.textContent = "QuickML Engine Active";
      logToConsole(`QuickML endpoint configured: ${data.quickml_endpoint}`, "success");
    } else if (data.allow_dev_baseline) {
      modelPill.className = "status-pill pill-warning";
      modelText.textContent = "Offline Dev Baseline (QuickML Unconfigured)";
      logToConsole("QuickML endpoint unconfigured. Running with local development baseline.", "warn");
    } else {
      modelPill.className = "status-pill pill-error";
      modelText.textContent = "QuickML Missing (Errors in Prod)";
      logToConsole("QuickML unconfigured and dev baseline disabled. Production requests will fail.", "error");
    }
  } catch (err) {
    backendText.textContent = "Offline / Unreachable";
    modelPill.className = "status-pill pill-error";
    modelText.textContent = "Backend Disconnected";
    logToConsole(`Health check failed: ${err.message}`, "error");
  }
}

/* ==========================================================================
   2. Tab Navigation
   ========================================================================== */
function initTabs() {
  // Ingestion panel tabs
  const tabCsv = document.getElementById("tab-csv");
  const tabManual = document.getElementById("tab-manual");
  const panelCsv = document.getElementById("panel-csv");
  const panelManual = document.getElementById("panel-manual");

  tabCsv.addEventListener("click", () => {
    tabCsv.classList.add("active");
    tabManual.classList.remove("active");
    panelCsv.classList.add("active");
    panelManual.classList.remove("active");
  });

  tabManual.addEventListener("click", () => {
    tabManual.classList.add("active");
    tabCsv.classList.remove("active");
    panelManual.classList.add("active");
    panelCsv.classList.remove("active");
  });

  // Table vs Logs tabs
  const viewTable = document.getElementById("view-tab-table");
  const viewLogs = document.getElementById("view-tab-logs");
  const panelTable = document.getElementById("view-panel-table");
  const panelLogs = document.getElementById("view-panel-logs");

  viewTable.addEventListener("click", () => {
    viewTable.classList.add("active");
    viewLogs.classList.remove("active");
    panelTable.classList.add("active");
    panelLogs.classList.remove("active");
  });

  viewLogs.addEventListener("click", () => {
    viewLogs.classList.add("active");
    viewTable.classList.remove("active");
    panelLogs.classList.add("active");
    panelTable.classList.remove("active");
  });

  // Alert banner dismiss
  document.getElementById("dismiss-alert-btn").addEventListener("click", () => {
    document.getElementById("critical-alert-banner").classList.add("hidden");
  });
}

/* ==========================================================================
   3. CSV File Upload & Drag-and-Drop
   ========================================================================== */
function initCsvDropZone() {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("csv-file-input");
  const infoBadge = document.getElementById("selected-file-info");
  const nameLabel = document.getElementById("selected-file-name");
  const clearBtn = document.getElementById("clear-file-btn");
  const runBtn = document.getElementById("btn-run-csv-forecast");

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentCsvFile = null;
    fileInput.value = "";
    infoBadge.classList.add("hidden");
    runBtn.disabled = true;
    logToConsole("Cleared selected CSV file.");
  });

  function handleSelectedFile(file) {
    if (!file.name.endsWith(".csv")) {
      alert("Invalid file format. Please upload a .csv file.");
      return;
    }
    currentCsvFile = file;
    nameLabel.textContent = file.name;
    infoBadge.classList.remove("hidden");
    runBtn.disabled = false;
    logToConsole(`Loaded CSV file: ${file.name} (${Math.round(file.size / 1024)} KB)`);
  }

  runBtn.addEventListener("click", async () => {
    if (!currentCsvFile) return;
    const initialSoc = document.getElementById("initial-soc-csv").value || 85.0;
    
    const formData = new FormData();
    formData.append("file", currentCsvFile);
    formData.append("initial_soc_pct", initialSoc);

    await executeForecastRequest("/api/forecast/csv", {
      method: "POST",
      body: formData
    });
  });
}

/* ==========================================================================
   4. Manual Input Table (24-Hour Horizon)
   ========================================================================== */
function initManualTable() {
  const tbody = document.getElementById("manual-input-tbody");
  tbody.innerHTML = "";

  const baseDate = "2024-01-01";
  for (let h = 0; h < 24; h++) {
    const hourStr = String(h).padStart(2, "0");
    const tr = document.createElement("tr");

    // Realistic day-night curve defaults
    const temp = (18 + 10 * Math.sin((h - 6) / 24 * Math.PI * 2)).toFixed(1);
    const humidity = (65 + 15 * Math.cos((h - 4) / 24 * Math.PI * 2)).toFixed(1);
    const solar = (h >= 6 && h <= 18) ? Math.round(450 * Math.sin((h - 6) / 12 * Math.PI)) : 0;

    tr.innerHTML = `
      <td style="font-family: var(--font-mono); color: var(--text-secondary);">${hourStr}:00</td>
      <td><input type="number" class="table-input temp-in" value="${temp}" step="0.5" data-hour="${h}"></td>
      <td><input type="number" class="table-input hum-in" value="${humidity}" step="1" min="0" max="100" data-hour="${h}"></td>
      <td><input type="number" class="table-input solar-in" value="${solar}" step="10" min="0" data-hour="${h}"></td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById("btn-fill-defaults").addEventListener("click", () => {
    initManualTable();
    logToConsole("Reset manual table to 24-hour diurnal weather profile.");
  });

  document.getElementById("btn-run-manual-forecast").addEventListener("click", async () => {
    const initialSoc = document.getElementById("initial-soc-manual").value || 85.0;
    const rows = [];

    const tempInputs = tbody.querySelectorAll(".temp-in");
    const humInputs = tbody.querySelectorAll(".hum-in");
    const solarInputs = tbody.querySelectorAll(".solar-in");

    for (let h = 0; h < 24; h++) {
      const hourStr = String(h).padStart(2, "0");
      rows.push({
        timestamp: `${baseDate} ${hourStr}:00:00`,
        ambient_temp_c: parseFloat(tempInputs[h].value),
        humidity_pct: parseFloat(humInputs[h].value),
        solar_irradiance_wm2: parseFloat(solarInputs[h].value)
      });
    }

    await executeForecastRequest("/api/forecast/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: rows, initial_soc_pct: parseFloat(initialSoc) })
    });
  });
}

/* ==========================================================================
   5. 1-Click Sample Telemetry Loader
   ========================================================================== */
function initSampleLoader() {
  document.getElementById("btn-quick-sample").addEventListener("click", async () => {
    try {
      logToConsole("Requesting 24-hour sample dataset from server...");
      const res = await fetch(`${API_BASE}/api/sample`);
      if (!res.ok) throw new Error("Could not retrieve sample telemetry.");
      const json = await res.json();

      logToConsole(`Received ${json.count} sample rows. Running forecasting pipeline...`);
      await executeForecastRequest("/api/forecast/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: json.data, initial_soc_pct: 85.0 })
      });
    } catch (err) {
      logToConsole(`Failed to load sample: ${err.message}`, "error");
      alert(`Sample loader error: ${err.message}`);
    }
  });
}

/* ==========================================================================
   6. Forecast Request & Results Pipeline
   ========================================================================== */
async function executeForecastRequest(url, options) {
  const emptyState = document.getElementById("chart-empty-state");
  const loadingState = document.getElementById("chart-loading-state");

  emptyState.classList.add("hidden");
  loadingState.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}${url}`, options);
    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data.error || `Server returned error HTTP ${res.status}`;
      logToConsole(`Forecast error (${res.status}): ${errorMsg}`, "error");
      alert(`Forecast Request Failed (${res.status}):\n${errorMsg}`);
      loadingState.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }

    loadingState.classList.add("hidden");
    logToConsole(`Forecast successful: ${data.forecast_hours} hours evaluated. Model: ${data.model_source}`, "success");

    renderDashboardResults(data);
  } catch (err) {
    loadingState.classList.add("hidden");
    emptyState.classList.remove("hidden");
    logToConsole(`Network failure executing forecast: ${err.message}`, "error");
    alert(`Could not connect to backend server: ${err.message}`);
  }
}

/* ==========================================================================
   7. Render Dashboard Results
   ========================================================================== */
function renderDashboardResults(result) {
  const summary = result.summary;
  const schedule = result.dispatch_schedule;

  // 1. KPI Stats
  document.getElementById("kpi-peak-demand").textContent = summary.peak_demand_kw.toFixed(1);
  document.getElementById("kpi-peak-status").textContent = summary.peak_demand_kw >= 200 ? "CRITICAL PEAK" : (summary.peak_demand_kw > 160 ? "Elevated Load" : "Normal Load");

  // Grid mode badge (current / first hour mode)
  const currentMode = schedule[0].grid_mode;
  const modeBadge = document.getElementById("kpi-grid-mode-badge");
  modeBadge.textContent = currentMode.toUpperCase();
  modeBadge.className = `badge-mode ${currentMode === "Renewable Storage" ? "mode-renewable" : "mode-maingrid"}`;

  // Battery SOC (latest hour)
  const finalSoc = schedule[schedule.length - 1].battery_soc_pct_simulated;
  document.getElementById("kpi-soc-pct").textContent = `${finalSoc}%`;
  document.getElementById("soc-meter-bar").style.width = `${finalSoc}%`;

  // Overload counter
  document.getElementById("kpi-overload-count").textContent = summary.critical_overload_events;
  const overloadSub = document.getElementById("kpi-overload-sub");
  if (summary.critical_overload_events > 0) {
    overloadSub.textContent = `CRITICAL: ${summary.critical_overload_events} hours exceed 200 kW`;
    overloadSub.style.color = "#F87171";
  } else {
    overloadSub.textContent = "Safe: All hours < 200 kW limit";
    overloadSub.style.color = "#10B981";
  }

  // 2. Critical Overload Alert Banner
  const alertBanner = document.getElementById("critical-alert-banner");
  if (summary.critical_overload_events > 0) {
    document.getElementById("critical-alert-desc").textContent =
      `Forecast detects ${summary.critical_overload_events} hour(s) with demand >= 200 kW (Peak: ${summary.peak_demand_kw} kW). Overload alert triggered.`;
    alertBanner.classList.remove("hidden");
  } else {
    alertBanner.classList.add("hidden");
  }

  // 3. Render Chart.js
  renderChart(schedule);

  // 4. Render Table
  renderTable(schedule);
}

/* ==========================================================================
   8. Chart.js Visualization
   ========================================================================== */
function renderChart(schedule) {
  const ctx = document.getElementById("forecastChart").getContext("2d");

  const labels = schedule.map(r => {
    const parts = r.timestamp.split(" ");
    return parts.length > 1 ? parts[1].substring(0, 5) : r.timestamp;
  });

  const demandValues = schedule.map(r => r.demand_kw);
  const socValues = schedule.map(r => r.battery_soc_pct_simulated);
  const threshold160 = schedule.map(() => 160);
  const threshold200 = schedule.map(() => 200);

  if (forecastChart) {
    forecastChart.destroy();
  }

  forecastChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Predicted Demand (kW)",
          data: demandValues,
          borderColor: "#38BDF8",
          backgroundColor: "rgba(56, 189, 248, 0.1)",
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          yAxisID: "y"
        },
        {
          label: "160 kW Threshold",
          data: threshold160,
          borderColor: "#F59E0B",
          borderWidth: 1.8,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          yAxisID: "y"
        },
        {
          label: "200 kW Critical Limit",
          data: threshold200,
          borderColor: "#EF4444",
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          yAxisID: "y"
        },
        {
          label: "Simulated Battery SOC (%)",
          data: socValues,
          borderColor: "#10B981",
          backgroundColor: "transparent",
          borderWidth: 2,
          tension: 0.25,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111827",
          titleColor: "#F8FAFC",
          bodyColor: "#94A3B8",
          borderColor: "#243046",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            afterBody: function(tooltipItems) {
              const idx = tooltipItems[0].dataIndex;
              const item = schedule[idx];
              return [
                `Grid Mode: ${item.grid_mode}`,
                item.critical_overload_alert ? "CRITICAL OVERLOAD: YES (>=200kW)" : "Overload: Normal",
                `Reason: ${item.switch_reason}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#64748B" }
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          title: { display: true, text: "Demand (kW)", color: "#94A3B8" },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#64748B" }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          title: { display: true, text: "Battery SOC % (Simulated)", color: "#10B981" },
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: { color: "#10B981" }
        }
      }
    }
  });
}

/* ==========================================================================
   9. Render Hourly Dispatch Table
   ========================================================================== */
function renderTable(schedule) {
  const tbody = document.getElementById("dispatch-tbody");
  tbody.innerHTML = "";
  document.getElementById("table-row-count").textContent = `${schedule.length} hours loaded`;

  schedule.forEach(row => {
    const tr = document.createElement("tr");

    const modeBadge = row.grid_mode === "Renewable Storage"
      ? '<span class="badge-table-renewable">Renewable Storage</span>'
      : '<span class="badge-table-maingrid">Main Grid</span>';

    const overloadBadge = row.critical_overload_alert
      ? '<span class="badge-alert-active">CRITICAL ALERT (&ge;200kW)</span>'
      : '<span class="badge-alert-normal">Normal</span>';

    tr.innerHTML = `
      <td style="font-family: var(--font-mono);">${row.timestamp}</td>
      <td style="font-family: var(--font-mono); font-weight: 700; color: ${row.demand_kw >= 200 ? '#EF4444' : (row.demand_kw > 160 ? '#F59E0B' : '#38BDF8')};">
        ${row.demand_kw.toFixed(2)}
      </td>
      <td>${modeBadge}</td>
      <td>${overloadBadge}</td>
      <td style="font-family: var(--font-mono); color: #10B981;">
        ${row.battery_soc_pct_simulated}% <span style="font-size: 0.7rem; color: #64748B;">(Simulated)</span>
      </td>
      <td style="font-size: 0.75rem; color: var(--text-secondary);">${row.switch_reason}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================================================
   10. Audit Log Console
   ========================================================================== */
function initAuditLogs() {
  logToConsole("Microgrid telemetry console ready.");
}

function logToConsole(message, type = "info") {
  const consoleEl = document.getElementById("logs-console");
  if (!consoleEl) return;

  const now = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.className = `log-line ${type === "error" ? "log-error" : (type === "warn" ? "log-warn" : (type === "success" ? "log-success" : ""))}`;
  div.textContent = `[${now}] ${message}`;

  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
