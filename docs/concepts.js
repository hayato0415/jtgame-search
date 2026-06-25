const app = document.querySelector("#app");

const TAXONOMY_VERSION = "20260625-taxonomy-v1";

const state = {
  taxonomy: null,
  categories: [],
  activeType: "official_industry",
  query: "",
  confidence: "all",
  market: "listed",
  expandedId: "",
};

const TYPE_LABELS = {
  official_industry: "官方產業",
  supply_chain: "供應鏈分類",
  market_theme: "市場題材",
};

const CONFIDENCE_LABELS = {
  A: "A 高可信",
  B: "B 多來源確認",
  C: "C 題材觀察",
  D: "D 低可信",
  E: "E 不列入正式分類",
};

const QUALITY_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function stockHref(code) {
  return `stock.html?code=${encodeURIComponent(code)}`;
}

function confidenceLabel(value) {
  return CONFIDENCE_LABELS[value] || `${value || "-"} 待確認`;
}

function qualityLabel(value) {
  return QUALITY_LABELS[value] || "待確認";
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

function categorySourceCount(category) {
  if (Number.isFinite(Number(category.source_count))) return Number(category.source_count);
  return Array.isArray(category.sources) ? category.sources.filter((source) => source?.name).length : 0;
}

function representativeStocks(category, limit = 5) {
  return (category.stocks || []).slice(0, limit);
}

function categoryMatches(category) {
  const query = normalizeText(state.query);
  const stocksText = (category.stocks || [])
    .map((stock) => `${stock.code} ${stock.name} ${stock.official_industry || ""} ${stock.supply_chain || ""} ${stock.market_theme || ""}`)
    .join(" ");
  const haystack = normalizeText([
    category.name,
    category.id,
    category.type,
    category.description,
    category.parent_industry,
    (category.parent_supply_chain || []).join(" "),
    stocksText,
  ].join(" "));
  if (query && !haystack.includes(query)) return false;
  if (state.activeType !== "all" && category.type !== state.activeType) return false;
  if (state.confidence !== "all" && category.source_confidence !== state.confidence) return false;
  if (state.market !== "all") {
    const target = state.market === "listed" ? "上市" : "上櫃";
    if (!(category.stocks || []).some((stock) => stock.market === target)) return false;
  }
  return true;
}

function filteredCategories() {
  return state.categories.filter(categoryMatches);
}

function filteredStocks(category) {
  if (state.market === "all") return category.stocks || [];
  const target = state.market === "listed" ? "上市" : "上櫃";
  return (category.stocks || []).filter((stock) => stock.market === target);
}

function renderTypeTabs() {
  const tabs = [
    ["official_industry", "官方產業"],
    ["supply_chain", "供應鏈分類"],
    ["market_theme", "市場題材"],
  ];
  return `
    <nav class="concept-tabs" aria-label="概念股資料分類">
      ${tabs.map(([type, label]) => `
        <button class="concept-tab ${state.activeType === type ? "is-active" : ""}" type="button" data-type="${type}">
          ${escapeHtml(label)}
        </button>
      `).join("")}
    </nav>
  `;
}

function renderSources(sources = []) {
  const valid = sources.filter((source) => source?.name);
  if (!valid.length) return `<span class="muted">來源待補</span>`;
  return valid.map((source) => {
    const name = escapeHtml(source.name);
    const url = String(source.url || "").trim();
    if (!url) return `<span class="concept-source">${name}</span>`;
    return `<a class="concept-source" href="${escapeHtml(url)}" target="_blank" rel="noopener">${name}</a>`;
  }).join("");
}

function renderEvidence(evidence = []) {
  if (!Array.isArray(evidence) || !evidence.length) return `<span class="muted">驗證依據待補</span>`;
  return evidence.map((item) => `<span class="concept-chip">${escapeHtml(item)}</span>`).join("");
}

function renderStockTable(category) {
  const stocks = filteredStocks(category);
  if (!stocks.length) {
    return `<div class="empty">此分類目前沒有符合市場篩選的成分股。</div>`;
  }
  return `
    <div class="table-wrap">
      <table class="concept-taxonomy-table">
        <thead>
          <tr>
            <th>股票代號</th>
            <th>股票名稱</th>
            <th>上市 / 上櫃</th>
            <th>官方產業</th>
            <th>供應鏈分類</th>
            <th>市場題材</th>
            <th>可信度</th>
            <th>資料品質</th>
            <th>驗證依據</th>
          </tr>
        </thead>
        <tbody>
          ${stocks.map((stock) => `
            <tr>
              <td data-label="股票代號"><a class="stock-link" href="${stockHref(stock.code)}">${escapeHtml(stock.code)}</a></td>
              <td data-label="股票名稱"><a class="stock-link" href="${stockHref(stock.code)}">${escapeHtml(stock.name)}</a></td>
              <td data-label="上市 / 上櫃">${escapeHtml(stock.market || "-")}</td>
              <td data-label="官方產業">${escapeHtml(stock.official_industry || category.parent_industry || (category.type === "official_industry" ? category.name : "-"))}</td>
              <td data-label="供應鏈分類">${escapeHtml(stock.supply_chain || (category.type === "supply_chain" ? category.name : "-"))}</td>
              <td data-label="市場題材">${escapeHtml(stock.market_theme || (category.type === "market_theme" ? category.name : "-"))}</td>
              <td data-label="可信度"><span class="confidence-badge confidence-${escapeHtml(stock.confidence || category.source_confidence || "C")}">${escapeHtml(confidenceLabel(stock.confidence || category.source_confidence))}</span></td>
              <td data-label="資料品質">${escapeHtml(qualityLabel(stock.data_quality || category.data_quality))}</td>
              <td data-label="驗證依據"><div class="concept-chip-row">${renderEvidence(stock.evidence)}</div></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCategoryCard(category) {
  const isExpanded = state.expandedId === category.id;
  const stocks = filteredStocks(category);
  const sourceCount = categorySourceCount(category);
  const reps = representativeStocks(category).map((stock) => `
    <a class="concept-chip stock-chip" href="${stockHref(stock.code)}">${escapeHtml(stock.code)} ${escapeHtml(stock.name)}</a>
  `).join("") || `<span class="muted">代表股待補</span>`;
  return `
    <article class="concept-taxonomy-card ${isExpanded ? "is-expanded" : ""}">
      <div class="concept-card-head">
        <div>
          <p class="concept-type">${escapeHtml(TYPE_LABELS[category.type] || category.type)}</p>
          <h3>${escapeHtml(category.name)}</h3>
        </div>
        <span class="confidence-badge confidence-${escapeHtml(category.source_confidence || "C")}">${escapeHtml(confidenceLabel(category.source_confidence))}</span>
      </div>
      <p class="concept-description">${escapeHtml(category.description || "說明待補")}</p>
      <div class="concept-meta-grid">
        <div><span>來源數</span><strong>${sourceCount}</strong></div>
        <div><span>成分股數</span><strong>${stocks.length}</strong></div>
        <div><span>資料品質</span><strong>${escapeHtml(qualityLabel(category.data_quality))}</strong></div>
        <div><span>最後更新</span><strong>${escapeHtml(state.taxonomy?.generated_at || "-")}</strong></div>
      </div>
      <div class="concept-card-block">
        <strong>代表股</strong>
        <div class="concept-chip-row">${reps}</div>
      </div>
      <div class="concept-card-block">
        <strong>資料來源</strong>
        <div class="concept-source-row">${renderSources(category.sources)}</div>
      </div>
      <button class="concept-expand" type="button" data-id="${escapeHtml(category.id)}">${isExpanded ? "收合成分股" : "展開成分股"}</button>
      <div class="concept-card-detail">
        ${renderStockTable(category)}
      </div>
    </article>
  `;
}

function renderConcepts() {
  const categories = filteredCategories();
  app.innerHTML = `
    <section class="panel concept-taxonomy-hero">
      <div class="section-title">
        <div>
          <h2>概念股資料庫</h2>
          <p class="mode-note">將公司資料拆成官方產業、供應鏈分類與市場題材三層，避免把短線題材誤認為公司本業。</p>
        </div>
        <span>更新：${escapeHtml(state.taxonomy?.generated_at || "-")}</span>
      </div>
      ${renderTypeTabs()}
      <div class="concept-policy-grid">
        <div><strong>官方產業</strong><span>${escapeHtml(state.taxonomy?.source_policy?.official_industry || "以官方資料為優先")}</span></div>
        <div><strong>供應鏈分類</strong><span>${escapeHtml(state.taxonomy?.source_policy?.supply_chain || "以產業資料與公司資料為依據")}</span></div>
        <div><strong>市場題材</strong><span>${escapeHtml(state.taxonomy?.source_policy?.market_theme || "需交叉驗證")}</span></div>
      </div>
      <div class="filters concept-taxonomy-filters">
        <label>搜尋<input id="conceptSearch" value="${escapeHtml(state.query)}" placeholder="輸入題材、產業、股票代號或名稱"></label>
        <label>分類
          <select id="typeFilter">
            <option value="all">全部</option>
            <option value="official_industry">官方產業</option>
            <option value="supply_chain">供應鏈分類</option>
            <option value="market_theme">市場題材</option>
          </select>
        </label>
        <label>可信度
          <select id="confidenceFilter">
            <option value="all">全部</option>
            <option value="A">A 高可信</option>
            <option value="B">B 多來源確認</option>
            <option value="C">C 題材觀察</option>
            <option value="D">D 低可信</option>
          </select>
        </label>
        <label>市場
          <select id="marketFilter">
            <option value="listed">上市</option>
            <option value="all">全部</option>
            <option value="otc">上櫃</option>
          </select>
        </label>
      </div>
    </section>
    <section class="panel">
      <div class="section-title">
        <h2>${escapeHtml(TYPE_LABELS[state.activeType] || "全部分類")}</h2>
        <span>${categories.length} 個分類</span>
      </div>
      <div class="concept-taxonomy-list">
        ${categories.map(renderCategoryCard).join("") || `<div class="empty">目前沒有符合條件的分類。</div>`}
      </div>
    </section>
  `;
  bindControls();
}

function bindControls() {
  document.querySelectorAll(".concept-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeType = button.dataset.type || "official_industry";
      state.expandedId = "";
      renderConcepts();
    });
  });
  const typeFilter = document.querySelector("#typeFilter");
  const confidenceFilter = document.querySelector("#confidenceFilter");
  const marketFilter = document.querySelector("#marketFilter");
  const search = document.querySelector("#conceptSearch");
  if (typeFilter) typeFilter.value = state.activeType;
  if (confidenceFilter) confidenceFilter.value = state.confidence;
  if (marketFilter) marketFilter.value = state.market;
  if (search) {
    search.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderConcepts();
      const nextSearch = document.querySelector("#conceptSearch");
      if (nextSearch) {
        nextSearch.focus();
        nextSearch.setSelectionRange(state.query.length, state.query.length);
      }
    });
  }
  if (typeFilter) {
    typeFilter.addEventListener("change", (event) => {
      state.activeType = event.target.value;
      state.expandedId = "";
      renderConcepts();
    });
  }
  if (confidenceFilter) {
    confidenceFilter.addEventListener("change", (event) => {
      state.confidence = event.target.value;
      state.expandedId = "";
      renderConcepts();
    });
  }
  if (marketFilter) {
    marketFilter.addEventListener("change", (event) => {
      state.market = event.target.value;
      state.expandedId = "";
      renderConcepts();
    });
  }
  document.querySelectorAll(".concept-expand").forEach((button) => {
    button.addEventListener("click", () => {
      state.expandedId = state.expandedId === button.dataset.id ? "" : button.dataset.id;
      renderConcepts();
    });
  });
}

async function bootConcepts() {
  try {
    const taxonomy = await loadJson("data/concepts-taxonomy.json");
    state.taxonomy = taxonomy;
    state.categories = Array.isArray(taxonomy.categories) ? taxonomy.categories : [];
    if (!state.categories.length) throw new Error("concepts-taxonomy.json 沒有 categories");
    const query = new URLSearchParams(window.location.search).get("q") || "";
    state.query = query.trim();
    renderConcepts();
  } catch (error) {
    app.innerHTML = `
      <section class="panel">
        <div class="section-title"><h2>概念股資料庫</h2><span>資料載入失敗</span></div>
        <div class="error">無法載入三層分類資料：${escapeHtml(error.message)}。請確認 docs/data/concepts-taxonomy.json 是否存在。</div>
      </section>
    `;
  }
}

bootConcepts();
