import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const outputDir = 'outputs/prueba-resultados';
await fs.mkdir(outputDir, { recursive: true });
const workbook = Workbook.create();
const sheet = workbook.worksheets.add('Resultados');
sheet.showGridLines = false;
sheet.tabColor = '#E6007E';

const headers = ['Manifiesto','Jefatura','Sección','Contenedor','Artículo','Descripción','Piezas','Faltantes','Sobrantes'];
const jefaturas = [
  ['Hogar','Cocina','CONT-001','SKU-10001','Batería de cocina 10 piezas',24,1,0],
  ['Hogar','Blancos','CONT-002','SKU-10002','Juego de sábanas matrimonial',18,0,2],
  ['Hogar','Decoración','CONT-003','SKU-10003','Lámpara de mesa',15,3,0],
  ['Tecnología','Audio','CONT-004','SKU-20001','Bocina inalámbrica',32,0,1],
  ['Tecnología','Cómputo','CONT-005','SKU-20002','Mouse ergonómico',40,2,0],
  ['Tecnología','Telefonía','CONT-006','SKU-20003','Cargador rápido USB-C',28,0,3],
  ['Damas','Ropa casual','CONT-007','SKU-30001','Blusa de manga larga',36,4,0],
  ['Damas','Calzado','CONT-008','SKU-30002','Tenis casual',22,1,1],
  ['Caballeros','Camisas','CONT-009','SKU-40001','Camisa de vestir',26,0,2],
  ['Caballeros','Accesorios','CONT-010','SKU-40002','Cinturón de piel',30,2,0],
  ['Juguetería','Primera infancia','CONT-011','SKU-50001','Set de bloques',20,0,1],
  ['Juguetería','Videojuegos','CONT-012','SKU-50002','Control inalámbrico',16,3,0],
  ['Hogar','Cocina','CONT-013','SKU-10004','Licuadora de vaso',12,0,0],
  ['Tecnología','Audio','CONT-014','SKU-20004','Audífonos Bluetooth',25,1,0],
  ['Damas','Ropa casual','CONT-015','SKU-30003','Pantalón de mezclilla',33,0,2],
  ['Caballeros','Camisas','CONT-016','SKU-40003','Polo de algodón',29,1,0],
  ['Juguetería','Primera infancia','CONT-017','SKU-50003','Peluche educativo',14,0,1],
  ['Hogar','Blancos','CONT-018','SKU-10005','Toallas de baño',27,2,0],
  ['Tecnología','Cómputo','CONT-019','SKU-20005','Teclado inalámbrico',21,0,2],
  ['Damas','Calzado','CONT-020','SKU-30004','Sandalia casual',19,2,0],
];
const rows = jefaturas.map((r, i) => [`5008377351`, ...r]);
sheet.getRange(`A1:I${rows.length + 1}`).values = [headers, ...rows];
sheet.getRange('A1:I1').format = { fill: '#35182C', font: { name: 'Aptos', bold: true, color: '#FFFFFF', size: 11 }, horizontalAlignment: 'center', verticalAlignment: 'center' };
sheet.getRange(`A2:I${rows.length + 1}`).format = { font: { name: 'Aptos', size: 10, color: '#2B2027' }, verticalAlignment: 'center' };
sheet.getRange(`G2:I${rows.length + 1}`).format.numberFormat = '#,##0';
sheet.getRange(`A1:I${rows.length + 1}`).format.borders = { preset: 'all', style: 'thin', color: '#EADFE6' };
sheet.getRange(`A2:I${rows.length + 1}`).conditionalFormats.add('containsText', { text: 'Hogar', format: { fill: '#FFF0F7' } });
sheet.getRange('A1:I1').format.rowHeight = 30;
sheet.getRange(`A1:I${rows.length + 1}`).format.autofitColumns();
sheet.getRange('A:A').format.columnWidth = 16;
sheet.getRange('B:B').format.columnWidth = 18;
sheet.getRange('C:C').format.columnWidth = 18;
sheet.getRange('D:D').format.columnWidth = 15;
sheet.getRange('E:E').format.columnWidth = 16;
sheet.getRange('F:F').format.columnWidth = 28;
sheet.getRange('G:I').format.columnWidth = 12;
sheet.freezePanes.freezeRows(1);
sheet.tables.add(`A1:I${rows.length + 1}`, true, 'ResultadosManifestadosPrueba');

workbook.recalculate();
const check = await workbook.inspect({ kind: 'table', range: `Resultados!A1:I8`, include: 'values,formulas', tableMaxRows: 8, tableMaxCols: 9, maxChars: 5000 });
console.log(check.ndjson);
const preview = await workbook.render({ sheetName: 'Resultados', range: 'A1:I12', scale: 1.5, format: 'png' });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/Prueba_Resultados_Manifestados.xlsx`);
