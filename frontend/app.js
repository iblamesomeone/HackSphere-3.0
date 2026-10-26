/**
 * HOUSTATLANTAVEGAS - Energy Forecast Terminal
 * Core Frontend Analytics Engine
 *
 * Handles:
 * - Direct backend API integration & health check state
 * - Chronological sorting of 24h forecast horizons
 * - Chart.js dual-axis rendering in editorial palette:
 *     --accent-burnt:  #E77B4B (Predicted demand)
 *     --accent-terra:  #A94E30 (160 kW threshold)
 *     --alert-coral:   #852E24 (200 kW overload limit)
 *     --status-green:  #486B51 (Simulated battery SOC)
 * - Battery SOC progression and microgrid dispatch rules
 * - Dynamic critical overload alert state
 * - Audit log console output
 */

const API_BASE = window.location.origin;

let forecastChart = null;
let currentCsvFile = null;

document.addEventListener("DOMContentLoaded", () => {
  initHealthCheck();
  initTabs();
  initCsvDropZone();
  initManualTable();
  initSampleLoader();
  initAuditLogs();
  loadInitialSampleData();
});

/* ==========================================================================
   1. Health Check & Engine Verification
   ========================================================================= */
async function initHealthCheck() {
  const statusIndicator = document.getElementById("system-status-indicator");
  const backendText = document.getElementById("backend-status-text");
  const modelPill = document.getElementById("model-source-pill");
  const modelText = document.getElementById("model-source-text");

  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    statusIndicator.className = "status-indicator status-online";
    backendText.textContent = "SYSTEM ONLINE";

    if (data.quickml_configured) {
      modelPill.className = "engine-pill engine-active";
      modelText.textContent = "Forecast Engine: Active";
      logToConsole("Prediction model online. Ready for telemetry ingestion.", "success");
    } else if (data.allow_dev_baseline) {
      modelPill.className = "engine-pill engine-fallback";
      modelText.textContent = "Forecast Engine: Local Dev Mode";
      logToConsole("Model unconfigured. Running local development fallback.", "warn");
    } else {
      modelPill.className = "engine-pill engine-error";
      modelText.textContent = "Forecast Engine: Offline";
      logToConsole("Model configuration missing. Production requests will fail.", "error");
    }
  } catch (err) {
    statusIndicator.className = "status-indicator status-offline";
    backendText.textContent = "SYSTEM OFFLINE";
    modelPill.className = "engine-pill engine-error";
    modelText.textContent = "Connection Error";
    logToConsole(`System connection failed: ${err.message}`, "error");
  }
}

/* ==========================================================================
   2. Tab Navigation
   ========================================================================= */
function initTabs() {
  const tabCsv = document.getElementById("tab-csv");
  const tabManual = document.getElementById("tab-manual");
  const panelCsv = document.getElementById("panel-csv");
  const panelManual = document.getElementById("panel-manual");

  tabCsv.addEventListener("click", () => {
    tabCsv.classList.add("active");
    tabCsv.setAttribute("aria-selected", "true");
    tabManual.classList.remove("active");
    tabManual.setAttribute("aria-selected", "false");
    panelCsv.classList.add("active");
    panelManual.classList.remove("active");
  });

  tabManual.addEventListener("click", () => {
    tabManual.classList.add("active");
    tabManual.setAttribute("aria-selected", "true");
    tabCsv.classList.remove("active");
    tabCsv.setAttribute("aria-selected", "false");
    panelManual.classList.add("active");
    panelCsv.classList.remove("active");
  });

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

  document.getElementById("dismiss-alert-btn").addEventListener("click", () => {
    document.getElementById("critical-alert-banner").classList.add("hidden");
  });
}

