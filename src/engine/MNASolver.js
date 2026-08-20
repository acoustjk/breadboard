/**
 * MNASolver.js
 * Modified Nodal Analysis (MNA) & Companion Model Transient Solver.
 * LM358 Dual Op-Amp Schmitt Trigger + Linear Integrator Driver v=1043.
 */

export class MNASolver {
    constructor(grid) {
        this.grid = grid;
    }

    isGroundNode(n) {
        return (n === '0' || n === 'GND' || n === 'NODE_GND' || n === 'BINDING_GND');
    }

    getDIPPins(comp) {
        const pinA = comp.pinA;
        const match = pinA ? pinA.match(/^(B\d+)_([A-E])(\d+)$/) : null;
        if (!match) return null;
        const block = match[1];
        const startRow = parseInt(match[3], 10);
        const numPins = comp.pins || (comp.icType === 'NE556' ? 14 : (comp.icType.startsWith('74HC') && comp.icType !== '74HC595' ? 14 : (comp.icType === 'CD4017' || comp.icType === 'CD4026' || comp.icType === '74HC595' ? 16 : 8)));
        const pinsPerSide = numPins / 2;

        const map = {};
        for (let p = 1; p <= pinsPerSide; p++) {
            map[`pin${p}`] = `${block}_E${startRow + p - 1}`;
        }
        for (let p = 1; p <= pinsPerSide; p++) {
            const pinNum = numPins - p + 1;
            map[`pin${pinNum}`] = `${block}_F${startRow + p - 1}`;
        }
        map.numPins = numPins;
        return map;
    }

