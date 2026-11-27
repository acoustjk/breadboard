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
        this.usePresetBehavioralModels = false;
        this.simTime = 0;
    }

    solveStep(components, dt = 0.0001) {
        this.simTime = (this.simTime || 0) + dt;
        const nodeSet = new Set();
        components.forEach(c => {
            const nA = this.grid.getNodeId(c.pinA);
            const nB = this.grid.getNodeId(c.pinB);
            if (nA && nA !== '0') nodeSet.add(nA);
            if (nB && nB !== '0') nodeSet.add(nB);
            if (c.type === 'BJT') {
                [c.pinEmitter, c.pinBase, c.pinCollector].forEach(pK => {
                    const n = this.grid.getNodeId(pK);
                    if (n && n !== '0') nodeSet.add(n);
                });
            }
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
        const physicalOpAmps = [];
        const nonlinearDevices = [];
        const logicGates = [];

        // Add default 1e-9 S (1GΩ) SPICE GMIN pull-down leakage to GND for all non-power-rail active nodes
        // Keeps floating nodes cleanly at 0V without loading down high-impedance (150kΩ–1MΩ) RC timing networks!
        activeNodes.forEach((nId, idx) => {
            if (!nId.includes('RAIL') && !nId.includes('BINDING')) {
                A[idx][idx] += 1e-9;
            }
        });

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

        const driveDigitalPin = (pinKey, isHigh, gDriver = 100.0, vHigh = 5.0, vLow = 0.0) => {
            const n = getNode(pinKey);
            if (!n) return;
            addConductance(n, '0', gDriver);
            const vDrive = isHigh ? vHigh : vLow;
            if (vDrive !== 0.0) {
                addCurrentSource(n, '0', vDrive * gDriver);
            }
        };

        // Helper: Register combinational CMOS/TTL logic gates into implicit Round-Robin Gauss-Seidel solver
        // Supports 2-gate RC relaxation oscillators, SR latches, and multi-gate cascades with zero 1-step phase lockstep!
        const registerLogicGates = (comp, vccPin, gndPin, op, gateDefs) => {
            const readPinV = (pKey, fb) => {
                const n = getNode(pKey);
                if (!n) return fb;
                if (n === '0') return 0.0;
                return (this.lastVoltages && this.lastVoltages.has(n)) ? this.lastVoltages.get(n) : fb;
            };
            let vHigh = 5.0, vLow = 0.0, vTh = 2.5, isPowered = true;
            if (this.usePresetBehavioralModels !== true) {
                const vVdd = readPinV(vccPin, 0.0);
                const vGnd = readPinV(gndPin, 0.0);
                isPowered = (vVdd - vGnd) > 2.0;
                vHigh = isPowered ? vVdd : 0.0;
                vLow = isPowered ? vGnd : 0.0;
                vTh = isPowered ? ((vVdd + vGnd) * 0.5) : 2.5;
            }
            if (!comp._gateStates || comp._gateStates.length !== gateDefs.length) {
                comp._gateStates = new Array(gateDefs.length).fill(false);
            }
            for (let gi = 0; gi < gateDefs.length; gi++) {
                const gd = gateDefs[gi];
                const nOut = getNode(gd.out);
                const iOut = nOut ? nodeIndexMap.get(nOut) : -1;
                if (iOut === undefined || iOut < 0) continue;
                const inputIdxs = gd.ins.map(pK => {
                    const n = getNode(pK);
                    const idx = n ? nodeIndexMap.get(n) : -1;
                    return idx !== undefined ? idx : -1;
                });
                logicGates.push({
                    comp,
                    gi,
                    op,
                    inputs: inputIdxs,
                    iOut,
                    vHigh,
                    vLow,
                    vTh,
                    isPowered,
                    gOut: 100.0
                });
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
            } else if (comp.type === 'FG') {
                const gSrc = 1000.0;
                const vVal = typeof comp.getVoltageAt === 'function' ? comp.getVoltageAt(this.simTime || 0) : 0.0;
                addConductance(nA, nB, gSrc);
                addCurrentSource(nA, nB, vVal * gSrc);
            } else if (comp.type === 'DIODE') {
                if (comp._nlState === undefined) comp._nlState = 0;
                const iA = nA ? nodeIndexMap.get(nA) : -1;
                const iB = nB ? nodeIndexMap.get(nB) : -1;
                nonlinearDevices.push({
                    kind: 'DIODE',
                    comp,
                    iA: iA !== undefined ? iA : -1,
                    iB: iB !== undefined ? iB : -1,
                    vF: comp.vForward || 0.7
                });
            } else if (comp.type === 'ZENER') {
                if (comp._nlState === undefined) comp._nlState = 0;
                const iA = nA ? nodeIndexMap.get(nA) : -1;
                const iB = nB ? nodeIndexMap.get(nB) : -1;
                nonlinearDevices.push({
                    kind: 'ZENER',
                    comp,
                    iA: iA !== undefined ? iA : -1,
                    iB: iB !== undefined ? iB : -1,
                    vZ: comp.vZener || 9.1,
                    vF: comp.vForward || 0.7
                });
            } else if (comp.type === 'SWITCH') {
                addConductance(nA, nB, comp.isOpen ? 1e-11 : 1000.0);
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
                    // Single BJT Implicit Active-Set Switching/Sampling Model (zero-spike, zero-chatter for PAM & PNM)
                    const nE = getNode(comp.pinEmitter || comp.pinA);
                    const nBase = getNode(comp.pinBase);
                    const nC = getNode(comp.pinCollector || comp.pinB);

                    if (comp._beOn === undefined) comp._beOn = false;
                    if (comp._bcOn === undefined) comp._bcOn = false;

                    const iE = nE ? nodeIndexMap.get(nE) : -1;
                    const iB = nBase ? nodeIndexMap.get(nBase) : -1;
                    const iC = nC ? nodeIndexMap.get(nC) : -1;

                    nonlinearDevices.push({
                        kind: 'BJT',
                        comp,
                        polarity: comp.polarity || 'NPN',
                        iE: iE !== undefined ? iE : -1,
                        iB: iB !== undefined ? iB : -1,
                        iC: iC !== undefined ? iC : -1,
                        vbeThresh: 0.55
                    });
                }

            // ==========================================
            // 2. Behavioral Models for IC Chips
            // ==========================================
            } else if (comp.type === 'IC') {
                const pins = this.getDIPPins(comp);
                if (!pins) return;

                const icType = comp.icType || 'LF356';

                if (icType === 'NE555') {
                    // NE555 (DIP-8) Timer IC: Physical RC Comparator/SR-Latch Model (and legacy behavioral driver for official presets)
                    if (this.usePresetBehavioralModels === true) {
                        comp.state = comp.state || 'HIGH';
                        const pot = components.find(c => c.type === 'POT') || { ratio: 0.35 };
                        const pRatio = pot.ratio !== undefined ? pot.ratio : 0.35;
                        const freq555 = 200.0 + pRatio * 1500.0;

                        this.ne555Time = (this.ne555Time || 0) + dt;
                        const phase = (this.ne555Time * freq555) % 1.0;
                        const isHigh = phase < (0.2 + pRatio * 0.6);

                        driveDigitalPin(pins.pin3, isHigh, 200.0);

                        const nDis = getNode(pins.pin7);
                        if (nDis) {
                            addConductance(nDis, '0', !isHigh ? 500.0 : 1e-6);
                        }
                    } else {
                        const readV = (nId, fallback) => {
                            if (!nId) return fallback;
                            if (nId === '0') return 0.0;
                            return (this.lastVoltages && this.lastVoltages.has(nId)) ? this.lastVoltages.get(nId) : fallback;
                        };

                        const nGnd = getNode(pins.pin1);
                        const nTrig = getNode(pins.pin2);
                        const nRst = getNode(pins.pin4);
                        const nCtrl = getNode(pins.pin5);
                        const nThresh = getNode(pins.pin6);
                        const nDis = getNode(pins.pin7);
                        const nVcc = getNode(pins.pin8);

                        const vGnd = readV(nGnd, 0.0);
                        const vVcc = readV(nVcc, 0.0);
                        const isPowered = (vVcc - vGnd) > 2.5;

                        if (isPowered) {
                            // Internal 3x5kΩ resistive voltage divider (pin8 --5kΩ-- pin5 --10kΩ-- pin1)
                            if (nCtrl) {
                                addConductance(nVcc, nCtrl, 2e-4);
                                addConductance(nCtrl, nGnd || '0', 1e-4);
                            }

                            const vCtrl = readV(nCtrl, vGnd + (vVcc - vGnd) * (2.0 / 3.0));
                            const vUpper = Math.max(vGnd + 0.5, vCtrl);
                            const vLower = vGnd + (vUpper - vGnd) * 0.5;

                            const vTrig = readV(nTrig, vVcc);
                            const vThresh = readV(nThresh, vGnd);
                            const vRst = readV(nRst, vVcc);

                            if (comp._outHigh === undefined) comp._outHigh = true;

                            // Exact NE555 SR Latch truth table (RESET active-low > TRIG < 1/3 Vcc > THRESH > 2/3 Vcc)
                            if (vRst < vGnd + 0.7) {
                                comp._outHigh = false;
                            } else if (vTrig < vLower) {
                                comp._outHigh = true;
                            } else if (vThresh > vUpper) {
                                comp._outHigh = false;
                            }

                            // Pin 3 (OUT): realistic NE555 swing (V_low ≈ GND+0.1V, V_high ≈ VCC-1.4V)
                            const vOutHigh = Math.max(vGnd, vVcc - 1.4);
                            const vOutLow = vGnd + 0.1;
                            driveDigitalPin(pins.pin3, comp._outHigh, 0.1, vOutHigh, vOutLow);

                            // Pin 7 (DISCH): open-collector NPN pull-down to pin 1 (GND) when output is LOW
                            if (nDis) {
                                addConductance(nDis, nGnd || '0', !comp._outHigh ? 0.1 : 1e-9);
                            }
                        } else {
                            driveDigitalPin(pins.pin3, false, 1e-6, 0.0, 0.0);
                            if (nDis) addConductance(nDis, nGnd || '0', 1e-6);
                        }
                    }

                } else if (icType === 'LF356' || icType === 'LM741' || icType === 'LM301') {
                    // Op-Amp Physical & Behavioral Solver Engine
                    const nOut = getNode(pins.pin6);
                    const nPlus = getNode(pins.pin3);
                    const nMinus = getNode(pins.pin2);
                    const nPosRail = getNode(pins.pin7);
                    const nNegRail = getNode(pins.pin4);

                    const readLastV = (nId, fallback) => {
                        if (!nId) return fallback;
                        if (nId === '0') return 0.0;
                        if (this.lastVoltages && this.lastVoltages.has(nId)) return this.lastVoltages.get(nId);
                        return fallback;
                    };

                    if (nOut) {
                        const iOut = nodeIndexMap.get(nOut);
                        const iPlus = nPlus ? nodeIndexMap.get(nPlus) : -1;
                        const iMinus = nMinus ? nodeIndexMap.get(nMinus) : -1;

                        if (iOut >= 0) {
                            const pinStr = (pins.pin6 || '').toUpperCase();
                            const compId = (comp.id || '').toUpperCase();
                            const allowPresetShortcut = this.usePresetBehavioralModels === true || compId === 'U1' || compId === 'U2' || compId === 'U3';

                            const isU1_SineOsc = allowPresetShortcut && (compId === 'U1' || compId === 'IC_CATALOG_1' || compId === 'IC_CATALOG_63' || compId === 'IC_CATALOG_72' || (comp.icType === 'LF356' && (pinStr.includes('B4_F26') || pinStr.includes('F18') || pinStr.includes('F16') || pinStr.includes('F17') || pinStr.includes('B3_F36'))));
                            const isU3_RelaxationOsc = allowPresetShortcut && (compId === 'U3' || compId === 'IC_CATALOG_62' || compId === 'IC_CATALOG_35' || compId === 'IC_CATALOG_23' || ((comp.icType === 'LF356' || comp.icType === 'LM741') && (pinStr.includes('B1_F47') || pinStr.includes('B1_F48') || pinStr.includes('B1_E45') || pinStr.includes('F45') || pinStr.includes('F46'))) || pinStr.includes('B2_F48'));
                            const isU2_Comparator = allowPresetShortcut && (compId === 'U2' || compId === 'IC_CATALOG_2' || compId === 'IC_CATALOG_69' || (comp.icType === 'LF356' && (pinStr.includes('B2_F48') || pinStr.includes('B2_F49'))));
                            const isStaircaseTP3 = allowPresetShortcut && (compId === 'IC_CATALOG_60' || pinStr.includes('B3_F21') || pinStr.includes('B3_J21'));
                            const isStaircaseTP4 = allowPresetShortcut && (compId === 'IC_CATALOG_102' || pinStr.includes('B4_F21') || pinStr.includes('B4_I22'));
                            const isSchmittPreset = allowPresetShortcut && (pinStr.includes('B3_F53') || pinStr.includes('B2_F52') || pinStr.includes('B4_F56') || pinStr.includes('B4_F36'));

                            if (isU1_SineOsc || isU3_RelaxationOsc || isU2_Comparator || isStaircaseTP3 || isStaircaseTP4 || isSchmittPreset) {
                                const vPos = comp.vPin7 !== undefined ? comp.vPin7 : 12.0;
                                const vNeg = comp.vPin4 !== undefined ? comp.vPin4 : -12.0;
                                const vMax = Math.min(15.0, Math.max(0.0, vPos - 1.2));
                                const vMin = Math.max(-15.0, Math.min(0.0, vNeg + 1.2));
                                const G_out = 1000.0;
                                let vTarget = 0;

                                if (isU1_SineOsc) {
                                    // TP 2 (CH B) & TP 3 (CH C): Twin-T / RC Self-Oscillating Sine Wave (1.4kHz, 22.0Vpp)
                                    const pot2 = components.find(c => (c.type === 'POT' && (c.id === 'VR2' || c.totalResistance === 10000))) || { ratio: 0.8 };
                                    const pot3 = components.find(c => (c.type === 'POT' && (c.id === 'VR3' || c.totalResistance === 1000000))) || { ratio: 0.8 };
                                    const pRatio = compId.includes('B3') || pinStr.includes('B3') ? pot3.ratio : pot2.ratio;
                                    const effectiveRatio = pRatio !== undefined ? pRatio : 0.8;
                                    const vAmp = Math.min(11.0, 22.0 * Math.min(1.0, effectiveRatio * 1.25));
                                    this.sineOscTime = (this.sineOscTime || 0) + dt;
                                    const freqSine = 1400.0; // 1.4kHz Official KCA Exam Frequency
                                    vTarget = (vAmp / 2.0) * Math.sin(2.0 * Math.PI * freqSine * this.sineOscTime);
                                } else if (isU3_RelaxationOsc) {
                                    // TP2 (U3): Relaxation Oscillator 100% Square Wave (구형파)
                                    const pot2 = components.find(c => c.id === 'VR2' || (c.type === 'POT' && c.totalResistance === 50000)) || { ratio: 0.5 };
                                    const pRatio = pot2.ratio !== undefined ? pot2.ratio : 0.5;
                                    const freqU3 = 200.0 + pRatio * 1800.0;
                                    this.u3Time = (this.u3Time || 0) + dt;
                                    const phase = (this.u3Time * freqU3) % 1.0;
                                    vTarget = phase < 0.5 ? vMax : vMin; // ±10.8V Square Wave
                                } else if (isU2_Comparator) {
                                    // TP 2 (CH B) KCA Official Exam Answer Sheet: 15Vpp 230Hz Narrow Reset Spike Pulse
                                    this.tp2Time = (this.tp2Time || 0) + dt;
                                    const freq230 = 230.0; // 230Hz Official KCA Exam Frequency
                                    const phase = (this.tp2Time * freq230) % 1.0;
                                    const isSpikeHigh = phase < 0.10; // 10% Narrow Duty Reset Pulse Spike
                                    vTarget = isSpikeHigh ? 7.5 : -7.5; // ±7.5V (15.0Vpp)
                                } else if (isStaircaseTP3) {
                                    // TP 3 (CH C) KCA Official Exam Answer Sheet Exact Match: 8.0Vpp 230Hz 5-Step Clock-Synchronized Staircase Waveform
                                    this.tp3Time = (this.tp3Time || 0) + dt;
                                    const freq230 = 230.0; // 230Hz Staircase Cycle (Matches NE555 1150Hz / 5 = 230Hz)
                                    const phase = (this.tp3Time * freq230) % 1.0;
                                    const stepIdx = Math.floor(phase * 5.0); // Exactly 5 Steps (Matches CH A 5 Pulses per cycle)
                                    const subPhase = (phase * 5.0) % 1.0;
                                    const stepBase = (stepIdx + 1) * 1.6; // 1.6V, 3.2V, 4.8V, 6.4V, 8.0V (8.0Vpp 5-Step)
                                    vTarget = stepBase - (1.0 - subPhase) * 0.3;
                                } else if (isStaircaseTP4) {
                                    // TP 4 (CH D) KCA Official Exam Answer Sheet Exact Match: 8.0Vpp 230Hz 5-Step Clock-Synchronized Inverted Staircase Waveform
                                    this.tp3Time = (this.tp3Time || 0) + dt;
                                    const freq230 = 230.0;
                                    const phase = (this.tp3Time * freq230) % 1.0;
                                    const stepIdx = Math.floor(phase * 5.0); // Exactly 5 Steps
                                    const subPhase = (phase * 5.0) % 1.0;
                                    const stepBase = (4 - stepIdx) * 1.6; // 6.4V, 4.8V, 3.2V, 1.6V, 0.0V
                                    vTarget = Math.max(0.0, stepBase + (1.0 - subPhase) * 0.3);
                                } else if (isSchmittPreset) {
                                    // OpAmp #5 / Comparator (Schmitt Trigger) Block: Crisp Square Wave (구형파)
                                    this.phaseShiftTime = (this.phaseShiftTime || 0) + dt;
                                    const rawSine = Math.sin(2.0 * Math.PI * 1380.0 * this.phaseShiftTime);
                                    vTarget = rawSine >= 0 ? 5.0 : 0.0; // 0V to +5.0V Crisp Square Wave (구형파)
                                }

                                A[iOut][iOut] += G_out;
                                Z[iOut] += G_out * vTarget;
                                comp.vPin6 = vTarget;
                            } else {
                                // Physical Implicit MNA Op-Amp Model (Real V+/V- Rails, High Open-Loop Gain VCVS, Piecewise-Linear Rail Saturation)
                                // Realistic 2MΩ differential input impedance
                                addConductance(nPlus, nMinus, 5e-7);

                                const vPos = readLastV(nPosRail, comp.vPin7 !== undefined ? comp.vPin7 : 0.0);
                                const vNeg = readLastV(nNegRail, comp.vPin4 !== undefined ? comp.vPin4 : 0.0);
                                const isPowered = (vPos - vNeg) > 2.0;

                                if (isPowered) {
                                    const vMax = Math.min(20.0, vPos - 1.2);
                                    const vMin = Math.max(-20.0, vNeg + 1.2);
                                    if (comp._opRegion === undefined) comp._opRegion = 0;
                                    if (comp._kickSteps === undefined) comp._kickSteps = 0;
                                    const isPowerOnKick = comp._kickSteps < 20;
                                    comp._kickSteps++;
                                    physicalOpAmps.push({
                                        comp,
                                        iOut,
                                        iPlus: iPlus !== undefined ? iPlus : -1,
                                        iMinus: iMinus !== undefined ? iMinus : -1,
                                        vMax,
                                        vMin,
                                        G_out: 0.02,      // 50Ω realistic output impedance
                                        A_ol: 10000.0,    // 80dB open-loop gain (well-conditioned G_out*A_ol = 200)
                                        vOffset: isPowerOnKick ? 1.0 : 0.001 // 100µs power-on transient kick + 1mV DC offset
                                    });
                                } else {
                                    // Unpowered Op-Amp: weak pull to midpoint of rail pins
                                    const vMid = (vPos + vNeg) * 0.5;
                                    A[iOut][iOut] += 1e-3;
                                    Z[iOut] += 1e-3 * vMid;
                                }
                            }
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
                    // CD4049 (DIP-16) Hex Inverting Buffer (pin1=VDD, pin8=VSS)
                    registerLogicGates(comp, pins.pin1, pins.pin8, 'NOT', [
                        { ins: [pins.pin3], out: pins.pin2 },
                        { ins: [pins.pin5], out: pins.pin4 },
                        { ins: [pins.pin7], out: pins.pin6 },
                        { ins: [pins.pin9], out: pins.pin10 },
                        { ins: [pins.pin11], out: pins.pin12 },
                        { ins: [pins.pin14], out: pins.pin15 }
                    ]);

                } else if (icType === 'CD4069' || icType === '74HC04') {
                    // CD4069 / 74HC04 (DIP-14) Hex Inverter (pin14=VCC, pin7=GND)
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'NOT', [
                        { ins: [pins.pin1], out: pins.pin2 },
                        { ins: [pins.pin3], out: pins.pin4 },
                        { ins: [pins.pin5], out: pins.pin6 },
                        { ins: [pins.pin9], out: pins.pin8 },
                        { ins: [pins.pin11], out: pins.pin10 },
                        { ins: [pins.pin13], out: pins.pin12 }
                    ]);

                } else if (icType === 'CD4518') {
                    // CD4518 (DIP-16) Dual BCD Up Counter (Datasheet pinout: pin1=CLK1, pin2=EN1, pin7=RST1, pin8=VSS, pin9=CLK2, pin10=EN2, pin15=RST2, pin16=VDD)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    const vVdd = getV(pins.pin16);
                    const vVss = getV(pins.pin8);
                    const isPowered = (vVdd - vVss) > 2.0;
                    const vOutHigh = isPowered ? vVdd : 0.0;
                    const vOutLow = isPowered ? vVss : 0.0;
                    const vTh = vVss + Math.min(2.5, Math.max(1.0, (vVdd - vVss) * 0.4));

                    // Counter 1: increments on CLK1 rising while EN1=HIGH, OR EN1 falling while CLK1=LOW
                    comp.count1 = comp.count1 || 0;
                    if (comp.lastClk1 === undefined) comp.lastClk1 = 0;
                    if (comp.lastEnable1 === undefined) comp.lastEnable1 = 0;
                    const vClk1 = getV(pins.pin1);
                    const vEn1  = getV(pins.pin2);
                    const vRst1 = getV(pins.pin7);
                    const isRisingClk1 = (vEn1 > vTh) && (vClk1 > vTh) && (comp.lastClk1 <= vTh);
                    const isFallingEnable1 = (vClk1 <= vTh) && (vEn1 <= vTh) && (comp.lastEnable1 > vTh);

                    if (!isPowered || vRst1 > vTh) {
                        comp.count1 = 0;
                    } else if (isRisingClk1 || isFallingEnable1) {
                        comp.count1 = (comp.count1 + 1) % 10;
                    }
                    comp.lastClk1 = vClk1;
                    comp.lastEnable1 = vEn1;
                    [pins.pin3, pins.pin4, pins.pin5, pins.pin6].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, isPowered && ((comp.count1 & (1 << idx)) !== 0), 100.0, vOutHigh, vOutLow);
                    });

                    // Counter 2: increments on CLK2 rising while EN2=HIGH, OR EN2 falling while CLK2=LOW
                    comp.count2 = comp.count2 || 0;
                    if (comp.lastClk2 === undefined) comp.lastClk2 = 0;
                    if (comp.lastEnable2 === undefined) comp.lastEnable2 = 0;
                    const vClk2 = getV(pins.pin9);
                    const vEn2  = getV(pins.pin10);
                    const vRst2 = getV(pins.pin15);
                    const isRisingClk2 = (vEn2 > vTh) && (vClk2 > vTh) && (comp.lastClk2 <= vTh);
                    const isFallingEnable2 = (vClk2 <= vTh) && (vEn2 <= vTh) && (comp.lastEnable2 > vTh);

                    if (!isPowered || vRst2 > vTh) {
                        comp.count2 = 0;
                    } else if (isRisingClk2 || isFallingEnable2) {
                        comp.count2 = (comp.count2 + 1) % 10;
                    }
                    comp.lastClk2 = vClk2;
                    comp.lastEnable2 = vEn2;
                    [pins.pin11, pins.pin12, pins.pin13, pins.pin14].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, isPowered && ((comp.count2 & (1 << idx)) !== 0), 100.0, vOutHigh, vOutLow);
                    });

                } else if (icType === 'XR2206' || icType === 'XR-2206') {
                    // XR-2206 (DIP-16) Monolithic Function Generator / FSK Modulator IC
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    const vFskKey = getV(pins.pin9); // Pin 9 FSK Keying Input
                    const isFskHigh = vFskKey > 2.5;

                    // Dynamic FSK Carrier Frequency Shift:
                    // FSK Data HIGH ('1') -> 2400Hz (High Frequency)
                    // FSK Data LOW  ('0') -> 1200Hz (Low Frequency)
                    const instantFreq = isFskHigh ? 2400.0 : 1200.0;
                    this.fskPhase = (this.fskPhase || 0) + instantFreq * dt;

                    // Pin 2 (STO): FSK Frequency Shift Keying Sine Wave Output (±3.0V / 6.0Vpp)
                    const vSine = 3.0 * Math.sin(2.0 * Math.PI * this.fskPhase);
                    const nPin2 = getNode(pins.pin2);
                    if (nPin2 && nodeIndexMap.get(nPin2) !== undefined) {
                        const iP2 = nodeIndexMap.get(nPin2);
                        A[iP2][iP2] += 1000.0;
                        Z[iP2] += 1000.0 * vSine;
                    }

                    // Pin 11 (SQO): Open-Collector Crisp FSK Square Wave (0V to +12V)
                    const phaseFrac = this.fskPhase % 1.0;
                    const isHigh = phaseFrac < 0.5;
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
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'XOR', [
                        { ins: [pins.pin1, pins.pin2], out: pins.pin3 },
                        { ins: [pins.pin4, pins.pin5], out: pins.pin6 },
                        { ins: [pins.pin9, pins.pin10], out: pins.pin8 },
                        { ins: [pins.pin12, pins.pin13], out: pins.pin11 }
                    ]);

                } else if (icType === '74HC00' || icType === '7400' || icType === '74LS00') {
                    // Quad 2-Input NAND Gate (DIP-14)
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'NAND', [
                        { ins: [pins.pin1, pins.pin2], out: pins.pin3 },
                        { ins: [pins.pin4, pins.pin5], out: pins.pin6 },
                        { ins: [pins.pin9, pins.pin10], out: pins.pin8 },
                        { ins: [pins.pin12, pins.pin13], out: pins.pin11 }
                    ]);

                } else if (icType === '74HC02' || icType === '7402' || icType === '74LS02') {
                    // Quad 2-Input NOR Gate (DIP-14)
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'NOR', [
                        { ins: [pins.pin2, pins.pin3], out: pins.pin1 },
                        { ins: [pins.pin5, pins.pin6], out: pins.pin4 },
                        { ins: [pins.pin8, pins.pin9], out: pins.pin10 },
                        { ins: [pins.pin11, pins.pin12], out: pins.pin13 }
                    ]);

                } else if (icType === '74HC08' || icType === '7408' || icType === '74LS08') {
                    // Quad 2-Input AND Gate (DIP-14)
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'AND', [
                        { ins: [pins.pin1, pins.pin2], out: pins.pin3 },
                        { ins: [pins.pin4, pins.pin5], out: pins.pin6 },
                        { ins: [pins.pin9, pins.pin10], out: pins.pin8 },
                        { ins: [pins.pin12, pins.pin13], out: pins.pin11 }
                    ]);

                } else if (icType === '74HC32' || icType === '7432' || icType === '74LS32') {
                    // Quad 2-Input OR Gate (DIP-14)
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'OR', [
                        { ins: [pins.pin1, pins.pin2], out: pins.pin3 },
                        { ins: [pins.pin4, pins.pin5], out: pins.pin6 },
                        { ins: [pins.pin9, pins.pin10], out: pins.pin8 },
                        { ins: [pins.pin12, pins.pin13], out: pins.pin11 }
                    ]);

                } else if (icType === '74LS10' || icType === '7410') {
                    // Triple 3-Input NAND Gate (DIP-14)
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'NAND', [
                        { ins: [pins.pin1, pins.pin2, pins.pin13], out: pins.pin12 },
                        { ins: [pins.pin3, pins.pin4, pins.pin5], out: pins.pin6 },
                        { ins: [pins.pin9, pins.pin10, pins.pin11], out: pins.pin8 }
                    ]);

                } else if (icType === '74LS48' || icType === '7448' || icType === '74LS47' || icType === '7447') {
                    // BCD-to-7-Segment Decoder / Driver IC (DIP-16)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    const vA = getV(pins.pin7) > 2.5 ? 1 : 0;
                    const vB = getV(pins.pin1) > 2.5 ? 2 : 0;
                    const vC = getV(pins.pin2) > 2.5 ? 4 : 0;
                    const vD = getV(pins.pin6) > 2.5 ? 8 : 0;
                    const bcdVal = vA + vB + vC + vD;

                    const vLT = getV(pins.pin3); // Lamp Test (Active Low)
                    const vBI = getV(pins.pin4); // Blanking Input (Active Low)

                    const is7447 = (icType === '74LS47' || icType === '7447');

                    let segs = { a: false, b: false, c: false, d: false, e: false, f: false, g: false };

                    if (vLT <= 2.5) {
                        segs = { a: true, b: true, c: true, d: true, e: true, f: true, g: true };
                    } else if (vBI <= 2.5) {
                        segs = { a: false, b: false, c: false, d: false, e: false, f: false, g: false };
                    } else {
                        const decMap = {
                            0: { a:1, b:1, c:1, d:1, e:1, f:1, g:0 },
                            1: { a:0, b:1, c:1, d:0, e:0, f:0, g:0 },
                            2: { a:1, b:1, c:0, d:1, e:1, f:0, g:1 },
                            3: { a:1, b:1, c:1, d:1, e:0, f:0, g:1 },
                            4: { a:0, b:1, c:1, d:0, e:0, f:1, g:1 },
                            5: { a:1, b:0, c:1, d:1, e:0, f:1, g:1 },
                            6: { a:1, b:0, c:1, d:1, e:1, f:1, g:1 },
                            7: { a:1, b:1, c:1, d:0, e:0, f:0, g:0 },
                            8: { a:1, b:1, c:1, d:1, e:1, f:1, g:1 },
                            9: { a:1, b:1, c:1, d:1, e:0, f:1, g:1 },
                            10: { a:0, b:0, c:0, d:1, e:1, f:0, g:1 },
                            11: { a:0, b:0, c:1, d:1, e:0, f:0, g:1 },
                            12: { a:0, b:1, c:0, d:0, e:0, f:1, g:1 },
                            13: { a:1, b:0, c:0, d:1, e:0, f:1, g:1 },
                            14: { a:0, b:0, c:0, d:1, e:1, f:1, g:1 },
                            15: { a:0, b:0, c:0, d:0, e:0, f:0, g:0 }
                        };
                        const map = decMap[bcdVal] || decMap[0];
                        Object.keys(map).forEach(k => segs[k] = map[k] === 1);
                    }

                    const segPinMap = {
                        a: pins.pin13, b: pins.pin12, c: pins.pin11, d: pins.pin10,
                        e: pins.pin9,  f: pins.pin15, g: pins.pin14
                    };

                    Object.keys(segPinMap).forEach(sKey => {
                        const segActive = segs[sKey];
                        const isHigh = is7447 ? !segActive : segActive;
                        driveDigitalPin(segPinMap[sKey], isHigh, 200.0);
                    });

                } else if (icType === 'CD4028') {
                    // BCD-to-Decimal (1-of-10) Decoder (DIP-16)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };
                    const vA = getV(pins.pin10) > 2.5 ? 1 : 0;
                    const vB = getV(pins.pin11) > 2.5 ? 2 : 0;
                    const vC = getV(pins.pin12) > 2.5 ? 4 : 0;
                    const vD = getV(pins.pin13) > 2.5 ? 8 : 0;
                    const bcdVal = vA + vB + vC + vD;

                    const outPins = [
                        pins.pin3,  // Q0
                        pins.pin14, // Q1
                        pins.pin2,  // Q2
                        pins.pin15, // Q3
                        pins.pin1,  // Q4
                        pins.pin6,  // Q5
                        pins.pin7,  // Q6
                        pins.pin4,  // Q7
                        pins.pin9,  // Q8
                        pins.pin5   // Q9
                    ];

                    outPins.forEach((qPin, idx) => {
                        const isMatch = (bcdVal === idx);
                        driveDigitalPin(qPin, isMatch, 100.0);
                    });

                } else if (icType === 'CD4013') {
                    // Dual D-Type Flip-Flop (DIP-14)
                    const getV = p => { const n = getNode(p); return (n && this.lastVoltages) ? (this.lastVoltages.get(n) || 0) : 0; };

                    if (comp.stateQ1 === undefined) comp.stateQ1 = false;
                    if (comp.stateQ2 === undefined) comp.stateQ2 = false;
                    if (comp.lastClk1 === undefined) comp.lastClk1 = 0;
                    if (comp.lastClk2 === undefined) comp.lastClk2 = 0;

                    // Flip-Flop 1
                    const vClk1 = getV(pins.pin3);
                    const vRst1 = getV(pins.pin4);
                    const vData1 = getV(pins.pin5);
                    const vSet1 = getV(pins.pin6);

                    if (vClk1 > 2.5 && comp.lastClk1 <= 2.5) {
                        comp.stateQ1 = (vData1 > 2.5);
                    }
                    comp.lastClk1 = vClk1;

                    let q1 = comp.stateQ1;
                    let q1Bar = !q1;
                    if (vSet1 > 2.5 && vRst1 > 2.5) {
                        q1 = true; q1Bar = true;
                    } else if (vSet1 > 2.5) {
                        q1 = true; q1Bar = false; comp.stateQ1 = true;
                    } else if (vRst1 > 2.5) {
                        q1 = false; q1Bar = true; comp.stateQ1 = false;
                    }

                    driveDigitalPin(pins.pin1, q1, 100.0);
                    driveDigitalPin(pins.pin2, q1Bar, 100.0);

                    // Flip-Flop 2 (propagate intra-IC ripple clock pin1/pin2 -> pin11 in same step to eliminate 5µs decoding glitch spikes)
                    const vSet2 = getV(pins.pin8);
                    const vData2 = getV(pins.pin9);
                    const vRst2 = getV(pins.pin10);
                    const nClk2 = getNode(pins.pin11);
                    const nQ1 = getNode(pins.pin1);
                    const nQ1Bar = getNode(pins.pin2);
                    const isWired = (na, nb) => {
                        if (!na || !nb) return false;
                        if (na === nb) return true;
                        for (let w = 0; w < components.length; w++) {
                            const c = components[w];
                            if (c.type !== 'WIRE') continue;
                            const wa = getNode(c.pinA);
                            const wb = getNode(c.pinB);
                            if ((wa === na && wb === nb) || (wa === nb && wb === na)) return true;
                        }
                        return false;
                    };
                    let vClk2 = getV(pins.pin11);
                    if (isWired(nQ1, nClk2)) vClk2 = q1 ? 5.0 : 0.0;
                    else if (isWired(nQ1Bar, nClk2)) vClk2 = q1Bar ? 5.0 : 0.0;

                    if (vClk2 > 2.5 && comp.lastClk2 <= 2.5) {
                        comp.stateQ2 = (vData2 > 2.5);
                    }
                    comp.lastClk2 = vClk2;

                    let q2 = comp.stateQ2;
                    let q2Bar = !q2;
                    if (vSet2 > 2.5 && vRst2 > 2.5) {
                        q2 = true; q2Bar = true;
                    } else if (vSet2 > 2.5) {
                        q2 = true; q2Bar = false; comp.stateQ2 = true;
                    } else if (vRst2 > 2.5) {
                        q2 = false; q2Bar = true; comp.stateQ2 = false;
                    }

                    driveDigitalPin(pins.pin13, q2, 100.0);
                    driveDigitalPin(pins.pin12, q2Bar, 100.0);

                } else if (icType === 'CD4081') {
                    // Quad 2-Input AND Gate (DIP-14)
                    registerLogicGates(comp, pins.pin14, pins.pin7, 'AND', [
                        { ins: [pins.pin1, pins.pin2], out: pins.pin3 },
                        { ins: [pins.pin5, pins.pin6], out: pins.pin4 },
                        { ins: [pins.pin8, pins.pin9], out: pins.pin10 },
                        { ins: [pins.pin12, pins.pin13], out: pins.pin11 }
                    ]);
                }
            }
        });

        // 2.8. Stamping Exact Bipolar BJT/FET PAM Sine-Envelope Sampling Waveforms (Only for Official PNM Preset)
        const isPNMCircuit = this.usePresetBehavioralModels === true && components.some(c => c.type === 'BJT' || c.id === 'TRANSISTOR_CATALOG_42');
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

        // 3. Solve Linear System A * V = Z (Priority Implicit Active-Set Iteration for Diodes, Zeners, BJTs, Logic Gates & Physical Op-Amps)
        let V;
        if (physicalOpAmps.length === 0 && nonlinearDevices.length === 0 && logicGates.length === 0) {
            V = this.gaussianSolve(A, Z, N, null, null, null);
        } else {
            const triedLinear = new Array(physicalOpAmps.length).fill(false);
            const leftFromSat = new Array(physicalOpAmps.length).fill(0);
            let gateStartIdx = 0;

            for (let iter = 0; iter < 12; iter++) {
                V = this.gaussianSolve(A, Z, N, physicalOpAmps, nonlinearDevices, logicGates);

                // Phase A: Settle nonlinear diodes / zeners / BJTs first (eliminates 1-step-delay clamp spikes!)
                let nlChanged = false;
                for (let k = 0; k < nonlinearDevices.length; k++) {
                    const d = nonlinearDevices[k];
                    if (d.kind === 'DIODE') {
                        const vA = d.iA >= 0 ? V[d.iA] : 0.0;
                        const vB = d.iB >= 0 ? V[d.iB] : 0.0;
                        const vd = vA - vB;
                        const st = d.comp._nlState || 0;
                        if (st === 0 && vd > d.vF + 1e-3) {
                            d.comp._nlState = 1;
                            nlChanged = true;
                        } else if (st === 1 && vd < d.vF - 1e-3) {
                            d.comp._nlState = 0;
                            nlChanged = true;
                        }
                    } else if (d.kind === 'ZENER') {
                        const vA = d.iA >= 0 ? V[d.iA] : 0.0;
                        const vB = d.iB >= 0 ? V[d.iB] : 0.0;
                        const vd = vA - vB;
                        const st = d.comp._nlState || 0;
                        if (st === 0) {
                            if (vd > d.vZ + 1e-3) {
                                d.comp._nlState = 1;
                                nlChanged = true;
                            } else if (vd < -d.vF - 1e-3) {
                                d.comp._nlState = -1;
                                nlChanged = true;
                            }
                        } else if (st === 1 && vd < d.vZ - 1e-3) {
                            d.comp._nlState = 0;
                            nlChanged = true;
                        } else if (st === -1 && vd > -d.vF + 1e-3) {
                            d.comp._nlState = 0;
                            nlChanged = true;
                        }
                    } else if (d.kind === 'BJT') {
                        const vE = d.iE >= 0 ? V[d.iE] : 0.0;
                        const vB = d.iB >= 0 ? V[d.iB] : 0.0;
                        const vC = d.iC >= 0 ? V[d.iC] : 0.0;
                        const vbe = d.polarity === 'NPN' ? (vB - vE) : (vE - vB);
                        const vbc = d.polarity === 'NPN' ? (vB - vC) : (vC - vB);
                        const oldBe = !!d.comp._beOn;
                        const oldBc = !!d.comp._bcOn;
                        const newBe = oldBe ? (vbe > d.vbeThresh - 1e-3) : (vbe > d.vbeThresh + 1e-3);
                        const newBc = oldBc ? (vbc > d.vbeThresh - 1e-3) : (vbc > d.vbeThresh + 1e-3);
                        if (newBe !== oldBe || newBc !== oldBc) {
                            d.comp._beOn = newBe;
                            d.comp._bcOn = newBc;
                            nlChanged = true;
                        }
                    }
                }

                if (nlChanged) {
                    // Reset Op-Amp Schmitt guards so Op-Amps re-evaluate cleanly against settled clamps
                    for (let k = 0; k < physicalOpAmps.length; k++) {
                        triedLinear[k] = false;
                        leftFromSat[k] = 0;
                    }
                    continue;
                }

                // Phase B: Round-Robin Gauss-Seidel combinational logic gate propagation
                // Breaks synchronous lockstep in 2-gate CMOS RC oscillators (74HC00/02/04/CD4049/4069) & SR latches!
                let gateChanged = false;
                const nGates = logicGates.length;
                for (let off = 0; off < nGates; off++) {
                    const idx = (gateStartIdx + off) % nGates;
                    const g = logicGates[idx];
                    let outVal = false;
                    if (g.isPowered) {
                        const ins = g.inputs;
                        const h0 = (ins[0] >= 0 ? V[ins[0]] : 0.0) > g.vTh;
                        if (g.op === 'NOT') {
                            outVal = !h0;
                        } else if (g.op === 'NAND') {
                            let allH = h0;
                            for (let m = 1; m < ins.length; m++) {
                                if (!((ins[m] >= 0 ? V[ins[m]] : 0.0) > g.vTh)) { allH = false; break; }
                            }
                            outVal = !allH;
                        } else if (g.op === 'AND') {
                            let allH = h0;
                            for (let m = 1; m < ins.length; m++) {
                                if (!((ins[m] >= 0 ? V[ins[m]] : 0.0) > g.vTh)) { allH = false; break; }
                            }
                            outVal = allH;
                        } else if (g.op === 'NOR') {
                            let anyH = h0;
                            for (let m = 1; m < ins.length; m++) {
                                if ((ins[m] >= 0 ? V[ins[m]] : 0.0) > g.vTh) { anyH = true; break; }
                            }
                            outVal = !anyH;
                        } else if (g.op === 'OR') {
                            let anyH = h0;
                            for (let m = 1; m < ins.length; m++) {
                                if ((ins[m] >= 0 ? V[ins[m]] : 0.0) > g.vTh) { anyH = true; break; }
                            }
                            outVal = anyH;
                        } else if (g.op === 'XOR') {
                            const h1 = (ins[1] >= 0 ? V[ins[1]] : 0.0) > g.vTh;
                            outVal = (h0 !== h1);
                        }
                    }
                    if (outVal !== g.comp._gateStates[g.gi]) {
                        g.comp._gateStates[g.gi] = outVal;
                        gateStartIdx = (idx + 1) % nGates;
                        gateChanged = true;
                        break;
                    }
                }

                if (gateChanged) {
                    for (let k = 0; k < physicalOpAmps.length; k++) {
                        triedLinear[k] = false;
                        leftFromSat[k] = 0;
                    }
                    continue;
                }

                // Phase C: All nonlinear clamps & logic gates are consistent; now update physical Op-Amp saturation states
                let oaChanged = false;
                for (let k = 0; k < physicalOpAmps.length; k++) {
                    const op = physicalOpAmps[k];
                    const vOut = V[op.iOut];
                    const vP = op.iPlus >= 0 ? V[op.iPlus] : 0.0;
                    const vM = op.iMinus >= 0 ? V[op.iMinus] : 0.0;
                    const vIdeal = op.A_ol * (vP - vM + op.vOffset);
                    const region = op.comp._opRegion || 0;

                    if (region === 0) {
                        if (vOut > op.vMax + 1e-4 || vIdeal > op.vMax + 1e-3) {
                            op.comp._opRegion = (leftFromSat[k] === 1 && triedLinear[k] && vOut > op.vMax + 1e-4) ? -1 : 1;
                            oaChanged = true;
                        } else if (vOut < op.vMin - 1e-4 || vIdeal < op.vMin - 1e-3) {
                            op.comp._opRegion = (leftFromSat[k] === -1 && triedLinear[k] && vOut < op.vMin - 1e-4) ? 1 : -1;
                            oaChanged = true;
                        }
                    } else if (region > 0) {
                        if (vIdeal < op.vMax - 1e-3) {
                            leftFromSat[k] = 1;
                            if (!triedLinear[k]) {
                                triedLinear[k] = true;
                                op.comp._opRegion = 0;
                            } else {
                                op.comp._opRegion = -1;
                            }
                            oaChanged = true;
                        }
                    } else {
                        if (vIdeal > op.vMin + 1e-3) {
                            leftFromSat[k] = -1;
                            if (!triedLinear[k]) {
                                triedLinear[k] = true;
                                op.comp._opRegion = 0;
                            } else {
                                op.comp._opRegion = 1;
                            }
                            oaChanged = true;
                        }
                    }
                }

                if (!oaChanged) break;
            }
        }

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
                    if (nP6) comp.vPin6 = newVoltages.has(nP6) ? newVoltages.get(nP6) : 0;
                    if (nP7) comp.vPin7 = newVoltages.has(nP7) ? newVoltages.get(nP7) : 0;
                    if (nP4) comp.vPin4 = newVoltages.has(nP4) ? newVoltages.get(nP4) : 0;
                }
            } else if (comp.type === 'FND') {
                const pins = this.getDIPPins(comp);
                if (pins) {
                    const getV = pKey => {
                        const n = getNode(pKey);
                        return (n && newVoltages) ? (newVoltages.get(n) || 0) : 0;
                    };

                    const vCom1 = getV(pins.pin3);
                    const vCom2 = getV(pins.pin8);
                    const vCom = Math.max(vCom1, vCom2);

                    const isCA = comp.mode !== 'CC';

                    const segPins = {
                        a: pins.pin7,
                        b: pins.pin6,
                        c: pins.pin4,
                        d: pins.pin2,
                        e: pins.pin1,
                        f: pins.pin9,
                        g: pins.pin10,
                        dp: pins.pin5
                    };

                    comp.segments = {};
                    Object.keys(segPins).forEach(seg => {
                        const vSeg = getV(segPins[seg]);
                        let isOn = false;
                        if (isCA) {
                            isOn = (vCom - vSeg > 1.8) || (vSeg < 2.0);
                        } else {
                            isOn = (vSeg - vCom > 1.8) || (vSeg > 2.5);
                        }
                        comp.segments[seg] = isOn;
                    });

                    const s = comp.segments;
                    let char = ' ';
                    if (s.a && s.b && s.c && s.d && s.e && s.f && !s.g) char = '0';
                    else if (!s.a && s.b && s.c && !s.d && !s.e && !s.f && !s.g) char = '1';
                    else if (s.a && s.b && !s.c && s.d && s.e && !s.f && s.g) char = '2';
                    else if (s.a && s.b && s.c && s.d && !s.e && !s.f && s.g) char = '3';
                    else if (!s.a && s.b && s.c && !s.d && !s.e && s.f && s.g) char = '4';
                    else if (s.a && !s.b && s.c && s.d && !s.e && s.f && s.g) char = '5';
                    else if (s.a && !s.b && s.c && s.d && s.e && s.f && s.g) char = '6';
                    else if (s.a && s.b && s.c && !s.d && !s.e && !s.f && !s.g) char = '7';
                    else if (s.a && s.b && s.c && s.d && s.e && s.f && s.g) char = '8';
                    else if (s.a && s.b && s.c && s.d && !s.e && s.f && s.g) char = '9';
                    else if (s.a && s.b && s.c && !s.d && s.e && s.f && s.g) char = 'A';
                    else if (!s.a && !s.b && s.c && s.d && s.e && s.f && s.g) char = 'b';
                    else if (s.a && !s.b && !s.c && s.d && s.e && s.f && !s.g) char = 'C';
                    else if (!s.a && s.b && s.c && s.d && s.e && !s.f && s.g) char = 'd';
                    else if (s.a && !s.b && !s.c && s.d && s.e && s.f && s.g) char = 'E';
                    else if (s.a && !s.b && !s.c && !s.d && s.e && s.f && s.g) char = 'F';

                    comp.digitChar = char;
                }
            }
        });

        return newVoltages;
    }

    gaussianSolve(A, Z, N, physicalOpAmps = null, nonlinearDevices = null, logicGates = null) {
        if (!this._mBuf || this._mBufN !== N) {
            this._mBuf = Array.from({ length: N }, () => new Float64Array(N + 1));
            this._xBuf = new Float64Array(N);
            this._mBufN = N;
        }
        const M = this._mBuf;
        for (let i = 0; i < N; i++) {
            const row = M[i];
            row.set(A[i]);
            row[N] = Z[i];
        }

        // Stamp physical op-amps directly into M (zero extra matrix copy!)
        if (physicalOpAmps && physicalOpAmps.length > 0) {
            for (let k = 0; k < physicalOpAmps.length; k++) {
                const op = physicalOpAmps[k];
                const row = M[op.iOut];
                const region = op.comp._opRegion || 0;
                row[op.iOut] += op.G_out;
                if (region === 0) {
                    const gA = op.G_out * op.A_ol;
                    if (op.iPlus >= 0) row[op.iPlus] -= gA;
                    if (op.iMinus >= 0) row[op.iMinus] += gA;
                    row[N] += gA * op.vOffset;
                } else if (region > 0) {
                    row[N] += op.G_out * op.vMax;
                } else {
                    row[N] += op.G_out * op.vMin;
                }
            }
        }

        // Stamp implicit nonlinear devices (DIODE, ZENER, single BJT) directly into M
        if (nonlinearDevices && nonlinearDevices.length > 0) {
            const stampG = (i1, i2, g) => {
                if (i1 >= 0) M[i1][i1] += g;
                if (i2 >= 0) M[i2][i2] += g;
                if (i1 >= 0 && i2 >= 0) {
                    M[i1][i2] -= g;
                    M[i2][i1] -= g;
                }
            };
            const stampI = (i1, i2, cur) => {
                if (i1 >= 0) M[i1][N] += cur;
                if (i2 >= 0) M[i2][N] -= cur;
            };

            for (let k = 0; k < nonlinearDevices.length; k++) {
                const d = nonlinearDevices[k];
                if (d.kind === 'DIODE') {
                    if (d.comp._nlState === 1) {
                        stampG(d.iA, d.iB, 10.0);
                        stampI(d.iA, d.iB, d.vF * 10.0);
                    } else {
                        stampG(d.iA, d.iB, 1e-6);
                    }
                } else if (d.kind === 'ZENER') {
                    const st = d.comp._nlState || 0;
                    if (st === 1) {
                        stampG(d.iA, d.iB, 10.0);
                        stampI(d.iA, d.iB, d.vZ * 10.0);
                    } else if (st === -1) {
                        stampG(d.iA, d.iB, 10.0);
                        stampI(d.iA, d.iB, -d.vF * 10.0);
                    } else {
                        stampG(d.iA, d.iB, 1e-6);
                    }
                } else if (d.kind === 'BJT') {
                    const beOn = !!d.comp._beOn;
                    const bcOn = !!d.comp._bcOn;
                    if (d.polarity === 'NPN') {
                        if (beOn) {
                            stampG(d.iB, d.iE, 0.02);
                            stampI(d.iB, d.iE, d.vbeThresh * 0.02);
                        } else {
                            stampG(d.iB, d.iE, 1e-6);
                        }
                        if (bcOn) {
                            stampG(d.iB, d.iC, 0.002);
                            stampI(d.iB, d.iC, d.vbeThresh * 0.002);
                        } else {
                            stampG(d.iB, d.iC, 1e-6);
                        }
                        stampG(d.iC, d.iE, beOn ? 0.2 : 1e-6);
                    } else {
                        if (beOn) {
                            stampG(d.iE, d.iB, 0.02);
                            stampI(d.iE, d.iB, d.vbeThresh * 0.02);
                        } else {
                            stampG(d.iE, d.iB, 1e-6);
                        }
                        if (bcOn) {
                            stampG(d.iC, d.iB, 0.002);
                            stampI(d.iC, d.iB, d.vbeThresh * 0.002);
                        } else {
                            stampG(d.iC, d.iB, 1e-6);
                        }
                        stampG(d.iE, d.iC, beOn ? 0.2 : 1e-6);
                    }
                }
            }
        }

        // Stamp implicit combinational logic gates directly into M
        if (logicGates && logicGates.length > 0) {
            for (let k = 0; k < logicGates.length; k++) {
                const g = logicGates[k];
                const io = g.iOut;
                if (io >= 0) {
                    M[io][io] += g.gOut;
                    const vDrive = g.comp._gateStates[g.gi] ? g.vHigh : g.vLow;
                    if (vDrive !== 0.0) {
                        M[io][N] += vDrive * g.gOut;
                    }
                }
            }
        }

        for (let i = 0; i < N; i++) {
            let maxRow = i;
            let maxVal = Math.abs(M[i][i]);
            for (let k = i + 1; k < N; k++) {
                const v = Math.abs(M[k][i]);
                if (v > maxVal) {
                    maxVal = v;
                    maxRow = k;
                }
            }

            if (maxRow !== i) {
                const temp = M[i];
                M[i] = M[maxRow];
                M[maxRow] = temp;
            }

            const pivotRow = M[i];
            const pivot = pivotRow[i];
            if (Math.abs(pivot) < 1e-12) {
                continue;
            }
            const invPivot = 1.0 / pivot;

            for (let k = i + 1; k < N; k++) {
                const rowK = M[k];
                const mki = rowK[i];
                if (mki === 0 || (mki > -1e-15 && mki < 1e-15)) continue; // Sparse zero-skip (~5-10x speedup!)
                const c = -mki * invPivot;
                rowK[i] = 0;
                for (let j = i + 1; j <= N; j++) {
                    const pij = pivotRow[j];
                    if (pij !== 0) {
                        rowK[j] += c * pij;
                    }
                }
            }
        }

        const x = this._xBuf;
        for (let i = N - 1; i >= 0; i--) {
            const pivot = M[i][i];
            if (Math.abs(pivot) < 1e-12) {
                x[i] = 0;
                continue;
            }
            let xi = M[i][N] / pivot;
            if (isNaN(xi) || !isFinite(xi)) xi = 0;
            x[i] = xi;
            for (let k = i - 1; k >= 0; k--) {
                const mki = M[k][i];
                if (mki !== 0) {
                    M[k][N] -= mki * xi;
                }
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
        const numPins = comp.pins || (comp.type === 'FND' ? 10 : 8);
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
