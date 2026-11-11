# Contexto del Sistema Integral de Logística (Sistema Liverpool)

Documento de referencia para quien mantenga o modifique el sistema. Describe qué hace cada módulo, cómo están conectados, dónde se guardan los datos y el historial de cambios. **Actualízalo cada vez que cambie un módulo.**

---

## 1. Qué es

Aplicación web interna para la operación logística de una tienda Liverpool: recepción de mercancía, manifiestos, búsqueda de SKUs, seguimiento de artículos PDIS (rechazos), inventarios e indicadores de resultados.

- **Tipo:** sitio estático (HTML + CSS + JavaScript sin build). Cada módulo es una carpeta con su `index.html`/página y su script.
- **Backend:** Firebase, proyecto `sistemaintegrall`:
  - Authentication con Google.
  - Firestore.
  - Storage.
  - Cloud Functions en `functions/`.
- **Librerías por CDN:**
  - Bootstrap 5.3 y Bootstrap Icons.
  - SweetAlert2.
  - Chart.js.
  - SheetJS (xlsx).
  - Para escanear códigos con cámara, ZXing.
  - Según el módulo: flatpickr, pdfmake, html2canvas y AOS.
- **Firebase SDK:** la mayoría usa la versión 8 (`firebase.firestore()`). Excepciones:
  - Configuración usa 9 compat.
  - Bodegas usa 9 modular (`import { getFirestore } ...`).

## 2. Estructura de carpetas

```
index.html                 Inicio (bienvenida, efeméride, accesos rápidos)
Login/                     Inicio de sesión con Google y registro de rol
Adminroles/                Administración de usuarios y roles
Dashboard/                 Dashboard de Resultados manifestados
SKU/                       Buscador de SKUs / contenedores / manifiestos
Recibos/                   Área de Recibos (registro de entregas)
Manifiestos/               Manifestar mercancía (escaneo contra manifiesto)
_archivado/                Módulos fuera del menú principal (siguen funcionando por URL)
  PDISDashboard/           Dashboard PDIS (análisis de archivos PDIS)
  Rechazos/                Gestor de PDIS (rechazos)
  Bodegas/                 Inventario de Navidad / plano interactivo de tienda
  Inventarios/             Asistente de conteo de inventario
  Reportes/                Resumen semanal
  Configuraciones/         Perfil de usuario
  Kanban/                  Tablero de métricas (datos de ejemplo, estático)
  Pendientes/              Pantalla para usuarios con solicitud pendiente
  InfraConfig/             Service worker de mensajería y librerías (vfs_fonts)
functions/                 Cloud Functions (getUserByEmail, getJefeBodega)
shared.css                 Estilos compartidos (header, menú lateral, base)
shared-ui.js               Menú lateral, encabezado de módulo y carga de theme.css
theme.css                  Lenguaje visual unificado (se carga al final de cada página)
assets/                    Favicon y recursos
Datos.xlsx                 Ejemplo de archivo de Datos Maestros
build_prueba_resultados.mjs  Script que genera un Excel de prueba para el Dashboard
outputs/                   Salidas generadas (Excel de prueba)
```

## 3. Acceso, usuarios y roles

1. El usuario entra con Google en **Login**.
2. En Firestore se busca su documento en la colección `usuarios`:
   - `status: 'aprobado'`: entra al sistema.
   - `status: 'pendiente'`: ve la pantalla de **Pendientes**.
   - Si no tiene documento, se registra eligiendo **rol** y **número de tienda**. Los roles `vendedor` y `bodeguero` también eligen a su jefe, que es un usuario con `role: 'jefe'` aprobado.
3. Roles disponibles: `jefe`, `gerente`, `vendedor`, `bodeguero`, `prevencion`, además de administradores.
4. **Adminroles** aprueba, rechaza, edita y elimina usuarios, también de forma masiva.
5. Administradores:
   - Dashboard y SKU usan una lista fija de UIDs (`ADMIN_UIDS` en sus `app.js`).
   - La Cloud Function `getUserByEmail` usa la colección `admins`.

## 4. Datos en Firebase

