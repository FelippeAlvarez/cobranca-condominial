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
  desconectar() { localStorage.removeItem('cc-modo'); this.modo = null; },

  descricao() {
    if (this.modo === 'pasta') return 'Pasta: ' + (this.dir?.name || '');
    if (this.modo === 'local') return 'Somente neste navegador (teste)';
    return '';
  },

  async _pasta(partes, criar) {
    let d = this.dir;
    for (const p of partes) d = await d.getDirectoryHandle(p, { create: criar });
    return d;
  },

  async ler(caminho) {
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
    const nomes = [];
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
    const t = await this.ler(caminho);
    if (t === null) return;
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    await this.gravar(`lixeira/${carimbo}_${caminho.replace(/\//g, '_')}`, t);
    await this.remover(caminho);
  },
};
