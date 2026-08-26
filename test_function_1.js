import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { CircuitSerializer } from './src/components/CircuitSerializer.js';

const jsonContent = {
  "version": "1.0",
  "savedAt": "2026-08-26T03:45:16.709Z",
  "title": "Function_1",
  "power": { "voltageVa": 12, "voltageVb": 0, "voltageVc": -12 },
  "probes": { "probeAPin": "B4_I26", "probeBPin": "B1_I47", "probeCPin": "B2_J48", "probeDPin": "BINDING_Vc" },
  "components": [
    { "id": "DIODE_38", "type": "DIODE", "pinA": "B1_A30", "pinB": "B1_A25", "vForward": 0.7 },
    { "id": "RESISTOR_CATALOG_39", "type": "R", "pinA": "B1_D25", "pinB": "B1_G25", "resistance": 10000, "isConfigured": true },
    { "id": "RESISTOR_CATALOG_40", "type": "R", "pinA": "B1_J25", "pinB": "B2_A25", "resistance": 10000, "isConfigured": true },
    { "id": "CAPACITOR_CATALOG_44", "type": "C", "pinA": "B1_C25", "pinB": "B1_C30", "capacitance": 2.2e-8, "isConfigured": true, "capType": "MYLAR" },
    { "id": "WIRE_45", "type": "WIRE", "pinA": "B1_GND_L_30", "pinB": "B1_A30", "color": "#0984e3" },
    { "id": "WIRE_46", "type": "WIRE", "pinA": "B1_A30", "pinB": "B1_C30", "color": "#0984e3" },
    { "id": "CAPACITOR_CATALOG_47", "type": "C", "pinA": "B1_H25", "pinB": "B1_H30", "capacitance": 2.2e-8, "isConfigured": true, "capType": "MYLAR" },
    { "id": "WIRE_48", "type": "WIRE", "pinA": "B1_E30", "pinB": "B1_F30", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_52", "type": "R", "pinA": "B2_C27", "pinB": "B2_C31", "resistance": 1000, "isConfigured": true },
    { "id": "WIRE_53", "type": "WIRE", "pinA": "B2_GND_L_31", "pinB": "B2_A31", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_54", "type": "R", "pinA": "B2_H26", "pinB": "B2_H31", "resistance": 1000000, "isConfigured": true },
    { "id": "WIRE_55", "type": "WIRE", "pinA": "B2_E31", "pinB": "B2_F31", "color": "#0984e3" },
    { "id": "CAPACITOR_CATALOG_56", "type": "C", "pinA": "B2_H19", "pinB": "B2_H21", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
    { "id": "WIRE_57", "type": "WIRE", "pinA": "B2_I21", "pinB": "B2_I26", "color": "#0984e3" },
    { "id": "TRANSISTOR_CATALOG_61", "type": "BJT", "pinA": "B2_C23", "pinB": "B2_C27", "transType": "2SK30A", "pinEmitter": "B2_C23", "pinBase": "B2_C25", "pinCollector": "B2_C27", "polarity": "N-JFET" },
    { "id": "RESISTOR_CATALOG_62", "type": "R", "pinA": "B2_C6", "pinB": "B2_C10", "resistance": 6800, "isConfigured": true },
    { "id": "WIRE_63", "type": "WIRE", "pinA": "B2_D10", "pinB": "B2_D23", "color": "#0984e3" },
    { "id": "WIRE_64", "type": "WIRE", "pinA": "B2_VCC_L_6", "pinB": "B2_A6", "color": "#ef4444" },
    { "id": "WIRE_65", "type": "WIRE", "pinA": "B2_G19", "pinB": "B2_G10", "color": "#0984e3" },
    { "id": "WIRE_66", "type": "WIRE", "pinA": "B2_E10", "pinB": "B2_F10", "color": "#0984e3" },
    { "id": "WIRE_67", "type": "WIRE", "pinA": "B2_J26", "pinB": "B3_A26", "color": "#0984e3" },
    { "id": "CAPACITOR_CATALOG_68", "type": "C", "pinA": "B3_B26", "pinB": "B3_B31", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
    { "id": "WIRE_69", "type": "WIRE", "pinA": "B3_A31", "pinB": "B3_GND_L_31", "color": "#0984e3" },
    { "id": "WIRE_71", "type": "WIRE", "pinA": "B3_E26", "pinB": "B4_A26", "color": "#0984e3" },
    { "id": "IC_CATALOG_72", "type": "IC", "pinA": "B4_E24", "pinB": "B4_F27", "icType": "LF356" },
    { "id": "RESISTOR_CATALOG_73", "type": "R", "pinA": "B4_B25", "pinB": "B4_GND_L_25", "resistance": 8200, "isConfigured": true },
    { "id": "RESISTOR_CATALOG_74", "type": "POT", "pinA": "B4_A7", "pinB": "B4_A10", "totalResistance": 1000000, "ratio": 0.32 },
    { "id": "WIRE_75", "type": "WIRE", "pinA": "B4_B10", "pinB": "B4_B25", "color": "#0984e3" },
    { "id": "WIRE_76", "type": "WIRE", "pinA": "B4_E7", "pinB": "B4_G7", "color": "#0984e3" },
    { "id": "WIRE_77", "type": "WIRE", "pinA": "B4_H7", "pinB": "B4_H26", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_79", "type": "R", "pinA": "B1_A18", "pinB": "B1_A23", "resistance": 1000, "isConfigured": true },
    { "id": "WIRE_80", "type": "WIRE", "pinA": "B1_B23", "pinB": "B1_B25", "color": "#0984e3" },
    { "id": "WIRE_82", "type": "WIRE", "pinA": "B1_E2", "pinB": "B4_H2", "color": "#0984e3" },
    { "id": "WIRE_83", "type": "WIRE", "pinA": "B4_I2", "pinB": "B4_I7", "color": "#0984e3" },
    { "id": "WIRE_84", "type": "WIRE", "pinA": "B4_J25", "pinB": "B4_VCC_R_25", "color": "#ef4444" },
    { "id": "WIRE_85", "type": "WIRE", "pinA": "B4_A27", "pinB": "B3_VCC_R_27", "color": "#ef4444" },
    { "id": "WIRE_88", "type": "WIRE", "pinA": "B1_VCC_R_1", "pinB": "VCC_TOP1_11", "color": "#ef4444" },
    { "id": "WIRE_90", "type": "WIRE", "pinA": "B1_VCC_L_1", "pinB": "VCC_TOP1_1", "color": "#ef4444" },
    { "id": "WIRE_91", "type": "WIRE", "pinA": "B1_GND_L_1", "pinB": "GND_TOP1_2", "color": "#0984e3" },
    { "id": "WIRE_92", "type": "WIRE", "pinA": "B1_GND_R_1", "pinB": "GND_TOP1_12", "color": "#0984e3" },
    { "id": "WIRE_93", "type": "WIRE", "pinA": "B2_VCC_R_1", "pinB": "VCC_TOP1_25", "color": "#ef4444" },
    { "id": "WIRE_94", "type": "WIRE", "pinA": "B2_GND_R_1", "pinB": "GND_TOP1_26", "color": "#0984e3" },
    { "id": "WIRE_95", "type": "WIRE", "pinA": "B3_VCC_L_1", "pinB": "VCC_TOP1_29", "color": "#ef4444" },
    { "id": "WIRE_96", "type": "WIRE", "pinA": "B3_GND_L_1", "pinB": "GND_TOP1_29", "color": "#0984e3" },
    { "id": "WIRE_97", "type": "WIRE", "pinA": "VCC_TOP2_37", "pinB": "B3_VCC_R_1", "color": "#ef4444" },
    { "id": "WIRE_98", "type": "WIRE", "pinA": "B3_GND_R_1", "pinB": "GND_TOP1_38", "color": "#0984e3" },
    { "id": "WIRE_99", "type": "WIRE", "pinA": "VCC_TOP1_49", "pinB": "B4_VCC_R_1", "color": "#ef4444" },
    { "id": "WIRE_100", "type": "WIRE", "pinA": "GND_TOP1_50", "pinB": "B4_GND_R_1", "color": "#0984e3" },
    { "id": "WIRE_101", "type": "WIRE", "pinA": "BINDING_Va", "pinB": "VCC_TOP1_3", "color": "#ef4444" },
    { "id": "WIRE_102", "type": "WIRE", "pinA": "BINDING_Vc", "pinB": "VCC_TOP2_22", "color": "#ef4444" },
    { "id": "WIRE_103", "type": "WIRE", "pinA": "BINDING_GND", "pinB": "GND_TOP1_34", "color": "#ef4444" },
    { "id": "WIRE_104", "type": "WIRE", "pinA": "B1_B18", "pinB": "B1_B2", "color": "#0984e3" },
    { "id": "IC_CATALOG_62", "type": "IC", "pinA": "B1_E45", "pinB": "B1_F48", "icType": "LF356" },
    { "id": "WIRE_63", "type": "WIRE", "pinA": "B1_A46", "pinB": "B1_GND_L_46", "color": "#0984e3" },
    { "id": "RESISTOR_CATALOG_65", "type": "R", "pinA": "B1_B47", "pinB": "B1_B52", "resistance": 20000, "isConfigured": true },
    { "id": "WIRE_66", "type": "WIRE", "pinA": "B1_E52", "pinB": "B1_G52", "color": "#0984e3" },
    { "id": "WIRE_67", "type": "WIRE", "pinA": "B1_H52", "pinB": "B1_H47", "color": "#0984e3" },
    { "id": "IC_CATALOG_69", "type": "IC", "pinA": "B2_E46", "pinB": "B2_F49", "icType": "LF356" },
    { "id": "RESISTOR_CATALOG_70", "type": "R", "pinA": "B1_J47", "pinB": "B2_A47", "resistance": 10000, "isConfigured": true },
    { "id": "RESISTOR_CATALOG_71", "type": "R", "pinA": "B1_A47", "pinB": "B1_A54", "resistance": 10000, "isConfigured": true },
    { "id": "WIRE_72", "type": "WIRE", "pinA": "B1_E54", "pinB": "B2_G54", "color": "#0984e3" },
    { "id": "WIRE_73", "type": "WIRE", "pinA": "B2_H54", "pinB": "B2_H48", "color": "#0984e3" },
    { "id": "CAPACITOR_CATALOG_74", "type": "C", "pinA": "B2_C41", "pinB": "B2_H41", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
    { "id": "WIRE_75", "type": "WIRE", "pinA": "B2_B41", "pinB": "B2_B47", "color": "#0984e3" },
    { "id": "WIRE_76", "type": "WIRE", "pinA": "B2_I41", "pinB": "B2_I48", "color": "#0984e3" },
    { "id": "WIRE_77", "type": "WIRE", "pinA": "B1_J46", "pinB": "B1_VCC_R_46", "color": "#ef4444" },
    { "id": "WIRE_78", "type": "WIRE", "pinA": "B2_J47", "pinB": "B2_VCC_R_47", "color": "#ef4444" },
    { "id": "WIRE_79", "type": "WIRE", "pinA": "B2_C49", "pinB": "B2_C58", "color": "#0984e3" },
    { "id": "WIRE_80", "type": "WIRE", "pinA": "B2_E58", "pinB": "B3_VCC_R_58", "color": "#ef4444" },
    { "id": "WIRE_81", "type": "WIRE", "pinA": "B1_C48", "pinB": "B1_C58", "color": "#0984e3" },
    { "id": "WIRE_82", "type": "WIRE", "pinA": "B1_E58", "pinB": "B2_A58", "color": "#0984e3" }
  ]
};

const restored = CircuitSerializer.deserialize(jsonContent);
const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

const activeComps = [
    ...restored.components,
    new (restored.components[0].constructor)('SRC_VA', 'VDC', 'BINDING_Va', 'BINDING_GND')
];

console.log('Successfully loaded Function_1 circuit with', restored.components.length, 'components.');
console.log('Probes:', restored.probes);
