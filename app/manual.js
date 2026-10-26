'use strict';
/* Manual de uso (tela "Manual", aberta pelo botão no topo, pelo menu ou pela tela inicial) */

const MANUAL = [
  ['inicio', 'Primeiros passos', `
    <ol>
      <li><b>Entre</b>: clique em "Conectar ao Dropbox" (com a sua conta do Dropbox da ASA) e depois entre com o login e a senha recebidos do administrador.</li>
      <li>No primeiro acesso a uma base nova, crie o <b>administrador</b>. Ele cadastra os demais usuários e altera as configurações.</li>
      <li>Em <b>Configurações</b>, preencha os dados do escritório (saem no cabeçalho das planilhas, com o logotipo) e os padrões de multa, juros, honorários contratuais e índice.</li>
      <li>Cadastre o <b>condomínio</b> (cliente) em "Condomínios", com os encargos da convenção e o percentual de honorários, se forem diferentes do padrão.</li>
      <li>Crie a <b>cobrança</b> de cada unidade em "Nova cobrança", ou importe uma planilha.</li>
      <li>Escolha a data em "Atualizar até" e gere o <b>PDF</b> ou o <b>Excel</b>.</li>
    </ol>`],

  ['dados', 'Onde ficam os dados', `
    <ul>
      <li><b>Dropbox (pela internet)</b>: a forma normal de uso, no computador e no celular. O programa usa somente a pasta <b>ASA Advocacia &gt; ASA - PROCESSOS &gt; COBRANÇA CONDOMINIAL</b>, a mesma para toda a equipe.</li>
      <li><b>Pasta do computador</b> (Chrome ou Edge, em "Outras formas de acesso"): grava direto numa pasta, que pode ser a pasta sincronizada do Dropbox. Útil sem internet.</li>
      <li><b>Somente neste navegador</b>: para testes. Os dados podem ser perdidos se o navegador for limpo.</li>
    </ul>
    <p><b>Mudar de local:</b> em "Minha conta" ou "Configurações", use <b>Mudar o local dos dados…</b>. O programa pergunta se deve levar uma cópia dos dados atuais (cobranças, condomínios, acordos, usuários e configurações) para o novo local. Nada é apagado do local atual.</p>
    <p><b>Cópia em arquivo:</b> em "Minha conta", <b>Exportar cópia dos dados</b> gera um arquivo com todos os dados; <b>Importar cópia dos dados</b> (administrador) grava esse arquivo no local atual, perguntando antes de substituir o que já existir.
      Use para levar dados de um teste para a base da equipe, para o aplicativo instalado no iPhone ou como cópia de segurança. O arquivo contém dados pessoais dos devedores: guarde-o com cuidado.</p>
    <p>Cada condomínio, cobrança e acordo fica num arquivo próprio. Os arquivos excluídos vão para a subpasta "lixeira". Se duas pessoas alterarem a mesma cobrança ao mesmo tempo, o programa avisa e recarrega os dados.</p>`],

  ['cobranca', 'Cobrança (uma por unidade)', `
    <ul>
      <li><b>Dados</b>: condomínio, unidade, tipo (judicial ou extrajudicial, com processo e juízo) e devedores (pode haver mais de um).</li>
      <li><b>Cotas em aberto</b>: competência, descrição, vencimento e valor originário. "Lançar meses em sequência" preenche vários meses de uma vez. Marque "Paga" para tirar a cota do cálculo sem apagá-la.</li>
      <li><b>Despesas pagas</b>: data, rubrica, descrição, valor e, se quiser, o <b>Id. no processo</b> (onde está o comprovante nos autos), que sai na planilha. Marque "Corrigir" para atualizar desde a data do pagamento.</li>
      <li><b>Encargos e honorários contratuais</b>: em branco, valem os do condomínio. Os honorários contratuais podem sair em linha própria ou <b>embutidos no valor originário</b> das cotas, sem menção na planilha.</li>
      <li><b>Honorários sucumbenciais</b>: percentual (com ou sem as despesas na base) ou valor fixo, corrigido desde a fixação.</li>
    </ul>
    <p><b>Sugestões de descrição:</b> as opções que aparecem ao digitar a descrição de uma cota ou a rubrica de uma despesa podem ser alteradas pelo administrador pelo link "Editar as sugestões" nos quadros da cobrança ou em Configurações. A lista vale para toda a base.</p>`],

  ['pagamentos', 'Pagamentos recebidos (amortizações)', `
    <p>No quadro "Pagamentos recebidos" da cobrança, lance cada pagamento parcial do devedor: data, valor, imputação e de onde abater.</p>
    <ul>
      <li><b>Imputação</b>: "Juros primeiro" (art. 354 do CC: juros e multa vencidos, depois o principal) ou "Principal primeiro".</li>
      <li><b>Abater de</b>: todas as cotas e despesas proporcionalmente, as mais antigas primeiro, despesas primeiro, só as cotas, só as despesas, ou uma cota ou despesa específica. Se o item escolhido ficar quitado, o que sobrar vai para os demais, dos mais antigos para os mais novos.</li>
    </ul>
    <p>O débito é atualizado até a data de cada pagamento e o valor é abatido; o saldo continua sendo corrigido e rendendo juros. A planilha traz um demonstrativo de cada pagamento (saldo antes, valores imputados e saldo depois).</p>`],

  ['art523', 'Art. 523 do CPC (cumprimento de sentença)', `
    <p>Na cobrança judicial, marque "Incluir multa e honorários do art. 523" quando o débito não tiver sido pago no prazo de 15 dias. A multa e os honorários (10% cada, ajustáveis) incidem sobre o <b>débito atualizado até a data do cálculo</b>.</p>
    <ul>
      <li>A base inclui as cotas atualizadas e, por padrão, os honorários contratuais. Marque também as despesas e os honorários sucumbenciais, se for o caso.</li>
      <li>Para incluir só a multa (ou só os honorários), desmarque o outro.</li>
      <li>Pagamento parcial feito <b>no prazo</b>: marque "No prazo do art. 523" no pagamento, para reduzir a base (§ 2º). Os demais pagamentos não reduzem a base.</li>
    </ul>`],

  ['criterios', 'Como o programa calcula', `
    <ul>
      <li><b>Correção</b>: IGP-M, IPCA, INPC e IPCA-E acumulam as variações mensais do mês do vencimento até o mês anterior ao do cálculo; a UFIR-RJ usa a divisão entre os valores anuais (ano do cálculo ÷ ano do vencimento).</li>
      <li><b>Juros de mora</b>: simples, pro rata die, sobre o valor corrigido. Padrão de 1% ao mês (art. 1.336, § 1º, do Código Civil). Também é possível usar a <b>taxa legal</b> (art. 406 do CC), a <b>SELIC</b> (que já inclui a correção) ou nenhum juro. Taxa legal e SELIC: taxa do mês dividida pelos dias do mês, multiplicada pelos dias do período.</li>
      <li><b>Lei 14.905/2024</b> (opcional, desmarcada por padrão): a partir de 30/08/2024, a correção passa a ser pelo IPCA e os juros pela taxa legal.</li>
      <li><b>Multa</b>: sobre o valor corrigido (padrão de 2%).</li>
      <li><b>Honorários contratuais</b>: sobre o débito atualizado (cotas corrigidas + juros + multa).</li>
    </ul>
    <p>Se faltar um índice para algum mês ou ano, o programa avisa na tela e na planilha.</p>`],

  ['planilhas', 'Planilhas em PDF e Excel', `
    <ul>
      <li><b>Por cobrança</b>: botões no quadro "Cálculo" da cobrança.</li>
      <li><b>Por cliente</b>: na tela do condomínio, "Planilha do cliente".</li>
      <li><b>Por devedor</b> e <b>por imóvel</b>: menus "Devedores" e "Imóveis".</li>
    </ul>
    <p>No Excel, tudo é fórmula: alterando a data do cálculo, a multa, os juros ou os honorários, tudo é recalculado, inclusive a correção (índices na aba "Índices"). Para incluir meses ou despesas, preencha as linhas em branco das tabelas.</p>`],

  ['importar', 'Importar planilhas (Excel, CSV ou PDF)', `
    <p>Na cobrança, "Importar planilha" em Cotas ou em Despesas; no condomínio, "Importar planilha", que cria uma cobrança por unidade (a unidade pode vir de uma coluna ou ser digitada).
      O programa sugere a linha dos títulos e as colunas; confira na prévia antes de importar. PDF só com texto selecionável (PDF escaneado não pode ser lido).</p>`],

  ['acordos', 'Acordos', `
    <p>Em <b>Acordos</b> (menu) ou no botão <b>Negociar acordo</b> da cobrança:</p>
    <ul>
      <li>Escolha o devedor e marque as cobranças incluídas (pode juntar várias). O débito é atualizado até a data do acordo.</li>
      <li><b>Desconto</b> em % ou R$, sobre o total ou item a item; <b>entrada</b> em % ou R$, com a data.</li>
      <li><b>Parcelamento</b> pela Tabela Price: informe o prazo (calcula a parcela) ou a parcela (calcula o prazo), a taxa, o vencimento da 1ª parcela (qualquer data) e se incidem juros até ela.</li>
      <li><b>Rateio</b>: cada parcela e a entrada mostram quanto é do condomínio e quanto é de honorários advocatícios, na proporção do débito com desconto.</li>
      <li>"Salvar proposta" guarda para negociar depois; "Acordo aceito" fixa os valores e libera o acompanhamento.</li>
    </ul>
    <p><b>Acompanhamento</b>: registrar pagamento (o programa sugere o valor devido na data, com correção e, em atraso, juros e multa), amortização antecipada (reduz o prazo ou a parcela), quitação e descumprimento (vencimento antecipado do saldo ou perda do desconto). É possível desfazer o último lançamento.</p>`],

  ['usuarios', 'Usuários e acesso', `
    <p>O administrador cadastra os usuários em "Usuários". O programa gera uma senha provisória e uma mensagem pronta para enviar (WhatsApp ou e-mail); no primeiro acesso, a pessoa cria a senha pessoal. Para bloquear alguém, desmarque "Acesso ativo". Lembre-se de compartilhar com a pessoa, no Dropbox, a pasta COBRANÇA CONDOMINIAL.</p>
    <p>Somente o administrador altera as configurações, cadastra usuários e exclui condomínios, cobranças e acordos. "Desconectar este aparelho" (em Minha conta) sai do login e da conta do Dropbox no aparelho.</p>`],

  ['instalar', 'Instalar como aplicativo', `
    <p>Botão <b>Instalar</b> no topo (ou "Instalar o aplicativo" no menu). O navegador pergunta se você quer instalar e cria o ícone na área de trabalho e no menu Iniciar (no celular, na tela inicial). Se o navegador não oferecer, o programa mostra o caminho pelo menu dele.</p>
    <p>No Chrome e no Edge (computador e Android), o login e a conexão com o Dropbox continuam valendo no aplicativo. No iPhone e no iPad, o aplicativo instalado tem armazenamento separado do Safari: conecte o Dropbox e entre de novo (os dados da equipe estão no Dropbox).</p>`],

  ['duvidas', 'Dúvidas comuns', `
    <ul>
      <li><b>Programa desatualizado</b>: recarregue a página com Ctrl+F5.</li>
      <li><b>Valor diferente de outra planilha</b>: confira o índice, os juros, a multa, os honorários contratuais (em linha própria ou embutidos) e a data do cálculo.</li>
      <li><b>UFIR-RJ de um ano novo</b>: inclua o valor em Configurações &gt; Índices quando a SEFAZ-RJ divulgar (normalmente em dezembro).</li>
    </ul>`],
];

function telaManual() {
  const voltar = document.body.classList.contains('conectado') ? '' : '#/';
  $('#conteudo').innerHTML = cabecalho('Manual de uso', 'Como usar o programa, passo a passo.', '', voltar) + `
    <div class="cartao sumario-manual"><h2>Sumário</h2><ol>${MANUAL.map(([k, t]) => `<li><a href="#" data-ir="${k}">${t}</a></li>`).join('')}</ol></div>
    ${MANUAL.map(([k, t, html]) => `<section class="cartao texto-legal" id="man-${k}"><h2>${t}</h2>${html}<p class="dica"><a href="#" data-topo>Voltar ao sumário</a></p></section>`).join('')}`;
  $$('[data-ir]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('#man-' + a.dataset.ir).scrollIntoView({ behavior: 'smooth' }); }));
  $$('[data-topo]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}