/* ==========================================================================
   3. CSV File Upload & Drag-and-Drop
   ========================================================================= */
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
    logToConsole("Removed selected CSV file.");
  });

  function handleSelectedFile(file) {
    if (!file.name.endsWith(".csv")) {
      alert("Invalid format: please upload a .csv file.");
      return;
    }
    currentCsvFile = file;
    nameLabel.textContent = file.name;
    infoBadge.classList.remove("hidden");
    runBtn.disabled = false;
    logToConsole(`Loaded telemetry file: ${file.name} (${Math.round(file.size / 1024)} KB)`);
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
   ========================================================================= */
function initManualTable() {
  const tbody = document.getElementById("manual-input-tbody");
  tbody.innerHTML = "";

  const baseDate = "2024-01-01";
  for (let h = 0; h < 24; h++) {
    const hourStr = String(h).padStart(2, "0");
    const tr = document.createElement("tr");

    const temp = (18 + 10 * Math.sin((h - 6) / 24 * Math.PI * 2)).toFixed(1);
    const humidity = (65 + 15 * Math.cos((h - 4) / 24 * Math.PI * 2)).toFixed(1);
    const solar = (h >= 6 && h <= 18) ? Math.round(450 * Math.sin((h - 6) / 12 * Math.PI)) : 0;

    tr.innerHTML = `
      <td style="font-family: var(--font-mono); color: var(--text-brown);">${hourStr}:00</td>
      <td><input type="number" class="temp-in" value="${temp}" step="0.5" data-hour="${h}"></td>
      <td><input type="number" class="hum-in" value="${humidity}" step="1" min="0" max="100" data-hour="${h}"></td>
      <td><input type="number" class="solar-in" value="${solar}" step="10" min="0" data-hour="${h}"></td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById("btn-fill-defaults").addEventListener("click", () => {
    initManualTable();
    logToConsole("Reset manual table to 24-hour diurnal profile.");
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
   5. Sample Telemetry Loader
   ========================================================================= */
function initSampleLoader() {
  document.getElementById("btn-quick-sample").addEventListener("click", async () => {
    try {
      logToConsole("Fetching 24-hour sample dataset...");
      const res = await fetch(`${API_BASE}/api/sample`);
      if (!res.ok) throw new Error("Could not retrieve sample telemetry.");
      const json = await res.json();

      logToConsole(`Loaded ${json.count} sample rows. Executing 24-hour forecast...`);
      await executeForecastRequest("/api/forecast/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: json.data, initial_soc_pct: 85.0 })
      });
    } catch (err) {
      logToConsole(`Sample loader error: ${err.message}`, "error");
      alert(`Sample loader error: ${err.message}`);
    }
  });
}

async function loadInitialSampleData() {
  try {
    const res = await fetch(`${API_BASE}/api/sample`);
    if (!res.ok) return;
    const json = await res.json();
    if (json.data && json.data.length > 0) {
      logToConsole("Auto-loaded initial 24-hour sample baseline telemetry.");
      await executeForecastRequest("/api/forecast/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: json.data, initial_soc_pct: 85.0 })
      });
    }
  } catch (err) {
    logToConsole(`Initial sample auto-load bypassed: ${err.message}`, "warn");
  }
}

/* ==========================================================================
   6. Forecast Execution Pipeline
   ========================================================================= */
async function executeForecastRequest(url, options) {
  const emptyState = document.getElementById("chart-empty-state");
  const loadingState = document.getElementById("chart-loading-state");

  emptyState.classList.add("hidden");
  loadingState.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}${url}`, options);
    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data.error || `Server error (HTTP ${res.status})`;
      logToConsole(`Inference failed (${res.status}): ${errorMsg}`, "error");
      alert(`Forecast Request Failed (${res.status}):\n${errorMsg}`);
      loadingState.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }

    loadingState.classList.add("hidden");
    logToConsole(`Inference completed: ${data.forecast_hours} hours projected.`, "success");

    renderDashboardResults(data);
  } catch (err) {
    loadingState.classList.add("hidden");
    emptyState.classList.remove("hidden");
    logToConsole(`Network failure: ${err.message}`, "error");
    alert(`Could not connect to backend server: ${err.message}`);
  }
}

/* ==========================================================================
   7. Render Dashboard Results
   ========================================================================= */
