// =====================================================================
// PORTAL DO CLIENTE TRUE ELO — aplicação (etapa 1)
// Login, convite ("Crie sua senha"), recuperação e troca de senha por
// e-mail, menu por papel e gerenciamento de usuários.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
  tools: '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------------------------------------------------------------------
// Marca (logo)
// ---------------------------------------------------------------------
async function loadLogo() {
  try {
    const { data } = await sb.from('settings').select('value').eq('key', 'logo_path').maybeSingle();
    if (data?.value) state.logoUrl = sb.storage.from('marca').getPublicUrl(data.value).data.publicUrl;
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
    .select('id, name, email, phone, role, created_at, last_login')
    .eq('id', state.session.user.id)
    .single();

  if (error || !profile) { show('screen-denied'); return; }

  state.profile = profile;
  sb.rpc('touch_last_login').then(() => {}, () => {});
  sb.rpc('complete_due_transfers').then(() => {}, () => {});

  renderShell();
  go('inicio');
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
  { id: 'documentos',     label: 'Central de Documentos',  icon: 'doc',      min: 1 },
  { id: 'linha',          label: 'Linha do Tempo',         icon: 'clock',    min: 1 },
  { id: 'relatorios',     label: 'Central de Relatórios',  icon: 'chart',    min: 1 },
  { id: 'conta',          label: 'Minha conta',            icon: 'user',     min: 1 },
  { group: 'Administração',                                                  min: 3 },
  { id: 'usuarios',       label: 'Gerenciar usuários',     icon: 'users',    min: 4 },
  { id: 'adm-documentos', label: 'Enviar documentos',      icon: 'upload',   min: 3 },
  { id: 'adm-relatorios', label: 'Gerenciar relatórios',   icon: 'chart',    min: 3 },
  { id: 'adm-servicos',   label: 'Gerenciar serviços',     icon: 'calendar', min: 4 },
  { id: 'marca',          label: 'Configurações da marca', icon: 'brush',    min: 6 },
  { id: 'propriedade',    label: 'Transferir propriedade', icon: 'shield',   min: 6, gold: true },
];

const myLevel = () => levelOf(state.profile?.role);

function renderShell() {
  const p = state.profile;
  $('#user-avatar').textContent = initials(p.name || p.email);
  $('#user-name').textContent = p.name || p.email;
  $('#user-role').textContent = roleLabel(p.role);

  $('#menu').innerHTML = MENU.filter((m) => myLevel() >= m.min).map((m) => m.group
    ? `<div class="menu-group">${esc(m.group)}</div>`
    : `<button type="button" class="menu-item${m.gold ? ' gold' : ''}" data-section="${m.id}">${icon(m.icon)}<span>${esc(m.label)}</span></button>`
  ).join('');

  $$('#menu [data-section]').forEach((b) => b.addEventListener('click', () => {
    go(b.dataset.section);
    $('.app').classList.remove('menu-open');
  }));
}

function go(sectionId) {
  const item = MENU.find((m) => m.id === sectionId);
  if (!item || myLevel() < item.min) { show('screen-denied'); return; }
  state.section = sectionId;
  $$('#menu [data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === sectionId));

  const content = $('#content');
  content.style.animation = 'none'; void content.offsetHeight; content.style.animation = '';
  (SECTIONS[sectionId] || renderComingSoon)(content, item);
}

const SECTIONS = {
  inicio: renderHome,
  conta: renderAccount,
  usuarios: renderUsers,
};

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------
function renderHome(el) {
  const p = state.profile;
  const name = firstName(p.name);
  const cards = [
    { id: 'documentos', icon: 'doc',   color: 'cyan',  title: 'Central de Documentos', text: 'Documentos enviados pela True Elo.' },
    { id: 'relatorios', icon: 'chart', color: 'gold',  title: 'Central de Relatórios', text: 'Histórico de relatórios do seu projeto.' },
    { id: 'linha',      icon: 'clock', color: 'green', title: 'Linha do Tempo',        text: 'Andamento do seu contrato.' },
  ];
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${name ? `Olá, ${esc(name)}!` : 'Bem-vindo!'}</h1>
        <p class="muted">Bem-vindo ao seu portal exclusivo. Acompanhe seus projetos e documentos em um só lugar.</p>
      </div>
    </div>
    <div class="grid grid-3">
      ${cards.map((c) => `
        <button type="button" class="card quick stat" data-open="${c.id}">
          <div class="stat-icon ${c.color}">${icon(c.icon)}</div>
          <div><strong>${esc(c.title)}</strong><span class="muted small">${esc(c.text)}</span></div>
        </button>`).join('')}
    </div>`;
  $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.open)));
}

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
    </div>`;

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
  const { data, error } = await sb.functions.invoke('admin-users', { body: { action, ...payload } });
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
}

boot().catch((err) => {
  console.error(err);
  show('screen-login');
  toast('Não foi possível conectar ao servidor. Verifique sua internet.', 'error');
});