| Colección / ruta | Quién la usa | Contenido |
|---|---|---|
| `usuarios` | Login, Inicio, Adminroles, Reportes | Perfil, rol, tienda, jefe y estado de cada usuario |
| `admins` | Cloud Functions | UIDs con permisos de administrador |
| `reportesDashboard` | Dashboard, SKU | Resultados manifestados: un documento por manifiesto con `rows[]` (Manifiesto, Contenedor, Sección, Jefatura, Artículo, Descripción, Piezas, Faltantes, Sobrante) |
| `datosMaestros/secciones` | Dashboard, SKU, Recibos | Relación Sección: Descripción, Jefatura, Gerente, Bodega |
| `manifiestosCerrados` | SKU (y antes el Dashboard) | Manifiestos cerrados: cantidad manifestada contra cantidad registrada |
| `skuManifiestos` | SKU | Archivos SKU por manifiesto |
| `entregas` | Recibos, SKU | Entregas registradas en el Área de Recibos |
| `bodegasData` / `catalogoBodegas` | Recibos | Catálogo de bodegas (código, jefe, sección) |
| `manifiestos`, `scans`, `presence` | Manifiestos, Reportes | Metadatos de cada manifiesto, escaneos y usuarios conectados |
| `inventarios` | Inventarios | Conteos de inventario |
| `entregasContenedores` | Bodegas (app.js) | Entregas por contenedor |
| Storage `Dashboard/` | Dashboard | Excel originales de resultados |
| Storage `Manifiestos/{tienda}/`, `ExcelManifiestos/Secciones.xlsx` | Manifiestos, Reportes | Archivos de manifiesto y catálogo de secciones |
| Storage `uploads/` | Rechazos, PDIS Dashboard, Inventarios | Archivos PDIS/rechazos e inventarios |
| Storage `BodegasRelacion/RelacionBodegas.xlsx` | Cloud Functions, Bodegas | Relación bodega: jefatura |

> La colección `manifiestosCerrados` **sigue en uso por SKU**. Aunque el Dashboard ya no la muestra, no se debe borrar.

## 5. Módulos

### Inicio (`index.html`)
- Saludo según la hora, efeméride del día y accesos rápidos (Dashboard, Gestor de PDIS).
- Sin sesión muestra las funciones del sistema y el botón para entrar con Google.
- Verifica que el usuario esté aprobado. Si no lo está, muestra "Acceso denegado".
- 2026-11-11: se quitó el aviso emergente "Aviso Importante sobre Manifiestos", que advertía que los manifiestos se eliminan a los 3 días.

### Login (`Login/`)
- Botón "Continuar con Google" y registro de rol y tienda para usuarios nuevos.
- Modal de ayuda.
- Redirige según `usuarios.status`.

### Administrar roles (`Adminroles/`)
- Tarjetas de usuarios con búsqueda por nombre, correo o tienda.
- Edición en modal, aprobar o rechazar, eliminar.
- Acciones masivas: selección múltiple, asignar jefe y cambiar estado.

### Dashboard de Resultados (`Dashboard/`)
Centro ejecutivo de **resultados manifestados**. Los administradores suben un Excel por manifiesto y todos los usuarios consultan los indicadores.
- **Carga (solo admin):**
  - Detecta automáticamente las columnas Manifiesto (10 dígitos), Jefatura, Sección, Contenedor, Artículo, Descripción, Piezas, Faltantes y Sobrantes.
  - Volver a subir un manifiesto reemplaza su versión anterior.
- **Datos Maestros (solo admin):** Excel con Sección, Descripción, Jefatura, Gerente y Bodega. Con él se asigna el área de cada sección. Las secciones que no aparecen se muestran como "Sin área asignada".
- **Filtros encadenados:** Reporte, Área y Sección. Muestran chips de filtros activos y se pueden limpiar.
- **Encabezado:** saludo, frase resumen, totales, última carga y un medidor de exactitud con la meta de 95%.
- **6 indicadores:**
  - piezas manifestadas;
  - piezas recibidas;
  - faltantes;
  - sobrantes;
  - exactitud contra la meta;
  - contenedores sin diferencia.
- **Hallazgos automáticos:**
  - exactitud global;
  - área con más faltantes;
  - mejor y peor área;
  - sección más afectada;
  - concentración de faltantes (regla 80/20);
  - contenedores con diferencia;
  - sobrantes;
  - datos incompletos.
- **Semáforo de áreas:** en meta ≥95%, atención 85–95% y crítico <85%. Incluye una barra con la composición de las piezas.
- **Gráficas:**
  - exactitud por área, con línea de meta;
  - estado de contenedores (sin diferencia, con faltantes, con sobrantes, mixto);
  - faltantes y sobrantes por área;
  - las 10 secciones con más faltantes;
  - comparativo por reporte.

  Al hacer clic en una gráfica se aplica el filtro correspondiente.
- **Tarjetas por área:** posición, exactitud, estado, piezas, faltantes, sobrantes, contenedores y la sección más afectada.
- **Tablas:**
  - por sección: ordenable, con su peso en los faltantes;
  - por contenedor: agrupada, con búsqueda, filtro por estado, ordenable y paginada de 20 en 20;
  - top 15 artículos con diferencias.
- **Exportar a Excel** lo filtrado. El archivo trae las hojas Resumen, Áreas, Secciones, Contenedores y Detalle.
- **Fórmulas:**
  - Exactitud = (Piezas − Faltantes) ÷ Piezas.
  - Piezas recibidas = Piezas − Faltantes.

