---
impacto: capacidade_nova
secao: alterado
titulo: O outreach passa a filtrar propostas e limitar os envios reais
---

Quem já tem o agente de outreach instalado não precisa editar nada. A variável nova
OUTREACH_TETTO_INVII nasce vazia e isso vale 5 envios reais por dia; um número acima de 30
vale 30. As propostas em modo de prova continuam em 10 por dia e não usam esse teto.

O primeiro contato por e-mail passa a usar o texto aprovado (contatos, compromissos e
follow-up, sem preço e sem WhatsApp). Endereços de PEC, e-mail gratuito, e-mail nominativo,
domínio que não combina com o nome e título de artigo deixam de virar proposta. No mesmo
giro sai no máximo um e-mail por contato, por endereço e por domínio que não seja gratuito.
Um primeiro contato real já enviado para aquele endereço não nasce de novo. Uma proposta
criada em modo de prova não vira envio real se alguém aprovar depois de desligar a prova.

Enquanto OUTREACH_DRY_RUN não for exatamente false, nenhum e-mail real sai.
