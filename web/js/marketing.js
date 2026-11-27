// =====================================================================
// PORTAL TRUE ELO — Marketing: Desempenho (dashboards), Relatório mensal,
// Contas de anúncio dos clientes e Integrações (Meta, Google).
// Recebe as ferramentas do app.js por "ctx" (evita dependência circular).
// =====================================================================

let ctx;
export function setupMarketing(context) { ctx = context; }

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SOURCE_LABEL = { meta: 'Meta Ads (Facebook e Instagram)', google_ads: 'Google Ads', ga4: 'Google Analytics (site)' };
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const int = (n) => Math.round(Number(n || 0)).toLocaleString('pt-BR');
const dec = (n, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
const prevMonthStr = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (m) => { const [y, mm] = m.split('-').map(Number); return `${MESES[mm - 1]} de ${y}`; };

// ---------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------
const FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'leads', 'purchases', 'conversions', 'conversion_value', 'sessions', 'users', 'pageviews'];
function sum(rows) {
  const t = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const r of rows) for (const f of FIELDS) t[f] += Number(r[f] || 0);
  t.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
  t.cpc = t.clicks ? t.spend / t.clicks : 0;
  t.cpa = t.conversions ? t.spend / t.conversions : 0;
  t.roas = t.spend ? t.conversion_value / t.spend : 0;
  return t;
}
function change(cur, prev, inverse = false) {
  if (!prev) return '';
  const v = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(v)) return '';
  const good = inverse ? v < 0 : v > 0;
  const cls = Math.abs(v) < 0.5 ? 'flat' : good ? 'up' : 'down';
  const arrow = cls === 'flat' ? '•' : v > 0 ? '▲' : '▼';
  return `<span class="kpi-change ${cls}">${arrow} ${Math.abs(v).toFixed(0)}%</span>`;
}

// ---------------------------------------------------------------------
// Gráficos (Chart.js, carregado só quando precisa)
// ---------------------------------------------------------------------
let chartLib;
function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (chartLib) return chartLib;
  chartLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return chartLib;
}
const charts = new Map();
async function drawChart(canvas, config) {
  if (!canvas) return;
  try {
    const Chart = await loadChart();
    charts.get(canvas.id)?.destroy();
    Chart.defaults.color = '#9aa3bd';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.borderColor = 'rgba(255,255,255,.07)';
    charts.set(canvas.id, new Chart(canvas, config));
  } catch {
    canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Não foi possível carregar o gráfico.' }));
  }
}
const shortDay = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

// ---------------------------------------------------------------------
// Relatório gerado: o mesmo desenho na prévia, no portal do cliente e no PDF
// ---------------------------------------------------------------------
export function reportHTML(data, comment, clientNameText) {
  const { esc } = ctx;
  if (!data) return '<p class="muted">Relatório sem dados.</p>';
  const t = data.totals || {};
  const p = t.prev || {};
  const ga = data.sources?.ga4;
  const kpi = (label, value, ch, hint = '') => `
    <div class="kpi"><span class="kpi-label">${label}</span><strong>${value}</strong>${ch || ''}${hint ? `<span class="kpi-hint">${hint}</span>` : ''}</div>`;
  const srcRows = ['meta', 'google_ads'].filter((s) => data.sources?.[s]).map((s) => {
    const x = data.sources[s];
    return `<tr><td>${SOURCE_LABEL[s]}</td><td>${brl(x.spend)}</td><td>${int(x.impressions)}</td><td>${int(x.clicks)}</td><td>${dec(x.ctr)}%</td><td>${brl(x.cpc)}</td><td>${dec(x.conversions, 0)}</td><td>${x.conversions ? brl(x.cpa) : '—'}</td></tr>`;
  }).join('');

  return `
    <div class="report-doc">
      <div class="report-head">
        <div>
          <span class="report-kicker">Relatório mensal</span>
          <h2>${esc(data.label)}</h2>
          ${clientNameText ? `<p class="muted">${esc(clientNameText)}</p>` : ''}
        </div>
        <div class="brand" data-logo-static><span class="name"><span class="t">True</span><span class="e">Elo</span></span></div>
      </div>
      ${data.has_data ? `
        <div class="kpi-grid">
          ${kpi('Investimento', brl(t.spend), change(t.spend, p.spend))}
          ${kpi('Resultados', dec(t.conversions, 0), change(t.conversions, p.conversions), 'Contatos, compras e conversões')}
          ${kpi('Custo por resultado', t.conversions ? brl(t.cpa) : '—', change(t.cpa, p.cpa, true))}
          ${kpi('Cliques', int(t.clicks), change(t.clicks, p.clicks))}
          ${kpi('Impressões', int(t.impressions), change(t.impressions, p.impressions))}
          ${kpi('Taxa de cliques (CTR)', dec(t.ctr) + '%', change(t.ctr, p.ctr))}
          ${t.conversion_value ? kpi('Valor em vendas', brl(t.conversion_value), change(t.conversion_value, p.conversion_value), `Retorno: ${dec(t.roas)}x o investido`) : ''}
          ${ga ? kpi('Visitas ao site', int(ga.sessions), change(ga.sessions, ga.prev?.sessions)) : ''}
          ${ga ? kpi('Pessoas no site', int(ga.users), change(ga.users, ga.prev?.users)) : ''}
        </div>
        <p class="muted small">Setas comparam com o mês anterior.</p>
        ${data.daily?.length ? '<div class="chart-box"><canvas id="report-chart" height="120"></canvas></div>' : ''}
        ${srcRows ? `
          <h3>Resultados por canal</h3>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Canal</th><th>Investimento</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>Custo por clique</th><th>Resultados</th><th>Custo por resultado</th></tr></thead>
            <tbody>${srcRows}</tbody>
          </table></div>` : ''}
      ` : '<div class="notice gold">Ainda não há números de campanhas para este mês. Assim que as contas de anúncio forem conectadas, eles aparecem aqui.</div>'}
      ${comment ? `<div class="report-comment"><span>Comentário da equipe True Elo</span><p>${esc(comment).replace(/\n/g, '<br>')}</p></div>` : ''}
      <p class="muted small report-foot">Gerado pelo Portal True Elo em ${ctx.fmtDate(data.generated_at)}.</p>
    </div>`;
}

