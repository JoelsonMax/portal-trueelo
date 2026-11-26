// =====================================================================
// PORTAL DO CLIENTE TRUE ELO — aplicação (etapa 1)
// Login, convite ("Crie sua senha"), recuperação e troca de senha por
// e-mail, menu por papel e gerenciamento de usuários.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, WHATSAPP_NUMBER } from './config.js';
import { setupMarketing, renderPerformance, renderMonthlyReport, renderClientAccounts, renderIntegrations, showGeneratedReport } from './marketing.js';
import { initTracking, track, openCookiePreferences, consentStatus } from './tracking.js';

// Lê o endereço ANTES do Supabase limpar, para saber se a pessoa chegou
// por um link de convite ou de recuperação de senha.
const linkParams = new URLSearchParams(window.location.hash.slice(1));
const linkType = linkParams.get('type');                 // 'invite' | 'recovery' | null
const linkError = linkParams.get('error_code') || linkParams.get('error');

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const SITE_URL = window.location.origin + window.location.pathname.replace(/index\.html$/, '');

// ---------------------------------------------------------------------
// Papéis
// ---------------------------------------------------------------------
const ROLES = {
  proprietario:  { label: 'Administrador Proprietário', level: 6 },
  administrador: { label: 'Administrador',              level: 5 },
  moderador:     { label: 'Moderador',                  level: 4 },
  editor:        { label: 'Editor',                     level: 3 },
  equipe:        { label: 'Equipe',                     level: 2 },
  usuario:       { label: 'Usuário',                    level: 1 },
};
const levelOf = (role) => ROLES[role]?.level ?? 0;
const roleLabel = (role) => ROLES[role]?.label ?? role;