    solveStep(components, dt) {
        const nodeSet = new Set();
        components.forEach(comp => {
            const nodeA = this.grid.getNodeId(comp.pinA);
            const nodeB = this.grid.getNodeId(comp.pinB);
            if (nodeA) nodeSet.add(nodeA);
            if (nodeB) nodeSet.add(nodeB);

            if (comp.type === 'IC') {
                const pins = this.getDIPPins(comp);
                if (pins) {
                    for (let p = 1; p <= pins.numPins; p++) {
                        const n = this.grid.getNodeId(pins[`pin${p}`]);
                        if (n) nodeSet.add(n);
                    }
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

        // Collect VDC sources
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

        // 1. Process Passive Linear Components
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
                    const vCap = comp.lastVCap || 0.0;

                    if (vCap >= 3.33) comp.state = 'LOW';
                    else if (vCap <= 1.67) comp.state = 'HIGH';

                    if (comp.state === 'HIGH') {
                        addConductance(getNode(pins.pin3), getNode(pins.pin8), 100.0);
                        addConductance(getNode(pins.pin7), '0', 1e-6);
                    } else {
                        addConductance(getNode(pins.pin3), '0', 100.0);
                        addConductance(getNode(pins.pin7), '0', 100.0);
                    }
                    addConductance(getNode(pins.pin5), '0', 0.001);

                } else if (icType === 'NE556') {
                    comp.state1 = comp.state1 || 'HIGH';
                    comp.state2 = comp.state2 || 'HIGH';

                    const vCap1 = comp.lastVCap1 || 0.0;
                    const vCap2 = comp.lastVCap2 || 0.0;

                    if (vCap1 >= 3.33) comp.state1 = 'LOW';
                    else if (vCap1 <= 1.67) comp.state1 = 'HIGH';

                    if (vCap2 >= 3.33) comp.state2 = 'LOW';
                    else if (vCap2 <= 1.67) comp.state2 = 'HIGH';

                    if (comp.state1 === 'HIGH') {
                        addConductance(getNode(pins.pin5), getNode(pins.pin14), 100.0);
                        addConductance(getNode(pins.pin1), '0', 1e-6);
                    } else {
                        addConductance(getNode(pins.pin5), '0', 100.0);
                        addConductance(getNode(pins.pin1), '0', 100.0);
                    }

                    if (comp.state2 === 'HIGH') {
                        addConductance(getNode(pins.pin9), getNode(pins.pin14), 100.0);
                        addConductance(getNode(pins.pin13), '0', 1e-6);
                    } else {
                        addConductance(getNode(pins.pin9), '0', 100.0);
                        addConductance(getNode(pins.pin13), '0', 100.0);
                    }

                } else if (icType === 'LF356' || icType === 'LM741') {
                    // Single Op-Amp: Pin 2 (-), Pin 3 (+), Pin 6 (OUT)
                    const nOut = getNode(pins.pin6);
                    if (nOut) {
                        const vMinus = comp.lastVMinus || 0;
                        const vPlus = comp.lastVPlus || 0;
                        const vDiff = vPlus - vMinus;
                        const gain = 500.0;
                        const vPos = comp.vPin7 || 12.0;
                        const vNeg = comp.vPin4 || -12.0;
                        const vOutIdeal = Math.max(vNeg + 1.2, Math.min(vPos - 1.2, vDiff * gain));

                        addConductance(nOut, '0', 100.0);
                        addCurrentSource(nOut, '0', vOutIdeal * 100.0);
                    }

                } else if (icType === 'LM358' || icType === 'LM393') {
                    // Dual Op-Amp / Comparator:
                    // Unit A: Pin 2 (-), Pin 3 (+), Pin 1 (OUT1)
                    // Unit B: Pin 6 (-), Pin 5 (+), Pin 7 (OUT2)
                    const nOutA = getNode(pins.pin1);
                    const nOutB = getNode(pins.pin7);

                    const vPos = comp.vPin8 || 9.0;
                    const vNeg = comp.vPin4 || 0.0;

                    // Unit A: Bistable Schmitt Trigger / Switching Driver
                    if (nOutA) {
                        comp.stateA = comp.stateA || 'HIGH';
                        const vDiffA = (comp.lastVPlusA || 0) - (comp.lastVMinusA || 0);
                        if (vDiffA > 0.001) comp.stateA = 'HIGH';
                        else if (vDiffA < -0.001) comp.stateA = 'LOW';

                        const vOutA = (comp.stateA === 'HIGH') ? (vPos - 1.2) : (vNeg + 0.2);
                        addConductance(nOutA, '0', 100.0);
                        addCurrentSource(nOutA, '0', vOutA * 100.0);
                    }

                    // Unit B: Linear Active Integrator / Amplifier Driver
                    if (nOutB) {
                        const vDiffB = (comp.lastVPlusB || 0) - (comp.lastVMinusB || 0);
                        const vMid = (vPos + vNeg) / 2.0;
                        const gainB = 20.0;
                        const vOutB = Math.max(vNeg + 0.2, Math.min(vPos - 1.2, vMid + vDiffB * gainB));
                        addConductance(nOutB, '0', 50.0);
                        addCurrentSource(nOutB, '0', vOutB * 50.0);
                    }

                } else if (icType === 'LM386') {
                    const vDiff = (comp.lastVPlus || 0) - (comp.lastVMinus || 0);
                    const vOut = Math.max(0.5, Math.min(4.5, 2.5 + vDiff * 20.0));
                    const nOut = getNode(pins.pin5);
                    if (nOut) {
                        addConductance(nOut, '0', 50.0);
                        addCurrentSource(nOut, '0', vOut * 50.0);
                    }

                } else if (icType === 'LM7805') {
                    const nOut = getNode(pins.pin3);
                    if (nOut) {
                        addConductance(nOut, '0', 100.0);
                        addCurrentSource(nOut, '0', 5.0 * 100.0);
                    }
                } else if (icType === 'LM7812') {
                    const nOut = getNode(pins.pin3);
                    if (nOut) {
                        addConductance(nOut, '0', 100.0);
                        addCurrentSource(nOut, '0', 12.0 * 100.0);
                    }
                } else if (icType === 'LM317') {
                    const nOut = getNode(pins.pin3);
                    if (nOut) {
                        addConductance(nOut, '0', 100.0);
                        addCurrentSource(nOut, '0', 5.0 * 100.0);
                    }

                } else if (icType === '74HC00') {
                    const inA1 = (comp.vPin1 || 0) > 2.5, inB1 = (comp.vPin2 || 0) > 2.5;
                    const inA2 = (comp.vPin4 || 0) > 2.5, inB2 = (comp.vPin5 || 0) > 2.5;
                    const inA3 = (comp.vPin9 || 0) > 2.5, inB3 = (comp.vPin10 || 0) > 2.5;
                    const inA4 = (comp.vPin12 || 0) > 2.5, inB4 = (comp.vPin13 || 0) > 2.5;

                    driveDigitalPin(pins.pin3, !(inA1 && inB1));
                    driveDigitalPin(pins.pin6, !(inA2 && inB2));
                    driveDigitalPin(pins.pin8, !(inA3 && inB3));
                    driveDigitalPin(pins.pin11, !(inA4 && inB4));

                } else if (icType === '74HC02') {
                    const inA1 = (comp.vPin2 || 0) > 2.5, inB1 = (comp.vPin3 || 0) > 2.5;
                    const inA2 = (comp.vPin5 || 0) > 2.5, inB2 = (comp.vPin6 || 0) > 2.5;
                    const inA3 = (comp.vPin8 || 0) > 2.5, inB3 = (comp.vPin9 || 0) > 2.5;
                    const inA4 = (comp.vPin11 || 0) > 2.5, inB4 = (comp.vPin12 || 0) > 2.5;

                    driveDigitalPin(pins.pin1, !(inA1 || inB1));
                    driveDigitalPin(pins.pin4, !(inA2 || inB2));
                    driveDigitalPin(pins.pin10, !(inA3 || inB3));
                    driveDigitalPin(pins.pin13, !(inA4 || inB4));

                } else if (icType === '74HC04') {
                    driveDigitalPin(pins.pin2, !((comp.vPin1 || 0) > 2.5));
                    driveDigitalPin(pins.pin4, !((comp.vPin3 || 0) > 2.5));
                    driveDigitalPin(pins.pin6, !((comp.vPin5 || 0) > 2.5));
                    driveDigitalPin(pins.pin8, !((comp.vPin9 || 0) > 2.5));
                    driveDigitalPin(pins.pin10, !((comp.vPin11 || 0) > 2.5));
                    driveDigitalPin(pins.pin12, !((comp.vPin13 || 0) > 2.5));

                } else if (icType === '74HC08') {
                    const inA1 = (comp.vPin1 || 0) > 2.5, inB1 = (comp.vPin2 || 0) > 2.5;
                    const inA2 = (comp.vPin4 || 0) > 2.5, inB2 = (comp.vPin5 || 0) > 2.5;
                    const inA3 = (comp.vPin9 || 0) > 2.5, inB3 = (comp.vPin10 || 0) > 2.5;
                    const inA4 = (comp.vPin12 || 0) > 2.5, inB4 = (comp.vPin13 || 0) > 2.5;

                    driveDigitalPin(pins.pin3, inA1 && inB1);
                    driveDigitalPin(pins.pin6, inA2 && inB2);
                    driveDigitalPin(pins.pin8, inA3 && inB3);
                    driveDigitalPin(pins.pin11, inA4 && inB4);

                } else if (icType === '74HC32') {
                    const inA1 = (comp.vPin1 || 0) > 2.5, inB1 = (comp.vPin2 || 0) > 2.5;
                    const inA2 = (comp.vPin4 || 0) > 2.5, inB2 = (comp.vPin5 || 0) > 2.5;
                    const inA3 = (comp.vPin9 || 0) > 2.5, inB3 = (comp.vPin10 || 0) > 2.5;
                    const inA4 = (comp.vPin12 || 0) > 2.5, inB4 = (comp.vPin13 || 0) > 2.5;

                    driveDigitalPin(pins.pin3, inA1 || inB1);
                    driveDigitalPin(pins.pin6, inA2 || inB2);
                    driveDigitalPin(pins.pin8, inA3 || inB3);
                    driveDigitalPin(pins.pin11, inA4 || inB4);

                } else if (icType === '74HC86') {
                    const inA1 = (comp.vPin1 || 0) > 2.5, inB1 = (comp.vPin2 || 0) > 2.5;
                    const inA2 = (comp.vPin4 || 0) > 2.5, inB2 = (comp.vPin5 || 0) > 2.5;
                    const inA3 = (comp.vPin9 || 0) > 2.5, inB3 = (comp.vPin10 || 0) > 2.5;
                    const inA4 = (comp.vPin12 || 0) > 2.5, inB4 = (comp.vPin13 || 0) > 2.5;

                    driveDigitalPin(pins.pin3, (inA1 !== inB1));
                    driveDigitalPin(pins.pin6, (inA2 !== inB2));
                    driveDigitalPin(pins.pin8, (inA3 !== inB3));
                    driveDigitalPin(pins.pin11, (inA4 !== inB4));

                } else if (icType === 'CD4017') {
                    comp.counterState = comp.counterState || 0;
                    const vClk = comp.vPin14 || 0;
                    const vRst = comp.vPin15 || 0;

                    if (vRst > 2.5) {
                        comp.counterState = 0;
                    } else if (comp.lastVClk <= 2.5 && vClk > 2.5) {
                        comp.counterState = (comp.counterState + 1) % 10;
                    }
                    comp.lastVClk = vClk;

                    const qPins = [pins.pin3, pins.pin2, pins.pin4, pins.pin7, pins.pin10, pins.pin1, pins.pin5, pins.pin6, pins.pin9, pins.pin11];
                    qPins.forEach((pKey, idx) => {
                        driveDigitalPin(pKey, idx === comp.counterState);
                    });

                } else if (icType === '74HC595') {
                    comp.shiftReg = comp.shiftReg || 0;
                    comp.latchReg = comp.latchReg || 0;

                    const vSrClk = comp.vPin11 || 0;
                    const vRClk = comp.vPin12 || 0;
                    const vSer = (comp.vPin14 || 0) > 2.5 ? 1 : 0;

                    if (comp.lastVSrClk <= 2.5 && vSrClk > 2.5) {
                        comp.shiftReg = ((comp.shiftReg << 1) | vSer) & 0xFF;
                    }
                    if (comp.lastVRClk <= 2.5 && vRClk > 2.5) {
                        comp.latchReg = comp.shiftReg;
                    }
                    comp.lastVSrClk = vSrClk;
                    comp.lastVRClk = vRClk;

                    const qPins = [pins.pin15, pins.pin1, pins.pin2, pins.pin3, pins.pin4, pins.pin5, pins.pin6, pins.pin7];
                    qPins.forEach((pKey, idx) => {
                        const bit = (comp.latchReg >> idx) & 1;
                        driveDigitalPin(pKey, bit === 1);
                    });

                } else if (icType === 'CD4026') {
                    comp.digitCount = comp.digitCount || 0;
                    const vClk = comp.vPin1 || 0;
                    const vRst = comp.vPin15 || 0;

                    if (vRst > 2.5) {
                        comp.digitCount = 0;
                    } else if (comp.lastVClk <= 2.5 && vClk > 2.5) {
                        comp.digitCount = (comp.digitCount + 1) % 10;
                    }
                    comp.lastVClk = vClk;

                    const segMap = [
                        [1,1,1,1,1,1,0], // 0
                        [0,1,1,0,0,0,0], // 1
                        [1,1,0,1,1,0,1], // 2
                        [1,1,1,1,0,0,1], // 3
                        [0,1,1,0,0,1,1], // 4
                        [1,0,1,1,0,1,1], // 5
                        [1,0,1,1,1,1,1], // 6
                        [1,1,1,0,0,0,0], // 7
                        [1,1,1,1,1,1,1], // 8
                        [1,1,1,1,0,1,1]  // 9
                    ];
                    const activeSegs = segMap[comp.digitCount];
                    const segPins = [pins.pin10, pins.pin12, pins.pin13, pins.pin9, pins.pin11, pins.pin6, pins.pin7];

                    segPins.forEach((pKey, idx) => {
                        driveDigitalPin(pKey, activeSegs[idx] === 1);
                    });
                }
            }
        });

        // 3. Process Independent DC Voltage Sources (VDC)
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

        // 4. Solve System Matrix A * X = Z using Gaussian Elimination
        const X = this.gaussianElimination(A, Z);

        // 5. Extract Node Voltage Map
        const resultMap = new Map();
        resultMap.set('0', 0);
        resultMap.set('GND', 0);
        resultMap.set('NODE_GND', 0);
        resultMap.set('BINDING_GND', 0);

        nonGndNodes.forEach((node, idx) => {
            resultMap.set(node, X ? X[idx] : 0);
        });

        // 6. Update State for Capacitors & Dynamic Components
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
                const pins = this.getDIPPins(comp);
                if (pins) {
                    for (let p = 1; p <= pins.numPins; p++) {
                        const nKey = this.grid.getNodeId(pins[`pin${p}`]);
                        comp[`vPin${p}`] = resultMap.get(nKey) || 0;
                    }

                    if (comp.icType === 'NE555') {
                        comp.lastVCap = comp.vPin2 || 0;
                    } else if (comp.icType === 'NE556') {
                        comp.lastVCap1 = comp.vPin6 || 0;
                        comp.lastVCap2 = comp.vPin8 || 0;
                    } else if (comp.icType === 'LF356' || comp.icType === 'LM741') {
                        comp.lastVMinus = comp.vPin2 || 0;
                        comp.lastVPlus = comp.vPin3 || 0;
                    } else if (comp.icType === 'LM358' || comp.icType === 'LM393') {
                        comp.lastVMinusA = comp.vPin2 || 0;
                        comp.lastVPlusA = comp.vPin3 || 0;
                        comp.lastVMinusB = comp.vPin6 || 0;
                        comp.lastVPlusB = comp.vPin5 || 0;
                    } else if (comp.icType === 'LM386') {
                        comp.lastVMinus = comp.vPin2 || 0;
                        comp.lastVPlus = comp.vPin3 || 0;
                    }
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
            for (let j = i + 1; j < n; j++) {
                sum += A[i][j] * x[j];
            }
            x[i] = (B[i] - sum) / A[i][i];
        }

        return x;
    }
}