function renderDashboardResults(result) {
  const summary = result.summary;
  let schedule = result.dispatch_schedule || [];

  // Sort chronologically by timestamp
  schedule.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // 1. KPI Stats
  document.getElementById("kpi-peak-demand").textContent = summary.peak_demand_kw.toFixed(1);
  const peakStatusEl = document.getElementById("kpi-peak-status");
  if (summary.peak_demand_kw >= 200) {
    peakStatusEl.textContent = "Critical Overload Threshold Exceeded";
    peakStatusEl.style.color = "var(--alert-coral-txt)";
  } else if (summary.peak_demand_kw > 160) {
    peakStatusEl.textContent = "Elevated Demand (> 160 kW)";
    peakStatusEl.style.color = "var(--accent-terra)";
  } else {
    peakStatusEl.textContent = "Standard Nominal Demand";
    peakStatusEl.style.color = "var(--text-brown)";
  }

  // Active grid mode
  const currentMode = schedule.length > 0 ? schedule[0].grid_mode : "Main Grid";
  const modeBadge = document.getElementById("kpi-grid-mode-badge");
  modeBadge.textContent = currentMode.toUpperCase();
  modeBadge.className = `mode-badge-editorial ${currentMode === "Renewable Storage" ? "mode-renewable" : "mode-maingrid"}`;

  // Battery SOC
  const finalSoc = schedule.length > 0 ? schedule[schedule.length - 1].battery_soc_pct_simulated : 0;
  document.getElementById("kpi-soc-pct").textContent = `${finalSoc}%`;
  document.getElementById("soc-meter-bar").style.width = `${Math.min(100, Math.max(0, finalSoc))}%`;

  // Overload hours
  document.getElementById("kpi-overload-count").textContent = summary.critical_overload_events;
  const overloadSub = document.getElementById("kpi-overload-sub");
  if (summary.critical_overload_events > 0) {
    overloadSub.textContent = `${summary.critical_overload_events} hour(s) >= 200 kW limit`;
    overloadSub.style.color = "var(--alert-coral-txt)";
  } else {
    overloadSub.textContent = "0 hours exceeding 200 kW";
    overloadSub.style.color = "var(--status-green)";
  }

  // 2. Alert Banner
  const alertBanner = document.getElementById("critical-alert-banner");
  if (summary.critical_overload_events > 0) {
    const alertDesc = document.getElementById("critical-alert-desc");
    if (alertDesc) {
      alertDesc.textContent = `Forecast anticipates ${summary.critical_overload_events} hour(s) exceeding the 200 kW safety ceiling (Peak: ${summary.peak_demand_kw.toFixed(1)} kW). Storage discharge & shedding protocols active.`;
    }
    const alertHoursEl = document.getElementById("alert-overload-hours");
    if (alertHoursEl) alertHoursEl.textContent = summary.critical_overload_events;
    const alertPeakEl = document.getElementById("alert-overload-peak");
    if (alertPeakEl) alertPeakEl.textContent = `${summary.peak_demand_kw.toFixed(1)} kW`;
    alertBanner.classList.remove("hidden");
  } else {
    alertBanner.classList.add("hidden");
  }

  // 3. Render Chart
  renderChart(schedule);

  // 4. Render Table
  renderTable(schedule);
}

/* ==========================================================================
   8. Chart.js Visualization (Editorial Palette)
   ========================================================================= */