const state = { session: null, profile: null, loggingOut: false, section: 'inicio', users: [], logoUrl: null };

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => (name || '?').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
// Nome completo para cumprimentos (clientes costumam ser empresas: "G.I Fabricações" não vira "G.I").
const greetName = () => (state.profile?.name || '').trim();
const withName = (text) => (greetName() ? `${greetName()}, ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca acessou');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), type === 'error' ? 5000 : 3500);
  setTimeout(() => el.remove(), type === 'error' ? 5400 : 3900);
}

function show(screenId) {
  $$('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== screenId));
  window.scrollTo(0, 0);
}

async function busy(button, fn) {
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Carregando…';
  try { return await fn(); } finally { button.disabled = false; button.innerHTML = label; }
}

function clearUrlHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

const ICONS = {
  home: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
  doc: '<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
  clock: '<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  chart: '<path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>',
  user: '<path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>',
  users: '<path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>',
  upload: '<path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>',
  calendar: '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>',
  brush: '<path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>',
  shield: '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
  edit: '<path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>',
  key: '<path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>',
  trash: '<path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M14 7h7v7"/>',
  report: '<path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  plug: '<path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 01-10 0V7zm5 9v5"/>',
  refresh: '<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>',
  bell: '<path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>',
  extend: '<path d="M12 8v4l3 3M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/>',
  link: '<path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>',
  download: '<path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>',
  whatsapp: '<path d="M3 21l1.65-4.95A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.05-1.03L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 01-1.8-1.8l.8-1-1-2L9 9.5z"/>',
  tools: '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------------------------------------------------------------------
// Marca (logo)
// ---------------------------------------------------------------------
async function loadLogo() {
  try {
    const { data } = await sb.from('settings').select('key, value');
    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    state.logoUrl = map.logo_path ? sb.storage.from('marca').getPublicUrl(map.logo_path).data.publicUrl : null;
    state.integrations = Object.fromEntries(Object.entries(map).filter(([k]) => k.startsWith('int_')));
  } catch { /* sem logo personalizado: usa o padrão */ }
  renderLogos();
}

function renderLogos() {
  $$('[data-logo]').forEach((el) => {
    if (state.logoUrl) {
      el.innerHTML = `<img class="custom" src="${esc(state.logoUrl)}" alt="True Elo">`;
      return;
    }
    // Logo padrão: símbolo + "TrueElo". O slogan só aparece nas telas
    // grandes de entrada (classe .brand-lg), onde há espaço para ele.
    el.innerHTML = `
      <img class="symbol" src="assets/logo-simbolo.png" alt="">
      <div class="wordmark">
        <span class="name"><span class="t">True</span><span class="e">Elo</span></span>
        <span class="slogan">Onde o digital se conecta com humano</span>
      </div>`;
  });
}

// ---------------------------------------------------------------------
// Início do app
// ---------------------------------------------------------------------
async function boot() {
  bindStaticEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (SUPABASE_URL.includes('SEU-PROJETO')) {
    show('screen-login');
    renderLogos();
    toast('Configure o arquivo js/config.js com os dados do Supabase.', 'error');
    return;
  }

  await loadLogo();
  initTracking(state.integrations || {}, sb);
  track('PageView');

  if (linkError) {
    clearUrlHash();
    show('screen-login');
    toast('Este link expirou ou já foi usado. Peça um novo link.', 'error');
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  state.session = session;

  sb.auth.onAuthStateChange((event, newSession) => {
    state.session = newSession;
    // Não chamar o Supabase direto aqui dentro (recomendação da biblioteca).
    if (event === 'SIGNED_OUT' && state.profile && !state.loggingOut) {
      setTimeout(() => { state.profile = null; show('screen-expired'); }, 0);
    }
  });

  if (session && (linkType === 'invite' || linkType === 'recovery')) {
    clearUrlHash();
    showPasswordScreen(linkType);
    return;
  }

  if (session) await enterApp();
  else show('screen-login');
}

function showPasswordScreen(mode) {
  const invite = mode === 'invite';
  $('#password-title').textContent = invite ? 'Crie sua senha' : 'Defina sua nova senha';
  $('#password-subtitle').textContent = invite
    ? 'Bem-vindo à True Elo! Defina uma senha para acessar seu portal.'
    : 'Escolha uma nova senha para a sua conta.';
  $('#form-password').reset();
  show('screen-password');
}

async function enterApp() {
  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, name, email, phone, role, created_at, last_login, email_updates')
    .eq('id', state.session.user.id)
    .single();

  if (error || !profile) { show('screen-denied'); return; }

  state.profile = profile;
  sb.rpc('touch_last_login').then(() => {}, () => {});
  sb.rpc('complete_due_transfers').then(() => {}, () => {});

  renderShell();
  go(sectionFromHash());
  show('screen-app');
}

async function logout() {
  state.loggingOut = true;
  try { await sb.auth.signOut(); } catch { /* ignora */ }
  state.profile = null;
  state.loggingOut = false;
  closeModal();
  $('#form-login').reset();
  show('screen-login');
}

// ---------------------------------------------------------------------
// Formulários de autenticação
// ---------------------------------------------------------------------
function bindStaticEvents() {
  document.addEventListener('click', (e) => {
    const sectionBtn = e.target.closest('[data-go-section]');
    if (sectionBtn && state.profile) { goSection(sectionBtn.dataset.goSection); return; }
    const go = e.target.closest('[data-go]');
    if (go) { show(go.dataset.go); return; }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') logout();
    if (action === 'open-menu') $('.app').classList.add('menu-open');
    if (action === 'close-menu') $('.app').classList.remove('menu-open');
  });

  // Abas da recuperação (e-mail / celular)
  $$('#screen-forgot .tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('#screen-forgot .tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('#screen-forgot [data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
  }));

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.email.value.trim().toLowerCase();
    const password = form.password.value;
    if (!EMAIL_RE.test(email) || !password) { toast('Informe seu e-mail e sua senha.', 'error'); return; }

    await busy(form.querySelector('[type=submit]'), async () => {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        toast(error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'E-mail ou senha incorretos.', 'error');
        return;
      }
      state.session = data.session;
      track('Login');
      await enterApp();
    });
  });

  $('#form-forgot').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.email.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { toast('Informe um e-mail válido.', 'error'); return; }

    await busy(form.querySelector('[type=submit]'), async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
      if (error?.status === 429) { toast('Muitas solicitações. Aguarde alguns minutos.', 'error'); return; }
      // Mensagem igual para e-mail cadastrado ou não (não revela quem é cliente).
      toast('Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.');
      form.reset();
      show('screen-login');
    });
  });

  $('#form-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const password = form.password.value;
    const confirm = form.confirm.value;
    const problem = passwordProblem(password, confirm);
    if (problem) { toast(problem, 'error'); return; }

    await busy(form.querySelector('[type=submit]'), async () => {
      const { error } = await sb.auth.updateUser({ password });
      if (error) {
        if (error.code === 'same_password') toast('A nova senha precisa ser diferente da anterior.', 'error');
        else if (error.status === 401 || error.code === 'session_not_found') { toast('Link expirado. Peça um novo.', 'error'); show('screen-login'); }
        else toast('Não foi possível salvar a senha. Tente novamente.', 'error');
        return;
      }
      toast('Senha salva com sucesso!');
      state.justSetPassword = true;
      await enterApp();
    });
  });

  // Fecha o modal clicando fora ou com Esc
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

function passwordProblem(password, confirm) {
  if (password.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use letras e números na senha.';
  if (password !== confirm) return 'As senhas não coincidem.';
  return null;
}

// ---------------------------------------------------------------------
// Estrutura do portal e menu por papel
// ---------------------------------------------------------------------
const MENU = [
  { id: 'inicio',         label: 'Início',                 icon: 'home',     min: 1 },
  { id: 'desempenho',     label: 'Desempenho',             icon: 'trend',    min: 1 },
  { id: 'documentos',     label: 'Central de Documentos',  icon: 'doc',      min: 1 },
  { id: 'linha',          label: 'Linha do Tempo',         icon: 'clock',    min: 1 },
  { id: 'relatorios',     label: 'Central de Relatórios',  icon: 'chart',    min: 1 },
  { id: 'conta',          label: 'Minha conta',            icon: 'user',     min: 1 },
  { group: 'Administração',                                                  min: 2 },
  { id: 'solicitacoes',   label: 'Solicitações',           icon: 'bell',     min: 2 },
  { id: 'usuarios',       label: 'Gerenciar usuários',     icon: 'users',    min: 4 },
  { id: 'adm-documentos', label: 'Enviar documentos',      icon: 'upload',   min: 3 },
  { id: 'adm-relatorios', label: 'Gerenciar relatórios',   icon: 'chart',    min: 3 },
  { id: 'adm-servicos',   label: 'Gerenciar serviços',     icon: 'calendar', min: 4 },
  { id: 'relatorio-mensal', label: 'Relatório mensal',     icon: 'report',   min: 3 },
  { id: 'contas-clientes', label: 'Contas de anúncio',     icon: 'target',   min: 4 },
  { id: 'marca',          label: 'Configurações da marca', icon: 'brush',    min: 6 },
  { id: 'integracoes',    label: 'Integrações',            icon: 'plug',     min: 6 },
  { id: 'propriedade',    label: 'Transferir propriedade', icon: 'shield',   min: 6, gold: true },
];

const myLevel = () => levelOf(state.profile?.role);

function renderShell() {
  const p = state.profile;
  $('#user-avatar').textContent = initials(p.name || p.email);
  $('#user-name').textContent = p.name || p.email;
  $('#user-role').textContent = roleLabel(p.role);
  const top = $('#topbar-user');
  if (top) { top.textContent = initials(p.name || p.email); top.title = p.name || p.email; }
  if (p.name) toast(state.justSetPassword ? `Bem-vindo à True Elo, ${p.name}!` : `Olá, ${p.name}!`, 'ok');
  state.justSetPassword = false;

  $('#menu').innerHTML = MENU.filter((m) => myLevel() >= m.min).map((m) => m.group
    ? `<div class="menu-group">${esc(m.group)}</div>`
    : `<button type="button" class="menu-item${m.gold ? ' gold' : ''}" data-section="${m.id}">${icon(m.icon)}<span>${esc(m.label)}</span>${m.id === 'solicitacoes' ? '<span class="menu-badge hidden" id="badge-solicitacoes"></span>' : ''}</button>`
  ).join('');

  refreshRequestsBadge();
  $$('#menu [data-section]').forEach((b) => b.addEventListener('click', () => {
    go(b.dataset.section);
    $('.app').classList.remove('menu-open');
  }));
}

function goSection(id) { go(id); }

// Abre a seção certa quando o portal é aberto por um link de e-mail (ex.: #relatorios)
function sectionFromHash() {
  const h = window.location.hash.replace('#', '');
  if (h.startsWith('integracoes-google-')) {
    const st = h.replace('integracoes-google-', '');
    const msg = { ok: ['Google conectado com sucesso!', 'ok'], cancelado: ['Conexão com o Google cancelada.', 'info'], expirado: ['O pedido de conexão expirou. Tente de novo.', 'error'], erro: ['O Google não autorizou a conexão. Confira o Client ID, o Client Secret e o URI de redirecionamento.', 'error'] }[st];
    if (msg) setTimeout(() => toast(msg[0], msg[1]), 400);
    history.replaceState(null, '', window.location.pathname);
    return 'integracoes';
  }
  const map = { emails: 'conta', relatorios: 'relatorios', 'relatorio-mensal': 'relatorio-mensal', desempenho: 'desempenho', solicitacoes: 'solicitacoes', integracoes: 'integracoes' };
  const target = map[h];
  const item = MENU.find((m) => m.id === target);
  return target && item && myLevel() >= item.min ? target : 'inicio';
}

function go(sectionId) {
  const item = MENU.find((m) => m.id === sectionId);
  if (!item || myLevel() < item.min) { show('screen-denied'); return; }
  state.section = sectionId;
  $$('#menu [data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === sectionId));

  const content = $('#content');
  content.style.animation = 'none'; void content.offsetHeight; content.style.animation = '';
  (SECTIONS[sectionId] || renderComingSoon)(content, item);
  track('PageView');
}

const SECTIONS = {
  inicio: renderHome,
  documentos: renderDocuments,
  linha: renderTimeline,
  relatorios: renderReports,
  conta: renderAccount,
  usuarios: renderUsers,
  'adm-documentos': (el) => renderAdminFiles(el, 'documents'),
  'adm-relatorios': (el) => renderAdminFiles(el, 'reports'),
  'adm-servicos': renderAdminServices,
  marca: renderBranding,
  propriedade: renderOwnership,
  solicitacoes: renderRequests,
  desempenho: renderPerformance,
  'relatorio-mensal': renderMonthlyReport,
  'contas-clientes': renderClientAccounts,
  integracoes: renderIntegrations,
};

// ---------------------------------------------------------------------
// Minha conta (inclui troca de senha com confirmação por e-mail)
// ---------------------------------------------------------------------
function renderAccount(el) {
  const p = state.profile;
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Minha conta</h1><p class="muted">Seus dados de acesso ao portal.</p></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3>Dados</h3>
        <dl class="info-list">
          <dt>Nome</dt><dd>${esc(p.name || '—')}</dd>
          <dt>E-mail</dt><dd>${esc(p.email)}</dd>
          <dt>Telefone</dt><dd>${esc(p.phone || '—')}</dd>
          <dt>Função</dt><dd>${esc(roleLabel(p.role))}</dd>
          <dt>Cliente desde</dt><dd>${fmtDate(p.created_at)}</dd>
        </dl>
        <p class="muted small" style="margin:0">Para corrigir seus dados, fale com a True Elo.</p>
      </div>
      <div class="card">
        <h3>Alterar senha</h3>
        <p class="muted">Por segurança, enviamos um link de confirmação para <strong>${esc(p.email)}</strong>. Abra o e-mail e escolha a nova senha.</p>
        <button type="button" class="btn btn-primary" id="btn-change-password">${icon('key')} Enviar link de confirmação</button>
      </div>
      <div class="card" id="email-prefs">
        <h3>Preferências de e-mail</h3>
        <label class="switch-row">
          <span>
            <strong>Receber e-mails informativos</strong>
            <span class="muted small">Relatórios mensais, novidades e lembretes da True Elo.</span>
          </span>
          <input type="checkbox" id="pref-email-updates" class="switch" ${p.email_updates !== false ? 'checked' : ''}>
        </label>
        <p class="muted small" style="margin:12px 0 0">E-mails de segurança e de acesso, como convite, redefinição de senha e avisos de alteração na conta, continuam chegando sempre, para proteger sua conta.</p>
        ${consentStatus() !== null || Object.values(state.integrations || {}).some(Boolean) ? `<button type="button" class="btn-link" id="btn-cookies" style="padding:0;margin-top:12px">Preferências de cookies</button>` : ''}
      </div>
    </div>`;

  $('#btn-cookies', el)?.addEventListener('click', openCookiePreferences);

  $('#pref-email-updates', el).addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    e.target.disabled = true;
    const { error } = await sb.rpc('set_email_updates', { enabled });
    e.target.disabled = false;
    if (error) { e.target.checked = !enabled; toast('Não foi possível salvar sua preferência.', 'error'); return; }
    state.profile.email_updates = enabled;
    toast(enabled ? 'Pronto! Você voltará a receber os e-mails informativos.' : 'Pronto! Você não receberá mais e-mails informativos.');
  });

  if (location.hash.includes('emails')) {
    $('#email-prefs', el).scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#email-prefs', el).classList.add('highlight');
  }

  $('#btn-change-password', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const { error } = await sb.auth.resetPasswordForEmail(p.email, { redirectTo: SITE_URL });
    if (error) {
      toast(error.status === 429 ? 'Você já pediu um link há pouco. Aguarde alguns minutos.' : 'Não foi possível enviar o e-mail. Tente novamente.', 'error');
      return;
    }
    toast('Link enviado! Confira seu e-mail (e a caixa de spam).');
  }));
}

// ---------------------------------------------------------------------
// Gerenciar usuários
// ---------------------------------------------------------------------
async function callAdmin(action, payload = {}) {
  return callFunction('admin-users', { action, redirectTo: SITE_URL, ...payload });
}

async function callFunction(name, payload = {}) {
  const { data, error } = await sb.functions.invoke(name, { body: payload });
  if (error) {
    let message = 'Não foi possível concluir a ação.';
    try { const body = await error.context.json(); if (body?.error) message = body.error; } catch { /* sem corpo */ }
    if (message === 'Sessão expirada') { show('screen-expired'); }
    throw new Error(message);
  }
  return data;
}

