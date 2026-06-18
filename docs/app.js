const HOLDINGS_KEY = "asurada_holdings";
const WATCHLIST_KEY = "asurada_watchlist";

const state = {
  stocks: [],
  news: [],
  themes: [],
  technical: {},
  profiles: {},
};

const mainThemes = ["AI", "半導體", "記憶體", "PCB", "CPO", "光通訊", "散熱", "電源", "低軌衛星", "玻璃基板", "被動元件", "機器人", "重電", "軍工"];
const defensiveThemes = ["營建", "資產", "都更", "金融", "壽險", "銀行"];
const constructionThemes = ["營建", "資產", "都更"];
const financeThemes = ["金融", "壽險", "銀行"];

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toNumber(value) {
  if (value === null || value === undefined) return NaN;
  const text = String(value).replace(/[,%+張億元萬元]/g, "").trim();
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\.(TW|TWO)$/i, "");
}

function parseCodes(text) {
  const seen = new Set();
  return String(text || "")
    .split(/[\s,\uFF0C\u3001]+/)
    .map(normalizeCode)
    .filter((code) => {
      if (!code || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
}

function readStoredCodes(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(normalizeCode).filter(Boolean);
    if (Array.isArray(parsed.codes)) return parsed.codes.map(normalizeCode).filter(Boolean);
  } catch {
    return parseCodes(raw);
  }
  return [];
}

function writeStoredCodes(key, codes) {
  localStorage.setItem(key, JSON.stringify({ codes }));
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Failed to load ${path}`, error);
    return fallback;
  }
}

async function loadAllData() {
  const [stocks, news, themes, technical, profiles] = await Promise.all([
    loadJson("data/stocks-latest.json", []),
    loadJson("data/news-events.json", []),
    loadJson("data/themes-map.json", []),
    loadJson("data/technical-latest.json", {}),
    loadJson("data/stock-profiles.json", {}),
  ]);
  state.stocks = Array.isArray(stocks) ? stocks : [];
  state.news = Array.isArray(news) ? news : [];
  state.themes = Array.isArray(themes) ? themes : [];
  state.technical = technical && typeof technical === "object" ? technical : {};
  state.profiles = profiles && typeof profiles === "object" ? profiles : {};
}

function stockByCode(code) {
  return state.stocks.find((stock) => normalizeCode(stock.code) === normalizeCode(code));
}

function stockName(code) {
  const stock = stockByCode(code);
  return stock ? `${stock.code} ${stock.name}` : normalizeCode(code);
}

function conceptIncludes(stock, keywords) {
  const concept = String(stock?.concept || "").toUpperCase();
  return keywords.some((keyword) => concept.includes(String(keyword).toUpperCase()));
}

function eventCodes() {
  return new Set(state.news.flatMap((event) => event.related_stocks || []).map(normalizeCode));
}

function radarModeInfo(stock, mode = "main") {
  const score = toNumber(stock.score);
  const volume = toNumber(stock.volume);
  const dailyChange = toNumber(stock.daily_change);
  const isConstruction = conceptIncludes(stock, constructionThemes);
  const isFinance = conceptIncludes(stock, financeThemes);
  const isDefensive = isConstruction || isFinance;
  const isMainTheme = conceptIncludes(stock, mainThemes);
  const penalty = Math.max(isConstruction ? 10 : 0, isFinance ? 15 : 0);
  const cancelPenalty = volume > 3000 || eventCodes().has(normalizeCode(stock.code)) || dailyChange > 3;
  const downgraded = mode === "main" && isDefensive && penalty > 0 && !cancelPenalty;
  return {
    isMainTheme,
    isDefensive,
    downgraded,
    displayScore: downgraded ? Math.max(0, score - penalty) : score,
  };
}

function sortedStocks(mode = "main", input = state.stocks) {
  const list = [...input];
  if (mode === "defensive") {
    return list
      .filter((stock) => radarModeInfo(stock, mode).isDefensive)
      .sort((a, b) =>
        toNumber(b.score) - toNumber(a.score) ||
        toNumber(b.volume) - toNumber(a.volume) ||
        toNumber(b.revenue_yoy) - toNumber(a.revenue_yoy) ||
        toNumber(b.revenue_mom) - toNumber(a.revenue_mom) ||
        toNumber(a.rank) - toNumber(b.rank)
      );
  }
  if (mode === "market") {
    return list.sort((a, b) => toNumber(a.rank) - toNumber(b.rank));
  }
  return list.sort((a, b) => {
    const ai = radarModeInfo(a, mode);
    const bi = radarModeInfo(b, mode);
    return Number(bi.isMainTheme) - Number(ai.isMainTheme) || bi.displayScore - ai.displayScore || toNumber(a.rank) - toNumber(b.rank);
  });
}

function chip(text, tone = "") {
  return `<span class="chip ${tone}">${escapeHtml(text)}</span>`;
}

function stockChips(codes, emptyText = "無") {
  const normalized = (codes || []).map(normalizeCode).filter(Boolean);
  if (!normalized.length) return chip(emptyText);
  return normalized.map((code) => `<a class="chip stock-link" href="stock.html?code=${encodeURIComponent(code)}">${escapeHtml(stockName(code))}</a>`).join("");
}

function stockCard(stock, mode = "main") {
  const info = radarModeInfo(stock, mode);
  const modeName = mode === "market" ? "全市場" : mode === "defensive" ? "資產防守" : "主升段";
  return `
    <article class="card stock-card">
      <div class="section-title">
        <h3><a class="stock-link" href="stock.html?code=${encodeURIComponent(stock.code)}">#${escapeHtml(stock.rank)} ${escapeHtml(stock.code)} ${escapeHtml(stock.name)}</a></h3>
        ${chip(stock.rating || "-", "good")}
      </div>
      <div class="grid cols-4">
        <div class="metric"><span>雷達強度</span><strong>${Number.isFinite(info.displayScore) ? info.displayScore.toFixed(1) : "-"}</strong></div>
        <div class="metric"><span>收盤價</span><strong>${escapeHtml(stock.close)}</strong></div>
        <div class="metric"><span>成交量</span><strong>${escapeHtml(stock.volume)} 張</strong></div>
        <div class="metric"><span>雷達模式</span><strong>${escapeHtml(modeName)}</strong></div>
      </div>
      ${info.downgraded ? `<p class="penalty-note">主升段模式降權：族群非當前高動能主流，需等待政策、利率或量價確認。</p>` : ""}
      <div class="grid cols-4">
        <div class="metric"><span>當月營收</span><strong>${escapeHtml(stock.current_revenue)}</strong></div>
        <div class="metric"><span>營收月增</span><strong>${escapeHtml(stock.revenue_mom)}</strong></div>
        <div class="metric"><span>去年同月營收</span><strong>${escapeHtml(stock.previous_year_revenue)}</strong></div>
        <div class="metric"><span>營收年增</span><strong>${escapeHtml(stock.revenue_yoy)}</strong></div>
      </div>
      <p><span class="label">概念股</span>${escapeHtml(stock.concept || "-")}</p>
      <p><span class="label">入選理由</span>${escapeHtml(stock.reason || "-")}</p>
      <div class="chip-row">${String(stock.risk_tags || "一般觀察").split("、").map((x) => chip(x)).join("")}</div>
    </article>
  `;
}

function stockTable(stocks, mode = "main") {
  if (!stocks.length) return `<div class="empty">沒有符合條件的股票</div>`;
  const rows = stocks.map((stock) => {
    const info = radarModeInfo(stock, mode);
    return `
      <tr>
        <td>${escapeHtml(stock.rank)}</td>
        <td><a class="stock-link" href="stock.html?code=${encodeURIComponent(stock.code)}">${escapeHtml(stock.code)}</a></td>
        <td>${escapeHtml(stock.name)}</td>
        <td>${escapeHtml(stock.concept)}</td>
        <td>${Number.isFinite(info.displayScore) ? info.displayScore.toFixed(1) : "-"}${info.downgraded ? "<br><span class=\"chip warn\">降權</span>" : ""}</td>
        <td>${escapeHtml(stock.rating)}</td>
        <td>${escapeHtml(stock.close)}</td>
        <td>${escapeHtml(stock.volume)}</td>
        <td>${escapeHtml(stock.current_revenue)}</td>
        <td>${escapeHtml(stock.revenue_mom)}</td>
        <td>${escapeHtml(stock.revenue_yoy)}</td>
        <td>${escapeHtml(stock.reason)}</td>
      </tr>
    `;
  }).join("");
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>排名</th><th>代號</th><th>名稱</th><th>概念股</th><th>雷達強度</th><th>等級</th><th>收盤價</th><th>成交量</th><th>當月營收</th><th>營收月增</th><th>營收年增</th><th>入選理由</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function eventCard(event) {
  const holdings = new Set(readStoredCodes(HOLDINGS_KEY));
  const related = (event.related_stocks || []).map(normalizeCode).filter(Boolean);
  const radarHits = related.filter((code) => stockByCode(code));
  const holdingHits = related.filter((code) => holdings.has(code));
  const impactTone = event.impact === "偏多" ? "good" : event.impact === "偏空" ? "bad" : "";
  return `
    <article class="card news-card" data-region="${escapeHtml(event.region || "")}" data-category="${escapeHtml(event.category || "")}" data-holding-hit="${holdingHits.length ? "1" : "0"}">
      <div class="chip-row">
        ${chip(event.date || "日期未標示")}
        ${chip(event.region || "地區未標示")}
        ${chip(`題材：${event.category || "未分類"}`)}
        ${chip(`事件強度：${event.event_strength || "未標示"}`, event.event_strength === "高" ? "warn" : "")}
        ${chip(`影響方向：${event.impact || "中性"}`, impactTone)}
      </div>
      <h3>${escapeHtml(event.title || "未命名事件")}</h3>
      <p><span class="label">新聞摘要</span>${escapeHtml(event.summary || event.logic || "尚無摘要")}</p>
      <p class="analysis"><span class="label">阿斯拉連動分析</span>${escapeHtml(event.asurada_analysis || event.logic || "尚無連動分析")}</p>
      <p><span class="label">相關台股代號與名稱</span></p>
      <div class="chip-row">${stockChips(related, "無相關台股")}</div>
      <p><span class="label">雷達命中</span></p>
      <div class="chip-row">${stockChips(radarHits, "未命中今日雷達")}</div>
      <p><span class="label">持股命中</span></p>
      <div class="chip-row">${stockChips(holdingHits, "未命中我的持股")}</div>
      ${event.url ? `<a class="solid-link" href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">查看來源</a>` : ""}
    </article>
  `;
}

function renderHeader(active) {
  const nav = [
    ["index.html", "首頁", "index"],
    ["radar.html", "全股雷達", "radar"],
    ["news.html", "重大新聞", "news"],
    ["themes.html", "題材概念股", "themes"],
    ["stock.html", "個股查詢", "stock"],
    ["portfolio.html", "我的持股", "portfolio"],
  ];
  const el = $("#siteHeader");
  if (!el) return;
  el.innerHTML = `
    <div class="site-header">
      <h1>阿斯拉台股月營收轉強雷達</h1>
      <p>月營收轉強 + 主升段候選股觀察雷達，僅供研究與風險控管參考。</p>
      <nav class="nav">${nav.map(([href, label, key]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("")}</nav>
    </div>
  `;
}

function renderError(target, message) {
  const el = typeof target === "string" ? $(target) : target;
  if (el) el.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function renderHome() {
  renderHeader("index");
  const main = $("#app");
  const holdings = readStoredCodes(HOLDINGS_KEY);
  const hitHoldings = holdings.filter((code) => stockByCode(code));
  const concepts = state.stocks.flatMap((stock) => String(stock.concept || "").split(";").map((x) => x.trim()).filter(Boolean));
  const topConcepts = [...new Set(concepts)].slice(0, 8);
  const topStocks = sortedStocks("main").slice(0, 10);
  main.innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>今日雷達總覽</h2><span>${escapeHtml(state.stocks[0]?.data_version || "")}</span></div>
      <div class="grid cols-4">
        <div class="metric"><span>今日入選</span><strong>${state.stocks.length} 檔</strong></div>
        <div class="metric"><span>A級</span><strong>${state.stocks.filter((s) => s.rating === "A").length} 檔</strong></div>
        <div class="metric"><span>A-級</span><strong>${state.stocks.filter((s) => s.rating === "A-").length} 檔</strong></div>
        <div class="metric"><span>持股命中</span><strong>${hitHoldings.length} 檔</strong></div>
      </div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>今日重大事件前 3 則</h2><a class="stock-link" href="news.html">看全部</a></div>
      <div class="grid">${state.news.length ? state.news.slice(0, 3).map(eventCard).join("") : `<div class="empty">今日尚無重大事件資料</div>`}</div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>我的持股命中摘要</h2><a class="stock-link" href="portfolio.html">編輯清單</a></div>
      <div class="chip-row">${hitHoldings.length ? stockChips(hitHoldings) : chip("今日未命中，或尚未設定持股")}</div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>今日主流題材</h2><a class="stock-link" href="themes.html">題材頁</a></div>
      <div class="chip-row">${topConcepts.map((x) => chip(x)).join("") || chip("暫無資料")}</div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>前 10 名雷達股</h2><a class="stock-link" href="radar.html">全股雷達</a></div>
      ${stockTable(topStocks, "main")}
    </section>
  `;
}

function renderRadar() {
  renderHeader("radar");
  const main = $("#app");
  main.innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>全股雷達清單</h2><span id="radarCount"></span></div>
      <div class="filters">
        <label>雷達模式<select id="mode"><option value="main">主升段</option><option value="market">全市場</option><option value="defensive">資產防守</option></select></label>
        <label>股票搜尋<input id="search" placeholder="代號或名稱，例如 2337、旺宏"></label>
        <label>雷達等級<select id="rating"><option value="">全部</option><option>A</option><option>A-</option><option>B</option></select></label>
        <label>概念股<input id="concept" placeholder="AI、PCB、記憶體..."></label>
      </div>
      <p id="modeNote" class="mode-note"></p>
    </section>
    <section id="radarList"></section>
  `;
  const render = () => {
    const mode = $("#mode").value;
    const search = $("#search").value.trim().toLowerCase();
    const rating = $("#rating").value;
    const concept = $("#concept").value.trim().toLowerCase();
    let list = sortedStocks(mode);
    list = list.filter((stock) => {
      if (search && !`${stock.code} ${stock.name}`.toLowerCase().includes(search)) return false;
      if (rating && stock.rating !== rating) return false;
      if (concept && !String(stock.concept || "").toLowerCase().includes(concept)) return false;
      return true;
    });
    $("#radarCount").textContent = `顯示 ${list.length} 檔`;
    $("#modeNote").textContent = mode === "main"
      ? "主升段模式會優先顯示高動能主流題材，防守族群不刪除但可能降權。"
      : mode === "market"
        ? "全市場模式不降權，照原始雷達強度排序。"
        : "資產防守模式只顯示營建、資產、都更、金融、壽險、銀行相關股票。";
    $("#radarList").innerHTML = stockTable(list, mode);
  };
  ["mode", "search", "rating", "concept"].forEach((id) => $(`#${id}`).addEventListener("input", render));
  ["mode", "rating"].forEach((id) => $(`#${id}`).addEventListener("change", render));
  render();
}

function renderNews() {
  renderHeader("news");
  const main = $("#app");
  const filters = ["全部", "國際", "台股", "AI", "記憶體", "半導體", "PCB", "CPO", "利率匯率", "原物料", "持股命中"];
  main.innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>重大新聞雷達</h2><span>只保存摘要、來源與阿斯拉連動分析</span></div>
      <div class="chip-row">${filters.map((x, i) => `<button class="${i ? "secondary" : ""}" data-filter="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("")}</div>
    </section>
    <section id="newsList" class="grid"></section>
  `;
  const render = (filter = "全部") => {
    const holdings = new Set(readStoredCodes(HOLDINGS_KEY));
    const list = state.news.filter((event) => {
      if (filter === "全部") return true;
      if (filter === "持股命中") return (event.related_stocks || []).some((code) => holdings.has(normalizeCode(code)));
      return event.region === filter || event.category === filter || (event.related_keywords || []).includes(filter);
    });
    $("#newsList").innerHTML = list.length ? list.map(eventCard).join("") : `<div class="empty">目前沒有符合條件的重大事件資料</div>`;
  };
  $all("[data-filter]").forEach((button) => button.addEventListener("click", () => render(button.dataset.filter)));
  render();
}

function renderThemes() {
  renderHeader("themes");
  const main = $("#app");
  main.innerHTML = `
    <section class="panel"><div class="section-title"><h2>題材概念股</h2><span>題材、新聞、雷達與持股交叉檢視</span></div></section>
    <section class="grid cols-2">${state.themes.length ? state.themes.map(themeCard).join("") : `<div class="empty">themes-map.json 尚無資料</div>`}</section>
  `;
}

function themeCard(theme) {
  const holdings = new Set(readStoredCodes(HOLDINGS_KEY));
  const related = (theme.related_stocks || []).map(normalizeCode).filter(Boolean);
  const radarHits = related.filter((code) => stockByCode(code));
  const holdingHits = related.filter((code) => holdings.has(code));
  const relatedNews = state.news.filter((event) => event.category === theme.name || (event.related_keywords || []).includes(theme.name));
  return `
    <article class="card theme-card">
      <h3>${escapeHtml(theme.name)}</h3>
      <p class="muted">${escapeHtml(theme.description || "")}</p>
      <p><span class="label">相關新聞事件</span>${relatedNews.length ? relatedNews.map((e) => escapeHtml(e.title)).join("；") : "暫無"}</p>
      <p><span class="label">相關台股</span></p><div class="chip-row">${stockChips(related, "無相關台股")}</div>
      <p><span class="label">雷達命中股票</span></p><div class="chip-row">${stockChips(radarHits, "未命中今日雷達")}</div>
      <p><span class="label">持股命中股票</span></p><div class="chip-row">${stockChips(holdingHits, "未命中我的持股")}</div>
    </article>
  `;
}

function asuradaStance(stock) {
  const score = toNumber(stock.score);
  const mom = toNumber(stock.revenue_mom);
  const volume = toNumber(stock.volume);
  if (volume > 50000) return "過熱不追";
  if (score >= 70 && mom > 0) return "偏多觀察";
  if (score >= 55) return "等回測";
  return "轉弱觀察";
}

function renderStock() {
  renderHeader("stock");
  const params = new URLSearchParams(location.search);
  const initialCode = normalizeCode(params.get("code") || "");
  const main = $("#app");
  main.innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>個股查詢</h2><span>支援 stock.html?code=2337</span></div>
      <div class="filters"><label>股票代號<input id="stockSearch" value="${escapeHtml(initialCode)}" placeholder="2337"></label></div>
    </section>
    <section id="stockResult"></section>
  `;
  const render = () => {
    const code = normalizeCode($("#stockSearch").value);
    const stock = stockByCode(code);
    if (!code) {
      $("#stockResult").innerHTML = `<div class="empty">請輸入股票代號</div>`;
      return;
    }
    if (!stock) {
      $("#stockResult").innerHTML = `<div class="empty">${escapeHtml(code)} 今日未入選雷達，暫無雷達資料。</div>`;
      return;
    }
    const relatedNews = state.news.filter((event) => (event.related_stocks || []).map(normalizeCode).includes(code));
    const relatedThemes = state.themes.filter((theme) => (theme.related_stocks || []).map(normalizeCode).includes(code));
    const tech = state.technical[code];
    $("#stockResult").innerHTML = `
      ${stockCard(stock, "market")}
      <section class="panel"><div class="section-title"><h2>阿斯拉方針</h2></div>${chip(asuradaStance(stock), "warn")}</section>
      <section class="panel"><div class="section-title"><h2>相關重大新聞</h2></div>${relatedNews.length ? relatedNews.map(eventCard).join("") : `<div class="empty">目前沒有該股相關重大新聞</div>`}</section>
      <section class="panel"><div class="section-title"><h2>相關題材</h2></div><div class="chip-row">${relatedThemes.length ? relatedThemes.map((x) => chip(x.name)).join("") : chip("暫無題材對應")}</div></section>
      <section class="panel"><div class="section-title"><h2>技術面欄位</h2></div>${tech ? `<pre>${escapeHtml(JSON.stringify(tech, null, 2))}</pre>` : `<div class="empty">技術面資料尚未建立</div>`}</section>
    `;
  };
  $("#stockSearch").addEventListener("input", render);
  render();
}

function renderPortfolio() {
  renderHeader("portfolio");
  const main = $("#app");
  const holdings = readStoredCodes(HOLDINGS_KEY);
  const watchlist = readStoredCodes(WATCHLIST_KEY);
  main.innerHTML = `
    <section class="panel">
      <div class="section-title"><h2>我的持股與觀察清單</h2><span>儲存在此瀏覽器 localStorage</span></div>
      <div class="grid cols-2">
        <label>我的持股<textarea id="holdingsInput" placeholder="2337,2313 或每行一檔">${escapeHtml(holdings.join("\n"))}</textarea></label>
        <label>觀察清單<textarea id="watchlistInput" placeholder="2383,2368 或每行一檔">${escapeHtml(watchlist.join("\n"))}</textarea></label>
      </div>
      <div class="button-row">
        <button id="savePortfolio">儲存</button>
        <button id="clearPortfolio" class="secondary">清除</button>
        <button id="exportPortfolio" class="secondary">匯出設定</button>
        <button id="importPortfolio" class="secondary">匯入設定</button>
        <input id="importFile" type="file" accept="application/json,.json" hidden>
      </div>
    </section>
    <section class="panel"><div class="section-title"><h2>持股命中</h2></div><div id="holdingsResult"></div></section>
    <section class="panel"><div class="section-title"><h2>觀察清單命中</h2></div><div id="watchlistResult"></div></section>
  `;
  const renderHits = () => {
    renderCodeHits("#holdingsResult", readStoredCodes(HOLDINGS_KEY));
    renderCodeHits("#watchlistResult", readStoredCodes(WATCHLIST_KEY));
  };
  $("#savePortfolio").addEventListener("click", () => {
    writeStoredCodes(HOLDINGS_KEY, parseCodes($("#holdingsInput").value));
    writeStoredCodes(WATCHLIST_KEY, parseCodes($("#watchlistInput").value));
    renderHits();
  });
  $("#clearPortfolio").addEventListener("click", () => {
    localStorage.removeItem(HOLDINGS_KEY);
    localStorage.removeItem(WATCHLIST_KEY);
    $("#holdingsInput").value = "";
    $("#watchlistInput").value = "";
    renderHits();
  });
  $("#exportPortfolio").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ holdings: parseCodes($("#holdingsInput").value), watchlist: parseCodes($("#watchlistInput").value) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "asurada_portfolio.json";
    link.click();
    URL.revokeObjectURL(url);
  });
  $("#importPortfolio").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", () => {
    const file = $("#importFile").files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const holdingsCodes = Array.isArray(parsed.holdings) ? parsed.holdings : parsed.codes || [];
        const watchCodes = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
        writeStoredCodes(HOLDINGS_KEY, holdingsCodes.map(normalizeCode).filter(Boolean));
        writeStoredCodes(WATCHLIST_KEY, watchCodes.map(normalizeCode).filter(Boolean));
        $("#holdingsInput").value = readStoredCodes(HOLDINGS_KEY).join("\n");
        $("#watchlistInput").value = readStoredCodes(WATCHLIST_KEY).join("\n");
        renderHits();
      } catch {
        alert("匯入失敗，請確認 JSON 格式是否正確。");
      }
    };
    reader.readAsText(file, "utf-8");
  });
  renderHits();
}

function renderCodeHits(selector, codes) {
  const el = $(selector);
  if (!codes.length) {
    el.innerHTML = `<div class="empty">尚未設定清單</div>`;
    return;
  }
  el.innerHTML = codes.map((code) => {
    const stock = stockByCode(code);
    const newsHits = state.news.filter((event) => (event.related_stocks || []).map(normalizeCode).includes(code));
    return `
      <article class="card">
        <h3>${escapeHtml(stockName(code))}</h3>
        <div class="chip-row">
          ${stock ? chip("命中今日雷達", "good") : chip("今日未入選雷達")}
          ${newsHits.length ? chip(`命中重大新聞 ${newsHits.length} 則`, "warn") : chip("未命中重大新聞")}
        </div>
        ${stock ? `<p class="muted">雷達強度 ${escapeHtml(stock.score)}｜等級 ${escapeHtml(stock.rating)}｜收盤價 ${escapeHtml(stock.close)}｜成交量 ${escapeHtml(stock.volume)} 張</p>` : ""}
      </article>
    `;
  }).join("");
}

async function boot(page) {
  renderHeader(page);
  await loadAllData();
  const missing = [];
  if (!state.stocks.length) missing.push("data/stocks-latest.json");
  if (!Array.isArray(state.news)) missing.push("data/news-events.json");
  if (missing.length) {
    renderError("#app", `資料載入失敗或尚未建立：${missing.join("、")}`);
    return;
  }
  if (page === "index") renderHome();
  if (page === "radar") renderRadar();
  if (page === "news") renderNews();
  if (page === "themes") renderThemes();
  if (page === "stock") renderStock();
  if (page === "portfolio") renderPortfolio();
}
