import fs from 'fs';
import path from 'path';

const projectDir = 'C:/Users/에스에스브이/.gemini/antigravity/scratch/hybrid-circuit-simulator';

const files = [
  'src/engine/CircuitNode.js',
  'src/engine/MNASolver.js',
  'src/engine/FFT.js',
  'src/components/ComponentModels.js',
  'src/engine/UserPresets.js',
  'src/ui/BreadboardCanvas.js',
  'src/ui/OscilloscopeCanvas.js',
  'src/ui/ContinuityTester.js',
  'src/components/SPICEExporter.js',
  'src/components/AICopilot.js',
  'src/components/CircuitSerializer.js',
  'app.js'
];

let bundleCode = `/**\n * bundle.js - Complete Standalone Bundle for 빵판시뮬레이터 (Company-JK Workbench)\n * Works on both http://, https://, and local file:/// double-click without CORS blocking!\n */\n(function() {\n'use strict';\n\n`;

files.forEach(file => {
  const filePath = path.join(projectDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Strip import statements
  content = content.replace(/^import\s+[\s\S]*?;/gm, '');

  // Strip export keywords
  content = content.replace(/^export\s+class\s+/gm, 'class ');
  content = content.replace(/^export\s+const\s+/gm, 'const ');
  content = content.replace(/^export\s+function\s+/gm, 'function ');
  content = content.replace(/^export\s+default\s+/gm, '');

  bundleCode += `/* --- ${file} --- */\n` + content + `\n\n`;
});

bundleCode += `})();\n`;

fs.writeFileSync(path.join(projectDir, 'bundle.js'), bundleCode, 'utf-8');
console.log(`[SUCCESS] Generated bundle.js (${bundleCode.length} bytes)!`);