const canManage = (u) => u.id !== state.profile.id && levelOf(u.role) < myLevel();
const assignableRoles = () => Object.entries(ROLES).filter(([key, r]) => key !== 'proprietario' && r.level < myLevel());
const roleOptions = (selected) => assignableRoles()
  .map(([key, r]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${esc(r.label)}</option>`).join('');

async function renderUsers(el) {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Gerenciar usuários</h1><p class="muted">Adicione e gerencie as pessoas que acessam o portal.</p></div>
      <button type="button" class="btn btn-primary" id="btn-add-user">${icon('plus')} Adicionar usuário</button>
    </div>
    <div class="toolbar">
      <input type="search" id="user-search" placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuário">
      <select id="user-filter" aria-label="Filtrar por função" style="max-width:240px">
        <option value="">Todas as funções</option>
        ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}">${esc(r.label)}</option>`).join('')}
      </select>
    </div>
    <div id="users-list" class="list"><div class="card empty"><div class="spinner" style="margin:0 auto"></div></div></div>`;

  $('#btn-add-user', el).addEventListener('click', openAddUser);
  $('#user-search', el).addEventListener('input', drawUsers);
  $('#user-filter', el).addEventListener('change', drawUsers);
  await loadUsers();
}

async function loadUsers() {
  const { data, error } = await sb
    .from('profiles')
    .select('id, name, email, phone, role, created_at, last_login')
    .order('name');
  if (error) { toast('Não foi possível carregar os usuários.', 'error'); return; }
  state.users = data || [];
  state.clients = null; // força recarregar a lista de clientes nas outras telas
  drawUsers();
}

function drawUsers() {
  const list = $('#users-list');
  if (!list) return;
  const q = ($('#user-search')?.value || '').trim().toLowerCase();
  const role = $('#user-filter')?.value || '';
  const users = state.users
    .filter((u) => u.id !== state.profile.id)
    .filter((u) => !role || u.role === role)
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    .sort((a, b) => levelOf(b.role) - levelOf(a.role) || a.name.localeCompare(b.name, 'pt-BR'));

  if (!users.length) {
    list.innerHTML = `<div class="card empty">${icon('users')}<p class="muted">${q || role ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado ainda.'}</p></div>`;
    return;
  }

  const isOwner = state.profile.role === 'proprietario';
  list.innerHTML = users.map((u) => {
    const badge = u.role === 'proprietario' ? 'owner' : u.role === 'administrador' ? 'admin' : '';
    const pending = !u.last_login;
    return `
      <div class="card row">
        <div class="avatar">${esc(initials(u.name || u.email))}</div>
        <div class="row-main">
          <h4>${esc(u.name || '(sem nome)')}</h4>
          <p>${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</p>
          <span class="badge ${badge}">${esc(roleLabel(u.role))}</span>
          <span class="muted small"> · ${pending ? 'Convite enviado, ainda não acessou' : 'Último acesso: ' + esc(fmtDateTime(u.last_login))}</span>
        </div>
        ${canManage(u) ? `
          <div class="row-actions">
            <button type="button" class="icon-btn cyan" data-act="edit" data-id="${u.id}" title="Editar permissões" aria-label="Editar permissões">${icon('edit')}</button>
            ${isOwner ? `<button type="button" class="icon-btn gold" data-act="reset" data-id="${u.id}" title="Redefinir senha do usuário" aria-label="Redefinir senha do usuário">${icon('key')}</button>` : ''}
            <button type="button" class="icon-btn red" data-act="delete" data-id="${u.id}" title="Excluir usuário" aria-label="Excluir usuário">${icon('trash')}</button>
          </div>` : ''}
      </div>`;
  }).join('');

  $$('[data-act]', list).forEach((b) => b.addEventListener('click', () => {
    const user = state.users.find((u) => u.id === b.dataset.id);
    if (!user) return;
    if (b.dataset.act === 'edit') openEditRole(user);
    if (b.dataset.act === 'reset') openResetPassword(user);
    if (b.dataset.act === 'delete') openDeleteUser(user);
  }));
}