function drawReportChart(data) {
  if (!data?.daily?.length) return;
  drawChart(document.getElementById('report-chart'), {
    type: 'bar',
    data: {
      labels: data.daily.map((d) => shortDay(d.day)),
      datasets: [
        { type: 'bar', label: 'Investimento (R$)', data: data.daily.map((d) => d.spend), backgroundColor: 'rgba(79,195,223,.55)', borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Resultados', data: data.daily.map((d) => d.conversions), borderColor: '#e0aa62', backgroundColor: '#e0aa62', tension: .35, pointRadius: 2, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 12 } } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => 'R$ ' + v } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } },
    },
  });
}

// Abre um relatório gerado (cliente ou equipe)
export function showGeneratedReport(report) {
  const { openModal, $, esc } = ctx;
  openModal(`
    <div class="report-modal-actions no-print">
      <button type="button" class="btn btn-ghost btn-sm" id="btn-print-report">${ctx.icon('download')} Salvar em PDF / imprimir</button>
      <button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button>
    </div>
    ${reportHTML(report.data, report.comment, ctx.isStaff() ? ctx.clientName(report.client_id) : '')}`);
  $('#modal-card').classList.add('modal-wide');
  $('#btn-print-report').addEventListener('click', () => window.print());
  drawReportChart(report.data);
  ctx.track('ViewContent', { content_name: report.title || 'Relatório mensal', content_category: 'relatorio' });
  void esc;
}

// ---------------------------------------------------------------------
// DESEMPENHO (dashboard)
// ---------------------------------------------------------------------
const PERIODS = [
  { id: '7', label: 'Últimos 7 dias' },
  { id: '30', label: 'Últimos 30 dias' },
  { id: '90', label: 'Últimos 90 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes-anterior', label: 'Mês passado' },
];
function periodRange(id) {
  const today = isoDay(new Date());
  if (id === 'mes') { const s = today.slice(0, 8) + '01'; return { start: s, end: today }; }
  if (id === 'mes-anterior') {
    const d = new Date(); d.setDate(0);
    const end = isoDay(d); return { start: end.slice(0, 8) + '01', end };
  }
  const n = parseInt(id, 10);
  return { start: addDays(today, -(n - 1)), end: today };
}

export async function renderPerformance(el) {
  const { $, esc, isStaff, loadClients, clientSelect, sb, state } = ctx;
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Desempenho</h1><p class="muted">${esc(isStaff() ? 'Resultados das campanhas dos clientes.' : ctx.withName('Acompanhe os resultados das suas campanhas.'))}</p></div>
    </div>
    <div class="toolbar">
      <span id="perf-client-wrap"></span>
      <select id="perf-period" aria-label="Período">${PERIODS.map((p) => `<option value="${p.id}"${p.id === '30' ? ' selected' : ''}>${p.label}</option>`).join('')}</select>
    </div>
    <div id="perf-body">${'<div class="card empty"><div class="spinner" style="margin:0 auto"></div></div>'}</div>`;

  let clientId = state.profile.id;
  if (isStaff()) {
    await loadClients().catch(() => {});
    const { data: withData } = await sb.from('client_marketing').select('client_id');
    const first = (withData || [])[0]?.client_id || state.clients?.[0]?.id || '';
    $('#perf-client-wrap', el).innerHTML = clientSelect('perf-client', { selected: first, placeholder: 'Selecione um cliente' });
    clientId = first;
    $('#perf-client', el).addEventListener('change', (e) => { clientId = e.target.value; draw(); });
  }
  $('#perf-period', el).addEventListener('change', draw);
  draw();

  async function draw() {
    const box = $('#perf-body', el);
    if (!clientId) { box.innerHTML = ctx.emptyCard('chart', 'Selecione um cliente para ver o desempenho.'); return; }
    box.innerHTML = '<div class="card empty"><div class="spinner" style="margin:0 auto"></div></div>';
    const { start, end } = periodRange($('#perf-period', el).value);
    const len = daysBetween(start, end);
    const prevStart = addDays(start, -len), prevEnd = addDays(start, -1);
    const { data, error } = await sb.from('campaign_metrics_daily').select('*')
      .eq('client_id', clientId).gte('day', prevStart).lte('day', end).order('day');
    if (error) { box.innerHTML = ctx.emptyCard('chart', 'Não foi possível carregar os números.'); return; }
    const rows = data || [];
    const cur = rows.filter((r) => r.day >= start);
    const prev = rows.filter((r) => r.day <= prevEnd);
    if (!cur.length) {
      box.innerHTML = ctx.emptyCard('chart', isStaff()
        ? 'Ainda não há números para este cliente no período. Confira as contas em "Contas de anúncio" e clique em Sincronizar.'
        : 'Os números das suas campanhas aparecem aqui assim que a True Elo conectar suas contas de anúncio.');
      return;
    }
    const ads = (l) => l.filter((r) => r.source !== 'ga4');
    const t = sum(ads(cur)), p = sum(ads(prev));
    const gaCur = cur.filter((r) => r.source === 'ga4'), gaPrev = prev.filter((r) => r.source === 'ga4');
    const g = sum(gaCur), gp = sum(gaPrev);
    const hasAds = ads(cur).length > 0;
    const kpi = (label, value, ch, hint = '') => `<div class="card kpi"><span class="kpi-label">${label}</span><strong>${value}</strong>${ch || ''}${hint ? `<span class="kpi-hint">${hint}</span>` : ''}</div>`;

    const bySource = ['meta', 'google_ads'].map((s) => ({ s, t: sum(cur.filter((r) => r.source === s)) })).filter((x) => x.t.spend || x.t.impressions);
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    const daily = days.map((d) => {
      const r = cur.filter((x) => x.day === d);
      const a = sum(r.filter((x) => x.source !== 'ga4'));
      return { day: d, spend: a.spend, conv: a.conversions, clicks: a.clicks, sessions: sum(r.filter((x) => x.source === 'ga4')).sessions };
    });
    const last = rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), '');

    box.innerHTML = `
      ${hasAds ? `<div class="kpi-grid">
        ${kpi('Investimento', brl(t.spend), change(t.spend, p.spend))}
        ${kpi('Resultados', dec(t.conversions, 0), change(t.conversions, p.conversions), 'Contatos, compras e conversões')}
        ${kpi('Custo por resultado', t.conversions ? brl(t.cpa) : '—', change(t.cpa, p.cpa, true))}
        ${kpi('Cliques', int(t.clicks), change(t.clicks, p.clicks))}
        ${kpi('Impressões', int(t.impressions), change(t.impressions, p.impressions))}
        ${kpi('Taxa de cliques (CTR)', dec(t.ctr) + '%', change(t.ctr, p.ctr))}
        ${t.reach ? kpi('Alcance (Meta)', int(t.reach), change(t.reach, p.reach), 'Pessoas diferentes que viram') : ''}
        ${t.conversion_value ? kpi('Valor em vendas', brl(t.conversion_value), change(t.conversion_value, p.conversion_value), `Retorno: ${dec(t.roas)}x o investido`) : ''}
      </div>` : ''}
      ${gaCur.length ? `<div class="kpi-grid" style="margin-top:14px">
        ${kpi('Visitas ao site', int(g.sessions), change(g.sessions, gp.sessions))}
        ${kpi('Pessoas no site', int(g.users), change(g.users, gp.users))}
        ${kpi('Páginas vistas', int(g.pageviews), change(g.pageviews, gp.pageviews))}
        ${kpi('Ações importantes no site', dec(g.conversions, 0), change(g.conversions, gp.conversions), 'Eventos-chave do Analytics')}
      </div>` : ''}
      <p class="muted small" style="margin:10px 0 18px">Setas comparam com o período anterior de mesmo tamanho. Atualizado em ${ctx.fmtDateTime(last)}.</p>
      ${hasAds ? '<div class="card chart-card"><h3>Investimento e resultados por dia</h3><canvas id="perf-chart" height="110"></canvas></div>' : ''}
      ${gaCur.length ? '<div class="card chart-card"><h3>Visitas ao site por dia</h3><canvas id="perf-ga" height="90"></canvas></div>' : ''}
      ${bySource.length ? `<div class="card"><h3>Por canal</h3><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Canal</th><th>Investimento</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>Custo por clique</th><th>Resultados</th><th>Custo por resultado</th></tr></thead>
        <tbody>${bySource.map(({ s, t: x }) => `<tr><td>${SOURCE_LABEL[s]}</td><td>${brl(x.spend)}</td><td>${int(x.impressions)}</td><td>${int(x.clicks)}</td><td>${dec(x.ctr)}%</td><td>${brl(x.cpc)}</td><td>${dec(x.conversions, 0)}</td><td>${x.conversions ? brl(x.cpa) : '—'}</td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}`;

    if (hasAds) drawChart(document.getElementById('perf-chart'), {
      type: 'bar',
      data: {
        labels: daily.map((d) => shortDay(d.day)),
        datasets: [
          { type: 'bar', label: 'Investimento (R$)', data: daily.map((d) => d.spend), backgroundColor: 'rgba(79,195,223,.55)', borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Resultados', data: daily.map((d) => d.conv), borderColor: '#e0aa62', backgroundColor: '#e0aa62', tension: .35, pointRadius: 2, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { boxWidth: 12 } } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => 'R$ ' + v } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } },
      },
    });
    if (gaCur.length) drawChart(document.getElementById('perf-ga'), {
      type: 'line',
      data: { labels: daily.map((d) => shortDay(d.day)), datasets: [{ label: 'Visitas', data: daily.map((d) => d.sessions), borderColor: '#4fc3df', backgroundColor: 'rgba(79,195,223,.15)', fill: true, tension: .35, pointRadius: 0 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }
}

// ---------------------------------------------------------------------
// RELATÓRIO MENSAL (equipe: Editor para cima)
// ---------------------------------------------------------------------
export async function renderMonthlyReport(el) {
  const { $, $$, esc, loadClients, clientSelect, sb, toast, busy, callFunction, confirmModal } = ctx;
  await loadClients(true).catch(() => toast('Não foi possível carregar os clientes.', 'error'));
  el.innerHTML = `
    <div class="page-head"><div><h1>Relatório mensal</h1><p class="muted">Monte o relatório do mês com os números das campanhas, revise e envie ao cliente.</p></div></div>
    <div class="report-builder">
      <form class="card form" id="rm-form" novalidate>
        <label>Cliente${clientSelect('rm-client')}</label>
        <label>Mês do relatório<input type="month" id="rm-month" value="${prevMonthStr()}" required></label>
        <label>Comentário da equipe (aparece no relatório e no e-mail)
          <textarea id="rm-comment" rows="6" maxlength="4000" placeholder="Ex.: Neste mês, o custo por contato caiu 18% depois do novo criativo em vídeo. Para o próximo mês, vamos testar..."></textarea>
        </label>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" id="rm-preview">${ctx.icon('chart')} Pré-visualizar</button>
          <button type="button" class="btn btn-ghost" id="rm-draft">Salvar rascunho</button>
          <button type="submit" class="btn btn-gold" id="rm-publish">${ctx.icon('upload')} Publicar e enviar</button>
        </div>
        <p class="muted small" style="margin:0">Ao publicar, o relatório aparece na Central de Relatórios do cliente e vai por e-mail para ele (se ele não tiver desligado os e-mails informativos). No dia 1 de cada mês, o portal já deixa os rascunhos prontos para você.</p>
      </form>
      <div id="rm-preview-box" class="card report-preview"><p class="muted center" style="margin:40px 0">Escolha o cliente e o mês e clique em <strong>Pré-visualizar</strong>.</p></div>
    </div>
    <h3 style="margin-top:30px">Relatórios gerados</h3>
    <div class="toolbar"><select id="rm-filter"><option value="">Todos</option><option value="rascunho">Rascunhos</option><option value="publicado">Publicados</option></select></div>
    <div id="rm-list" class="list"></div>`;

  const form = () => ({ client_id: $('#rm-client', el).value, month: $('#rm-month', el).value, comment: $('#rm-comment', el).value.trim() });
  const valid = (f) => {
    if (!f.client_id) { toast('Selecione um cliente.', 'error'); return false; }
    if (!/^\d{4}-\d{2}$/.test(f.month)) { toast('Escolha o mês.', 'error'); return false; }
    return true;
  };
  const preview = async () => {
    const f = form(); if (!valid(f)) return;
    const box = $('#rm-preview-box', el);
    box.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
    try {
      const res = await callFunction('relatorio-mensal', { action: 'preview', client_id: f.client_id, month: f.month, siteUrl: ctx.SITE_URL });
      box.innerHTML = reportHTML(res.data, f.comment, ctx.clientName(f.client_id));
      drawReportChart(res.data);
    } catch (err) { box.innerHTML = `<p class="muted center">${esc(err.message)}</p>`; }
  };
  const save = async (publish, btn) => {
    const f = form(); if (!valid(f)) return;
    if (publish) {
      const ok = await confirmModal({
        title: 'Publicar e enviar?',
        text: `O relatório de <strong>${esc(monthLabel(f.month))}</strong> vai aparecer para <strong>${esc(ctx.clientName(f.client_id))}</strong> e será enviado por e-mail.`,
        confirmLabel: 'Publicar e enviar', kind: 'gold',
      });
      if (!ok) return;
    }
    await busy(btn, async () => {
      try {
        const res = await callFunction('relatorio-mensal', { action: 'salvar', publish, ...f, siteUrl: ctx.SITE_URL });
        if (!publish) toast('Rascunho salvo.');
        else if (res.emailed) toast('Relatório publicado e enviado por e-mail!');
        else if (res.email_updates === false) toast('Relatório publicado. O cliente desligou os e-mails informativos, então ele verá só no portal.', 'info');
        else toast('Relatório publicado. O e-mail não pôde ser enviado agora.', 'info');
        loadList();
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  $('#rm-preview', el).addEventListener('click', preview);
  $('#rm-draft', el).addEventListener('click', (e) => save(false, e.currentTarget));
  $('#rm-form', el).addEventListener('submit', (e) => { e.preventDefault(); save(true, $('#rm-publish', el)); });
  $('#rm-filter', el).addEventListener('change', loadList);

  async function loadList() {
    const box = $('#rm-list', el);
    let q = sb.from('reports').select('id, client_id, title, status, period_month, comment, data, emailed_at, created_at').eq('kind', 'gerado').order('period_month', { ascending: false }).limit(100);
    const f = $('#rm-filter', el).value;
    if (f) q = q.eq('status', f);
    const { data, error } = await q;
    if (error) { box.innerHTML = ctx.emptyCard('chart', 'Não foi possível carregar os relatórios.'); return; }
    if (!data?.length) { box.innerHTML = ctx.emptyCard('chart', 'Nenhum relatório gerado ainda.'); return; }
    box.innerHTML = data.map((r, i) => `
      <div class="card row">
        <div class="stat-icon gold sm">${ctx.icon('chart')}</div>
        <div class="row-main">
          <h4>${esc(ctx.clientName(r.client_id))} · ${esc(r.data?.label || r.title)}</h4>
          <p><span class="badge ${r.status === 'publicado' ? 'admin' : 'owner'}">${r.status === 'publicado' ? 'Publicado' : 'Rascunho'}</span>
            ${r.emailed_at ? ` · e-mail enviado em ${ctx.fmtDate(r.emailed_at)}` : ''}</p>
        </div>
        <div class="row-actions">
          <button type="button" class="icon-btn cyan" data-open="${i}" title="Ver" aria-label="Ver">${ctx.icon('link')}</button>
          <button type="button" class="icon-btn cyan" data-edit="${i}" title="Editar" aria-label="Editar">${ctx.icon('edit')}</button>
          ${r.status !== 'publicado' ? `<button type="button" class="icon-btn gold" data-pub="${i}" title="Publicar e enviar" aria-label="Publicar e enviar">${ctx.icon('upload')}</button>` : ''}
        </div>
      </div>`).join('');
    $$('[data-open]', box).forEach((b) => b.addEventListener('click', () => showGeneratedReport(data[+b.dataset.open])));
    $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => {
      const r = data[+b.dataset.edit];
      $('#rm-client', el).value = r.client_id;
      $('#rm-month', el).value = r.period_month.slice(0, 7);
      $('#rm-comment', el).value = r.comment || '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      preview();
    }));
    $$('[data-pub]', box).forEach((b) => b.addEventListener('click', async () => {
      const r = data[+b.dataset.pub];
      const ok = await confirmModal({ title: 'Publicar e enviar?', text: `O relatório de <strong>${esc(r.data?.label || '')}</strong> vai para <strong>${esc(ctx.clientName(r.client_id))}</strong>.`, confirmLabel: 'Publicar e enviar', kind: 'gold' });
      if (!ok) return;
      try {
        const res = await callFunction('relatorio-mensal', { action: 'publicar', report_id: r.id, siteUrl: ctx.SITE_URL });
        toast(res.emailed ? 'Publicado e enviado por e-mail!' : 'Publicado.');
        loadList();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }
  loadList();
}

// ---------------------------------------------------------------------
// CONTAS DE ANÚNCIO DOS CLIENTES (Moderador para cima)
// ---------------------------------------------------------------------
export async function renderClientAccounts(el) {
  const { $, $$, esc, loadClients, sb, toast, busy, callFunction } = ctx;
  await loadClients(true).catch(() => {});
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Contas de anúncio</h1><p class="muted">Diga ao portal quais contas são de cada cliente. Os números aparecem em Desempenho e nos relatórios.</p></div>
      <button type="button" class="btn btn-primary" id="ca-sync-all">${ctx.icon('refresh')} Sincronizar todos</button>
    </div>
    <div class="notice gold" style="margin-bottom:18px">Onde achar cada número: <strong>Meta</strong>: Gerenciador de Anúncios, no topo (começa com "act_" ou só números). <strong>Pixel</strong>: Gerenciador de Eventos. <strong>Google Ads</strong>: canto superior direito (formato 123-456-7890). <strong>Analytics</strong>: Administrador → Detalhes da propriedade (ID da propriedade, só números).</div>
    <div id="ca-list" class="list"></div>
    <div id="ca-runs"></div>`;

  const { data: accounts } = await sb.from('client_marketing').select('*');
  const byClient = Object.fromEntries((accounts || []).map((a) => [a.client_id, a]));
  const clients = ctx.state.clients || [];
  const box = $('#ca-list', el);
  if (!clients.length) { box.innerHTML = ctx.emptyCard('users', 'Nenhum cliente cadastrado ainda.'); return; }

  box.innerHTML = clients.map((c) => {
    const a = byClient[c.id] || {};
    const f = (key, label, ph) => `<label>${label}<input data-k="${key}" value="${esc(a[key] || '')}" placeholder="${ph}"></label>`;
    return `
      <form class="card form account-card" data-client="${c.id}" novalidate>
        <div class="row" style="padding:0"><div class="row-main"><h4>${esc(c.name || c.email)}</h4><p>${esc(c.email)}</p></div></div>
        <div class="grid grid-3 compact">
          ${f('meta_ad_account_id', 'Conta de anúncio Meta', 'act_1234567890')}
          ${f('meta_pixel_id', 'Pixel do cliente (Meta)', '1234567890123456')}
          ${f('google_ads_customer_id', 'Conta Google Ads', '123-456-7890')}
          ${f('ga4_property_id', 'Propriedade Google Analytics', '345678901')}
          ${f('website', 'Site do cliente', 'https://www.cliente.com.br')}
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary btn-sm">Salvar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-sync>${ctx.icon('refresh')} Sincronizar (90 dias)</button>
        </div>
      </form>`;
  }).join('');

  $$('form[data-client]', box).forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const row = { client_id: form.dataset.client, updated_at: new Date().toISOString() };
      $$('[data-k]', form).forEach((i) => { row[i.dataset.k] = i.value.trim() || null; });
      if (row.website && !/^https?:\/\//i.test(row.website)) row.website = 'https://' + row.website;
      await busy(form.querySelector('[type=submit]'), async () => {
        const { error } = await sb.from('client_marketing').upsert(row, { onConflict: 'client_id' });
        if (error) { toast('Não foi possível salvar.', 'error'); return; }
        toast('Contas salvas!');
      });
    });
    form.querySelector('[data-sync]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try {
        const res = await callFunction('marketing-sync', { client_id: form.dataset.client, days: 90 });
        const s = res.clients?.[form.dataset.client] || {};
        const parts = Object.entries(s).map(([k, v]) => `${SOURCE_LABEL[k] || k}: ${v}`);
        toast(parts.length ? parts.join(' · ') : 'Nenhuma conta preenchida para este cliente.', res.ok ? 'ok' : 'error');
        loadRuns();
      } catch (err) { toast(err.message, 'error'); }
    }));
  });

  $('#ca-sync-all', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      const res = await callFunction('marketing-sync', { days: 30 });
      toast(res.ok ? 'Sincronização concluída!' : 'Sincronização concluída com avisos. Veja abaixo.', res.ok ? 'ok' : 'info');
      loadRuns();
    } catch (err) { toast(err.message, 'error'); }
  }));

  async function loadRuns() {
    const { data } = await sb.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(5);
    const runs = $('#ca-runs', el);
    if (!data?.length) { runs.innerHTML = ''; return; }
    runs.innerHTML = `<h3 style="margin-top:26px">Últimas sincronizações</h3><div class="list">${data.map((r) => {
      const lines = Object.entries(r.summary?.clients || {}).flatMap(([cid, s]) =>
        Object.entries(s).map(([k, v]) => `<li><strong>${esc(ctx.clientName(cid))}</strong> · ${SOURCE_LABEL[k] || k}: ${esc(v)}</li>`));
      return `<div class="card"><p style="margin:0 0 6px"><span class="badge ${r.ok ? 'admin' : r.ok === false ? 'owner' : ''}">${r.ok ? 'Tudo certo' : r.ok === false ? 'Com avisos' : 'Em andamento'}</span>
        <span class="muted small"> ${ctx.fmtDateTime(r.started_at)} · ${r.trigger === 'agendado' ? 'automática' : 'manual'}</span></p>
        ${lines.length ? `<ul class="sync-lines">${lines.join('')}</ul>` : '<p class="muted small" style="margin:0">Nenhuma conta de cliente preenchida ainda.</p>'}</div>`;
    }).join('')}</div>`;
  }
  loadRuns();
}

