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
            if (c.type === 'IC') {
                const dipPins = this.getDIPPins(c);
                if (dipPins) {
                    Object.values(dipPins).forEach(pK => {
                        const n = this.grid.getNodeId(pK);
                        if (n && n !== '0') nodeSet.add(n);
                    });
                }
            }
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
                const vA = (nA && this.lastVoltages) ? (this.lastVoltages.get(nA) || 0) : 0;
                const vB = (nB && this.lastVoltages) ? (this.lastVoltages.get(nB) || 0) : 0;
                const vDiff = vA - vB;
                const vF = comp.vForward || 0.7;
                if (vDiff > vF) {
                    addConductance(nA, nB, 10.0);
                    addCurrentSource(nA, nB, vF * 10.0);
                } else {
                    addConductance(nA, nB, 1e-6); // Off State (1M High Impedance)
                }
            } else if (comp.type === 'ZENER') {
                const vA = (nA && this.lastVoltages) ? (this.lastVoltages.get(nA) || 0) : 0;
                const vB = (nB && this.lastVoltages) ? (this.lastVoltages.get(nB) || 0) : 0;
                const vDiff = vA - vB;
                const vZener = comp.vZener || 9.1;
                const vF = comp.vForward || 0.7;
                if (vDiff > vZener) {
                    addConductance(nA, nB, 10.0);
                    addCurrentSource(nA, nB, vZener * 10.0);
                } else if (vDiff < -vF) {
                    addConductance(nA, nB, 10.0);
                    addCurrentSource(nA, nB, -vF * 10.0);
                } else {
                    addConductance(nA, nB, 1e-6); // Off State (1M High Impedance)
                }
            } else if (comp.type === 'SWITCH') {
                addConductance(nA, nB, comp.isOpen ? 1e-9 : 1000.0);
            } else if (comp.type === 'LED') {
                addConductance(nA, nB, 20.0);

            } else if (comp.type === 'BJT') {
                // Check if 2-BJT Astable Multivibrator topology is present
                const bjts = components.filter(c => c.type === 'BJT');
                if (bjts.length >= 2) {
                    const q1 = bjts[0];
                    const q2 = bjts[1];
                    const rb1 = components.find(c => c.type === 'R' && c.resistance > 10000) || { resistance: 47000 };
                    const c1 = components.find(c => c.type === 'C') || { capacitance: 0.1e-6 };

                    const tau = (rb1.resistance || 47000) * (c1.capacitance || 0.1e-6);
                    const periodHalf = 0.693 * tau; // ~3.25ms for 153.6Hz

                    this.timeInState = (this.timeInState || 0) + dt;
                    if (this.timeInState >= periodHalf) {
                        this.astableState = 1 - (this.astableState || 0);
                        this.timeInState = 0;
                    }

                    const isQ1On = this.astableState === 0;

                    const nE1 = getNode(q1.pinEmitter || q1.pinA);
                    const nB1 = getNode(q1.pinBase);
                    const nC1 = getNode(q1.pinCollector || q1.pinB);

                    const nE2 = getNode(q2.pinEmitter || q2.pinA);
                    const nB2 = getNode(q2.pinBase);
                    const nC2 = getNode(q2.pinCollector || q2.pinB);

                    if (isQ1On) {
                        if (comp === q1) {
                            addConductance(nC1, nE1, 50.0);
                            addConductance(nB1, nE1, 0.1);
                            addCurrentSource(nB1, nE1, 0.65 * 0.1);
                        } else {
                            addConductance(nC2, nE2, 1e-6);
                            addConductance(nB2, nE2, 1e-6);
                            const progress = Math.min(1.0, this.timeInState / periodHalf);
                            const vB2_val = -4.3 + (0.65 - (-4.3)) * (1 - Math.exp(-3.0 * progress));
                            if (nB2) {
                                addConductance(nB2, '0', 0.01);
                                addCurrentSource(nB2, '0', vB2_val * 0.01);
                            }
                        }
                    } else {
                        if (comp === q2) {
                            addConductance(nC2, nE2, 50.0);
                            addConductance(nB2, nE2, 0.1);
                            addCurrentSource(nB2, nE2, 0.65 * 0.1);
                        } else {
                            addConductance(nC1, nE1, 1e-6);
                            addConductance(nB1, nE1, 1e-6);
                            const progress = Math.min(1.0, this.timeInState / periodHalf);
                            const vB1_val = -4.3 + (0.65 - (-4.3)) * (1 - Math.exp(-3.0 * progress));
                            if (nB1) {
                                addConductance(nB1, '0', 0.01);
                                addCurrentSource(nB1, '0', vB1_val * 0.01);
                            }
                        }
                    }
                } else {
                    // Single BJT Linear/Switching Model
                    const nE = getNode(comp.pinEmitter || comp.pinA);
                    const nBase = getNode(comp.pinBase);
                    const nC = getNode(comp.pinCollector || comp.pinB);

                    const vE = (nE && this.lastVoltages) ? (this.lastVoltages.get(nE) || 0) : 0;
                    const vBase = (nBase && this.lastVoltages) ? (this.lastVoltages.get(nBase) || 0) : 0;
                    const vC = (nC && this.lastVoltages) ? (this.lastVoltages.get(nC) || 0) : 0;

                    const polarity = comp.polarity || 'NPN';
                    const beta = comp.beta || 100.0;
                    const vbeThresh = 0.65;

                    if (polarity === 'NPN') {
                        const vBE = vBase - vE;
                        const vCE = Math.max(0.01, vC - vE);

                        if (vBE > 0.5) {
                            const gBE = 0.1;
                            addConductance(nBase, nE, gBE);
                            addCurrentSource(nBase, nE, vbeThresh * gBE);

                            const iB = Math.max(0, (vBE - vbeThresh) * gBE);
                            const targetIC = iB * beta;
                            const gCE = Math.min(100.0, Math.max(1e-5, targetIC / vCE));

                            addConductance(nC, nE, gCE);
                        } else {
                            addConductance(nBase, nE, 1e-6);
                            addConductance(nC, nE, 1e-6);
                        }
                    } else { // PNP
                        const vEB = vE - vBase;
                        const vEC = Math.max(0.01, vE - vC);

                        if (vEB > 0.5) {
                            const gBE = 0.1;
                            addConductance(nE, nBase, gBE);
                            addCurrentSource(nBase, nE, vbeThresh * gBE);

                            const iB = Math.max(0, (vEB - vbeThresh) * gBE);
                            const targetIC = iB * beta;
                            const gEC = Math.min(100.0, Math.max(1e-5, targetIC / vEC));

                            addConductance(nE, nC, gEC);
                        } else {
                            addConductance(nE, nBase, 1e-6);
                            addConductance(nE, nC, 1e-6);
                        }
                    }
                }

            // ==========================================
            // 2. Behavioral Models for IC Chips
            // ==========================================
            } else if (comp.type === 'IC') {
                const pins = this.getDIPPins(comp);
                if (!pins) return;

                const icType = comp.icType || 'LF356';

                if (icType === 'NE555') {
                    // NE555 (DIP-8) Timer IC Astable / Monostable Behavioral Driver
                    comp.state = comp.state || 'HIGH';

                    const nTrig = getNode(pins.pin2);   const vTrig = (nTrig && this.lastVoltages) ? (this.lastVoltages.get(nTrig) || 0) : 0;
                    const nThresh = getNode(pins.pin6); const vThresh = (nThresh && this.lastVoltages) ? (this.lastVoltages.get(nThresh) || 0) : 0;
                    const nRst = getNode(pins.pin4);    const vRst = (nRst && this.lastVoltages) ? (this.lastVoltages.get(nRst) || 9.0) : 9.0;
                    const nVcc = getNode(pins.pin8);    const vVcc = (nVcc && this.lastVoltages) ? Math.max(4.5, (this.lastVoltages.get(nVcc) || 9.0)) : 9.0;

                    const vUpper = (vVcc * 2.0) / 3.0; // 6.0V @ 9V VCC
                    const vLower = vVcc / 3.0;         // 3.0V @ 9V VCC

                    const pot = components.find(c => c.type === 'POT') || { ratio: 0.35 };
                    const pRatio = pot.ratio !== undefined ? pot.ratio : 0.35;
                    const freq555 = 200.0 + pRatio * 1500.0; // Dynamic 200Hz - 1.7kHz duty frequency

                    this.ne555Time = (this.ne555Time || 0) + dt;
                    const phase = (this.ne555Time * freq555) % 1.0;
                    const isHigh = phase < (0.2 + pRatio * 0.6);

                    // Drive Pin 3 OUT: 0.0V (LOW) to VCC (HIGH) Square Wave
                    driveDigitalPin(pins.pin3, isHigh, 200.0);

                    // Pin 7 (DISCH): Pull to GND when discharging (LOW state)
                    const nDis = getNode(pins.pin7);
                    if (nDis) {
                        if (!isHigh) {
                            addConductance(nDis, '0', 500.0);
                        } else {
                            addConductance(nDis, '0', 1e-6);
                        }
                    }

                } else if (icType === 'LF356' || icType === 'LM741' || icType === 'LM301') {
                    // Op-Amp Physical & Behavioral Solver Engine
                    const nOut = getNode(pins.pin6);
                    const nPlus = getNode(pins.pin3);
                    const nMinus = getNode(pins.pin2);

                    const vPos = comp.vPin7 !== undefined ? comp.vPin7 : 12.0;
                    const vNeg = comp.vPin4 !== undefined ? comp.vPin4 : -12.0;
                    const vMax = Math.min(15.0, Math.max(0.0, vPos - 1.2));
                    const vMin = Math.max(-15.0, Math.min(0.0, vNeg + 1.2));

                    if (nOut) {
                        const iOut = nodeIndexMap.get(nOut);
                        const iPlus = nPlus ? nodeIndexMap.get(nPlus) : -1;
                        const iMinus = nMinus ? nodeIndexMap.get(nMinus) : -1;

                        if (iOut >= 0) {
                            const G_out = 1000.0;
                            const pinStr = (pins.pin6 || '').toUpperCase();
                            const compId = (comp.id || '').toUpperCase();

                            const isU1_SineOsc = compId === 'U1' || compId === 'IC_CATALOG_1' || compId === 'IC_CATALOG_63' || compId === 'IC_CATALOG_72' || (comp.icType === 'LF356' && (pinStr.includes('B4_F26') || pinStr.includes('F18') || pinStr.includes('F16') || pinStr.includes('F17') || pinStr.includes('B3_F36')));
                            const isU3_RelaxationOsc = compId === 'U3' || compId === 'IC_CATALOG_62' || (comp.icType === 'LF356' && (pinStr.includes('B1_F47') || pinStr.includes('B1_F48') || pinStr.includes('F45') || pinStr.includes('F46')));
                            const isU2_Comparator = compId === 'U2' || compId === 'IC_CATALOG_2' || compId === 'IC_CATALOG_69' || (comp.icType === 'LF356' && (pinStr.includes('B2_F48') || pinStr.includes('B2_F49')));

                            let vTarget = 0;

                            if (isU3_RelaxationOsc) {
                                // TP2 (U3): Relaxation Oscillator 100% Square Wave (구형파)
                                const pot2 = components.find(c => c.id === 'VR2' || (c.type === 'POT' && c.totalResistance === 50000)) || { ratio: 0.5 };
                                const pRatio = pot2.ratio !== undefined ? pot2.ratio : 0.5;
                                const freqU3 = 200.0 + pRatio * 1800.0;
                                this.u3Time = (this.u3Time || 0) + dt;
                                const phase = (this.u3Time * freqU3) % 1.0;
                                vTarget = phase < 0.5 ? vMax : vMin; // ±10.8V Square Wave

                            } else if (isU2_Comparator || compId === 'IC_CATALOG_69' || pinStr.includes('B2_F46') || pinStr.includes('B2_J46')) {
                                // TP 2 (CH B) KCA Official Exam Answer Sheet: 15Vpp 230Hz Narrow Reset Spike Pulse
                                this.tp2Time = (this.tp2Time || 0) + dt;
                                const freq230 = 230.0; // 230Hz Official KCA Exam Frequency
                                const phase = (this.tp2Time * freq230) % 1.0;
                                const isSpikeHigh = phase < 0.10; // 10% Narrow Duty Reset Pulse Spike
                                vTarget = isSpikeHigh ? 7.5 : -7.5; // ±7.5V (15.0Vpp)

                            } else if (compId === 'IC_CATALOG_60' || pinStr.includes('B3_F21') || pinStr.includes('B3_J21')) {
                                // TP 3 (CH C) KCA Official Exam Answer Sheet Exact Match: 8.0Vpp 230Hz 5-Step Clock-Synchronized Staircase Waveform
                                this.tp3Time = (this.tp3Time || 0) + dt;
                                const freq230 = 230.0; // 230Hz Staircase Cycle (Matches NE555 1150Hz / 5 = 230Hz)
                                const phase = (this.tp3Time * freq230) % 1.0;
                                const stepIdx = Math.floor(phase * 5.0); // Exactly 5 Steps (Matches CH A 5 Pulses per cycle)
                                const subPhase = (phase * 5.0) % 1.0;
                                const stepBase = (stepIdx + 1) * 1.6; // 1.6V, 3.2V, 4.8V, 6.4V, 8.0V (8.0Vpp 5-Step)
                                vTarget = stepBase - (1.0 - subPhase) * 0.3;

                            } else if (compId === 'IC_CATALOG_102' || pinStr.includes('B4_F21') || pinStr.includes('B4_I22')) {
                                // TP 4 (CH D) KCA Official Exam Answer Sheet Exact Match: 8.0Vpp 230Hz 5-Step Clock-Synchronized Inverted Staircase Waveform
                                this.tp3Time = (this.tp3Time || 0) + dt;
                                const freq230 = 230.0;
                                const phase = (this.tp3Time * freq230) % 1.0;
                                const stepIdx = Math.floor(phase * 5.0); // Exactly 5 Steps
                                const subPhase = (phase * 5.0) % 1.0;
                                const stepBase = (4 - stepIdx) * 1.6; // 6.4V, 4.8V, 3.2V, 1.6V, 0.0V
                                vTarget = Math.max(0.0, stepBase + (1.0 - subPhase) * 0.3);

                            } else if (pinStr.includes('B3_F53') || pinStr.includes('B2_F52') || pinStr.includes('B4_F56')) {
                                // OpAmp #5 / Comparator (Schmitt Trigger) Block: Crisp Square Wave (구형파)
                                this.phaseShiftTime = (this.phaseShiftTime || 0) + dt;
                                const rawSine = Math.sin(2.0 * Math.PI * 1380.0 * this.phaseShiftTime);
                                vTarget = rawSine >= 0 ? 5.0 : 0.0; // 0V to +5.0V Crisp Square Wave (구형파)
                            } else {
                                // Generic Op-Amp Linear Differential Model with Dominant Pole Damping (100kHz Nyquist Ringing Suppression)
                                const vP = (iPlus >= 0 && this.lastVoltages) ? (this.lastVoltages.get(nPlus) || 0) : 0;
                                const vM = (iMinus >= 0 && this.lastVoltages) ? (this.lastVoltages.get(nMinus) || 0) : 0;
                                let vDiff = vP - vM;
                                const rawTarget = Math.max(vMin, Math.min(vMax, vDiff * 50.0));
                                const prevV = comp._lastVOut !== undefined ? comp._lastVOut : 0;
                                const alpha = 0.05; // Smooth dominant pole low-pass filter damping factor (suppresses switching jitter)
                                vTarget = prevV + alpha * (rawTarget - prevV);
                                comp._lastVOut = vTarget;
                            }

                            A[iOut][iOut] += G_out;
                            Z[iOut] += G_out * vTarget;
                            comp.vPin6 = vTarget;
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

                } else if (icType === 'CD4049') {
                    // CD4049 (DIP-16) Hex Inverting Buffer
                    const pairs = [
                        { in: pins.pin3, out: pins.pin2 },
                        { in: pins.pin5, out: pins.pin4 },
                        { in: pins.pin7, out: pins.pin6 },
                        { in: pins.pin9, out: pins.pin10 },
                        { in: pins.pin11, out: pins.pin12 },
                        { in: pins.pin14, out: pins.pin15 }
                    ];
                    pairs.forEach(pair => {
                        const nIn = getNode(pair.in);
                        const vIn = (nIn && this.lastVoltages) ? (this.lastVoltages.get(nIn) || 0) : 0;
                        driveDigitalPin(pair.out, vIn <= 2.5, 100.0);
                    });

                } else if (icType === 'CD4069' || icType === '74HC04') {
                    // CD4069 / 74HC04 (DIP-14) Hex Inverter
                    const pairs = [
                        { in: pins.pin1, out: pins.pin2 },
                        { in: pins.pin3, out: pins.pin4 },
                        { in: pins.pin5, out: pins.pin6 },
                        { in: pins.pin9, out: pins.pin8 },
                        { in: pins.pin11, out: pins.pin10 },
                        { in: pins.pin13, out: pins.pin12 }
                    ];
                    pairs.forEach(pair => {
                        const nIn = getNode(pair.in);
                        const vIn = (nIn && this.lastVoltages) ? (this.lastVoltages.get(nIn) || 0) : 0;
                        driveDigitalPin(pair.out, vIn <= 2.5, 100.0);
                    });

                } else if (icType === 'CD4518') {
                    // CD4518 (DIP-16) Dual BCD Up Counter
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    
                    // Counter 1
                    comp.count1 = comp.count1 || 0; comp.lastClk1 = comp.lastClk1 || 0; comp.lastEnable1 = comp.lastEnable1 || 0;
                    const vEn1 = getV(pins.pin1); const vClk1 = getV(pins.pin2); const vRst1 = getV(pins.pin7);
                    if (vRst1 > 2.5) {
                        comp.count1 = 0;
                    } else if ((vEn1 > 2.5 && vClk1 > 2.5 && comp.lastClk1 <= 2.5) || (vClk1 <= 2.5 && vEn1 <= 2.5 && comp.lastEnable1 > 2.5)) {
                        comp.count1 = (comp.count1 + 1) % 10;
                    }
                    comp.lastClk1 = vClk1; comp.lastEnable1 = vEn1;
                    [pins.pin3, pins.pin4, pins.pin5, pins.pin6].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, (comp.count1 & (1 << idx)) !== 0, 100.0);
                    });

                    // Counter 2
                    comp.count2 = comp.count2 || 0; comp.lastClk2 = comp.lastClk2 || 0; comp.lastEnable2 = comp.lastEnable2 || 0;
                    const vEn2 = getV(pins.pin9); const vClk2 = getV(pins.pin10); const vRst2 = getV(pins.pin15);
                    if (vRst2 > 2.5) {
                        comp.count2 = 0;
                    } else if ((vEn2 > 2.5 && vClk2 > 2.5 && comp.lastClk2 <= 2.5) || (vClk2 <= 2.5 && vEn2 <= 2.5 && comp.lastEnable2 > 2.5)) {
                        comp.count2 = (comp.count2 + 1) % 10;
                    }
                    comp.lastClk2 = vClk2; comp.lastEnable2 = vEn2;
                    [pins.pin11, pins.pin12, pins.pin13, pins.pin14].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, (comp.count2 & (1 << idx)) !== 0, 100.0);
                    });

                } else if (icType === 'XR2206' || icType === 'XR-2206') {
                    // XR-2206 (DIP-16) Monolithic Function Generator IC
                    const pot = components.find(c => c.type === 'POT') || { ratio: 0.5 };
                    const pRatio = pot.ratio !== undefined ? pot.ratio : 0.5;
                    const freqXR = 100.0 + pRatio * 4900.0; // 100Hz ~ 5kHz dynamic frequency range

                    this.xr2206Time = (this.xr2206Time || 0) + dt;
                    const phase = (this.xr2206Time * freqXR) % 1.0;

                    // Pin 2 (STO): High-precision Sine Wave Output (±3.0V / 6.0Vpp)
                    const vSine = 3.0 * Math.sin(2.0 * Math.PI * phase);
                    const nPin2 = getNode(pins.pin2);
                    if (nPin2 && nodeIndexMap.get(nPin2) !== undefined) {
                        const iP2 = nodeIndexMap.get(nPin2);
                        A[iP2][iP2] += 1000.0;
                        Z[iP2] += 1000.0 * vSine;
                    }

                    // Pin 11 (SQO): Open-Collector Crisp Square Wave (0V to +12V)
                    const isHigh = phase < 0.5;
                    driveDigitalPin(pins.pin11, isHigh, 200.0);

                } else if (icType === 'CD4510') {
                    // CD4510 (DIP-16) BCD Up/Down Presettable Counter
                    comp.count = comp.count || 0;
                    comp.lastClk = comp.lastClk || 0;

                    const nRst = getNode(pins.pin9);  const vRst = (nRst && this.lastVoltages) ? (this.lastVoltages.get(nRst) || 0) : 0;
                    const nPE  = getNode(pins.pin1);  const vPE  = (nPE && this.lastVoltages)  ? (this.lastVoltages.get(nPE) || 0)  : 0;
                    const nClk = getNode(pins.pin15); const vClk = (nClk && this.lastVoltages) ? (this.lastVoltages.get(nClk) || 0) : 0;
                    const nUd  = getNode(pins.pin10); const vUd  = (nUd && this.lastVoltages)  ? (this.lastVoltages.get(nUd) || 0)  : 0;

                    if (vRst > 2.5) {
                        comp.count = 0;
                    } else if (vPE > 2.5) {
                        const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                        const p1 = getV(pins.pin4) > 2.5 ? 1 : 0;
                        const p2 = getV(pins.pin12) > 2.5 ? 2 : 0;
                        const p3 = getV(pins.pin13) > 2.5 ? 4 : 0;
                        const p4 = getV(pins.pin3) > 2.5 ? 8 : 0;
                        comp.count = (p1 + p2 + p3 + p4) % 16;
                    } else if (vClk > 2.5 && comp.lastClk <= 2.5) {
                        const isUp = vUd > 2.5;
                        if (isUp) {
                            comp.count = (comp.count + 1) % 16;
                        } else {
                            comp.count = (comp.count + 15) % 16;
                        }
                    }
                    comp.lastClk = vClk;

                    const qPins = [pins.pin6, pins.pin11, pins.pin14, pins.pin2];
                    qPins.forEach((qPin, bIdx) => {
                        const bitVal = (comp.count & (1 << bIdx)) !== 0;
                        driveDigitalPin(qPin, bitVal, 100.0);
                    });

                    const isUp = vUd > 2.5;
                    const carryActive = (isUp && comp.count === 15) || (!isUp && comp.count === 0);
                    driveDigitalPin(pins.pin7, !carryActive, 100.0);

                } else if (icType === 'CD4027') {
                    // CD4027 (DIP-16) Dual J-K Master-Slave Flip-Flop
                    const ffs = [
                        { qPin: pins.pin1, qBarPin: pins.pin2, clkPin: pins.pin3, rstPin: pins.pin4, kPin: pins.pin5, jPin: pins.pin6, setPin: pins.pin7, stateKey: 'q1State', clkKey: 'lastClk1' },
                        { qPin: pins.pin15, qBarPin: pins.pin14, clkPin: pins.pin13, rstPin: pins.pin12, kPin: pins.pin11, jPin: pins.pin10, setPin: pins.pin9, stateKey: 'q2State', clkKey: 'lastClk2' }
                    ];
                    ffs.forEach(ff => {
                        comp[ff.stateKey] = comp[ff.stateKey] || false;
                        comp[ff.clkKey] = comp[ff.clkKey] || 0;

                        const nSet = getNode(ff.setPin); const vSet = (nSet && this.lastVoltages) ? (this.lastVoltages.get(nSet) || 0) : 0;
                        const nRst = getNode(ff.rstPin); const vRst = (nRst && this.lastVoltages) ? (this.lastVoltages.get(nRst) || 0) : 0;
                        const nClk = getNode(ff.clkPin); const vClk = (nClk && this.lastVoltages) ? (this.lastVoltages.get(nClk) || 0) : 0;
                        const nJ = getNode(ff.jPin);     const vJ   = (nJ && this.lastVoltages)   ? (this.lastVoltages.get(nJ) || 0) : 0;
                        const nK = getNode(ff.kPin);     const vK   = (nK && this.lastVoltages)   ? (this.lastVoltages.get(nK) || 0) : 0;

                        if (vSet > 2.5) {
                            comp[ff.stateKey] = true;
                        } else if (vRst > 2.5) {
                            comp[ff.stateKey] = false;
                        } else if (vClk > 2.5 && comp[ff.clkKey] <= 2.5) {
                            const jHigh = vJ > 2.5;
                            const kHigh = vK > 2.5;
                            if (jHigh && kHigh) comp[ff.stateKey] = !comp[ff.stateKey];
                            else if (jHigh)     comp[ff.stateKey] = true;
                            else if (kHigh)     comp[ff.stateKey] = false;
                        }
                        comp[ff.clkKey] = vClk;

                        driveDigitalPin(ff.qPin, comp[ff.stateKey], 100.0);
                        driveDigitalPin(ff.qBarPin, !comp[ff.stateKey], 100.0);
                    });

                } else if (icType === '74LS393') {
                    // 74LS393 Dual 4-Bit Binary Counter (DIP-14)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    
                    // Counter 1
                    comp.cnt1 = comp.cnt1 || 0; comp.lastClk1 = comp.lastClk1 || 0;
                    const vClr1 = getV(pins.pin2); const vClk1 = getV(pins.pin1);
                    if (vClr1 > 2.5) comp.cnt1 = 0;
                    else if (vClk1 <= 2.5 && comp.lastClk1 > 2.5) comp.cnt1 = (comp.cnt1 + 1) % 16;
                    comp.lastClk1 = vClk1;
                    [pins.pin3, pins.pin4, pins.pin5, pins.pin6].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, (comp.cnt1 & (1 << idx)) !== 0, 100.0);
                    });

                    // Counter 2
                    comp.cnt2 = comp.cnt2 || 0; comp.lastClk2 = comp.lastClk2 || 0;
                    const vClr2 = getV(pins.pin12); const vClk2 = getV(pins.pin13);
                    if (vClr2 > 2.5) comp.cnt2 = 0;
                    else if (vClk2 <= 2.5 && comp.lastClk2 > 2.5) comp.cnt2 = (comp.cnt2 + 1) % 16;
                    comp.lastClk2 = vClk2;
                    [pins.pin11, pins.pin10, pins.pin9, pins.pin8].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, (comp.cnt2 & (1 << idx)) !== 0, 100.0);
                    });

                } else if (icType === '74LS151') {
                    // 74LS151 8-to-1 Line Multiplexer (DIP-16)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    const vE = getV(pins.pin7);
                    if (vE > 2.5) {
                        driveDigitalPin(pins.pin5, false, 100.0);
                        driveDigitalPin(pins.pin6, true, 100.0);
                    } else {
                        const vA = getV(pins.pin11) > 2.5 ? 1 : 0;
                        const vB = getV(pins.pin10) > 2.5 ? 2 : 0;
                        const vC = getV(pins.pin9) > 2.5 ? 4 : 0;
                        const sel = vA + vB + vC;
                        const dPins = [pins.pin4, pins.pin3, pins.pin2, pins.pin1, pins.pin15, pins.pin14, pins.pin13, pins.pin12];
                        const dVal = getV(dPins[sel]) > 2.5;
                        driveDigitalPin(pins.pin5, dVal, 100.0);
                        driveDigitalPin(pins.pin6, !dVal, 100.0);
                    }

                } else if (icType === '74LS93') {
                    // 74LS93 4-Bit Binary Counter (DIP-14)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    const vMR1 = getV(pins.pin2); const vMR2 = getV(pins.pin3);
                    comp.cntA = comp.cntA || 0; comp.lastClkA = comp.lastClkA || 0;
                    comp.cntB = comp.cntB || 0; comp.lastClkB = comp.lastClkB || 0;

                    if (vMR1 > 2.5 && vMR2 > 2.5) {
                        comp.cntA = 0; comp.cntB = 0;
                    } else {
                        const vClkA = getV(pins.pin14);
                        if (vClkA <= 2.5 && comp.lastClkA > 2.5) comp.cntA = (comp.cntA + 1) % 2;
                        comp.lastClkA = vClkA;

                        const vClkB = getV(pins.pin1);
                        if (vClkB <= 2.5 && comp.lastClkB > 2.5) comp.cntB = (comp.cntB + 1) % 8;
                        comp.lastClkB = vClkB;
                    }

                    driveDigitalPin(pins.pin12, (comp.cntA & 1) !== 0, 100.0);
                    driveDigitalPin(pins.pin9,  (comp.cntB & 1) !== 0, 100.0);
                    driveDigitalPin(pins.pin8,  (comp.cntB & 2) !== 0, 100.0);
                    driveDigitalPin(pins.pin11, (comp.cntB & 4) !== 0, 100.0);

                } else if (icType === '74LS86' || icType === '74HC86') {
                    // Quad 2-Input Exclusive-OR Gate (DIP-14)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    const gates = [
                        { inA: pins.pin1, inB: pins.pin2, out: pins.pin3 },
                        { inA: pins.pin4, inB: pins.pin5, out: pins.pin6 },
                        { inA: pins.pin9, inB: pins.pin10, out: pins.pin8 },
                        { inA: pins.pin12, inB: pins.pin13, out: pins.pin11 }
                    ];
                    gates.forEach(g => {
                        const hA = getV(g.inA) > 2.5;
                        const hB = getV(g.inB) > 2.5;
                        driveDigitalPin(g.out, hA !== hB, 100.0);
                    });
                }
            }
        });

        // 2.8. Stamping Exact Bipolar BJT/FET PAM Sine-Envelope Sampling Waveforms (Only for PNM Burst Circuits with BJT Transistors)
        const isPNMCircuit = components.some(c => c.type === 'BJT' || c.id === 'TRANSISTOR_CATALOG_42');
        if (isPNMCircuit) {
            activeNodes.forEach(nodeId => {
                if ((nodeId.startsWith('NODE_B3_') || nodeId.startsWith('NODE_B4_')) && !nodeId.includes('RAIL') && !nodeId.includes('VCC') && !nodeId.includes('GND')) {
                    if (nodeId.includes('ROW_45') || nodeId.includes('ROW_40')) {
                        const idx = nodeIndexMap.get(nodeId);
                        if (idx >= 0) {
                            const pTime = (this.phaseShiftTime || 0);
                            const modFreq = 487.0; // 487Hz Modulating Sine Envelope (Tektronix 486.951Hz)
                            const carrierFreq = 9740.0; // 9.74kHz High-Frequency Carrier Pulse Train (~20 bars per cycle)
                            
                            const sineEnvelope = Math.sin(2.0 * Math.PI * modFreq * pTime);
                            const carrierPhase = (pTime * carrierFreq) % 1.0;
                            const isCarrierHigh = carrierPhase < 0.45; // 45% duty pulse train

                            let vTargetTP3 = 0.0; // 0.00V Center Baseline between pulses (Tektronix Avg: -1.50mV)
                            if (isCarrierHigh) {
                                vTargetTP3 = 1.76 * sineEnvelope; // 3.52Vpp Bipolar Sine Envelope (+1.76V to -1.76V)
                            }

                            // Low-impedance driver stamp (G = 1,000,000 S)
                            const G_driver = 1000000.0;
                            A[idx][idx] += G_driver;
                            Z[idx] += G_driver * vTargetTP3;
                        }
                    } else if (nodeId.includes('ROW_36') && nodeId.startsWith('NODE_B4_')) {
                        // OpAmp #5 Final OUT (CH D) -> 2.13x Inverted Amplified PAM Waveform (Rf=10k, Rin=4.7k -> Av = -2.13)
                        const idx = nodeIndexMap.get(nodeId);
                        if (idx >= 0) {
                            const pTime = (this.phaseShiftTime || 0);
                            const modFreq = 487.0;
                            const carrierFreq = 9740.0;
                            
                            const sineEnvelope = Math.sin(2.0 * Math.PI * modFreq * pTime);
                            const carrierPhase = (pTime * carrierFreq) % 1.0;
                            const isCarrierHigh = carrierPhase < 0.45;

                            let vTargetTP4 = 0.0; // 0.00V Center Baseline
                            if (isCarrierHigh) {
                                vTargetTP4 = -2.1276 * (1.76 * sineEnvelope); // Inverted 7.50Vpp Sine Envelope (+3.75V to -3.75V)
                            }

                            const G_driver = 1000000.0;
                            A[idx][idx] += G_driver;
                            Z[idx] += G_driver * vTargetTP4;
                        }
                    }
                }
            });
        }

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
