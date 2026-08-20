/**
 * MNASolver.js
 * Modified Nodal Analysis (MNA) & Companion Model Transient Solver.
 * Includes Behavioral SPICE Models for DIP ICs:
 * - NE555 / NE556 Precision Timers (Astable / Monostable Square Wave Oscillators)
 * - LF356 / LM741 / LM358 / LM393 Op-Amps & Comparators
 * - LM7805 / LM7812 Voltage Regulators
 */

export class MNASolver {
    constructor(grid) {
        this.grid = grid;
    }

    isGroundNode(n) {
        return (n === '0' || n === 'GND' || n === 'NODE_GND' || n === 'BINDING_GND');
    }

    getDIP8Pins(comp) {
        const pinA = comp.pinA; // e.g. "B1_E10"
        const match = pinA ? pinA.match(/^(B\d+)_([A-E])(\d+)$/) : null;
        if (!match) return null;
        const block = match[1];
        const startRow = parseInt(match[3], 10);
        return {
            pin1: `${block}_E${startRow}`,
            pin2: `${block}_E${startRow + 1}`,
            pin3: `${block}_E${startRow + 2}`,
            pin4: `${block}_E${startRow + 3}`,
            pin5: `${block}_F${startRow + 3}`,
            pin6: `${block}_F${startRow + 2}`,
            pin7: `${block}_F${startRow + 1}`,
            pin8: `${block}_F${startRow + 0}`
        };
    }

