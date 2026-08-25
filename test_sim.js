import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { Resistor, Capacitor, DCSource, Wire, DIPChip, Potentiometer, ZenerDiode, Diode } from './src/components/ComponentModels.js';

const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

const components = [
    new Wire('W_VA_JACK', 'BINDING_Va', 'B2_VCC_L_1', '#ef4444'),
    new Wire('W_VC_JACK', 'BINDING_Vc', 'B3_GND_R_1', '#00b894'),
    new Wire('W_GND_JACK', 'BINDING_GND', 'B4_GND_R_1', '#3b82f6'),

    new Wire('JUMP_TOP_B1_L', 'VCC_TOP1_5', 'B1_VCC_L_1', '#ef4444'),
    new Wire('JUMP_B1_R_B2_L', 'B1_VCC_R_1', 'B2_VCC_L_1', '#ef4444'),
    new Wire('JUMP_B2_R_B3_L', 'B2_VCC_R_1', 'B3_VCC_L_1', '#ef4444'),
    new Wire('JUMP_B3_R_B4_L', 'B3_VCC_R_1', 'B4_VCC_L_1', '#ef4444'),

    new Wire('JUMP_NEG_B3_B4', 'B3_GND_R_1', 'B4_GND_L_1', '#00b894'),
    new Wire('JUMP_GND_B4_TOP', 'B4_GND_R_1', 'GND_TOP1_50', '#3b82f6'),

    new Wire('JUMP_B1_GND_LR', 'B1_GND_L_1', 'B1_GND_R_1', '#3b82f6'),
    new Wire('JUMP_B2_GND_LR', 'B2_GND_L_1', 'B2_GND_R_1', '#3b82f6'),

    new Resistor('R1_PULL', 'B1_VCC_L_7', 'B1_A7', 10000, true),
    new Resistor('R1_SERIES', 'B1_B7', 'B1_B18', 10000, true),
    new Capacitor('C1_1', 'B1_C18', 'B1_D18', 0.01e-6, true, 'MYLAR'),
    new Resistor('R1_1', 'B1_E18', 'B1_GND_L_18', 4700, true),
    new Wire('W_STAGE1_2', 'B1_E18', 'B2_A18', '#0984e3'),

    new Capacitor('C1_2', 'B2_C18', 'B2_D18', 0.01e-6, true, 'MYLAR'),
    new Resistor('R1_2', 'B2_E18', 'B2_GND_L_18', 4700, true),
    new Wire('W_STAGE2_3', 'B2_E18', 'B3_A18', '#0984e3'),

    new Capacitor('C1_3', 'B3_C18', 'B3_D18', 0.01e-6, true, 'MYLAR'),
    new Resistor('R1_3', 'B3_E18', 'B3_GND_L_18', 4700, true),
    new Capacitor('C1_4', 'B3_E18', 'B3_A19', 0.01e-6, true, 'MYLAR'),

    new DIPChip('U1', 'LF356', 'B3_E16', 'B3_F16'),
    new Potentiometer('VR1', 'B3_A10', 'B3_C12', 1000000, 0.35),
    new Resistor('R1_IN', 'B3_B17', 'B3_C17', 10000, true),
    new Resistor('R1_GND', 'B3_B18', 'B3_GND_L_18', 10000, true),
    new Wire('W_VR1_FB', 'B3_C12', 'B3_D17', '#e67e22'),

    new Wire('W_U1_VPOS', 'B3_VCC_L_17', 'B3_F17', '#ef4444'),
    new Wire('W_U1_VNEG', 'B3_GND_L_19', 'B3_E19', '#00b894'),

    new ZenerDiode('ZD1', 'B3_F18', 'B3_F22', 9.1, 0.7),
    new ZenerDiode('ZD2', 'B3_F22', 'B3_GND_R_22', 9.1, 0.7),

    new Wire('W_OSC_FB', 'B3_F18', 'B1_C18', '#e74c3c'),
    new Wire('W_VR1_OUT', 'B3_C12', 'B3_F18', '#f39c12'),

    new DIPChip('U3', 'LF356', 'B3_E38', 'B3_F38'),
    new Potentiometer('VR2', 'B3_A33', 'B3_C35', 50000, 0.5),

    new DCSource('SRC_VA', 'BINDING_Va', 'BINDING_GND', 12.0, true),
    new DCSource('SRC_VB', 'BINDING_Vb', 'BINDING_GND', 0.0, true),
    new DCSource('SRC_VC', 'BINDING_Vc', 'BINDING_GND', -12.0, true)
];

const nodeTP1 = grid.getNodeId('B3_F18');
const nodeTP2 = grid.getNodeId('B3_F40');

const samplesTP1 = [];
const samplesTP2 = [];
const dt = 0.000005;

for (let i = 0; i < 5000; i++) {
    const res = solver.solveStep(components, dt);
    samplesTP1.push(res.get(nodeTP1) || 0);
    samplesTP2.push(res.get(nodeTP2) || 0);
}

const last20_TP1 = samplesTP1.slice(-20);
const last20_TP2 = samplesTP2.slice(-20);

console.log('=== TP1 (U1) Sine Wave Verification ===');
console.log('TP1 Min:', Math.min(...samplesTP1.slice(-200)).toFixed(2), 'Max:', Math.max(...samplesTP1.slice(-200)).toFixed(2));
console.log('TP1 Samples:', last20_TP1.map(x => x.toFixed(2)).join(', '));

console.log('\n=== TP2 (U3) Square Wave Verification ===');
console.log('TP2 Min:', Math.min(...samplesTP2.slice(-200)).toFixed(2), 'Max:', Math.max(...samplesTP2.slice(-200)).toFixed(2));
console.log('TP2 Samples:', last20_TP2.map(x => x.toFixed(2)).join(', '));
