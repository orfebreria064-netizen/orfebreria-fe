// Narración con voz neuronal de Microsoft Edge (español de Perú) y utilidades de ffmpeg.
import { execFile } from 'node:child_process';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const run = promisify(execFile);
export const VOZ = process.env.AYUDA_VOZ ?? 'es-PE-CamilaNeural';

/** Genera el mp3 de un texto y devuelve su ruta y duración en segundos. */
export async function narrar(texto, destino) {
  await mkdir(path.dirname(destino), { recursive: true });
  const tmpDir = destino + '.tmp';
  await mkdir(tmpDir, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOZ, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  // Velocidad levemente pausada: es un tutorial
  const { audioFilePath } = await tts.toFile(tmpDir, texto, { rate: '-5%' });
  tts.close();
  await rename(audioFilePath, destino);
  await rm(tmpDir, { recursive: true, force: true });
  return { ruta: destino, duracion: await duracion(destino) };
}

/** Duración de un archivo multimedia, leída de la salida de ffmpeg. */
export async function duracion(archivo) {
  const salida = await run(ffmpegPath, ['-hide_banner', '-i', archivo]).catch((e) => e);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(salida.stderr ?? '');
  if (!m) throw new Error(`No se pudo leer la duración de ${archivo}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Une la grabación (webm de Playwright) con las narraciones, cada una en su segundo de inicio,
 * y produce un mp4 H.264 + AAC liviano para la web.
 */
export async function montar({ video, narraciones, destino, recorteInicio = 0 }) {
  await mkdir(path.dirname(destino), { recursive: true });
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(recorteInicio), '-i', video];
  narraciones.forEach((n) => args.push('-i', n.ruta));
  const filtros = narraciones.map((n, i) => {
    const ms = Math.max(0, Math.round((n.inicio - recorteInicio) * 1000));
    return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
  });
  const mezcla = narraciones.map((_, i) => `[a${i}]`).join('');
  filtros.push(`${mezcla}amix=inputs=${narraciones.length}:normalize=0,apad[aout]`);
  args.push(
    '-filter_complex', filtros.join(';'),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', '25',
    '-c:a', 'aac', '-b:a', '96k',
    '-shortest', '-movflags', '+faststart',
    destino,
  );
  await run(ffmpegPath, args, { maxBuffer: 1 << 26 });
  return destino;
}
