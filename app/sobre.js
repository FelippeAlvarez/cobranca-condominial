'use strict';
/* Sobre o programa: direitos autorais, termos de uso, política de privacidade e licenças de terceiros */

// Titular dos direitos autorais do programa
const TITULAR = 'Felippe Alvarez';
const ANO_DIREITOS = 2026;
const COPYRIGHT = `© ${ANO_DIREITOS} ${TITULAR}. Todos os direitos reservados.`;
const VIGENCIA_TERMOS = '27/10/2026';

const SECOES_SOBRE = [
  ['programa', 'O programa'], ['termos', 'Termos de uso'], ['privacidade', 'Política de privacidade'], ['licencas', 'Licenças de terceiros'],
];

function textoSobre(secao) {
  const s = {
    programa: `<h2>Cobrança Condominial</h2>
      <p>Versão ${VERSAO}. ${esc(COPYRIGHT)}</p>
      <p>O programa, seu código, layout, textos e planilhas geradas a partir de seus modelos são protegidos pela Lei 9.610/1998 (direitos autorais) e pela Lei 9.609/1998 (programas de computador).</p>
      <h3>Licença de uso</h3>
      <p>O titular concede às pessoas por ele autorizadas uma licença de uso não exclusiva, intransferível e revogável, para uso do programa em suas atividades profissionais, nos termos de uso abaixo.
        Não é permitido, sem autorização prévia e por escrito do titular: copiar, modificar, adaptar, traduzir, distribuir, sublicenciar, vender, alugar ou disponibilizar o programa a terceiros, nem remover os avisos de direitos autorais.
        As bibliotecas de terceiros incluídas no programa continuam sujeitas às próprias licenças (ver "Licenças de terceiros").</p>
      <p>As planilhas e os PDFs que você gera com o programa, com os seus dados, podem ser usados livremente por você, inclusive em processos judiciais e cobranças.</p>`,

    termos: `<h2>Termos de uso</h2>
      <p class="dica">Vigentes desde ${VIGENCIA_TERMOS}. Ao usar o programa, você concorda com estes termos.</p>
      <h3>1. Objeto</h3>
      <p>O programa Cobrança Condominial é uma ferramenta de apoio para elaborar planilhas de cobrança judicial e extrajudicial de cotas condominiais em atraso (correção monetária, juros, multa, honorários e despesas) e para simular e acompanhar acordos.</p>
      <h3>2. Natureza da ferramenta e responsabilidade pelo cálculo</h3>
      <p>O programa executa os critérios informados por quem o usa. A escolha dos valores, datas, índices, taxas e demais critérios, e a conferência do resultado com a convenção do condomínio, o título judicial ou o contrato, são de responsabilidade exclusiva do usuário.
        O programa não presta consultoria, não constitui parecer jurídico ou contábil e não substitui a análise de profissional habilitado.</p>
      <h3>3. Índices e taxas</h3>
      <p>Os índices e taxas vêm de fontes públicas (Banco Central do Brasil e Secretaria de Fazenda do Estado do Rio de Janeiro) e podem ser publicados com atraso, revistos ou estar temporariamente indisponíveis.
        Quando um índice não estiver disponível, o programa avisa na tela e na planilha. Cabe ao usuário conferir os índices usados.</p>
      <h3>4. Dados e cópias de segurança</h3>
      <p>Os dados ficam no local usado pelo escritório (a pasta do Dropbox da equipe, uma pasta do computador ou o próprio navegador). O usuário é responsável por esse local, por quem tem acesso a ele e por manter cópias de segurança.
        No modo "Somente neste navegador", os dados podem ser perdidos se o navegador for limpo ou reinstalado.</p>
      <h3>5. Contas de acesso</h3>
      <p>O administrador de cada base de dados cadastra os usuários e responde pela concessão e pelo bloqueio de acessos. Cada usuário deve manter a própria senha em sigilo.
        O controle de acesso é feito pelo programa: quem tiver acesso direto à pasta dos dados, fora do programa, consegue abrir os arquivos.</p>
      <h3>6. Disponibilidade e garantias</h3>
      <p>O programa é fornecido no estado em que se encontra, sem garantia de funcionamento ininterrupto, de ausência de erros ou de adequação a uma finalidade específica.
        O titular pode alterar, suspender ou descontinuar o programa ou funções dele.</p>
      <h3>7. Limitação de responsabilidade</h3>
      <p>Na máxima extensão permitida pela lei, o titular não responde por danos decorrentes do uso ou da impossibilidade de uso do programa, de critérios ou dados informados pelo usuário, de índices publicados pelas fontes oficiais ou de falhas em serviços de terceiros (como o Dropbox e o navegador).</p>
      <h3>8. Propriedade intelectual</h3>
      <p>O uso do programa não transfere ao usuário nenhum direito sobre ele, além da licença de uso descrita em "O programa".</p>
      <h3>9. Alterações destes termos</h3>
      <p>Estes termos podem ser atualizados. A versão vigente fica sempre disponível nesta tela, com a data de vigência.</p>
      <h3>10. Lei aplicável</h3>
      <p>Estes termos são regidos pelas leis brasileiras.</p>`,

    privacidade: `<h2>Política de privacidade</h2>
      <p class="dica">Vigente desde ${VIGENCIA_TERMOS}. Esta política segue a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).</p>
      <h3>1. O programa não tem servidor próprio</h3>
      <p>O programa funciona no seu navegador. Os dados que você digita (condomínios, devedores, CPF/CNPJ, endereços, processos, valores, cobranças e acordos) são gravados somente no local escolhido por você:
        no seu Dropbox, numa pasta do seu computador ou no próprio navegador. O titular do programa não recebe, não armazena e não tem acesso a esses dados.</p>
      <h3>2. Quem é o controlador dos dados</h3>
      <p>Quem usa o programa (por exemplo, o escritório de advocacia) é o controlador dos dados pessoais que nele lança (LGPD, art. 5º, VI) e deve ter base legal para o tratamento,
        como o exercício regular de direitos em processo judicial ou administrativo (art. 7º, VI) ou a execução de contrato (art. 7º, V). Os pedidos dos titulares dos dados (acesso, correção, eliminação etc.) devem ser dirigidos a esse controlador.</p>
      <h3>3. Comunicações do programa pela internet</h3>
      <ul>
        <li><b>Banco Central do Brasil</b> (api.bcb.gov.br): o programa baixa as séries de índices e taxas. Os pedidos não contêm dados pessoais nem dados dos cálculos.</li>
        <li><b>Dropbox</b> (se você escolher esse local): o programa se conecta à sua conta com a autorização que você dá na página do próprio Dropbox, e lê e grava apenas na pasta COBRANÇA CONDOMINIAL da equipe (o programa recusa qualquer outro caminho). O tratamento pelo Dropbox segue a política de privacidade dele.</li>
        <li><b>Hospedagem do programa</b>: os arquivos do programa são baixados do serviço de hospedagem (GitHub Pages), que pode registrar dados técnicos de acesso, como endereço IP, conforme a política dele.</li>
      </ul>
      <h3>4. Dados guardados no seu navegador</h3>
      <p>Para funcionar, o programa guarda no navegador do aparelho: a forma de acesso escolhida, a sessão de login (se você marcar "Manter conectado"), a autorização de acesso ao Dropbox, preferências de tela e, no modo de teste, os próprios dados.
        Não há cookies de publicidade nem ferramentas de rastreamento ou estatísticas de uso. Para apagar, use "Desconectar este aparelho" ou limpe os dados do site no navegador.</p>
      <h3>5. Senhas</h3>
      <p>As senhas dos usuários são gravadas cifradas (PBKDF2-SHA256, com sal aleatório) no arquivo usuarios.json, na pasta dos dados. O programa não guarda a senha em texto.</p>
      <h3>6. Segurança</h3>
      <p>A segurança dos dados depende também do local escolhido: compartilhe a pasta dos dados só com quem deve ter acesso, use senhas fortes e mantenha o computador e o navegador atualizados.</p>
      <h3>7. Alterações</h3>
      <p>Esta política pode ser atualizada. A versão vigente fica sempre disponível nesta tela.</p>`,

    licencas: `<h2>Licenças de terceiros</h2>
      <p>O programa inclui as bibliotecas abaixo, de código aberto, usadas conforme as respectivas licenças:</p>
      <ul>
        <li><b>jsPDF</b> 2.5.1, para gerar os PDFs. © 2010-2021 James Hall e © 2015-2021 yWorks GmbH. Licença MIT: <a href="licencas/jspdf-mit.txt" target="_blank" rel="noopener">texto da licença</a>.</li>
        <li><b>PDF.js</b> 3.11.174, para a prévia dos PDFs. © Mozilla Foundation. Licença Apache 2.0: <a href="licencas/apache-2.0.txt" target="_blank" rel="noopener">texto da licença</a>.</li>
      </ul>
      <h3>Dados públicos</h3>
      <ul>
        <li>Séries de índices (IGP-M e IPCA): Banco Central do Brasil, Sistema Gerenciador de Séries Temporais (SGS), dados abertos.</li>
        <li>Valores anuais da UFIR-RJ: Secretaria de Estado de Fazenda do Rio de Janeiro.</li>
      </ul>`,
  };
  return s[secao] || s.programa;
}

function telaSobre(secao) {
  secao = SECOES_SOBRE.some(([k]) => k === secao) ? secao : 'programa';
  $('#conteudo').innerHTML = (Armaz.modo && document.body.classList.contains('conectado') ? cabecalho('Sobre o programa')
    : cabecalho('Sobre o programa', '', '', '#/')) + `
    <div class="abas">${SECOES_SOBRE.map(([k, t]) => `<a href="#/sobre/${k}" class="${k === secao ? 'ativa' : ''}">${t}</a>`).join('')}</div>
    <div class="cartao texto-legal">${textoSobre(secao)}</div>
    <p class="dica">${esc(COPYRIGHT)}</p>`;
}

// Rodapé com os links legais (tela de conexão e menu)
const linksLegais = () => `<span>${esc(COPYRIGHT)}</span> <a href="#/manual">Manual de uso</a> · <a href="#/sobre/termos">Termos de uso</a> · <a href="#/sobre/privacidade">Privacidade</a> · <a href="#/sobre/licencas">Licenças</a>`;
