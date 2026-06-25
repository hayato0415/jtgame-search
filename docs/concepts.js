const app = document.querySelector("#app");

const state = {
  taxonomy: null,
  categories: [],
  sourceSites: [],
  sourceMap: [],
  rawItems: [],
  aliases: {},
  activeTab: "overview",
  query: "",
};

const TABS = [
  ["overview", "綜合索引"],
  ["listedOtc", "上市 / 上櫃"],
  ["electronics", "電子產業"],
  ["supplyChain", "供應鏈分類"],
  ["themes", "概念股"],
  ["groups", "集團股"],
  ["sourceIndex", "來源別索引"],
  ["todo", "待補資料"],
];

const GROUP_MATCH = {
  listedOtc: ["listed", "otc"],
  electronics: ["electronics"],
  supplyChain: ["supplyChain"],
  themes: ["themes"],
  groups: ["groups"],
};

const CONFIDENCE_LABELS = {
  A: "A 高可信",
  B: "B 多來源確認",
  C: "C 題材觀察",
  D: "D 低可信",
  E: "E 不列入正式分類",
};

const SOURCE_STATUS_LABELS = {
  complete: "complete",
  partial: "partial",
  needs_fill: "needs_fill",
  link_only: "link_only",
  source_unavailable: "source_unavailable",
  blocked: "blocked",
  manual_only: "manual_only",
  mapped: "mapped",
  related: "related",
  needs_mapping: "needs_mapping",
  unavailable: "unavailable",
  ignored: "ignored",
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function loadJson(path, errorMessage) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${errorMessage} (${path} HTTP ${response.status})`);
  return response.json();
}

function detailHref(category) {
  return category.url || `concept-detail.html?id=${encodeURIComponent(category.id)}`;
}

function stockHref(code) {
  return `stock.html?code=${encodeURIComponent(code)}`;
}

function validUrl(url) {
  const text = String(url || "").trim();
  if (!text || text === "#" || /example\.com|demo|test/i.test(text)) return "";
  return text;
}

function sourceName(sourceId) {
  const site = state.sourceSites.find((source) => source.id === sourceId);
  return site?.name || sourceId || "來源";
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "未知";
  return String(value);
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "待補";
  return `${Math.round(value * 100)}%`;
}

function confidenceText(value) {
  return CONFIDENCE_LABELS[value] || `${value || "C"} 待確認`;
}

function formatCoverageStatus(status) {
  const normalized = String(status || "needs_fill").replaceAll("_", "-");
  const text = SOURCE_STATUS_LABELS[status] || status || "needs_fill";
  return `<span class="coverage-badge coverage-${escapeHtml(normalized)}">${escapeHtml(text)}</span>`;
}

function buildSourceChips(sources = []) {
  const items = asArray(sources).filter(Boolean);
  if (!items.length) return `<span class="muted">來源待補</span>`;
  return items.map((source) => `<span class="source-chip">${escapeHtml(source)}</span>`).join("");
}

function categorySearchText(category) {
  const stocks = [...asArray(category.representative_stocks), ...asArray(category.all_stocks)]
    .map((stock) => `${stock.code} ${stock.name}`).join(" ");
  return normalizeText([
    category.id,
    category.name,
    category.type,
    category.display_group,
    asArray(category.aliases).join(" "),
    stocks,
  ].join(" "));
}

function categoryMatches(category, query = state.query) {
  const normalized = normalizeText(query);
  if (!normalized) return true;
  return categorySearchText(category).includes(normalized);
}

function categoriesForPanel(panelId) {
  const groups = GROUP_MATCH[panelId];
  const list = groups
    ? state.categories.filter((category) => groups.includes(category.display_group))
    : state.categories;
  return list.filter(categoryMatches);
}

function sourceBreakdownEntries(category) {
  const breakdown = category.source_breakdown;
  if (!breakdown) return [];
  if (Array.isArray(breakdown)) {
    return breakdown.map((row) => [row.source || row.name || "來源", row]);
  }
  return Object.entries(breakdown);
}

function categoryCoverageLabel(category) {
  const stockCount = Number(category.stock_count ?? asArray(category.all_stocks).length);
  const declared = category.declared_max_source_count;
  if (declared) return `${stockCount} / ${declared} 檔`;
  return `${stockCount} 檔`;
}

function renderConceptIndexRow(category) {
  return `
    <a class="concept-index-row" href="${escapeHtml(detailHref(category))}">
      <div class="concept-index-main">
        <strong>${escapeHtml(category.name)}</strong>
        <span>${escapeHtml(category.type || "分類")}｜${escapeHtml(categoryCoverageLabel(category))}</span>
      </div>
      <div class="concept-index-sources">${buildSourceChips(category.sources)}</div>
      <div class="concept-index-coverage">
        <span>完整度：${escapeHtml(formatPercent(category.coverage_rate))}</span>
        ${formatCoverageStatus(category.coverage_status)}
      </div>
    </a>
  `;
}

function renderConceptLinkList(categories, emptyText = "目前沒有符合條件的分類。") {
  if (!categories.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `<div class="concept-link-list">${categories.map(renderConceptIndexRow).join("")}</div>`;
}

function renderPanelCategories(panelId) {
  return renderConceptLinkList(categoriesForPanel(panelId));
}

function renderOverviewPanel() {
  const groups = [
    ["上市 / 上櫃", categoriesForPanel("listedOtc")],
    ["電子產業", categoriesForPanel("electronics")],
    ["供應鏈分類", categoriesForPanel("supplyChain")],
    ["概念股", categoriesForPanel("themes")],
    ["集團股", categoriesForPanel("groups")],
  ];
  return `
    <section class="concept-panel is-active" data-concept-panel="overview">
      <div class="section-title">
        <h2>綜合索引</h2>
        <span>${state.categories.filter(categoryMatches).length} 個分類</span>
      </div>
      ${groups.map(([label, categories]) => `
        <section class="source-index-section">
          <div class="section-title">
            <h3>${escapeHtml(label)}</h3>
            <span>${categories.length} 筆</span>
          </div>
          ${renderConceptLinkList(categories, `${label} 尚未建立資料。`)}
        </section>
      `).join("")}
    </section>
  `;
}

function mappedNamesForSource(sourceId, statusFilter) {
  return state.sourceMap
    .flatMap((item) => asArray(item.source_mappings)
      .filter((mapping) => mapping.source === sourceId && (!statusFilter || statusFilter.includes(mapping.status)))
      .map((mapping) => item.canonical_name))
    .filter(Boolean);
}

function renderConceptSourceIndex() {
  return `
    <section class="concept-panel" data-concept-panel="sourceIndex">
      <div class="section-title">
        <h2>來源別索引</h2>
        <span>${state.sourceSites.length} 個來源</span>
      </div>
      <div class="source-index-list">
        ${state.sourceSites.map((source) => {
          const mapped = mappedNamesForSource(source.id, ["mapped", "related"]);
          const todo = mappedNamesForSource(source.id, ["needs_mapping", "link_only", "unavailable"]);
          const autoText = source.auto_collect ? "可部分整理" : source.fallback_mode || "link_only";
          return `
            <article class="source-index-section">
              <div class="source-index-head">
                <div>
                  <h3>${escapeHtml(source.name)}</h3>
                  <p>${escapeHtml(asArray(source.purpose).join(" / "))}</p>
                </div>
                <span>${escapeHtml(autoText)}</span>
              </div>
              <div class="source-index-meta">
                <div><strong>${mapped.length}</strong><span>已對應題材</span></div>
                <div><strong>${todo.length}</strong><span>待對應題材</span></div>
                <div><strong>${source.auto_collect ? "YES" : "NO"}</strong><span>auto_collect</span></div>
              </div>
              <div class="concept-chip-row">
                ${mapped.slice(0, 8).map((name) => `<span class="source-chip">${escapeHtml(name)}</span>`).join("") || `<span class="muted">尚無已對應題材</span>`}
              </div>
              <div class="concept-chip-row">
                ${todo.slice(0, 8).map((name) => `<span class="source-chip source-chip-warn">${escapeHtml(name)}</span>`).join("") || `<span class="muted">待對應清單暫空</span>`}
              </div>
              <a class="source-link-button" href="${escapeHtml(source.url)}" target="_blank" rel="noopener">開啟來源網站</a>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function todoRows() {
  const rows = [];
  for (const row of state.rawItems) {
    if (["needs_fill", "partial", "link_only", "source_unavailable", "blocked"].includes(row.collection_status)) {
      const canonical = state.sourceMap.find((item) => item.canonical_id === row.canonical_id);
      rows.push({
        canonical: canonical?.canonical_name || row.canonical_id || "來源索引",
        source: row.source_name || sourceName(row.source),
        sourceCategory: row.source_category_name || row.source_group || "-",
        declared: row.declared_stock_count,
        collected: row.collected_stock_count,
        status: row.collection_status,
        url: row.url,
        action: row.collection_status === "partial" ? "補齊剩餘成分股" :
          row.collection_status === "link_only" ? "維持外部查看，待穩定來源再整理" :
          "補齊來源成分股",
      });
    }
  }
  for (const item of state.sourceMap) {
    for (const mapping of asArray(item.source_mappings)) {
      if (["needs_mapping", "link_only", "unavailable"].includes(mapping.status)) {
        rows.push({
          canonical: item.canonical_name,
          source: sourceName(mapping.source),
          sourceCategory: mapping.source_name || "-",
          declared: null,
          collected: 0,
          status: mapping.status,
          url: mapping.url,
          action: mapping.status === "needs_mapping" ? "建立來源分類對照" : "保留外部連結",
        });
      }
    }
  }
  return rows;
}

function renderConceptTodoList() {
  const rows = todoRows();
  return `
    <section class="concept-panel" data-concept-panel="todo">
      <div class="section-title">
        <h2>待補資料</h2>
        <span>${rows.length} 筆</span>
      </div>
      <div class="table-wrap">
        <table class="todo-source-table">
          <thead>
            <tr>
              <th>正式題材</th>
              <th>來源網站</th>
              <th>來源名稱</th>
              <th>宣稱檔數</th>
              <th>已整理檔數</th>
              <th>缺漏狀態</th>
              <th>外部連結</th>
              <th>建議動作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td data-label="正式題材">${escapeHtml(row.canonical)}</td>
                <td data-label="來源網站">${escapeHtml(row.source)}</td>
                <td data-label="來源名稱">${escapeHtml(row.sourceCategory)}</td>
                <td data-label="宣稱檔數">${escapeHtml(formatCount(row.declared))}</td>
                <td data-label="已整理檔數">${escapeHtml(formatCount(row.collected))}</td>
                <td data-label="缺漏狀態">${formatCoverageStatus(row.status)}</td>
                <td data-label="外部連結">${validUrl(row.url) ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">開啟</a>` : "待補"}</td>
                <td data-label="建議動作">${escapeHtml(row.action)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSearchResults() {
  const root = document.querySelector("#conceptSearchResults");
  if (!root) return;
  const query = state.query.trim();
  if (!query) {
    root.innerHTML = "";
    return;
  }
  const results = state.categories.filter((category) => categoryMatches(category, query));
  root.innerHTML = `
    <section class="concept-panel is-active">
      <div class="section-title">
        <h2>搜尋結果</h2>
        <span>${results.length} 筆</span>
      </div>
      ${renderConceptLinkList(results, "找不到符合的產業、題材或股票。")}
    </section>
  `;
}

function initConceptTabs() {
  const tabs = Array.from(document.querySelectorAll(".concept-tab"));
  const panels = Array.from(document.querySelectorAll(".concept-panel[data-concept-panel]"));
  if (!tabs.length) return;
  const ids = new Set(TABS.map(([id]) => id));

  const activate = (tabId, updateHash = true) => {
    const target = ids.has(tabId) ? tabId : "overview";
    state.activeTab = target;
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.conceptTab === target));
    panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.conceptPanel === target));
    if (updateHash && window.location.hash.slice(1) !== target) {
      history.replaceState(null, "", `#${target}`);
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.conceptTab || "overview"));
  });
  const hash = window.location.hash.replace("#", "");
  activate(hash || "overview", Boolean(hash));
  window.addEventListener("hashchange", () => activate(window.location.hash.replace("#", "") || "overview", false));
}