function openAddUser() {
  openModal(`
    <h3>Adicionar usuário</h3>
    <form class="form" id="form-add-user" novalidate>
      <label>Nome completo<input name="name" required placeholder="Nome do usuário"></label>
      <label>E-mail<input name="email" type="email" required placeholder="email@exemplo.com"></label>
      <label>Celular<input name="phone" type="tel" placeholder="+55 85 99999-9999"></label>
      <label>Função<select name="role">${roleOptions('usuario')}</select></label>
      <p class="muted small" style="margin:0">A pessoa vai receber um e-mail de convite para criar a própria senha.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Cadastrar</button>
      </div>
    </form>`);

  $('#form-add-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const el = f.elements; // (form.name seria o nome do formulário, por isso usamos elements)
    const payload = { name: el.name.value.trim(), email: el.email.value.trim().toLowerCase(), phone: el.phone.value.trim(), role: el.role.value };
    if (payload.name.length < 2) { toast('Informe o nome completo.', 'error'); return; }
    if (!EMAIL_RE.test(payload.email)) { toast('Informe um e-mail válido.', 'error'); return; }

    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await callAdmin('invite', payload);
        toast(`Convite enviado para ${payload.email}.`);
        closeModal();
        await loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function openEditRole(user) {
  openModal(`
    <h3>Editar permissões</h3>
    <form class="form" id="form-edit-role">
      <div><span class="muted small">Usuário</span><p style="margin:2px 0 0"><strong>${esc(user.name)}</strong><br><span class="muted small">${esc(user.email)}</span></p></div>
      <label>Função<select name="role">${roleOptions(user.role)}</select></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>`);

  $('#form-edit-role').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await callAdmin('update_role', { userId: user.id, role: f.role.value });
        toast('Permissões atualizadas!');
        closeModal();
        await loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function openResetPassword(user) {
  openModal(`
    <h3>Redefinir senha do usuário</h3>
    <p class="muted">Vamos enviar para <strong>${esc(user.email)}</strong> um link para ${esc(firstName(user.name) || 'o usuário')} criar uma nova senha. Ninguém além dele verá a senha.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
      <button type="button" class="btn btn-gold" id="btn-confirm-reset">Enviar link</button>
    </div>`);

  $('#btn-confirm-reset').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      await callAdmin('send_password_reset', { userId: user.id });
      toast('Link de redefinição enviado!');
      closeModal();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function openDeleteUser(user) {
  openModal(`
    <div class="center">
      <div class="status-icon status-danger" style="margin:0 auto 14px">${icon('trash')}</div>
      <h3 style="margin-bottom:8px">Excluir usuário?</h3>
      <p class="muted"><strong>${esc(user.name)}</strong> perderá o acesso, e os documentos e relatórios dele serão apagados. Esta ação não pode ser desfeita.</p>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
      <button type="button" class="btn btn-danger" id="btn-confirm-delete">Excluir</button>
    </div>`);

  $('#btn-confirm-delete').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    try {
      await callAdmin('delete', { userId: user.id });
      toast('Usuário excluído.');
      closeModal();
      await loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

// ---------------------------------------------------------------------
// Dados compartilhados (clientes, arquivos, datas)
// ---------------------------------------------------------------------
const isStaff = () => myLevel() >= 2;     // Equipe para cima vê todos os clientes
const isClient = () => state.profile?.role === 'usuario';

async function loadClients(force = false) {
  if (state.clients && !force) return state.clients;
  const { data, error } = await sb.from('profiles').select('id, name, email').eq('role', 'usuario').order('name');
  if (error) throw error;
  state.clients = data || [];
  return state.clients;
}
const clientName = (id) => state.clients?.find((c) => c.id === id)?.name || 'Cliente removido';
const clientSelect = (id, { placeholder = 'Selecione um cliente', all = false, selected = '' } = {}) => `
  <select id="${id}" ${all ? '' : 'required'}>
    <option value="">${esc(all ? 'Todos os clientes' : placeholder)}</option>
    ${(state.clients || []).map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name || c.email)}</option>`).join('')}
  </select>`;

// Datas "AAAA-MM-DD" (sem fuso) → "DD/MM/AAAA"
const fmtDay = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monthsAgoISO = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };

const safeFileName = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80);

const MAX_FILE_MB = 50;

// Abre um documento/relatório: link externo ou arquivo protegido (link temporário de 5 min).
async function openItem(item) {
  if (item.kind === 'gerado') { showGeneratedReport(item); return; }
  track('ViewContent', { content_name: item.name || item.title || 'Documento' });
  if (item.url) { window.open(item.url, '_blank', 'noopener'); return; }
  const win = window.open('', '_blank');
  const { data, error } = await sb.storage.from('documentos').createSignedUrl(item.storage_path, 300);
  if (error || !data?.signedUrl) {
    win?.close();
    toast('Não foi possível abrir o arquivo. Tente novamente.', 'error');
    return;
  }
  if (win) { win.opener = null; win.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
}

const whatsappLink = (text) => WHATSAPP_NUMBER
  ? `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
  : null;

function confirmModal({ title, text, confirmLabel = 'Confirmar', kind = 'danger' }) {
  return new Promise((resolve) => {
    openModal(`
      <h3>${esc(title)}</h3>
      <p class="muted">${text}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="button" class="btn ${kind === 'danger' ? 'btn-danger' : kind === 'gold' ? 'btn-gold' : 'btn-primary'}" id="btn-confirm-ok">${esc(confirmLabel)}</button>
      </div>`);
    let done = false;
    $('#btn-confirm-ok').addEventListener('click', () => { done = true; closeModal(); resolve(true); });
    const observer = new MutationObserver(() => {
      if ($('#modal').classList.contains('hidden')) { observer.disconnect(); if (!done) resolve(false); }
    });
    observer.observe($('#modal'), { attributes: true, attributeFilter: ['class'] });
  });
}

const loadingCard = () => '<div class="card empty"><div class="spinner" style="margin:0 auto"></div></div>';
const emptyCard = (iconName, text, extra = '') => `<div class="card empty">${icon(iconName)}<p class="muted"${extra ? '' : ' style="margin:0"'}>${esc(text)}</p>${extra}</div>`;
// Linha do tempo automática: tudo é calculado a partir da data de início e da duração.
const addMonthsISO = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();              // último dia do mês de destino
  const dt = new Date(y, m - 1 + n, Math.min(d, last));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
function serviceStatus(s) {
  if (!s) return null;
  const today = todayISO();
  let done = 0;
  while (done < s.total_months && addMonthsISO(s.start_date, done + 1) <= today) done++;
  const started = s.start_date <= today;
  const finished = done >= s.total_months;
  return {
    done,
    remaining: s.total_months - done,
    current: started && !finished ? done + 1 : null,                 // mês em andamento (1, 2, 3…)
    pct: Math.round((done / s.total_months) * 100),
    started, finished,
    end: addMonthsISO(s.start_date, s.total_months),
    nextTurn: finished ? null : addMonthsISO(s.start_date, done + 1),
  };
}
const progressOf = (s) => serviceStatus(s)?.pct ?? 0;
const statusLine = (s) => {
  const st = serviceStatus(s);
  if (!st.started) return `Começa em ${fmtDay(s.start_date)} · ${s.total_months} meses`;
  if (st.finished) return `Contrato concluído em ${fmtDay(st.end)} · ${s.total_months} meses`;
  return `Mês ${st.current} de ${s.total_months} · ${st.done} completo${st.done === 1 ? '' : 's'} · término em ${fmtDay(st.end)}`;
};

// ---------------------------------------------------------------------
// Início (painel)
// ---------------------------------------------------------------------
async function renderHome(el) {
  const p = state.profile;
  const name = greetName();
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${name ? `Olá, ${esc(name)}!` : 'Bem-vindo!'}</h1>
        <p class="muted">Bem-vindo ao seu portal exclusivo. Acompanhe seus projetos e documentos em um só lugar.</p>
      </div>
    </div>
    <div class="grid grid-3" id="home-stats">
      ${['cyan', 'gold', 'green'].map((c) => `<div class="card stat"><div class="stat-icon ${c}"></div><div><strong>…</strong></div></div>`).join('')}
    </div>
    <div class="card" style="margin-top:18px">
      <h3>Atividade recente</h3>
      <div id="home-activity" class="list" style="margin-top:12px"><p class="muted">Carregando…</p></div>
    </div>`;

  try {
    const mine = (q) => (isClient() ? q.eq('client_id', p.id) : q);
    const [docs, reps, svc, recentDocs, recentReps] = await Promise.all([
      mine(sb.from('documents').select('id', { count: 'exact', head: true })),
      mine(sb.from('reports').select('id', { count: 'exact', head: true })),
      isClient()
        ? sb.from('services').select('*').eq('client_id', p.id).maybeSingle()
        : sb.from('services').select('client_id', { count: 'exact', head: true }),
      mine(sb.from('documents').select('id, name, created_at, client_id, url, storage_path').order('created_at', { ascending: false }).limit(5)),
      mine(sb.from('reports').select('id, title, report_date, created_at, client_id, url, storage_path').order('created_at', { ascending: false }).limit(5)),
    ]);
    if (isStaff()) await loadClients();

    const third = isClient()
      ? { id: 'linha', color: 'green', icon: 'clock', value: `${progressOf(svc.data)}%`, label: 'Progresso do serviço' }
      : { id: 'linha', color: 'green', icon: 'clock', value: svc.count ?? 0, label: 'Contratos acompanhados' };
    const stats = [
      { id: 'documentos', color: 'cyan', icon: 'doc', value: docs.count ?? 0, label: 'Documentos' },
      { id: 'relatorios', color: 'gold', icon: 'chart', value: reps.count ?? 0, label: 'Relatórios' },
      third,
    ];
    $('#home-stats', el).innerHTML = stats.map((s) => `
      <button type="button" class="card quick stat" data-open="${s.id}">
        <div class="stat-icon ${s.color}">${icon(s.icon)}</div>
        <div><strong style="font-size:1.6rem;line-height:1.1">${esc(s.value)}</strong><span class="muted small">${esc(s.label)}</span></div>
      </button>`).join('');
    $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.open)));

    const activity = [
      ...(recentDocs.data || []).map((d) => ({ ...d, kind: 'Documento', title: d.name, when: d.created_at, iconName: 'doc', color: 'cyan' })),
      ...(recentReps.data || []).map((r) => ({ ...r, kind: 'Relatório', when: r.created_at, iconName: 'chart', color: 'gold' })),
    ].sort((a, b) => b.when.localeCompare(a.when)).slice(0, 6);

    const box = $('#home-activity', el);
    if (!activity.length) { box.innerHTML = '<p class="muted center" style="padding:24px 0;margin:0">Nenhuma atividade recente</p>'; return; }
    box.innerHTML = activity.map((a, i) => `
      <div class="row activity">
        <div class="stat-icon ${a.color} sm">${icon(a.iconName)}</div>
        <div class="row-main">
          <h4>${esc(a.title)}</h4>
          <p>${a.kind} adicionado em ${fmtDate(a.when)}${isStaff() ? ' · ' + esc(clientName(a.client_id)) : ''}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-item="${i}">Abrir</button>
      </div>`).join('');
    $$('[data-item]', box).forEach((b) => b.addEventListener('click', () => openItem(activity[+b.dataset.item])));
  } catch (err) {
    console.error(err);
    toast('Não foi possível carregar o painel.', 'error');
  }
}

// ---------------------------------------------------------------------
// Central de Documentos
// ---------------------------------------------------------------------
async function renderDocuments(el) {
  el.innerHTML = `
    <div class="page-head"><div><h1>Central de Documentos</h1><p class="muted">${esc(isClient() ? withName('Aqui você encontra os documentos enviados pela True Elo.') : 'Documentos enviados pela True Elo para os clientes.')}</p></div></div>
    <div class="toolbar" id="docs-toolbar"></div>
    <div id="docs-list" class="grid grid-3">${loadingCard()}</div>`;

  if (isStaff()) {
    await loadClients().catch(() => {});
    $('#docs-toolbar', el).innerHTML = clientSelect('docs-client', { all: true });
    $('#docs-client', el).addEventListener('change', draw);
  } else $('#docs-toolbar', el).remove();

  let docs = [];
  const { data, error } = await sb.from('documents').select('*').order('created_at', { ascending: false });
  if (error) { toast('Não foi possível carregar os documentos.', 'error'); return; }
  docs = data || [];
  draw();

  function draw() {
    const filter = $('#docs-client')?.value;
    const list = docs.filter((d) => !filter || d.client_id === filter);
    const box = $('#docs-list', el);
    if (!list.length) { box.innerHTML = `<div style="grid-column:1/-1">${emptyCard('doc', 'Nenhum documento disponível')}</div>`; return; }
    box.innerHTML = list.map((d, i) => `
      <div class="card doc-card">
        <div class="doc-top">
          <div class="stat-icon cyan">${icon('doc')}</div>
          <div class="row-main">
            <h4 title="${esc(d.name)}">${esc(d.name)}</h4>
            <p>${fmtDate(d.created_at)}${isStaff() ? ' · ' + esc(clientName(d.client_id)) : ''}</p>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-i="${i}">${icon(d.url ? 'link' : 'download')} ${d.url ? 'Abrir' : 'Baixar'}</button>
      </div>`).join('');
    $$('[data-i]', box).forEach((b) => b.addEventListener('click', () => openItem(list[+b.dataset.i])));
  }
}

// ---------------------------------------------------------------------
// Linha do Tempo do Serviço
// ---------------------------------------------------------------------
function timelineDetail(s) {
  const st = serviceStatus(s);
  const badge = !st.started ? '<span class="badge">Ainda não começou</span>'
    : st.finished ? '<span class="badge owner">Contrato concluído</span>'
    : `<span class="badge admin">Mês ${st.current} em andamento</span>`;
  return `
    <div class="timeline-head">${badge}<span class="muted small">Início: <strong>${fmtDay(s.start_date)}</strong> · Término: <strong>${fmtDay(st.end)}</strong></span></div>
    <div class="grid grid-3 timeline-stats">
      <div class="center"><strong class="big">${s.total_months}</strong><span class="muted small">Meses totais</span></div>
      <div class="center"><strong class="big text-gold">${st.done}</strong><span class="muted small">Meses completados</span></div>
      <div class="center"><strong class="big text-cyan">${st.remaining}</strong><span class="muted small">Meses restantes</span></div>
    </div>
    <div class="progress-label"><span class="muted">Progresso do contrato</span><strong>${st.pct}%</strong></div>
    <div class="progress"><div class="progress-fill" style="width:${st.pct}%"></div></div>
    <div class="months">
      ${Array.from({ length: s.total_months }, (_, i) => {
        const cls = i < st.done ? ' done' : (st.current === i + 1 ? ' current' : '');
        const from = addMonthsISO(s.start_date, i);
        return `<div class="month${cls}" title="Mês ${i + 1}: a partir de ${fmtDay(from)}">${i + 1}</div>`;
      }).join('')}
    </div>
    <p class="muted small" style="margin:14px 0 0">${st.nextTurn ? `O próximo mês se completa em ${fmtDay(st.nextTurn)}. ` : ''}Atualizado automaticamente todos os dias.</p>`;
}

async function renderTimeline(el) {
  el.innerHTML = `
    <div class="page-head"><div><h1>Linha do Tempo do Serviço</h1><p class="muted">${esc(isClient() ? withName('Acompanhe o andamento do seu contrato com a True Elo.') : 'Andamento dos contratos dos clientes.')}</p></div></div>
    <div id="timeline-box">${loadingCard()}</div>`;
  const box = $('#timeline-box', el);

  if (isClient()) {
    const { data, error } = await sb.from('services').select('*').eq('client_id', state.profile.id).maybeSingle();
    if (error) { toast('Não foi possível carregar a linha do tempo.', 'error'); return; }
    const { data: pending } = await sb.from('extension_requests').select('months, created_at')
      .eq('client_id', state.profile.id).eq('status', 'pendente').order('created_at', { ascending: false }).limit(1);
    const req = pending?.[0];
    box.innerHTML = `
      ${data ? `<div class="card">${timelineDetail(data)}</div>` : emptyCard('clock', 'Nenhum serviço em andamento')}
      <div class="card extend-card">
        <div class="row-main">
          <h4>${esc(greetName() ? `${greetName()}, quer continuar com a True Elo?` : 'Quer continuar com a True Elo?')}</h4>
          <p>${req
            ? `Você solicitou estender por <strong>${req.months} meses</strong> em ${fmtDate(req.created_at)}. Nossa equipe vai falar com você em breve.`
            : 'Solicite a extensão do seu serviço em poucos cliques.'}</p>
        </div>
        <button type="button" class="btn btn-gold" id="btn-extend">${icon('extend')} Solicitar extensão do serviço</button>
      </div>`;
    $('#btn-extend', el).addEventListener('click', openExtendModal);
    return;
  }

  await loadClients().catch(() => {});
  const { data, error } = await sb.from('services').select('*');
  if (error) { toast('Não foi possível carregar a linha do tempo.', 'error'); return; }
  const services = (data || []).sort((a, b) => clientName(a.client_id).localeCompare(clientName(b.client_id), 'pt-BR'));
  if (!services.length) { box.innerHTML = emptyCard('clock', 'Nenhum serviço cadastrado'); return; }
  box.innerHTML = `<div class="list">${services.map((s) => `
    <details class="card service-card">
      <summary>
        <div class="row-main"><h4>${esc(clientName(s.client_id))}</h4><p>${statusLine(s)} · ${progressOf(s)}%</p></div>
        <div class="progress sm"><div class="progress-fill" style="width:${progressOf(s)}%"></div></div>
      </summary>
      <div style="margin-top:18px">${timelineDetail(s)}</div>
    </details>`).join('')}</div>`;
}

// ---------------------------------------------------------------------
// Central de Relatórios
// ---------------------------------------------------------------------
async function renderReports(el) {
  el.innerHTML = `
    <div class="page-head"><div><h1>Central de Relatórios</h1><p class="muted">${esc(isClient() ? withName('Aqui está o histórico de relatórios do seu projeto.') : 'Relatórios enviados para os clientes.')}</p></div></div>
    <div class="toolbar">
      <label class="inline-label">Filtrar por data<input type="month" id="rep-month"></label>
      <span id="rep-client-wrap"></span>
      <button type="button" class="btn btn-ghost btn-sm hidden" id="rep-clear" style="align-self:flex-end">Limpar filtro</button>
    </div>
    <div id="rep-recent"></div>
    <div id="rep-list" class="list">${loadingCard()}</div>`;

  if (isStaff()) {
    await loadClients().catch(() => {});
    $('#rep-client-wrap', el).innerHTML = `<label class="inline-label">Cliente${clientSelect('rep-client', { all: true })}</label>`;
    $('#rep-client', el).addEventListener('change', draw);
  }
  $('#rep-month', el).addEventListener('change', draw);
  $('#rep-clear', el).addEventListener('click', () => { $('#rep-month', el).value = ''; draw(); });

  const { data, error } = await sb.from('reports').select('*').order('report_date', { ascending: false });
  if (error) { toast('Não foi possível carregar os relatórios.', 'error'); return; }
  const reports = data || [];
  draw();

  function reportRow(r, i, list) {
    return `
      <div class="card row">
        <div class="stat-icon gold">${icon('chart')}</div>
        <div class="row-main"><h4>${esc(r.title)}</h4><p>${fmtDay(r.report_date)}${isStaff() ? ' · ' + esc(clientName(r.client_id)) : ''}</p></div>
        <button type="button" class="btn btn-primary btn-sm" data-list="${list}" data-i="${i}">Visualizar</button>
      </div>`;
  }

  function draw() {
    const month = $('#rep-month', el).value;
    const client = $('#rep-client')?.value;
    $('#rep-clear', el).classList.toggle('hidden', !month);
    let list = reports.filter((r) => !client || r.client_id === client);
    const recentCut = monthsAgoISO(3);
    const recent = month ? [] : list.filter((r) => r.report_date >= recentCut).slice(0, 3);
    if (month) list = list.filter((r) => r.report_date.startsWith(month));

    $('#rep-recent', el).innerHTML = recent.length ? `
      <h3>Relatórios recentes</h3>
      <div class="grid grid-3" style="margin-bottom:26px">
        ${recent.map((r, i) => `
          <div class="card recent-card">
            <h4>${esc(r.title)}</h4>
            <p class="muted small">${fmtDay(r.report_date)}${isStaff() ? ' · ' + esc(clientName(r.client_id)) : ''}</p>
            <button type="button" class="btn-link" style="align-self:flex-start;padding:0" data-list="recent" data-i="${i}">Ver relatório →</button>
          </div>`).join('')}
      </div>
      <h3>Todos os relatórios</h3>` : '';

    const box = $('#rep-list', el);
    if (!list.length) {
      const wa = whatsappLink('Olá! Gostaria de solicitar um relatório do meu projeto.');
      const extra = isClient()
        ? (wa
          ? `<a class="btn btn-gold" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} Solicitar relatório pelo WhatsApp</a>`
          : '<p class="muted small" style="margin:0">Fale com a True Elo para solicitar um relatório.</p>')
        : '';
      box.innerHTML = emptyCard('chart', month ? 'Nenhum relatório encontrado neste mês' : 'Nenhum relatório encontrado', extra);
    } else {
      box.innerHTML = list.map((r, i) => reportRow(r, i, 'all')).join('');
    }
    $$('[data-list]', el).forEach((b) => b.addEventListener('click', () => {
      const src = b.dataset.list === 'recent' ? recent : list;
      openItem(src[+b.dataset.i]);
    }));
  }
}

// ---------------------------------------------------------------------
// Administração: Enviar documentos / Gerenciar relatórios
// ---------------------------------------------------------------------
async function renderAdminFiles(el, table) {
  const isDocs = table === 'documents';
  const T = isDocs
    ? { title: 'Enviar documentos', sub: 'Envie documentos para seus clientes.', nameLabel: 'Nome do documento', namePh: 'Ex.: Contrato de serviço', btn: 'Enviar documento', listTitle: 'Documentos enviados', empty: 'Nenhum documento enviado', ok: 'Documento enviado!', folder: '' }
    : { title: 'Gerenciar relatórios', sub: 'Adicione relatórios para seus clientes.', nameLabel: 'Título do relatório', namePh: 'Ex.: Relatório Mensal — Janeiro de 2026', btn: 'Adicionar relatório', listTitle: 'Relatórios cadastrados', empty: 'Nenhum relatório cadastrado', ok: 'Relatório adicionado!', folder: 'relatorios/' };

  await loadClients(true).catch(() => toast('Não foi possível carregar os clientes.', 'error'));

  el.innerHTML = `
    <div class="page-head"><div><h1>${T.title}</h1><p class="muted">${T.sub}</p></div></div>
    <form class="card form" id="file-form" novalidate style="margin-bottom:28px">
      <label>Selecionar cliente${clientSelect('ff-client')}</label>
      <div class="grid ${isDocs ? '' : 'grid-2'}" style="gap:16px">
        <label>${T.nameLabel}<input id="ff-name" required placeholder="${esc(T.namePh)}"></label>
        ${isDocs ? '' : `<label>Data do relatório<input type="date" id="ff-date" required value="${todayISO()}"></label>`}
      </div>
      <div>
        <div class="tabs" role="tablist" style="max-width:420px;margin-bottom:12px">
          <button type="button" class="tab active" data-src="file">Enviar arquivo</button>
          <button type="button" class="tab" data-src="link">Colar link</button>
        </div>
        <label data-panel="file">Arquivo (PDF, imagem, planilha… até ${MAX_FILE_MB} MB)<input type="file" id="ff-file"></label>
        <label data-panel="link" class="hidden">Link do ${isDocs ? 'documento' : 'relatório'} (Google Drive, Canva, etc.)<input type="url" id="ff-url" placeholder="https://..."></label>
      </div>
      <div><button type="submit" class="btn btn-primary">${icon('upload')} ${T.btn}</button></div>
    </form>
    <div class="page-head" style="margin-bottom:14px">
      <h3 style="margin:0">${T.listTitle}</h3>
      ${clientSelect('ff-filter', { all: true })}
    </div>
    <div id="ff-list" class="list">${loadingCard()}</div>`;

  if (!state.clients?.length) {
    $('#file-form', el).insertAdjacentHTML('afterbegin', '<div class="notice gold">Nenhum cliente cadastrado ainda. Cadastre clientes (função "Usuário") em Gerenciar usuários.</div>');
  }

  let source = 'file';
  $$('#file-form .tab', el).forEach((t) => t.addEventListener('click', () => {
    source = t.dataset.src;
    $$('#file-form .tab', el).forEach((x) => x.classList.toggle('active', x === t));
    $$('#file-form [data-panel]', el).forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== source));
  }));

  let items = [];
  async function load() {
    const { data, error } = await sb.from(table).select('*').order(isDocs ? 'created_at' : 'report_date', { ascending: false });
    if (error) { toast('Não foi possível carregar a lista.', 'error'); return; }
    items = data || [];
    draw();
  }

  function draw() {
    const filter = $('#ff-filter', el).value;
    const list = items.filter((x) => !filter || x.client_id === filter);
    const box = $('#ff-list', el);
    if (!list.length) { box.innerHTML = emptyCard(isDocs ? 'doc' : 'chart', T.empty); return; }
    box.innerHTML = list.map((x, i) => `
      <div class="card row">
        <div class="stat-icon ${isDocs ? 'cyan' : 'gold'} sm">${icon(isDocs ? 'doc' : 'chart')}</div>
        <div class="row-main">
          <h4>${esc(isDocs ? x.name : x.title)}</h4>
          <p>Para: ${esc(clientName(x.client_id))} · ${isDocs ? fmtDate(x.created_at) : fmtDay(x.report_date)} · ${x.kind === 'gerado' ? (x.status === 'rascunho' ? 'Rascunho gerado pelo portal' : 'Gerado pelo portal') : x.url ? 'Link' : 'Arquivo'}</p>
        </div>
        <div class="row-actions">
          <button type="button" class="icon-btn cyan" data-open="${i}" title="Abrir" aria-label="Abrir">${icon('link')}</button>
          <button type="button" class="icon-btn red" data-del="${i}" title="Excluir" aria-label="Excluir">${icon('trash')}</button>
        </div>
      </div>`).join('');
    $$('[data-open]', box).forEach((b) => b.addEventListener('click', () => openItem(list[+b.dataset.open])));
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      const x = list[+b.dataset.del];
      const ok = await confirmModal({
        title: isDocs ? 'Excluir documento?' : 'Excluir relatório?',
        text: `<strong>${esc(isDocs ? x.name : x.title)}</strong> deixará de aparecer para o cliente. Esta ação não pode ser desfeita.`,
        confirmLabel: 'Excluir',
      });
      if (!ok) return;
      const { error } = await sb.from(table).delete().eq('id', x.id);
      if (error) { toast('Não foi possível excluir.', 'error'); return; }
      if (x.storage_path) await sb.storage.from('documentos').remove([x.storage_path]);
      toast('Excluído.');
      load();
    }));
  }

  $('#ff-filter', el).addEventListener('change', draw);

  $('#file-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = $('#ff-client', el).value;
    const name = $('#ff-name', el).value.trim();
    const date = isDocs ? null : $('#ff-date', el).value;
    const file = $('#ff-file', el).files[0];
    const url = $('#ff-url', el).value.trim();

    if (!clientId) { toast('Selecione um cliente.', 'error'); return; }
    if (name.length < 2) { toast(`Informe o ${isDocs ? 'nome do documento' : 'título do relatório'}.`, 'error'); return; }
    if (!isDocs && !date) { toast('Informe a data do relatório.', 'error'); return; }
    if (source === 'file' && !file) { toast('Escolha o arquivo.', 'error'); return; }
    if (source === 'file' && file.size > MAX_FILE_MB * 1024 * 1024) { toast(`Arquivo muito grande. Máximo ${MAX_FILE_MB} MB.`, 'error'); return; }
    if (source === 'link' && !/^https?:\/\/\S+$/i.test(url)) { toast('Cole um link válido, começando com https://', 'error'); return; }

    await busy(e.submitter || $('#file-form button[type=submit]', el), async () => {
      let storagePath = null;
      if (source === 'file') {
        storagePath = `${clientId}/${T.folder}${crypto.randomUUID()}-${safeFileName(file.name)}`;
        const { error: upErr } = await sb.storage.from('documentos').upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
        if (upErr) { console.error(upErr); toast('Não foi possível enviar o arquivo.', 'error'); return; }
      }
      const row = isDocs
        ? { client_id: clientId, name, storage_path: storagePath, url: source === 'link' ? url : null, uploaded_by: state.profile.id }
        : { client_id: clientId, title: name, report_date: date, storage_path: storagePath, url: source === 'link' ? url : null, uploaded_by: state.profile.id };
      const { error } = await sb.from(table).insert(row);
      if (error) {
        console.error(error);
        if (storagePath) await sb.storage.from('documentos').remove([storagePath]);
        toast('Não foi possível salvar. Tente novamente.', 'error');
        return;
      }
      toast(T.ok);
      $('#ff-name', el).value = '';
      $('#ff-file', el).value = '';
      $('#ff-url', el).value = '';
      load();
    });
  });

  load();
}

// ---------------------------------------------------------------------
// Administração: Gerenciar serviços (linha do tempo)
// ---------------------------------------------------------------------
async function renderAdminServices(el) {
  await loadClients(true).catch(() => toast('Não foi possível carregar os clientes.', 'error'));
  el.innerHTML = `
    <div class="page-head"><div><h1>Gerenciar serviços</h1><p class="muted">Configure a linha do tempo dos contratos dos clientes.</p></div></div>
    <form class="card form" id="svc-form" novalidate style="margin-bottom:28px">
      <label>Selecionar cliente${clientSelect('svc-client')}</label>
      <div class="grid grid-2" style="gap:16px">
        <label>Data de início do contrato (dia em que o cliente fechou)<input type="date" id="svc-start" required></label>
        <label>Duração do contrato (em meses)<input type="number" id="svc-total" min="1" max="120" placeholder="12" required></label>
      </div>
      <p class="muted small" style="margin:0" id="svc-hint">Os meses completados são calculados automaticamente a partir da data de início.</p>
      <div><button type="submit" class="btn btn-primary">Salvar serviço</button></div>
    </form>
    <h3>Serviços cadastrados</h3>
    <div id="svc-list" class="list">${loadingCard()}</div>`;

  let services = [];
  async function load() {
    const { data, error } = await sb.from('services').select('*');
    if (error) { toast('Não foi possível carregar os serviços.', 'error'); return; }
    services = (data || []).sort((a, b) => clientName(a.client_id).localeCompare(clientName(b.client_id), 'pt-BR'));
    draw();
  }

  function draw() {
    const box = $('#svc-list', el);
    if (!services.length) { box.innerHTML = emptyCard('calendar', 'Nenhum serviço cadastrado'); return; }
    box.innerHTML = services.map((s, i) => `
      <div class="card">
        <div class="row" style="padding:0;margin-bottom:12px">
          <div class="row-main"><h4>${esc(clientName(s.client_id))}</h4><p>${statusLine(s)} · ${progressOf(s)}%</p></div>
          <div class="row-actions" style="border:0;padding:0;width:auto">
            <button type="button" class="icon-btn cyan" data-edit="${i}" title="Editar" aria-label="Editar">${icon('edit')}</button>
            <button type="button" class="icon-btn red" data-del="${i}" title="Excluir" aria-label="Excluir">${icon('trash')}</button>
          </div>
        </div>
        <div class="progress sm"><div class="progress-fill" style="width:${progressOf(s)}%"></div></div>
      </div>`).join('');
    $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => {
      const s = services[+b.dataset.edit];
      $('#svc-client', el).value = s.client_id;
      fill();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#svc-start', el).focus();
    }));
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      const s = services[+b.dataset.del];
      const ok = await confirmModal({ title: 'Excluir serviço?', text: `A linha do tempo de <strong>${esc(clientName(s.client_id))}</strong> será apagada.`, confirmLabel: 'Excluir' });
      if (!ok) return;
      const { error } = await sb.from('services').delete().eq('client_id', s.client_id);
      if (error) { toast('Não foi possível excluir.', 'error'); return; }
      toast('Serviço excluído.');
      load();
    }));
  }

  function fill() {
    const s = services.find((x) => x.client_id === $('#svc-client', el).value);
    $('#svc-total', el).value = s ? s.total_months : '';
    $('#svc-start', el).value = s ? s.start_date : '';
    $('#svc-hint', el).textContent = s
      ? `Este cliente já tem um contrato (${statusLine(s)}). Altere e salve.`
      : 'Os meses completados são calculados automaticamente a partir da data de início.';
  }
  $('#svc-client', el).addEventListener('change', fill);

  $('#svc-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const client_id = $('#svc-client', el).value;
    const total = parseInt($('#svc-total', el).value, 10);
    const start = $('#svc-start', el).value;
    if (!client_id) { toast('Selecione um cliente.', 'error'); return; }
    if (!(total >= 1)) { toast('Informe o total de meses.', 'error'); return; }
    if (total > 120) { toast('A duração máxima é de 120 meses.', 'error'); return; }
    if (!start) { toast('Informe a data de início do contrato.', 'error'); return; }
    await busy(e.submitter || $('#svc-form button[type=submit]', el), async () => {
      const { error } = await sb.from('services').upsert(
        { client_id, total_months: total, start_date: start, updated_at: new Date().toISOString() },
        { onConflict: 'client_id' });
      if (error) { console.error(error); toast('Não foi possível salvar o serviço.', 'error'); return; }
      toast('Serviço salvo!');
      $('#svc-form', el).reset();
      load();
    });
  });

  load();
}

// ---------------------------------------------------------------------
// Configurações da marca (logo) — somente Proprietário
// ---------------------------------------------------------------------
async function renderBranding(el) {
  el.innerHTML = `
    <div class="page-head"><div><h1>Configurações da marca</h1><p class="muted">Personalize a identidade visual do portal.</p></div></div>
    <div class="card">
      <h3>Logo do portal</h3>
      <p class="muted small">O logo aparece na tela de entrada, no menu lateral e no topo do celular.</p>
      <div class="logo-preview"><div class="brand brand-lg" data-logo style="margin:0"></div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="btn btn-primary" style="cursor:pointer">${icon('upload')} <span>${state.logoUrl ? 'Alterar logo' : 'Inserir logo'}</span>
          <input type="file" id="logo-input" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" class="hidden">
        </label>
        ${state.logoUrl ? '<button type="button" class="btn btn-ghost" id="logo-remove" style="color:var(--danger)">Remover logo</button>' : ''}
      </div>
      <p class="muted small" style="margin:14px 0 0">Formatos aceitos: PNG, SVG, JPG. Tamanho máximo: 2 MB. Sem logo inserido, o portal usa o logo padrão da True Elo.</p>
    </div>`;
  renderLogos();

  $('#logo-input', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) { toast('Formato inválido. Use PNG, SVG ou JPG.', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('Arquivo muito grande. Máximo 2 MB.', 'error'); return; }
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[file.type];
    const path = `logo-${Date.now()}.${ext}`;
    const old = await sb.from('settings').select('value').eq('key', 'logo_path').maybeSingle();
    const { error: upErr } = await sb.storage.from('marca').upload(path, file, { contentType: file.type });
    if (upErr) { console.error(upErr); toast('Não foi possível enviar o logo.', 'error'); return; }
    const { error } = await sb.from('settings').upsert({ key: 'logo_path', value: path, updated_at: new Date().toISOString() });
    if (error) { toast('Não foi possível salvar o logo.', 'error'); return; }
    if (old.data?.value) await sb.storage.from('marca').remove([old.data.value]);
    toast(state.logoUrl ? 'Logo atualizado!' : 'Logo inserido!');
    await loadLogo();
    renderBranding(el);
  });

  $('#logo-remove', el)?.addEventListener('click', async () => {
    const ok = await confirmModal({ title: 'Remover logo?', text: 'O portal voltará a usar o logo padrão da True Elo.', confirmLabel: 'Remover' });
    if (!ok) return;
    const { data } = await sb.from('settings').select('value').eq('key', 'logo_path').maybeSingle();
    const { error } = await sb.from('settings').delete().eq('key', 'logo_path');
    if (error) { toast('Não foi possível remover o logo.', 'error'); return; }
    if (data?.value) await sb.storage.from('marca').remove([data.value]);
    state.logoUrl = null;
    toast('Logo removido.');
    renderLogos();
    renderBranding(el);
  });
}

// ---------------------------------------------------------------------
// Transferir propriedade — somente Proprietário
// ---------------------------------------------------------------------
async function renderOwnership(el) {
  el.innerHTML = `
    <div class="page-head"><div><h1>Transferir propriedade</h1><p class="muted">Transfira a propriedade do portal para outro administrador.</p></div></div>
    <div id="own-box">${loadingCard()}</div>`;
  const box = $('#own-box', el);

  const [{ data: pending }, { data: admins }] = await Promise.all([
    sb.from('ownership_transfers').select('*').eq('status', 'pendente').maybeSingle(),
    sb.from('profiles').select('id, name, email').eq('role', 'administrador').order('name'),
  ]);
  const nameOf = (id) => (admins || []).find((a) => a.id === id)?.name || 'Administrador';

  if (pending) {
    const ms = new Date(pending.completes_at) - Date.now();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const left = ms <= 0 ? 'concluindo nos próximos minutos' : `${days > 0 ? `${days} dia${days > 1 ? 's' : ''} e ` : ''}${hours} hora${hours === 1 ? '' : 's'}`;
    box.innerHTML = `
      <div class="card">
        <div class="notice gold" style="margin-bottom:18px">
          <strong>Transferência em andamento</strong><br>
          Para: <strong>${esc(nameOf(pending.to_user))}</strong><br>
          Conclusão em ${fmtDateTime(pending.completes_at)} · Tempo restante: ${left}
        </div>
        <p class="muted">Até lá, você continua como Administrador Proprietário e pode cancelar a transferência.</p>
        <button type="button" class="btn btn-ghost" id="own-cancel" style="color:var(--danger)">Cancelar transferência</button>
      </div>`;
    $('#own-cancel', el).addEventListener('click', async () => {
      const ok = await confirmModal({ title: 'Cancelar transferência?', text: 'Você continuará como Administrador Proprietário.', confirmLabel: 'Cancelar transferência', kind: 'primary' });
      if (!ok) return;
      const { error } = await sb.rpc('cancel_ownership_transfer');
      if (error) { toast('Não foi possível cancelar.', 'error'); return; }
      toast('Transferência cancelada.');
      renderOwnership(el);
    });
    return;
  }

  box.innerHTML = `
    <form class="card form" id="own-form" novalidate>
      <label>Selecionar novo proprietário
        <select id="own-user" required>
          <option value="">Selecione um administrador</option>
          ${(admins || []).map((a) => `<option value="${a.id}">${esc(a.name || a.email)}</option>`).join('')}
        </select>
      </label>
      ${(admins || []).length ? '' : '<p class="muted small" style="margin:0">Nenhum administrador cadastrado. Primeiro cadastre a pessoa em Gerenciar usuários com a função "Administrador".</p>'}
      <div class="notice red"><strong>Atenção:</strong> após iniciar a transferência, haverá um período de 3 dias para conclusão. Você se tornará um Administrador comum e o novo proprietário poderá remover seu acesso.</div>
      <div><button type="submit" class="btn btn-gold">${icon('shield')} Transferir propriedade</button></div>
    </form>`;

  $('#own-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = $('#own-user', el).value;
    if (!target) { toast('Selecione um administrador.', 'error'); return; }
    const ok = await confirmModal({
      title: 'Iniciar transferência?',
      text: `Em 3 dias, <strong>${esc(nameOf(target))}</strong> se tornará o Administrador Proprietário e você passará a Administrador. Você pode cancelar até lá.`,
      confirmLabel: 'Iniciar transferência', kind: 'gold',
    });
    if (!ok) return;
    const { error } = await sb.rpc('start_ownership_transfer', { target });
    if (error) { toast(error.message || 'Não foi possível iniciar a transferência.', 'error'); return; }
    toast('Transferência iniciada! Conclusão em 3 dias.');
    renderOwnership(el);
  });
}

// ---------------------------------------------------------------------
// Solicitar extensão do serviço (cliente)
// ---------------------------------------------------------------------
const EXTEND_OPTIONS = [3, 6, 9, 12];

function openExtendModal() {
  openModal(`
    <h3>Solicitar extensão do serviço</h3>
    <form class="form" id="form-extend" novalidate>
      <p class="muted" style="margin:0">Por quantos meses você gostaria de estender?</p>
      <div class="choice-grid" role="radiogroup">
        ${EXTEND_OPTIONS.map((m) => `<label class="choice"><input type="radio" name="months" value="${m}"><span>${m} meses</span></label>`).join('')}
        <label class="choice"><input type="radio" name="months" value="outro"><span>Outro</span></label>
      </div>
      <label class="hidden" id="extend-other">Quantos meses?<input type="number" id="extend-other-input" min="1" max="120" placeholder="Ex.: 18"></label>
      <label>Mensagem (opcional)<textarea id="extend-message" rows="3" maxlength="1000" placeholder="Quer contar algo para a equipe?"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-gold">Solicitar</button>
      </div>
    </form>`);

  const form = $('#form-extend');
  form.addEventListener('change', () => {
    const other = form.querySelector('input[name=months]:checked')?.value === 'outro';
    $('#extend-other').classList.toggle('hidden', !other);
    if (other) $('#extend-other-input').focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const choice = form.querySelector('input[name=months]:checked')?.value;
    if (!choice) { toast('Escolha por quantos meses deseja estender.', 'error'); return; }
    const months = choice === 'outro' ? parseInt($('#extend-other-input').value, 10) : parseInt(choice, 10);
    if (!(months >= 1 && months <= 120)) { toast('Informe uma quantidade de meses entre 1 e 120.', 'error'); return; }
    const message = $('#extend-message').value.trim();

    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        await callFunction('solicitar-extensao', { months, message, siteUrl: SITE_URL });
        track('Lead', { content_name: 'Extensão de serviço', months });
        showExtendSuccess(months);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function showExtendSuccess(months) {
  const name = state.profile.name || '';
  const wa = whatsappLink(`Olá! Sou ${name} e gostaria de solicitar estender o serviço com a True Elo por ${months} meses.`);
  openModal(`
    <div class="center">
      <div class="status-icon status-ok" style="margin:0 auto 14px">✓</div>
      <h3 style="margin-bottom:8px">Solicitação enviada com sucesso!</h3>
      <p class="muted">${name ? `Obrigado, <strong>${esc(name)}</strong>! ` : ''}Recebemos seu pedido para estender o serviço por <strong>${months} meses</strong>. A equipe da True Elo vai entrar em contato em breve.</p>
      <p class="muted small">Se preferir, fale com a gente agora pelo WhatsApp:</p>
    </div>
    <div class="modal-actions" style="flex-direction:column">
      ${wa ? `<a class="btn btn-whatsapp" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} Chamar no WhatsApp</a>` : ''}
      <button type="button" class="btn btn-ghost" data-close>Fechar</button>
    </div>`);
  $$('[data-close]', $('#modal-card')).forEach((b) => b.addEventListener('click', () => { if (state.section === 'linha') go('linha'); }));
}

// ---------------------------------------------------------------------
// Solicitações (painel da True Elo)
// ---------------------------------------------------------------------
async function refreshRequestsBadge() {
  const badge = $('#badge-solicitacoes');
  if (!badge) return;
  const { count } = await sb.from('extension_requests').select('id', { count: 'exact', head: true }).eq('status', 'pendente');
  badge.textContent = count || '';
  badge.classList.toggle('hidden', !count);
}

const STATUS_LABEL = { pendente: 'Pendente', atendida: 'Atendida', recusada: 'Recusada' };

async function renderRequests(el) {
  await loadClients(true).catch(() => {});
  el.innerHTML = `
    <div class="page-head"><div><h1>Solicitações</h1><p class="muted">Pedidos de extensão de serviço feitos pelos clientes.</p></div></div>
    <div class="toolbar">
      <select id="req-filter" aria-label="Filtrar por situação">
        <option value="pendente">Pendentes</option>
        <option value="">Todas</option>
        <option value="atendida">Atendidas</option>
        <option value="recusada">Recusadas</option>
      </select>
    </div>
    <div id="req-list" class="list">${loadingCard()}</div>`;

  let items = []; let services = []; let phones = {};
  async function load() {
    const [r, s, p] = await Promise.all([
      sb.from('extension_requests').select('*').order('created_at', { ascending: false }),
      sb.from('services').select('*'),
      sb.from('profiles').select('id, phone, email').eq('role', 'usuario'),
    ]);
    if (r.error) { toast('Não foi possível carregar as solicitações.', 'error'); return; }
    items = r.data || []; services = s.data || [];
    phones = Object.fromEntries((p.data || []).map((x) => [x.id, x]));
    draw();
    refreshRequestsBadge();
  }

  function draw() {
    const f = $('#req-filter', el).value;
    const list = items.filter((x) => !f || x.status === f);
    const box = $('#req-list', el);
    if (!list.length) { box.innerHTML = emptyCard('bell', f === 'pendente' ? 'Nenhuma solicitação pendente' : 'Nenhuma solicitação'); return; }
    const canManage = myLevel() >= 4;
    box.innerHTML = list.map((x, i) => {
      const svc = services.find((s) => s.client_id === x.client_id);
      const contact = phones[x.client_id] || {};
      const phone = (contact.phone || '').replace(/\D/g, '');
      const wa = phone ? `https://wa.me/${phone.length <= 11 ? '55' + phone : phone}?text=${encodeURIComponent(`Olá, ${clientName(x.client_id)}! Recebemos sua solicitação para estender o serviço por ${x.months} meses.`)}` : null;
      return `
        <div class="card">
          <div class="row" style="padding:0;align-items:flex-start">
            <div class="stat-icon gold sm">${icon('extend')}</div>
            <div class="row-main">
              <h4>${esc(clientName(x.client_id))} quer estender por ${x.months} meses</h4>
              <p>Pedido em ${fmtDateTime(x.created_at)} · ${svc ? esc(statusLine(svc)) : 'Sem linha do tempo cadastrada'}</p>
              ${x.message ? `<p class="req-message">“${esc(x.message)}”</p>` : ''}
              <span class="badge ${x.status === 'pendente' ? 'owner' : x.status === 'atendida' ? 'admin' : ''}">${STATUS_LABEL[x.status]}</span>
              ${x.status === 'pendente' && !x.email_sent ? '<span class="muted small"> · e-mail de aviso ainda não configurado</span>' : ''}
            </div>
          </div>
          ${canManage || wa ? `<div class="req-actions">
            ${wa ? `<a class="btn btn-ghost btn-sm" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} WhatsApp</a>` : ''}
            ${canManage && x.status === 'pendente' && svc ? `<button type="button" class="btn btn-gold btn-sm" data-extend="${i}">Estender contrato +${x.months} meses</button>` : ''}
            ${canManage && x.status === 'pendente' ? `<button type="button" class="btn btn-ghost btn-sm" data-status="atendida" data-i="${i}">Marcar como atendida</button>
              <button type="button" class="btn btn-ghost btn-sm" data-status="recusada" data-i="${i}" style="color:var(--danger)">Recusar</button>` : ''}
          </div>` : ''}
        </div>`;
    }).join('');

    $$('[data-extend]', box).forEach((b) => b.addEventListener('click', async () => {
      const x = list[+b.dataset.extend];
      const svc = services.find((s) => s.client_id === x.client_id);
      const newTotal = svc.total_months + x.months;
      const ok = await confirmModal({
        title: 'Estender contrato?',
        text: `O contrato de <strong>${esc(clientName(x.client_id))}</strong> passará de ${svc.total_months} para <strong>${newTotal} meses</strong>, com término em ${fmtDay(addMonthsISO(svc.start_date, newTotal))}.`,
        confirmLabel: 'Estender', kind: 'gold',
      });
      if (!ok) return;
      if (newTotal > 120) { toast('O contrato não pode passar de 120 meses.', 'error'); return; }
      const { error } = await sb.from('services').update({ total_months: newTotal, updated_at: new Date().toISOString() }).eq('client_id', x.client_id);
      if (error) { toast('Não foi possível estender o contrato.', 'error'); return; }
      await sb.from('extension_requests').update({ status: 'atendida', handled_by: state.profile.id, handled_at: new Date().toISOString() }).eq('id', x.id);
      toast('Contrato estendido!');
      load();
    }));
    $$('[data-status]', box).forEach((b) => b.addEventListener('click', async () => {
      const x = list[+b.dataset.i];
      const { error } = await sb.from('extension_requests').update({ status: b.dataset.status, handled_by: state.profile.id, handled_at: new Date().toISOString() }).eq('id', x.id);
      if (error) { toast('Não foi possível atualizar.', 'error'); return; }
      toast(b.dataset.status === 'atendida' ? 'Marcada como atendida.' : 'Solicitação recusada.');
      load();
    }));
  }

  $('#req-filter', el).addEventListener('change', draw);
  load();
}

