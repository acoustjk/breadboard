/**
 * MNASolver.js
 * Modified Nodal Analysis (MNA) Linear Circuit Engine for Hybrid Circuit Simulator.
 * Added VDC / DCSource Power Driver & Saturation Rail Clamping v=1058.
 */

export class MNASolver {
    constructor(grid) {
        this.grid = grid;
        this.lastVoltages = new Map();
        this.lastCurrents = new Map();
    }

    solveStep(components, dt = 0.0001) {
        const nodeSet = new Set();
        components.forEach(c => {
            const nA = this.grid.getNodeId(c.pinA);
            const nB = this.grid.getNodeId(c.pinB);
            if (nA && nA !== '0') nodeSet.add(nA);
            if (nB && nB !== '0') nodeSet.add(nB);
        });

        const activeNodes = Array.from(nodeSet).sort();
        const N = activeNodes.length;

        if (N === 0) {
            return this.lastVoltages;
        }

        const nodeIndexMap = new Map();
        activeNodes.forEach((n, idx) => nodeIndexMap.set(n, idx));

        const A = Array.from({ length: N }, () => new Float64Array(N));
        const Z = new Float64Array(N);

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

        const getNode = (pinKey) => this.grid.getNodeId(pinKey);

        const driveDigitalPin = (pinKey, isHigh, gDriver = 100.0) => {
            const n = getNode(pinKey);
            if (!n) return;
            if (isHigh) {
                addConductance(n, '0', gDriver);
                addCurrentSource(n, '0', 5.0 * gDriver);
            } else {
                addConductance(n, '0', gDriver);
            }
        };

        // 1. Process Passive Linear & Voltage Source Components
        components.forEach(comp => {
            const nA = this.grid.getNodeId(comp.pinA);
            const nB = this.grid.getNodeId(comp.pinB);

            if (comp.type === 'WIRE') {
                addConductance(nA, nB, 1000.0);
            } else if (comp.type === 'R') {
                addConductance(nA, nB, comp.getConductance());
            } else if (comp.type === 'POT') {
                addConductance(nA, nB, 1.0 / comp.getEffectiveResistance());
            } else if (comp.type === 'C') {
                const { Geq, Ieq } = comp.getCompanionModel(dt);
                addConductance(nA, nB, Geq);
                addCurrentSource(nA, nB, Ieq);
            } else if (comp.type === 'VDC') {
                const gSrc = 1000.0;
                const vVal = comp.voltage !== undefined ? comp.voltage : 5.0;
                addConductance(nA, nB, gSrc);
                addCurrentSource(nA, nB, vVal * gSrc);
            } else if (comp.type === 'DIODE') {
                addConductance(nA, nB, 50.0);
            } else if (comp.type === 'ZENER') {
                addConductance(nA, nB, 50.0);
            } else if (comp.type === 'SWITCH') {
                addConductance(nA, nB, comp.isOpen ? 1e-9 : 1000.0);
            } else if (comp.type === 'LED') {
                addConductance(nA, nB, 20.0);

            // ==========================================
            // 2. Behavioral Models for IC Chips
            // ==========================================
            } else if (comp.type === 'IC') {
                const pins = this.getDIPPins(comp);
                if (!pins) return;

                const icType = comp.icType || 'LF356';

                if (icType === 'NE555') {
                    comp.state = comp.state || 'HIGH';
                    const nTrig = getNode(pins.pin2);
                    const nThresh = getNode(pins.pin6);

                    const vTrig = (nTrig && this.lastVoltages) ? (this.lastVoltages.get(nTrig) || 0) : 0;
                    const vThresh = (nThresh && this.lastVoltages) ? (this.lastVoltages.get(nThresh) || 0) : 0;

                    if (vTrig < 1.67) comp.state = 'HIGH';
                    else if (vThresh > 3.33) comp.state = 'LOW';

                    driveDigitalPin(pins.pin3, comp.state === 'HIGH', 100.0);

                    const nDis = getNode(pins.pin7);
                    if (nDis) {
                        if (comp.state === 'LOW') {
                            addConductance(nDis, '0', 500.0);
                        } else {
                            addConductance(nDis, '0', 1e-6);
                        }
                    }

                } else if (icType === 'LF356' || icType === 'LM741') {
                    // Single Op-Amp VCVS Behavioral Model with Rail Clamping
                    const nOut = getNode(pins.pin6);
                    const nPlus = getNode(pins.pin3);
                    const nMinus = getNode(pins.pin2);

                    const vPos = comp.vPin7 || 12.0;
                    const vNeg = comp.vPin4 || -12.0;
                    const vMax = Math.min(15.0, Math.max(0.0, vPos - 1.2));
                    const vMin = Math.max(-15.0, Math.min(0.0, vNeg + 1.2));

                    if (nOut) {
                        const iOut = nodeIndexMap.get(nOut);
                        const G_out = 100.0;
                        const Av = 100.0;

                        if (iOut >= 0) {
                            A[iOut][iOut] += G_out;

                            const vP = (nPlus && this.lastVoltages) ? (this.lastVoltages.get(nPlus) || 0) : 0;
                            const vM = (nMinus && this.lastVoltages) ? (this.lastVoltages.get(nMinus) || 0) : 0;

                            let vTarget = (vP - vM) * Av;
                            vTarget += (Math.random() - 0.5) * 1e-2; // Startup noise perturbation

                            if (vTarget > vMax) vTarget = vMax;
                            if (vTarget < vMin) vTarget = vMin;

                            Z[iOut] += G_out * vTarget;
                            comp.vPin6 = Math.max(vMin, Math.min(vMax, comp.vPin6 || 0));
                        }
                    }

                } else if (icType === 'LM358' || icType === 'LM393') {
                    const nOutA = getNode(pins.pin1);
                    const nOutB = getNode(pins.pin7);

                    if (nOutA) {
                        comp.stateA = comp.stateA || 'HIGH';
                        const nInMinusA = getNode(pins.pin2);
                        const nInPlusA = getNode(pins.pin3);

                        const vMinusA = (nInMinusA && this.lastVoltages) ? (this.lastVoltages.get(nInMinusA) || 0) : 0;
                        const vPlusA = (nInPlusA && this.lastVoltages) ? (this.lastVoltages.get(nInPlusA) || 0) : 0;

                        if (vPlusA > vMinusA + 0.02) comp.stateA = 'HIGH';
                        else if (vPlusA < vMinusA - 0.02) comp.stateA = 'LOW';

                        driveDigitalPin(pins.pin1, comp.stateA === 'HIGH', 100.0);
                    }

                    if (nOutB) {
                        const nInMinusB = getNode(pins.pin6);
                        const nInPlusB = getNode(pins.pin5);

                        const iOutB = nodeIndexMap.get(nOutB);
                        if (iOutB >= 0) {
                            A[iOutB][iOutB] += 100.0;
                            const vP = (nInPlusB && this.lastVoltages) ? (this.lastVoltages.get(nInPlusB) || 0) : 0;
                            const vM = (nInMinusB && this.lastVoltages) ? (this.lastVoltages.get(nInMinusB) || 0) : 0;
                            let vTarget = (vP - vM) * 100.0;
                            if (vTarget > 7.8) vTarget = 7.8;
                            if (vTarget < 0.0) vTarget = 0.0;
                            Z[iOutB] += 100.0 * vTarget;
                        }
                    }

                } else if (icType === 'LM7805' || icType === 'LM7812') {
                    const vTarget = icType === 'LM7812' ? 12.0 : 5.0;
                    driveDigitalPin(pins.pin3, true, 200.0);

                } else if (icType === 'CD4017') {
                    comp.count = comp.count || 0;
                    comp.lastClk = comp.lastClk || 0;
                    const nClk = getNode(pins.pin14);
                    const vClk = (nClk && this.lastVoltages) ? (this.lastVoltages.get(nClk) || 0) : 0;

                    if (vClk > 2.5 && comp.lastClk <= 2.5) {
                        comp.count = (comp.count + 1) % 10;
                    }
                    comp.lastClk = vClk;

                    const qPins = [pins.pin3, pins.pin2, pins.pin4, pins.pin7, pins.pin10, pins.pin1, pins.pin5, pins.pin6, pins.pin9, pins.pin11];
                    qPins.forEach((qPin, qIdx) => {
                        driveDigitalPin(qPin, comp.count === qIdx, 100.0);
                    });
                }
            }
        });

        // 3. Solve Linear System A * V = Z (Gaussian Elimination with Partial Pivoting & Overflow Clamp)
        const V = this.gaussianSolve(A, Z, N);

        const newVoltages = new Map();
        activeNodes.forEach((n, idx) => {
            let v = V[idx];
            if (isNaN(v) || !isFinite(v)) v = 0.0;
            v = Math.max(-25.0, Math.min(25.0, v)); // Overflow Clamp Guard
            newVoltages.set(n, v);
        });
        newVoltages.set('0', 0.0);

        this.lastVoltages = newVoltages;

        // 4. Update Dynamic Component Internal States
        components.forEach(comp => {
            const nA = this.grid.getNodeId(comp.pinA);
            const nB = this.grid.getNodeId(comp.pinB);
            const vA = newVoltages.get(nA) || 0;
            const vB = newVoltages.get(nB) || 0;

            if (comp.type === 'C') {
                comp.updateState(vA - vB, dt);
            } else if (comp.type === 'LED') {
                const vDiff = vA - vB;
                comp.isOn = (vDiff > 1.7);
            } else if (comp.type === 'IC') {
                const pins = this.getDIPPins(comp);
                if (pins) {
                    const nP6 = getNode(pins.pin6);
                    const nP7 = getNode(pins.pin7);
                    const nP4 = getNode(pins.pin4);
                    if (nP6) comp.vPin6 = newVoltages.get(nP6) || 0;
                    if (nP7) comp.vPin7 = newVoltages.get(nP7) || 12.0;
                    if (nP4) comp.vPin4 = newVoltages.get(nP4) || -12.0;
                }
            }
        });

        return newVoltages;
    }

