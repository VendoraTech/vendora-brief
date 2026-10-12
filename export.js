'use strict';

// Pagina di export, in due modi:
// - export.html#z=… (pulsante «Esporta» del form): il brief viaggia nel frammento dell'URL, nessuna chiamata di rete;
// - export.html?page=<id task> (link «Scarica brief PDF» nelle task): carica dall'API tutti i brief compilati della task.
// In entrambi i casi impagina per la stampa in PDF e offre il testo.
const API_URL = 'https://pvuixvdiladlxzgkwszq.supabase.co/functions/v1/vendora-brief';
const KEY_STORAGE = 'vendoraBriefKey';
const STORAGE = 'vendoraBriefExport';
const PERF_FIELDS = [
  ['brand', 'Brand name'],
  ['marketplace', 'Marketplace'],
  ['variants', 'Formato / Taglia / Colore / Quantità'],
  ['specs', 'Ingredienti / Specifiche tecniche / Materiale'],
  ['problem', 'Quale problema risolve?'],
  ['strengths', 'Punti di forza / Elementi differenzianti'],
  ['certificates', 'Certificati / Allergeni'],
  ['competitors', 'ASIN dei top 3 competitor', 'a cura dello strategico'],
  ['strategy', 'Consigli strategici su keyword / elementi grafici / aggettivi', 'a cura dello strategico'],
];
const MARKET_NAMES = { IT: 'Italia', FR: 'Francia', ES: 'Spagna', DE: 'Germania', UK: 'UK', US: 'US' };
const CAT_FIELDS = {
  'Variazione del nodo': [
    ['asin', 'ASIN su cui operare'],
    ['marketplace', 'Marketplace di riferimento'],
    ['currentNode', 'Attuale nodo di navigazione'],
    ['newNode', 'Nuovo nodo di navigazione'],
  ],
  'Creazione di un parent': [
    ['parentBrand', 'Marchio del parent'],
    ['parentName', 'Nome parent'],
    ['parentAsins', 'ASINs da agganciare'],
  ],
  'Caricamenti GRAFICI': [
    ['asin', 'ASIN su cui operare'],
    ['uploadTypes', 'Tipo di caricamento'],
    ['destMarketplaces', 'Marketplace di destinazione'],
    ['driveLink', 'Link Drive della cartella con il materiale'],
  ],
};
const CALI_FIELDS = [
  ['destMarketplaces', 'Marketplace di destinazione'],
  ['scope', 'Calo di'],
  ['asin', 'ASIN in calo'],
  ['complaint', 'Di cosa si lamenta il cliente?'],
];
const OPP_FIELDS = [
  ['product', 'Che prodotto vorrebbe lanciare il cliente?'],
  ['destMarketplaces', 'Marketplace di destinazione'],
  ['price', 'Prezzo di vendita con cui vorrebbe uscire'],
  ['format', 'Formato / Quantità / Materiale'],
];
const KINDS = { performance: 'PERFORMANCE', catalogo: 'CATALOGO', cali: 'CALI STRATEGICI', opportunita: 'ANALISI OPPORTUNITÀ' };
function fieldsFor(data) {
  if (data.type === 'catalogo') return [['operation', 'Operazione'], ...(CAT_FIELDS[data.operation] || [])];
  if (data.type === 'cali') return CALI_FIELDS.filter(([key]) => key !== 'asin' || data.scope === 'Uno o più ASIN');
  if (data.type === 'opportunita') return OPP_FIELDS;
  return PERF_FIELDS;
}
const kind = (data) => KINDS[data.type] || 'PERFORMANCE';

const $ = (id) => document.getElementById(id);
const setStatus = (text, kind = '') => {
  $('status').textContent = text;
  $('status').className = `status${kind ? ` ${kind}` : ''}`;
};
const el = (tag, props = {}, text = '') => Object.assign(document.createElement(tag), props, text ? { textContent: text } : {});
const keyStore = {
  get() { try { return sessionStorage.getItem(KEY_STORAGE) || localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } },
  set(value, remember) {
    try {
      if (value) sessionStorage.setItem(KEY_STORAGE, value);
      else sessionStorage.removeItem(KEY_STORAGE);
      if (!value || !remember) localStorage.removeItem(KEY_STORAGE);
      else localStorage.setItem(KEY_STORAGE, value);
    } catch { /* storage non disponibile */ }
  },
};

