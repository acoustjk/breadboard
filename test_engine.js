import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { FFT } from './src/engine/FFT.js';
import { DCSource, Resistor, Capacitor, SwitchComponent, Wire } from './src/components/ComponentModels.js';

console.log('=== Engine Verification Test ===');

const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

const comps = [
    new DCSource('V1', 'VCC_TOP1_1', 'GND_TOP1_1', 5.0, true),
    new Wire('JUMP_VCC', 'VCC_TOP1_5', 'B1_VCC_1', '#ef4444'),
    new Wire('JUMP_GND', 'GND_TOP1_5', 'B1_GND_1', '#3b82f6'),
    new SwitchComponent('SW1', 'B1_VCC_5', 'B1_A5', false),
    new Resistor('R1', 'B1_B5', 'B1_A10', 1000, true),
    new Capacitor('C1', 'B1_B10', 'B1_GND_10', 10e-6, true)
];

const dt = 0.0001;
const capNode = grid.getNodeId('B1_A10');
console.log('Capacitor Node ID:', capNode);

const voltages = [];
for (let step = 0; step < 100; step++) {
    const res = solver.solveStep(comps, dt);
    const vC = res.get(capNode) || 0;
    voltages.push(vC);
}

console.log('Initial Cap Voltage:', voltages[0].toFixed(4), 'V');
console.log('Cap Voltage at t=1ms (10 steps):', voltages[10].toFixed(4), 'V');
console.log('Cap Voltage at t=5ms (50 steps):', voltages[50].toFixed(4), 'V');
console.log('Cap Voltage at t=10ms (100 steps):', voltages[99].toFixed(4), 'V');

const vTheoretical10ms = 5.0 * (1.0 - Math.exp(-0.010 / 0.010));
console.log('Theoretical V(10ms):', vTheoretical10ms.toFixed(4), 'V');

const fftRes = FFT.analyze(voltages, 10000);
console.log('FFT Analysis completed. Peak Frequency:', fftRes.peakFreq, 'Hz');

if (Math.abs(voltages[99] - vTheoretical10ms) < 0.1) {
    console.log('✅ Power Rail Jumper Wire Bridge MNA Simulation VERIFIED SUCCESS!');
} else {
    console.error('❌ Math Discrepancy detected!');
}
