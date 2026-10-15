'use strict';
/*
  Usuários e login. Perfis: "admin" (administrador) e "usuario".
  Os usuários ficam em usuarios.json, na pasta da base, com as senhas cifradas (PBKDF2-SHA256).
  O controle é feito pelo aplicativo: quem tiver acesso direto à pasta, fora do app, consegue abrir os arquivos.
*/

const b64ParaBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const bytesParaB64 = b => btoa(String.fromCharCode(...b));
const ITERACOES = 100000;

function validarLogin(login) {
  if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw new Error('O login deve ter de 3 a 30 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.');
}
function validarSenha(s) { if (!s || s.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.'); }

const Auth = {
  usuario: null, // { login, nome, perfil }

  ehAdmin() { return this.usuario?.perfil === 'admin'; },

  _guardar(lembrar) {
    const d = JSON.stringify({ usuario: this.usuario, modo: Armaz.modo });
    sessionStorage.setItem('cc-sessao', d);
    if (lembrar) localStorage.setItem('cc-sessao', d); else localStorage.removeItem('cc-sessao');
  },
  _guardado() {
    try { return JSON.parse(sessionStorage.getItem('cc-sessao') || localStorage.getItem('cc-sessao') || 'null'); } catch { return null; }
  },
  sair() {
    sessionStorage.removeItem('cc-sessao');
    localStorage.removeItem('cc-sessao');
    this.usuario = null;
  },

  async _ler() {
    const t = await Armaz.ler('usuarios.json');
    if (!t) return {};
    try { return JSON.parse(t).usuarios || {}; } catch { throw new Error('O arquivo usuarios.json está corrompido.'); }
  },
  async _gravar(u) {
    await Armaz.gravar('usuarios.json', JSON.stringify({ usuarios: u, atualizadoEm: new Date().toISOString() }, null, 1));
  },
  async _hash(senha, sal, iter) {
    if (!window.crypto?.subtle) throw new Error('Abra o programa pelo endereço seguro (https) para usar o login.');
    const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64ParaBytes(sal), iterations: iter }, chave, 256);
    return bytesParaB64(new Uint8Array(bits));
  },
  async _novaSenha(senha) {
    const sal = bytesParaB64(crypto.getRandomValues(new Uint8Array(16)));
    return { sal, iter: ITERACOES, hash: await this._hash(senha, sal, ITERACOES) };
  },
  _admins: u => Object.values(u).filter(r => r.perfil === 'admin' && r.ativo).length,

  async temUsuarios() { return Object.keys(await this._ler()).length > 0; },

  async lista() {
    const u = await this._ler();
    return Object.keys(u).sort().map(login => ({ login, nome: u[login].nome, perfil: u[login].perfil, ativo: !!u[login].ativo, trocarSenha: !!u[login].trocarSenha, ultimoAcesso: u[login].ultimoAcesso || '' }));
  },

  async criarPrimeiroAdmin({ login, nome, senha }) {
    login = login.trim().toLowerCase();
    validarLogin(login); validarSenha(senha);
    if (!nome.trim()) throw new Error('Informe o nome.');
    const u = await this._ler();
    if (Object.keys(u).length) throw new Error('O administrador já foi criado. Entre com o seu login.');
    u[login] = { nome: nome.trim(), perfil: 'admin', ativo: true, criadoEm: new Date().toISOString(), ...await this._novaSenha(senha) };
    await this._gravar(u);
    this.usuario = { login, nome: nome.trim(), perfil: 'admin' };
    this._guardar(true);
  },

  async entrar(login, senha, lembrar) {
    login = login.trim().toLowerCase();
    const u = await this._ler(), r = u[login];
    if (!r || !r.ativo || await this._hash(senha, r.sal, r.iter) !== r.hash) {
      await new Promise(ok => setTimeout(ok, 700));
      throw new Error('Usuário ou senha incorretos.');
    }
    r.ultimoAcesso = new Date().toISOString();
    await this._gravar(u).catch(() => {});
    this.usuario = { login, nome: r.nome, perfil: r.perfil };
    this._guardar(lembrar);
    return { trocarSenha: !!r.trocarSenha };
  },

  // Sessão guardada neste aparelho: confere se o usuário continua ativo (e com o mesmo perfil)
  async retomar() {
    const s = this._guardado();
    if (!s?.usuario || s.modo !== Armaz.modo) return false;
    const r = (await this._ler())[s.usuario.login];
    if (!r || !r.ativo) { this.sair(); return false; }
    this.usuario = { login: s.usuario.login, nome: r.nome, perfil: r.perfil };
    return { trocarSenha: !!r.trocarSenha };
  },

  async trocarSenha(atual, nova) {
    validarSenha(nova);
    const u = await this._ler(), r = u[this.usuario.login];
    if (!r || await this._hash(atual, r.sal, r.iter) !== r.hash) throw new Error('A senha atual não confere.');
    Object.assign(r, await this._novaSenha(nova), { trocarSenha: false });
    await this._gravar(u);
  },

  // Somente administrador
  async salvarUsuario({ login, nome, perfil, ativo, senha }, novo) {
    if (!this.ehAdmin()) throw new Error('Somente o administrador pode alterar usuários.');
    login = login.trim().toLowerCase();
    validarLogin(login);
    if (!nome.trim()) throw new Error('Informe o nome.');
    const u = await this._ler();
    if (novo && u[login]) throw new Error('Já existe um usuário com este login.');
    if (!novo && !u[login]) throw new Error('Usuário não encontrado.');
    if (novo || senha) validarSenha(senha);
    const r = u[login] || { criadoEm: new Date().toISOString() };
    Object.assign(r, { nome: nome.trim(), perfil: perfil === 'admin' ? 'admin' : 'usuario', ativo: !!ativo });
    if (senha) Object.assign(r, await this._novaSenha(senha), { trocarSenha: true });
    u[login] = r;
    if (!this._admins(u)) throw new Error('É preciso manter pelo menos um administrador ativo.');
    await this._gravar(u);
    if (login === this.usuario.login) { this.usuario = { login, nome: r.nome, perfil: r.perfil }; this._guardar(!!localStorage.getItem('cc-sessao')); }
  },
};

// Senha provisória fácil de ditar (sem letras ambíguas)
function senhaProvisoria() {
  const c = 'abcdefghjkmnpqrstuvwxyz23456789', a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map(x => c[x % c.length]).join('');
}
