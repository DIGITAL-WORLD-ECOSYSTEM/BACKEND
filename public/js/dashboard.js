/**
 * ASPPIBRA DAO - Dashboard Controller (v8.6 - Enhanced UI)
 * Backend: Cloudflare Workers + D1 + KV Snapshot
 */

const CONFIG = {
  API_STATS: '/api/stats',
  REFRESH_RATE: 15000,
};

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 ASPPIBRA Dashboard v8.6 Initialized');
  setupTheme();
  setupMobileMenu();

  fetchSystemStats();
  setInterval(fetchSystemStats, CONFIG.REFRESH_RATE);
});

// --- O CÉREBRO DO DASHBOARD ---
async function fetchSystemStats() {
  const startTime = performance.now();

  try {
    const response = await fetch(CONFIG.API_STATS);
    const endTime = performance.now();

    const latency = Math.round(endTime - startTime);
    const latencyEl = document.getElementById('footer-latency');
    if (latencyEl) latencyEl.innerText = `${latency}ms`;

    if (!response.ok) return;

    const data = await response.json();

    animateValue('lbl-total-requests', data.networkRequests);
    document.getElementById('lbl-total-bytes').innerText = formatBytes(data.processedData);
    animateValue('lbl-uniques', data.globalUsers);

    const cacheEl = document.getElementById('lbl-cache-ratio');
    if (cacheEl && data.cacheRatio) {
      cacheEl.innerText = data.cacheRatio;
    }

    const reads = data.dbStats?.queries || 0;
    const writes = data.dbStats?.mutations || 0;
    const totalOps = reads + writes;

    animateValue('lbl-reads', reads);
    animateValue('lbl-writes', writes);
    animateValue('lbl-workload', totalOps + data.networkRequests);

    updateBar('bar-reads', reads);
    updateBar('bar-writes', writes);
    updateBar('bar-workload', totalOps + data.networkRequests);

    if (data.market) {
      updateMarketData(data.market);
    }

    // 🌍 Atualiza lista de países com bandeiras
    updateCountryList(data.countries);
  } catch (error) {
    console.error('Telemetria offline:', error);
  }
}

// --- LÓGICA DE MERCADO ---
function updateMarketData(market) {
  const price = parseFloat(market.price || 0);
  const change = parseFloat(market.change24h || 0);

  document.getElementById('price-display').innerText = '$' + price.toFixed(4);

  const changeEl = document.getElementById('price-change');
  if (changeEl) {
    changeEl.innerText = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% (24h)`;
    changeEl.style.color = change >= 0 ? 'var(--success-color)' : '#ef4444';
    changeEl.style.background = change >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
  }

  const liqEl = document.getElementById('liquidity-display');
  if (liqEl)
    liqEl.innerHTML = `Liq: <span class="stat-val">$${formatCompact(market.liquidity)}</span>`;

  const mcapEl = document.getElementById('mcap-display');
  if (mcapEl)
    mcapEl.innerHTML = `MCap: <span class="stat-val">$${formatCompact(market.marketCap)}</span>`;

  if (market.history && market.history.length > 0) {
    const prices = market.history.map((h) => h.p);
    renderSparkline(prices);
  }
}

// --- DESENHO DO GRÁFICO (SVG) ---
function renderSparkline(data) {
  const path = document.getElementById('sparkline-path');
  const fill = document.getElementById('sparkline-fill');
  if (!path || data.length < 2) return;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 0.0001;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 100;
    const normalized = (val - min) / range;
    const y = 90 - normalized * 80;
    return `${x},${y}`;
  });

  const lineD = 'M' + points.join(' L');
  path.setAttribute('d', lineD);
  if (fill) fill.setAttribute('d', lineD + ' L100,120 L0,120 Z');

  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? '#00ff9d' : '#ef4444';

  path.setAttribute('stroke', color);
  const gradientStop = document.querySelector('#chartFill stop');
  if (gradientStop) gradientStop.setAttribute('stop-color', color);
}

// --- UTILITÁRIOS ---

/**
 * Converte código ISO (ex: BR) para Emoji (🇧🇷)
 */
function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode === 'XX') return '🌐';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function updateCountryList(countries) {
  const list = document.getElementById('list-countries');
  if (!list) return;

  if (!countries || countries.length === 0) {
    if (list.children[0]?.className === 'loading') return;
    list.innerHTML =
      '<li class="country-item"><span class="loading">Waiting for nodes...</span></li>';
    return;
  }

  list.innerHTML = countries
    .slice(0, 5)
    .map(
      (c) => `
        <li class="country-item">
            <div class="flag-wrapper">
                <span class="flag-icon" style="font-size: 1.2rem; margin-right: 8px;">${getFlagEmoji(c.code)}</span>
                <span class="flag-code" style="margin-right: 8px; opacity: 0.6; font-family: 'JetBrains Mono';">${c.code}</span>
                <span class="country-name">${c.country}</span>
            </div>
            <span class="count">${c.count.toLocaleString()}</span>
        </li>
    `
    )
    .join('');
}

function animateValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const formatted = value.toLocaleString();
  if (el.innerText !== formatted) {
    el.innerText = formatted;
    el.classList.remove('loading');
  }
}

function updateBar(id, val) {
  const bar = document.getElementById(id);
  if (bar) {
    const pct = Math.min(100, Math.max(5, val % 100));
    bar.style.width = `${pct}%`;
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatCompact(num) {
  if (!num) return '0';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    num
  );
}

// --- TEMA E MOBILE ---
function setupTheme() {
  const btn = document.getElementById('theme-toggle');
  const body = document.body;
  const saved = localStorage.getItem('theme') || 'dark';
  body.className = 'theme-' + saved;
  if (btn) {
    btn.innerText = saved === 'dark' ? '☀️' : '🌙';
    btn.addEventListener('click', () => {
      const isDark = body.classList.contains('theme-dark');
      body.className = isDark ? 'theme-light' : 'theme-dark';
      localStorage.setItem('theme', isDark ? 'light' : 'dark');
      btn.innerText = isDark ? '🌙' : '☀️';
    });
  }
}

function setupMobileMenu() {
  const btn = document.getElementById('mobile-menu-btn');
  const nav = document.getElementById('nav-menu');
  if (btn && nav) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.classList.toggle('is-active');
      nav.classList.toggle('nav-active');
    });
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target) && !btn.contains(e.target)) {
        nav.classList.remove('nav-active');
        btn.classList.remove('is-active');
      }
    });
  }
}