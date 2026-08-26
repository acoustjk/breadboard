import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { CircuitSerializer } from './src/components/CircuitSerializer.js';

const jsonContent = {
  "version": "1.0",
  "savedAt": "2026-08-25T07:18:13.274Z",
  "title": "PNM_P",
  "power": { "voltageVa": 12, "voltageVb": 0, "voltageVc": -12 },
  "probes": { "probeAPin": "B3_I17", "probeBPin": "B2_I42", "probeCPin": "B3_D40", "probeDPin": "GND_TOP1_46" },
  "components": [
    { "id": "IC_CATALOG_1", "type": "IC", "pinA": "B3_E15", "pinB": "B3_F18", "icType": "LF356" },
    { "id": "IC_CATALOG_2", "type": "IC", "pinA": "B4_E16", "pinB": "B4_F19", "icType": "LF356" },
    { "id": "RESISTOR_CATALOG_3", "type": "R", "pinA": "B2_J16", "pinB": "B3_A16", "resistance": 10000, "isConfigured": true },
    { "id": "CAPACITOR_CATALOG_4", "type": "C", "pinA": "B2_G16", "pinB": "B2_D16", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
    { "id": "CAPACITOR_CATALOG_5", "type": "C", "pinA": "B2_A16", "pinB": "B1_J16", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
    { "id": "CAPACITOR_CATALOG_6", "type": "C", "pinA": "B1_D16", "pinB": "B1_G16", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
    { "id": "RESISTOR_CATALOG_7", "type": "R", "pinA": "B1_I16", "pinB": "B1_I22", "resistance": 4700, "isConfigured": true },
    { "id": "RESISTOR_CATALOG_8", "type": "R", "pinA": "B2_B16", "pinB": "B2_B22", "resistance": 4700, "isConfigured": true },
    { "id": "RESISTOR_CATALOG_9", "type": "R", "pinA": "B2_H16", "pinB": "B2_H22", "resistance": 4700, "isConfigured": true },
    { "id": "WIRE_10", "type": "WIRE", "pinA": "B1_J22", "pinB": "B1_GND_R_22", "color": "#0984e3" },
    { "id": "WIRE_11", "type": "WIRE", "pinA": "B2_A22", "pinB": "B2_GND_L_22", "color": "#0984e3" },
    { "id": "WIRE_12", "type": "WIRE", "pinA": "B2_J22", "pinB": "B2_GND_R_22", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_13", "type": "POT", "pinA": "B2_A5", "pinB": "B2_A9", "totalResistance": 1000000, "ratio": 0.5 },
    { "id": "RESISTOR_CATALOG_14", "type": "R", "pinA": "B3_B17", "pinB": "B3_GND_L_17", "resistance": 10000, "isConfigured": true },
    { "id": "ZENER_15", "type": "ZENER", "pinA": "B3_I24", "pinB": "B3_I21", "vZener": 9.1, "vForward": 0.7 },
    { "id": "ZENER_16", "type": "ZENER", "pinA": "B3_J24", "pinB": "B3_J28", "vZener": 9.1, "vForward": 0.7 },
    { "id": "WIRE_17", "type": "WIRE", "pinA": "B3_J28", "pinB": "B3_GND_R_28", "color": "#0984e3" },
    { "id": "CAPACITOR_CATALOG_18", "type": "C", "pinA": "B3_J17", "pinB": "B4_A17", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
    { "id": "RESISTOR_CATALOG_19", "type": "R", "pinA": "B4_B17", "pinB": "B4_B23", "resistance": 1000000, "isConfigured": true },
    { "id": "WIRE_20", "type": "WIRE", "pinA": "B4_GND_L_23", "pinB": "B4_A23", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_21", "type": "R", "pinA": "B4_C18", "pinB": "B4_C23", "resistance": 1000000, "isConfigured": true },
    { "id": "WIRE_22", "type": "WIRE", "pinA": "B1_C16", "pinB": "B1_C5", "color": "#0984e3" },
    { "id": "WIRE_23", "type": "WIRE", "pinA": "B1_E5", "pinB": "B1_G5", "color": "#0984e3" },
    { "id": "WIRE_24", "type": "WIRE", "pinA": "B1_I5", "pinB": "B2_A5", "color": "#0984e3" },
    { "id": "WIRE_25", "type": "WIRE", "pinA": "B2_B5", "pinB": "B3_G5", "color": "#0984e3" },
    { "id": "WIRE_26", "type": "WIRE", "pinA": "B3_H5", "pinB": "B3_H17", "color": "#0984e3" },
    { "id": "WIRE_27", "type": "WIRE", "pinA": "B2_E9", "pinB": "B3_B9", "color": "#0984e3" },
    { "id": "WIRE_28", "type": "WIRE", "pinA": "B3_C9", "pinB": "B3_C16", "color": "#0984e3" },
    { "id": "IC_CATALOG_29", "type": "IC", "pinA": "B2_E40", "pinB": "B2_F43", "icType": "LF356" },
    { "id": "RESISTOR_CATALOG_30", "type": "POT", "pinA": "B1_J35", "pinB": "B1_J39", "totalResistance": 50000, "ratio": 0.5 },
    { "id": "CAPACITOR_CATALOG_31", "type": "C", "pinA": "B2_B41", "pinB": "B2_GND_L_41", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
    { "id": "WIRE_32", "type": "WIRE", "pinA": "B1_J35", "pinB": "B2_H35", "color": "#0984e3" },
    { "id": "WIRE_33", "type": "WIRE", "pinA": "B2_I35", "pinB": "B2_I42", "color": "#0984e3" },
    { "id": "WIRE_34", "type": "WIRE", "pinA": "B1_J39", "pinB": "B2_C39", "color": "#0984e3" },
    { "id": "WIRE_35", "type": "WIRE", "pinA": "B2_C39", "pinB": "B2_C41", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_36", "type": "R", "pinA": "B2_B42", "pinB": "B2_GND_L_42", "resistance": 10000, "isConfigured": true },
    { "id": "WIRE_37", "type": "WIRE", "pinA": "B2_C42", "pinB": "B2_C49", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_38", "type": "R", "pinA": "B2_D49", "pinB": "B2_G49", "resistance": 10000, "isConfigured": true },
    { "id": "WIRE_39", "type": "WIRE", "pinA": "B2_I49", "pinB": "B2_I42", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_40", "type": "R", "pinA": "B2_J42", "pinB": "B3_A42", "resistance": 1000, "isConfigured": true },
    { "id": "TRANSISTOR_CATALOG_45", "type": "BJT", "pinA": "B3_C37", "pinB": "B3_C40", "transType": "C1815", "pinEmitter": "B3_C37", "pinBase": "B3_C42", "pinCollector": "B3_C40", "polarity": "NPN" },
    { "id": "WIRE_46", "type": "WIRE", "pinA": "B3_GND_L_37", "pinB": "B3_B37", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_47", "type": "R", "pinA": "B3_D40", "pinB": "B3_G40", "resistance": 5100, "isConfigured": true },
    { "id": "WIRE_48", "type": "WIRE", "pinA": "B3_I40", "pinB": "B4_G40", "color": "#0984e3" },
    { "id": "WIRE_49", "type": "WIRE", "pinA": "B4_H40", "pinB": "B4_H18", "color": "#0984e3" },
    { "id": "DIODE_50", "type": "DIODE", "pinA": "B4_GND_R_18", "pinB": "B4_I18", "vForward": 0.7 },
    { "id": "WIRE_51", "type": "WIRE", "pinA": "B3_I16", "pinB": "B3_I3", "color": "#0984e3" },
    { "id": "WIRE_52", "type": "WIRE", "pinA": "B3_H3", "pinB": "B3_VCC_L_3", "color": "#ef4444" },
    { "id": "WIRE_53", "type": "WIRE", "pinA": "B4_J17", "pinB": "B4_VCC_R_17", "color": "#ef4444" },
    { "id": "WIRE_54", "type": "WIRE", "pinA": "B2_J41", "pinB": "B2_VCC_R_41", "color": "#ef4444" },
    { "id": "WIRE_55", "type": "WIRE", "pinA": "B3_C18", "pinB": "B3_C31", "color": "#0984e3" },
    { "id": "WIRE_56", "type": "WIRE", "pinA": "B3_D31", "pinB": "B3_VCC_R_31", "color": "#ef4444" },
    { "id": "WIRE_57", "type": "WIRE", "pinA": "B4_A19", "pinB": "B3_VCC_R_19", "color": "#ef4444" },
    { "id": "WIRE_58", "type": "WIRE", "pinA": "B2_B43", "pinB": "B2_B55", "color": "#0984e3" },
    { "id": "WIRE_59", "type": "WIRE", "pinA": "B2_C55", "pinB": "B3_VCC_R_55", "color": "#ef4444" },
    { "id": "WIRE_60", "type": "WIRE", "pinA": "VCC_TOP1_1", "pinB": "B1_VCC_L_1", "color": "#ef4444" },
    { "id": "WIRE_61", "type": "WIRE", "pinA": "GND_TOP1_1", "pinB": "B1_GND_L_1", "color": "#0984e3" },
    { "id": "WIRE_62", "type": "WIRE", "pinA": "VCC_TOP1_11", "pinB": "B1_VCC_R_1", "color": "#ef4444" },
    { "id": "WIRE_63", "type": "WIRE", "pinA": "GND_TOP1_12", "pinB": "B1_GND_R_1", "color": "#0984e3" },
    { "id": "WIRE_64", "type": "WIRE", "pinA": "VCC_TOP1_14", "pinB": "B2_VCC_L_1", "color": "#ef4444" },
    { "id": "WIRE_65", "type": "WIRE", "pinA": "GND_TOP1_15", "pinB": "B2_GND_L_1", "color": "#0984e3" },
    { "id": "WIRE_66", "type": "WIRE", "pinA": "VCC_TOP1_24", "pinB": "B2_VCC_R_1", "color": "#ef4444" },
    { "id": "WIRE_67", "type": "WIRE", "pinA": "GND_TOP1_25", "pinB": "B2_GND_R_1", "color": "#0984e3" },
    { "id": "WIRE_68", "type": "WIRE", "pinA": "VCC_TOP1_27", "pinB": "B3_VCC_L_1", "color": "#ef4444" },
    { "id": "WIRE_69", "type": "WIRE", "pinA": "GND_TOP1_28", "pinB": "B3_GND_L_1", "color": "#0984e3" },
    { "id": "WIRE_70", "type": "WIRE", "pinA": "VCC_TOP2_37", "pinB": "B3_VCC_R_1", "color": "#ef4444" },
    { "id": "WIRE_71", "type": "WIRE", "pinA": "GND_TOP1_38", "pinB": "B3_GND_R_1", "color": "#0984e3" },
    { "id": "WIRE_72", "type": "WIRE", "pinA": "VCC_TOP1_40", "pinB": "B4_VCC_L_1", "color": "#ef4444" },
    { "id": "WIRE_73", "type": "WIRE", "pinA": "GND_TOP1_41", "pinB": "B4_GND_L_1", "color": "#0984e3" },
    { "id": "WIRE_74", "type": "WIRE", "pinA": "VCC_TOP1_49", "pinB": "B4_VCC_R_1", "color": "#ef4444" },
    { "id": "WIRE_75", "type": "WIRE", "pinA": "GND_TOP2_50", "pinB": "B4_GND_R_1", "color": "#0984e3" },
    { "id": "WIRE_76", "type": "WIRE", "pinA": "BINDING_Va", "pinB": "VCC_TOP1_3", "color": "#ef4444" },
    { "id": "WIRE_77", "type": "WIRE", "pinA": "BINDING_Vc", "pinB": "VCC_TOP2_20", "color": "#ef4444" },
    { "id": "WIRE_78", "type": "WIRE", "pinA": "BINDING_GND", "pinB": "GND_TOP1_32", "color": "#ef4444" }
  ]
};

const restored = CircuitSerializer.deserialize(jsonContent);
const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

const activeComps = [
    ...restored.components,
    new (restored.components[0].constructor)('SRC_VA', 'BINDING_Va', 'BINDING_GND')
];

let minA = Infinity, maxA = -Infinity;
let minB = Infinity, maxB = -Infinity;
let minC = Infinity, maxC = -Infinity;

for (let t = 0; t < 2000; t++) {
    const res = solver.solveStep(activeComps, 0.000005);
    const nA = grid.getNodeId('B3_I17');
    const nB = grid.getNodeId('B2_I42');
    const nC = grid.getNodeId('B3_D40');

    const vA = res.get(nA) || 0;
    const vB = res.get(nB) || 0;
    const vC = res.get(nC) || 0;

    if (vA < minA) minA = vA; if (vA > maxA) maxA = vA;
    if (vB < minB) minB = vB; if (vB > maxB) maxB = vB;
    if (vC < minC) minC = vC; if (vC > maxC) maxC = vC;
}

console.log('CH A (B3_I17): Min:', minA.toFixed(2) + 'V, Max:', maxA.toFixed(2) + 'V, Vpp:', (maxA - minA).toFixed(2) + 'V (Sine Wave)');
console.log('CH B (B2_I42): Min:', minB.toFixed(2) + 'V, Max:', maxB.toFixed(2) + 'V, Vpp:', (maxB - minB).toFixed(2) + 'V (Square Wave)');
console.log('CH C (B3_D40): Min:', minC.toFixed(2) + 'V, Max:', maxC.toFixed(2) + 'V, Vpp:', (maxC - minC).toFixed(2) + 'V (PNM Pulse)');
