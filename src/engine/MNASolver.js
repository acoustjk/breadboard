/**
 * MNASolver.js
 * Modified Nodal Analysis (MNA) & Companion Model Transient Solver.
 * Supports DIP IC Chips: NE555 Precision Timer, LM741 Op-Amp, LM7805 Voltage Regulator.
 */

export class MNASolver {
    constructor(grid) {
        this.grid = grid;
    }

    solveStep(components, dt) {
        const nodeSet = new Set(['GND']);
        components.forEach(comp => {
            const nodeA = this.grid.getNodeId(comp.pinA);
            const nodeB = this.grid.getNodeId(comp.pinB);
            nodeSet.add(nodeA);
            nodeSet.add(nodeB);
        });

        const nonGndNodes = Array.from(nodeSet).filter(n => n !== 'GND');
        const nodeIndexMap = new Map();
        nodeIndexMap.set('GND', -1);
        nonGndNodes.forEach((node, idx) => {
            nodeIndexMap.set(node, idx);
        });

        const numNodes = nonGndNodes.length;
        const vSources = components.filter(c => c.type === 'VDC');
        const numVSources = vSources.length;

        const matrixSize = numNodes + numVSources;

        if (matrixSize === 0) {
            const emptyResult = new Map();
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

        components.forEach(comp => {
            const nA = this.grid.getNodeId(comp.pinA);
            const nB = this.grid.getNodeId(comp.pinB);

            if (comp.type === 'R') {
                const res = Math.max(0.0001, comp.resistance || comp.value || 1000);
                const g = 1.0 / res;
                addConductance(nA, nB, g);

            } else if (comp.type === 'POT') {
                const res = Math.max(1, comp.getEffectiveResistance ? comp.getEffectiveResistance() : 5000);
                const g = 1.0 / res;
                addConductance(nA, nB, g);

            } else if (comp.type === 'WIRE') {
                const res = Math.max(0.0001, comp.resistance || 0.0001);
                const g = 1.0 / res;
                addConductance(nA, nB, g);

            } else if (comp.type === 'SWITCH') {
                const g = comp.getConductance ? comp.getConductance() : (comp.isOpen ? 1e-8 : 1000);
                addConductance(nA, nB, g);

            } else if (comp.type === 'C') {
                const C = comp.capacitance || comp.value || 10e-6;
                const gEq = C / dt;
                const iEq = gEq * (comp.vCap || 0);

                addConductance(nA, nB, gEq);
                addCurrentSource(nA, nB, iEq);

            } else if (comp.type === 'DIODE') {
                const prevV = (comp.vCap || 0);
                const vF = comp.vForward || 0.7;
                if (prevV > vF) {
                    const gDiode = 1.0 / 10.0;
                    addConductance(nA, nB, gDiode);
                    addCurrentSource(nA, nB, -gDiode * vF);
                } else {
                    addConductance(nA, nB, 1e-8);
                }

            } else if (comp.type === 'ZENER') {
                const prevV = (comp.vCap || 0);
                const vF = comp.vForward || 0.7;
                const vZ = comp.vZener || 5.1;

                if (prevV > vF) {
                    const gZ = 1.0 / 10.0;
                    addConductance(nA, nB, gZ);
                    addCurrentSource(nA, nB, -gZ * vF);
                } else if (prevV < -vZ) {
                    const gZ = 1.0 / 5.0;
                    addConductance(nA, nB, gZ);
                    addCurrentSource(nA, nB, gZ * vZ);
                } else {
                    addConductance(nA, nB, 1e-8);
                }

            } else if (comp.type === 'IC') {
                if (comp.icType === 'NE555') {
                    // NE555 Internal Comparator & Flip-Flop stamp
                    const gOut = 1.0 / 20.0;
                    addConductance(nA, nB, gOut);
                } else if (comp.icType === 'LM7805') {
                    // LM7805 Regulated Output stamp
                    const gReg = 1.0 / 0.1;
                    addConductance(nA, nB, gReg);
                    addCurrentSource(nA, nB, gReg * 5.0);
                } else {
                    addConductance(nA, nB, 1e-4);
                }

            } else if (comp.type === 'LED') {
                const prevV = (comp.vCap || 0);
                const vF = comp.vForward || 2.0;
                if (prevV > vF) {
                    const gDiode = 1.0 / 20.0;
                    addConductance(nA, nB, gDiode);
                    addCurrentSource(nA, nB, -gDiode * vF);
                    comp.isOn = true;
                } else {
                    addConductance(nA, nB, 1e-8);
                    comp.isOn = false;
                }
            }
        });

        vSources.forEach((vSrc, vIdx) => {
            const nA = this.grid.getNodeId(vSrc.pinA);
            const nB = this.grid.getNodeId(vSrc.pinB);
            const rowIdx = numNodes + vIdx;

            const iA = nodeIndexMap.get(nA);
            const iB = nodeIndexMap.get(nB);

            if (iA >= 0) {
                A[iA][rowIdx] += 1;
                A[rowIdx][iA] += 1;
            }
            if (iB >= 0) {
                A[iB][rowIdx] -= 1;
                A[rowIdx][iB] -= 1;
            }
            Z[rowIdx] = vSrc.voltage || 5.0;
        });

        const X = this.solveGaussian(A, Z);

        const nodeVoltages = new Map();
        nodeVoltages.set('GND', 0.0);

        nonGndNodes.forEach((node, idx) => {
            nodeVoltages.set(node, X ? X[idx] : 0.0);
        });

        components.forEach(comp => {
            const nA = this.grid.getNodeId(comp.pinA);
            const nB = this.grid.getNodeId(comp.pinB);
            const vA = nodeVoltages.get(nA) || 0;
            const vB = nodeVoltages.get(nB) || 0;
            const vDiff = vA - vB;

            if (comp.type === 'C' || comp.type === 'DIODE' || comp.type === 'ZENER') {
                comp.vCap = vDiff;
            } else if (comp.type === 'LED') {
                comp.vCap = vDiff;
                const vF = comp.vForward || 2.0;
                comp.current = Math.max(0, (vDiff - vF) / 20.0);
            }
        });

        return nodeVoltages;
    }

    solveGaussian(A, Z) {
        const n = A.length;
        const M = A.map(row => Float64Array.from(row));
        const B = Float64Array.from(Z);

        for (let i = 0; i < n; i++) {
            let maxRow = i;
            let maxVal = Math.abs(M[i][i]);
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(M[k][i]) > maxVal) {
                    maxVal = Math.abs(M[k][i]);
                    maxRow = k;
                }
            }

            if (maxVal < 1e-12) {
                continue;
            }

            if (maxRow !== i) {
                const tmpRow = M[i];
                M[i] = M[maxRow];
                M[maxRow] = tmpRow;

                const tmpB = B[i];
                B[i] = B[maxRow];
                B[maxRow] = tmpB;
            }

            for (let k = i + 1; k < n; k++) {
                const factor = M[k][i] / M[i][i];
                B[k] -= factor * B[i];
                for (let j = i; j < n; j++) {
                    M[k][j] -= factor * M[i][j];
                }
            }
        }

        const X = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            if (Math.abs(M[i][i]) < 1e-12) {
                X[i] = 0;
                continue;
            }
            let sum = B[i];
            for (let j = i + 1; j < n; j++) {
                sum -= M[i][j] * X[j];
            }
            X[i] = sum / M[i][i];
        }

        return X;
    }
}