### Buscador de SKUs (`SKU/`)
- Busca por SKU, contenedor o manifiesto.
- Combina la información de `skuManifiestos`, `reportesDashboard`, `manifiestosCerrados`, `entregas` y Datos Maestros.
- Muestra una línea de tiempo del artículo y su contenedor: manifestado, entregado, escaneado y cerrado.
- Los administradores suben archivos SKU por manifiesto.
- Usa su propia hoja `SKU/legacy-dashboard.css`, que es la copia del CSS anterior del Dashboard (ver cambios).

### Área de Recibos (`Recibos/`)
Flujo de 3 pasos:
1. Escanear o escribir el código de bodega. Se resuelve con el catálogo de bodegas.
2. Agregar contenedores, con escáner de cámara (ZXing) o teclado.
3. Confirmar la entrega. Se guarda en `entregas` con bodega, sección, jefe y fecha.

Además incluye el historial de entregas por día. Los administradores suben el Excel "Escaneo bodegas.xlsx" (catálogo).

### Manifestar mercancía (`Manifiestos/`)
El módulo más grande, con `script.js` de unas 5,700 líneas.
- Verifica al colaborador.
- Abre manifiestos desde Storage y escanea códigos contra el manifiesto, incrementando lo registrado por contenedor.
- Cambia contenedores de estado.
- Muestra los usuarios conectados en tiempo real (`presence`).
- Calcula estadísticas por jefatura y sección.
- Genera reportes en PDF y Excel: portada, métricas, top de contenedores faltantes y excedentes, conclusiones.
- Vuelve a subir el archivo con los cambios del escáner.

### Dashboard PDIS (`_archivado/PDISDashboard/`)
Centro de análisis de los archivos PDIS/rechazos de Storage `uploads/`. Lee la hoja "Rechazos" de cada archivo, cuyos nombres contienen "pdis" o "rechazos".
- **Columnas que usa:** Remisión, Sku, Descripción Sku, Sección, Piezas, Fecha y Hora Rechazo, Jefatura, Usuario de Rechazo, Comentarios, Status y Auditor.
- **Estados:**

  | Estado | `Status` que lo produce |
  |---|---|
  | Buen estado | "Encontrada buen estado", "Encontrada en exhibición" |
  | Mal estado / merma | "Encontrada mal estado", "Encontrada Merma" |
  | No encontrada | "No encontrada" |
  | Pendiente | Status vacío |
- **Mismo diseño que el Dashboard de Resultados:** enlaza `../../Dashboard/styles.css` y usa las mismas clases `db-*`. Un cambio en ese CSS afecta a los dos dashboards.
- **Encabezado:** medidor de **localización**, con referencia de 90% (constante `REF`; umbral de atención `WARN` = 75%).
- **6 indicadores:**
  - registros;
  - avance de revisión;
  - buen estado;
  - mal estado;
  - no encontradas;
  - pendientes.
- **Hallazgos automáticos y semáforo de jefaturas.**
- **Gráficas:**
  - estado de los PDIS;
  - resultado por jefatura (100% apilado);
  - secciones con más no encontradas;
  - auditores con más avance;
  - rechazos por fecha, con la línea de localización.
- **Tarjetas por jefatura.**
- **Ranking de auditores** (ordenable).
- **Detalle de registros:** búsqueda, botones por estado y paginación.
- **Lista de archivos:** versión, fecha, tamaño, registros y avance. Un clic filtra ese archivo.
- **Exportar a Excel:** hojas Resumen, Jefaturas, Auditores y Detalle.
- **Fórmulas:**
  - Localización = (buen + mal) ÷ revisados.
  - Avance = revisados ÷ total.

### Gestor de PDIS (`_archivado/Rechazos/`)
- Carga el reporte PDIS/rechazos, que incluye un archivo de ejemplo.
- Muestra los artículos según el rol del usuario y permite capturar el estado con evidencia fotográfica.
- Guarda los cambios sin conexión y los sincroniza después.
- Genera dashboards por rango de fechas, por jefatura y por auditor.
- Envía el archivo por correo.

### Bodegas / Inventario de Navidad (`_archivado/Bodegas/`)
- Escáner de SKUs por colección y plano interactivo de la tienda con conteo por zona.
- Herramientas: dashboard de inventario, registro de sustracciones y contenido de bodega.
- Usa Firebase 9 modular.
- `app.js`, que maneja las entregas por contenedor, está en la carpeta pero la página no lo carga.

### Control de inventario (`_archivado/Inventarios/`)
- Asistente paso a paso: elegir archivo, confirmar el marbete, escanear y editar manualmente.
- Funciona sin conexión con IndexedDB y sincroniza con Firebase con reintentos.

### Resumen semanal (`_archivado/Reportes/`)
- Elige un rango de fechas (flatpickr) y reconstruye los datos de los manifiestos desde Firebase.
- Genera el resumen consolidado, que se exporta a PDF y Excel.

