// =====================================================================
// MEDIÇÃO DO PORTAL: Pixel da Meta + API de Conversões, Google Analytics 4
// e Google Ads. Tudo só funciona DEPOIS que a pessoa aceita os cookies
// (LGPD). Sem aceite, nada é carregado e nenhum evento sai.
// Os IDs vêm da tela Integrações (tabela settings, chaves int_*).
// =====================================================================

const CONSENT_KEY = 'trueelo-cookies';
let cfg = {};
let sbClient = null;
let loaded = false;

const store = {
  get() { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch { /* navegador sem armazenamento */ } },
};

export const consentStatus = () => store.get();          // 'granted' | 'denied' | null
const hasAnyTag = () => !!(cfg.int_meta_pixel_id || cfg.int_ga4_measurement_id || cfg.int_gads_conversion_id);

export function initTracking(settings, sb) {
  cfg = settings || {};
  sbClient = sb;
  if (!hasAnyTag()) return;                                // nada configurado: nem mostra o aviso
  const c = consentStatus();
  if (c === 'granted') loadTags();
  else if (!c) showBanner();
}

export function openCookiePreferences() {
  showBanner(true);
}

function showBanner(force = false) {
  if (document.getElementById('cookie-banner')) return;
  if (!force && consentStatus()) return;
  const el = document.createElement('div');
  el.id = 'cookie-banner';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Aviso de cookies');
  el.innerHTML = `
    <div class="cookie-text">
      <strong>Sua privacidade</strong>
      <span>Usamos cookies para medir o uso do portal e melhorar nossos serviços e anúncios (Meta e Google). Você pode aceitar ou recusar. Os cookies essenciais para o login funcionam sempre.</span>
    </div>
    <div class="cookie-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-cookie="denied">Recusar</button>
      <button type="button" class="btn btn-primary btn-sm" data-cookie="granted">Aceitar</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll('[data-cookie]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.cookie;
    const before = consentStatus();
    store.set(v);
    el.remove();
    if (v === 'granted') { loadTags(); track('PageView'); }
    else if (before === 'granted') window.location.reload(); // para descarregar as tags já ativas
  }));
}

function addScript(src) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function loadTags() {
  if (loaded) return;
  loaded = true;

  // Meta Pixel
  const pixel = String(cfg.int_meta_pixel_id || '').replace(/\D/g, '');
  if (pixel) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    }(window, document);
    /* eslint-enable */
    addScript('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', pixel);
  }

  // Google (GA4 e/ou Google Ads usam o mesmo gtag)
  const ga = String(cfg.int_ga4_measurement_id || '').trim();
  const ads = String(cfg.int_gads_conversion_id || '').trim();
  if (ga || ads) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    window.gtag('js', new Date());
    if (ga) window.gtag('config', ga, { send_page_view: false });
    if (ads) window.gtag('config', ads);
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga || ads)}`);
  }
}

const cookie = (name) => (document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')) || [])[1];
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// Mapeia os nomes dos eventos para cada plataforma
const GA_NAMES = { PageView: 'page_view', ViewContent: 'view_item', Lead: 'generate_lead', Login: 'login', Contact: 'contact' };

/**
 * Registra um evento em todas as ferramentas configuradas (se houver aceite).
 * @param {string} name  PageView | ViewContent | Lead | Login | Contact
 * @param {object} data  ex.: { content_name: 'Relatório', months: 6 }
 */
export function track(name, data = {}) {
  if (consentStatus() !== 'granted' || !hasAnyTag()) return;
  const eventId = newId();
  const custom = { ...data };

  // Pixel (navegador)
  if (window.fbq) {
    const standard = ['PageView', 'ViewContent', 'Lead', 'Contact', 'CompleteRegistration'].includes(name);
    window.fbq(standard ? 'track' : 'trackCustom', name, custom, { eventID: eventId });
  }

  // GA4
  if (window.gtag && cfg.int_ga4_measurement_id) {
    const params = name === 'PageView'
      ? { page_title: document.title, page_location: location.href, page_path: location.pathname + location.hash }
      : custom;
    window.gtag('event', GA_NAMES[name] || name, params);
  }

  // Google Ads: conversão quando o cliente pede extensão (Lead)
  if (window.gtag && name === 'Lead' && cfg.int_gads_conversion_id && cfg.int_gads_lead_label) {
    window.gtag('event', 'conversion', { send_to: `${cfg.int_gads_conversion_id}/${cfg.int_gads_lead_label}`, transaction_id: eventId });
  }

  // API de Conversões (servidor), mesmo event_id do Pixel para não contar duas vezes
  if (cfg.int_meta_pixel_id && sbClient) {
    sbClient.functions.invoke('rastreamento', {
      body: {
        event_name: name, event_id: eventId, event_source_url: location.href,
        fbp: cookie('_fbp'), fbc: cookie('_fbc'), custom_data: custom,
      },
    }).catch(() => { /* medição nunca atrapalha o portal */ });
  }
}
