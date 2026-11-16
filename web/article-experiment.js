"use strict";
const runButton = document.querySelector("#run");
const statusLine = document.querySelector("#status");
const selector = document.querySelector("#case");
let report;
const urls = [];
const fields = ["id", "duration_ms", "phase_ms", "opening_s", "closing_s", "first_invalid_sample_s", "first_control_effect_s", "first_pending_s", "first_stored_s", "recovery_sample_s", "minimum_torque_factor", "final_stored_P0102"];
function download(id, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  urls.push(url);
  const link = document.querySelector(id);
  link.href = url;
  link.hidden = false;
}
function draw() {
  const selected = report.cases[Number(selector.value)];
  const svg = document.querySelector("#chart");
  svg.replaceChildren();
  const add = (tag, attrs, text) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text) el.textContent = text;
    svg.append(el);
  };
  const x = t => 210 + (t - 2) / 1.8 * 800;
  for (const t of [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.8]) {
    add("line", {x1:x(t), x2:x(t), y1:15, y2:260, stroke:"#29404a"});
    add("text", {x:x(t), y:285, fill:"#bdcdd4", "text-anchor":"middle", "font-size":13}, t.toFixed(2));
  }
  const signals = [
    ["Контакт відкрито / Open", r => !r.contact_connected, "#f0b45c"],
    ["Відлік invalid", r => r.validity === "invalid", "#e99199"],
    ["Момент × 0,7 / Derate", r => r.torque_factor < 1, "#53dbc9"],
    ["P0102 pending", r => r.pending_P0102, "#bda1e9"],
    ["P0102 stored", r => r.stored_P0102, "#79baff"]
  ];
  signals.forEach(([label, active, color], index) => {
    const baseline = 55 + index * 48;
    add("text", {x:10, y:baseline - 4, fill:color, "font-size":13}, label);
    let path = "";
    selected.trace.forEach((row, i) => {
      const y = baseline - (active(row) ? 25 : 0);
      path += i ? ` H${x(row.observed_at_s)} V${y}` : `M${x(row.observed_at_s)} ${y}`;
    });
    add("path", {d:path, fill:"none", stroke:color, "stroke-width":2});
  });
}
selector.addEventListener("change", draw);
runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  statusLine.textContent = "Обчислення / Calculating…";
  try {
    const response = await fetch("/api/article-experiment", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"});
    if (!response.ok) throw new Error((await response.json()).error || response.statusText);
    report = await response.json();
    urls.splice(0).forEach(url => URL.revokeObjectURL(url));
    download("#json", JSON.stringify(report, null, 2), "application/json");
    const csv = [fields.join(","), ...report.cases.map(c => fields.map(k => c.summary[k] ?? "").join(","))].join("\r\n");
    download("#csv", csv, "text/csv");
    const body = document.querySelector("#rows");
    body.replaceChildren();
    selector.replaceChildren();
    for (const [index, item] of report.cases.entries()) {
      const s = item.summary;
      const tr = document.createElement("tr");
      for (const key of ["id", "phase_ms", "first_invalid_sample_s", "first_pending_s", "first_stored_s", "recovery_sample_s", "final_stored_P0102"]) {
        const td = document.createElement("td");
        td.textContent = s[key] === null ? "—" : typeof s[key] === "boolean" ? (s[key] ? "так / yes" : "ні / no") : String(s[key]);
        tr.append(td);
      }
      body.append(tr);
      const option = document.createElement("option");
      option.value = index;
      option.textContent = s.id;
      selector.append(option);
    }
    selector.value = "4";
    draw();
    document.querySelector("#results").hidden = false;
    statusLine.textContent = `${report.cases.length} досліди виконано / cases complete. JSON містить контрольні суми вихідного коду / includes source checksums.`;
  } catch (error) {
    statusLine.textContent = `Помилка / Error: ${error.message}`;
  } finally {
    runButton.disabled = false;
  }
});
