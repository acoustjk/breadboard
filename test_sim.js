import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { Resistor, Capacitor, DCSource, Wire, DIPChip, Potentiometer, ZenerDiode } from './src/components/ComponentModels.js';

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

    new DCSource('SRC_VA', 'BINDING_Va', 'BINDING_GND', 12.0, true),
    new DCSource('SRC_VB', 'BINDING_Vb', 'BINDING_GND', 0.0, true),
    new DCSource('SRC_VC', 'BINDING_Vc', 'BINDING_GND', -12.0, true)
];

const pinTP1 = 'B3_F18';
const nodeTP1 = grid.getNodeId(pinTP1);

console.log('Target TP1 Pin:', pinTP1, '-> Node ID:', nodeTP1);

const samples = [];
const dt = 0.000005;

for (let i = 0; i < 5000; i++) {
    const res = solver.solveStep(components, dt);
    const v = res.get(nodeTP1) || 0;
    samples.push(v);
}

const last200 = samples.slice(-200);
let minV = Math.min(...last200);
let maxV = Math.max(...last200);
console.log(`TP1 Min: ${minV.toFixed(3)}V, Max: ${maxV.toFixed(3)}V, Vpp: ${(maxV - minV).toFixed(3)}V`);
console.log('Sample sequence (first 25 of last 200):');
console.log(last200.slice(0, 25).map(x => x.toFixed(2)).join(', '));
