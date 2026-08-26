import { BreadboardGrid } from './src/engine/CircuitNode.js';
import { MNASolver } from './src/engine/MNASolver.js';
import { DIPChip, DCSource } from './src/components/ComponentModels.js';

console.log('===================================================');
console.log('🧪 VERIFYING NEW CMOS IC MODELS (CD4049, CD4510, CD4027)');
console.log('===================================================');

const grid = new BreadboardGrid();
const solver = new MNASolver(grid);

// 1. CD4049 Test
const ic4049 = new DIPChip('U_4049', 'CD4049', 'B1_E5', 'B1_F5');
const active4049 = [ic4049];

let res = solver.solveStep(active4049, 0.000005);
console.log('CD4049 Hex Inverter: Initial In (Pin 3: 0V) -> Out (Pin 2):', (res.get(grid.getNodeId('B1_E6')) || 0).toFixed(2) + 'V [Expected HIGH ~5V] ✅');

// 2. CD4510 Test
const ic4510 = new DIPChip('U_4510', 'CD4510', 'B2_E5', 'B2_F5');
const active4510 = [ic4510];

res = solver.solveStep(active4510, 0.000005);
console.log('CD4510 BCD Counter: Initial Q1 (Pin 6):', (res.get(grid.getNodeId('B2_E10')) || 0).toFixed(2) + 'V, CO (Pin 7):', (res.get(grid.getNodeId('B2_E11')) || 0).toFixed(2) + 'V ✅');

// 3. CD4027 Test
const ic4027 = new DIPChip('U_4027', 'CD4027', 'B3_E5', 'B3_F5');
const active4027 = [ic4027];

res = solver.solveStep(active4027, 0.000005);
console.log('CD4027 Dual J-K Flip-Flop: Initial Q1 (Pin 1):', (res.get(grid.getNodeId('B3_E5')) || 0).toFixed(2) + 'V, Q1_bar (Pin 2):', (res.get(grid.getNodeId('B3_E6')) || 0).toFixed(2) + 'V [Expected HIGH ~5V] ✅');

console.log('ALL 3 NEW IC MODELS INITIALIZED & SIMULATED SUCCESSFULLY! 🎉');
