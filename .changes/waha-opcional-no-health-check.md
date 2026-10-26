---
impacto: capacidade_nova
secao: adicionado
titulo: Dá para desligar o WAHA sem derrubar a verificação de saúde
---

Instalação cujo WhatsApp não passa pelo WAHA pode definir `WAHA_ENABLED=false`.
A verificação de saúde deixa de cobrar esse serviço e continua respondendo que
o sistema está no ar; o vigia de sessão não pergunta mais um endereço que não
existe; e um envio ou uma conexão por esse caminho é recusado na hora, com uma
mensagem clara, sem esperar a rede.

Quem não define a variável — ou escreve qualquer coisa que não seja exatamente
`false` — continua com o WAHA ligado, como hoje. A atualização não pede edição
do `.env`.
