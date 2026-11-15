#!/usr/bin/env node
// Creates the tiny WAV fixtures used by the Playwright smoke test.
// Run: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

function wav(frequencies, seconds = 0.7, rate = 22050) {
  const samples = Math.floor(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    // Short fade in/out so the tone does not click.
    const fade = Math.min(1, t / 0.05, (seconds - t) / 0.05);
    let value = 0;
    for (const frequency of frequencies) {
      value += Math.sin(2 * Math.PI * frequency * t) / frequencies.length;
    }
    data.writeInt16LE(Math.round(value * 0.32 * fade * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

mkdirSync(OUT, { recursive: true });

const fixtures = [
  ['Tester - First Tone.wav', [440, 660]],
  ['Tester - Second Tone.wav', [523.25, 784]],
];

for (const [name, frequencies] of fixtures) {
  const buffer = wav(frequencies);
  writeFileSync(resolve(OUT, name), buffer);
  console.log(`wrote tests/fixtures/${name} (${buffer.length} bytes)`);
}
