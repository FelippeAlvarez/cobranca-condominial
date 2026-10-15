'use strict';
/*
  Armazenamento dos dados:
  - pasta: Chrome/Edge gravando direto numa pasta do computador (ex.: pasta do Dropbox compartilhada pela equipe);
  - local: somente neste navegador (para testes).
  Cada condomínio e cada cobrança ficam num arquivo próprio, para que duas pessoas
  trabalhando ao mesmo tempo em cobranças diferentes não gerem conflito no Dropbox.
*/

const IDB = {
  _db: null,
  abrir() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((ok, falha) => {
      const r = indexedDB.open('cobranca-condominial', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('arquivos'); };
      r.onsuccess = () => { this._db = r.result; ok(r.result); };
      r.onerror = () => falha(r.error);
    });
  },
  async _req(loja, modo, f) {
    const db = await this.abrir();
    return new Promise((ok, falha) => {
      const t = db.transaction(loja, modo);
      const r = f(t.objectStore(loja));
      t.oncomplete = () => ok(r?.result);
      t.onerror = () => falha(t.error);
    });
  },
  get(loja, k) { return this._req(loja, 'readonly', s => s.get(k)); },
  set(loja, k, v) { return this._req(loja, 'readwrite', s => s.put(v, k)); },
  del(loja, k) { return this._req(loja, 'readwrite', s => s.delete(k)); },
  chaves(loja) { return this._req(loja, 'readonly', s => s.getAllKeys()); },
};

// Cópias com conflito criadas pelo Dropbox / OneDrive / Google Drive
const ehCopiaConflito = nome => /conflict|conflito|conflicted|-\s*cópia|\(\d+\)\.json$/i.test(nome);