function fromBase64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function decode(fragment) {
  const [kind, payload] = [fragment.slice(0, 2), fragment.slice(2)];
  const bytes = fromBase64url(payload);
  if (kind === 'j=') return JSON.parse(new TextDecoder().decode(bytes));
  if (kind === 'z=') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  }
  throw new Error('formato sconosciuto');
}

// Un documento ha l'intestazione della task e una o più sezioni (una per tipo di brief).
const single = (data) => ({ code: data.code, client: data.client, title: data.title, pageId: data.pageId, sections: [data] });

async function loadFragment() {
  const fragment = location.hash.slice(1);
  if (fragment) {
    const data = await decode(fragment);
    // Tolgo i dati dall'URL, così non finiscono in un link copiato; restano solo in questa scheda.
    try { sessionStorage.setItem(STORAGE, JSON.stringify(data)); } catch { /* storage non disponibile */ }
    history.replaceState(null, '', location.pathname);
    return { doc: single(data), fresh: true };
  }
  try {
    const saved = sessionStorage.getItem(STORAGE);
    if (saved) return { doc: single(JSON.parse(saved)), fresh: false };
  } catch { /* storage non disponibile */ }
  return { doc: null, fresh: false };
}

function pageFromUrl() {
  const raw = new URLSearchParams(location.search).get('page') || '';
  const m = raw.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i);
  return m ? m[0].replace(/-/g, '') : '';
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchBrief(pageId, key) {
  let res;
  try {
    res = await fetch(`${API_URL}?action=brief&pageId=${pageId}`, { headers: { 'X-App-Key': key } });
  } catch {
    throw new ApiError(0, 'Connessione non riuscita: controlla la rete e riprova.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Errore ${res.status}`);
  return data.brief;
}

// Dalla risposta dell'API: solo i tipi di brief con almeno un campo compilato.
function docFromBrief(brief) {
  const parts = [['performance', brief], ['catalogo', brief.catalog], ['cali', brief.cali], ['opportunita', brief.opportunita]];
  const sections = parts
    .map(([type, values]) => ({ ...(values || {}), type, completeness: values?.completeness || '' }))
    .filter((d) => fieldsFor(d).some(([key]) => valueOf(d, key)));
  return { code: brief.code, client: brief.client, title: brief.title, pageId: brief.pageId, sections };
}

const marketText = (codes = []) => [].concat(codes).filter(Boolean).map((c) => `${MARKET_NAMES[c] || c} (${c})`).join(', ');
function valueOf(data, key) {
  if (key === 'marketplace' || key === 'destMarketplaces') return marketText(data[key]);
  if (Array.isArray(data[key])) return data[key].join(', ');
  const value = String(data[key] || '').trim();
  // Per chi esegue la variazione serve anche l'ID del nodo, che nel form resta nascosto.
  if ((key === 'currentNode' || key === 'newNode') && value && data[`${key}Id`]) return `${value}\nID nodo: ${data[`${key}Id`]}`;
  return value;
}
const exportedAt = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const notionUrl = (doc) => (doc.pageId ? `https://www.notion.so/${String(doc.pageId).replace(/-/g, '')}` : '');
const kinds = (doc) => doc.sections.map(kind).join(' · ');

function renderFields(data, container) {
  for (const [key, label, note] of fieldsFor(data)) {
    const value = valueOf(data, key);
    const title = el('h2', {}, label);
    if (note) title.append(' ', el('span', { className: 'note' }, `(${note})`));
    const section = el('section', { className: 'field' });
    const isLink = key === 'driveLink' && /^https?:\/\//i.test(value);
    const body = el('p', { className: value ? '' : 'empty' }, isLink ? '' : value || '—');
    if (isLink) body.append(el('a', { href: value, target: '_blank', rel: 'noopener' }, value));
    section.append(title, body);
    container.append(section);
  }
}

function render(doc) {
  const many = doc.sections.length > 1;
  $('kicker').textContent = `Brief ${kinds(doc)}`;
  $('title').textContent = doc.title || 'Task senza titolo';
  const meta = $('meta');
  if (doc.code) meta.append(el('strong', {}, doc.code));
  if (doc.client) meta.append(el('span', {}, doc.client));
  if (!many && doc.sections[0].completeness) meta.append(el('span', {}, doc.sections[0].completeness));
  meta.append(el('span', {}, `Esportato il ${exportedAt}`));
  if (notionUrl(doc)) meta.append(el('a', { href: notionUrl(doc), target: '_blank', rel: 'noopener' }, 'Apri la task in Notion'));
  for (const data of doc.sections) {
    if (many) {
      const heading = el('h2', { className: 'sectiontitle' }, `BRIEF ${kind(data)}`);
      if (data.completeness) heading.append(el('small', {}, data.completeness));
      $('fields').append(heading);
    }
    renderFields(data, $('fields'));
  }
  document.title = ['Brief', kinds(doc).replace(/ · /g, ' '), doc.code, doc.client].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '-');
  $('sheet').hidden = false;
}

function asText(doc) {
  const lines = [`BRIEF ${kinds(doc)}`, [doc.code, doc.client].filter(Boolean).join(' · '), doc.title || ''];
  if (notionUrl(doc)) lines.push(`Task Notion: ${notionUrl(doc)}`);
  lines.push(`Esportato il ${exportedAt}`);
  for (const data of doc.sections) {
    if (doc.sections.length > 1) lines.push('', `=== BRIEF ${kind(data)} ===`);
    if (data.completeness) lines.push(`Completezza: ${data.completeness}`);
    for (const [key, label] of fieldsFor(data)) lines.push('', label.toUpperCase(), valueOf(data, key) || '—');
  }
  return `${lines.filter((l, i) => l || i > 2).join('\n')}\n`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { value: text });
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function show(doc, autoPrint) {
  render(doc);
  for (const id of ['print', 'copy', 'txt']) $(id).hidden = false;
  setStatus('Brief pronto. Per il PDF scegli «Salva come PDF» come destinazione di stampa.');
  $('print').onclick = () => window.print();
  $('copy').onclick = async () => {
    const ok = await copy(asText(doc));
    setStatus(ok ? '✓ Testo copiato: incollalo dove ti serve.' : 'Copia non riuscita: seleziona il testo e copialo a mano.', ok ? 'ok' : 'err');
  };
  $('txt').onclick = () => {
    const url = URL.createObjectURL(new Blob([asText(doc)], { type: 'text/plain;charset=utf-8' }));
    const a = el('a', { href: url, download: `${document.title}.txt` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('✓ File di testo scaricato.', 'ok');
  };
  if (autoPrint) setTimeout(() => window.print(), 400); // apre subito la finestra di stampa/PDF
}

function hideActions() {
  for (const id of ['print', 'copy', 'txt']) $(id).hidden = true;
}

// Link dalla task: chiave (salvata o chiesta una volta) → brief dall'API → PDF.
async function openTask(pageId) {
  hideActions();
  const key = keyStore.get();
  if (!key) return askKey(pageId, '');
  setStatus('Caricamento del brief da Notion…');
  try {
    const doc = docFromBrief(await fetchBrief(pageId, key));
    if (!doc.sections.length) {
      setStatus('Questa task non ha ancora un brief compilato: compilalo dal form nella task.', 'err');
      return;
    }
    $('keyBox').hidden = true;
    show(doc, true);
  } catch (e) {
    if (e.status === 401) {
      keyStore.set('');
      askKey(pageId, 'Chiave non valida: inseriscila di nuovo.');
    } else {
      setStatus(e.message, 'err');
    }
  }
}

function askKey(pageId, message) {
  $('keyBox').hidden = false;
  setStatus(message || 'Inserisci la chiave del team per aprire il brief.', message ? 'err' : '');
  $('key').focus();
  $('keyBox').onsubmit = (e) => {
    e.preventDefault();
    const value = $('key').value.trim();
    if (!value) return setStatus('Inserisci la chiave del team.', 'err');
    keyStore.set(value, $('remember').checked);
    $('key').value = '';
    openTask(pageId);
  };
}

(async () => {
  const pageId = pageFromUrl();
  if (pageId) return openTask(pageId);
  let loaded;
  try {
    loaded = await loadFragment();
  } catch {
    loaded = { doc: null };
  }
  if (!loaded.doc) {
    hideActions();
    setStatus('Nessun brief da esportare: apri questa pagina dal pulsante «Esporta» del form o dal link «Scarica brief PDF» della task.', 'err');
    return;
  }
  show(loaded.doc, loaded.fresh);
})();