### Configuración (`_archivado/Configuraciones/`)
- Perfil del usuario (nombre, correo, UID) e información del sistema.

### Dashboard de métricas (`_archivado/Kanban/`)
- Tarjetas de indicadores (manifiesto, rechazos, procesos, auditoría, inventario, orden de bodega).
- Los datos son **de ejemplo y fijos**: no está conectado a Firebase.

### Pendientes (`_archivado/Pendientes/`)
- Pantalla para usuarios con solicitud en revisión: contacto con el administrador y cierre de sesión.

### Cloud Functions (`functions/index.js`)
- `getUserByEmail`: un administrador obtiene un usuario de Auth por su correo. Valida contra `admins`.
- `getJefeBodega`: lee `BodegasRelacion/RelacionBodegas.xlsx` y devuelve la jefatura de una bodega.

## 6. Interfaz compartida y lenguaje visual

- **`shared-ui.js`** (se incluye con `defer` en cada módulo):
  - Reconstruye el menú lateral: Inicio, Dashboard, Dashboard PDIS y PDIS.
  - Arma los accesos rápidos de Inicio.
  - Inserta el **encabezado de módulo** (`.ui-hero`) con título, descripción, icono y fecha. Los módulos y sus textos están en la lista `MODULES`.
  - Carga `theme.css` si la página no lo enlazó.
  - Calcula la ruta raíz a partir de su propia URL, así funciona desde cualquier carpeta.
- **`shared.css`:** header blanco con filo rosa, menú lateral y estilos base heredados.
- **`theme.css`:** se enlaza como **última** hoja de cada página. Aplica el estilo del Dashboard a todo el sistema:
  - Tipografía Inter y fondo `#F6F3F6`.
  - Tarjetas blancas (radio 18–22 px, sombra suave).
  - Tablas con encabezado claro en mayúsculas pequeñas.
  - Botones de 11 px de radio y formularios de 42 px de alto con foco rosa.
  - Modales con encabezado degradado vino, badges y alertas suaves, SweetAlert redondeado.
  - Login a pantalla completa con el degradado.
- **Paleta:**

  | Uso | Color |
  |---|---|
  | Rosa principal | `#E6007E` |
  | Vino | `#8E1A5B` |
  | Noche | `#32152A` |
  | Bien (verde) | `#0E9F6E` |
  | Atención (ámbar) | `#D97706` |
  | Crítico (rojo) | `#DC2626` |
  | Texto | `#2B2027` / `#6D5B66` / `#9B8994` |
  | Degradado del encabezado | `#2A1023 → #5E123E → #B5006A → #E6007E` |
- **Para agregar un módulo nuevo:**
  1. Incluir `shared.css`, `shared-ui.js` y, al final, `theme.css`.
  2. Usar `<header class="app-header">` y `<main class="main-container">`.
  3. Agregar su entrada en `MODULES` de `shared-ui.js`.

## 7. Notas técnicas y pendientes conocidos

- La configuración de Firebase (apiKey) está en el cliente, lo normal en apps web. La seguridad depende de las **reglas de Firestore y Storage**, que no están en este repositorio.
- Los UIDs de administrador están fijos en el código del Dashboard y de SKU. Conviene moverlos a la colección `admins`.
- `functions/index.js` tiene `throw new new functions.https.HttpsError(...)`, un `new` duplicado que provoca un error distinto al esperado. Además, `bucketName = 'loginliverpool.appspot.com'` no coincide con el proyecto `sistemaintegrall`.
- Conviven varias versiones del SDK de Firebase (8.6.8, 8.10.0, 8.10.1, 9.6.1, 9.16 compat). Unificarlas reduciría errores.
- Manifiestos carga varias librerías xlsx a la vez (SheetJS, xlsx-style, xlsx-js-style).
- **Prueba visual local:** con Playwright, que está en `node_modules`, y un stub de Firebase se pueden abrir las páginas sin sesión real. Así se validó el rediseño.

## 8. Historial de cambios

### 2026-11-11
- **Inicio:** se eliminó el aviso emergente sobre manifiestos.
- **Dashboard de Resultados, rediseño completo** (`Dashboard/index.html`, `styles.css`, `app.js`):
  - Nuevo encabezado con medidor de exactitud, 6 indicadores, hallazgos automáticos y semáforo.
  - 5 gráficas que responden al clic, tarjetas por área y tablas ordenables con búsqueda y paginación.
  - Exportación a Excel y explicación de cómo se calculan los indicadores.
  - Filtros encadenados con chips. Al cargar resultados ahora se guardan también Artículo y Descripción.
  - Las secciones sin jefatura aparecen como "Sin área asignada", en lugar de ocultarse.
  - Se retiró del Dashboard el código de "Manifiestos Cerrados", que ya estaba oculto. Está en el historial de git (commit `fe377a4` y anteriores).