    gaussianSolve(A, Z, N) {
        const M = Array.from({ length: N }, (_, i) => {
            const row = new Float64Array(N + 1);
            row.set(A[i]);
            row[N] = Z[i];
            return row;
        });

        for (let i = 0; i < N; i++) {
            let maxRow = i;
            for (let k = i + 1; k < N; k++) {
                if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
                    maxRow = k;
                }
            }

            const temp = M[i];
            M[i] = M[maxRow];
            M[maxRow] = temp;

            if (Math.abs(M[i][i]) < 1e-12) {
                continue;
            }

            for (let k = i + 1; k < N; k++) {
                const c = -M[k][i] / M[i][i];
                for (let j = i; j <= N; j++) {
                    if (i === j) {
                        M[k][j] = 0;
                    } else {
                        M[k][j] += c * M[i][j];
                    }
                }
            }
        }

        const x = new Float64Array(N);
        for (let i = N - 1; i >= 0; i--) {
            if (Math.abs(M[i][i]) < 1e-12) {
                x[i] = 0;
                continue;
            }
            x[i] = M[i][N] / M[i][i];
            if (isNaN(x[i]) || !isFinite(x[i])) x[i] = 0;
            for (let k = i - 1; k >= 0; k--) {
                M[k][N] -= M[k][i] * x[i];
            }
        }
        return x;
    }

    getDIPPins(comp) {
        const pinA = comp.pinA;
        if (!pinA || !pinA.includes('_')) return null;

        const parts = pinA.split('_');
        const blk = parts[0];
        const col = parts[1][0];
        const startRow = parseInt(parts[1].slice(1), 10);

        const pins = {};
        const numPins = comp.pins || 8;
        const pinsPerSide = numPins / 2;

        for (let i = 0; i < pinsPerSide; i++) {
            const r = startRow + i;
            pins[`pin${i + 1}`] = `${blk}_E${r}`;
        }

        for (let i = 0; i < pinsPerSide; i++) {
            const r = startRow + (pinsPerSide - 1 - i);
            pins[`pin${pinsPerSide + 1 + i}`] = `${blk}_F${r}`;
        }

        return pins;
    }
}
