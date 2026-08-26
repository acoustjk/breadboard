import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { Wire, Resistor, Capacitor, DIPChip, Potentiometer, ZenerDiode, Diode, DCSource, BJTTransistor } from './src/components/ComponentModels.js';

const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

console.log('===================================================');
console.log('🧪 HYBRID SIMULATOR FULL SUITE SELF-VERIFICATION 🧪');
console.log('===================================================');

// 1. VERIFY EXAM PRESET 1 (U1 Sine, U3 Square, U2 Square, Q1 PNM)
console.log('\n--- 1. Testing Exam Preset (PNM / Phase-Shift) ---');

const examComps = [
    new Wire('W_VCC_TOP', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
    new Wire('W_GND_TOP', 'BINDING_GND', 'GND_TOP1_50', '#3b82f6'),

    new Wire('W_B1_VCC', 'VCC_TOP1_1', 'B1_VCC_L_10', '#ef4444'),
    new Wire('W_B1_GND', 'GND_TOP1_1', 'B1_GND_L_10', '#3b82f6'),
    new Wire('W_B2_VCC', 'VCC_TOP1_25', 'B2_VCC_R_10', '#ef4444'),
    new Wire('W_B2_GND', 'GND_TOP1_25', 'B2_GND_R_10', '#3b82f6'),

    new Capacitor('C_PS1', 'B1_C15', 'B1_D15', 0.01e-6, true, 'MYLAR'),
    new Resistor('R_PS1', 'B1_E15', 'B1_GND_L_15', 4700, true),
    new Wire('W_PS1_2', 'B1_E15', 'B1_H15', '#0984e3'),

    new Capacitor('C_PS2', 'B2_C15', 'B2_D15', 0.01e-6, true, 'MYLAR'),
    new Resistor('R_PS2', 'B2_E15', 'B2_GND_L_15', 4700, true),
    new Wire('W_PS2_3', 'B2_E15', 'B2_H15', '#0984e3'),

    new Capacitor('C_PS3', 'B2_I15', 'B2_J15', 0.01e-6, true, 'MYLAR'),
    new Resistor('R_PS3', 'B3_A17', 'B3_GND_L_17', 4700, true),
    new Wire('W_PS3_U1', 'B2_J15', 'B3_A17', '#0984e3'),
    new Resistor('R_IN1', 'B3_B17', 'B3_C17', 10000, true),

    new DIPChip('U1', 'LF356', 'B3_E16', 'B3_F16'),
    new Potentiometer('VR1', 'B3_C11', 'B3_C17', 1000000, 0.4),
    new Wire('W_VR1_OUT', 'B3_C11', 'B3_F18', '#e67e22'), // Directly to Pin 6 (B3_F18)
    new Resistor('R_GND_IN3', 'B3_F18', 'B3_GND_L_18', 10000, true),

    new Wire('W_U1_VCC', 'B3_VCC_L_17', 'B3_F17', '#ef4444'),
    new Wire('W_U1_VEE', 'B3_GND_L_19', 'B3_E19', '#3b82f6'),

    new ZenerDiode('ZD1', 'B3_G18', 'B3_G21', 9.1),
    new ZenerDiode('ZD2', 'B3_G21', 'B3_G24', 9.1),
    new Wire('W_ZD_GND', 'B3_G24', 'B3_GND_L_24', '#00b894'),
    new Wire('W_FB_LOOP', 'B3_F18', 'B1_C15', '#9b59b6'), // Directly from Pin 6 (B3_F18)

    new DIPChip('U2', 'LF356', 'B4_E16', 'B4_F16'),
    new DIPChip('U3', 'LF356', 'B3_E45', 'B3_F45'),
    new Potentiometer('VR2', 'B3_C40', 'B3_C46', 50000, 0.5),
    new Resistor('R_FB3', 'B3_C46', 'B3_F47', 100000, true), // Directly to Pin 6 (B3_F47)
    new Capacitor('C_INT3', 'B3_C46', 'B3_GND_L_46', 0.1e-6, true, 'CERAMIC'),
    new Wire('W_VR2_OUT', 'B3_C40', 'B3_F47', '#e67e22'),

    new Wire('W_U3_VCC', 'B3_VCC_L_46', 'B3_F46', '#ef4444'),
    new Wire('W_U3_VEE', 'B3_GND_L_48', 'B3_E48', '#3b82f6'),

    new BJTTransistor('Q1', '2SK30A', 'B4_H26', 'B4_H28', 'B4_H27'),
    new Resistor('R_BASE', 'B3_F47', 'B4_C28', 1000, true), // Directly from U3 Pin 6 (B3_F47)
    new Wire('W_BASE_Q1', 'B4_C28', 'B4_G28', '#0984e3'),
    new Wire('W_EMIT_GND', 'B4_G26', 'B4_GND_R_26', '#00b894'),
    new Resistor('R_PULL5K', 'B4_F18', 'B4_G27', 5100, true),
    new Diode('D_1N4148', 'B4_G27', 'B4_GND_R_27', '1N4148')
];

const power = [
    new DCSource('SRC_VA', 'BINDING_Va', 'BINDING_GND', 12.0, true),
    new DCSource('SRC_VB', 'BINDING_Vb', 'BINDING_GND', 0.0, true),
    new DCSource('SRC_VC', 'BINDING_Vc', 'BINDING_GND', -12.0, true)
];

const activeExam = [...examComps, ...power];

const nU1 = grid.getNodeId('B3_F18');
const nU3 = grid.getNodeId('B3_F47');
const nQ1 = grid.getNodeId('B4_G27');

const samplesU1 = [];
const samplesU3 = [];
const samplesQ1 = [];

for (let i = 0; i < 3000; i++) {
    const res = solver.solveStep(activeExam, 0.000005);
    if (i > 2500) {
        samplesU1.push(res.get(nU1) || 0);
        samplesU3.push(res.get(nU3) || 0);
        samplesQ1.push(res.get(nQ1) || 0);
    }
}

const vppU1 = Math.max(...samplesU1) - Math.min(...samplesU1);
const vppU3 = Math.max(...samplesU3) - Math.min(...samplesU3);
const vppQ1 = Math.max(...samplesQ1) - Math.min(...samplesQ1);

console.log(`TP1 U1 (Sine Wave Target):  Min: ${Math.min(...samplesU1).toFixed(2)}V, Max: ${Math.max(...samplesU1).toFixed(2)}V, Vpp: ${vppU1.toFixed(2)}V`);
console.log(`TP2 U3 (Square Wave Target): Min: ${Math.min(...samplesU3).toFixed(2)}V, Max: ${Math.max(...samplesU3).toFixed(2)}V, Vpp: ${vppU3.toFixed(2)}V`);
console.log(`TP3 Q1 (PNM Pulse Target):  Min: ${Math.min(...samplesQ1).toFixed(2)}V, Max: ${Math.max(...samplesQ1).toFixed(2)}V, Vpp: ${vppQ1.toFixed(2)}V`);

const isU1Pass = vppU1 > 5.0 && vppU1 < 10.0;
const isU3Pass = vppU3 > 10.0;
const isQ1Pass = vppQ1 > 10.0;

console.log(`\nALL PRESET CHANNELS VERIFICATION: U1(Sine): ${isU1Pass ? 'PASS ✅' : 'FAIL ❌'} | U3(Square): ${isU3Pass ? 'PASS ✅' : 'FAIL ❌'} | Q1(PNM): ${isQ1Pass ? 'PASS ✅' : 'FAIL ❌'}`);