- **Estilo del Dashboard en todos los módulos:**
  - Nuevo `theme.css`, enlazado al final de las 15 páginas.
  - `shared-ui.js` ahora inserta el encabezado de módulo, carga el tema y calcula bien la ruta raíz.
  - Además, se corrigió que "Inicio" apareciera activo en todas las páginas.
  - Bodegas y Kanban ahora incluyen `shared.css` y `shared-ui.js`, con el mismo header y menú.
  - El bloque de bienvenida de Inicio, el Login y el encabezado del Dashboard PDIS adoptan el degradado común.
- **Celular:** se corrigió el scroll horizontal de Kanban (tarjeta de métricas) y de Inventarios (indicadores de conexión en el header, que se ocultan en pantallas angostas).
- **SKU:** dependía del CSS anterior del Dashboard. Se copió a `SKU/legacy-dashboard.css` y se enlazó ahí, para que el rediseño del Dashboard no lo afecte.
- Nuevo este archivo `CONTEXTO.md`.
- **Dashboard PDIS, rediseño completo** (`_archivado/PDISDashboard/index.html`, `pdis-dashboard.js`, `pdis-dashboard.css`), con el mismo estilo del Dashboard de Resultados. Ver la sección 5.
  - **Cambio de criterio:** antes un registro sin `Status` contaba como "No encontrada". Ahora cuenta como **Pendiente**, para distinguir lo no revisado de lo que no se localizó.
  - Se agregaron el filtro por auditor, la búsqueda en el detalle, la exportación a Excel y la lectura de la fecha de rechazo (texto "20 ene 2025, 12:29:30" o fecha de Excel).
- **Reparación de acentos dañados en todo el sistema.** Algunos Excel traen texto codificado dos veces: "AUDÍFONOS" se veía como "AUDÃƒÂFONOS" y "BÓXER" como "BÃƒâ€œXER". `shared-ui.js` define `window.fixText()` y `window.fixTextDeep()`, que revierten hasta 4 capas de UTF-8 leído como Windows-1252/Latin-1. Solo cambian tramos que al decodificarse forman UTF-8 válido, así que los textos correctos (Ñ, €, comillas) no se tocan. Se aplica en tres niveles:
  1. `XLSX.utils.sheet_to_json` queda envuelto, así que todo Excel que lea cualquier módulo llega reparado: filtros, cálculos, re-subidas y exportaciones.
  2. El Dashboard repara los `rows` y los Datos Maestros que ya estaban guardados en Firestore.
  3. Un `MutationObserver` corrige el texto visible en pantalla de todos los módulos como red de seguridad.

- **Gestor PDIS, etiqueta de estado ilegible:** el mapa de colores solo conocía los nombres anteriores ("Sí encontrada", "Encontrada Merma"). Con los estados actuales ("Encontrada buen estado" / "Encontrada mal estado") quedaba sin fondo y con texto blanco. Ahora `pdiStatusClass()` en `main.js` asigna la clase `pdi-st-buen` / `pdi-st-mal` / `pdi-st-no` / `pdi-st-pend` (estilos en `rechazos.css`), al pintar la lista y al cambiar un estado. También se agregaron los estados actuales a la gráfica de jefaturas del Gestor.

  `fixEncoding()` del Gestor PDIS ahora usa `fixText`. Los datos ya guardados en Firestore **no se reescriben**: se reparan al leerlos. Se corrigen de forma permanente cuando el archivo se vuelve a subir.

## 9. Seguridad y despliegue

- `firebase.json` ahora declara `firestore.rules` y `storage.rules`. Antes solo estaba declarada la configuracion de Functions.
- `firestore.rules` usa la coleccion `admins/{uid}` o el Custom Claim `admin: true` para permisos administrativos.
- Las colecciones operativas requieren autenticacion. Las cargas administrativas de `reportesDashboard`, `datosMaestros`, `skuManifiestos` y `manifiestosCerrados` requieren administrador.
- `storage.rules` separa los archivos de Dashboard, uploads PDIS, evidencias, manifiestos y relacion de bodegas.
- Las evidencias PDIS se pueden leer y cargar con sesion autenticada. La proteccion por responsable se mantiene en la interfaz y en la sincronizacion del archivo; para seguridad fuerte conviene mover esa validacion a una Cloud Function.
- El frontend contiene la apiKey publica de Firebase, lo cual es normal. Nunca se deben subir claves privadas, tokens de servicio o archivos `.env`.
- La pagina se publica mediante GitHub Pages desde la rama `main`. Firebase y GitHub Pages se despliegan por separado: Pages publica archivos estaticos y `firebase deploy --only functions,firestore:rules,storage` publica backend y reglas.
- Antes de publicar reglas nuevas, probarlas en el emulador o en un proyecto de prueba. Las reglas pueden bloquear funciones antiguas si algun modulo usa una coleccion no documentada.

