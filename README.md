# Cobrança Condominial

Programa para gerar e atualizar planilhas de cobrança judicial e extrajudicial de cotas condominiais em atraso.

- Cadastro de condomínios (credores), unidades e devedores
- Cotas mês a mês com correção monetária (UFIR-RJ, IGP-M ou IPCA), juros de mora pro rata die e multa
- Honorários contratuais (em linha própria, embutidos no valor das cotas ou em coluna após a cota) e sucumbenciais
- Despesas (custas, certidões, registros) com correção desde o pagamento
- Planilhas em PDF e Excel (com fórmulas) por cobrança, devedor, imóvel e cliente
- Importação de planilhas Excel, CSV e PDF

**Usar:** https://felippealvarez.github.io/cobranca-condominial/

Funciona no Google Chrome ou Microsoft Edge, sem instalação: abra o endereço acima (ou o arquivo `Abrir Cobranca Condominial.html`) e escolha a pasta dos dados (por exemplo, uma pasta compartilhada do Dropbox). Os dados ficam somente nessa pasta, nunca neste repositório.

Veja [COMO USAR.txt](COMO%20USAR.txt).

Manual de uso, termos de uso, privacidade e licenças: dentro do programa (menu "Sobre, termos e privacidade"). Veja também [LICENCA.txt](LICENCA.txt).

Bibliotecas incluídas em `app/lib`: [jsPDF](https://github.com/parallax/jsPDF) (MIT) e [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0).