// ---------------------------------------------------------------------
// Seções das próximas etapas
// ---------------------------------------------------------------------
function renderComingSoon(el, item) {
  el.innerHTML = `
    <div class="page-head"><div><h1>${esc(item.label)}</h1></div></div>
    <div class="card empty">${icon('tools')}
      <p><strong>Em construção</strong></p>
      <p class="muted" style="margin:0">Esta área faz parte da próxima etapa do portal.</p>
    </div>`;
}

// ---------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------
function openModal(html) {
  $('#modal-card').innerHTML = html;
  $('#modal').classList.remove('hidden');
  $$('[data-close]', $('#modal-card')).forEach((b) => b.addEventListener('click', closeModal));
  setTimeout(() => $('#modal-card input, #modal-card select, #modal-card button')?.focus(), 50);
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-card').innerHTML = '';
  $('#modal-card').classList.remove('modal-wide');
}

document.addEventListener('click', (e) => {
  if (e.target.closest('a[href*="wa.me"]')) track('Contact', { content_name: 'WhatsApp' });
});

setupMarketing({
  sb, state, SITE_URL, SUPABASE_URL, $, $$, esc, toast, icon, busy, openModal, closeModal, confirmModal,
  loadClients, clientName, clientSelect, isStaff, isClient, myLevel, emptyCard, withName,
  fmtDate, fmtDateTime, fmtDay, callFunction, go, track,
});

boot().catch((err) => {
  console.error(err);
  show('screen-login');
  toast('Não foi possível conectar ao servidor. Verifique sua internet.', 'error');
});
