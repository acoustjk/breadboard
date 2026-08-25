import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { Wire, Resistor, Capacitor, DIPChip, Potentiometer, ZenerDiode, Diode, DCSource, BJTTransistor } from './src/components/ComponentModels.js';

const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

const comps = [
    new Diode('DIODE_38', 'B1_A30', 'B1_A25', 0.7),
    new Resistor('RESISTOR_CATALOG_39', 'B1_D25', 'B1_G25', 10000, true),
    new Resistor('RESISTOR_CATALOG_40', 'B1_J25', 'B2_A25', 10000, true),
    new Capacitor('CAPACITOR_CATALOG_44', 'B1_C25', 'B1_C30', 2.2e-8, true, 'MYLAR'),
    new Wire('WIRE_45', 'B1_GND_L_30', 'B1_A30', '#0984e3'),
    new Wire('WIRE_46', 'B1_A30', 'B1_C30', '#0984e3'),
    new Capacitor('CAPACITOR_CATALOG_47', 'B1_H25', 'B1_H30', 2.2e-8, true, 'MYLAR'),
    new Wire('WIRE_48', 'B1_E30', 'B1_F30', '#0984e3'),
    new Resistor('RESISTOR_CATALOG_52', 'B2_C27', 'B2_C31', 1000, true),
    new Wire('WIRE_53', 'B2_GND_L_31', 'B2_A31', '#0984e3'),
    new Resistor('RESISTOR_CATALOG_54', 'B2_H26', 'B2_H31', 1000000, true),
    new Wire('WIRE_55', 'B2_E31', 'B2_F31', '#0984e3'),
    new Capacitor('CAPACITOR_CATALOG_56', 'B2_H19', 'B2_H21', 1e-7, true, 'MYLAR'),
    new Wire('WIRE_57', 'B2_I21', 'B2_I26', '#0984e3'),
    new BJTTransistor('TRANSISTOR_CATALOG_61', '2SK30A', 'B2_C23', 'B2_C25', 'B2_C27'),
    new Resistor('RESISTOR_CATALOG_62', 'B2_C6', 'B2_C10', 6800, true),
    new Wire('WIRE_63', 'B2_D10', 'B2_D23', '#0984e3'),
    new Wire('WIRE_64', 'B2_VCC_L_6', 'B2_A6', '#ef4444'),
    new Wire('WIRE_65', 'B2_G19', 'B2_G10', '#0984e3'),
    new Wire('WIRE_66', 'B2_E10', 'B2_F10', '#0984e3'),
    new Wire('WIRE_67', 'B2_J26', 'B3_A26', '#0984e3'),
    new Capacitor('CAPACITOR_CATALOG_68', 'B3_B26', 'B3_B31', 1e-7, true, 'MYLAR'),
    new Wire('WIRE_69', 'B3_A31', 'B3_GND_L_31', '#0984e3'),
    new Wire('WIRE_71', 'B3_E26', 'B4_A26', '#0984e3'),
    new DIPChip('IC_CATALOG_72', 'LF356', 'B4_E24', 'B4_F29'),
    new Resistor('RESISTOR_CATALOG_73', 'B4_B25', 'B4_GND_L_25', 8200, true),
    new Potentiometer('RESISTOR_CATALOG_74', 'B4_A7', 'B4_A10', 1000000, 0.32),
    new Wire('WIRE_75', 'B4_B10', 'B4_B25', '#0984e3'),
    new Wire('WIRE_76', 'B4_E7', 'B4_G7', '#0984e3'),
    new Wire('WIRE_77', 'B4_H7', 'B4_H26', '#0984e3'),
    new Resistor('RESISTOR_CATALOG_79', 'B1_A18', 'B1_A23', 1000, true),
    new Wire('WIRE_80', 'B1_B23', 'B1_B25', '#0984e3'),
    new Wire('WIRE_82', 'B1_E2', 'B4_H2', '#0984e3'),
    new Wire('WIRE_83', 'B4_I2', 'B4_I7', '#0984e3'),
    new Wire('WIRE_84', 'B4_J25', 'B4_VCC_R_25', '#ef4444'),
    new Wire('WIRE_85', 'B4_A27', 'B3_VCC_R_27', '#ef4444'),
    new Wire('WIRE_88', 'B1_VCC_R_1', 'VCC_TOP1_11', '#ef4444'),
    new Wire('WIRE_90', 'B1_VCC_L_1', 'VCC_TOP1_1', '#ef4444'),
    new Wire('WIRE_91', 'B1_GND_L_1', 'GND_TOP1_2', '#0984e3'),
    new Wire('WIRE_92', 'B1_GND_R_1', 'GND_TOP1_12', '#0984e3'),
    new Wire('WIRE_93', 'B2_VCC_R_1', 'VCC_TOP1_25', '#ef4444'),
    new Wire('WIRE_94', 'B2_GND_R_1', 'GND_TOP1_26', '#0984e3'),
    new Wire('WIRE_95', 'B3_VCC_L_1', 'VCC_TOP1_29', '#ef4444'),
    new Wire('WIRE_96', 'B3_GND_L_1', 'GND_TOP1_29', '#0984e3'),
    new Wire('WIRE_97', 'VCC_TOP2_37', 'B3_VCC_R_1', '#ef4444'),
    new Wire('WIRE_98', 'B3_GND_R_1', 'GND_TOP1_38', '#0984e3'),
    new Wire('WIRE_99', 'VCC_TOP1_49', 'B4_VCC_R_1', '#ef4444'),
    new Wire('WIRE_100', 'GND_TOP1_50', 'B4_GND_R_1', '#0984e3'),
    new Wire('WIRE_101', 'BINDING_Va', 'VCC_TOP1_3', '#ef4444'),
    new Wire('WIRE_102', 'BINDING_Vc', 'VCC_TOP2_22', '#ef4444'),
    new Wire('WIRE_103', 'BINDING_GND', 'GND_TOP1_34', '#ef4444'),
    new Wire('WIRE_104', 'B1_B18', 'B1_B2', '#0984e3')
];