// ---------------------------------------------------------------------
// INTEGRAÇÕES (somente Proprietário)
// ---------------------------------------------------------------------
const PUBLIC_FIELDS = [
  { key: 'int_meta_pixel_id', label: 'ID do Pixel da Meta (da True Elo)', ph: '1234567890123456', help: 'Gerenciador de Eventos da Meta → Fontes de dados → seu Pixel.' },
  { key: 'int_meta_test_event_code', label: 'Código de teste de eventos (opcional)', ph: 'TEST12345', help: 'Use só enquanto testa no Gerenciador de Eventos → Testar eventos. Depois apague.' },
  { key: 'int_ga4_measurement_id', label: 'ID de medição do Google Analytics 4', ph: 'G-XXXXXXXXXX', help: 'Analytics → Administrador → Fluxos de dados → seu site.' },
  { key: 'int_gads_conversion_id', label: 'ID do Google Ads', ph: 'AW-123456789', help: 'Google Ads → Metas → Conversões → Configurar a tag.' },
  { key: 'int_gads_lead_label', label: 'Rótulo da conversão "pediu extensão"', ph: 'AbCdEfGhIjk', help: 'Parte depois da barra em "AW-123456789/AbCdEfGhIjk".' },
];
const SECRET_FIELDS = [
  { key: 'meta_capi_token', label: 'Token da API de Conversões (Meta)', help: 'Gerenciador de Eventos → seu Pixel → Configurações → API de Conversões → Gerar token de acesso.' },
  { key: 'meta_api_token', label: 'Token de acesso da Meta para ler as campanhas', help: 'Configurações do Negócio → Usuários do sistema → Gerar token (permissões ads_read e business_management).' },
  { key: 'google_client_id', label: 'Google: Client ID (OAuth)', help: 'Google Cloud → APIs e serviços → Credenciais → ID do cliente OAuth.' },
  { key: 'google_client_secret', label: 'Google: Client Secret (OAuth)', help: 'Mesma tela do Client ID.' },
  { key: 'google_developer_token', label: 'Google Ads: Developer token (opcional)', help: 'Não é mais exigido: desde 09/09/2026 o acesso à API do Google Ads é liberado no próprio projeto do Google Cloud (Google Ads API → Visão geral → nível de acesso). Só preencha se tiver um token antigo.' },
  { key: 'google_login_customer_id', label: 'Google Ads: ID da conta de administrador (MCC)', help: 'Número da conta de administrador da True Elo, formato 123-456-7890 (a da True Elo é 928-057-9742).' },
];
const ADVANCED_FIELDS = [
  { key: 'int_meta_api_version', label: 'Versão da API da Meta', ph: 'v23.0' },
  { key: 'int_google_ads_api_version', label: 'Versão da API do Google Ads', ph: 'v26' },
];