## 10. Esquema flexible de resultados manifestados

El Dashboard acepta archivos Excel con encabezados equivalentes. La normalizacion reconoce, entre otros:

| Dato | Encabezados aceptados |
|---|---|
| Jefatura | Jefe, Jefatura, Responsable, Gerente |
| Seccion | Seccion, Sección, Area, Área |
| Piezas | Piezas, Cantidad, Unidades, Articulos, Manifestados |
| Faltantes | Faltantes, Faltante, Faltan |
| Sobrantes | Sobrantes, Sobrante, Exceso, Mercancia de mas |
| Manifiesto | Manifiesto, Manifesto, Folio, Reporte |

- Si el archivo no trae manifiesto, el registro se agrupa como `GENERAL`.
- Cada documento de `reportesDashboard` guarda `manifestoId`, `fileName`, `uploadedBy`, `uploadedByEmail`, `uploadedAt` y `rows[]`.
- Un manifiesto que se vuelve a cargar reemplaza la version anterior del mismo `manifestoId`.
- Los KPI principales se calculan con Piezas, Faltantes y Sobrante. Exactitud = `(Piezas - Faltantes) / Piezas`.
- Si se agregan nuevas columnas al archivo real, primero deben incorporarse a `RESULT_ALIASES` y a `normalizeResultRow()` en `Dashboard/app.js`.

## 11. Persistencia y recuperacion PDIS

- Los cambios de `Status`, `Auditor` y `Fotos` se agregan a una cola local antes de sincronizar.
- La cola utiliza `localStorage`; conviene migrarla a IndexedDB y asociarla al nombre/version del archivo para evitar colisiones entre archivos.
- Las evidencias seleccionadas se conservan como borrador en IndexedDB si la subida falla. Actualmente el usuario debe reintentar la subida desde el Gestor; una mejora futura es ofrecer una bandeja visible de evidencias pendientes.
- La version del archivo se valida antes de escribir para detectar conflictos. Si otro usuario actualizo el archivo, se debe recargar antes de continuar.
- Los estados actuales son `Encontrada buen estado`, `Encontrada mal estado` y `No encontrada`. Los nombres antiguos se conservan solo para leer historicos.
- Los registros con estado y auditor ya asignados quedan protegidos frente a cambios de otro usuario en la interfaz. La garantia definitiva debe implementarse en backend.

## 12. Pendientes tecnicos priorizados

1. Desplegar y probar las reglas de Firestore y Storage en Firebase.
2. Corregir o probar `getJefeBodega` con el bucket real `sistemaintegrall.firebasestorage.app`.
3. Eliminar el `ADMIN_UIDS` duplicado del cliente y usar Custom Claims o `admins` como unica fuente.
4. Migrar la cola PDIS de `localStorage` a IndexedDB con clave por archivo y version.
5. Implementar la proteccion de estados en una Cloud Function o transaccion Firestore.
6. Unificar Firebase SDK y SheetJS para reducir diferencias entre modulos.
7. Corregir permanentemente los archivos fuente con mojibake y dejar `fixText` solo como compatibilidad para Excel historicos.
8. Agregar pruebas de carga con el Excel `Prueba_Resultados_Manifestados.xlsx` y una prueba de permisos por rol.

## 13. Archivo de prueba

- `outputs/prueba-resultados/Prueba_Resultados_Manifestados.xlsx` contiene datos ficticios de jefaturas, secciones, articulos, piezas, faltantes y sobrantes.
- `build_prueba_resultados.mjs` permite regenerarlo. Las previsualizaciones PNG y archivos NDJSON de inspeccion estan ignorados por Git.

### Actualizacion 2026-11-11

- Se agrego `access-control.js` como fuente comun para validar administradores mediante Custom Claims o `admins/{uid}`. Dashboard, SKU y Gestor PDIS ya no dependen de listas de UIDs en el cliente.
- Se agrego la coleccion `pdisLocks`. Antes de guardar un estado, el Gestor PDIS intenta reservar el registro por archivo y remision mediante una transaccion. Otro usuario recibe un aviso y no puede sobrescribirlo; un administrador puede corregirlo.
- La cola de cambios PDIS conserva una copia en IndexedDB y mantiene `localStorage` como respaldo de compatibilidad. Al sincronizar correctamente se limpian ambos respaldos.
- Se agregaron reglas para `pdisLocks` en `firestore.rules` y se mantuvieron permisos administrativos para cargas de resultados, datos maestros y archivos PDIS.
- Se corrigieron las referencias de `getJefeBodega` al bucket de `sistemaintegrall` y el error de construccion de `HttpsError`.
- Las validaciones de JavaScript ejecutadas en esta actualizacion: `Dashboard/app.js`, `SKU/app.js`, `_archivado/Rechazos/main.js` y `access-control.js` pasaron `node --check`.
- Las reglas se desplegaron correctamente el 2026-11-11 en `sistemaintegrall` con `firebase deploy --only firestore:rules,storage`. El release activo protege Firestore y Storage con las reglas versionadas en este repositorio.

