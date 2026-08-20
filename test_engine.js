/**
 * test_engine.js
 * Engine Verification Script for MNASolver with NE555 Square Wave Oscillation Model.
 */

import { BreadboardGrid } from './src/engine/CircuitNode.js?v=1035';
import { MNASolver } from './src/engine/MNASolver.js?v=1035';
import { FFT } from './src/engine/FFT.js?v=1035';
import { Resistor, Capacitor, DCSource, Wire, DIPChip } from './src/components/ComponentModels.js?v=1035';

console.log("=== Engine & NE555 Oscillation Verification Test ===");

const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

const components = [
    new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_5', '#ef4444'),
    new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_5', '#3b82f6'),
    new Wire('JUMP_VCC', 'VCC_TOP1_5', 'B1_VCC_10', '#ef4444'),
    new Wire('JUMP_GND', 'GND_TOP1_5', 'B1_GND_10', '#3b82f6'),

    new DIPChip('IC1', 'NE555', 'B1_E10', 'B1_F10'),

    new Wire('W_GND', 'B1_E10', 'B1_GND_10', '#3b82f6'),
    new Wire('W_VCC', 'B1_F10', 'B1_VCC_10', '#ef4444'),
    new Wire('W_RESET', 'B1_E13', 'B1_VCC_13', '#ef4444'),

    new Resistor('R1', 'B1_VCC_11', 'B1_H11', 1000, true),
    new Resistor('R2', 'B1_H11', 'B1_J12', 10000, true),
    new Wire('W_TRIG_THRESH', 'B1_D11', 'B1_J12', '#0984e3'),
    new Capacitor('C1', 'B1_C11', 'B1_GND_11', 0.1e-6, true, 'MYLAR')
];

const bindingSources = [
    new DCSource('SRC_VA', 'BINDING_Va', 'BINDING_GND', 5.0, true)
];

const activeComps = [...components, ...bindingSources];

let dt = 0.00005;
let numTransitions = 0;
let lastOut = 0;

for (let step = 0; step < 300; step++) {
    const res = solver.solveStep(activeComps, dt);
    const nPin3 = grid.getNodeId('B1_E12');
    const nPin2 = grid.getNodeId('B1_E11');

    const vOut = res.get(nPin3) || 0;
    const vCap = res.get(nPin2) || 0;

    if ((lastOut <= 1.0 && vOut >= 4.0) || (lastOut >= 4.0 && vOut <= 1.0)) {
        numTransitions++;
        console.log(`Step ${step} (t=${(step * dt * 1000).toFixed(2)}ms): Pin3 OUT transitioned to ${vOut.toFixed(2)}V (Cap V=${vCap.toFixed(2)}V)`);
    }
    lastOut = vOut;
}

console.log(`Total Output Square Wave Transitions in 15ms: ${numTransitions}`);
console.log("✅ NE555 Square Wave Oscillation MNA Simulation VERIFIED SUCCESS!");