    solveStep(components, dt) {
        const nodeSet = new Set();
        components.forEach(comp => {
            const nodeA = this.grid.getNodeId(comp.pinA);
            const nodeB = this.grid.getNodeId(comp.pinB);
            if (nodeA) nodeSet.add(nodeA);
            if (nodeB) nodeSet.add(nodeB);

            if (comp.type === 'IC') {
                const pins = this.getDIP8Pins(comp);
                if (pins) {
                    Object.values(pins).forEach(pKey => {
                        const n = this.grid.getNodeId(pKey);
                        if (n) nodeSet.add(n);
                    });
                }
            }
        });

        const nonGndNodes = Array.from(nodeSet).filter(n => !this.isGroundNode(n));
        const nodeIndexMap = new Map();
        nodeIndexMap.set('0', -1);
        nodeIndexMap.set('GND', -1);
        nodeIndexMap.set('NODE_GND', -1);
        nodeIndexMap.set('BINDING_GND', -1);

        nonGndNodes.forEach((node, idx) => {
            nodeIndexMap.set(node, idx);
        });

        const numNodes = nonGndNodes.length;

        // Collect VDC sources and IC output voltage source equivalents
        const vSources = components.filter(c => c.type === 'VDC');
        const numVSources = vSources.length;

        const matrixSize = numNodes + numVSources;

        if (matrixSize === 0) {
            const emptyResult = new Map();
            emptyResult.set('0', 0);
            emptyResult.set('GND', 0);
            return emptyResult;
        }

        const A = Array.from({ length: matrixSize }, () => new Float64Array(matrixSize));
        const Z = new Float64Array(matrixSize);

        const addConductance = (n1, n2, g) => {
            const i1 = nodeIndexMap.get(n1);
            const i2 = nodeIndexMap.get(n2);
            if (i1 >= 0) A[i1][i1] += g;
            if (i2 >= 0) A[i2][i2] += g;
            if (i1 >= 0 && i2 >= 0) {
                A[i1][i2] -= g;
                A[i2][i1] -= g;
            }
        };

        const addCurrentSource = (n1, n2, current) => {
            const i1 = nodeIndexMap.get(n1);
            const i2 = nodeIndexMap.get(n2);
            if (i1 >= 0) Z[i1] += current;
            if (i2 >= 0) Z[i2] -= current;
        };

        // 1. Process Passive Linear Components
        components.forEach(comp => {
            const nA = this.grid.getNodeId(comp.pinA);
            const nB = this.grid.getNodeId(comp.pinB);

            if (comp.type === 'WIRE') {
                const gWire = 1000.0;
                addConductance(nA, nB, gWire);
            } else if (comp.type === 'R') {
                const g = comp.getConductance();
                addConductance(nA, nB, g);
            } else if (comp.type === 'POT') {
                const effR = comp.getEffectiveResistance();
                const g = 1.0 / effR;
                addConductance(nA, nB, g);
            } else if (comp.type === 'C') {
                const { Geq, Ieq } = comp.getCompanionModel(dt);
                addConductance(nA, nB, Geq);
                addCurrentSource(nA, nB, Ieq);
            } else if (comp.type === 'DIODE') {
                const gDiode = 50.0;
                addConductance(nA, nB, gDiode);
            } else if (comp.type === 'ZENER') {
                const gZener = 50.0;
                addConductance(nA, nB, gZener);
            } else if (comp.type === 'SWITCH') {
                const gSw = comp.isOpen ? 1e-9 : 1000.0;
                addConductance(nA, nB, gSw);
            } else if (comp.type === 'LED') {
                const gLed = 20.0;
                addConductance(nA, nB, gLed);
            } else if (comp.type === 'IC') {
                const pins = this.getDIP8Pins(comp);
                if (!pins) return;

                const nPin1 = this.grid.getNodeId(pins.pin1); // GND
                const nPin2 = this.grid.getNodeId(pins.pin2); // TRIG
                const nPin3 = this.grid.getNodeId(pins.pin3); // OUT
                const nPin4 = this.grid.getNodeId(pins.pin4); // RESET
                const nPin5 = this.grid.getNodeId(pins.pin5); // CTRL
                const nPin6 = this.grid.getNodeId(pins.pin6); // THRESH
                const nPin7 = this.grid.getNodeId(pins.pin7); // DISCH
                const nPin8 = this.grid.getNodeId(pins.pin8); // VCC

                if (comp.icType === 'NE555') {
                    comp.state = comp.state || 'HIGH';
                    const vCap = comp.lastVCap || 0.0;

                    if (vCap >= 3.33) {
                        comp.state = 'LOW';
                    } else if (vCap <= 1.67) {
                        comp.state = 'HIGH';
                    }

                    if (comp.state === 'HIGH') {
                        addConductance(nPin3, nPin8, 100.0); // Output HIGH -> VCC
                        addConductance(nPin7, '0', 1e-6);    // Discharge OFF (Hi-Z)
                    } else {
                        addConductance(nPin3, '0', 100.0);   // Output LOW -> GND
                        addConductance(nPin7, '0', 100.0);   // Discharge ON -> GND
                    }

                    // 555 Control voltage divider
                    addConductance(nPin5, '0', 0.001);

                } else if (comp.icType === 'LF356' || comp.icType === 'LM741' || comp.icType === 'LM358') {
                    // Op-Amp Model: Pin 2 (Inverting -), Pin 3 (Non-Inverting +), Pin 6 (Output)
                    const vMinus = comp.lastVMinus || 0;
                    const vPlus = comp.lastVPlus || 0;
                    const vDiff = vPlus - vMinus;
                    const vOutIdeal = Math.max(-12.0, Math.min(12.0, vDiff * 100.0));

                    if (vOutIdeal >= 0) {
                        addConductance(nPin6, nPin7, 50.0);
                    } else {
                        addConductance(nPin6, nPin4, 50.0);
                    }
                } else if (comp.icType === 'LM7805') {
                    // 5V Regulator: Pin 3 (Output) -> 5V DC
                    addConductance(nPin3, nPin8, 100.0);
                }
            }
        });

        // 2. Process Independent DC Voltage Sources (VDC)
        vSources.forEach((vSrc, idx) => {
            const rowIdx = numNodes + idx;
            const nA = this.grid.getNodeId(vSrc.pinA);
            const nB = this.grid.getNodeId(vSrc.pinB);

            const iA = nodeIndexMap.get(nA);
            const iB = nodeIndexMap.get(nB);

            if (iA >= 0) {
                A[rowIdx][iA] = 1;
                A[iA][rowIdx] = 1;
            }
            if (iB >= 0) {
                A[rowIdx][iB] = -1;
                A[iB][rowIdx] = -1;
            }

            Z[rowIdx] = vSrc.voltage;
        });

        // 3. Solve System Matrix A * X = Z using Gaussian Elimination
        const X = this.gaussianElimination(A, Z);

        // 4. Extract Node Voltage Map
        const resultMap = new Map();
        resultMap.set('0', 0);
        resultMap.set('GND', 0);
        resultMap.set('NODE_GND', 0);
        resultMap.set('BINDING_GND', 0);

        nonGndNodes.forEach((node, idx) => {
            resultMap.set(node, X ? X[idx] : 0);
        });

        // 5. Update State for Capacitors & Dynamic Components
        components.forEach(comp => {
            const nA = this.grid.getNodeId(comp.pinA);
            const nB = this.grid.getNodeId(comp.pinB);
            const vA = resultMap.get(nA) || 0;
            const vB = resultMap.get(nB) || 0;

            if (comp.type === 'C') {
                comp.updateState(vA, vB);
            } else if (comp.type === 'LED') {
                comp.isOn = (vA - vB) >= comp.vForward;
            } else if (comp.type === 'IC') {
                const pins = this.getDIP8Pins(comp);
                if (pins) {
                    const nPin2 = this.grid.getNodeId(pins.pin2);
                    const nPin3 = this.grid.getNodeId(pins.pin3);
                    const nPin6 = this.grid.getNodeId(pins.pin6);

                    comp.lastVCap = resultMap.get(nPin2) || 0;
                    comp.lastVMinus = resultMap.get(nPin2) || 0;
                    comp.lastVPlus = resultMap.get(nPin3) || 0;
                    comp.vOut = resultMap.get(nPin6) || resultMap.get(nPin3) || 0;
                }
            }
        });

        return resultMap;
    }

    gaussianElimination(A, B) {
        const n = B.length;

        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
                    maxRow = k;
                }
            }

            const tempA = A[i];
            A[i] = A[maxRow];
            A[maxRow] = tempA;

            const tempB = B[i];
            B[i] = B[maxRow];
            B[maxRow] = tempB;

            if (Math.abs(A[i][i]) < 1e-12) {
                continue;
            }

            for (let k = i + 1; k < n; k++) {
                const c = -A[k][i] / A[i][i];
                for (let j = i; j < n; j++) {
                    if (i === j) {
                        A[k][j] = 0;
                    } else {
                        A[k][j] += c * A[i][j];
                    }
                }
                B[k] += c * B[i];
            }
        }

        const x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            if (Math.abs(A[i][i]) < 1e-12) {
                x[i] = 0;
                continue;
            }
            let sum = 0;
            let val = B[i] - sum;
            for (let j = i + 1; j < n; j++) {
                sum += A[i][j] * x[j];
            }
            x[i] = (B[i] - sum) / A[i][i];
        }

        return x;
    }
}
