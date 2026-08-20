/**
 * MNASolver.js
 * Modified Nodal Analysis (MNA) & Companion Model Transient Solver.
 * Supports DIP IC Chips: NE555 Precision Timer, LM741 Op-Amp, LM7805 Voltage Regulator, LF356.
 * Correctly anchors ground nodes ('0', 'GND', 'NODE_GND') to 0V.
 */

export class MNASolver {
    constructor(grid) {
        this.grid = grid;
    }

    isGroundNode(n) {
        return (n === '0' || n === 'GND' || n === 'NODE_GND' || n === 'BINDING_GND');
    }

    solveStep(components, dt) {
        const nodeSet = new Set();
        components.forEach(comp => {
            const nodeA = this.grid.getNodeId(comp.pinA);
            const nodeB = this.grid.getNodeId(comp.pinB);
            if (nodeA) nodeSet.add(nodeA);
            if (nodeB) nodeSet.add(nodeB);
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

        // 1. Process Passive Linear Components (R, Wires, Companion Capacitors, Diodes)
        components.forEach(comp => {
            const nA = this.grid.getNodeId(comp.pinA);
            const nB = this.grid.getNodeId(comp.pinB);

            if (comp.type === 'WIRE') {
                const gWire = 1000.0; // 1 mΩ wire resistance
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
                const vA = nA ? 0.7 : 0;
                const gDiode = vA >= comp.vForward ? 100.0 : 1e-6;
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
            for (let j = i + 1; j < n; j++) {
                sum += A[i][j] * x[j];
            }
            x[i] = (B[i] - sum) / A[i][i];
        }

        return x;
    }
}