### Actualizacion de acceso automatico 2026-11-11

- Se elimino del flujo de Login la aprobacion manual por administrador. Ya no se redirige a `Pendientes` ni se solicitan aprobaciones por correo.
- `access-control.js` centraliza la politica de correo: se permiten todas las cuentas `@liverpool.com.mx` y las cuentas administrativas autorizadas `fernandosilva130501@gmail.com` e `imailin14022002@gmail.com`.
- Los perfiles nuevos se crean con `status: aprobado` y los perfiles historicos que tenian `pendiente` o `rechazado` se normalizan a acceso activo al iniciar sesion, siempre que el correo cumpla la politica.
- `Adminroles` queda exclusivamente para asignar rol, tienda, departamento y jefe. Se quitaron las acciones de aprobar/rechazar y los estados pendientes del flujo visible.
- La validacion de administrador de `Adminroles` usa `isSystemAdmin()` mediante Custom Claim o la coleccion `admins`, no una lista de UIDs en el cliente.
- `Administrar roles` se agrego al menu comun de todos los modulos para mantener la navegacion unificada; el modulo conserva su proteccion administrativa.
- Login y registro ahora muestran acceso corporativo automatico y activacion inmediata del perfil.

### Administradores de archivos 2026-11-11

- Las cuentas con permisos administrativos de carga, sustitucion y eliminacion son: `fernandosilva130501@gmail.com`, `imailin14022002@gmail.com`, `mireyesb@liverpool.com.mx` y `agavila@liverpool.com.mx`.
- La validacion se aplica tanto en la interfaz (`access-control.js`) como en las reglas de Firestore y Storage. La lista exacta de cuatro correos es la unica fuente de permisos administrativos; Custom Claims o documentos antiguos de `admins` ya no habilitan a cuentas no listadas. Un usuario normal puede operar y consultar, pero no puede cargar, sustituir o eliminar archivos administrativos.
- Se restringieron las rutas de Storage de Dashboard, PDIS/evidencias, uploads, BodegasRelacion, ExcelManifiestos y Manifiestos a administradores para evitar que una restriccion visual pueda saltarse desde el navegador.
- Dashboard, Inicio, Recibos y Manifiestos ya usan la validacion comun de administrador; se eliminaron listas de UIDs duplicadas en esos flujos.
- La exportacion temporal de usuarios de Firebase se elimino del espacio de trabajo y no se versiono.
- Los correos de la captura pertenecen a cuentas existentes en Firebase Authentication. Los nombres `direct_test`, `probe`, `pivot`, `cmp`, `aureo`, `test_aureo`, `e...` y `mcastrol_test` tienen formato de cuentas de prueba o automatizacion; no se borran automaticamente para evitar eliminar usuarios reales sin confirmacion.

### Rediseño de Inicio 2026-11-11

- `index.html` recibió un rediseño visual completo para Inicio: fondo con textura sutil, panel de bienvenida Liverpool, tarjetas consistentes, CTA de acceso seguro, sombras, estados hover y responsive para celular.
- Se corrigieron la jerarquia visual, el contraste, los colores dispersos de las tarjetas y los anchos para que Inicio conserve la misma identidad del resto del sistema.
- Se agregaron indicadores visuales de acceso seguro, operación en tiempo real e indicadores claros al hero de Inicio, además de cuatro accesos rápidos para evitar una pantalla vacía.
- `theme.css` ahora aplica superficies con degradado blanco-rosado, botones con degradado Liverpool, sombras más profundas y controles con acabado suave en los módulos unificados. El icono del hero se fuerza visible y con tamaño consistente.
- Se renovó también el menú lateral global: fondo blanco-rosado degradado, encabezado vino/rosa, estados activos con relieve, iconos con acento y tarjetas internas con profundidad para evitar el aspecto plano.

### Comparativo por reporte: perfil de indicadores 2026-11-11

- Se corrigió la orientación de la gráfica comparativa: ahora cada línea representa un reporte y el eje muestra `Exactitud`, `Recibidas`, `Faltantes` y `Sobrantes`.
- Los reportes se comparan en una escala común de 0 a 100%, con línea de meta del 95% y tooltips que incluyen tanto porcentaje como piezas reales.
- El clic en cualquier punto filtra el Dashboard por el reporte correspondiente.

### Corrección de jefaturas contra departamentos 2026-11-11