function renderChart(schedule) {
  const ctx = document.getElementById("forecastChart").getContext("2d");

  const labels = schedule.map(r => {
    const parts = r.timestamp.split(" ");
    if (parts.length > 1) {
      const datePart = parts[0].slice(5);
      const timePart = parts[1].substring(0, 5);
      return schedule.length > 24 ? `${datePart} ${timePart}` : timePart;
    }
    return r.timestamp;
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
          borderColor: "#E77B4B",
          backgroundColor: "rgba(231, 123, 75, 0.08)",
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointRadius: schedule.length > 48 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: "#E77B4B",
          yAxisID: "y"
        },
        {
          label: "160 kW Threshold",
          data: threshold160,
          borderColor: "#A94E30",
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          yAxisID: "y"
        },
        {
          label: "200 kW Overload Limit",
          data: threshold200,
          borderColor: "#852E24",
          borderWidth: 1.8,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          yAxisID: "y"
        },
        {
          label: "Simulated Battery SOC (%)",
          data: socValues,
          borderColor: "#486B51",
          backgroundColor: "transparent",
          borderWidth: 2,
          tension: 0.25,
          pointRadius: schedule.length > 48 ? 0 : 2,
          pointHoverRadius: 4,
          pointBackgroundColor: "#486B51",
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 400
      },
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#FFF7EF",
          titleColor: "#30231F",
          bodyColor: "#766259",
          borderColor: "#DCC7B5",
          borderWidth: 1,
          padding: 12,
          boxPadding: 4,
          usePointStyle: true,
          titleFont: { family: "'IBM Plex Mono', monospace", size: 12 },
          bodyFont: { family: "'DM Sans', sans-serif", size: 12 },
          callbacks: {
            afterBody: function(tooltipItems) {
              const idx = tooltipItems[0].dataIndex;
              const item = schedule[idx];
              return [
                `Grid Mode: ${item.grid_mode}`,
                item.critical_overload_alert ? "CRITICAL OVERLOAD: YES (>=200 kW)" : "Overload Status: Normal",
                `Decision Basis: ${item.switch_reason}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(220, 199, 181, 0.4)" },
          ticks: {
            color: "#766259",
            font: { family: "'IBM Plex Mono', monospace", size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12
          }
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          title: {
            display: true,
            text: "Demand (kW)",
            color: "#766259",
            font: { family: "'DM Sans', sans-serif", size: 11, weight: "500" }
          },
          grid: { color: "rgba(220, 199, 181, 0.4)" },
          ticks: {
            color: "#766259",
            font: { family: "'IBM Plex Mono', monospace", size: 11 }
          }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          title: {
            display: true,
            text: "Battery SOC % (Simulated)",
            color: "#486B51",
            font: { family: "'DM Sans', sans-serif", size: 11, weight: "500" }
          },
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: {
            color: "#486B51",
            font: { family: "'IBM Plex Mono', monospace", size: 11 }
          }
        }
      }
    }
  });
}

/* ==========================================================================
   9. Render Hourly Dispatch Table
   ========================================================================= */
function renderTable(schedule) {
  const tbody = document.getElementById("dispatch-tbody");
  tbody.innerHTML = "";
  document.getElementById("table-row-count").textContent = `${schedule.length} hours recorded`;

  schedule.forEach(row => {
    const tr = document.createElement("tr");

    const modeBadge = row.grid_mode === "Renewable Storage"
      ? '<span class="badge-table-mode badge-table-renewable">Renewable Storage</span>'
      : '<span class="badge-table-mode badge-table-maingrid">Main Grid</span>';

    const overloadBadge = row.critical_overload_alert
      ? '<span class="badge-status-overload">CRITICAL OVERLOAD</span>'
      : '<span class="badge-status-normal">Normal</span>';

    const demandColor = row.demand_kw >= 200 ? "var(--alert-coral-txt)" : (row.demand_kw > 160 ? "var(--accent-terra)" : "var(--accent-burnt)");

    tr.innerHTML = `
      <td style="font-family: var(--font-mono);">${row.timestamp}</td>
      <td style="font-family: var(--font-mono); font-weight: 600; color: ${demandColor};">
        ${row.demand_kw.toFixed(2)}
      </td>
      <td>${modeBadge}</td>
      <td>${overloadBadge}</td>
      <td style="font-family: var(--font-mono); color: var(--status-green);">
        ${row.battery_soc_pct_simulated}% <span style="font-size: 0.72rem; color: var(--text-brown);">(Simulated)</span>
      </td>
      <td style="font-size: 0.78rem; color: var(--text-brown);">${row.switch_reason}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================================================
   10. Audit Log Console
   ========================================================================= */
function initAuditLogs() {
  logToConsole("Microgrid telemetry console initialized.");
}

function logToConsole(message, type = "info") {
  const consoleEl = document.getElementById("logs-console");
  if (!consoleEl) return;

  const now = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.className = `log-entry ${type === "error" ? "log-entry-error" : (type === "warn" ? "log-entry-warn" : (type === "success" ? "log-entry-success" : "log-entry-info"))}`;
  div.textContent = `[${now}] ${message}`;

  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
