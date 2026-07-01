import { loadProcessedData, getItems } from "./api.js";
import { $, escapeHtml, renderEmpty } from "./utils.js";
import { formatDateTime, formatNumber, formatPercent, formatSignedPercent, valueClass } from "./formatters.js";

const WEIGHTS = {
  fundamentalScore: 0.3,
  technicalScore: 0.3,
  chipScore: 0.25,
  turnoverScore: 0.15
};

let factorRows = [];

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function calculateTotalScore(item) {
  if (hasNumber(item.totalScore) && Number(item.totalScore) > 0) {
    return roundScore(item.totalScore);
  }

  return roundScore(
    Number(item.fundamentalScore || 0) * WEIGHTS.fundamentalScore
    + Number(item.technicalScore || 0) * WEIGHTS.technicalScore
    + Number(item.chipScore || 0) * WEIGHTS.chipScore
    + Number(item.turnoverScore || 0) * WEIGHTS.turnoverScore
  );
}

function scoreClass(score) {
  const number = Number(score);
  if (number >= 85) return "score-high";
  if (number >= 70) return "score-mid";
  return "score-low";
}

function factorScoreBadge(score) {
  return `<span class="score-badge ${scoreClass(score)}">${escapeHtml(formatNumber(score, 1))}</span>`;
}

function tradeTypeBadge(value) {
  const label = value || "未分類";
  const type = label === "短線" ? "short" : label === "中長期" ? "long" : "swing";
  return `<span class="trade-type-badge ${type}">${escapeHtml(label)}</span>`;
}

function riskLabelBadge(value) {
  const label = value || "正常";
  const typeMap = {
    "過熱": "hot",
    "正常": "normal",
    "冷門": "cold",
    "低流動": "illiquid"
  };
  return `<span class="risk-label-badge ${typeMap[label] || "normal"}">${escapeHtml(label)}</span>`;
}

function normalizeRow(item) {
  return {
    ...item,
    code: String(item.code ?? item.symbol ?? "").trim(),
    name: String(item.name ?? "").trim(),
    industry: item.industry || "--",
    concepts: Array.isArray(item.concepts) ? item.concepts : [],
    close: item.close,
    changePercent: item.changePercent,
    volume: item.volume,
    turnoverRate: item.turnoverRate,
    fundamentalScore: Number(item.fundamentalScore || 0),
    technicalScore: Number(item.technicalScore || 0),
    chipScore: Number(item.chipScore || 0),
    turnoverScore: Number(item.turnoverScore || 0),
    tradeType: item.tradeType || "波段",
    riskLabel: item.riskLabel || "正常",
    updatedAt: item.updatedAt || item.updated_at || "",
    computedTotalScore: calculateTotalScore(item)
  };
}

function stockCodeLink(row) {
  return `<a class="stock-link" href="./stock.html?code=${encodeURIComponent(row.code)}">${escapeHtml(row.code)}</a>`;
}

function conceptsText(row) {
  if (!row.concepts.length) return "--";
  return row.concepts.map((concept) => `<span class="chip factor-concept-chip">${escapeHtml(concept)}</span>`).join("");
}

function formatVolume(value) {
  if (!hasNumber(value)) return "--";
  return formatNumber(value, 0);
}

function getSortValue(row, sortKey) {
  const map = {
    total: row.computedTotalScore,
    fundamental: row.fundamentalScore,
    technical: row.technicalScore,
    chip: row.chipScore,
    turnover: row.turnoverScore
  };
  return Number(map[sortKey] ?? row.computedTotalScore ?? 0);
}

function applyFilters() {
  const keyword = ($("#factorSearch")?.value || "").trim().toLowerCase();
  const tradeType = $("#tradeTypeFilter")?.value || "";
  const riskLabel = $("#factorRiskFilter")?.value || "";
  const sortKey = $("#factorSort")?.value || "total";

  return factorRows
    .filter((row) => {
      const haystack = [
        row.code,
        row.name,
        row.industry,
        row.tradeType,
        row.riskLabel,
        ...row.concepts
      ].join(" ").toLowerCase();
      return !keyword || haystack.includes(keyword);
    })
    .filter((row) => !tradeType || row.tradeType === tradeType)
    .filter((row) => !riskLabel || row.riskLabel === riskLabel)
    .sort((a, b) => getSortValue(b, sortKey) - getSortValue(a, sortKey));
}

function renderFactorRows() {
  const rows = applyFilters();
  const body = $("#factorTableBody");
  const count = $("#factorCount");

  if (count) count.textContent = `${rows.length} 檔`;
  if (!body) return;

  if (!factorRows.length) {
    body.innerHTML = `<tr><td colspan="17">${renderEmpty("目前尚無多因子評分資料")}</td></tr>`;
    return;
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="17">${renderEmpty("沒有符合篩選條件的股票")}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${stockCodeLink(row)}</td>
      <td>${escapeHtml(row.name || "--")}</td>
      <td>${escapeHtml(row.industry || "--")}</td>
      <td><div class="factor-concepts">${conceptsText(row)}</div></td>
      <td>${hasNumber(row.close) ? formatNumber(row.close, 2) : "--"}</td>
      <td class="${valueClass(row.changePercent)}">${hasNumber(row.changePercent) ? formatSignedPercent(row.changePercent, 2) : "--"}</td>
      <td>${formatVolume(row.volume)}</td>
      <td>${hasNumber(row.turnoverRate) ? formatPercent(row.turnoverRate, 2) : "--"}</td>
      <td>${factorScoreBadge(row.fundamentalScore)}</td>
      <td>${factorScoreBadge(row.technicalScore)}</td>
      <td>${factorScoreBadge(row.chipScore)}</td>
      <td>${factorScoreBadge(row.turnoverScore)}</td>
      <td class="factor-total-score">${factorScoreBadge(row.computedTotalScore)}</td>
      <td>${tradeTypeBadge(row.tradeType)}</td>
      <td>${riskLabelBadge(row.riskLabel)}</td>
      <td>${escapeHtml(formatDateTime(row.updatedAt))}</td>
    </tr>
  `).join("");
}

function bindFactorFilters() {
  ["factorSearch", "tradeTypeFilter", "factorRiskFilter", "factorSort"].forEach((id) => {
    const element = $(`#${id}`);
    if (!element) return;
    element.addEventListener("input", renderFactorRows);
    element.addEventListener("change", renderFactorRows);
  });
}

async function initFactorScorePage() {
  const loaded = await loadProcessedData(["factor-scores.json"]);
  if (loaded["factor-scores.json"].error) {
    $("#factorTableBody").innerHTML = `<tr><td colspan="17">${renderEmpty("多因子評分資料載入失敗，請確認 data/processed/factor-scores.json 是否存在。")}</td></tr>`;
    $("#factorUpdatedAt").textContent = "資料載入失敗";
    return;
  }

  factorRows = getItems(loaded["factor-scores.json"].data).map(normalizeRow);
  const updatedAt = factorRows.map((row) => row.updatedAt).filter(Boolean).sort().at(-1);
  $("#factorUpdatedAt").textContent = updatedAt ? `資料更新：${formatDateTime(updatedAt)}` : "更新時間未標示";
  bindFactorFilters();
  renderFactorRows();
}

initFactorScorePage().catch((error) => {
  console.error(error);
  $("#factorTableBody").innerHTML = `<tr><td colspan="17">${renderEmpty("多因子評分頁初始化失敗")}</td></tr>`;
  $("#factorUpdatedAt").textContent = "頁面初始化失敗";
});