const Armaz = {
  modo: null,
  dir: null,
  conflitos: [],

  async conectarPasta() {
    if (!('showDirectoryPicker' in window)) throw new Error('Este navegador não permite gravar em pastas. Use o Google Chrome ou o Microsoft Edge no computador.');
    const h = await window.showDirectoryPicker({ id: 'cobranca-condominial', mode: 'readwrite' });
    await IDB.set('kv', 'pasta', h);
    this.dir = h;
    this.modo = 'pasta';
    localStorage.setItem('cc-modo', 'pasta');
  },

  // Retoma a pasta escolhida antes; o navegador pode pedir a permissão de novo (precisa de um clique)
  async retomarPasta(pedirPermissao) {
    if (!('showDirectoryPicker' in window)) return false;
    const h = await IDB.get('kv', 'pasta').catch(() => null);
    if (!h) return false;
    let p = await h.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted' && pedirPermissao) p = await h.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') return false;
    this.dir = h;
    this.modo = 'pasta';
    return true;
  },
  async nomePastaSalva() { return (await IDB.get('kv', 'pasta').catch(() => null))?.name || ''; },

  usarLocal() { this.modo = 'local'; localStorage.setItem('cc-modo', 'local'); },
  usarDropbox() { this.modo = 'dropbox'; localStorage.setItem('cc-modo', 'dropbox'); },
  desconectar() { localStorage.removeItem('cc-modo'); this.modo = null; },

  descricao() {
    if (this.modo === 'pasta') return 'Pasta: ' + (this.dir?.name || '');
    if (this.modo === 'local') return 'Somente neste navegador (teste)';
    if (this.modo === 'dropbox') return 'Dropbox: ' + DBX.base.split('/').pop();
    return '';
  },

  async _pasta(partes, criar) {
    let d = this.dir;
    for (const p of partes) d = await d.getDirectoryHandle(p, { create: criar });
    return d;
  },

  async ler(caminho) {
    if (this.modo === 'dropbox') return DBX.ler(caminho);
    if (this.modo === 'pasta') {
      const partes = caminho.split('/');
      try {
        const d = await this._pasta(partes.slice(0, -1), false);
        const fh = await d.getFileHandle(partes[partes.length - 1]);
        return await (await fh.getFile()).text();
      } catch (e) {
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
      }
    }
    if (this.modo === 'local') { const v = await IDB.get('arquivos', caminho); return v === undefined ? null : v; }
    throw new Error('A pasta dos dados não foi escolhida.');
  },

  async gravar(caminho, texto) {
    if (this.modo === 'dropbox') return DBX.gravar(caminho, texto);
    if (this.modo === 'pasta') {
      const partes = caminho.split('/');
      const d = await this._pasta(partes.slice(0, -1), true);
      const fh = await d.getFileHandle(partes[partes.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(texto);
      await w.close();
      return;
    }
    if (this.modo === 'local') return IDB.set('arquivos', caminho, texto);
    throw new Error('A pasta dos dados não foi escolhida.');
  },

  async remover(caminho) {
    if (this.modo === 'dropbox') return DBX.remover(caminho);
    if (this.modo === 'pasta') {
      const partes = caminho.split('/');
      const d = await this._pasta(partes.slice(0, -1), false);
      await d.removeEntry(partes[partes.length - 1]);
      return;
    }
    if (this.modo === 'local') return IDB.del('arquivos', caminho);
  },

  // Nomes dos arquivos .json de uma subpasta (as cópias com conflito do Dropbox ficam em "conflitos")
  async listar(sub) {
    const nomes = this.modo === 'dropbox' ? await DBX.listar(sub) : [];
    if (this.modo === 'pasta') {
      let d;
      try { d = await this._pasta([sub], false); } catch (e) { if (e.name === 'NotFoundError') return []; throw e; }
      for await (const [nome, h] of d.entries()) if (h.kind === 'file' && nome.endsWith('.json')) nomes.push(nome);
    } else if (this.modo === 'local') {
      for (const k of await IDB.chaves('arquivos')) if (k.startsWith(sub + '/') && !k.slice(sub.length + 1).includes('/')) nomes.push(k.slice(sub.length + 1));
    }
    const bons = [];
    for (const n of nomes) {
      if (ehCopiaConflito(n)) this.conflitos.push(sub + '/' + n); else bons.push(n);
    }
    return bons;
  },

  // Move para a lixeira (nada é apagado definitivamente pelo aplicativo)
  async paraLixeira(caminho) {
    if (this.modo === 'dropbox') return DBX.paraLixeira(caminho);
    const t = await this.ler(caminho);
    if (t === null) return;
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    await this.gravar(`lixeira/${carimbo}_${caminho.replace(/\//g, '_')}`, t);
    await this.remover(caminho);
  },
};

/* ================= Dropbox (pela internet) =================
  Cada pessoa conecta a própria conta do Dropbox da equipe (OAuth 2 com PKCE, sem senha secreta no app).
  TRAVA: o app só lê e grava dentro da pasta da base (PASTAS_BASE); qualquer outro caminho é recusado.
*/
const DBX_CHAVE = '69hp7hy5bfyyfs3';
// Pasta da base no Dropbox da ASA (a primeira que existir na conta da pessoa)
const PASTAS_BASE = ['/ASA Advocacia/ASA - PROCESSOS/COBRANÇA CONDOMINIAL', '/ASA - PROCESSOS/COBRANÇA CONDOMINIAL'];

function b64url(bytes) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const textoAleatorio = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
// O cabeçalho Dropbox-API-Arg só aceita ASCII: acentos vão como \uXXXX
const jsonAscii = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const urlRetornoDbx = () => location.origin + location.pathname.replace(/\/$/, '/index.html');
const ERRO_REDE_DBX = 'Não foi possível acessar o Dropbox. Verifique a conexão com a internet.';

const DBX = {
  _token: null, _expira: 0,
  base: localStorage.getItem('cc-dbx-base') || '',
  raiz: localStorage.getItem('cc-dbx-raiz') || '',
  conta: localStorage.getItem('cc-dbx-conta') || '',
  _cache: new Map(), // caminho → { rev, texto }
  _revs: new Map(),  // caminho → rev visto na última listagem

  temAcesso() { return !!localStorage.getItem('cc-dbx-refresh') && !!this.base; },

  async entrar() {
    if (!window.crypto?.subtle) throw new Error('Abra o programa pelo endereço seguro (https).');
    const verif = textoAleatorio(48), estado = textoAleatorio(12);
    const desafio = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verif))));
    // Guardado também no localStorage: no app instalado, a volta do Dropbox pode abrir em outra janela
    for (const s of [sessionStorage, localStorage]) { s.setItem('cc-dbx-verif', verif); s.setItem('cc-dbx-estado', estado); }
    location.href = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
      client_id: DBX_CHAVE, response_type: 'code', code_challenge: desafio, code_challenge_method: 'S256',
      token_access_type: 'offline', redirect_uri: urlRetornoDbx(), state: 'cc-' + estado,
    });
  },

  async _tokenReq(corpo) {
    let r;
    try { r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: DBX_CHAVE, ...corpo }) }); }
    catch { throw new Error(ERRO_REDE_DBX); }
    return { r, j: await r.json().catch(() => ({})) };
  },

  // Volta do Dropbox com ?code=...&state=cc-...
  async concluirEntrada(codigo, estado) {
    const esperado = sessionStorage.getItem('cc-dbx-estado') || localStorage.getItem('cc-dbx-estado');
    const verif = sessionStorage.getItem('cc-dbx-verif') || localStorage.getItem('cc-dbx-verif') || '';
    for (const s of [sessionStorage, localStorage]) { s.removeItem('cc-dbx-verif'); s.removeItem('cc-dbx-estado'); }
    if (!esperado || estado !== 'cc-' + esperado) throw new Error('A conexão com o Dropbox não foi concluída. Tente novamente.');
    const { r, j } = await this._tokenReq({ code: codigo, grant_type: 'authorization_code', redirect_uri: urlRetornoDbx(), code_verifier: verif });
    if (!r.ok) throw new Error('Dropbox: ' + (j.error_description || j.error || 'erro ' + r.status));
    localStorage.setItem('cc-dbx-refresh', j.refresh_token);
    this._token = j.access_token;
    this._expira = Date.now() + (j.expires_in - 120) * 1000;
    await this.prepararConta();
  },

  async token() {
    if (this._token && Date.now() < this._expira) return this._token;
    const { r, j } = await this._tokenReq({ grant_type: 'refresh_token', refresh_token: localStorage.getItem('cc-dbx-refresh') || '' });
    if (!r.ok) {
      if (j.error === 'invalid_grant') this.sair();
      throw new Error('O acesso ao Dropbox expirou ou foi revogado. Conecte o Dropbox novamente.');
    }
    this._token = j.access_token;
    this._expira = Date.now() + (j.expires_in - 120) * 1000;
    return this._token;
  },

  _raizCab() { return this.raiz ? { 'Dropbox-API-Path-Root': jsonAscii({ '.tag': 'root', root: this.raiz }) } : {}; },

  async _api(rota, corpo, semRaiz) {
    const h = { Authorization: 'Bearer ' + await this.token(), ...(semRaiz ? {} : this._raizCab()) };
    if (corpo !== undefined) h['Content-Type'] = 'application/json';
    try { return await fetch('https://api.dropboxapi.com/2/' + rota, { method: 'POST', headers: h, body: corpo === undefined ? null : JSON.stringify(corpo) }); }
    catch { throw new Error(ERRO_REDE_DBX); }
  },

  // Conta da pessoa: espaço de equipe (raiz) e a pasta da base
  async prepararConta() {
    const r = await this._api('users/get_current_account', undefined, true);
    if (!r.ok) throw new Error('Dropbox: não foi possível ler a conta (erro ' + r.status + ').');
    const j = await r.json();
    const ri = j.root_info || {};
    this.raiz = ri.root_namespace_id && ri.root_namespace_id !== ri.home_namespace_id ? ri.root_namespace_id : '';
    this.conta = `${j.name?.display_name || ''} (${j.email || ''})`;
    localStorage.setItem('cc-dbx-raiz', this.raiz);
    localStorage.setItem('cc-dbx-conta', this.conta);
    this.base = '';
    for (const p of PASTAS_BASE) {
      const m = await this._api('files/get_metadata', { path: p });
      if (m.ok && (await m.json())['.tag'] === 'folder') { this.base = p; break; }
    }
    localStorage.setItem('cc-dbx-base', this.base);
    if (!this.base) throw new Error(`A pasta COBRANÇA CONDOMINIAL (em ASA Advocacia > ASA - PROCESSOS) não foi encontrada no Dropbox de ${this.conta}. Peça ao administrador para compartilhar a pasta com você.`);
  },

  // TRAVA: só caminhos relativos, sem "..", sempre dentro da pasta da base
  caminho(c) {
    if (!this.base) throw new Error('A pasta da base no Dropbox ainda não foi localizada.');
    const partes = String(c || '').split('/');
    if (!c || partes.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) throw new Error('Caminho fora da pasta da base: ' + c);
    return this.base + '/' + c;
  },

  async ler(c) {
    const p = this.caminho(c), rev = this._revs.get(p), cache = this._cache.get(p);
    if (rev && cache && cache.rev === rev) return cache.texto; // não mudou desde a última leitura
    let r;
    try {
      r = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST', headers: { Authorization: 'Bearer ' + await this.token(), 'Dropbox-API-Arg': jsonAscii({ path: p }), ...this._raizCab() },
      });
    } catch { throw new Error(ERRO_REDE_DBX); }
    if (r.status === 409) {
      const t = await r.text();
      if (t.includes('not_found')) { this._cache.delete(p); return null; }
      throw new Error('Dropbox: ' + t.slice(0, 200));
    }
    if (!r.ok) throw new Error(`Dropbox: erro ${r.status} ao ler ${c}.`);
    const texto = await r.text();
    let novaRev = '';
    try { novaRev = JSON.parse(r.headers.get('Dropbox-API-Result') || '{}').rev || ''; } catch { /* sem revisão */ }
    if (novaRev) { this._cache.set(p, { rev: novaRev, texto }); this._revs.set(p, novaRev); }
    return texto;
  },

  async gravar(c, texto) {
    const p = this.caminho(c);
    let r;
    try {
      r = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST', body: new TextEncoder().encode(texto),
        headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': jsonAscii({ path: p, mode: 'overwrite', autorename: false, mute: true }), ...this._raizCab() },
      });
    } catch { throw new Error('Não foi possível gravar no Dropbox. Verifique a conexão com a internet.'); }
    if (!r.ok) throw new Error(`Dropbox: erro ${r.status} ao gravar ${c}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json().catch(() => ({}));
    if (j.rev) { this._cache.set(p, { rev: j.rev, texto }); this._revs.set(p, j.rev); }
  },

  async listar(sub) {
    const nomes = [];
    let r = await this._api('files/list_folder', { path: this.caminho(sub), limit: 2000 });
    if (r.status === 409) return [];
    for (;;) {
      if (!r.ok) throw new Error(`Dropbox: erro ${r.status} ao listar ${sub}.`);
      const j = await r.json();
      for (const e of j.entries) {
        if (e['.tag'] !== 'file' || !e.name.endsWith('.json')) continue;
        nomes.push(e.name);
        this._revs.set(this.caminho(sub + '/' + e.name), e.rev);
      }
      if (!j.has_more) break;
      r = await this._api('files/list_folder/continue', { cursor: j.cursor });
    }
    return nomes;
  },

  async remover(c) {
    const r = await this._api('files/delete_v2', { path: this.caminho(c) });
    if (!r.ok && r.status !== 409) throw new Error(`Dropbox: erro ${r.status} ao excluir ${c}.`);
    this._cache.delete(this.caminho(c));
  },

  async paraLixeira(c) {
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    const r = await this._api('files/move_v2', { from_path: this.caminho(c), to_path: this.caminho(`lixeira/${carimbo}_${c.replace(/\//g, '_')}`), autorename: true });
    if (!r.ok && r.status !== 409) throw new Error(`Dropbox: erro ${r.status} ao mover ${c} para a lixeira.`);
    this._cache.delete(this.caminho(c));
  },

  sair() {
    ['cc-dbx-refresh', 'cc-dbx-base', 'cc-dbx-raiz', 'cc-dbx-conta'].forEach(k => localStorage.removeItem(k));
    this._token = null; this.base = ''; this.raiz = ''; this.conta = '';
    this._cache.clear(); this._revs.clear();
  },
};