function initConceptSearch() {
  const input = document.querySelector("#conceptSearchInput");
  if (!input) return;
  input.addEventListener("input", (event) => {
    state.query = event.target.value || "";
    renderSearchResults();
    document.querySelectorAll("[data-concept-panel='overview']").forEach((panel) => {
      panel.outerHTML = renderOverviewPanel();
    });
    for (const panelId of ["listedOtc", "electronics", "supplyChain", "themes", "groups"]) {
      const panel = document.querySelector(`[data-concept-panel="${panelId}"]`);
      if (panel) {
        panel.querySelector(".concept-link-list, .empty")?.remove();
        panel.insertAdjacentHTML("beforeend", renderPanelCategories(panelId));
      }
    }
    initConceptTabs();
    const nextInput = document.querySelector("#conceptSearchInput");
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(state.query.length, state.query.length);
    }
  });
}

function renderConceptOverview() {
  app.innerHTML = `
    <section class="concept-index-layout">
      <div class="concept-overview-header">
        <div>
          <h1>產業題材庫</h1>
          <p>整合 MoneyDJ、玩股網、Yahoo 股市、PChome、CMoney 的類股 / 產業 / 概念股來源索引；來源不穩定時採 link_only，不讓頁面壞掉。</p>
        </div>
        <span>更新：${escapeHtml(state.taxonomy?.generated_at || "-")}</span>
      </div>

      <div class="concept-search-bar">
        <input id="conceptSearchInput" type="search" placeholder="輸入產業、題材、股票代號或名稱" value="${escapeHtml(state.query)}">
      </div>

      <nav class="concept-tabs" aria-label="產業題材分類">
        ${TABS.map(([id, label]) => `
          <button class="concept-tab ${state.activeTab === id ? "is-active" : ""}" type="button" data-concept-tab="${id}">
            ${escapeHtml(label)}
          </button>
        `).join("")}
      </nav>

      <div id="conceptSearchResults"></div>

      ${renderOverviewPanel()}
      ${["listedOtc", "electronics", "supplyChain", "themes", "groups"].map((panelId) => `
        <section class="concept-panel" data-concept-panel="${panelId}">
          <div class="section-title">
            <h2>${escapeHtml(TABS.find(([id]) => id === panelId)?.[1] || panelId)}</h2>
            <span>${categoriesForPanel(panelId).length} 筆</span>
          </div>
          ${renderPanelCategories(panelId)}
        </section>
      `).join("")}
      ${renderConceptSourceIndex()}
      ${renderConceptTodoList()}
    </section>
  `;
  initConceptTabs();
  initConceptSearch();
  renderSearchResults();
}