- Se detectó que el mapa de `datosMaestros/secciones` de Firebase estaba sobrescribiendo `Jefatura.json` y hacía aparecer departamentos como `Tecnología`, `Caballeros`, `Hogar` o `Damas` dentro del ranking de jefaturas.
- `Complementos/Jefatura.json` ahora se carga después de Firebase y tiene prioridad para resolver `Jefatura`, `Descripcion`, `Gerente` y `Asistente`; Firebase queda como respaldo para secciones no incluidas en el complemento.
- El ranking, el filtro de jefatura, las gráficas y los contenedores usan la jefatura real resuelta desde el catálogo VCM.

### Rediseño del comparativo por reporte 2026-11-11

- Se reemplazó la gráfica que mezclaba barras de miles de piezas con una línea porcentual en doble escala.
- El comparativo ahora es una gráfica de líneas en escala común de 0 a 100% para `Exactitud`, `Recibidas`, `Faltantes` y `Sobrantes`.
- Los tooltips conservan el porcentaje y muestran la cantidad real de piezas para no perder contexto.

### Perfeccionamiento visual de Dashboard y gráficas 2026-11-11

- Se limitaron las gráficas de áreas al conjunto más relevante y se fijaron alturas responsivas para evitar gráficas interminables, etiquetas encimadas y espacios blancos causados por el estiramiento de la cuadrícula.
- Se retiraron etiquetas permanentes de puntos cuando provocaban saturación; el detalle completo permanece disponible al pasar o pulsar cada punto mediante tooltip.
- Los paneles de gráficas ahora se alinean por su contenido y en móvil usan una altura compacta consistente.

### Ajuste visual de tablas y gráficas 2026-11-11

- Las tablas del Dashboard ahora se convierten en tarjetas de dos columnas en pantallas pequeñas; cada dato conserva su etiqueta y ya no se corta ni obliga a desplazarse lateralmente.
- Las gráficas de exactitud y faltantes usan líneas suaves con puntos; la comparación de diferencias combina barras de faltantes/sobrantes con una línea de exactitud y doble escala.
- Se ajustaron colores, metas, tooltips, espaciado y superficies de las gráficas para acercarlas al estilo ejecutivo de referencia.

### Dashboard de resultados: lectura VCM y responsividad 2026-11-11

- Se renombró el KPI principal a `Piezas esperadas (VCM)`: representa la suma de `Cant. Manf.`, es decir, lo que VCM esperaba recibir. `Piezas recibidas` usa `Cant. Registrada` cuando existe; 166 esperadas y 158 registradas dejan 8 pendientes.
- La exactitud se calcula como `Piezas recibidas / Piezas esperadas * 100`, y el tablero explica ambas magnitudes. La exportación conserva esta misma semántica.
- `Contenedores con diferencias` identifica los contenedores con faltantes o sobrantes; al pulsar la tarjeta se listan los contenedores afectados y sus cantidades.
- Todos los KPI principales son interactivos: muestran la fórmula, el origen de los datos y un detalle de secciones o contenedores que explica el resultado.
- `Detalle por sección` y `Artículos con más diferencias` tienen búsqueda propia; las tablas usan anchos flexibles, saltos de texto y reglas móviles para evitar desplazamiento horizontal.
- Las gráficas de exactitud, diferencias y secciones usan series de puntos con tooltips y selección por área/sección para comparar resultados de forma más clara.

### Fuente VCM y estructura de jefaturas 2026-11-11

- `Complementos/Jefatura.json` contiene la relación de jefe, sección, departamento, gerencia y asistente. El Dashboard la usa como catálogo local de respaldo cuando todavía no existe `datosMaestros/secciones` en Firestore.
- `Complementos/Mnf6000612362-111126-0042.xlsx` es una muestra real del formato VCM: `Cen. Des.`, `Manifiesto`, `Sección`, `Artículo`, `Código UPC`, `Desc. Artículo`, `Contenedor`, `Cant. Manf.`, `Cant. Registrada`, `Diferencia`, `Status`, `Fecha Man` y `Cen. Org.`.
- El Dashboard reconoce `Cant. Manf.`, `Cant. Registrada`, `Diferencia` y `Status`. Cada fila se clasifica en cuatro conceptos: `Faltante`, `Sobrante`, `Adicional` o `Correcto`.
- `Adicional` se identifica por el estado correspondiente o por mercancía registrada sin cantidad manifestada; `Faltante` y `Sobrante` se determinan por la diferencia; `Correcto` corresponde a diferencia cero.
- Se agregó una franja visible de resultados VCM con los cuatro conceptos para que el análisis sea entendible para jefes y gerencias.
- Se corrigió el enriquecimiento del Dashboard: el catálogo de `Complementos/Jefatura.json` se combina con `datosMaestros/secciones` sin perder datos, y las secciones del Excel VCM ahora resuelven correctamente su jefatura, departamento, gerente y asistente.
- El catálogo de 182 secciones se cargó en Firebase en `datosMaestros/secciones`. El filtro visual se etiqueta como `Jefatura` y se alimenta con los jefes resueltos desde ese catálogo.
