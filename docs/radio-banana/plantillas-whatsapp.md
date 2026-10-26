# Plantillas candidatas — Radio Banana

Texto para revisar. Nada disto foi enviado à Meta. Publicar um modelo na WABA exige `/def-ok` e é outro passo.

Idioma de todos: `es`. O rodapé é o mesmo, para o produtor saber como sair.

Rodapé: Responde BAJA para no recibir más mensajes.

## rb_bienvenida_optin

- Categoría: UTILITY
- Cuerpo: Hola {{1}}. A partir de ahora puedes recibir por este canal el precio de la caja y los avisos de tu finca. Responde BAJA para no recibir más mensajes.

## rb_precio_semanal

- Categoría: MARKETING
- Cuerpo: Hola {{1}}. El precio de referencia de esta semana es {{2}}. Responde BAJA para no recibir más mensajes.

## rb_recordatorio_certificacion

- Categoría: UTILITY
- Cuerpo: Hola {{1}}. Tu certificación {{2}} vence el {{3}}. Responde BAJA para no recibir más mensajes.

## rb_confirmacion_baja

- Categoría: UTILITY
- Cuerpo: Listo, {{1}}. No te enviaremos más mensajes por este canal. Responde BAJA para no recibir más mensajes.

`rb_precio_semanal` es MARKETING: si la organización enciende `require_marketing_consent`, solo sale para quien tenga `granted_at`. Las otras tres son UTILITY y no pasan por ese cerrojo. La confirmación de baja del sistema, cuando la ventana de 24 h está abierta, es un texto libre y no usa esta plantilla.