export async function renderIntegrations(el) {
  const { $, $$, esc, sb, toast, busy, callFunction } = ctx;
  const redirectUri = new URL('oauth/google.html', location.href.split('#')[0]).href;

  const [{ data: settingsRows }, { data: status }] = await Promise.all([
    sb.from('settings').select('key, value').like('key', 'int_%'),
    sb.rpc('integration_status'),
  ]);
  const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value || '']));
  const st = Object.fromEntries((status || []).map((s) => [s.key, s.updated_at]));
  const googleConnected = !!st.google_refresh_token;

  const pub = (f) => `<label>${f.label}<input data-pub="${f.key}" value="${esc(settings[f.key] || '')}" placeholder="${f.ph || ''}"><span class="field-help">${f.help || ''}</span></label>`;
  const sec = (f) => `
    <div class="secret-field">
      <label>${f.label}
        <input type="password" data-sec="${f.key}" autocomplete="off" placeholder="${st[f.key] ? '•••••••• (já configurado, cole um novo para trocar)' : 'Cole aqui'}">
        <span class="field-help">${f.help}</span>
      </label>
      <div class="secret-status">${st[f.key] ? `<span class="badge admin">Configurado em ${ctx.fmtDate(st[f.key])}</span> <button type="button" class="btn-link" data-remove="${f.key}">Remover</button>` : '<span class="badge">Não configurado</span>'}</div>
    </div>`;

  el.innerHTML = `
    <div class="page-head"><div><h1>Integrações</h1><p class="muted">Conecte o portal à Meta e ao Google. Só o Administrador Proprietário vê esta tela.</p></div></div>

    <form class="card form" id="int-public" novalidate>
      <h3>1. Medição do portal (Pixel, API de Conversões e tags do Google)</h3>
      <p class="muted small" style="margin:0">Mede o que os clientes fazem no portal (entrar, ver relatórios, pedir extensão) para melhorar as campanhas da própria True Elo. Só funciona para quem aceitar os cookies.</p>
      ${PUBLIC_FIELDS.map(pub).join('')}
      <div><button type="submit" class="btn btn-primary">Salvar medição</button></div>
    </form>

    <form class="card form" id="int-secrets" novalidate>
      <h3>2. Chaves secretas</h3>
      <p class="muted small" style="margin:0">Ficam trancadas no servidor. Depois de salvas, ninguém consegue ver de novo, nem você. Para trocar, é só colar uma nova.</p>
      ${SECRET_FIELDS.map(sec).join('')}
      <div><button type="submit" class="btn btn-primary">Salvar chaves</button></div>
    </form>

    <div class="card form">
      <h3>3. Conexão com o Google (Google Ads e Analytics)</h3>
      <p class="muted small" style="margin:0">Depois de salvar o Client ID e o Client Secret, clique em conectar e autorize com a conta Google que acessa as contas dos clientes.</p>
      <p style="margin:0">Situação: ${googleConnected ? `<span class="badge admin">Conectado em ${ctx.fmtDate(st.google_refresh_token)}</span>` : '<span class="badge">Não conectado</span>'}</p>
      <label>URI de redirecionamento (cole no Google Cloud, em "URIs de redirecionamento autorizados")
        <div class="copy-row"><input readonly value="${redirectUri}" id="int-redirect"><button type="button" class="btn btn-ghost btn-sm" id="int-copy">Copiar</button></div>
      </label>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="int-google-connect">${googleConnected ? 'Reconectar Google' : 'Conectar Google'}</button>
        ${googleConnected ? '<button type="button" class="btn btn-ghost" id="int-google-disconnect" style="color:var(--danger)">Desconectar</button>' : ''}
      </div>
    </div>

    <details class="card form">
      <summary><strong>Avançado: versões das APIs</strong> <span class="muted small">(só mexa se as plataformas pedirem atualização)</span></summary>
      <form id="int-advanced" class="form" style="margin-top:14px" novalidate>
        ${ADVANCED_FIELDS.map(pub).join('')}
        <div><button type="submit" class="btn btn-ghost">Salvar versões</button></div>
      </form>
    </details>`;

  const savePublic = async (form, btn) => {
    const rows = $$('[data-pub]', form).map((i) => ({ key: i.dataset.pub, value: i.value.trim(), updated_at: new Date().toISOString() }));
    await busy(btn, async () => {
      const toDelete = rows.filter((r) => !r.value).map((r) => r.key);
      const toSave = rows.filter((r) => r.value);
      if (toSave.length) { const { error } = await sb.from('settings').upsert(toSave); if (error) { toast('Não foi possível salvar.', 'error'); return; } }
      if (toDelete.length) await sb.from('settings').delete().in('key', toDelete);
      toast('Salvo! As tags passam a valer na próxima vez que o portal for aberto.');
    });
  };
  $('#int-public', el).addEventListener('submit', (e) => { e.preventDefault(); savePublic(e.currentTarget, e.currentTarget.querySelector('[type=submit]')); });
  $('#int-advanced', el).addEventListener('submit', (e) => { e.preventDefault(); savePublic(e.currentTarget, e.currentTarget.querySelector('[type=submit]')); });

  $('#int-secrets', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const filled = $$('[data-sec]', e.currentTarget).filter((i) => i.value.trim());
    if (!filled.length) { toast('Cole pelo menos uma chave.', 'error'); return; }
    await busy(e.currentTarget.querySelector('[type=submit]'), async () => {
      for (const i of filled) {
        const { error } = await sb.rpc('set_integration_secret', { secret_key: i.dataset.sec, secret_value: i.value.trim() });
        if (error) { toast('Não foi possível salvar uma das chaves.', 'error'); return; }
      }
      toast('Chaves salvas com segurança!');
      renderIntegrations(el);
    });
  });
  $$('[data-remove]', el).forEach((b) => b.addEventListener('click', async () => {
    const ok = await ctx.confirmModal({ title: 'Remover chave?', text: 'A integração que usa esta chave deixa de funcionar até você colar uma nova.', confirmLabel: 'Remover' });
    if (!ok) return;
    const { error } = await sb.rpc('set_integration_secret', { secret_key: b.dataset.remove, secret_value: '' });
    if (error) { toast('Não foi possível remover.', 'error'); return; }
    toast('Chave removida.');
    renderIntegrations(el);
  }));

  $('#int-copy', el).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(redirectUri); toast('Copiado!'); }
    catch { $('#int-redirect', el).select(); toast('Selecione e copie com Ctrl+C.', 'info'); }
  });
  $('#int-google-connect', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      const res = await callFunction('google-oauth', { action: 'start', siteUrl: ctx.SITE_URL });
      window.location.href = res.url;
    } catch (err) { toast(err.message, 'error'); }
  }));
  $('#int-google-disconnect', el)?.addEventListener('click', async () => {
    const ok = await ctx.confirmModal({ title: 'Desconectar o Google?', text: 'O portal para de buscar os números do Google Ads e do Analytics até você conectar de novo.', confirmLabel: 'Desconectar' });
    if (!ok) return;
    try { await callFunction('google-oauth', { action: 'disconnect' }); toast('Google desconectado.'); renderIntegrations(el); }
    catch (err) { toast(err.message, 'error'); }
  });
}