function renderStockChips(stocks = []) {
  if (!stocks.length) return `<span class="muted">代表股待補</span>`;
  return stocks.map((stock) =>
    `<a class="concept-chip stock-chip" href="${stockHref(stock.code)}">${escapeHtml(stock.code)} ${escapeHtml(stock.name)}</a>`
  ).join("");
}

function renderSourceBreakdown(category) {
  const rows = sourceBreakdownEntries(category);
  if (!rows.length) return `<div class="empty">來源比對資料待補。</div>`;
  return `
    <div class="table-wrap">
      <table class="concept-source-table">
        <thead>
          <tr>
            <th>來源網站</th>
            <th>來源分類名稱</th>
            <th>宣稱檔數</th>
            <th>已整理檔數</th>
            <th>狀態</th>
            <th>外部連結</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([sourceNameText, row]) => `
            <tr>
              <td data-label="來源網站">${escapeHtml(sourceNameText)}</td>
              <td data-label="來源分類名稱">${escapeHtml(row.source_category_name || "-")}</td>
              <td data-label="宣稱檔數">${escapeHtml(formatCount(row.declared_stock_count))}</td>
              <td data-label="已整理檔數">${escapeHtml(formatCount(row.collected_stock_count))}</td>
              <td data-label="狀態">${formatCoverageStatus(row.collection_status)}</td>
              <td data-label="外部連結">${validUrl(row.url) ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">開啟</a>` : "待補"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDetailStockTable(stocks = []) {
  if (!stocks.length) return `<div class="empty">完整成分股尚未整理，請先查看來源比對與外部連結。</div>`;
  return `
    <div class="table-wrap">
      <table class="concept-stock-table">
        <thead>
          <tr>
            <th>股票代號</th>
            <th>股票名稱</th>
            <th>上市 / 上櫃</th>
            <th>來源</th>
            <th>來源數</th>
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
              <td data-label="來源">${escapeHtml(asArray(stock.sources).join("、") || "-")}</td>
              <td data-label="來源數">${escapeHtml(stock.source_count || 0)}</td>
              <td data-label="可信度">${escapeHtml(confidenceText(stock.confidence))}</td>
              <td data-label="資料品質">${escapeHtml(stock.data_quality || "-")}</td>
              <td data-label="驗證依據">${escapeHtml(asArray(stock.evidence).join("、") || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDetailSourceLinks(category) {
  const rows = sourceBreakdownEntries(category).filter(([, row]) => validUrl(row.url));
  if (!rows.length) return `<span class="muted">外部來源連結待補</span>`;
  return rows.map(([name, row]) => `
    <a class="source-link-button" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">
      ${escapeHtml(name)}：${escapeHtml(row.source_category_name || "來源頁")}
    </a>
  `).join("");
}

async function renderConceptDetail() {
  const id = new URLSearchParams(window.location.search).get("id") || "";
  const category = state.categories.find((item) => item.id === id);
  if (!category) {
    app.innerHTML = `
      <section class="panel">
        <div class="section-title"><h2>找不到此題材資料</h2><span>${escapeHtml(id || "未指定 id")}</span></div>
        <p class="mode-note">請回到產業題材庫重新選擇分類。</p>
        <a class="solid-link" href="concepts.html">回到產業題材庫</a>
      </section>
    `;
    return;
  }

  app.innerHTML = `
    <section class="panel concept-detail-layout">
      <a class="secondary-link" href="concepts.html#${escapeHtml(category.display_group || "overview")}">← 回到產業題材庫</a>
      <div class="section-title">
        <div>
          <h2>${escapeHtml(category.name)}</h2>
          <p class="mode-note">${escapeHtml(category.type || "分類")}</p>
        </div>
        <span>更新：${escapeHtml(state.taxonomy?.generated_at || "-")}</span>
      </div>
      <div class="concept-detail-summary">
        <div><span>來源數</span><strong>${escapeHtml(category.source_count ?? asArray(category.sources).length ?? 0)}</strong></div>
        <div><span>成分股數</span><strong>${escapeHtml(category.stock_count ?? asArray(category.all_stocks).length ?? 0)}</strong></div>
        <div><span>主要來源最大檔數</span><strong>${escapeHtml(formatCount(category.declared_max_source_count))}</strong></div>
        <div><span>完整度</span><strong>${escapeHtml(formatPercent(category.coverage_rate))}</strong></div>
      </div>
      <div class="concept-detail-block">
        <h3>資料狀態</h3>
        <p>${formatCoverageStatus(category.coverage_status)} <span class="muted">可信度：${escapeHtml(confidenceText(category.confidence))}</span></p>
      </div>
      <div class="concept-detail-block">
        <h3>代表股</h3>
        <div class="concept-chip-row">${renderStockChips(category.representative_stocks)}</div>
      </div>
      <div class="concept-detail-block">
        <h3>同義詞</h3>
        <div class="concept-chip-row">${asArray(category.aliases).map((alias) => `<span class="concept-chip">${escapeHtml(alias)}</span>`).join("") || `<span class="muted">同義詞待補</span>`}</div>
      </div>
      <div class="concept-detail-block">
        <h3>外部來源連結</h3>
        <div class="concept-chip-row">${renderDetailSourceLinks(category)}</div>
      </div>
      <div class="concept-detail-block">
        <h3>來源比對</h3>
        ${renderSourceBreakdown(category)}
      </div>
      <div class="concept-detail-block">
        <h3>完整成分股</h3>
        ${renderDetailStockTable(category.all_stocks)}
      </div>
    </section>
  `;
}

function renderLoadError(message, detail) {
  app.innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>產業題材庫</h2><span>資料載入失敗</span></div>
      <div class="error">${escapeHtml(message)}${detail ? `<br>${escapeHtml(detail)}` : ""}</div>
    </section>
  `;
}

async function bootConcepts() {
  try {
    const [taxonomy, sourceSites, sourceMap, raw, aliases] = await Promise.all([
      loadJson("data/concepts-taxonomy.json", "產業題材資料載入失敗，請確認 docs/data/concepts-taxonomy.json 是否存在。"),
      loadJson("data/source-sites.json", "來源網站資料載入失敗，請確認 docs/data/source-sites.json 是否存在。"),
      loadJson("data/source-category-map.json", "來源對照資料載入失敗，請確認 docs/data/source-category-map.json 是否存在。"),
      loadJson("data/source-category-raw.json", "來源原始資料載入失敗，請確認 docs/data/source-category-raw.json 是否存在。"),
      loadJson("data/concept-aliases.json", "同義詞資料載入失敗，請確認 docs/data/concept-aliases.json 是否存在。"),
    ]);
    state.taxonomy = taxonomy;
    state.categories = asArray(taxonomy.categories);
    state.sourceSites = asArray(sourceSites.sources);
    state.sourceMap = asArray(sourceMap.items);
    state.rawItems = asArray(raw.items);
    state.aliases = aliases.items || {};
    if (!state.categories.length) throw new Error("產業題材資料載入失敗，請確認 docs/data/concepts-taxonomy.json 是否存在。");

    const page = document.body.dataset.page || "concepts";
    if (page === "concept-detail") {
      await renderConceptDetail();
    } else {
      state.query = new URLSearchParams(window.location.search).get("q") || "";
      renderConceptOverview();
    }
  } catch (error) {
    const message = String(error.message || error);
    if (message.includes("source-sites")) {
      renderLoadError("來源網站資料載入失敗，請確認 docs/data/source-sites.json 是否存在。", message);
    } else if (message.includes("source-category-map")) {
      renderLoadError("來源對照資料載入失敗，請確認 docs/data/source-category-map.json 是否存在。", message);
    } else {
      renderLoadError("產業題材資料載入失敗，請確認 docs/data/concepts-taxonomy.json 是否存在。", message);
    }
  }
}

bootConcepts();
