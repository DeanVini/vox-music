import { buscar } from './search.js';
import { duracaoLegivel } from './source.js';

const consulta = process.argv.slice(2).join(' ') || 'zara larsson';

const inicio = Date.now();
const { resultados, falhas } = await buscar(consulta, { porFonte: 4 });
const decorrido = (Date.now() - inicio) / 1000;

console.log(`busca: "${consulta}"  (${decorrido.toFixed(1)}s)\n`);

resultados.forEach((r, i) => {
  const marca = r.origem === 'youtube' ? 'YT' : 'SC';
  const previa = r.previaCurta ? '  [prévia de 30s]' : '';
  console.log(`${String(i + 1).padStart(2)}. [${marca}] ${r.titulo}`);
  console.log(`     ${r.autor ?? 'sem autor'} · ${duracaoLegivel(r.duracaoSegundos)}${previa}`);
});

if (Object.keys(falhas).length > 0) console.log('\nfalhas:', falhas);

const yt = resultados.filter((r) => r.origem === 'youtube').length;
const sc = resultados.filter((r) => r.origem === 'soundcloud').length;
console.log(`\nYouTube: ${yt}   SoundCloud: ${sc}   tempo: ${decorrido.toFixed(1)}s`);
console.log(`AS DUAS FONTES RESPONDERAM: ${yt > 0 && sc > 0 ? 'SIM' : 'NAO'}`);
console.log(`TODOS TEM LINK PARA TOCAR..: ${resultados.every((r) => r.pagina.startsWith('http')) ? 'SIM' : 'NAO'}`);
