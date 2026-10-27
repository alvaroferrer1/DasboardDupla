# Publicar DOS ESPACIOS para los dos

No está publicado. Necesitáis un dominio/subdominio, VPS y un servidor HTTPS. La URL local no es accesible desde la casa de la otra persona.

## Pasos generales

1. Escoge un VPS Linux actualizado con Docker/Compose, almacenamiento persistente y firewall.
2. Configura registro DNS A del subdominio hacia ese VPS.
3. Transfiere `dos-espacios` mediante medio seguro. No transfieras contraseñas o claves en archivos públicos.
4. Crea `.env` a partir de `.env.example` y define `DOMAIN=dos.ejemplo.com` para Docker+Caddy. Completa API de IA solo si se desea.
5. Ejecuta `docker compose build`.
6. **Solo al comienzo**, `docker compose run --rm app npm run setup`, correo y contraseña de ambos. La app limita a dos cuentas y no admite registros públicos.
7. Arranca con `docker compose up -d`.
8. Configura firewall: solo 80 y 443 abiertos al público, nunca 3077.
9. Prueba `https://dos.ejemplo.com` desde dos redes/dispositivos diferentes, login, edición cruzada y subida de archivos.
10. Programa copias de seguridad del volumen persistente y verifica la restauración. Mantén el sistema actualizado y examina logs regularmente.

### Advertencias

La configuración provista necesita comprobación en vuestro servidor. Caddy solo podrá emitir un certificado si el DNS resuelve al VPS y 80/443 son accesibles. No guardéis datos sensibles de clientes hasta revisar el cumplimiento legal, permisos, política de retención y medidas apropiadas. Proteger backups y claves. No exponer `.env` ni directorio `data/` como web pública.

Para cambios futuros, probad en copia de la base, preservad `data/` y haced backup antes de actualizar. Las migraciones de esquema de V3 son aditivas, pero conviene verificar y respaldar antes de cualquier salto de versión.