console.log('=== TRACING 3-STAGE RC FILTER CONNECTIONS ===');
console.log('B1_A18 Node:', grid.getNodeId('B1_A18'));
console.log('B1_B18 Node:', grid.getNodeId('B1_B18'));
console.log('B1_B2 Node:', grid.getNodeId('B1_B2'));
console.log('B1_E2 Node:', grid.getNodeId('B1_E2'));
console.log('B4_H2 Node:', grid.getNodeId('B4_H2'));
console.log('B4_I2 Node:', grid.getNodeId('B4_I2'));
console.log('B4_I7 Node:', grid.getNodeId('B4_I7'));
console.log('B4_H7 Node:', grid.getNodeId('B4_H7'));
console.log('B4_H26 (LF356 Pin 6 OUT) Node:', grid.getNodeId('B4_H26'));

console.log('\n=== TRACING C44 (22nF Capacitor 1) ===');
console.log('B1_A23 Node:', grid.getNodeId('B1_A23'));
console.log('B1_B23 Node:', grid.getNodeId('B1_B23'));
console.log('B1_B25 Node:', grid.getNodeId('B1_B25'));
console.log('B1_C25 Node:', grid.getNodeId('B1_C25'));
console.log('B1_C30 Node:', grid.getNodeId('B1_C30'));
console.log('B1_A30 Node:', grid.getNodeId('B1_A30'));
console.log('B1_GND_L_30 Node:', grid.getNodeId('B1_GND_L_30'));

console.log('\n=== TRACING R39 (10k Resistor 1) ===');
console.log('B1_D25 Node:', grid.getNodeId('B1_D25'));
console.log('B1_G25 Node:', grid.getNodeId('B1_G25'));

console.log('\n=== TRACING C47 (22nF Capacitor 2) ===');
console.log('B1_H25 Node:', grid.getNodeId('B1_H25'));
console.log('B1_H30 Node:', grid.getNodeId('B1_H30'));
console.log('B1_E30 Node:', grid.getNodeId('B1_E30'));
console.log('B1_F30 Node:', grid.getNodeId('B1_F30'));

console.log('\n=== TRACING R40 (10k Resistor 2) ===');
console.log('B1_J25 Node:', grid.getNodeId('B1_J25'));
console.log('B2_A25 Node:', grid.getNodeId('B2_A25'));

console.log('\n=== TRACING 2SK30A JFET ===');
console.log('B2_C23 Node (Source):', grid.getNodeId('B2_C23'));
console.log('B2_C25 Node (Gate):', grid.getNodeId('B2_C25'));
console.log('B2_C27 Node (Drain):', grid.getNodeId('B2_C27'));

console.log('\n=== TRACING OP-AMP INPUT PIN 3 (B4_E26) ===');
console.log('B4_E26 Node:', grid.getNodeId('B4_E26'));
console.log('B4_A26 Node:', grid.getNodeId('B4_A26'));
console.log('B3_E26 Node:', grid.getNodeId('B3_E26'));
console.log('B3_A26 Node:', grid.getNodeId('B3_A26'));
console.log('B2_J26 Node:', grid.getNodeId('B2_J26'));
console.log('B2_I26 Node:', grid.getNodeId('B2_I26'));
console.log('B2_I21 Node:', grid.getNodeId('B2_I21'));
console.log('B2_H21 Node:', grid.getNodeId('B2_H21'));
console.log('B2_H19 Node:', grid.getNodeId('B2_H19'));
console.log('B2_G19 Node:', grid.getNodeId('B2_G19'));
console.log('B2_G10 Node:', grid.getNodeId('B2_G10'));
console.log('B2_E10 Node:', grid.getNodeId('B2_E10'));
console.log('B2_F10 Node:', grid.getNodeId('B2_F10'));
console.log('B2_D10 Node:', grid.getNodeId('B2_D10'));
console.log('B2_D23 Node:', grid.getNodeId('B2_D23'));
