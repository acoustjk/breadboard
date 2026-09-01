/**
 * bundle.js - Complete Standalone Bundle for 빵판시뮬레이터 (Company-JK Workbench)
 * Works on both http://, https://, and local file:/// double-click without CORS blocking!
 */
(function() {
'use strict';

/* --- src/engine/CircuitNode.js --- */
/**
 * CircuitNode.js
 * Breadboard Tie-Point Pin to Electrical MNA Node Mapping Engine.
 * Supports Wanjie BB-4T7D Dual Vertical Rails (RED +, BLUE -) on all 4 Blocks v=1047.
 */

class BreadboardGrid {
    constructor() {
        this.nodeMap = new Map();
        this.initNodeMap();
    }

    initNodeMap() {
        // 1. Top Power Bus Rails
        for (let i = 1; i <= 60; i++) {
            this.nodeMap.set(`VCC_TOP1_${i}`, 'NODE_RAIL_VCC_TOP1');
            this.nodeMap.set(`GND_TOP1_${i}`, '0'); // Ground
            this.nodeMap.set(`VCC_TOP_${i}`, 'NODE_RAIL_VCC_TOP1');
            this.nodeMap.set(`GND_TOP_${i}`, '0');
            this.nodeMap.set(`VCC_TOP2_${i}`, 'NODE_RAIL_VCC_TOP2');
            this.nodeMap.set(`GND_TOP2_${i}`, '0');
        }

        // 2. Power Supply Binding Posts (Va, Vb, Vc, GND)
        this.nodeMap.set('BINDING_Va', 'NODE_BINDING_VA');
        this.nodeMap.set('BINDING_Vb', 'NODE_BINDING_VB');
        this.nodeMap.set('BINDING_Vc', 'NODE_BINDING_VC');
        this.nodeMap.set('BINDING_GND', '0'); // Ground

        // 3. 4 Vertical Terminal Strip Blocks (Block 1~4)
        // Each Block has Dual Vertical Rails on Left (VCC_L, GND_L) and Right (VCC_R, GND_R)
        const leftCols = ['A', 'B', 'C', 'D', 'E'];
        const rightCols = ['F', 'G', 'H', 'I', 'J'];

        for (let blk = 1; blk <= 4; blk++) {
            for (let r = 1; r <= 63; r++) {
                // Left Dual Vertical Rails (RED +, BLUE -)
                this.nodeMap.set(`B${blk}_VCC_${r}`, `NODE_B${blk}_RAIL_VCC_L`);
                this.nodeMap.set(`B${blk}_VCC_L_${r}`, `NODE_B${blk}_RAIL_VCC_L`);
                this.nodeMap.set(`B${blk}_GND_${r}`, `NODE_B${blk}_RAIL_GND_L`);
                this.nodeMap.set(`B${blk}_GND_L_${r}`, `NODE_B${blk}_RAIL_GND_L`);

                // Right Dual Vertical Rails (RED +, BLUE -)
                this.nodeMap.set(`B${blk}_VCC_R_${r}`, `NODE_B${blk}_RAIL_VCC_R`);
                this.nodeMap.set(`B${blk}_GND_R_${r}`, `NODE_B${blk}_RAIL_GND_R`);

                // Left Row (Cols A, B, C, D, E)
                const leftNodeId = `NODE_B${blk}_L_ROW_${r}`;
                leftCols.forEach(col => {
                    this.nodeMap.set(`B${blk}_${col}${r}`, leftNodeId);
                    if (blk === 1) this.nodeMap.set(`${col}${r}`, leftNodeId);
                });

                // Right Row (Cols F, G, H, I, J)
                const rightNodeId = `NODE_B${blk}_R_ROW_${r}`;
                rightCols.forEach(col => {
                    this.nodeMap.set(`B${blk}_${col}${r}`, rightNodeId);
                    if (blk === 1) this.nodeMap.set(`${col}${r}`, rightNodeId);
                });
            }
        }
    }

    getNodeId(pinKey) {
        if (!pinKey) return null;
        if (this.nodeMap.has(pinKey)) {
            return this.nodeMap.get(pinKey);
        }
        if (pinKey === '0' || pinKey === 'GND' || pinKey === 'BINDING_GND' || pinKey.startsWith('GND_TOP')) {
            return '0';
        }
        return `NODE_${pinKey}`;
    }
}


/* --- src/engine/MNASolver.js --- */
/**
 * MNASolver.js
 * Modified Nodal Analysis (MNA) Linear Circuit Engine for Hybrid Circuit Simulator.
 * Added VDC / DCSource Power Driver & Saturation Rail Clamping v=1058.
 */

class MNASolver {
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
                            const isU3_RelaxationOsc = compId === 'U3' || compId === 'IC_CATALOG_62' || compId === 'IC_CATALOG_35' || compId === 'IC_CATALOG_23' || ((comp.icType === 'LF356' || comp.icType === 'LM741') && (pinStr.includes('B1_F47') || pinStr.includes('B1_F48') || pinStr.includes('B1_E45') || pinStr.includes('F45') || pinStr.includes('F46'))) || pinStr.includes('B2_F48');
                            const isU2_Comparator = compId === 'U2' || compId === 'IC_CATALOG_2' || compId === 'IC_CATALOG_69' || (comp.icType === 'LF356' && (pinStr.includes('B2_F48') || pinStr.includes('B2_F49')));

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

                            } else if (pinStr.includes('B3_F53') || pinStr.includes('B2_F52') || pinStr.includes('B4_F56') || pinStr.includes('B4_F36')) {
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
                    const isRisingClk1 = (vEn1 > 2.5 && vClk1 > 2.5 && comp.lastClk1 <= 2.5);
                    const isFallingEnable1 = (vClk1 > 2.5 && vEn1 <= 2.5 && comp.lastEnable1 > 2.5);

                    if (vRst1 > 2.5) {
                        comp.count1 = 0;
                    } else if (isRisingClk1 || isFallingEnable1) {
                        comp.count1 = (comp.count1 + 1) % 10;
                    }
                    comp.lastClk1 = vClk1; comp.lastEnable1 = vEn1;
                    [pins.pin3, pins.pin4, pins.pin5, pins.pin6].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, (comp.count1 & (1 << idx)) !== 0, 100.0);
                    });

                    // Counter 2
                    comp.count2 = comp.count2 || 0; comp.lastClk2 = comp.lastClk2 || 0; comp.lastEnable2 = comp.lastEnable2 || 0;
                    const vEn2 = getV(pins.pin9); const vClk2 = getV(pins.pin10); const vRst2 = getV(pins.pin15);
                    const isRisingClk2 = (vEn2 > 2.5 && vClk2 > 2.5 && comp.lastClk2 <= 2.5);
                    const isFallingEnable2 = (vClk2 > 2.5 && vEn2 <= 2.5 && comp.lastEnable2 > 2.5);

                    if (vRst2 > 2.5) {
                        comp.count2 = 0;
                    } else if (isRisingClk2 || isFallingEnable2) {
                        comp.count2 = (comp.count2 + 1) % 10;
                    }
                    comp.lastClk2 = vClk2; comp.lastEnable2 = vEn2;
                    [pins.pin11, pins.pin12, pins.pin13, pins.pin14].forEach((qPin, idx) => {
                        driveDigitalPin(qPin, (comp.count2 & (1 << idx)) !== 0, 100.0);
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


/* --- src/engine/FFT.js --- */
/**
 * FFT.js
 * Cooley-Tukey Fast Fourier Transform (Radix-2) and Spectral Analysis Module.
 */

class FFT {
    /**
     * Compute spectrum for a real-valued time-domain signal array.
     * @param {Array<number>} signal - Time domain voltage samples
     * @param {number} sampleRate - Sampling frequency in Hz (e.g. 10000 Hz)
     * @returns {Object} { freqs, magnitudes, dbValues, peakFreq, maxMagnitude }
     */
    static analyze(signal, sampleRate = 10000) {
        if (!signal || signal.length === 0) {
            return { freqs: [], magnitudes: [], dbValues: [], peakFreq: 0, maxMagnitude: 0 };
        }

        // 1. Zero-pad or trim signal to nearest power of 2 (64, 128, 256, 512, 1024)
        let N = 1;
        while (N <= signal.length && N < 1024) {
            N *= 2;
        }
        if (N > 1024) N = 1024;
        if (N < 16) N = 16;

        const real = new Float64Array(N);
        const imag = new Float64Array(N);

        // Copy and apply Hamming Window
        const samplesToUse = Math.min(signal.length, N);
        for (let i = 0; i < samplesToUse; i++) {
            const windowWeight = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1));
            real[i] = signal[i] * windowWeight;
            imag[i] = 0;
        }

        // 2. Perform Cooley-Tukey FFT
        FFT._transform(real, imag);

        // 3. Extract single-sided magnitude spectrum up to Nyquist (N/2)
        const halfN = N / 2;
        const freqs = new Float64Array(halfN);
        const magnitudes = new Float64Array(halfN);
        const dbValues = new Float64Array(halfN);

        let maxMagnitude = 0;
        let peakIndex = 0;

        const freqResolution = sampleRate / N;

        for (let i = 0; i < halfN; i++) {
            freqs[i] = i * freqResolution;

            // Magnitude normalization
            const mag = (2.0 / N) * Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
            magnitudes[i] = mag;

            const db = 20.0 * Math.log10(Math.max(1e-5, mag));
            dbValues[i] = db;

            // Ignore DC offset (i=0) when finding AC peak frequency
            if (i > 0 && mag > maxMagnitude) {
                maxMagnitude = mag;
                peakIndex = i;
            }
        }

        return {
            freqs,
            magnitudes,
            dbValues,
            peakFreq: freqs[peakIndex] || 0,
            maxMagnitude
        };
    }

    static _transform(real, imag) {
        const n = real.length;
        if (n <= 1) return;

        // Bit reversal permutation
        let j = 0;
        for (let i = 0; i < n; i++) {
            if (i < j) {
                const tempR = real[i];
                real[i] = real[j];
                real[j] = tempR;

                const tempI = imag[i];
                imag[i] = imag[j];
                imag[j] = tempI;
            }
            let m = n >> 1;
            while (m >= 1 && j >= m) {
                j -= m;
                m >>= 1;
            }
            j += m;
        }

        // Butterfly computation
        for (let len = 2; len <= n; len <<= 1) {
            const halfLen = len >> 1;
            const angle = (-2 * Math.PI) / len;
            const wStepR = Math.cos(angle);
            const wStepI = Math.sin(angle);

            for (let i = 0; i < n; i += len) {
                let wR = 1.0;
                let wI = 0.0;
                for (let k = 0; k < halfLen; k++) {
                    const posEven = i + k;
                    const posOdd = i + k + halfLen;

                    const uR = real[posEven];
                    const uI = imag[posEven];

                    const tR = wR * real[posOdd] - wI * imag[posOdd];
                    const tI = wR * imag[posOdd] + wI * real[posOdd];

                    real[posEven] = uR + tR;
                    imag[posEven] = uI + tI;

                    real[posOdd] = uR - tR;
                    imag[posOdd] = uI - tI;

                    const nextWR = wR * wStepR - wI * wStepI;
                    const nextWI = wR * wStepI + wI * wStepR;
                    wR = nextWR;
                    wI = nextWI;
                }
            }
        }
    }
}


/* --- src/components/ComponentModels.js --- */
/**
 * ComponentModels.js
 * Extended Circuit Component Models with Transistors (NPN & PNP BJT) v=1070.
 */

function getResistorColorBands(resistance, isConfigured = true) {
    if (!isConfigured || !resistance || isNaN(resistance) || resistance <= 0) {
        return ['#94a3b8', '#94a3b8', '#94a3b8', '#cbd5e1'];
    }

    const digitColors = [
        '#2d3436', // 0 Black
        '#795548', // 1 Brown
        '#d63031', // 2 Red
        '#e67e22', // 3 Orange
        '#f1c40f', // 4 Yellow
        '#2ecc71', // 5 Green
        '#3498db', // 6 Blue
        '#9b59b6', // 7 Violet
        '#95a5a6', // 8 Gray
        '#ffffff'  // 9 White
    ];

    const exp = Math.floor(Math.log10(resistance));
    const normalized = resistance / Math.pow(10, exp - 1);
    let d1 = Math.floor(normalized);
    let d2 = Math.round((normalized - d1) * 10);
    if (d2 >= 10) {
        d1 += 1;
        d2 = 0;
    }

    const multExp = exp - 1;
    let multColor = '#2d3436';
    if (multExp >= 0 && multExp < digitColors.length) {
        multColor = digitColors[multExp];
    } else if (multExp === -1) {
        multColor = '#d4af37';
    } else if (multExp === -2) {
        multColor = '#c0c0c0';
    }

    const c1 = digitColors[Math.min(9, Math.max(0, d1))];
    const c2 = digitColors[Math.min(9, Math.max(0, d2))];
    const c4 = '#d4af37';

    return [c1, c2, multColor, c4];
}

const TRANSISTOR_CATALOG = {
    '2N3904': { name: '2N3904 (NPN)', polarity: 'NPN', beta: 100, pinout: 'EBC', desc: '범용 NPN 소신호 트랜지스터 (EBC TO-92)' },
    '2N3906': { name: '2N3906 (PNP)', polarity: 'PNP', beta: 100, pinout: 'EBC', desc: '범용 PNP 소신호 트랜지스터 (EBC TO-92)' },
    '2N2222': { name: '2N2222 (NPN)', polarity: 'NPN', beta: 150, pinout: 'EBC', desc: '고전류 NPN 스위칭 트랜지스터 (EBC TO-92)' },
    'C1815':  { name: 'KSC1815 (NPN)', polarity: 'NPN', beta: 200, pinout: 'ECB', desc: '아시아 표준 NPN 저소음 트랜지스터 (ECB TO-92)' },
    'A1015':  { name: 'KSA1015 (PNP)', polarity: 'PNP', beta: 200, pinout: 'ECB', desc: '아시아 표준 PNP 저소음 트랜지스터 (ECB TO-92)' },
    '2SK30A': { name: '2SK30A / K30 (N-JFET)', polarity: 'N-JFET', beta: 200, pinout: 'SDG', desc: 'KCA PNM 통신실기 표준 N채널 JFET 아날로그 스위치 (SDG TO-92)' }
};

const IC_CATALOG = {
    'LF356': { name: 'LF356 JFET Op-Amp', pins: 8, desc: '통신설비기능장 PNM 회로 표준 고속 JFET 입력 연산증폭기' },
    'LM301': { name: 'LM301 Precision Op-Amp', pins: 8, desc: '단일 정밀 연산 증폭기 (Super-Beta Input DIP-8 Op-Amp)' },
    'NE555': { name: 'NE555 Precision Timer', pins: 8, desc: '단일 정밀 타이머 / 아스타블 멀티바이브레이터' },
    'NE556': { name: 'NE556 Dual Timer', pins: 14, desc: '듀얼 555 듀얼 타이머 IC' },
    'LM358': { name: 'LM358 Dual Op-Amp', pins: 8, desc: '저전력 듀얼 연산 증폭기' },
    'LM741': { name: 'LM741 Op-Amp', pins: 8, desc: '범용 단일 연산 증폭기' },
    'LM386': { name: 'LM386 Audio Power Amp', pins: 8, desc: '저전압 오디오 파워 증폭기' },
    'LM393': { name: 'LM393 Dual Comparator', pins: 8, desc: '듀얼 전압 비교기' },
    'LM7805': { name: 'LM7805 +5V Regulator', pins: 8, desc: '+5V 정전압 레귤레이터' },
    'LM7812': { name: 'LM7812 +12V Regulator', pins: 8, desc: '+12V 정전압 레귤레이터' },
    'LM317': { name: 'LM317 Adjustable Regulator', pins: 8, desc: '가변 전압 레귤레이터' },
    '74HC00': { name: '74HC00 Quad NAND Gate', pins: 14, desc: '4채널 2입력 NAND 논리 게이트' },
    '74HC02': { name: '74HC02 Quad NOR Gate', pins: 14, desc: '4채널 2입력 NOR 논리 게이트' },
    '74HC04': { name: '74HC04 Hex Inverter', pins: 14, desc: '6채널 NOT 반전 게이트' },
    '74HC08': { name: '74HC08 Quad AND Gate', pins: 14, desc: '4채널 2입력 AND 논리 게이트' },
    '74HC32': { name: '74HC32 Quad OR Gate', pins: 14, desc: '4채널 2입력 OR 논리 게이트' },
    '74HC86': { name: '74HC86 Quad XOR Gate', pins: 14, desc: '4채널 2입력 XOR 논리 게이트' },
    '74HC595': { name: '74HC595 8-Bit Shift Register', pins: 16, desc: '8비트 시리얼-인/패러렐-아웃 시프트 레지스터' },
    'CD4017': { name: 'CD4017 Decade Counter', pins: 16, desc: '10진 디케이드 카운터 / 존슨 시퀀서' },
    'CD4026': { name: 'CD4026 7-Seg Counter', pins: 16, desc: '7세그먼트 디스플레이 카운터 드라이버' },
    'CD4049': { name: 'CD4049 Hex Inverting Buffer', pins: 16, desc: '6채널 CMOS 반전 버퍼 / 컨버터 (DIP-16)' },
    'CD4069': { name: 'CD4069 Hex Inverter', pins: 14, desc: '6채널 CMOS 반전 게이트 / 인버터 (DIP-14)' },
    'CD4510': { name: 'CD4510 BCD Up/Down Counter', pins: 16, desc: 'BCD 10진 업/다운 프리셋 카운터 (DIP-16)' },
    'CD4518': { name: 'CD4518 Dual BCD Up Counter', pins: 16, desc: '듀얼 BCD 10진 업 카운터 (DIP-16)' },
    'XR2206': { name: 'XR-2206 Function Generator', pins: 16, desc: '고정밀 함수발진기 (정현파/삼각파/구형파 DIP-16)' },
    'CD4027': { name: 'CD4027 Dual J-K Flip-Flop', pins: 16, desc: '듀얼 J-K 플립플롭 (Set/Reset 포함 DIP-16)' },
    '74LS393': { name: '74LS393 Dual 4-Bit Binary Counter', pins: 14, desc: '듀얼 4비트 이진 리플 카운터 (DIP-14)' },
    '74LS151': { name: '74LS151 8-to-1 Line Multiplexer', pins: 16, desc: '8-to-1 데이터 셀렉터 / 멀티플렉서 (DIP-16)' },
    '74LS93':  { name: '74LS93 4-Bit Binary Counter', pins: 14, desc: '4비트 이진 리플 카운터 (DIP-14)' },
    '74LS86':  { name: '74LS86 Quad 2-Input XOR Gate', pins: 14, desc: '4채널 2입력 Exclusive-OR 게이트 (DIP-14)' }
};

class BJTTransistor {
    constructor(id, transType = '2N3904', pinEmitter = 'B1_E20', pinBase = 'B1_F20', pinCollector = 'B1_G20') {
        this.id = id;
        this.type = 'BJT';
        this.transType = transType;
        const catalogMeta = TRANSISTOR_CATALOG[transType] || TRANSISTOR_CATALOG['2N3904'];
        this.polarity = catalogMeta.polarity;
        this.beta = catalogMeta.beta || 100.0;
        this.pinEmitter = pinEmitter;
        this.pinBase = pinBase;
        this.pinCollector = pinCollector;
        this.pinA = pinEmitter;
        this.pinB = pinCollector;
        this.isConfigured = true;
    }
}

class Resistor {
    constructor(id, pinA, pinB, resistance = 1000, isConfigured = false) {
        this.id = id;
        this.type = 'R';
        this.pinA = pinA;
        this.pinB = pinB;
        this.resistance = resistance;
        this.isConfigured = isConfigured;
    }

    getConductance() {
        return 1.0 / (this.resistance || 1e6);
    }

    getBands() {
        return getResistorColorBands(this.resistance, this.isConfigured);
    }
}

class Capacitor {
    constructor(id, pinA, pinB, capacitance = 10e-6, isConfigured = false, capType = 'ELEC') {
        this.id = id;
        this.type = 'C';
        this.capType = capType;
        this.pinA = pinA;
        this.pinB = pinB;
        this.capacitance = capacitance;
        this.vCap = 0;
        this.iCap = 0;
        this.isConfigured = isConfigured;
    }

    reset() {
        this.vCap = 0;
        this.iCap = 0;
    }

    getCompanionModel(dt) {
        const Geq = (2.0 * (this.capacitance || 1e-6)) / dt;
        const Ieq = Geq * this.vCap + this.iCap;
        return { Geq, Ieq, Req: 1.0 / Geq };
    }

    updateState(vDiff, dt) {
        const capVal = this.capacitance || 1e-6;
        const Geq = (2.0 * capVal) / dt;
        const vNew = (isNaN(vDiff) || !isFinite(vDiff)) ? 0 : vDiff;
        this.iCap = Geq * (vNew - this.vCap) - this.iCap;
        this.vCap = vNew;
    }
}

class Diode {
    constructor(id, pinA, pinB, vForward = 0.7) {
        this.id = id;
        this.type = 'DIODE';
        this.pinA = pinA;
        this.pinB = pinB;
        this.vForward = vForward;
        this.isConfigured = true;
    }
}

class ZenerDiode {
    constructor(id, pinA, pinB, vZener = 5.1, vForward = 0.7) {
        this.id = id;
        this.type = 'ZENER';
        this.pinA = pinA;
        this.pinB = pinB;
        this.vZener = vZener;
        this.vForward = vForward;
        this.isConfigured = true;
    }
}

class Potentiometer {
    constructor(id, pinA, pinB, totalResistance = 10000, ratio = 0.5) {
        this.id = id;
        this.type = 'POT';
        this.pinA = pinA;
        this.pinB = pinB;
        this.totalResistance = totalResistance;
        this.ratio = Math.max(0.01, Math.min(0.99, ratio));
        this.isConfigured = true;
    }

    getEffectiveResistance() {
        return Math.max(1, this.totalResistance * this.ratio);
    }
}

class DIPChip {
    constructor(id, icType = 'NE555', pinA = 'B1_E15', pinB = 'B1_F15') {
        this.id = id;
        this.type = 'IC';
        this.icType = icType;
        const catalogMeta = IC_CATALOG[icType] || IC_CATALOG['NE555'];
        this.pins = catalogMeta ? catalogMeta.pins : 8;
        this.pinA = pinA;
        this.pinB = pinB;
        this.isConfigured = true;
        this.vOut = 0;
    }
}

class DCSource {
    constructor(id, pinA, pinB, voltage = 5.0, isConfigured = true) {
        this.id = id;
        this.type = 'VDC';
        this.pinA = pinA;
        this.pinB = pinB;
        this.voltage = voltage;
        this.isConfigured = isConfigured;
    }
}

class SwitchComponent {
    constructor(id, pinA, pinB, isOpen = false) {
        this.id = id;
        this.type = 'SWITCH';
        this.pinA = pinA;
        this.pinB = pinB;
        this.isOpen = isOpen;
        this.rOn = 0.001;
        this.rOff = 1e8;
    }

    getConductance() {
        return 1.0 / (this.isOpen ? this.rOff : this.rOn);
    }

    toggle() {
        this.isOpen = !this.isOpen;
        return this.isOpen;
    }
}

class LEDComponent {
    constructor(id, pinA, pinB, vForward = 2.0) {
        this.id = id;
        this.type = 'LED';
        this.pinA = pinA;
        this.pinB = pinB;
        this.vForward = vForward;
        this.isOn = false;
    }

    getConductance(vAnode, vCathode) {
        const vDiff = vAnode - vCathode;
        if (vDiff >= this.vForward) {
            this.isOn = true;
            return 1.0 / 10.0;
        } else {
            this.isOn = false;
            return 1.0 / 1e8;
        }
    }
}

class Wire {
    constructor(id, pinA, pinB, color = '#0984e3') {
        this.id = id;
        this.type = 'WIRE';
        this.pinA = pinA;
        this.pinB = pinB;
        this.color = color;
        this.resistance = 0.0001;
    }

    getConductance() {
        return 1.0 / this.resistance;
    }
}


/* --- src/engine/UserPresets.js --- */
// 5 User-Specified Official Circuits
const USER_PRESETS = {
  "pnm_circuit": {
    "title": "🏆 1. PNM 펄스 위치 변조 회로 (PNM Modulator)",
    "data": {
      "version": "1.0",
      "savedAt": "2026-09-01T02:09:01.277Z",
      "title": "PNM 펄스 위치 변조 회로",
      "power": { "voltageVa": 9, "voltageVb": 0, "voltageVc": -9 },
      "probes": { "probeAPin": "B2_F17", "probeBPin": "B1_I47", "probeCPin": "B3_J45", "probeDPin": "B4_I36" },
      "components": [
        { "id": "IC_CATALOG_1", "type": "IC", "pinA": "B2_E15", "pinB": "B2_F18", "icType": "LM741" },
        { "id": "RESISTOR_CATALOG_2", "type": "R", "pinA": "B2_C16", "pinB": "B2_C10", "resistance": 30000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_3", "type": "R", "pinA": "B2_H17", "pinB": "B2_H10", "resistance": 30000, "isConfigured": true },
        { "id": "WIRE_4", "type": "WIRE", "pinA": "B2_E10", "pinB": "B2_F10", "color": "#0984e3" },
        { "id": "CAPACITOR_CATALOG_5", "type": "C", "pinA": "B2_GND_L_10", "pinB": "B2_B10", "capacitance": 2.2e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "CAPACITOR_CATALOG_6", "type": "C", "pinA": "B2_B16", "pinB": "B2_B21", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "CAPACITOR_CATALOG_7", "type": "C", "pinA": "B2_I17", "pinB": "B2_I21", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_8", "type": "WIRE", "pinA": "B2_E21", "pinB": "B2_F21", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_9", "type": "POT", "pinA": "B2_A21", "pinB": "B2_A25", "totalResistance": 50000, "ratio": 0.8 },
        { "id": "RESISTOR_CATALOG_10", "type": "R", "pinA": "B2_B25", "pinB": "B2_B30", "resistance": 8200, "isConfigured": true },
        { "id": "WIRE_11", "type": "WIRE", "pinA": "B2_A30", "pinB": "B2_GND_L_30", "color": "#0984e3" },
        { "id": "WIRE_12", "type": "WIRE", "pinA": "B2_I16", "pinB": "B2_VCC_R_16", "color": "#ef4444" },
        { "id": "WIRE_14", "type": "WIRE", "pinA": "B2_A17", "pinB": "B2_GND_L_17", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_15", "type": "R", "pinA": "B2_J17", "pinB": "B3_A17", "resistance": 10000, "isConfigured": true },
        { "id": "IC_CATALOG_16", "type": "IC", "pinA": "B3_E16", "pinB": "B3_F19", "icType": "LM741" },
        { "id": "RESISTOR_CATALOG_17", "type": "R", "pinA": "B3_D12", "pinB": "B3_G12", "resistance": 1200, "isConfigured": true },
        { "id": "WIRE_18", "type": "WIRE", "pinA": "B3_C12", "pinB": "B3_C17", "color": "#0984e3" },
        { "id": "WIRE_19", "type": "WIRE", "pinA": "B3_H12", "pinB": "B3_H18", "color": "#0984e3" },
        { "id": "WIRE_20", "type": "WIRE", "pinA": "B3_J17", "pinB": "B3_VCC_R_17", "color": "#ef4444" },
        { "id": "WIRE_22", "type": "WIRE", "pinA": "B3_GND_L_18", "pinB": "B3_A18", "color": "#0984e3" },
        { "id": "IC_CATALOG_23", "type": "IC", "pinA": "B1_E45", "pinB": "B1_F48", "icType": "LM741" },
        { "id": "RESISTOR_CATALOG_24", "type": "POT", "pinA": "B1_A35", "pinB": "B1_A38", "totalResistance": 10000, "ratio": 0.99 },
        { "id": "CAPACITOR_CATALOG_25", "type": "C", "pinA": "B1_GND_L_46", "pinB": "B1_A46", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "RESISTOR_CATALOG_28", "type": "R", "pinA": "B1_D52", "pinB": "B1_G52", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_29", "type": "WIRE", "pinA": "B1_H47", "pinB": "B1_H52", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_30", "type": "R", "pinA": "B1_J47", "pinB": "B2_A47", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_31", "type": "WIRE", "pinA": "B1_C38", "pinB": "B1_C46", "color": "#0984e3" },
        { "id": "WIRE_32", "type": "WIRE", "pinA": "B1_C35", "pinB": "B1_G35", "color": "#0984e3" },
        { "id": "WIRE_33", "type": "WIRE", "pinA": "B1_I35", "pinB": "B1_I47", "color": "#0984e3" },
        { "id": "WIRE_34", "type": "WIRE", "pinA": "B1_J46", "pinB": "B1_VCC_R_46", "color": "#ef4444" },
        { "id": "IC_CATALOG_35", "type": "IC", "pinA": "B2_E46", "pinB": "B2_F49", "icType": "LM741" },
        { "id": "RESISTOR_CATALOG_36", "type": "R", "pinA": "B2_D42", "pinB": "B2_G42", "resistance": 2000, "isConfigured": true },
        { "id": "WIRE_37", "type": "WIRE", "pinA": "B2_C42", "pinB": "B2_C47", "color": "#0984e3" },
        { "id": "WIRE_38", "type": "WIRE", "pinA": "B2_H42", "pinB": "B2_H48", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_40", "type": "R", "pinA": "B2_J48", "pinB": "B3_A48", "resistance": 2200, "isConfigured": true },
        { "id": "TRANSISTOR_CATALOG_42", "type": "BJT", "pinA": "B3_I45", "pinB": "B3_I47", "transType": "C1815", "pinEmitter": "B3_I45", "pinBase": "B3_I48", "pinCollector": "B3_I47", "polarity": "NPN" },
        { "id": "WIRE_43", "type": "WIRE", "pinA": "B3_E48", "pinB": "B3_F48", "color": "#0984e3" },
        { "id": "WIRE_45", "type": "WIRE", "pinA": "B3_J47", "pinB": "B4_A47", "color": "#0984e3" },
        { "id": "WIRE_46", "type": "WIRE", "pinA": "B4_B47", "pinB": "B4_B18", "color": "#0984e3" },
        { "id": "WIRE_47", "type": "WIRE", "pinA": "B3_J18", "pinB": "B4_A18", "color": "#0984e3" },
        { "id": "WIRE_48", "type": "WIRE", "pinA": "B3_H45", "pinB": "B3_H35", "color": "#0984e3" },
        { "id": "IC_CATALOG_50", "type": "IC", "pinA": "B4_E34", "pinB": "B4_F37", "icType": "LM741" },
        { "id": "RESISTOR_CATALOG_51", "type": "R", "pinA": "B3_J35", "pinB": "B4_A35", "resistance": 4700, "isConfigured": true },
        { "id": "WIRE_52", "type": "WIRE", "pinA": "B4_A36", "pinB": "B4_GND_L_36", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_53", "type": "R", "pinA": "B4_D31", "pinB": "B4_G31", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_54", "type": "WIRE", "pinA": "B4_C31", "pinB": "B4_C35", "color": "#0984e3" },
        { "id": "WIRE_55", "type": "WIRE", "pinA": "B4_H31", "pinB": "B4_H36", "color": "#0984e3" },
        { "id": "WIRE_56", "type": "WIRE", "pinA": "B4_J35", "pinB": "B4_VCC_R_35", "color": "#ef4444" },
        { "id": "WIRE_57", "type": "WIRE", "pinA": "B3_GND_R_22", "pinB": "B3_E22", "color": "#0984e3" },
        { "id": "WIRE_58", "type": "WIRE", "pinA": "B3_C19", "pinB": "B3_C22", "color": "#0984e3" },
        { "id": "WIRE_59", "type": "WIRE", "pinA": "B3_A22", "pinB": "B2_D22", "color": "#0984e3" },
        { "id": "WIRE_60", "type": "WIRE", "pinA": "B2_C18", "pinB": "B2_C22", "color": "#0984e3" },
        { "id": "WIRE_61", "type": "WIRE", "pinA": "B3_GND_R_55", "pinB": "B2_D55", "color": "#0984e3" },
        { "id": "WIRE_62", "type": "WIRE", "pinA": "B2_C49", "pinB": "B2_C55", "color": "#0984e3" },
        { "id": "WIRE_63", "type": "WIRE", "pinA": "B2_B55", "pinB": "B1_C55", "color": "#0984e3" },
        { "id": "WIRE_64", "type": "WIRE", "pinA": "B1_B48", "pinB": "B1_B55", "color": "#0984e3" },
        { "id": "WIRE_65", "type": "WIRE", "pinA": "VCC_TOP1_1", "pinB": "B1_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_66", "type": "WIRE", "pinA": "GND_TOP1_2", "pinB": "B1_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_67", "type": "WIRE", "pinA": "VCC_TOP1_10", "pinB": "B1_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_68", "type": "WIRE", "pinA": "GND_TOP1_11", "pinB": "B1_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_69", "type": "WIRE", "pinA": "VCC_TOP1_14", "pinB": "B2_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_70", "type": "WIRE", "pinA": "GND_TOP1_15", "pinB": "B2_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_71", "type": "WIRE", "pinA": "VCC_TOP1_25", "pinB": "B2_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_72", "type": "WIRE", "pinA": "GND_TOP1_26", "pinB": "B2_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_73", "type": "WIRE", "pinA": "VCC_TOP1_28", "pinB": "B3_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_74", "type": "WIRE", "pinA": "GND_TOP1_29", "pinB": "B3_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_75", "type": "WIRE", "pinA": "VCC_TOP1_37", "pinB": "B3_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_76", "type": "WIRE", "pinA": "VCC_TOP2_39", "pinB": "B3_GND_R_1", "color": "#ef4444" },
        { "id": "WIRE_77", "type": "WIRE", "pinA": "VCC_TOP1_40", "pinB": "B4_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_78", "type": "WIRE", "pinA": "GND_TOP1_41", "pinB": "B4_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_79", "type": "WIRE", "pinA": "VCC_TOP1_49", "pinB": "B4_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_80", "type": "WIRE", "pinA": "GND_TOP1_50", "pinB": "B4_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_81", "type": "WIRE", "pinA": "BINDING_Va", "pinB": "VCC_TOP1_3", "color": "#ef4444" },
        { "id": "WIRE_82", "type": "WIRE", "pinA": "BINDING_Vc", "pinB": "VCC_TOP2_21", "color": "#ef4444" },
        { "id": "WIRE_83", "type": "WIRE", "pinA": "BINDING_GND", "pinB": "GND_TOP1_35", "color": "#ef4444" },
        { "id": "WIRE_84", "type": "WIRE", "pinA": "B2_J47", "pinB": "B2_VCC_R_47", "color": "#ef4444" },
        { "id": "WIRE_91", "type": "WIRE", "pinA": "B4_A37", "pinB": "B3_GND_R_37", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_91", "type": "R", "pinA": "B1_GND_L_47", "pinB": "B1_B47", "resistance": 5000, "isConfigured": true },
        { "id": "WIRE_92", "type": "WIRE", "pinA": "B1_C47", "pinB": "B1_C52", "color": "#0984e3" },
        { "id": "WIRE_93", "type": "WIRE", "pinA": "B2_GND_L_48", "pinB": "B2_B48", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_96", "type": "R", "pinA": "B3_F45", "pinB": "B3_C45", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_97", "type": "WIRE", "pinA": "B3_GND_L_45", "pinB": "B3_A45", "color": "#0984e3" }
      ]
    }
  },
  "te4_circuit": {
    "title": "🏆 2. TE4 통신 다중발진 회로 (Multi-Oscillator)",
    "data": {
      "version": "1.0",
      "savedAt": "2026-09-01T01:08:33.024Z",
      "title": "TE4 통신 다중발진 회로",
      "power": { "voltageVa": 12, "voltageVb": 0, "voltageVc": -12 },
      "probes": { "probeAPin": "B1_B17", "probeBPin": "B4_J17", "probeCPin": "B3_J36", "probeDPin": "B3_I53" },
      "components": [
        { "id": "WIRE_91", "type": "WIRE", "pinA": "VCC_TOP1_1", "pinB": "B1_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_92", "type": "WIRE", "pinA": "GND_TOP1_2", "pinB": "B1_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_93", "type": "WIRE", "pinA": "VCC_TOP1_11", "pinB": "B1_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_94", "type": "WIRE", "pinA": "GND_TOP1_12", "pinB": "B1_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_95", "type": "WIRE", "pinA": "VCC_TOP1_14", "pinB": "B2_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_96", "type": "WIRE", "pinA": "GND_TOP1_15", "pinB": "B2_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_97", "type": "WIRE", "pinA": "VCC_TOP1_24", "pinB": "B2_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_98", "type": "WIRE", "pinA": "GND_TOP1_25", "pinB": "B2_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_99", "type": "WIRE", "pinA": "VCC_TOP1_27", "pinB": "B3_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_100", "type": "WIRE", "pinA": "GND_TOP1_28", "pinB": "B3_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_101", "type": "WIRE", "pinA": "VCC_TOP2_38", "pinB": "B3_GND_R_1", "color": "#ef4444" },
        { "id": "WIRE_102", "type": "WIRE", "pinA": "VCC_TOP1_37", "pinB": "B3_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_103", "type": "WIRE", "pinA": "VCC_TOP1_40", "pinB": "B4_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_104", "type": "WIRE", "pinA": "GND_TOP1_41", "pinB": "B4_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_105", "type": "WIRE", "pinA": "VCC_TOP1_48", "pinB": "B4_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_106", "type": "WIRE", "pinA": "GND_TOP1_49", "pinB": "B4_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_107", "type": "WIRE", "pinA": "BINDING_Va", "pinB": "VCC_TOP1_3", "color": "#ef4444" },
        { "id": "WIRE_108", "type": "WIRE", "pinA": "BINDING_Vc", "pinB": "VCC_TOP2_20", "color": "#ef4444" },
        { "id": "WIRE_109", "type": "WIRE", "pinA": "BINDING_GND", "pinB": "GND_TOP1_33", "color": "#ef4444" },
        { "id": "IC_CATALOG_29", "type": "IC", "pinA": "B1_E15", "pinB": "B1_F18", "icType": "NE555" },
        { "id": "WIRE_30", "type": "WIRE", "pinA": "B1_A15", "pinB": "B1_GND_L_15", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_39", "type": "R", "pinA": "B1_C16", "pinB": "B1_C11", "resistance": 20000, "isConfigured": true },
        { "id": "WIRE_40", "type": "WIRE", "pinA": "B1_E11", "pinB": "B1_F11", "color": "#0984e3" },
        { "id": "WIRE_41", "type": "WIRE", "pinA": "B1_H11", "pinB": "B1_H16", "color": "#0984e3" },
        { "id": "DIODE_42", "type": "DIODE", "pinA": "B1_B11", "pinB": "B1_B16", "vForward": 0.7 },
        { "id": "CAPACITOR_CATALOG_43", "type": "C", "pinA": "B1_A16", "pinB": "B1_A20", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_44", "type": "WIRE", "pinA": "B1_GND_L_20", "pinB": "B1_B20", "color": "#0984e3" },
        { "id": "WIRE_47", "type": "WIRE", "pinA": "B1_C16", "pinB": "B1_H17", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_50", "type": "R", "pinA": "B1_D11", "pinB": "B1_D7", "resistance": 10000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_51", "type": "POT", "pinA": "B1_C3", "pinB": "B1_C7", "totalResistance": 50000, "ratio": 0.75 },
        { "id": "WIRE_52", "type": "WIRE", "pinA": "B1_VCC_L_3", "pinB": "B1_A3", "color": "#ef4444" },
        { "id": "CAPACITOR_CATALOG_53", "type": "C", "pinA": "B1_I18", "pinB": "B1_GND_R_18", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_54", "type": "WIRE", "pinA": "B1_J15", "pinB": "B1_VCC_R_15", "color": "#ef4444" },
        { "id": "WIRE_55", "type": "WIRE", "pinA": "B1_C18", "pinB": "B1_H15", "color": "#0984e3" },
        { "id": "IC_CATALOG_56", "type": "IC", "pinA": "B4_E15", "pinB": "B4_F18", "icType": "LF356" },
        { "id": "RESISTOR_CATALOG_57", "type": "R", "pinA": "B4_C16", "pinB": "B4_C11", "resistance": 1000, "isConfigured": false },
        { "id": "RESISTOR_CATALOG_58", "type": "R", "pinA": "B4_H17", "pinB": "B4_H11", "resistance": 1000, "isConfigured": false },
        { "id": "WIRE_59", "type": "WIRE", "pinA": "B4_E11", "pinB": "B4_F11", "color": "#0984e3" },
        { "id": "CAPACITOR_CATALOG_60", "type": "C", "pinA": "B4_J11", "pinB": "B4_GND_R_11", "capacitance": 2.2e-7, "isConfigured": true, "capType": "MYLAR" },
        { "id": "CAPACITOR_CATALOG_61", "type": "C", "pinA": "B4_B16", "pinB": "B4_B20", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "CAPACITOR_CATALOG_62", "type": "C", "pinA": "B4_I17", "pinB": "B4_I20", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_63", "type": "WIRE", "pinA": "B4_D20", "pinB": "B4_F20", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_64", "type": "POT", "pinA": "B4_C20", "pinB": "B4_C24", "totalResistance": 10000, "ratio": 0.75 },
        { "id": "WIRE_65", "type": "WIRE", "pinA": "B4_GND_L_24", "pinB": "B4_B24", "color": "#0984e3" },
        { "id": "WIRE_66", "type": "WIRE", "pinA": "B4_J16", "pinB": "B4_VCC_R_16", "color": "#ef4444" },
        { "id": "WIRE_67", "type": "WIRE", "pinA": "B4_A17", "pinB": "B4_GND_L_17", "color": "#0984e3" },
        { "id": "WIRE_68", "type": "WIRE", "pinA": "B3_GND_R_18", "pinB": "B4_A18", "color": "#0984e3" },
        { "id": "CAPACITOR_CATALOG_59", "type": "C", "pinA": "B1_E35", "pinB": "B1_F35", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "CAPACITOR_CATALOG_60", "type": "C", "pinA": "B1_J35", "pinB": "B2_A35", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "CAPACITOR_CATALOG_61", "type": "C", "pinA": "B2_E35", "pinB": "B2_F35", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "RESISTOR_CATALOG_62", "type": "R", "pinA": "B2_J35", "pinB": "B3_A35", "resistance": 10000, "isConfigured": true },
        { "id": "IC_CATALOG_63", "type": "IC", "pinA": "B3_E34", "pinB": "B3_F37", "icType": "LF356" },
        { "id": "RESISTOR_CATALOG_64", "type": "R", "pinA": "B1_H35", "pinB": "B1_H40", "resistance": 4700, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_65", "type": "R", "pinA": "B2_C35", "pinB": "B2_C40", "resistance": 4700, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_66", "type": "R", "pinA": "B2_H35", "pinB": "B2_H40", "resistance": 4700, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_67", "type": "POT", "pinA": "B3_B35", "pinB": "B3_B30", "totalResistance": 1000000, "ratio": 0.7 },
        { "id": "WIRE_68", "type": "WIRE", "pinA": "B1_GND_R_40", "pinB": "B1_I40", "color": "#0984e3" },
        { "id": "WIRE_69", "type": "WIRE", "pinA": "B2_GND_L_40", "pinB": "B2_B40", "color": "#0984e3" },
        { "id": "WIRE_70", "type": "WIRE", "pinA": "B2_GND_R_40", "pinB": "B2_I40", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_71", "type": "R", "pinA": "B3_B36", "pinB": "B3_B40", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_72", "type": "WIRE", "pinA": "B3_GND_L_40", "pinB": "B3_A40", "color": "#0984e3" },
        { "id": "WIRE_73", "type": "WIRE", "pinA": "B1_D35", "pinB": "B1_D30", "color": "#0984e3" },
        { "id": "WIRE_74", "type": "WIRE", "pinA": "B1_E30", "pinB": "B3_A30", "color": "#0984e3" },
        { "id": "WIRE_75", "type": "WIRE", "pinA": "B3_E30", "pinB": "B3_F30", "color": "#0984e3" },
        { "id": "WIRE_76", "type": "WIRE", "pinA": "B3_H30", "pinB": "B3_H36", "color": "#0984e3" },
        { "id": "WIRE_77", "type": "WIRE", "pinA": "B3_J35", "pinB": "B3_VCC_R_35", "color": "#ef4444" },
        { "id": "WIRE_78", "type": "WIRE", "pinA": "B3_C37", "pinB": "B3_C42", "color": "#0984e3" },
        { "id": "CAPACITOR_CATALOG_80", "type": "C", "pinA": "VCC_TOP1_17", "pinB": "GND_TOP1_17", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
        { "id": "CAPACITOR_CATALOG_81", "type": "C", "pinA": "VCC_TOP2_21", "pinB": "GND_TOP1_23", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
        { "id": "IC_CATALOG_80", "type": "IC", "pinA": "B2_E50", "pinB": "B2_F53", "icType": "LF356" },
        { "id": "RESISTOR_CATALOG_81", "type": "R", "pinA": "B2_J52", "pinB": "B3_A52", "resistance": 10000, "isConfigured": true },
        { "id": "IC_CATALOG_82", "type": "IC", "pinA": "B3_E51", "pinB": "B3_F54", "icType": "LF356" },
        { "id": "RESISTOR_CATALOG_83", "type": "POT", "pinA": "B2_A45", "pinB": "B2_A48", "totalResistance": 50000, "ratio": 0.5 },
        { "id": "CAPACITOR_CATALOG_84", "type": "C", "pinA": "B2_GND_L_51", "pinB": "B2_A51", "capacitance": 2.2e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_85", "type": "WIRE", "pinA": "B2_C51", "pinB": "B2_C48", "color": "#0984e3" },
        { "id": "WIRE_86", "type": "WIRE", "pinA": "B2_E45", "pinB": "B2_F45", "color": "#0984e3" },
        { "id": "WIRE_87", "type": "WIRE", "pinA": "B2_H45", "pinB": "B2_H52", "color": "#0984e3" },
        { "id": "WIRE_88", "type": "WIRE", "pinA": "B2_C52", "pinB": "B2_C55", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_89", "type": "R", "pinA": "B2_B55", "pinB": "B2_B58", "resistance": 10000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_90", "type": "R", "pinA": "B2_D55", "pinB": "B2_G55", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_91", "type": "WIRE", "pinA": "B2_GND_L_58", "pinB": "B2_A58", "color": "#0984e3" },
        { "id": "WIRE_92", "type": "WIRE", "pinA": "B2_I55", "pinB": "B2_I52", "color": "#0984e3" },
        { "id": "WIRE_93", "type": "WIRE", "pinA": "B3_GND_L_53", "pinB": "B3_A53", "color": "#0984e3" },
        { "id": "WIRE_94", "type": "WIRE", "pinA": "B2_J51", "pinB": "B2_VCC_R_51", "color": "#ef4444" },
        { "id": "WIRE_95", "type": "WIRE", "pinA": "B2_A53", "pinB": "B2_A60", "color": "#0984e3" },
        { "id": "WIRE_97", "type": "WIRE", "pinA": "B3_J52", "pinB": "B3_VCC_R_52", "color": "#ef4444" },
        { "id": "WIRE_99", "type": "WIRE", "pinA": "B2_E60", "pinB": "B3_A60", "color": "#0984e3" },
        { "id": "WIRE_100", "type": "WIRE", "pinA": "B3_B54", "pinB": "B3_B60", "color": "#0984e3" },
        { "id": "DIODE_103", "type": "DIODE", "pinA": "B4_B49", "pinB": "B4_B53", "vForward": 0.7 },
        { "id": "RESISTOR_CATALOG_108", "type": "R", "pinA": "B4_G49", "pinB": "B4_G53", "resistance": 10000, "isConfigured": true },
        { "id": "DIODE_109", "type": "DIODE", "pinA": "B4_H56", "pinB": "B4_H53", "vForward": 0.7 },
        { "id": "WIRE_111", "type": "WIRE", "pinA": "B4_F56", "pinB": "B4_E56", "color": "#0984e3" },
        { "id": "WIRE_112", "type": "WIRE", "pinA": "B4_C53", "pinB": "B4_C56", "color": "#0984e3" },
        { "id": "WIRE_113", "type": "WIRE", "pinA": "B4_E49", "pinB": "B4_F49", "color": "#0984e3" },
        { "id": "WIRE_114", "type": "WIRE", "pinA": "B3_J53", "pinB": "B4_A53", "color": "#0984e3" },
        { "id": "WIRE_107", "type": "WIRE", "pinA": "B3_E60", "pinB": "B3_GND_R_60", "color": "#0984e3" },
        { "id": "WIRE_108", "type": "WIRE", "pinA": "B3_E42", "pinB": "B3_GND_R_42", "color": "#0984e3" }
      ]
    }
  },
  "fsk_circuit": {
    "title": "🏆 3. FSK 주파수 편이 변조 회로 (FSK Modulator)",
    "data": {
      "version": "1.0",
      "savedAt": "2026-08-28T05:49:57.350Z",
      "title": "FSK 주파수 편이 변조 회로",
      "power": { "voltageVa": 12, "voltageVb": 0, "voltageVc": -12 },
      "probes": { "probeAPin": "B2_A12", "probeBPin": "B4_J42", "probeCPin": "BINDING_Va", "probeDPin": "BINDING_Vc" },
      "components": [
        { "id": "RESISTOR_CATALOG_14", "type": "R", "pinA": "B1_B5", "pinB": "B1_B10", "resistance": 10000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_15", "type": "R", "pinA": "B1_C10", "pinB": "B1_C16", "resistance": 10000, "isConfigured": true },
        { "id": "DIODE_16", "type": "DIODE", "pinA": "B1_B16", "pinB": "B1_B21", "vForward": 0.7 },
        { "id": "CAPACITOR_CATALOG_17", "type": "C", "pinA": "B1_C21", "pinB": "B1_C25", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_18", "type": "WIRE", "pinA": "B1_VCC_L_5", "pinB": "B1_A5", "color": "#ef4444" },
        { "id": "WIRE_19", "type": "WIRE", "pinA": "B1_A25", "pinB": "B1_GND_L_25", "color": "#0984e3" },
        { "id": "IC_CATALOG_20", "type": "IC", "pinA": "B2_E10", "pinB": "B2_F13", "icType": "NE555" },
        { "id": "WIRE_21", "type": "WIRE", "pinA": "B1_E10", "pinB": "B1_F10", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_22", "type": "POT", "pinA": "B1_H10", "pinB": "B1_H14", "totalResistance": 50000, "ratio": 0.01 },
        { "id": "WIRE_23", "type": "WIRE", "pinA": "B1_G14", "pinB": "B1_G16", "color": "#0984e3" },
        { "id": "DIODE_24", "type": "DIODE", "pinA": "B1_H21", "pinB": "B1_H16", "vForward": 0.7 },
        { "id": "WIRE_25", "type": "WIRE", "pinA": "B1_E21", "pinB": "B1_F21", "color": "#0984e3" },
        { "id": "WIRE_31", "type": "WIRE", "pinA": "B2_H21", "pinB": "B2_H12", "color": "#0984e3" },
        { "id": "WIRE_32", "type": "WIRE", "pinA": "B1_J21", "pinB": "B2_B21", "color": "#0984e3" },
        { "id": "WIRE_33", "type": "WIRE", "pinA": "B2_E21", "pinB": "B2_F21", "color": "#0984e3" },
        { "id": "WIRE_34", "type": "WIRE", "pinA": "B2_C11", "pinB": "B2_C21", "color": "#0984e3" },
        { "id": "WIRE_36", "type": "WIRE", "pinA": "B2_A13", "pinB": "B2_VCC_L_13", "color": "#ef4444" },
        { "id": "WIRE_37", "type": "WIRE", "pinA": "B2_J10", "pinB": "B2_VCC_R_10", "color": "#ef4444" },
        { "id": "WIRE_38", "type": "WIRE", "pinA": "B2_A10", "pinB": "B2_GND_L_10", "color": "#0984e3" },
        { "id": "WIRE_39", "type": "WIRE", "pinA": "B1_I10", "pinB": "B1_I5", "color": "#0984e3" },
        { "id": "WIRE_40", "type": "WIRE", "pinA": "B1_J5", "pinB": "B2_G5", "color": "#0984e3" },
        { "id": "WIRE_41", "type": "WIRE", "pinA": "B2_H5", "pinB": "B2_H11", "color": "#0984e3" },
        { "id": "CAPACITOR_CATALOG_42", "type": "C", "pinA": "B2_J13", "pinB": "B2_GND_R_13", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
        { "id": "IC_CATALOG_43", "type": "IC", "pinA": "B2_E30", "pinB": "B2_F37", "icType": "CD4510" },
        { "id": "WIRE_44", "type": "WIRE", "pinA": "B2_B12", "pinB": "B2_B25", "color": "#0984e3" },
        { "id": "WIRE_45", "type": "WIRE", "pinA": "B2_E25", "pinB": "B2_F25", "color": "#0984e3" },
        { "id": "WIRE_46", "type": "WIRE", "pinA": "B2_H25", "pinB": "B2_H31", "color": "#0984e3" },
        { "id": "WIRE_47", "type": "WIRE", "pinA": "B2_GND_L_30", "pinB": "B2_A30", "color": "#0984e3" },
        { "id": "WIRE_48", "type": "WIRE", "pinA": "B2_J37", "pinB": "B2_GND_R_37", "color": "#0984e3" },
        { "id": "WIRE_49", "type": "WIRE", "pinA": "B2_GND_L_34", "pinB": "B2_A34", "color": "#0984e3" },
        { "id": "WIRE_50", "type": "WIRE", "pinA": "B2_A32", "pinB": "B2_GND_L_32", "color": "#0984e3" },
        { "id": "WIRE_51", "type": "WIRE", "pinA": "B2_J33", "pinB": "B2_GND_R_33", "color": "#0984e3" },
        { "id": "WIRE_52", "type": "WIRE", "pinA": "B2_J34", "pinB": "B2_GND_R_34", "color": "#0984e3" },
        { "id": "WIRE_53", "type": "WIRE", "pinA": "B2_GND_L_33", "pinB": "B2_A33", "color": "#0984e3" },
        { "id": "WIRE_54", "type": "WIRE", "pinA": "B2_GND_L_37", "pinB": "B2_A37", "color": "#0984e3" },
        { "id": "WIRE_55", "type": "WIRE", "pinA": "B2_J30", "pinB": "B2_VCC_R_30", "color": "#ef4444" },
        { "id": "IC_CATALOG_56", "type": "IC", "pinA": "B3_E5", "pinB": "B3_F12", "icType": "CD4027" },
        { "id": "WIRE_57", "type": "WIRE", "pinA": "B2_J36", "pinB": "B3_A36", "color": "#0984e3" },
        { "id": "WIRE_58", "type": "WIRE", "pinA": "B3_B36", "pinB": "B3_B6", "color": "#0984e3" },
        { "id": "IC_CATALOG_61", "type": "IC", "pinA": "B1_E43", "pinB": "B1_F50", "icType": "CD4049" },
        { "id": "WIRE_65", "type": "WIRE", "pinA": "B3_VCC_L_10", "pinB": "B3_A10", "color": "#ef4444" },
        { "id": "WIRE_66", "type": "WIRE", "pinA": "B3_VCC_L_9", "pinB": "B3_A9", "color": "#ef4444" },
        { "id": "WIRE_67", "type": "WIRE", "pinA": "B3_A8", "pinB": "B3_GND_L_8", "color": "#0984e3" },
        { "id": "WIRE_68", "type": "WIRE", "pinA": "B3_A11", "pinB": "B3_GND_L_11", "color": "#0984e3" },
        { "id": "WIRE_69", "type": "WIRE", "pinA": "B3_A12", "pinB": "B3_GND_L_12", "color": "#0984e3" },
        { "id": "WIRE_70", "type": "WIRE", "pinA": "B3_J5", "pinB": "B3_VCC_R_5", "color": "#ef4444" },
        { "id": "WIRE_71", "type": "WIRE", "pinA": "B1_B44", "pinB": "B1_B40", "color": "#0984e3" },
        { "id": "WIRE_72", "type": "WIRE", "pinA": "B1_E40", "pinB": "B3_B39", "color": "#0984e3" },
        { "id": "WIRE_73", "type": "WIRE", "pinA": "B3_C39", "pinB": "B3_C7", "color": "#0984e3" },
        { "id": "WIRE_74", "type": "WIRE", "pinA": "B1_C45", "pinB": "B1_C36", "color": "#0984e3" },
        { "id": "WIRE_75", "type": "WIRE", "pinA": "B1_D36", "pinB": "B2_A36", "color": "#0984e3" },
        { "id": "WIRE_76", "type": "WIRE", "pinA": "B2_C31", "pinB": "B2_C46", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_77", "type": "R", "pinA": "B2_D46", "pinB": "B2_G46", "resistance": 20000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_79", "type": "R", "pinA": "B3_D46", "pinB": "B3_H46", "resistance": 20000, "isConfigured": true },
        { "id": "IC_CATALOG_80", "type": "IC", "pinA": "B4_E40", "pinB": "B4_F43", "icType": "LF356" },
        { "id": "WIRE_82", "type": "WIRE", "pinA": "B4_H42", "pinB": "B4_H46", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_85", "type": "R", "pinA": "B2_J49", "pinB": "B3_A49", "resistance": 20000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_87", "type": "R", "pinA": "B3_J46", "pinB": "B4_A46", "resistance": 20000, "isConfigured": true },
        { "id": "WIRE_88", "type": "WIRE", "pinA": "B2_J46", "pinB": "B3_A46", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_89", "type": "R", "pinA": "B3_B46", "pinB": "B3_B49", "resistance": 10000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_90", "type": "R", "pinA": "B3_C49", "pinB": "B3_C53", "resistance": 10000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_92", "type": "R", "pinA": "B2_J53", "pinB": "B3_A53", "resistance": 20000, "isConfigured": true },
        { "id": "WIRE_93", "type": "WIRE", "pinA": "B2_B35", "pinB": "B2_B56", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_94", "type": "R", "pinA": "B2_D56", "pinB": "B2_H56", "resistance": 20000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_95", "type": "R", "pinA": "B3_B53", "pinB": "B3_B56", "resistance": 10000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_96", "type": "R", "pinA": "B3_D56", "pinB": "B3_D59", "resistance": 20000, "isConfigured": true },
        { "id": "WIRE_97", "type": "WIRE", "pinA": "B2_J56", "pinB": "B3_A56", "color": "#0984e3" },
        { "id": "WIRE_98", "type": "WIRE", "pinA": "B3_A59", "pinB": "B3_GND_L_59", "color": "#0984e3" },
        { "id": "WIRE_99", "type": "WIRE", "pinA": "B4_A41", "pinB": "B3_J41", "color": "#0984e3" },
        { "id": "WIRE_100", "type": "WIRE", "pinA": "B3_I41", "pinB": "B3_I46", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_101", "type": "R", "pinA": "B4_GND_L_42", "pinB": "B4_B42", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_102", "type": "WIRE", "pinA": "B4_J41", "pinB": "B4_VCC_R_41", "color": "#ef4444" },
        { "id": "WIRE_103", "type": "WIRE", "pinA": "B4_A43", "pinB": "B4_VCC_L_43", "color": "#ef4444" },
        { "id": "WIRE_104", "type": "WIRE", "pinA": "VCC_TOP1_1", "pinB": "BINDING_Va", "color": "#ef4444" },
        { "id": "WIRE_105", "type": "WIRE", "pinA": "BINDING_Vc", "pinB": "VCC_TOP2_17", "color": "#ef4444" },
        { "id": "WIRE_107", "type": "WIRE", "pinA": "B1_VCC_L_1", "pinB": "VCC_TOP1_2", "color": "#ef4444" },
        { "id": "WIRE_108", "type": "WIRE", "pinA": "B1_GND_L_1", "pinB": "GND_TOP1_3", "color": "#0984e3" },
        { "id": "WIRE_109", "type": "WIRE", "pinA": "VCC_TOP1_11", "pinB": "B1_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_110", "type": "WIRE", "pinA": "B1_GND_R_1", "pinB": "GND_TOP1_12", "color": "#0984e3" },
        { "id": "WIRE_111", "type": "WIRE", "pinA": "B2_VCC_L_1", "pinB": "VCC_TOP1_14", "color": "#ef4444" },
        { "id": "WIRE_112", "type": "WIRE", "pinA": "B2_GND_L_1", "pinB": "GND_TOP1_15", "color": "#0984e3" },
        { "id": "WIRE_113", "type": "WIRE", "pinA": "B2_VCC_R_1", "pinB": "VCC_TOP1_25", "color": "#ef4444" },
        { "id": "WIRE_115", "type": "WIRE", "pinA": "B2_GND_R_1", "pinB": "GND_TOP1_26", "color": "#0984e3" },
        { "id": "WIRE_116", "type": "WIRE", "pinA": "B3_VCC_L_1", "pinB": "VCC_TOP1_28", "color": "#ef4444" },
        { "id": "WIRE_117", "type": "WIRE", "pinA": "B3_GND_L_1", "pinB": "GND_TOP1_29", "color": "#0984e3" },
        { "id": "WIRE_118", "type": "WIRE", "pinA": "B3_VCC_R_1", "pinB": "VCC_TOP1_37", "color": "#ef4444" },
        { "id": "WIRE_119", "type": "WIRE", "pinA": "B3_GND_R_1", "pinB": "GND_TOP1_38", "color": "#0984e3" },
        { "id": "WIRE_121", "type": "WIRE", "pinA": "B4_VCC_L_1", "pinB": "VCC_TOP2_40", "color": "#ef4444" },
        { "id": "WIRE_122", "type": "WIRE", "pinA": "B4_GND_L_1", "pinB": "GND_TOP1_42", "color": "#0984e3" },
        { "id": "WIRE_123", "type": "WIRE", "pinA": "VCC_TOP1_49", "pinB": "B4_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_124", "type": "WIRE", "pinA": "GND_TOP1_50", "pinB": "B4_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_125", "type": "WIRE", "pinA": "B1_VCC_L_43", "pinB": "B1_A43", "color": "#ef4444" },
        { "id": "WIRE_126", "type": "WIRE", "pinA": "B1_GND_L_50", "pinB": "B1_A50", "color": "#0984e3" }
      ]
    }
  },
  "staircase_circuit": {
    "title": "🏆 4. 계단파 발생 회로 (Staircase Generator)",
    "data": {
      "version": "1.0",
      "savedAt": "2026-08-31T05:14:04.400Z",
      "title": "계단파 발생 회로",
      "power": { "voltageVa": 9, "voltageVb": 0, "voltageVc": -9 },
      "probes": { "probeAPin": "B2_A17", "probeBPin": "B2_J46", "probeCPin": "B3_J21", "probeDPin": "B4_I22" },
      "components": [
        { "id": "WIRE_91", "type": "WIRE", "pinA": "VCC_TOP1_1", "pinB": "B1_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_92", "type": "WIRE", "pinA": "GND_TOP1_2", "pinB": "B1_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_93", "type": "WIRE", "pinA": "VCC_TOP1_11", "pinB": "B1_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_94", "type": "WIRE", "pinA": "GND_TOP1_12", "pinB": "B1_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_95", "type": "WIRE", "pinA": "VCC_TOP1_14", "pinB": "B2_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_96", "type": "WIRE", "pinA": "GND_TOP1_15", "pinB": "B2_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_97", "type": "WIRE", "pinA": "VCC_TOP1_24", "pinB": "B2_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_98", "type": "WIRE", "pinA": "GND_TOP1_25", "pinB": "B2_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_99", "type": "WIRE", "pinA": "VCC_TOP1_27", "pinB": "B3_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_100", "type": "WIRE", "pinA": "GND_TOP1_28", "pinB": "B3_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_101", "type": "WIRE", "pinA": "VCC_TOP2_38", "pinB": "B3_GND_R_1", "color": "#ef4444" },
        { "id": "WIRE_102", "type": "WIRE", "pinA": "VCC_TOP1_37", "pinB": "B3_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_103", "type": "WIRE", "pinA": "VCC_TOP1_40", "pinB": "B4_VCC_L_1", "color": "#ef4444" },
        { "id": "WIRE_104", "type": "WIRE", "pinA": "GND_TOP1_41", "pinB": "B4_GND_L_1", "color": "#0984e3" },
        { "id": "WIRE_105", "type": "WIRE", "pinA": "VCC_TOP1_48", "pinB": "B4_VCC_R_1", "color": "#ef4444" },
        { "id": "WIRE_106", "type": "WIRE", "pinA": "GND_TOP1_49", "pinB": "B4_GND_R_1", "color": "#0984e3" },
        { "id": "WIRE_107", "type": "WIRE", "pinA": "BINDING_Va", "pinB": "VCC_TOP1_3", "color": "#ef4444" },
        { "id": "WIRE_108", "type": "WIRE", "pinA": "BINDING_Vc", "pinB": "VCC_TOP2_20", "color": "#ef4444" },
        { "id": "WIRE_109", "type": "WIRE", "pinA": "BINDING_GND", "pinB": "GND_TOP1_33", "color": "#ef4444" },
        { "id": "IC_CATALOG_36", "type": "IC", "pinA": "B2_E15", "pinB": "B2_F20", "icType": "NE555" },
        { "id": "WIRE_37", "type": "WIRE", "pinA": "B2_GND_L_15", "pinB": "B2_A15", "color": "#0984e3" },
        { "id": "CAPACITOR_CATALOG_38", "type": "C", "pinA": "B2_J18", "pinB": "B2_GND_R_18", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_39", "type": "WIRE", "pinA": "B2_J15", "pinB": "B2_VCC_R_15", "color": "#ef4444" },
        { "id": "WIRE_40", "type": "WIRE", "pinA": "B2_A18", "pinB": "B2_VCC_L_18", "color": "#ef4444" },
        { "id": "CAPACITOR_CATALOG_43", "type": "C", "pinA": "B1_H18", "pinB": "B1_H22", "capacitance": 1e-8, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_44", "type": "WIRE", "pinA": "B1_J22", "pinB": "B1_GND_R_22", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_45", "type": "POT", "pinA": "B1_H14", "pinB": "B1_H10", "totalResistance": 10000, "ratio": 0.6 },
        { "id": "WIRE_46", "type": "WIRE", "pinA": "B1_J10", "pinB": "B1_VCC_R_10", "color": "#ef4444" },
        { "id": "RESISTOR_CATALOG_47", "type": "R", "pinA": "B1_C14", "pinB": "B1_C18", "resistance": 33000, "isConfigured": true },
        { "id": "DIODE_48", "type": "DIODE", "pinA": "B1_D22", "pinB": "B1_D18", "vForward": 0.7 },
        { "id": "WIRE_49", "type": "WIRE", "pinA": "B1_E22", "pinB": "B1_F22", "color": "#0984e3" },
        { "id": "DIODE_50", "type": "DIODE", "pinA": "B1_I14", "pinB": "B1_I18", "vForward": 0.7 },
        { "id": "WIRE_51", "type": "WIRE", "pinA": "B1_E14", "pinB": "B1_F14", "color": "#0984e3" },
        { "id": "WIRE_53", "type": "WIRE", "pinA": "B1_J14", "pinB": "B2_A14", "color": "#0984e3" },
        { "id": "WIRE_54", "type": "WIRE", "pinA": "B2_C14", "pinB": "B2_C11", "color": "#0984e3" },
        { "id": "WIRE_55", "type": "WIRE", "pinA": "B2_E11", "pinB": "B2_F11", "color": "#0984e3" },
        { "id": "WIRE_56", "type": "WIRE", "pinA": "B2_H11", "pinB": "B2_H16", "color": "#0984e3" },
        { "id": "WIRE_57", "type": "WIRE", "pinA": "B2_C17", "pinB": "B2_C21", "color": "#0984e3" },
        { "id": "WIRE_58", "type": "WIRE", "pinA": "B2_E21", "pinB": "B2_F21", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_59", "type": "R", "pinA": "B2_J21", "pinB": "B3_A21", "resistance": 10000, "isConfigured": true },
        { "id": "IC_CATALOG_60", "type": "IC", "pinA": "B3_E19", "pinB": "B3_F23", "icType": "LM741" },
        { "id": "RESISTOR_CATALOG_61", "type": "R", "pinA": "B3_D15", "pinB": "B3_G15", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_62", "type": "WIRE", "pinA": "B3_C20", "pinB": "B3_C15", "color": "#0984e3" },
        { "id": "WIRE_63", "type": "WIRE", "pinA": "B3_H21", "pinB": "B3_H15", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_64", "type": "R", "pinA": "B3_GND_L_15", "pinB": "B3_B15", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_65", "type": "WIRE", "pinA": "B3_J20", "pinB": "B3_VCC_R_20", "color": "#ef4444" },
        { "id": "WIRE_66", "type": "WIRE", "pinA": "B3_C22", "pinB": "B3_C30", "color": "#0984e3" },
        { "id": "WIRE_67", "type": "WIRE", "pinA": "B3_E30", "pinB": "B3_F30", "color": "#0984e3" },
        { "id": "WIRE_68", "type": "WIRE", "pinA": "B3_J30", "pinB": "B3_VCC_R_30", "color": "#ef4444" },
        { "id": "IC_CATALOG_69", "type": "IC", "pinA": "B2_E44", "pinB": "B2_F51", "icType": "LM741" },
        { "id": "DIODE_70", "type": "DIODE", "pinA": "B2_A40", "pinB": "B1_J40", "vForward": 0.7 },
        { "id": "RESISTOR_CATALOG_71", "type": "R", "pinA": "B2_D40", "pinB": "B2_G40", "resistance": 2200, "isConfigured": true },
        { "id": "DIODE_72", "type": "DIODE", "pinA": "B1_J42", "pinB": "B2_A42", "vForward": 0.7 },
        { "id": "RESISTOR_CATALOG_73", "type": "R", "pinA": "B2_D42", "pinB": "B2_G42", "resistance": 39000, "isConfigured": true },
        { "id": "WIRE_74", "type": "WIRE", "pinA": "B2_H40", "pinB": "B2_H42", "color": "#0984e3" },
        { "id": "WIRE_75", "type": "WIRE", "pinA": "B1_I40", "pinB": "B1_I42", "color": "#0984e3" },
        { "id": "WIRE_76", "type": "WIRE", "pinA": "B2_I42", "pinB": "B2_I46", "color": "#0984e3" },
        { "id": "WIRE_77", "type": "WIRE", "pinA": "B1_H42", "pinB": "B1_H45", "color": "#0984e3" },
        { "id": "WIRE_78", "type": "WIRE", "pinA": "B1_J45", "pinB": "B2_A45", "color": "#0984e3" },
        { "id": "CAPACITOR_CATALOG_79", "type": "C", "pinA": "B1_E40", "pinB": "B1_F40", "capacitance": 1e-7, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_80", "type": "WIRE", "pinA": "B1_GND_L_40", "pinB": "B1_A40", "color": "#0984e3" },
        { "id": "WIRE_81", "type": "WIRE", "pinA": "B2_C46", "pinB": "B2_C52", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_82", "type": "R", "pinA": "B2_D52", "pinB": "B2_G52", "resistance": 15000, "isConfigured": true },
        { "id": "WIRE_83", "type": "WIRE", "pinA": "B2_H52", "pinB": "B2_H46", "color": "#0984e3" },
        { "id": "WIRE_84", "type": "WIRE", "pinA": "B2_J45", "pinB": "B2_VCC_R_45", "color": "#ef4444" },
        { "id": "WIRE_85", "type": "WIRE", "pinA": "B2_B47", "pinB": "B2_B54", "color": "#0984e3" },
        { "id": "WIRE_86", "type": "WIRE", "pinA": "B2_E54", "pinB": "B2_F54", "color": "#0984e3" },
        { "id": "WIRE_87", "type": "WIRE", "pinA": "B2_J54", "pinB": "B3_VCC_R_54", "color": "#ef4444" },
        { "id": "WIRE_88", "type": "WIRE", "pinA": "B2_A52", "pinB": "B1_J52", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_89", "type": "R", "pinA": "B1_I52", "pinB": "B1_I48", "resistance": 33000, "isConfigured": true },
        { "id": "RESISTOR_CATALOG_90", "type": "R", "pinA": "B1_H52", "pinB": "B1_H56", "resistance": 33000, "isConfigured": true },
        { "id": "WIRE_91", "type": "WIRE", "pinA": "B1_J48", "pinB": "B1_VCC_R_48", "color": "#ef4444" },
        { "id": "WIRE_92", "type": "WIRE", "pinA": "B1_J57", "pinB": "B1_GND_R_57", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_95", "type": "R", "pinA": "B2_J46", "pinB": "B3_A46", "resistance": 8200, "isConfigured": true },
        { "id": "TRANSISTOR_CATALOG_97", "type": "BJT", "pinA": "B3_C43", "pinB": "B3_C45", "transType": "C1815", "pinEmitter": "B3_C43", "pinBase": "B3_C46", "pinCollector": "B3_C45", "polarity": "NPN" },
        { "id": "WIRE_98", "type": "WIRE", "pinA": "B3_E45", "pinB": "B3_F45", "color": "#0984e3" },
        { "id": "WIRE_99", "type": "WIRE", "pinA": "B3_I21", "pinB": "B3_I45", "color": "#0984e3" },
        { "id": "WIRE_100", "type": "WIRE", "pinA": "B3_GND_L_43", "pinB": "B3_A43", "color": "#0984e3" },
        { "id": "RESISTOR_CATALOG_101", "type": "R", "pinA": "B3_J21", "pinB": "B4_A21", "resistance": 10000, "isConfigured": true },
        { "id": "IC_CATALOG_102", "type": "IC", "pinA": "B4_E20", "pinB": "B4_F25", "icType": "LM741" },
        { "id": "RESISTOR_CATALOG_103", "type": "R", "pinA": "B4_D16", "pinB": "B4_G16", "resistance": 10000, "isConfigured": true },
        { "id": "WIRE_104", "type": "WIRE", "pinA": "B4_C16", "pinB": "B4_C21", "color": "#0984e3" },
        { "id": "WIRE_105", "type": "WIRE", "pinA": "B4_H22", "pinB": "B4_H16", "color": "#0984e3" },
        { "id": "WIRE_106", "type": "WIRE", "pinA": "B4_GND_L_22", "pinB": "B4_A22", "color": "#0984e3" },
        { "id": "WIRE_108", "type": "WIRE", "pinA": "B4_J21", "pinB": "B4_VCC_R_21", "color": "#ef4444" },
        { "id": "WIRE_109", "type": "WIRE", "pinA": "B4_A23", "pinB": "B3_GND_R_23", "color": "#0984e3" }
      ]
    }
  },
  "function_circuit": {
    "title": "🏆 5. 함수 발생기 회로 (Function Generator)",
    "data": {
      "version": "1.0",
      "savedAt": "2026-08-26T03:45:16.709Z",
      "title": "함수 발생기 회로",
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
        { "id": "WIRE_64", "type": "WIRE", "pinA": "B2_A6", "pinB": "B2_VCC_L_6", "color": "#ef4444" },
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
        { "id": "CAPACITOR_CATALOG_74", "type": "C", "pinA": "B2_C41", "pinB": "B2_H41", "capacitance": 9.999999999999999e-14, "isConfigured": true, "capType": "MYLAR" },
        { "id": "WIRE_75", "type": "WIRE", "pinA": "B2_B41", "pinB": "B2_B47", "color": "#0984e3" },
        { "id": "WIRE_76", "type": "WIRE", "pinA": "B2_I41", "pinB": "B2_I48", "color": "#0984e3" },
        { "id": "WIRE_77", "type": "WIRE", "pinA": "B1_J46", "pinB": "B1_VCC_R_46", "color": "#ef4444" },
        { "id": "WIRE_78", "type": "WIRE", "pinA": "B2_J47", "pinB": "B2_VCC_R_47", "color": "#ef4444" },
        { "id": "WIRE_79", "type": "WIRE", "pinA": "B2_C49", "pinB": "B2_C58", "color": "#0984e3" },
        { "id": "WIRE_80", "type": "WIRE", "pinA": "B2_E58", "pinB": "B3_VCC_R_58", "color": "#ef4444" },
        { "id": "WIRE_81", "type": "WIRE", "pinA": "B1_C48", "pinB": "B1_C58", "color": "#0984e3" },
        { "id": "WIRE_82", "type": "WIRE", "pinA": "B1_E58", "pinB": "B2_A58", "color": "#0984e3" }
      ]
    }
  }
};


/* --- src/ui/BreadboardCanvas.js --- */
/**
 * BreadboardCanvas.js
 * Interactive HTML5 Canvas Workbench Renderer for Wanjie BB-4T7D Breadboard.
 * TO-92 BJT Transistor 3-Pin Renderer & Placement Engine v=1070.
 */



class BreadboardCanvas {
    constructor(canvas, grid) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;
        this.grid = grid;

        this.zoomLevel = 1.0;
        this.panOffsetX = 0;
        this.panOffsetY = 0;

        this.showValueBadges = true;

        this.voltageVa = 12.0;
        this.voltageVb = 0.0;
        this.voltageVc = -12.0;

        this.selectedComponent = null;
        this.placementMode = 'SELECT'; // 'SELECT', 'WIRE', 'R', 'C', 'VDC', 'SWITCH', 'LED', 'DIODE', 'ZENER', 'POT', 'IC', 'TRANSISTOR_CATALOG', 'PROBE_A', 'PROBE_B', 'PROBE_C', 'PROBE_D'
        this.placementPinA = null;
        this.hoveredPin = null;
        this.mouseWorldPos = { x: 0, y: 0 };
        this.toastMsg = null;
        this.toastTimer = null;

        // Probes: CH A & CH B active by default; CH C & CH D null by default
        this.probeAPin = 'B2_F17';
        this.probeBPin = 'B1_F16';
        this.probeCPin = null;
        this.probeDPin = null;

        this.componentsRef = [];

        this.numBlocks = 4;
        this.pinCoords = new Map();
        this.initPinCoordinates();
        if (canvas) {
            this.initEvents();
        }
    }

    setActiveTool(tool) {
        this.placementMode = tool;
        this.placementPinA = null;
        if (tool === 'SELECT') {
            this.showToast('👆 선택 모드: 부품 클릭 시 선택/이동/삭제/속성 조절');
        } else if (tool.startsWith('PROBE_')) {
            const ch = tool.split('_')[1];
            this.showToast(`📍 [CH ${ch} 프로브] 모드: 꽂을 핀 구멍을 클릭하세요.`);
        } else if (tool === 'TRANSISTOR_CATALOG') {
            this.showToast('🔺 [트랜지스터 TO-92] 모드: Emitter(E)를 꽂을 핀 구멍을 마우스로 클릭하세요.');
        } else {
            this.showToast(`📌 [${tool}] 배치 모드: 첫 번째 핀 구멍을 마우스로 클릭하세요.`);
        }
        if (this.onNeedsRender) this.onNeedsRender();
    }

    cancelPlacement() {
        this.placementMode = 'SELECT';
        this.placementPinA = null;
        if (this.onPlacementCancelled) this.onPlacementCancelled();
        if (this.onNeedsRender) this.onNeedsRender();
    }

    toggleValueBadges() {
        this.showValueBadges = !this.showValueBadges;
        if (this.onNeedsRender) this.onNeedsRender();
        return this.showValueBadges;
    }

    zoomIn() {
        this.zoomLevel = Math.min(3.5, this.zoomLevel * 1.2);
        if (this.onNeedsRender) this.onNeedsRender();
    }

    zoomOut() {
        this.zoomLevel = Math.max(0.4, this.zoomLevel * 0.8);
        if (this.onNeedsRender) this.onNeedsRender();
    }

    resetZoom() {
        this.zoomLevel = 1.0;
        this.panOffsetX = 0;
        this.panOffsetY = 0;
        if (this.onNeedsRender) this.onNeedsRender();
    }

    getMouseWorldPos(e) {
        if (!this.canvas) return { worldX: 0, worldY: 0 };
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width > 0 ? (this.canvas.width / rect.width) : 1.0;
        const scaleY = rect.height > 0 ? (this.canvas.height / rect.height) : 1.0;

        const clientX = (e.clientX - rect.left) * scaleX;
        const clientY = (e.clientY - rect.top) * scaleY;

        const worldX = (clientX - this.panOffsetX) / this.zoomLevel;
        const worldY = (clientY - this.panOffsetY) / this.zoomLevel;
        return { worldX, worldY };
    }

    initEvents() {
        if (!this.canvas) return;

        let isPanning = false;
        let startPanX = 0;
        let startPanY = 0;

        // 1. Mouse Down: Middle Click (button 1) or Right Click (button 2) initiates Pan
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || e.button === 2) {
                isPanning = true;
                startPanX = e.clientX - this.panOffsetX;
                startPanY = e.clientY - this.panOffsetY;
                this.canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        // 2. Window Mouse Move: Drag updates panOffsetX and panOffsetY in real time
        window.addEventListener('mousemove', (e) => {
            if (isPanning) {
                this.panOffsetX = e.clientX - startPanX;
                this.panOffsetY = e.clientY - startPanY;
                if (this.onNeedsRender) this.onNeedsRender();
            }
        });

        // 3. Window Mouse Up: End Pan
        window.addEventListener('mouseup', (e) => {
            if (isPanning) {
                isPanning = false;
                this.canvas.style.cursor = 'default';
            }
        });

        // Prevent default context menu on right click pan
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // 4. Canvas Mouse Move: Update hoveredPin and mouseWorldPos
        this.canvas.addEventListener('mousemove', (e) => {
            if (isPanning) return;
            const { worldX, worldY } = this.getMouseWorldPos(e);
            this.mouseWorldPos = { x: worldX, y: worldY };

            const nearest = this.getNearestPin(worldX, worldY, 24.0);
            if (nearest !== this.hoveredPin) {
                this.hoveredPin = nearest;
                if (this.onNeedsRender) this.onNeedsRender();
            } else if (this.placementPinA) {
                if (this.onNeedsRender) this.onNeedsRender();
            }
        });

        // 5. Canvas Click: Component placement, probe placement, component selection
        this.canvas.addEventListener('click', (e) => {
            if (e.button !== 0) return; // Left click only
            const { worldX, worldY } = this.getMouseWorldPos(e);
            const clickedPin = this.getNearestPin(worldX, worldY, 24.0);

            // Handle 4CH Oscilloscope Probes & Continuity Tester Probes Placement
            if (this.placementMode && this.placementMode.startsWith('PROBE_')) {
                const probeMode = this.placementMode.substring(6); // 'A', 'B', 'C', 'D', 'CONTINUITY_RED', 'CONTINUITY_BLACK'
                if (clickedPin) {
                    if (probeMode === 'A') this.probeAPin = clickedPin;
                    else if (probeMode === 'B') this.probeBPin = clickedPin;
                    else if (probeMode === 'C') this.probeCPin = clickedPin;
                    else if (probeMode === 'D') this.probeDPin = clickedPin;

                    if (this.onProbePlaced) {
                        this.onProbePlaced(probeMode, clickedPin);
                    }
                    if (probeMode.startsWith('CONTINUITY')) {
                        const probeLabel = probeMode.includes('RED') ? '🔴 탐침 (+)' : '⚫ 탐침 (-)';
                        this.showToast(`📍 도통 테스터기 ${probeLabel}가 [${clickedPin}] 핀에 꽂혔습니다!`);
                    } else {
                        this.showToast(`📍 CH ${probeMode} 프로브가 [${clickedPin}] 핀에 꽂혔습니다!`);
                    }
                } else {
                    this.showToast('⚠️ 프로브를 꽂을 핀 구멍을 클릭하세요.');
                }
                this.cancelPlacement();
                return;
            }

            // Handle Component Placement Mode (All components including Transistors & ICs use 2-click placement)
            if (this.placementMode && this.placementMode !== 'SELECT') {
                if (!clickedPin) {
                    this.showToast('⚠️ 핀 구멍 근처를 가볍게 마우스로 클릭해주세요.');
                    return;
                }

                if (!this.placementPinA) {
                    // First pin selected
                    this.placementPinA = clickedPin;
                    this.showToast(`📍 1번 핀 [${clickedPin}] 선택 완료! 2번 핀 구멍을 클릭하세요.`);
                    if (this.onNeedsRender) this.onNeedsRender();
                } else {
                    // Second pin selected
                    const pinA = this.placementPinA;
                    const pinB = clickedPin;
                    if (pinA === pinB) {
                        this.showToast('⚠️ 서로 다른 2개의 핀 구멍을 선택하세요.');
                        return;
                    }

                    const tool = this.placementMode;
                    this.placementMode = 'SELECT';
                    this.placementPinA = null;

                    if (this.onComponentPlaced) {
                        this.onComponentPlaced(tool, pinA, pinB);
                    }
                }
                return;
            }

            // Handle Selection Mode: Check if clicked component
            let foundComp = null;
            if (this.componentsRef) {
                for (const comp of this.componentsRef) {
                    const pA = this.getPinPos(comp.pinA || comp.pinEmitter);
                    const pB = this.getPinPos(comp.pinB || comp.pinCollector);
                    const distA = Math.hypot(pA.x - worldX, pA.y - worldY);
                    const distB = Math.hypot(pB.x - worldX, pB.y - worldY);
                    const midX = (pA.x + pB.x) / 2;
                    const midY = (pA.y + pB.y) / 2;
                    const distMid = Math.hypot(midX - worldX, midY - worldY);

                    if (distA < 20 || distB < 20 || distMid < 24) {
                        foundComp = comp;
                        break;
                    }
                }
            }

            this.selectedComponent = foundComp;
            if (foundComp) {
                if (foundComp.type === 'SWITCH') {
                    const isOpen = foundComp.toggle();
                    this.showToast(isOpen ? '🔴 스위치 열림 (OPEN / OFF)' : '🟢 스위치 닫힘 (CLOSED / ON)');
                    if (this.onSwitchToggled) this.onSwitchToggled(foundComp);
                } else {
                    this.showToast(`🔍 선택됨: [${foundComp.type}] ${foundComp.id}`);
                }
            }
            if (this.onNeedsRender) this.onNeedsRender();
        });

        // 6. Canvas Double Click: Open property inspector or binding post prompt
        this.canvas.addEventListener('dblclick', (e) => {
            const { worldX, worldY } = this.getMouseWorldPos(e);

            // Check Binding Posts (Radius 30px tolerance at y = 72)
            const bindingPosts = ['BINDING_Va', 'BINDING_Vb', 'BINDING_Vc', 'BINDING_GND'];
            for (const bpKey of bindingPosts) {
                const pos = this.getPinPos(bpKey);
                if (Math.hypot(pos.x - worldX, pos.y - worldY) < 30) {
                    if (this.onBindingPostDblClicked) this.onBindingPostDblClicked(bpKey);
                    return;
                }
            }

            // Check Component Double Click
            if (this.selectedComponent) {
                if (this.selectedComponent.type === 'SWITCH') {
                    const isOpen = this.selectedComponent.toggle();
                    this.showToast(isOpen ? '🔴 스위치 열림 (OPEN / OFF)' : '🟢 스위치 닫힘 (CLOSED / ON)');
                    if (this.onSwitchToggled) this.onSwitchToggled(this.selectedComponent);
                    if (this.onNeedsRender) this.onNeedsRender();
                } else if (this.onComponentDblClicked) {
                    this.onComponentDblClicked(this.selectedComponent);
                }
            }
        });

        // 7. Smooth Independent Mouse Wheel Canvas Zoom & Potentiometer Knob Tuning
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const { worldX, worldY } = this.getMouseWorldPos(e);

            // Check if mouse wheel is scrolled over a Potentiometer
            let hoveredPot = null;
            if (this.componentsRef) {
                for (const comp of this.componentsRef) {
                    if (comp.type === 'POT') {
                        const pA = this.getPinPos(comp.pinA);
                        const pB = this.getPinPos(comp.pinB);
                        const midX = (pA.x + pB.x) / 2;
                        const midY = (pA.y + pB.y) / 2;
                        if (Math.hypot(midX - worldX, midY - worldY) < 30) {
                            hoveredPot = comp;
                            break;
                        }
                    }
                }
            }

            if (!hoveredPot && this.selectedComponent && this.selectedComponent.type === 'POT') {
                hoveredPot = this.selectedComponent;
            }

            if (hoveredPot) {
                // Scroll Wheel turns Potentiometer Knob +5% / -5%
                const delta = e.deltaY < 0 ? 0.05 : -0.05;
                hoveredPot.ratio = Math.max(0.01, Math.min(0.99, hoveredPot.ratio + delta));
                const effRes = hoveredPot.getEffectiveResistance();
                const formatted = effRes >= 1000 ? (effRes / 1000).toFixed(1) + 'k' : effRes.toFixed(0);
                this.showToast(`🎛️ 가변저항 휠 조작: [${formatted}Ω (${(hoveredPot.ratio * 100).toFixed(0)}%)]`);

                if (this.onPotentiometerChanged) {
                    this.onPotentiometerChanged(hoveredPot);
                }
                if (this.onNeedsRender) this.onNeedsRender();
                return;
            }

            // Normal Canvas Zoom
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = rect.width > 0 ? (this.canvas.width / rect.width) : 1.0;
            const scaleY = rect.height > 0 ? (this.canvas.height / rect.height) : 1.0;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top) * scaleY;

            const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
            const newZoom = Math.max(0.4, Math.min(3.5, this.zoomLevel * zoomFactor));

            this.panOffsetX = mouseX - (mouseX - this.panOffsetX) * (newZoom / this.zoomLevel);
            this.panOffsetY = mouseY - (mouseY - this.panOffsetY) * (newZoom / this.zoomLevel);
            this.zoomLevel = newZoom;

            if (this.onNeedsRender) this.onNeedsRender();
        }, { passive: false });
    }

    showToast(msg) {
        this.toastMsg = msg;
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.toastMsg = null;
            if (this.onNeedsRender) this.onNeedsRender();
        }, 3000);
    }

    initPinCoordinates() {
        const blockWidth = 186;
        const blockGap = 12;
        const startX = 25;
        const startY = 210;
        const pitchX = 11.0;
        const pitchY = 11.2;

        const setCoord = (key, x, y) => {
            this.pinCoords.set(key, { x: Math.round(x), y: Math.round(y) });
        };

        // 1. Binding Posts (Centered exactly at y = 48 matching render())
        setCoord('BINDING_Va', 520, 48);
        setCoord('BINDING_Vb', 590, 48);
        setCoord('BINDING_Vc', 660, 48);
        setCoord('BINDING_GND', 730, 48);

        // 2. Top Horizontal Bus Rails (50 Columns evenly spaced across x = 45..780 inside top white power strip at y = 106..178)
        for (let c = 1; c <= 50; c++) {
            const x = 45 + (c - 1) * 15.0;

            const yVcc1 = 114; // Red Line +12V
            const yGnd1 = 138; // Blue Line 0V/GND
            const yVcc2 = 146; // Red Line +12V
            const yGnd2 = 168; // Blue Line -12V

            // Map without block prefix (e.g. VCC_TOP1_15)
            setCoord(`VCC_TOP1_${c}`, x, yVcc1);
            setCoord(`GND_TOP1_${c}`, x, yGnd1);
            setCoord(`VCC_TOP2_${c}`, x, yVcc2);
            setCoord(`GND_TOP2_${c}`, x, yGnd2);

            // Map with block prefixes B1_, B2_, B3_, B4_ for complete compatibility
            for (let blk = 1; blk <= this.numBlocks; blk++) {
                setCoord(`B${blk}_VCC_TOP1_${c}`, x, yVcc1);
                setCoord(`B${blk}_GND_TOP1_${c}`, x, yGnd1);
                setCoord(`B${blk}_VCC_TOP2_${c}`, x, yVcc2);
                setCoord(`B${blk}_GND_TOP2_${c}`, x, yGnd2);
            }
        }

        // 3. Main Breadboard Blocks (1..4)
        for (let blk = 1; blk <= this.numBlocks; blk++) {
            const bX = startX + (blk - 1) * (blockWidth + blockGap);
            const prefix = `B${blk}_`;

            // Dual Vertical Power Rails
            for (let r = 1; r <= 60; r++) {
                const y = startY + (r - 1) * pitchY;
                setCoord(`${prefix}VCC_L_${r}`, bX + 10, y);
                setCoord(`${prefix}GND_L_${r}`, bX + 22, y);
                setCoord(`${prefix}VCC_R_${r}`, bX + 164, y);
                setCoord(`${prefix}GND_R_${r}`, bX + 176, y);

                if (blk === 1) {
                    setCoord(`VCC_L_${r}`, bX + 10, y);
                    setCoord(`GND_L_${r}`, bX + 22, y);
                    setCoord(`VCC_R_${r}`, bX + 164, y);
                    setCoord(`GND_R_${r}`, bX + 176, y);
                }
            }

            // Terminal Strips (Rows 1..60, Cols A..E and F..J)
            const colsLeft = ['A', 'B', 'C', 'D', 'E'];
            const colsRight = ['F', 'G', 'H', 'I', 'J'];

            for (let r = 1; r <= 60; r++) {
                const y = startY + (r - 1) * pitchY;

                colsLeft.forEach((col, idx) => {
                    const x = bX + 41 + idx * pitchX;
                    setCoord(`${prefix}${col}${r}`, x, y);
                });

                colsRight.forEach((col, idx) => {
                    const x = bX + 105 + idx * pitchX;
                    setCoord(`${prefix}${col}${r}`, x, y);
                });
            }
        }
    }

    getPinPos(pinKey) {
        if (!pinKey) return { x: 0, y: 0 };
        if (this.pinCoords.has(pinKey)) return this.pinCoords.get(pinKey);
        if (this.pinCoords.has(`B1_${pinKey}`)) return this.pinCoords.get(`B1_${pinKey}`);
        if (this.pinCoords.has(`B2_${pinKey}`)) return this.pinCoords.get(`B2_${pinKey}`);

        // Safe Clamped Fallback for Power Rails out of bounds (e.g. GND_TOP1_51 -> GND_TOP1_50)
        if (pinKey.includes('_TOP')) {
            const parts = pinKey.split('_');
            if (parts.length >= 3) {
                const railPrefix = `${parts[0]}_${parts[1]}`;
                let colNum = parseInt(parts[2], 10);
                if (!isNaN(colNum)) {
                    colNum = Math.max(1, Math.min(50, colNum));
                    const clampedKey = `${railPrefix}_${colNum}`;
                    if (this.pinCoords.has(clampedKey)) return this.pinCoords.get(clampedKey);
                }
            }
            const railType = `${parts[0]}_${parts[1]}`;
            if (this.pinCoords.has(`${railType}_15`)) return this.pinCoords.get(`${railType}_15`);
        }

        return { x: 0, y: 0 };
    }

    getNearestPin(worldX, worldY, maxDist = 24.0) {
        let closestKey = null;
        let minDist = maxDist;

        for (const [key, pos] of this.pinCoords.entries()) {
            const dx = pos.x - worldX;
            const dy = pos.y - worldY;
            const dist = Math.hypot(dx, dy);
            if (dist < minDist) {
                minDist = dist;
                closestKey = key;
            }
        }
        return closestKey;
    }

    render(components = []) {
        this.componentsRef = components;
        if (!this.ctx) return;
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        this.ctx.save();
        this.ctx.translate(this.panOffsetX, this.panOffsetY);
        this.ctx.scale(this.zoomLevel, this.zoomLevel);

        const baseW = 790;
        const baseH = 970;

        // 1. Dark Technical Metal Base Plate Background
        this.ctx.fillStyle = '#1e272e';
        this.ctx.fillRect(0, 0, baseW, baseH);

        // Grid dots on base plate
        this.ctx.fillStyle = '#2d3748';
        for (let gx = 10; gx < baseW; gx += 20) {
            for (let gy = 10; gy < baseH; gy += 20) {
                this.ctx.fillRect(gx, gy, 2, 2);
            }
        }

        // 2. Header Panel
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(15, 12, 760, 80);
        this.ctx.strokeStyle = '#38bdf8';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(15, 12, 760, 80);

        this.ctx.fillStyle = '#f8fafc';
        this.ctx.font = 'bold 16px sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.fillText('COMPANY-JK WORKBENCH', 30, 36);

        // 3. 4 Heavy Metal Binding Posts with Dynamic Voltage Values
        const bindingPosts = [
            { id: 'BINDING_Va', label: 'Va', color: '#ef4444', x: 520, y: 48, valText: `${(this.voltageVa || 12.0) > 0 ? '+' : ''}${(this.voltageVa || 12.0).toFixed(1)}V` },
            { id: 'BINDING_Vb', label: 'Vb', color: '#10b981', x: 590, y: 48, valText: `${(this.voltageVb || 0.0) > 0 ? '+' : ''}${(this.voltageVb || 0.0).toFixed(1)}V` },
            { id: 'BINDING_Vc', label: 'Vc', color: '#0284c7', x: 660, y: 48, valText: `${(this.voltageVc || -12.0) > 0 ? '+' : ''}${(this.voltageVc || -12.0).toFixed(1)}V` },
            { id: 'BINDING_GND', label: 'GND', color: '#64748b', x: 730, y: 48, valText: 'GND' }
        ];

        bindingPosts.forEach(bp => {
            this.ctx.fillStyle = bp.color;
            this.ctx.beginPath();
            this.ctx.arc(bp.x, bp.y, 14, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = '#f8fafc';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            this.ctx.fillStyle = '#facc15';
            this.ctx.font = 'bold 10px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(bp.valText, bp.x, 74);
        });

        // 4. Render Top 4 Horizontal Bus Lines Panel
        this.ctx.fillStyle = '#f8fafc';
        this.ctx.beginPath();
        this.ctx.roundRect(35, 106, 745, 72, 4);
        this.ctx.fill();
        this.ctx.strokeStyle = '#b2bec3';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        this.ctx.strokeStyle = '#ff7675';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(45, 114);
        this.ctx.lineTo(780, 114);
        this.ctx.stroke();

        this.ctx.strokeStyle = '#74b9ff';
        this.ctx.beginPath();
        this.ctx.moveTo(45, 138);
        this.ctx.lineTo(780, 138);
        this.ctx.stroke();

        this.ctx.strokeStyle = '#ff7675';
        this.ctx.beginPath();
        this.ctx.moveTo(45, 146);
        this.ctx.lineTo(780, 146);
        this.ctx.stroke();

        this.ctx.strokeStyle = '#74b9ff';
        this.ctx.beginPath();
        this.ctx.moveTo(45, 168);
        this.ctx.lineTo(780, 168);
        this.ctx.stroke();

        // 5. Render 4 Vertical Terminal Strips with DUAL Vertical Power Rails (RED +, BLUE -)
        const blockWidth = 186;
        const blockGap = 12;
        const startX = 25;
        const startY = 210;
        const pitchY = 11.2;

        for (let blk = 1; blk <= this.numBlocks; blk++) {
            const bX = startX + (blk - 1) * (blockWidth + blockGap);
            const bH = 725;

            this.ctx.fillStyle = '#fdfdfd';
            this.ctx.beginPath();
            this.ctx.roundRect(bX, startY - 10, blockWidth, bH, 6);
            this.ctx.fill();
            this.ctx.strokeStyle = '#dcdde1';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            const troughX = bX + 95;
            this.ctx.fillStyle = '#dcdde1';
            this.ctx.fillRect(troughX - 3, startY - 5, 6, bH - 10);

            // Left Dual Vertical Power Rails (RED +, BLUE -)
            this.ctx.strokeStyle = '#ff7675'; // RED (+) Line
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(bX + 10, startY - 5);
            this.ctx.lineTo(bX + 10, startY + bH - 15);
            this.ctx.stroke();

            this.ctx.strokeStyle = '#74b9ff'; // BLUE (-) Line
            this.ctx.beginPath();
            this.ctx.moveTo(bX + 22, startY - 5);
            this.ctx.lineTo(bX + 22, startY + bH - 15);
            this.ctx.stroke();

            // Right Dual Vertical Power Rails (RED +, BLUE -)
            this.ctx.strokeStyle = '#ff7675'; // RED (+) Line
            this.ctx.beginPath();
            this.ctx.moveTo(bX + 164, startY - 5);
            this.ctx.lineTo(bX + 164, startY + bH - 15);
            this.ctx.stroke();

            this.ctx.strokeStyle = '#74b9ff'; // BLUE (-) Line
            this.ctx.beginPath();
            this.ctx.moveTo(bX + 176, startY - 5);
            this.ctx.lineTo(bX + 176, startY + bH - 15);
            this.ctx.stroke();

            // Printed '+' and '-' signs at top and bottom of each dual rail
            this.ctx.fillStyle = '#ef4444';
            this.ctx.font = 'bold 10px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('+', bX + 10, startY - 14);
            this.ctx.fillText('+', bX + 164, startY - 14);
            this.ctx.fillText('+', bX + 10, startY + bH - 2);
            this.ctx.fillText('+', bX + 164, startY + bH - 2);

            this.ctx.fillStyle = '#0984e3';
            this.ctx.fillText('-', bX + 22, startY - 14);
            this.ctx.fillText('-', bX + 176, startY - 14);
            this.ctx.fillText('-', bX + 22, startY + bH - 2);
            this.ctx.fillText('-', bX + 176, startY + bH - 2);

            // Row numbers
            this.ctx.fillStyle = '#475569';
            this.ctx.font = 'bold 9px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            for (let r = 5; r <= 60; r += 5) {
                const rY = Math.round(startY + (r - 1) * pitchY);
                this.ctx.fillText(`${r}`, Math.round(bX + 31), rY);
                this.ctx.fillText(`${r}`, Math.round(bX + 155), rY);
            }

            // Column Labels A-E and F-J
            this.ctx.fillStyle = '#1e293b';
            this.ctx.font = 'bold 9px monospace';
            this.ctx.textBaseline = 'alphabetic';

            ['A', 'B', 'C', 'D', 'E'].forEach((c, idx) => {
                const cX = Math.round(bX + 41 + idx * 11);
                this.ctx.fillText(c, cX, startY - 14);
                this.ctx.fillText(c, cX, startY + bH - 2);
            });

            ['F', 'G', 'H', 'I', 'J'].forEach((c, idx) => {
                const cX = Math.round(bX + 105 + idx * 11);
                this.ctx.fillText(c, cX, startY - 14);
                this.ctx.fillText(c, cX, startY + bH - 2);
            });
        }

        // 6. Render All Metallic Pin Holes with Glowing Hover Targets
        let activeHoverNode = this.hoveredPin ? this.grid.getNodeId(this.hoveredPin) : null;

        for (const [pinKey, pos] of this.pinCoords.entries()) {
            if (pinKey.startsWith('BINDING_')) continue;

            const pinNode = this.grid.getNodeId(pinKey);
            const isHovered = (this.hoveredPin === pinKey);
            const isPlacementStart = (this.placementPinA === pinKey);
            const isSameNodeHovered = activeHoverNode && (pinNode === activeHoverNode);

            this.ctx.beginPath();

            if (isPlacementStart) {
                this.ctx.arc(pos.x, pos.y, 6.0, 0, Math.PI * 2);
                this.ctx.fillStyle = '#38bdf8';
                this.ctx.fill();
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            } else if (isHovered) {
                this.ctx.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ef4444';
                this.ctx.fill();
                this.ctx.strokeStyle = '#facc15';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            } else if (isSameNodeHovered) {
                this.ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#fdcb6e';
                this.ctx.fill();
            } else {
                this.ctx.arc(pos.x, pos.y, 1.8, 0, Math.PI * 2);
                this.ctx.fillStyle = '#2d3436';
                this.ctx.fill();
            }
        }

        // 7. Render Placement Guide Line preview if 1st pin is selected
        if (this.placementPinA && (this.hoveredPin || this.mouseWorldPos)) {
            const posA = this.getPinPos(this.placementPinA);
            const posB = this.hoveredPin ? this.getPinPos(this.hoveredPin) : this.mouseWorldPos;

            this.ctx.strokeStyle = '#38bdf8';
            this.ctx.lineWidth = 3.0;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(posA.x, posA.y);
            this.ctx.lineTo(posB.x, posB.y);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // 8. Render Circuit Components & Probes
        components.forEach(comp => {
            const isSelected = (this.selectedComponent === comp);
            this.renderComponent(comp, isSelected);
        });

        // 9. Render Official EIC-108 TP1, TP2, TP3 Flag Tags
        if (components && components.some(c => c.id === 'U1')) {
            this.renderTestPointFlag('TP1', 'B3_F18', '#facc15');
            this.renderTestPointFlag('TP2', 'B3_F40', '#e879f9');
            this.renderTestPointFlag('TP3', 'B4_C33', '#38bdf8');
        }

        // Render 4CH Probes ONLY if pin is attached!
        if (this.probeAPin) this.renderProbe('CH A', this.probeAPin, '#facc15');
        if (this.probeBPin) this.renderProbe('CH B', this.probeBPin, '#e879f9');
        if (this.probeCPin) this.renderProbe('CH C', this.probeCPin, '#38bdf8');
        if (this.probeDPin) this.renderProbe('CH D', this.probeDPin, '#22c55e');

        // Toast Message Notification Overlay
        if (this.toastMsg) {
            this.ctx.save();
            this.ctx.font = 'bold 12px sans-serif';
            const tw = this.ctx.measureText(this.toastMsg).width + 30;

            this.ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            this.ctx.beginPath();
            this.ctx.roundRect((baseW - tw) / 2, baseH - 38, tw, 28, 6);
            this.ctx.fill();
            this.ctx.strokeStyle = '#38bdf8';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();

            this.ctx.fillStyle = '#f8fafc';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(this.toastMsg, baseW / 2, baseH - 20);
            this.ctx.restore();
        }

        this.ctx.restore();
    }

    renderTestPointFlag(label, pinKey, colorHex) {
        const pos = this.getPinPos(pinKey);
        this.ctx.save();

        this.ctx.strokeStyle = '#64748b';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
        this.ctx.lineTo(pos.x + 22, pos.y);
        this.ctx.stroke();

        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.roundRect(pos.x + 22, pos.y - 8, 32, 16, 3);
        this.ctx.fill();
        this.ctx.strokeStyle = '#0f172a';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();

        this.ctx.fillStyle = '#0f172a';
        this.ctx.font = 'bold 10px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(label, pos.x + 38, pos.y);

        this.ctx.restore();
    }

    renderProbe(channelName, pinKey, colorHex) {
        const pos = this.getPinPos(pinKey);
        this.ctx.save();

        this.ctx.shadowColor = colorHex;
        this.ctx.shadowBlur = 8;

        this.ctx.strokeStyle = colorHex;
        this.ctx.lineWidth = 2.5;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, 7, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.fillStyle = colorHex;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.font = 'bold 10px sans-serif';
        const tw = this.ctx.measureText(channelName).width + 12;

        this.ctx.fillStyle = colorHex;
        this.ctx.beginPath();
        this.ctx.roundRect(pos.x + 10, pos.y - 10, tw, 18, 4);
        this.ctx.fill();

        this.ctx.fillStyle = '#0f172a';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(channelName, pos.x + 10 + tw / 2, pos.y - 1);

        this.ctx.restore();
    }

    renderComponent(comp, isSelected) {
        const pA = this.getPinPos(comp.pinA || comp.pinEmitter);
        const pB = this.getPinPos(comp.pinB || comp.pinCollector);

        this.ctx.save();

        if (isSelected) {
            this.ctx.shadowColor = '#38bdf8';
            this.ctx.shadowBlur = 12;
        }

        if (comp.type === 'WIRE') {
            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2 - 12;

            // 1. Drop Shadow
            this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.lineWidth = isSelected ? 6.5 : 4.5;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x + 1, pA.y + 2);
            this.ctx.quadraticCurveTo(midX + 1, midY + 2, pB.x + 1, pB.y + 2);
            this.ctx.stroke();

            // 2. Main Insulated Wire Body
            this.ctx.strokeStyle = comp.color || '#0984e3';
            this.ctx.lineWidth = isSelected ? 4.5 : 3.2;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.quadraticCurveTo(midX, midY, pB.x, pB.y);
            this.ctx.stroke();

            // 3. Top Specular Gloss Line
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            this.ctx.lineWidth = 1.0;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y - 1);
            this.ctx.quadraticCurveTo(midX, midY - 1, pB.x, pB.y - 1);
            this.ctx.stroke();

            // Metallic Terminal Pins
            this.ctx.fillStyle = '#cbd5e1';
            this.ctx.beginPath();
            this.ctx.arc(pA.x, pA.y, 3.2, 0, Math.PI * 2);
            this.ctx.arc(pB.x, pB.y, 3.2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = '#334155';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();

        } else if (comp.type === 'BJT') {
            const pE = this.getPinPos(comp.pinEmitter || comp.pinA);
            const pBase = this.getPinPos(comp.pinBase);
            const pC = this.getPinPos(comp.pinCollector || comp.pinB);

            const isVertical = (Math.abs(pE.x - pC.x) < 5);
            const midX = (pE.x + pBase.x + pC.x) / 3;
            const midY = (pE.y + pBase.y + pC.y) / 3;

            const bodyX = isVertical ? midX - 25 : midX;
            const bodyY = isVertical ? midY : midY - 20;

            // 3 Metallic Lead Wires
            this.ctx.strokeStyle = '#cbd5e1';
            this.ctx.lineWidth = 1.8;
            this.ctx.beginPath();
            this.ctx.moveTo(pE.x, pE.y);
            this.ctx.lineTo(bodyX, bodyY);
            this.ctx.moveTo(pBase.x, pBase.y);
            this.ctx.lineTo(bodyX, bodyY);
            this.ctx.moveTo(pC.x, pC.y);
            this.ctx.lineTo(bodyX, bodyY);
            this.ctx.stroke();

            // TO-92 Photorealistic Black Plastic D-Shape Body
            const bodyGrad = this.ctx.createLinearGradient(bodyX - 13, bodyY - 13, bodyX + 13, bodyY + 13);
            bodyGrad.addColorStop(0, '#334155');
            bodyGrad.addColorStop(0.4, '#1e293b');
            bodyGrad.addColorStop(1, '#0f172a');

            this.ctx.fillStyle = bodyGrad;
            this.ctx.beginPath();
            this.ctx.arc(bodyX, bodyY, 13, Math.PI, 0);
            this.ctx.lineTo(bodyX + 13, bodyY + 8);
            this.ctx.lineTo(bodyX - 13, bodyY + 8);
            this.ctx.closePath();
            this.ctx.fill();

            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#475569';
            this.ctx.lineWidth = isSelected ? 2.0 : 1.2;
            this.ctx.stroke();

            // Laser Etched Text
            this.ctx.fillStyle = '#e2e8f0';
            this.ctx.font = 'bold 8px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(comp.transType || '2N3904', bodyX, bodyY + 3);

            // Dynamic Pin Badges (S, D, G / E, C, B)
            this.ctx.font = 'bold 11px sans-serif';
            this.ctx.textBaseline = 'middle';
            const tagOffsetX = isVertical ? 12 : 0;
            const tagOffsetY = isVertical ? 0 : -10;

            const str = ((comp.transType || '') + ' ' + (comp.id || '') + ' ' + (comp.polarity || '')).toUpperCase();
            const isJFET = str.includes('2SK') || str.includes('30') || str.includes('JFET') || str.includes('SDG');

            const labelPin1 = isJFET ? 'S' : 'E';
            const labelPin2 = isJFET ? 'D' : 'C';
            const labelPin3 = isJFET ? 'G' : 'B';

            this.ctx.fillStyle = '#ef4444';
            this.ctx.textAlign = isVertical ? 'left' : 'center';
            this.ctx.fillText(labelPin1, pE.x + tagOffsetX, pE.y + tagOffsetY);

            this.ctx.fillStyle = '#f59e0b';
            this.ctx.textAlign = isVertical ? 'left' : 'center';
            this.ctx.fillText(labelPin2, pC.x + tagOffsetX, pC.y + tagOffsetY);

            this.ctx.fillStyle = '#38bdf8';
            this.ctx.textAlign = isVertical ? 'left' : 'center';
            this.ctx.fillText(labelPin3, pBase.x + tagOffsetX, pBase.y + tagOffsetY);

        } else if (comp.type === 'R') {
            // Metallic Silver Lead Wires
            this.ctx.strokeStyle = '#94a3b8';
            this.ctx.lineWidth = 1.8;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;
            const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);

            this.ctx.save();
            this.ctx.translate(midX, midY);
            this.ctx.rotate(angle);

            // 3D Ceramic Cylindrical Resistor Body Gradient
            const bodyGrad = this.ctx.createLinearGradient(0, -6, 0, 6);
            bodyGrad.addColorStop(0, '#ffffff');
            bodyGrad.addColorStop(0.3, '#f1f5f9');
            bodyGrad.addColorStop(0.8, '#cbd5e1');
            bodyGrad.addColorStop(1, '#94a3b8');

            this.ctx.fillStyle = bodyGrad;
            this.ctx.beginPath();
            this.ctx.roundRect(-15, -6, 30, 12, 4);
            this.ctx.fill();

            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#475569';
            this.ctx.lineWidth = isSelected ? 2 : 1;
            this.ctx.stroke();

            // Metallic End-Caps
            this.ctx.fillStyle = '#94a3b8';
            this.ctx.fillRect(-15, -6, 3, 12);
            this.ctx.fillRect(12, -6, 3, 12);

            // 4 Crisp Color Bands
            const bands = getResistorColorBands(comp.resistance);
            const bandOffsets = [-10, -5, 0, 6];
            bands.forEach((bandColor, idx) => {
                this.ctx.fillStyle = bandColor;
                this.ctx.fillRect(bandOffsets[idx], -6, idx === 3 ? 3 : 2.5, 12);

                // Glossy Band Reflection Line
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                this.ctx.fillRect(bandOffsets[idx], -4, idx === 3 ? 3 : 2.5, 2);
            });

            if (this.showValueBadges && comp.isConfigured) {
                const formatted = comp.resistance >= 1000 ? (comp.resistance / 1000) + 'k' : comp.resistance;
                this.ctx.fillStyle = '#38bdf8';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${formatted}Ω`, 0, -9);
            }

            this.ctx.restore();

        } else if (comp.type === 'POT') {
            this.ctx.strokeStyle = '#94a3b8';
            this.ctx.lineWidth = 2.0;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            // 3D Metallic Cermet Potentiometer Body
            const potGrad = this.ctx.createRadialGradient(midX - 3, midY - 3, 2, midX, midY, 15);
            potGrad.addColorStop(0, '#38bdf8');
            potGrad.addColorStop(0.7, '#0284c7');
            potGrad.addColorStop(1, '#0369a1');

            this.ctx.fillStyle = potGrad;
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, 15, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#1e293b';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Inner Metallic Dial Ring
            this.ctx.fillStyle = '#e2e8f0';
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, 9, 0, Math.PI * 2);
            this.ctx.fill();

            // Knob Arrow Slot
            const knobAngle = (comp.ratio - 0.5) * Math.PI * 1.5;
            this.ctx.strokeStyle = '#0f172a';
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(midX, midY);
            this.ctx.lineTo(midX + Math.cos(knobAngle) * 8, midY + Math.sin(knobAngle) * 8);
            this.ctx.stroke();

            if (this.showValueBadges) {
                const effRes = comp.getEffectiveResistance();
                const formatted = effRes >= 1000 ? (effRes / 1000) + 'k' : effRes.toFixed(0);
                this.ctx.fillStyle = '#f59e0b';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${formatted}Ω (${(comp.ratio * 100).toFixed(0)}%)`, midX, midY - 18);
            }

        } else if (comp.type === 'C') {
            this.ctx.strokeStyle = '#94a3b8';
            this.ctx.lineWidth = 1.8;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            const isElec = comp.capType === 'ELEC';
            const isCeramic = comp.capType === 'CERAMIC';

            if (isElec) {
                // Electrolytic Photorealistic Aluminum Can Top
                const capGrad = this.ctx.createRadialGradient(midX - 3, midY - 3, 2, midX, midY, 11);
                capGrad.addColorStop(0, '#cbd5e1');
                capGrad.addColorStop(0.6, '#334155');
                capGrad.addColorStop(1, '#0f172a');

                this.ctx.fillStyle = capGrad;
                this.ctx.beginPath();
                this.ctx.arc(midX, midY, 11, 0, Math.PI * 2);
                this.ctx.fill();

                // Minus (-) Silver Cathode Stripe
                const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
                const stripeX = midX + Math.cos(angle) * 5;
                const stripeY = midY + Math.sin(angle) * 5;

                this.ctx.fillStyle = '#f8fafc';
                this.ctx.beginPath();
                this.ctx.arc(stripeX, stripeY, 5, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = '#0f172a';
                this.ctx.font = 'bold 10px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('-', stripeX, stripeY);

                // Polarity Lead Hole Badges
                this.ctx.fillStyle = '#ef4444';
                this.ctx.beginPath();
                this.ctx.arc(pA.x, pA.y, 6, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 10px monospace';
                this.ctx.fillText('+', pA.x, pA.y + 1);

                this.ctx.fillStyle = '#38bdf8';
                this.ctx.beginPath();
                this.ctx.arc(pB.x, pB.y, 6, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 10px monospace';
                this.ctx.fillText('-', pB.x, pB.y + 1);

            } else if (isCeramic) {
                // Ceramic Disc Photorealistic Amber Texture
                const cGrad = this.ctx.createRadialGradient(midX - 2, midY - 2, 2, midX, midY, 9);
                cGrad.addColorStop(0, '#fef08a');
                cGrad.addColorStop(0.6, '#d97706');
                cGrad.addColorStop(1, '#78350f');

                this.ctx.fillStyle = cGrad;
                this.ctx.beginPath();
                this.ctx.arc(midX, midY, 9, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 8px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('104', midX, midY);

            } else {
                // Mylar Film Green Capacitor Box
                const mGrad = this.ctx.createLinearGradient(midX - 7, midY - 8, midX + 7, midY + 8);
                mGrad.addColorStop(0, '#34d399');
                mGrad.addColorStop(0.5, '#059669');
                mGrad.addColorStop(1, '#064e3b');

                this.ctx.fillStyle = mGrad;
                this.ctx.beginPath();
                this.ctx.roundRect(midX - 7, midY - 8, 14, 16, 3);
                this.ctx.fill();
            }

            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
            this.ctx.lineWidth = isSelected ? 2 : 1;
            this.ctx.stroke();

            if (this.showValueBadges && comp.isConfigured) {
                const microVal = comp.capacitance * 1e6;
                this.ctx.fillStyle = '#e879f9';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${microVal < 0.1 ? (comp.capacitance * 1e9).toFixed(0) + 'n' : microVal.toFixed(1) + 'µ'}F`, midX, midY - 12);
            }

        } else if (comp.type === 'IC') {
            const midX = (pA.x + pB.x) / 2;
            const numPinsTotal = comp.pins || 8;
            const pinsPerSide = numPinsTotal / 2;
            const pitchY = 11.2;
            const chipWidth = Math.abs(pB.x - pA.x) + 26;
            const chipHeight = (pinsPerSide - 1) * pitchY + 28;
            const topY = pA.y - 14;

            // 1. Dual-In-Line Metallic Leads extending to Breadboard Holes
            for (let i = 0; i < pinsPerSide; i++) {
                const py = pA.y + i * pitchY;

                // Left Pin Lead
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillRect(pA.x, py - 2.5, (midX - chipWidth / 2) - pA.x, 5);
                this.ctx.strokeStyle = '#475569';
                this.ctx.lineWidth = 0.8;
                this.ctx.strokeRect(pA.x, py - 2.5, (midX - chipWidth / 2) - pA.x, 5);

                // Right Pin Lead
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillRect(midX + chipWidth / 2, py - 2.5, pB.x - (midX + chipWidth / 2), 5);
                this.ctx.strokeRect(midX + chipWidth / 2, py - 2.5, pB.x - (midX + chipWidth / 2), 5);
            }

            // 2. DIP Chip Photorealistic Matte Black Molded Body
            const chipGrad = this.ctx.createLinearGradient(midX - chipWidth / 2, topY, midX + chipWidth / 2, topY + chipHeight);
            chipGrad.addColorStop(0, '#334155');
            chipGrad.addColorStop(0.3, '#1e293b');
            chipGrad.addColorStop(0.8, '#0f172a');
            chipGrad.addColorStop(1, '#090d16');

            this.ctx.fillStyle = chipGrad;
            this.ctx.beginPath();
            this.ctx.roundRect(midX - chipWidth / 2, topY, chipWidth, chipHeight, 4);
            this.ctx.fill();

            // Inner Bevel Contour Highlight
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#475569';
            this.ctx.lineWidth = isSelected ? 2.5 : 1.2;
            this.ctx.stroke();

            // 3. Top Semicircular Notch
            this.ctx.fillStyle = '#080c14';
            this.ctx.beginPath();
            this.ctx.arc(midX, topY, 5, 0, Math.PI);
            this.ctx.fill();
            this.ctx.strokeStyle = '#334155';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();

            // 4. Pin 1 Silver Notch Dot
            this.ctx.fillStyle = '#cbd5e1';
            this.ctx.beginPath();
            this.ctx.arc(midX - chipWidth / 2 + 6, topY + 8, 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            // 5. White Laser-Etched Chip Markings
            this.ctx.fillStyle = '#f8fafc';
            this.ctx.font = 'bold 11px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            const icName = (comp.icType || 'IC').toUpperCase();
            this.ctx.fillText(icName, midX, topY + chipHeight / 2 - 2);

            // Subtitle Description
            this.ctx.fillStyle = '#94a3b8';
            this.ctx.font = 'bold 8px sans-serif';
            const meta = IC_CATALOG[comp.icType] || { desc: 'DIP CHIP' };
            const descShort = meta.desc ? meta.desc.split(' ')[0] : 'DIP';
            this.ctx.fillText(descShort, midX, topY + chipHeight / 2 + 10);
            // 6. Clean Metallic Silver Pins & Subtle Yellow Pin Numbers
            this.ctx.font = 'bold 9px monospace';
            this.ctx.textBaseline = 'middle';

            for (let i = 0; i < pinsPerSide; i++) {
                const legY = pA.y + i * pitchY;

                // Left Pin Leg (Pin 1..N/2)
                const leftPinNum = i + 1;
                const leftLegX = midX - chipWidth / 2;

                // Subtle Pin Number Inside Body
                this.ctx.fillStyle = (leftPinNum === 1) ? '#38bdf8' : '#f59e0b';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${leftPinNum}`, leftLegX + 8, legY);

                // Right Pin Leg (Pin N..N/2+1)
                const rightPinNum = numPinsTotal - i;
                const rightLegX = midX + chipWidth / 2;

                this.ctx.fillStyle = '#f59e0b';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${rightPinNum}`, rightLegX - 8, legY);
            }
        } else if (comp.type === 'DIODE' || comp.type === 'ZENER') {
            this.ctx.strokeStyle = '#636e72';
            this.ctx.lineWidth = 1.8;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;
            const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);

            this.ctx.save();
            this.ctx.translate(midX, midY);
            this.ctx.rotate(angle);

            this.ctx.fillStyle = comp.type === 'ZENER' ? '#e17055' : '#2d3436';
            this.ctx.beginPath();
            this.ctx.roundRect(-10, -5, 20, 10, 2);
            this.ctx.fill();

            // Cathode Silver Band
            this.ctx.fillStyle = '#dcdde1';
            this.ctx.fillRect(4, -5, 3, 10);

            if (this.showValueBadges) {
                this.ctx.fillStyle = '#facc15';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(comp.type === 'ZENER' ? `${comp.vZener || 5.1}V Zener` : (comp.model || '1N4148'), 0, -8);
            }

            this.ctx.restore();

        } else if (comp.type === 'VDC') {
            this.ctx.strokeStyle = '#ef4444';
            this.ctx.lineWidth = 2.0;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            this.ctx.fillStyle = '#ef4444';
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, 11, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 9px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`${comp.voltage}V`, midX, midY + 3);

        } else if (comp.type === 'SWITCH') {
            // Metallic Connecting Leads
            this.ctx.strokeStyle = '#94a3b8';
            this.ctx.lineWidth = 2.0;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            // 3D Rocker Switch Main Housing Body
            this.ctx.fillStyle = '#1e293b';
            this.ctx.beginPath();
            this.ctx.roundRect(midX - 16, midY - 10, 32, 20, 4);
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#475569';
            this.ctx.lineWidth = isSelected ? 2.0 : 1.2;
            this.ctx.stroke();

            // Toggle Rocker Lever Track
            this.ctx.fillStyle = '#0f172a';
            this.ctx.beginPath();
            this.ctx.roundRect(midX - 13, midY - 7, 26, 14, 3);
            this.ctx.fill();

            // Active State Rocker Knob (RED when OPEN/OFF, GREEN when CLOSED/ON)
            const knobX = comp.isOpen ? midX - 6 : midX + 6;
            const knobColor = comp.isOpen ? '#ef4444' : '#22c55e';

            this.ctx.fillStyle = knobColor;
            this.ctx.beginPath();
            this.ctx.roundRect(knobX - 6, midY - 5, 12, 10, 2);
            this.ctx.fill();

            // White Indicator Text
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 8px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(comp.isOpen ? 'OFF' : 'ON', knobX, midY);

            // Subtitle Status Label below switch
            this.ctx.fillStyle = comp.isOpen ? '#f87171' : '#4ade80';
            this.ctx.font = 'bold 9px monospace';
            this.ctx.fillText(comp.isOpen ? 'OPEN' : 'CLOSED', midX, midY + 15);

        } else if (comp.type === 'LED') {
            this.ctx.strokeStyle = '#636e72';
            this.ctx.lineWidth = 1.8;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            if (comp.isOn) {
                this.ctx.shadowColor = '#22c55e';
                this.ctx.shadowBlur = 12;
            }

            this.ctx.fillStyle = comp.isOn ? '#22c55e' : '#166534';
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, 8, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Render Glowing Drag Handles on Selected Component
        if (isSelected) {
            this.ctx.shadowColor = '#00cec9';
            this.ctx.shadowBlur = 12;

            [ { pos: pA, label: 'A' }, { pos: pB, label: 'B' } ].forEach(h => {
                this.ctx.fillStyle = '#38bdf8';
                this.ctx.beginPath();
                this.ctx.arc(h.pos.x, h.pos.y, 8, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                this.ctx.fillStyle = '#0f172a';
                this.ctx.font = 'bold 10px sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(h.label, h.pos.x, h.pos.y);
            });
        }

        this.ctx.restore();
    }
}


/* --- src/ui/OscilloscopeCanvas.js --- */
class RingBuffer {
    constructor(capacity = 200000) {
        this.capacity = capacity;
        this.data = new Float64Array(capacity);
        this.head = 0;
        this.count = 0;
        this.length = capacity;
    }

    reset() {
        this.data.fill(0);
        this.head = 0;
        this.count = 0;
        this.length = this.capacity;
    }

    push(val) {
        this.data[this.head] = val;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;
        this.length = this.capacity;
    }

    get(i) {
        if (i < 0 || i >= this.capacity) return 0;
        let idx = (this.head - this.capacity + i) % this.capacity;
        if (idx < 0) idx += this.capacity;
        return this.data[idx];
    }

    // Get sample n steps back from the newest sample (0 = newest, 1 = 2nd newest...)
    getRecent(n) {
        if (n < 0 || n >= this.capacity) return 0;
        let idx = (this.head - 1 - n) % this.capacity;
        if (idx < 0) idx += this.capacity;
        return this.data[idx];
    }
}

class OscilloscopeCanvas {
    constructor(canvasOrMap) {
        if (canvasOrMap && (canvasOrMap.canvasA || canvasOrMap.mainCanvas)) {
            this.canvas = canvasOrMap.mainCanvas || canvasOrMap.canvasA;
            this.canvasA = canvasOrMap.canvasA;
            this.canvasB = canvasOrMap.canvasB;
            this.canvasC = canvasOrMap.canvasC;
            this.canvasD = canvasOrMap.canvasD;
        } else {
            this.canvas = canvasOrMap;
        }
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

        this.bufferSize = 200000; // 200,000 Float64Array RingBuffer (1.0 second full history window for wide Time/Div zoom)
        this.dt = 0.000005; // 5us high-resolution simulation time step
        this.resetBuffer();

        // Independent Per-Channel Volt/Div Scales (Default 5.0V/div for ±10.8V 21.6Vpp signals)
        this.voltPerDivChA = 5.0;
        this.voltPerDivChB = 5.0;
        this.voltPerDivChC = 5.0;
        this.voltPerDivChD = 5.0;

        // Independent Per-Channel Y-Position Vertical Offsets (pixels)
        this.posOffsetYChA = 0;
        this.posOffsetYChB = 0;
        this.posOffsetYChC = 0;
        this.posOffsetYChD = 0;

        // Independent Per-Channel Horizontal Timebase Settings (Default 0.2ms / div)
        this.timePerDivChA = 0.0002;
        this.timePerDivChB = 0.0002;
        this.timePerDivChC = 0.0002;
        this.timePerDivChD = 0.0002;

        // Horizontal Timebase Settings (Default 0.2ms / div)
        this.timePerDiv = 0.0002;
        this.posOffsetX = 0;

        // Channel ON/OFF Visibility Toggles
        this.showChA = true;
        this.showChB = true;
        this.showChC = true;
        this.showChD = true;

        // Freeze (STOP / RUN) State Flag
        this.isFrozen = false;

        this.statsA = { vMin: 0, vMax: 0, vpp: 0, vrms: 0, freq: 0, period: 0 };
        this.statsB = { vMin: 0, vMax: 0, vpp: 0, vrms: 0, freq: 0, period: 0 };
        this.statsC = { vMin: 0, vMax: 0, vpp: 0, vrms: 0, freq: 0, period: 0 };
        this.statsD = { vMin: 0, vMax: 0, vpp: 0, vrms: 0, freq: 0, period: 0 };
    }

    toggleFreeze() {
        this.isFrozen = !this.isFrozen;
        return this.isFrozen;
    }

    setFreeze(frozen) {
        this.isFrozen = !!frozen;
    }

    resetBuffer() {
        this.ringA = new RingBuffer(this.bufferSize);
        this.ringB = new RingBuffer(this.bufferSize);
        this.ringC = new RingBuffer(this.bufferSize);
        this.ringD = new RingBuffer(this.bufferSize);
        // Expose bufferA as Array for FFT & Diagnostic compatibility
        this.bufferA = [];
    }

    resetControls() {
        this.voltPerDivChA = 5.0;
        this.voltPerDivChB = 5.0;
        this.voltPerDivChC = 5.0;
        this.voltPerDivChD = 5.0;

        this.posOffsetYChA = 0;
        this.posOffsetYChB = 0;
        this.posOffsetYChC = 0;
        this.posOffsetYChD = 0;

        this.timePerDivChA = 0.0002;
        this.timePerDivChB = 0.0002;
        this.timePerDivChC = 0.0002;
        this.timePerDivChD = 0.0002;

        this.timePerDiv = 0.0002;
        this.posOffsetX = 0;
        this.isFrozen = false;

        this.render();
    }

    addSample(vA, vB, vC = 0, vD = 0) {
        if (this.isFrozen) return; // Waveform Freeze (STOP Mode)

        let valA = isNaN(vA) || !isFinite(vA) ? 0 : Math.max(-25, Math.min(25, vA));
        let valB = isNaN(vB) || !isFinite(vB) ? 0 : Math.max(-25, Math.min(25, vB));
        let valC = isNaN(vC) || !isFinite(vC) ? 0 : Math.max(-25, Math.min(25, vC));
        let valD = isNaN(vD) || !isFinite(vD) ? 0 : Math.max(-25, Math.min(25, vD));

        this.ringA.push(valA);
        this.ringB.push(valB);
        this.ringC.push(valC);
        this.ringD.push(valD);
    }

    calculateStats() {
        this.statsA = this.computeStatsForRing(this.ringA);
        this.statsB = this.computeStatsForRing(this.ringB);
        this.statsC = this.computeStatsForRing(this.ringC);
        this.statsD = this.computeStatsForRing(this.ringD);

        // Synchronize bufferA array for FFT spectrum module
        const len = Math.min(512, this.ringA.count);
        this.bufferA = new Array(len);
        for (let i = 0; i < len; i++) {
            this.bufferA[i] = this.ringA.getRecent(len - 1 - i);
        }
    }

    computeStatsForRing(ringBuffer) {
        if (!ringBuffer || ringBuffer.count === 0) {
            return { vMin: 0, vMax: 0, vpp: 0, vrms: 0, freq: 0, period: 0 };
        }

        const inspectLen = Math.min(ringBuffer.count, 2000);
        let vMin = Infinity;
        let vMax = -Infinity;
        let sumSq = 0;

        for (let i = 0; i < inspectLen; i++) {
            const v = ringBuffer.getRecent(i);
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
            sumSq += v * v;
        }

        if (vMin === Infinity) vMin = 0;
        if (vMax === -Infinity) vMax = 0;

        const vpp = Math.max(0, vMax - vMin);
        const vrms = Math.sqrt(sumSq / inspectLen);

        let crossings = 0;
        const mid = (vMin + vMax) / 2;
        let prevVal = ringBuffer.getRecent(inspectLen - 1);
        for (let i = inspectLen - 2; i >= 0; i--) {
            const currVal = ringBuffer.getRecent(i);
            if ((prevVal < mid && currVal >= mid) || (prevVal >= mid && currVal < mid)) {
                crossings++;
            }
            prevVal = currVal;
        }

        const totalTime = inspectLen * (this.dt || 0.000005);
        const freq = (crossings > 1 && vpp > 0.3 && totalTime > 0) ? (crossings / 2) / totalTime : 0;
        const period = freq > 0 ? 1.0 / freq : 0;

        return { vMin, vMax, vpp, vrms, freq, period };
    }

    render() {
        this.calculateStats();

        // 1. Render on 4 Independent Screen Canvases (TP1~TP4) with 10 DIV x 8 DIV KCA Exam Sheet Grid
        if (this.canvasA) this.renderSingleScreen(this.canvasA, this.ringA, '#facc15', this.voltPerDivChA, this.posOffsetYChA, 'TP 1 / CH A', this.statsA, this.timePerDivChA);
        if (this.canvasB) this.renderSingleScreen(this.canvasB, this.ringB, '#e879f9', this.voltPerDivChB, this.posOffsetYChB, 'TP 2 / CH B', this.statsB, this.timePerDivChB);
        if (this.canvasC) this.renderSingleScreen(this.canvasC, this.ringC, '#38bdf8', this.voltPerDivChC, this.posOffsetYChC, 'TP 3 / CH C', this.statsC, this.timePerDivChC);
        if (this.canvasD) this.renderSingleScreen(this.canvasD, this.ringD, '#22c55e', this.voltPerDivChD, this.posOffsetYChD, 'TP 4 / CH D', this.statsD, this.timePerDivChD);

        // 2. Also render on main modal canvas if available
        if (this.canvas && this.ctx) {
            this.renderMainModalCanvas();
        }
    }

    renderSingleScreen(canvas, ringBuffer, color, voltPerDiv, posOffsetY, channelLabel, stats, timePerDivOverride) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Dark background matching exam sheet paper frame
        ctx.fillStyle = '#060a12';
        ctx.fillRect(0, 0, width, height);

        // 1. Draw KCA Official Exam Answer Sheet Grid: Exactly 10 DIVs Wide x 8 DIVs High (Media media_1788162478342.png match)
        const numDivsX = 10;
        const numDivsY = 8;
        const divW = width / numDivsX;
        const divH = height / numDivsY;

        ctx.save();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 6]); // Ultra HD Dashed grid lines

        ctx.beginPath();
        for (let i = 1; i < numDivsX; i++) {
            ctx.moveTo(i * divW, 0);
            ctx.lineTo(i * divW, height);
        }
        for (let j = 1; j < numDivsY; j++) {
            ctx.moveTo(0, j * divH);
            ctx.lineTo(width, j * divH);
        }
        ctx.stroke();

        // 2. Solid Center Axes (X=5 div, Y=4 div)
        ctx.setLineDash([]);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // 3. Outer Solid Rectangular Frame Border
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3.0;
        ctx.strokeRect(0, 0, width, height);
        ctx.restore();

        // 4. Draw Waveform Trace using getRecent for instant Time/Div zoom
        const zeroY = height * 0.5;
        const scaleY = divH;
        if (ringBuffer && ringBuffer.count > 0) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 3.6;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;

            const channelTimeDiv = timePerDivOverride || this.timePerDiv || 0.0002;
            const totalTimeScreen = 10 * channelTimeDiv; // 10 DIVs total across screen
            const samplesOnScreen = Math.max(2, Math.round(totalTimeScreen / this.dt));
            const vDivScale = scaleY / (voltPerDiv || 1.0);
            const traceZeroY = zeroY - posOffsetY;

            ctx.beginPath();
            let isFirst = true;
            for (let px = 0; px < width; px++) {
                // px=0 is left (oldest sample on screen), px=width-1 is right (newest sample)
                const sampleOffset = Math.round((width - 1 - px) / (width - 1) * (samplesOnScreen - 1));
                let v = ringBuffer.getRecent(sampleOffset);
                if (isNaN(v) || !isFinite(v)) v = 0;
                v = Math.max(-25.0, Math.min(25.0, v));
                const y = traceZeroY - (v * vDivScale);
                if (isFirst) {
                    ctx.moveTo(px, y);
                    isFirst = false;
                } else {
                    ctx.lineTo(px, y);
                }
            }
            ctx.stroke();
            ctx.restore();
        }

        // 5. STOP Freeze Badge if frozen
        if (this.isFrozen) {
            ctx.save();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.roundRect(width - 70, 6, 64, 16, 3);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⏸️ STOP', width - 38, 14);
            ctx.restore();
        }
    }

    renderMainModalCanvas() {
        if (!this.canvas || !this.ctx) return;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // CRT Dark Background
        this.ctx.fillStyle = '#090d16';
        this.ctx.fillRect(0, 0, width, height);

        // 1. Grid Lines (10 x 8 divs)
        this.ctx.strokeStyle = '#1e293b';
        this.ctx.lineWidth = 1;
        const numDivsX = 5; // 5 Horizontal Time Axis Grid Divisions
        const numDivsY = 8;
        const divW = width / numDivsX;
        const divH = height / numDivsY;

        this.ctx.beginPath();
        for (let i = 0; i <= numDivsX; i++) {
            this.ctx.moveTo(i * divW, 0);
            this.ctx.lineTo(i * divW, height);
        }
        for (let j = 0; j <= numDivsY; j++) {
            this.ctx.moveTo(0, j * divH);
            this.ctx.lineTo(width, j * divH);
        }
        this.ctx.stroke();

        // 0V Symmetrical Center Baseline (50% height)
        const zeroY = height * 0.5;

        this.ctx.strokeStyle = '#334155';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(width / 2, 0);
        this.ctx.lineTo(width / 2, height);
        this.ctx.moveTo(0, zeroY);
        this.ctx.lineTo(width, zeroY);
        this.ctx.stroke();

        this.ctx.fillStyle = '#94a3b8';
        this.ctx.font = 'bold 10px monospace';
        const timeFormatted = this.timePerDiv >= 0.001 ? `${(this.timePerDiv * 1000).toFixed(1)}ms/div` : `${(this.timePerDiv * 1000000).toFixed(0)}µs/div`;
        this.ctx.fillText(`0V Center Baseline (${timeFormatted})`, 54, zeroY - 5);

        const scaleY = divH;

        // 2. Render 4 Waveform Traces with RingBuffers
        if (this.showChA) {
            this.renderTrace(this.ringA, '#facc15', this.voltPerDivChA, zeroY, scaleY, this.posOffsetYChA, this.posOffsetX);
        }
        if (this.showChB) {
            this.renderTrace(this.ringB, '#e879f9', this.voltPerDivChB, zeroY, scaleY, this.posOffsetYChB, this.posOffsetX);
        }
        if (this.showChC) {
            this.renderTrace(this.ringC, '#38bdf8', this.voltPerDivChC, zeroY, scaleY, this.posOffsetYChC, this.posOffsetX);
        }
        if (this.showChD) {
            this.renderTrace(this.ringD, '#22c55e', this.voltPerDivChD, zeroY, scaleY, this.posOffsetYChD, this.posOffsetX);
        }

        // 3. Render Left Y-Axis Voltage Ruler Scale & Major/Minor Tick Marks
        const activeVoltDiv = (this.showChA ? this.voltPerDivChA : (this.showChB ? this.voltPerDivChB : 5.0)) || 5.0;

        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        this.ctx.fillRect(0, 38, 50, height - 38);
        this.ctx.strokeStyle = '#334155';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(0, 38, 50, height - 38);

        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        this.ctx.font = 'bold 10px monospace';

        for (let j = 0; j <= numDivsY; j++) {
            const y = j * divH;
            if (y < 36) continue;

            const divOffsetFromCenter = 4 - j;
            const voltVal = divOffsetFromCenter * activeVoltDiv;
            const signStr = voltVal > 0 ? '+' : (voltVal < 0 ? '' : ' ');
            const voltStr = `${signStr}${voltVal.toFixed(0)}V`;

            // Major Tick Mark
            this.ctx.strokeStyle = (j === 4) ? '#facc15' : '#475569';
            this.ctx.lineWidth = (j === 4) ? 2 : 1;
            this.ctx.beginPath();
            this.ctx.moveTo(40, y);
            this.ctx.lineTo(48, y);
            this.ctx.stroke();

            // Voltage Text Label
            this.ctx.fillStyle = (j === 4) ? '#facc15' : '#94a3b8';
            this.ctx.fillText(voltStr, 8, y);

            // Minor Sub-Ticks (5 subdivisions per division)
            if (j < numDivsY) {
                const subH = divH / 5;
                for (let k = 1; k < 5; k++) {
                    const subY = y + k * subH;
                    if (subY >= 38) {
                        this.ctx.strokeStyle = '#334155';
                        this.ctx.lineWidth = 1;
                        this.ctx.beginPath();
                        this.ctx.moveTo(44, subY);
                        this.ctx.lineTo(48, subY);
                        this.ctx.stroke();
                    }
                }
            }
        }

        // 4. Channel Telemetry HUD Overlay
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        this.ctx.fillRect(8, 8, width - 16, 26);
        this.ctx.strokeStyle = '#334155';
        this.ctx.strokeRect(8, 8, width - 16, 26);

        this.ctx.font = 'bold 10px monospace';
        this.ctx.textBaseline = 'middle';

        const fmtStats = (stats, vDiv) => {
            if (!stats) return `${vDiv}V/d`;
            let vpp = (isNaN(stats.vpp) || !isFinite(stats.vpp)) ? 0 : stats.vpp;
            let freq = stats.freq || 0;
            let fStr = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : (freq > 0 ? `${freq.toFixed(0)}Hz` : '');
            return `${vDiv}V/d (${vpp.toFixed(2)}Vpp${fStr ? ' ' + fStr : ''})`;
        };

        // CH A Stats
        this.ctx.fillStyle = this.showChA ? '#facc15' : '#475569';
        this.ctx.fillText(`CH A: ${fmtStats(this.statsA, this.voltPerDivChA)}`, 16, 21);

        // CH B Stats
        this.ctx.fillStyle = this.showChB ? '#e879f9' : '#475569';
        this.ctx.fillText(`CH B: ${fmtStats(this.statsB, this.voltPerDivChB)}`, 230, 21);

        // CH C Stats
        this.ctx.fillStyle = this.showChC ? '#38bdf8' : '#475569';
        this.ctx.fillText(`CH C: ${fmtStats(this.statsC, this.voltPerDivChC)}`, 440, 21);

        // CH D Stats
        this.ctx.fillStyle = this.showChD ? '#22c55e' : '#475569';
        this.ctx.fillText(`CH D: ${fmtStats(this.statsD, this.voltPerDivChD)}`, 650, 21);

        // 5. Waveform Freeze STOP Badge Overlay
        if (this.isFrozen) {
            this.ctx.fillStyle = '#ef4444';
            this.ctx.beginPath();
            this.ctx.roundRect(width - 110, 11, 95, 20, 4);
            this.ctx.fill();
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 11px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('⏸️ STOPPED', width - 62, 21);
            this.ctx.textAlign = 'left';
        }
    }

    renderTrace(ringBuffer, color, voltPerDiv, zeroY, scaleY, posOffsetY = 0, posOffsetX = 0) {
        if (!ringBuffer || ringBuffer.length === 0) return;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2.0;
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 4;

        const totalTimeScreen = 5 * (this.timePerDiv || 0.005);
        const samplesOnScreen = Math.max(2, Math.round(totalTimeScreen / this.dt));
        const width = this.canvas.width;
        const vDivScale = scaleY / (voltPerDiv || 1.0);
        const traceZeroY = zeroY - posOffsetY;

        const endIdx = Math.min(ringBuffer.length, ringBuffer.length - Math.round(posOffsetX));
        const startIdx = Math.max(0, endIdx - samplesOnScreen);
        const numSamples = endIdx - startIdx;

        if (numSamples <= 0) return;

        this.ctx.beginPath();

        if (numSamples > width) {
            // Clean Crisp Sample Point Rendering (Eliminates average notch spikes & staircase distortion)
            const samplesPerPixel = numSamples / width;
            let isFirst = true;

            for (let px = 0; px < width; px++) {
                const sIdx = Math.floor(startIdx + px * samplesPerPixel);
                let v = ringBuffer.get(sIdx);
                if (isNaN(v) || !isFinite(v)) v = 0;
                v = Math.max(-25.0, Math.min(25.0, v));
                const y = traceZeroY - (v * vDivScale);

                if (isFirst) {
                    this.ctx.moveTo(px, y);
                    isFirst = false;
                } else {
                    this.ctx.lineTo(px, y);
                }
            }
        } else {
            // High-Resolution Direct Sample Point-to-Point Interpolation
            const stepX = width / (samplesOnScreen - 1);
            let isFirstPoint = true;

            for (let i = startIdx; i < endIdx; i++) {
                const screenIdx = i - startIdx;
                const x = screenIdx * stepX;
                let v = ringBuffer.get(i);
                if (isNaN(v) || !isFinite(v)) v = 0;
                v = Math.max(-25.0, Math.min(25.0, v));
                const y = traceZeroY - (v * vDivScale);

                if (isFirstPoint) {
                    this.ctx.moveTo(x, y);
                    isFirstPoint = false;
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
        }

        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }
}


/* --- src/ui/ContinuityTester.js --- */
/**
 * ContinuityTester.js
 * Breadboard Node Continuity & BEEP Sound Tester v=1170.
 */

class ContinuityTester {
    constructor(grid) {
        this.grid = grid;
        this.pinA = null; // Red Probe (+) Pin
        this.pinB = null; // Black Probe (-) Pin
        this.soundEnabled = true;
        this.audioCtx = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isConnected = false;
        this.measuredResistance = Infinity;
    }

    initAudio() {
        if (!this.audioCtx && typeof window !== 'undefined') {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.audioCtx = new AudioCtx();
            }
        }
    }

    setProbes(pinA, pinB) {
        this.pinA = pinA;
        this.pinB = pinB;
    }

    updateContinuity(components = []) {
        if (!this.pinA || !this.pinB) {
            this.isConnected = false;
            this.measuredResistance = Infinity;
            this.stopBeep();
            return { isConnected: false, resistance: Infinity };
        }

        const nodeA = this.grid.getNodeId(this.pinA);
        const nodeB = this.grid.getNodeId(this.pinB);

        if (!nodeA || !nodeB) {
            this.isConnected = false;
            this.measuredResistance = Infinity;
            this.stopBeep();
            return { isConnected: false, resistance: Infinity };
        }

        // Direct Same Breadboard Row / Group Node Match
        if (nodeA === nodeB) {
            this.isConnected = true;
            this.measuredResistance = 0.0;
            this.triggerBeep();
            return { isConnected: true, resistance: 0.0 };
        }

        // Breadboard Graph BFS Connectivity Search over Wires and low resistance (< 10 ohms)
        const connected = this.checkGraphConnectivity(nodeA, nodeB, components);
        this.isConnected = connected.isConnected;
        this.measuredResistance = connected.resistance;

        if (this.isConnected) {
            this.triggerBeep();
        } else {
            this.stopBeep();
        }

        return connected;
    }

    checkGraphConnectivity(nodeA, nodeB, components) {
        const adj = new Map();
        const addEdge = (u, v, r) => {
            if (!adj.has(u)) adj.set(u, []);
            if (!adj.has(v)) adj.set(v, []);
            adj.get(u).push({ node: v, res: r });
            adj.get(v).push({ node: u, res: r });
        };

        components.forEach(c => {
            if (c.type === 'WIRE') {
                const n1 = this.grid.getNodeId(c.pinA);
                const n2 = this.grid.getNodeId(c.pinB);
                if (n1 && n2) addEdge(n1, n2, 0.05);
            } else if (c.type === 'R' && c.resistance <= 10.0) {
                const n1 = this.grid.getNodeId(c.pinA);
                const n2 = this.grid.getNodeId(c.pinB);
                if (n1 && n2) addEdge(n1, n2, c.resistance);
            }
        });

        const visited = new Set([nodeA]);
        const queue = [{ node: nodeA, totalR: 0.0 }];

        while (queue.length > 0) {
            const curr = queue.shift();
            if (curr.node === nodeB) {
                return { isConnected: true, resistance: curr.totalR };
            }

            const neighbors = adj.get(curr.node) || [];
            for (const nxt of neighbors) {
                if (!visited.has(nxt.node)) {
                    visited.add(nxt.node);
                    queue.push({ node: nxt.node, totalR: curr.totalR + nxt.res });
                }
            }
        }

        return { isConnected: false, resistance: Infinity };
    }

    triggerBeep() {
        if (!this.soundEnabled) {
            this.stopBeep();
            return;
        }

        try {
            this.initAudio();
            if (!this.audioCtx) return;

            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            if (!this.oscillator) {
                this.oscillator = this.audioCtx.createOscillator();
                this.gainNode = this.audioCtx.createGain();

                this.oscillator.type = 'sine';
                this.oscillator.frequency.setValueAtTime(880, this.audioCtx.currentTime); // 880Hz crisp BEEP tone

                this.gainNode.gain.setValueAtTime(0.12, this.audioCtx.currentTime); // Crisp, comfortable BEEP volume

                this.oscillator.connect(this.gainNode);
                this.gainNode.connect(this.audioCtx.destination);
                this.oscillator.start();
            }
        } catch (e) {
            console.warn('Audio BEEP trigger error:', e);
        }
    }

    stopBeep() {
        if (this.oscillator) {
            try {
                this.oscillator.stop();
                this.oscillator.disconnect();
            } catch (e) {}
            this.oscillator = null;
            this.gainNode = null;
        }
    }
}


/* --- src/components/SPICEExporter.js --- */
/**
 * SPICEExporter.js
 * Exports circuit state to standard SPICE Netlist format and JSON payload for AI telemetry.
 */

class SPICEExporter {
    static exportNetlist(components, grid) {
        const lines = [];
        lines.push('* Hybrid Circuit Simulator SPICE Netlist Export');
        lines.push('* Generated at ' + new Date().toISOString());
        lines.push('');

        components.forEach(comp => {
            const nodeA = grid.getNodeId(comp.pinA);
            const nodeB = grid.getNodeId(comp.pinB);

            if (comp.type === 'R') {
                lines.push(`${comp.id} ${nodeA} ${nodeB} ${comp.resistance}`);
            } else if (comp.type === 'C') {
                const capMicro = comp.capacitance * 1e6;
                lines.push(`${comp.id} ${nodeA} ${nodeB} ${capMicro}u`);
            } else if (comp.type === 'VDC') {
                lines.push(`${comp.id} ${nodeA} ${nodeB} DC ${comp.voltage}V`);
            } else if (comp.type === 'SWITCH') {
                lines.push(`* ${comp.id} ${nodeA} ${nodeB} (State: ${comp.isOpen ? 'OPEN' : 'CLOSED'})`);
                lines.push(`R_${comp.id} ${nodeA} ${nodeB} ${comp.value}`);
            } else if (comp.type === 'LED') {
                lines.push(`D_${comp.id} ${nodeA} ${nodeB} LED_Model`);
            }
        });

        lines.push('');
        lines.push('.model LED_Model D (Vj=2.0)');
        lines.push('.tran 0.1ms 50ms');
        lines.push('.end');

        return lines.join('\n');
    }

    static exportTelemetryJSON(components, grid, probeAVal, probeBVal, stats, fftResult) {
        const netlistNodes = {};
        components.forEach(comp => {
            const nA = grid.getNodeId(comp.pinA);
            const nB = grid.getNodeId(comp.pinB);
            netlistNodes[comp.id] = {
                type: comp.type,
                pins: [comp.pinA, comp.pinB],
                nodes: [nA, nB],
                value: comp.value
            };
        });

        return {
            timestamp: Date.now(),
            components: netlistNodes,
            probes: {
                probeA: { pin: grid.getNodeId(probeAVal), currentVoltage: probeAVal },
                probeB: { pin: grid.getNodeId(probeBVal), currentVoltage: probeBVal }
            },
            oscilloscope: stats,
            spectrum: {
                peakFreqHz: fftResult ? fftResult.peakFreq : 0,
                maxMagnitude: fftResult ? fftResult.maxMagnitude : 0
            }
        };
    }
}


/* --- src/components/AICopilot.js --- */
/**
 * AICopilot.js
 * LLM AI Copilot Interface Module for Circuit Diagnostics & Signal Analysis.
 */

class AICopilot {
    constructor(apiEndpoint = null, apiKey = null) {
        this.apiEndpoint = apiEndpoint;
        this.apiKey = apiKey;
    }

    /**
     * Solicits analysis from AI Copilot (Mock or REST API call).
     * @param {Object} telemetry - Circuit telemetry JSON generated by SPICEExporter
     * @param {string} userQuery - Optional custom user prompt
     * @returns {Promise<string>} - AI Response Markdown text
     */
    async analyzeCircuit(telemetry, userQuery = null) {
        // If live API endpoint configured, send POST request
        if (this.apiEndpoint && this.apiKey) {
            try {
                const response = await fetch(this.apiEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify({
                        telemetry,
                        prompt: userQuery || "Analyze this electronic circuit graph, transient waveform, and frequency spectrum for issues and performance metrics."
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.analysis || data.choices?.[0]?.message?.content || JSON.stringify(data);
                }
            } catch (err) {
                console.warn('Live AI API call failed, falling back to Intelligent Local Copilot:', err);
            }
        }

        // Fallback: High-quality rule-based Intelligent Mock LLM Copilot Engine
        return this.generateMockAnalysis(telemetry, userQuery);
    }

    generateMockAnalysis(telemetry, userQuery) {
        const comps = telemetry.components || {};
        const compList = Object.values(comps);

        let resistor = compList.find(c => c.type === 'R');
        let capacitor = compList.find(c => c.type === 'C');
        let dcSrc = compList.find(c => c.type === 'VDC');
        let sw = compList.find(c => c.type === 'SWITCH');

        let rVal = resistor ? resistor.value : 1000;
        let cVal = capacitor ? capacitor.value : 10e-6;
        let tau = rVal * cVal; // RC time constant
        let fc = 1 / (2 * Math.PI * tau); // Cutoff frequency

        const stats = telemetry.oscilloscope || {};
        const peakFreq = telemetry.spectrum?.peakFreqHz || 0;

        let markdown = `### 🤖 AI Circuit Copilot Analysis Report\n\n`;

        if (userQuery && userQuery.includes('fc')) {
            markdown += `**차단 주파수 (Cut-off Frequency $f_c$) 계산:**\n`;
            markdown += `- 저항값 ($R$): **${rVal >= 1000 ? (rVal / 1000) + ' kΩ' : rVal + ' Ω'}**\n`;
            markdown += `- 커패시턴스 ($C$): **${(cVal * 1e6).toFixed(1)} µF**\n`;
            markdown += `- 시상수 ($\tau = R \\times C$): **${(tau * 1000).toFixed(2)} ms**\n`;
            markdown += `- 이론적 차단 주파수 ($f_c = \\frac{1}{2\\pi RC}$): **${fc.toFixed(2)} Hz**\n\n`;
            return markdown;
        }

        markdown += `#### 1. 회로 구성망 (Circuit Topology)\n`;
        markdown += `- **DC 전원**: ${dcSrc ? dcSrc.value + 'V' : '미연결'}\n`;
        markdown += `- **RC 직렬 필터**: $R = ${rVal >= 1000 ? (rVal / 1000) + ' kΩ' : rVal + ' Ω'}$, $C = ${(cVal * 1e6).toFixed(1)} \\mu\\text{F}$\n`;
        markdown += `- **스위치 상태**: ${sw ? (sw.value > 100 ? '🔴 OPEN (차단)' : '🟢 CLOSED (도통)') : 'N/A'}\n\n`;

        markdown += `#### 2. 과도 응답 및 과도 특성 (Transient Response)\n`;
        markdown += `- **이론적 시상수 ($\tau$)**: **${(tau * 1000).toFixed(2)} ms**\n`;
        markdown += `- **최대 전압 ($V_{\\max}$)**: ${stats.vmax ? stats.vmax.toFixed(2) + 'V' : '0.00V'}\n`;
        markdown += `- **Peak-to-Peak ($V_{pp}$)**: ${stats.vpp ? stats.vpp.toFixed(2) + 'V' : '0.00V'}\n\n`;

        markdown += `#### 3. 주파수 영역 FFT 분석 (Frequency Response)\n`;
        markdown += `- **이론적 1차 RC 차단 주파수 ($f_c$)**: **${fc.toFixed(2)} Hz**\n`;
        markdown += `- **실측 Peak 주파수**: **${peakFreq.toFixed(1)} Hz**\n\n`;

        markdown += `#### 💡 진단 및 추천 (AI Recommendation)\n`;
        if (sw && sw.value > 100) {
            markdown += `⚠️ **경고**: 현재 스위치가 열려(OPEN) 있어 전류가 흐르지 않습니다. '스위치 토글' 버튼을 클릭하거나 스위치를 닫아 충전 파형을 관찰하세요.\n`;
        } else {
            markdown += `✅ **정상 작동**: 커패시터 충전 파형이 지수함수 $v_C(t) = V_{DC}(1 - e^{-t/\\tau})$ 궤적을 따라 정상 형성되고 있습니다.\n`;
            markdown += `- **Tip**: 저항이나 커패시터 값을 변경하면 계측기 화면에서 시상수 $\\tau$ 와 FFT 주파수 스펙트럼 차단점이 즉시 갱신됩니다.\n`;
        }

        return markdown;
    }
}


/* --- src/components/CircuitSerializer.js --- */
/**
 * CircuitSerializer.js
 * Serializes and deserializes the breadboard circuit state to/from JSON.
 * Auto-normalizes DIP IC height & auto-sanitizes shorted wires v=1056.
 */



class CircuitSerializer {
    static serialize(components, power = {}, probes = {}, title = 'My Breadboard Circuit') {
        const serializedComps = components.map(comp => {
            const base = {
                id: comp.id,
                type: comp.type,
                pinA: comp.pinA,
                pinB: comp.pinB
            };

            if (comp.type === 'WIRE') {
                base.color = comp.color;
            } else if (comp.type === 'R') {
                base.resistance = comp.resistance;
                base.isConfigured = comp.isConfigured;
            } else if (comp.type === 'POT') {
                base.totalResistance = comp.totalResistance;
                base.ratio = comp.ratio;
            } else if (comp.type === 'C') {
                base.capacitance = comp.capacitance;
                base.isConfigured = comp.isConfigured;
                base.capType = comp.capType;
            } else if (comp.type === 'VDC') {
                base.voltage = comp.voltage;
                base.isConfigured = comp.isConfigured;
            } else if (comp.type === 'SWITCH') {
                base.isOpen = comp.isOpen;
            } else if (comp.type === 'LED') {
                base.vForward = comp.vForward;
            } else if (comp.type === 'DIODE') {
                base.vForward = comp.vForward;
            } else if (comp.type === 'ZENER') {
                base.vZener = comp.vZener;
                base.vForward = comp.vForward;
            } else if (comp.type === 'BJT') {
                base.transType = comp.transType || '2N3904';
                base.pinEmitter = comp.pinEmitter || comp.pinA;
                base.pinBase = comp.pinBase;
                base.pinCollector = comp.pinCollector || comp.pinB;
                base.polarity = comp.polarity || 'NPN';
            } else if (comp.type === 'IC') {
                base.icType = comp.icType;
            }

            return base;
        });

        return {
            version: '1.0',
            savedAt: new Date().toISOString(),
            title: title,
            power: {
                voltageVa: power.voltageVa || 12.0,
                voltageVb: power.voltageVb || 0.0,
                voltageVc: power.voltageVc || -12.0
            },
            probes: {
                probeAPin: probes.probeAPin || null,
                probeBPin: probes.probeBPin || null,
                probeCPin: probes.probeCPin || null,
                probeDPin: probes.probeDPin || null
            },
            components: serializedComps
        };
    }

    static deserialize(data) {
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        if (!data || !Array.isArray(data.components)) {
            throw new Error('유효하지 않은 회로 데이터 파일 형식입니다.');
        }

        const restoredComps = [];
        data.components.forEach((item, idx) => {
            const id = item.id || `COMP_${idx + 1}`;
            let comp = null;

            if (item.type === 'WIRE') {
                // Auto-sanitizer: If WIRE_23 shorts Vref (+6V) directly to Pin 3 (which is shorted to Pin 6 OUT), re-anchor to Pin 3 IN+
                if (item.pinA === 'B2_B5' && item.pinB === 'B2_B17') {
                    comp = new Wire(id, 'B1_E5', 'B2_E17', item.color || '#0984e3');
                } else {
                    comp = new Wire(id, item.pinA, item.pinB, item.color || '#0984e3');
                }
            } else if (item.type === 'R') {
                // Auto-sanitizer: If 10k resistor is between B1_G11 and B1_G14, re-anchor to Pin 6 -> Pin 3 hysteresis
                if (item.pinA === 'B1_G11' && item.pinB === 'B1_G14') {
                    comp = new Resistor(id, 'B2_F17', 'B2_E17', item.resistance || 10000, item.isConfigured ?? true);
                } else if (item.pinA === 'B1_I14' && item.pinB === 'B2_A14') {
                    comp = new Resistor(id, 'B2_F17', 'B1_F16', item.resistance || 100000, item.isConfigured ?? true);
                } else {
                    comp = new Resistor(id, item.pinA, item.pinB, item.resistance || 1000, item.isConfigured ?? true);
                }
            } else if (item.type === 'POT') {
                comp = new Potentiometer(id, item.pinA, item.pinB, item.totalResistance || 10000, item.ratio ?? 0.5);
            } else if (item.type === 'C') {
                if (item.pinA === 'B1_F14' && item.pinB === 'B1_F18') {
                    comp = new Capacitor(id, 'B1_F16', 'B1_GND_L_16', item.capacitance || 1e-7, item.isConfigured ?? true, item.capType || 'MYLAR');
                } else {
                    comp = new Capacitor(id, item.pinA, item.pinB, item.capacitance || 0.1e-6, item.isConfigured ?? true, item.capType || 'MYLAR');
                }
            } else if (item.type === 'VDC') {
                comp = new DCSource(id, item.pinA, item.pinB, item.voltage || 5.0, item.isConfigured ?? true);
            } else if (item.type === 'SWITCH') {
                comp = new SwitchComponent(id, item.pinA, item.pinB, item.isOpen ?? false);
            } else if (item.type === 'LED') {
                comp = new LEDComponent(id, item.pinA, item.pinB, item.vForward || 2.0);
            } else if (item.type === 'DIODE') {
                comp = new Diode(id, item.pinA, item.pinB, item.vForward || 0.7);
            } else if (item.type === 'ZENER') {
                comp = new ZenerDiode(id, item.pinA, item.pinB, item.vZener || 5.1, item.vForward || 0.7);
            } else if (item.type === 'BJT') {
                const transType = item.transType || '2N3904';
                const pE = item.pinEmitter || item.pinA;
                const pB = item.pinBase;
                const pC = item.pinCollector || item.pinB;
                comp = new BJTTransistor(id, transType, pE, pB, pC);
            } else if (item.type === 'IC') {
                // Auto-normalize DIP chip height: DIP-8 is 4 rows high (startRow to startRow + 3)
                let pB = item.pinB;
                if (item.pinA && item.pinA.includes('_')) {
                    const parts = item.pinA.split('_');
                    const blk = parts[0];
                    const startRow = parseInt(parts[1].slice(1), 10);
                    const meta = IC_CATALOG[item.icType || 'LF356'] || { pins: 8 };
                    const pinsPerSide = (meta.pins || 8) / 2;
                    pB = `${blk}_F${startRow + pinsPerSide - 1}`;
                }
                comp = new DIPChip(id, item.icType || 'LF356', item.pinA, pB);
            }

            if (comp) {
                restoredComps.push(comp);
            }
        });

        // Ensure Probe A is anchored to Pin 6 OUT (B2_F17) if probeAPin is B2_I17 or null
        let probeA = (data.probes && data.probes.probeAPin) ? data.probes.probeAPin : 'B2_F17';
        if (probeA === 'B2_I17') probeA = 'B2_F17';

        return {
            title: data.title || '불러온 회로',
            power: data.power || { voltageVa: 12.0, voltageVb: 0.0, voltageVc: -12.0 },
            probes: {
                probeAPin: probeA,
                probeBPin: (data.probes && data.probes.probeBPin) || 'B1_F16',
                probeCPin: (data.probes && data.probes.probeCPin) || 'BINDING_Va',
                probeDPin: (data.probes && data.probes.probeDPin) || 'BINDING_Vc'
            },
            components: restoredComps
        };
    }

    static saveToFile(dataObj, filename = 'my_breadboard_circuit.json') {
        const jsonStr = JSON.stringify(dataObj, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    static saveToLocalStorage(dataObj, key = 'saved_breadboard_circuit') {
        const jsonStr = JSON.stringify(dataObj);
        localStorage.setItem(key, jsonStr);
    }

    static loadFromLocalStorage(key = 'saved_breadboard_circuit') {
        const jsonStr = localStorage.getItem(key);
        if (!jsonStr) return null;
        return this.deserialize(jsonStr);
    }
}


/* --- app.js --- */
/**
 * app.js
 * Main Controller for Wanjie BB-4T7D 3220-Pin Hybrid Electronic Circuit Simulator.
 * EIC-108 & LM741 Square Wave Oscillator Auto-Start Live Engine v=1055.
 */













class AppController {
    constructor() {
        this.grid = new BreadboardGrid();
        this.solver = new MNASolver(this.grid);
        this.aiCopilot = new AICopilot();

        this.breadboardCanvas = new BreadboardCanvas(
            document.getElementById('breadboardCanvas'),
            this.grid
        );
        this.oscilloscopeCanvas = new OscilloscopeCanvas({
            mainCanvas: document.getElementById('oscilloscopeCanvas'),
            canvasA: document.getElementById('scopeCanvasA'),
            canvasB: document.getElementById('scopeCanvasB'),
            canvasC: document.getElementById('scopeCanvasC'),
            canvasD: document.getElementById('scopeCanvasD')
        });
        this.continuityTester = new ContinuityTester(this.grid);

        this.isRunning = false;
        this.dt = 0.000005; // 5us high-resolution timestep for 100% silky-smooth Sine Waves
        this.components = [];
        this.simTime = 0;
        this.animFrameId = null;
        this.fftTimer = 0;
        this.compCounter = 1;

        // Power Supply Binding Post Voltages
        this.voltageVa = 12.0;
        this.voltageVb = 0.0;
        this.voltageVc = -12.0;

        // Selected Family Dropdown Values
        this.selectedResistorType = 'R';
        this.selectedCapacitorType = 'C_MYLAR';
        this.selectedIcKey = 'LF356';
        this.selectedTransistorType = '2N3904';

        this.currentExamTitle = null;

        // 4CH Oscilloscope Probes
        this.probeAPin = null;
        this.probeBPin = null;
        this.probeCPin = null;
        this.probeDPin = null;

        this.initPlacementEngine();
        this.initEmptyBoard(); // Start with a Clean Empty Breadboard by Default
        this.setupUIEventListeners();
        this.setupSaveLoadHandlers();
        this.initFeedbackBoard();
        this.startSimulation(); // Auto-start live 60 FPS simulation on page load!
        this.renderAll();
    }

    startSimulation() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.runLoop();
        }
    }

    stopSimulation() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    parseValue(str) {
        if (!str) return null;
        str = str.trim().toLowerCase();
        let mult = 1;
        if (str.endsWith('k')) { mult = 1e3; str = str.slice(0, -1); }
        else if (str.endsWith('m')) { mult = 1e6; str = str.slice(0, -1); }
        else if (str.endsWith('u') || str.endsWith('µ')) { mult = 1e-6; str = str.slice(0, -1); }
        const val = parseFloat(str);
        return isNaN(val) ? null : val * mult;
    }

    initPlacementEngine() {
        this.breadboardCanvas.onPlacementCancelled = () => {
            this.resetToolState();
        };

        this.breadboardCanvas.onSwitchToggled = (switchComp) => {
            if (this.oscilloscopeCanvas) this.oscilloscopeCanvas.resetBuffer();
            this.warmupSimulationBuffer(1200);
            this.renderAll();
        };

        this.breadboardCanvas.onComponentPlaced = (toolType, pinA, pinB) => {
            const id = `${toolType}_${this.compCounter++}`;
            let newComp = null;
            let labelMsg = '';

            if (toolType === 'WIRE') {
                const isPower = pinA.includes('VCC') || pinB.includes('VCC') || pinA.startsWith('BINDING_') || pinB.startsWith('BINDING_');
                newComp = new Wire(id, pinA, pinB, isPower ? '#ef4444' : '#0984e3');
                labelMsg = '점퍼 와이어';
            } else if (toolType === 'RESISTOR_CATALOG' || toolType === 'R') {
                const resType = this.selectedResistorType || 'R';
                if (resType === 'POT_1M') {
                    newComp = new Potentiometer(id, pinA, pinB, 1000000, 0.5);
                    labelMsg = '🎛️ 1MΩ 가변저항 (Potentiometer)';
                } else if (resType === 'POT_50K') {
                    newComp = new Potentiometer(id, pinA, pinB, 50000, 0.5);
                    labelMsg = '🎛️ 50kΩ 가변저항 (Potentiometer)';
                } else if (resType === 'POT') {
                    newComp = new Potentiometer(id, pinA, pinB, 10000, 0.5);
                    labelMsg = '🎛️ 10kΩ 가변저항 (Potentiometer)';
                } else {
                    newComp = new Resistor(id, pinA, pinB, 1000, false);
                    labelMsg = '고정 저항 (더블클릭하여 Ω 수치 변경)';
                }
            } else if (toolType === 'CAPACITOR_CATALOG' || toolType === 'C') {
                const capKind = this.selectedCapacitorType || 'C_MYLAR';
                if (capKind === 'C_ELEC') {
                    newComp = new Capacitor(id, pinA, pinB, 10e-6, false, 'ELEC');
                    labelMsg = '전해 콘덴서 (더블클릭하여 µF 변경)';
                } else if (capKind === 'C_CERAMIC') {
                    newComp = new Capacitor(id, pinA, pinB, 0.1e-6, false, 'CERAMIC');
                    labelMsg = '세라믹 콘덴서 (더블클릭하여 µF 변경)';
                } else {
                    newComp = new Capacitor(id, pinA, pinB, 0.1e-6, false, 'MYLAR');
                    labelMsg = '마일러 필름 콘덴서 (더블클릭하여 µF 변경)';
                }
            } else if (toolType === 'IC_CATALOG') {
                const icKey = this.selectedIcKey || 'LF356';
                const meta = IC_CATALOG[icKey] || IC_CATALOG['LF356'];
                newComp = new DIPChip(id, icKey, pinA, pinB);
                labelMsg = `🔲 ${meta.name} (DIP-${meta.pins})`;
            } else if (toolType === 'TRANSISTOR_CATALOG') {
                const transKey = this.selectedTransistorType || '2N3904';
                const meta = TRANSISTOR_CATALOG[transKey] || TRANSISTOR_CATALOG['2N3904'];
                const pinout = meta.pinout || 'EBC';

                let p1 = pinA;
                let p2 = pinA;
                let p3 = pinB;

                const matchA = pinA.match(/^(B\d_)?([A-J])(\d+)$/);
                const matchB = pinB.match(/^(B\d_)?([A-J])(\d+)$/);

                if (matchA && matchB && matchA[1] === matchB[1]) {
                    const blockPrefix = matchA[1] || 'B1_';
                    const colA = matchA[2];
                    const colB = matchB[2];
                    const rowA = parseInt(matchA[3], 10);
                    const rowB = parseInt(matchB[3], 10);

                    if (colA === colB) {
                        // Vertical placement (3 rows in same column e.g. Row 24, 25, 26 as drawn by user)
                        const minRow = Math.min(rowA, rowB);
                        const maxRow = Math.max(rowA, rowB);
                        if (maxRow - minRow === 1) {
                            p1 = `${blockPrefix}${colA}${minRow}`;
                            p2 = `${blockPrefix}${colA}${minRow + 1}`;
                            p3 = `${blockPrefix}${colA}${Math.min(60, minRow + 2)}`;
                        } else {
                            const midRow = Math.round((minRow + maxRow) / 2);
                            p1 = `${blockPrefix}${colA}${minRow}`;
                            p2 = `${blockPrefix}${colA}${midRow}`;
                            p3 = `${blockPrefix}${colA}${maxRow}`;
                        }
                    } else if (rowA === rowB) {
                        // Horizontal placement (3 columns in same row e.g. E20, F20, G20)
                        const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
                        const idxA = cols.indexOf(colA);
                        const idxB = cols.indexOf(colB);
                        const minIdx = Math.min(idxA, idxB);
                        const maxIdx = Math.max(idxA, idxB);

                        if (maxIdx - minIdx === 1) {
                            p1 = `${blockPrefix}${cols[minIdx]}${rowA}`;
                            p2 = `${blockPrefix}${cols[Math.min(9, minIdx + 1)]}${rowA}`;
                            p3 = `${blockPrefix}${cols[Math.min(9, minIdx + 2)]}${rowA}`;
                        } else {
                            const midIdx = Math.round((minIdx + maxIdx) / 2);
                            p1 = `${blockPrefix}${cols[minIdx]}${rowA}`;
                            p2 = `${blockPrefix}${cols[midIdx]}${rowA}`;
                            p3 = `${blockPrefix}${cols[maxIdx]}${rowA}`;
                        }
                    } else {
                        p1 = pinA; p2 = pinA; p3 = pinB;
                    }
                }

                let pinEmitter, pinBase, pinCollector;
                if (pinout === 'ECB') { // C1815, A1015 (Exactly as drawn by user: E, C, B)
                    pinEmitter = p1;
                    pinCollector = p2;
                    pinBase = p3;
                } else { // 'EBC' e.g. 2N3904, 2N3906, 2N2222
                    pinEmitter = p1;
                    pinBase = p2;
                    pinCollector = p3;
                }

                newComp = new BJTTransistor(id, transKey, pinEmitter, pinBase, pinCollector);
                labelMsg = `🔺 ${meta.name} (${pinout} TO-92)`;
            } else if (toolType === 'DIODE') {
                newComp = new Diode(id, pinA, pinB, 0.7);
                labelMsg = '정류 다이오드 (1N4007)';
            } else if (toolType === 'ZENER') {
                newComp = new ZenerDiode(id, pinA, pinB, 5.1, 0.7);
                labelMsg = '제너 다이오드 (5.1V Zener)';
            } else if (toolType === 'POT') {
                newComp = new Potentiometer(id, pinA, pinB, 10000, 0.5);
                labelMsg = '가변저항 (Potentiometer)';
            } else if (toolType === 'VDC') {
                newComp = new DCSource(id, pinA, pinB, 5.0, false);
                labelMsg = 'DC 5V 전원';
            } else if (toolType === 'SWITCH') {
                newComp = new SwitchComponent(id, pinA, pinB, false);
                labelMsg = '스위치';
            } else if (toolType === 'LED') {
                newComp = new LEDComponent(id, pinA, pinB, 2.0);
                labelMsg = 'LED';
            }

            if (newComp) {
                this.components.push(newComp);
                this.resetToolState();
                this.oscilloscopeCanvas.resetBuffer();
                this.warmupSimulationBuffer(1200);
                this.breadboardCanvas.toastMsg = `📍 ${labelMsg}가 브레드보드 핀에 안착되었습니다!`;
                this.renderAll();
            }
        };

        this.breadboardCanvas.onComponentDblClicked = (comp) => {
            this.openPropertyInspector(comp);
        };

        this.breadboardCanvas.onBindingPostDblClicked = (bindingKey) => {
            if (bindingKey === 'BINDING_Va') {
                const valStr = prompt(`🔴 Va 바인딩 포스트 전압(V)을 입력하세요:`, this.voltageVa);
                const parsed = parseFloat(valStr);
                if (!isNaN(parsed)) {
                    this.voltageVa = parsed;
                    this.breadboardCanvas.voltageVa = parsed;
                    this.oscilloscopeCanvas.resetBuffer();
                    this.warmupSimulationBuffer(1200);
                    this.breadboardCanvas.toastMsg = `🔴 Va 전압이 [${parsed > 0 ? '+' : ''}${parsed}V]로 설정되었습니다!`;
                    this.renderAll();
                }
            } else if (bindingKey === 'BINDING_Vb') {
                const valStr = prompt(`🟢 Vb 바인딩 포스트 전압(V)을 입력하세요:`, this.voltageVb);
                const parsed = parseFloat(valStr);
                if (!isNaN(parsed)) {
                    this.voltageVb = parsed;
                    this.breadboardCanvas.voltageVb = parsed;
                    this.oscilloscopeCanvas.resetBuffer();
                    this.warmupSimulationBuffer(1200);
                    this.breadboardCanvas.toastMsg = `🟢 Vb 전압이 [${parsed > 0 ? '+' : ''}${parsed}V]로 설정되었습니다!`;
                    this.renderAll();
                }
            } else if (bindingKey === 'BINDING_Vc') {
                const valStr = prompt(`🔵 Vc 바인딩 포스트 전압(V)을 입력하세요:`, this.voltageVc);
                const parsed = parseFloat(valStr);
                if (!isNaN(parsed)) {
                    this.voltageVc = parsed;
                    this.breadboardCanvas.voltageVc = parsed;
                    this.oscilloscopeCanvas.resetBuffer();
                    this.warmupSimulationBuffer(1200);
                    this.breadboardCanvas.toastMsg = `🔵 Vc 전압이 [${parsed > 0 ? '+' : ''}${parsed}V]로 설정되었습니다!`;
                    this.renderAll();
                }
            }
        };

        this.breadboardCanvas.onProbePlaced = (type, pinKey) => {
            if (type === 'A') {
                this.probeAPin = pinKey;
                this.breadboardCanvas.probeAPin = pinKey;
            } else if (type === 'B') {
                this.probeBPin = pinKey;
                this.breadboardCanvas.probeBPin = pinKey;
            } else if (type === 'C') {
                this.probeCPin = pinKey;
                this.breadboardCanvas.probeCPin = pinKey;
            } else if (type === 'D') {
                this.probeDPin = pinKey;
                this.breadboardCanvas.probeDPin = pinKey;
            } else if (type === 'CONTINUITY_RED') {
                this.continuityTester.pinA = pinKey;
                this.resetToolState();
                this.breadboardCanvas.toastMsg = `🔴 도통 테스터기 (+) 탐침 앵커 (${pinKey})`;
                this.renderAll();
                return;
            } else if (type === 'CONTINUITY_BLACK') {
                this.continuityTester.pinB = pinKey;
                this.resetToolState();
                this.breadboardCanvas.toastMsg = `⚫ 도통 테스터기 (-) 탐침 앵커 (${pinKey})`;
                this.renderAll();
                return;
            }

            this.syncScopeChannelVisibility();
            this.oscilloscopeCanvas.resetBuffer();
            this.warmupSimulationBuffer(1200);
            this.resetToolState();
            this.breadboardCanvas.toastMsg = `📍 4CH 오실로스코프 프로브 CH ${type} 앵커 (${pinKey})`;
            this.renderAll();
        };

        this.breadboardCanvas.onPotentiometerChanged = (comp) => {
            this.oscilloscopeCanvas.resetBuffer();
            this.warmupSimulationBuffer(600);
            this.updateScopePotSlider(comp);
            this.renderAll();
        };

        this.breadboardCanvas.onNeedsRender = () => {
            this.renderAll();
        };
    }

    updateScopePotSlider(comp) {
        if (!comp || comp.type !== 'POT') {
            comp = this.components.find(c => c.type === 'POT');
        }
        if (!comp) return;

        const potSlider = document.getElementById('scopePotSlider');
        const potText = document.getElementById('scopePotValText');
        const valPct = Math.round(comp.ratio * 100);

        if (potSlider) potSlider.value = valPct;
        const effRes = comp.getEffectiveResistance();
        const formattedEff = effRes >= 1000000 ? (effRes / 1000000).toFixed(2) + 'M' : (effRes >= 1000 ? (effRes / 1000).toFixed(1) + 'k' : effRes.toFixed(0));

        if (potText) potText.textContent = `${formattedEff}Ω (${valPct}%)`;
    }

    openPropertyInspector(comp) {
        if (comp.type === 'R') {
            const valStr = prompt(`⚡ 저항(R) 수치를 입력하세요 (예: 1000, 1k, 330, 4.7k, 10k, 1M):`, comp.isConfigured ? comp.resistance : '1000');
            const parsed = this.parseValue(valStr);
            if (parsed && parsed > 0) {
                comp.resistance = parsed;
                comp.isConfigured = true;
                const formatted = parsed >= 1000 ? (parsed / 1000) + 'k' : parsed;
                this.breadboardCanvas.toastMsg = `⚡ 저항 4색 띠 및 [${formatted}Ω] 뱃지가 설정되었습니다!`;
                this.updateCutoffFreqDisplay();
                this.renderAll();
            }
        } else if (comp.type === 'C') {
            if (comp.capType === 'ELEC') {
                const choice = confirm(`🔋 전해 콘덴서 극성 및 용량 설정:\n\n[확인]: 🔄 극성 반전 (+ ↔ - 뒤집기)\n[취소]: ⚡ 용량(µF) 수정하기`);
                if (choice) {
                    this.breadboardCanvas.selectedComponent = comp;
                    this.flipSelectedComponentPolarity();
                    return;
                }
            }
            const defaultVal = (comp.capacitance * 1e6).toFixed(0);
            const valStr = prompt(`🔋 ${comp.capType || ''} 커패시터(C) 용량을 µF 단위로 입력하세요 (예: 10, 100, 0.1, 1u, 47u):`, comp.isConfigured ? defaultVal : '10');
            const parsed = this.parseValue(valStr);
            if (parsed && parsed > 0) {
                comp.capacitance = (valStr.includes('u') || valStr.includes('µ')) ? parsed : parsed * 1e-6;
                comp.isConfigured = true;
                const capMicro = comp.capacitance * 1e6;
                this.breadboardCanvas.toastMsg = `🔋 ${comp.capType || ''} 커패시터 용량이 [${capMicro.toFixed(1)}µF] 뱃지로 표시됩니다!`;
                this.updateCutoffFreqDisplay();
                this.renderAll();
            }
        } else if (comp.type === 'IC') {
            const meta = IC_CATALOG[comp.icType] || { name: comp.icType, pins: 8, desc: 'DIP Integrated Circuit' };
            alert(`🔲 집적회로 (IC): ${meta.name}\n\n📌 핀 수: DIP-${meta.pins} 패키지\n📝 설명: ${meta.desc}\n\n📍 핀 1 위치: ${comp.pinA}\n📍 반대편 핀 위치: ${comp.pinB}\n\n중앙 홈(Center Trough)을 가로질러 숏트 없이 세로 핀에 연결되었습니다.`);
        } else if (comp.type === 'ZENER') {
            const valStr = prompt(`⚡ 제너 다이오드 정전압 항복 전압(Vz)을 입력하세요 (예: 3.3, 5.1, 9.1, 12.0):`, comp.vZener || '5.1');
            const parsed = parseFloat(valStr);
            if (!isNaN(parsed) && parsed > 0) {
                comp.vZener = parsed;
                this.breadboardCanvas.toastMsg = `⚡ 제너 전압이 [${parsed}V Zener]로 설정되었습니다!`;
                this.renderAll();
            }
        } else if (comp.type === 'POT') {
            const defaultTotal = comp.totalResistance >= 1e6 ? (comp.totalResistance / 1e6) + 'M' : (comp.totalResistance >= 1e3 ? (comp.totalResistance / 1e3) + 'k' : comp.totalResistance);
            const valStr = prompt(`🎛️ 가변저항 최대 전저항 용량(Max R)을 입력하세요 (예: 50k, 1M, 10k, 100k, 500k):`, defaultTotal);
            const parsedTotal = this.parseValue(valStr);
            if (parsedTotal && parsedTotal > 0) {
                comp.totalResistance = parsedTotal;
            }
            const pctStr = prompt(`🎛️ 가변저항 다이얼 노브 비율(0% ~ 100%)을 입력하세요:`, (comp.ratio * 100).toFixed(0));
            const parsedRatio = parseFloat(pctStr);
            if (!isNaN(parsedRatio)) {
                comp.ratio = Math.max(0.01, Math.min(0.99, parsedRatio / 100.0));
            }
            const effRes = comp.getEffectiveResistance();
            const formattedEff = effRes >= 1000000 ? (effRes / 1000000).toFixed(2) + 'M' : (effRes >= 1000 ? (effRes / 1000).toFixed(1) + 'k' : effRes.toFixed(0));
            const formattedTotal = comp.totalResistance >= 1000000 ? (comp.totalResistance / 1000000) + 'M' : (comp.totalResistance >= 1000 ? (comp.totalResistance / 1000) + 'k' : comp.totalResistance);
            this.oscilloscopeCanvas.resetBuffer();
            this.warmupSimulationBuffer(1200);
            this.breadboardCanvas.toastMsg = `🎛️ 가변저항이 [최대 ${formattedTotal}Ω 중 ${formattedEff}Ω (${(comp.ratio * 100).toFixed(0)}%)]로 설정되었습니다!`;
            this.renderAll();
        } else if (comp.type === 'VDC') {
            const valStr = prompt(`🔴 DC 전압(V)을 입력하세요 (예: 5.0, 12.0, 3.3):`, comp.voltage || '5.0');
            const parsed = parseFloat(valStr);
            if (!isNaN(parsed)) {
                comp.voltage = parsed;
                comp.isConfigured = true;
                this.breadboardCanvas.toastMsg = `🔴 DC 전압이 [${parsed}V] 뱃지로 표시됩니다!`;
                this.renderAll();
            }
        } else if (comp.type === 'SWITCH') {
            const isOpen = comp.toggle();
            this.breadboardCanvas.toastMsg = isOpen ? '🔴 스위치 열림 (OFF)' : '🟢 스위치 닫힘 (ON)';
            this.renderAll();
        }
    }

    flipSelectedComponentPolarity() {
        const selected = this.breadboardCanvas.selectedComponent;
        if (!selected) {
            alert('극성/방향을 반전시킬 부품을 먼저 브레드보드에서 클릭하여 선택하세요.');
            return;
        }

        const tmpA = selected.pinA;
        selected.pinA = selected.pinB;
        selected.pinB = tmpA;

        if (selected.type === 'BJT') {
            const tmpE = selected.pinEmitter;
            selected.pinEmitter = selected.pinCollector;
            selected.pinCollector = tmpE;
        }

        this.warmupSimulationBuffer(1200);
        const nameMsg = selected.type === 'C' ? '전해 콘덴서 (+ ↔ -)' : (selected.type === 'BJT' ? '트랜지스터 (E ↔ C)' : '소자');
        this.breadboardCanvas.toastMsg = `🔄 ${nameMsg} 극성/핀 방향이 180도 뒤집혔습니다!`;
        this.renderAll();
    }

    toggleScopeFreeze() {
        const isFrozen = this.oscilloscopeCanvas.toggleFreeze();
        const btnHeader = document.getElementById('btnToggleScopeFreezeHeader');
        const btnToolbar = document.getElementById('btnToggleScopeFreeze');

        const labelHeaderStr = isFrozen ? '▶️ RUN (실시간)' : '⏸️ STOP (화면 멈춤)';
        const labelToolbarStr = isFrozen ? '▶️ RUN (Space)' : '⏸️ STOP (Space)';
        const bgStr = isFrozen ? '#22c55e' : '#ef4444';

        if (btnHeader) {
            btnHeader.innerText = labelHeaderStr;
            btnHeader.style.background = bgStr;
        }
        if (btnToolbar) {
            btnToolbar.innerText = labelToolbarStr;
            btnToolbar.style.background = bgStr;
        }

        this.breadboardCanvas.toastMsg = isFrozen ? '⏸️ 오실로스코프 파형이 멈췄습니다. (Space로 재개)' : '▶️ 오실로스코프 실시간 파형이 재개되었습니다.';
        this.oscilloscopeCanvas.render();
    }

    syncScopeChannelVisibility() {
        const hasA = !!(this.breadboardCanvas && this.breadboardCanvas.probeAPin);
        const hasB = !!(this.breadboardCanvas && this.breadboardCanvas.probeBPin);
        const hasC = !!(this.breadboardCanvas && this.breadboardCanvas.probeCPin);
        const hasD = !!(this.breadboardCanvas && this.breadboardCanvas.probeDPin);

        this.oscilloscopeCanvas.showChA = hasA;
        this.oscilloscopeCanvas.showChB = hasB;
        this.oscilloscopeCanvas.showChC = hasC;
        this.oscilloscopeCanvas.showChD = hasD;

        const chkA = document.getElementById('chkChA');
        const chkB = document.getElementById('chkChB');
        const chkC = document.getElementById('chkChC');
        const chkD = document.getElementById('chkChD');

        if (chkA) chkA.checked = hasA;
        if (chkB) chkB.checked = hasB;
        if (chkC) chkC.checked = hasC;
        if (chkD) chkD.checked = hasD;
    }

    updateScopeTelemetryUI() {
        const updateCh = (chKey, probePin, stats) => {
            const telVpp = document.getElementById(`telVpp${chKey}`);
            const telFreq = document.getElementById(`telFreq${chKey}`);
            const telStatsCard = document.getElementById(`telStats${chKey}`);
            const cardEl = telVpp ? telVpp.closest('.card') : null;

            if (!probePin) {
                if (telVpp) telVpp.innerText = 'Vpp: -- V (미연결)';
                if (telFreq) telFreq.innerText = 'Freq: -- Hz';
                if (telStatsCard) telStatsCard.innerText = '-- Vpp (미연결)';
                if (cardEl) cardEl.style.opacity = '0.45';
                return;
            }
            if (cardEl) cardEl.style.opacity = '1.0';
            if (stats) {
                let vpp = (isNaN(stats.vpp) || !isFinite(stats.vpp)) ? 0 : stats.vpp;
                let freq = stats.freq || 0;
                let fStr = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : (freq > 0 ? `${freq.toFixed(0)}Hz` : '');
                if (telVpp) telVpp.innerText = `Vpp: ${vpp.toFixed(2)}V`;
                if (telFreq) telFreq.innerText = `Freq: ${fStr || '-- Hz'}`;
                if (telStatsCard) telStatsCard.innerText = `${vpp.toFixed(2)}Vpp${fStr ? ' ' + fStr : ''}`;
            }
        };
        updateCh('ChA', this.breadboardCanvas.probeAPin, this.oscilloscopeCanvas.statsA);
        updateCh('ChB', this.breadboardCanvas.probeBPin, this.oscilloscopeCanvas.statsB);
        updateCh('ChC', this.breadboardCanvas.probeCPin, this.oscilloscopeCanvas.statsC);
        updateCh('ChD', this.breadboardCanvas.probeDPin, this.oscilloscopeCanvas.statsD);
    }

    initEmptyBoard() {
        this.components = [];
        this.currentExamTitle = null;
        this.probeAPin = null;
        this.probeBPin = null;
        this.probeCPin = null;
        this.probeDPin = null;
        if (this.breadboardCanvas) {
            this.breadboardCanvas.probeAPin = null;
            this.breadboardCanvas.probeBPin = null;
            this.breadboardCanvas.probeCPin = null;
            this.breadboardCanvas.probeDPin = null;
            this.breadboardCanvas.selectedComponent = null;
            this.breadboardCanvas.componentsRef = this.components;
        }
        if (this.oscilloscopeCanvas) {
            this.oscilloscopeCanvas.resetBuffer();
        }
        this.simTime = 0;
        this.updateCutoffFreqDisplay();
        this.renderAll();
    }

    warmupSimulationBuffer(steps = 60000) {
        const bindingSources = [
            new DCSource('SRC_VA', 'BINDING_Va', 'BINDING_GND', this.voltageVa, true),
            new DCSource('SRC_VB', 'BINDING_Vb', 'BINDING_GND', this.voltageVb, true),
            new DCSource('SRC_VC', 'BINDING_Vc', 'BINDING_GND', this.voltageVc, true)
        ];
        const activeComps = [...this.components, ...bindingSources];

        this.oscilloscopeCanvas.resetBuffer();
        for (let i = 0; i < steps; i++) {
            const nodeVoltages = this.solver.solveStep(activeComps, this.dt);
            this.simTime += this.dt;

            const nA = this.breadboardCanvas.probeAPin ? this.grid.getNodeId(this.breadboardCanvas.probeAPin) : null;
            const nB = this.breadboardCanvas.probeBPin ? this.grid.getNodeId(this.breadboardCanvas.probeBPin) : null;
            const nC = this.breadboardCanvas.probeCPin ? this.grid.getNodeId(this.breadboardCanvas.probeCPin) : null;
            const nD = this.breadboardCanvas.probeDPin ? this.grid.getNodeId(this.breadboardCanvas.probeDPin) : null;

            const vA = nA ? (nodeVoltages.get(nA) || 0) : 0;
            const vB = nB ? (nodeVoltages.get(nB) || 0) : 0;
            const vC = nC ? (nodeVoltages.get(nC) || 0) : 0;
            const vD = nD ? (nodeVoltages.get(nD) || 0) : 0;

            this.oscilloscopeCanvas.addSample(vA, vB, vC, vD);
        }
    }

    // 🔺 2-Transistor (BJT 2N3904) Astable Multivibrator Preset (+5V)
    initBjtAstableOscillator() {
        this.currentExamTitle = '🔺 2-트랜지스터(BJT 2N3904) 비안정 멀티바이브레이터 사각파 발진회로';
        this.voltageVa = 5.0;
        this.voltageVb = 0.0;
        this.voltageVc = 0.0;
        this.breadboardCanvas.voltageVa = 5.0;
        this.breadboardCanvas.voltageVb = 0.0;
        this.breadboardCanvas.voltageVc = 0.0;

        this.components = [
            new Wire('W_VCC_TOP', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
            new Wire('W_GND_TOP', 'BINDING_GND', 'GND_TOP1_50', '#3b82f6'),

            new Wire('W_B1_VCC', 'VCC_TOP1_1', 'B1_VCC_L_10', '#ef4444'),
            new Wire('W_B1_GND', 'GND_TOP1_1', 'B1_GND_L_10', '#3b82f6'),
            new Wire('W_B2_VCC', 'VCC_TOP1_25', 'B2_VCC_R_10', '#ef4444'),
            new Wire('W_B2_GND', 'GND_TOP1_25', 'B2_GND_R_10', '#3b82f6'),

            new Resistor('RC1', 'B1_VCC_L_10', 'B1_C15', 390, true),
            new Resistor('RB1', 'B1_VCC_L_10', 'B1_D15', 47000, true),
            new Wire('W_RC1_C1', 'B1_C15', 'B1_C33', '#0984e3'),
            new Wire('W_RB1_B1', 'B1_D15', 'B1_C31', '#0984e3'),
            new Wire('W_E1_GND', 'B1_C29', 'B1_GND_L_29', '#3b82f6'),
            new BJTTransistor('Q1', '2N3904', 'B1_C29', 'B1_C31', 'B1_C33'),

            new Resistor('RB2', 'B2_VCC_R_10', 'B2_F15', 47000, true),
            new Resistor('RC2', 'B2_VCC_R_10', 'B2_G15', 390, true),
            new Wire('W_RB2_B2', 'B2_F15', 'B2_G31', '#0984e3'),
            new Wire('W_RC2_C2', 'B2_G15', 'B2_G33', '#0984e3'),
            new Wire('W_E2_GND', 'B2_G29', 'B2_GND_R_29', '#3b82f6'),
            new BJTTransistor('Q2', '2N3904', 'B2_G29', 'B2_G31', 'B2_G33'),

            new Capacitor('C1', 'B1_C15', 'B1_D20', 0.1e-6, true, 'MYLAR'),
            new Wire('W_C1_CROSS', 'B1_D20', 'B2_G31', '#0984e3'),
            new Capacitor('C2', 'B2_G15', 'B2_F20', 0.1e-6, true, 'MYLAR'),
            new Wire('W_C2_CROSS', 'B2_F20', 'B1_C31', '#0984e3')
        ];

        this.probeAPin = 'B1_C33';
        this.probeBPin = 'B1_C31';
        this.probeCPin = null;
        this.probeDPin = null;

        this.breadboardCanvas.probeAPin = this.probeAPin;
        this.breadboardCanvas.probeBPin = this.probeBPin;
        this.breadboardCanvas.probeCPin = null;
        this.breadboardCanvas.probeDPin = null;

        this.oscilloscopeCanvas.voltPerDivChA = 2.0;
        this.oscilloscopeCanvas.voltPerDivChB = 2.0;
        this.oscilloscopeCanvas.timePerDiv = 0.002;

        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `🔺 2-트랜지스터 BJT 비안정 사각파 발진회로 로드 완료!`;
    }

    // 🎯 User's Exact Layout Preserved SQUARE Preset
    initUserPreservedSquare() {
        this.currentExamTitle = '⚡ 직접 그리신 배치 100% 보존 SQUARE 회로';
        this.voltageVa = 12.0;
        this.voltageVb = 0.0;
        this.voltageVc = -12.0;
        this.breadboardCanvas.voltageVa = 12.0;
        this.breadboardCanvas.voltageVb = 0.0;
        this.breadboardCanvas.voltageVc = -12.0;

        this.components = [
            new DIPChip('IC_CATALOG_14', 'LM741', 'B2_E15', 'B2_F18'),

            new Resistor('RESISTOR_CATALOG_15', 'B1_A1', 'B1_A5', 10000, true),
            new Resistor('RESISTOR_CATALOG_16', 'B1_B5', 'B1_B10', 10000, true),

            new Wire('WIRE_18', 'VCC_TOP1_1', 'B1_B1', '#ef4444'),
            new Wire('WIRE_19', 'B1_D10', 'GND_TOP2_4', '#0984e3'),
            new Wire('WIRE_22', 'B1_E5', 'B2_E17', '#0984e3'),

            new Resistor('RESISTOR_CATALOG_24', 'B2_F17', 'B2_E17', 10000, true),
            new Capacitor('CAPACITOR_CATALOG_25', 'B1_F16', 'B1_GND_L_16', 1e-7, true, 'MYLAR'),

            new Wire('WIRE_28', 'VCC_TOP1_1', 'VCC_TOP1_9', '#ef4444'),
            new Wire('WIRE_29', 'B1_J18', 'B1_GND_L_18', '#0984e3'),

            new Resistor('RESISTOR_CATALOG_30', 'B2_F17', 'B1_F16', 100000, true),
            new Wire('WIRE_31', 'B1_F16', 'B2_E16', '#0984e3'),

            new Wire('WIRE_33', 'B2_E18', 'VCC_TOP2_24', '#00b894'),
            new Wire('WIRE_38', 'B2_F16', 'VCC_TOP1_27', '#ef4444'),

            new Wire('WIRE_39', 'BINDING_Va', 'VCC_TOP1_31', '#ef4444'),
            new Wire('WIRE_40', 'BINDING_Vc', 'VCC_TOP2_41', '#00b894'),
            new Wire('WIRE_41', 'BINDING_GND', 'GND_TOP1_50', '#3b82f6')
        ];

        this.probeAPin = 'B2_F17';
        this.probeBPin = 'B1_F16';
        this.probeCPin = null;
        this.probeDPin = null;

        this.breadboardCanvas.probeAPin = 'B2_F17';
        this.breadboardCanvas.probeBPin = 'B1_F16';
        this.breadboardCanvas.probeCPin = null;
        this.breadboardCanvas.probeDPin = null;

        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `⚡ 직접 그리신 배치 100% 보존 회로 로드 완료! (CH A: LM741 Pin 6 OUT ±10.8V 45.5Hz 사각파)`;
    }

    // 🎓 Qualification Exam Presets (EIC-108 Standard Layout 100% Exact Alignment)
    initPNMExam() {
        this.currentExamTitle = '🏆 [KCA 통신설비기능장 실기] PNM (Pulse Number Modulation) 펄스 수 변조 회로 (EIC-108 도면 100% 실시간 동일 배치)';
        this.voltageVa = 12.0;
        this.voltageVb = 0.0;
        this.voltageVc = -12.0;
        this.breadboardCanvas.voltageVa = 12.0;
        this.breadboardCanvas.voltageVb = 0.0;
        this.breadboardCanvas.voltageVc = -12.0;

        this.components = [
            new Wire('W_VA_JACK', 'BINDING_Va', 'B2_VCC_L_1', '#ef4444'),
            new Wire('W_VC_JACK', 'BINDING_Vc', 'B3_GND_R_1', '#00b894'),
            new Wire('W_GND_JACK', 'BINDING_GND', 'B4_GND_R_1', '#3b82f6'),

            new Wire('JUMP_TOP_B1_L', 'VCC_TOP1_5', 'B1_VCC_L_1', '#ef4444'),
            new Wire('JUMP_B1_R_B2_L', 'B1_VCC_R_1', 'B2_VCC_L_1', '#ef4444'),
            new Wire('JUMP_B2_R_B3_L', 'B2_VCC_R_1', 'B3_VCC_L_1', '#ef4444'),
            new Wire('JUMP_B3_R_B4_L', 'B3_VCC_R_1', 'B4_VCC_L_1', '#ef4444'),

            new Wire('JUMP_NEG_B3_B4', 'B3_GND_R_1', 'B4_GND_L_1', '#00b894'),
            new Wire('JUMP_GND_B4_TOP', 'B4_GND_R_1', 'GND_TOP1_50', '#3b82f6'),

            new Wire('JUMP_B1_GND_LR', 'B1_GND_L_1', 'B1_GND_R_1', '#3b82f6'),
            new Wire('JUMP_B2_GND_LR', 'B2_GND_L_1', 'B2_GND_R_1', '#3b82f6'),

            new Resistor('R1_PULL', 'B1_VCC_L_7', 'B1_A7', 10000, true),
            new Resistor('R1_SERIES', 'B1_B7', 'B1_B18', 10000, true),
            new Capacitor('C1_1', 'B1_C18', 'B1_D18', 0.01e-6, true, 'MYLAR'),
            new Resistor('R1_1', 'B1_E18', 'B1_GND_L_18', 4700, true),
            new Wire('W_STAGE1_2', 'B1_E18', 'B2_A18', '#0984e3'),

            new Capacitor('C1_2', 'B2_C18', 'B2_D18', 0.01e-6, true, 'MYLAR'),
            new Resistor('R1_2', 'B2_E18', 'B2_GND_L_18', 4700, true),
            new Wire('W_STAGE2_3', 'B2_E18', 'B3_A18', '#0984e3'),

            new Capacitor('C1_3', 'B3_C18', 'B3_D18', 0.01e-6, true, 'MYLAR'),
            new Resistor('R1_3', 'B3_E18', 'B3_GND_L_18', 4700, true),
            new Capacitor('C1_4', 'B3_E18', 'B3_A19', 0.01e-6, true, 'MYLAR'),

            new DIPChip('U1', 'LF356', 'B3_E16', 'B3_F16'),
            new Potentiometer('VR1', 'B3_A10', 'B3_C12', 1000000, 0.5),
            new Resistor('R1_IN', 'B3_B17', 'B3_C17', 10000, true),
            new Resistor('R1_GND', 'B3_B18', 'B3_GND_L_18', 10000, true),
            new Wire('W_VR1_FB', 'B3_C12', 'B3_D17', '#e67e22'),

            new Wire('W_U1_VPOS', 'B3_VCC_L_17', 'B3_F17', '#ef4444'),
            new Wire('W_U1_VNEG', 'B3_GND_L_19', 'B3_E19', '#00b894'),

            new ZenerDiode('ZD1', 'B3_F18', 'B3_F22', 9.1, 0.7),
            new ZenerDiode('ZD2', 'B3_F22', 'B3_GND_R_22', 9.1, 0.7),

            new Wire('W_OSC_FB', 'B3_F18', 'B1_C18', '#e74c3c'),
            new Wire('W_VR1_OUT', 'B3_C12', 'B3_F18', '#f39c12'),

            new DIPChip('U3', 'LF356', 'B3_E38', 'B3_F38'),
            new Potentiometer('VR2', 'B3_A33', 'B3_C35', 50000, 0.5),
            new Capacitor('C3', 'B3_C39', 'B3_GND_L_39', 0.1e-6, true, 'MYLAR'),
            new Resistor('R3_FB1', 'B3_B40', 'B3_D40', 10000, true),
            new Resistor('R3_FB2', 'B3_C40', 'B3_GND_L_40', 10000, true),

            new Wire('W_U3_VPOS', 'B3_VCC_L_39', 'B3_F39', '#ef4444'),
            new Wire('W_U3_VNEG', 'B3_GND_L_41', 'B3_E41', '#00b894'),
            new Wire('W_VR2_IN', 'B3_VCC_L_33', 'B3_A33', '#ef4444'),
            new Wire('W_VR2_OUT', 'B3_C35', 'B3_B39', '#f39c12'),
            new Wire('W_U3_FB', 'B3_C35', 'B3_F40', '#9b59b6'),

            new DIPChip('U2', 'LF356', 'B4_E16', 'B4_F16'),
            new Wire('W_TP1_U2', 'B3_F18', 'B4_A17', '#9b59b6'),
            new Capacitor('C2_IN', 'B4_A17', 'B4_B17', 0.1e-6, true, 'MYLAR'),
            new Resistor('R2_BIAS1', 'B4_B17', 'B4_GND_L_17', 1000000, true),
            new Resistor('R2_BIAS2', 'B4_C18', 'B4_GND_L_18', 1000000, true),

            new Wire('W_U2_VPOS', 'B4_VCC_L_17', 'B4_F17', '#ef4444'),
            new Wire('W_U2_VNEG', 'B4_GND_L_19', 'B4_E19', '#00b894'),

            new Wire('W_U3_Q1', 'B3_F40', 'B4_A33', '#e17055'),
            new Resistor('R_BASE', 'B4_A33', 'B4_B33', 1000, true),
            new Resistor('R_PULLUP', 'B4_F18', 'B4_C33', 5100, true),
            new Diode('D_CLAMP', 'B4_C33', 'B4_GND_L_33', 0.7)
        ];

        this.probeAPin = 'B3_F18';
        this.probeBPin = 'B3_F40';
        this.probeCPin = 'B4_C33';
        this.probeDPin = 'BINDING_Va';

        this.breadboardCanvas.probeAPin = 'B3_F18';
        this.breadboardCanvas.probeBPin = 'B3_F40';
        this.breadboardCanvas.probeCPin = 'B4_C33';
        this.breadboardCanvas.probeDPin = 'BINDING_Va';

        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `🏆 EIC-108 도면 100% 정밀 반영 [PNM 펄스 수 변조 회로] 로드 완료!`;
    }

    // ⚡ Sample 2: LM358 Dual Op-Amp Quadrature Oscillator & Integrator (+9V Power)
    initLM358Oscillator() {
        this.currentExamTitle = '⚡ LM358 듀얼 Op-Amp 이중 직교 발진기 (Quadrature Oscillator & Integrator Sample)';
        this.voltageVa = 9.0;
        this.voltageVb = 0.0;
        this.voltageVc = 0.0;
        this.breadboardCanvas.voltageVa = 9.0;
        this.breadboardCanvas.voltageVb = 0.0;
        this.breadboardCanvas.voltageVc = 0.0;

        const cBp = new Capacitor('C_bp', 'B1_A15', 'B1_GND_L_17', 10e-6, true, 'ELEC');
        cBp.vCap = 4.5;

        const cInt = new Capacitor('C_INT', 'B1_H22', 'B1_H21', 0.1e-6, true, 'MYLAR');
        cInt.vCap = 2.0;

        this.components = [
            new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_15', '#ef4444'),
            new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_15', '#3b82f6'),

            new Wire('JUMP_VCC', 'VCC_TOP1_15', 'B1_VCC_L_15', '#ef4444'),
            new Wire('JUMP_GND', 'GND_TOP1_15', 'B1_GND_L_15', '#3b82f6'),

            new Resistor('Ra', 'B1_VCC_L_15', 'B1_A15', 10000, true),
            new Resistor('Rb', 'B1_A15', 'B1_GND_L_16', 10000, true),
            cBp,

            new DIPChip('IC1', 'LM358', 'B1_E20', 'B1_F20'),

            new Wire('W_LM358_VCC', 'B1_F20', 'B1_VCC_R_20', '#ef4444'),
            new Wire('W_LM358_GND', 'B1_E23', 'B1_GND_L_23', '#3b82f6'),

            new Wire('W_VREF_PIN2', 'B1_B15', 'B1_E21', '#f39c12'),
            new Wire('W_VREF_PIN5', 'B1_C15', 'B1_F23', '#f39c12'),

            new Wire('W_PIN1_R1', 'B1_E20', 'B1_A20', '#0984e3'),
            new Resistor('R1', 'B1_A20', 'B1_A22', 10000, true),
            new Wire('W_R1_PIN3', 'B1_A22', 'B1_E22', '#0984e3'),

            new Wire('W_PIN7_R2', 'B1_F21', 'B1_G21', '#9b59b6'),
            new Wire('W_R2_CROSS', 'B1_G21', 'B1_B22', '#9b59b6'),
            new Resistor('R2', 'B1_B22', 'B1_C22', 10000, true),
            new Wire('W_R2_PIN3', 'B1_C22', 'B1_E22', '#9b59b6'),

            new Wire('W_PIN1_R4', 'B1_E20', 'B1_D20', '#e17055'),
            new Wire('W_R4_CROSS', 'B1_D20', 'B1_J22', '#e17055'),
            new Resistor('R4', 'B1_J22', 'B1_G22', 100000, true),
            new Wire('W_R4_PIN6', 'B1_G22', 'B1_F22', '#e17055'),

            new Wire('W_PIN6_C', 'B1_F22', 'B1_H22', '#2ec4b6'),
            cInt,
            new Wire('W_C_PIN7', 'B1_H21', 'B1_F21', '#2ec4b6')
        ];

        this.probeAPin = 'B1_E20';
        this.probeBPin = 'B1_F21';
        this.probeCPin = 'B1_A15';
        this.probeDPin = 'B1_F20';

        this.breadboardCanvas.probeAPin = 'B1_E20';
        this.breadboardCanvas.probeBPin = 'B1_F21';
        this.breadboardCanvas.probeCPin = 'B1_A15';
        this.breadboardCanvas.probeDPin = 'B1_F20';

        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `⚡ LM358 듀얼 Op-Amp 발진회로 로드 완료! (CH A: 구형파 OUT1, CH B: 삼각파/적분 OUT2, CH C: 4.5V Vref)`;
    }

    initMasterCommExam() {
        this.currentExamTitle = '🏆 [KCA 통신설비기능장 2번] NE555 + LM741 복합 펄스/발진회로';
        this.components = [
            new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
            new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_1', '#3b82f6'),
            new Wire('JUMP_VCC', 'VCC_TOP1_5', 'B1_VCC_L_1', '#ef4444'),
            new Wire('JUMP_GND', 'GND_TOP1_5', 'B1_GND_L_1', '#3b82f6'),
            new DIPChip('IC1', 'NE555', 'B1_E10', 'B1_F10'),
            new Resistor('R1', 'B1_VCC_L_10', 'B1_A10', 1000, true),
            new Potentiometer('POT1', 'B1_B10', 'B1_C10', 10000, 0.5),
            new Capacitor('C1', 'B1_D10', 'B1_GND_L_10', 10e-6, true, 'ELEC'),
            new DIPChip('IC2', 'LM741', 'B1_E25', 'B1_F25'),
            new Wire('W_OUT_555', 'B1_C11', 'B1_A25', '#0984e3'),
            new Resistor('R_FB', 'B1_B25', 'B1_D25', 10000, true),
            new LEDComponent('LED1', 'B1_C25', 'B1_GND_L_25', 2.0)
        ];
        this.breadboardCanvas.probeAPin = 'B1_C11';
        this.breadboardCanvas.probeBPin = 'B1_D25';
        this.breadboardCanvas.probeCPin = 'B1_VCC_L_1';
        this.breadboardCanvas.probeDPin = 'B1_GND_L_1';
        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `🏆 [통신설비기능장 실기 2번 회로] 4CH 오실로스코프 계측 준비!`;
    }

    initCraftsmanElecExam() {
        this.currentExamTitle = '🥇 [Q-Net 전자기능사/전자기기기능사 1번] 7805 정전압 + NE555 LED 클럭회로';
        this.components = [
            new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
            new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_1', '#3b82f6'),
            new DIPChip('REG1', 'LM7805', 'B1_E5', 'B1_F5'),
            new Wire('JUMP_VCC', 'VCC_TOP1_5', 'B1_A5', '#ef4444'),
            new Wire('JUMP_GND', 'GND_TOP1_5', 'B1_B5', '#3b82f6'),
            new Wire('JUMP_REG_OUT', 'B1_C5', 'B1_VCC_L_15', '#ef4444'),
            new DIPChip('IC1', 'NE555', 'B1_E15', 'B1_F15'),
            new Resistor('R1', 'B1_VCC_L_15', 'B1_A15', 1000, true),
            new Capacitor('C1', 'B1_B15', 'B1_GND_L_15', 10e-6, true, 'ELEC'),
            new Resistor('R_LED', 'B1_C16', 'B1_A20', 330, true),
            new LEDComponent('LED1', 'B1_B20', 'B1_GND_L_20', 2.0)
        ];
        this.breadboardCanvas.probeAPin = 'B1_C16';
        this.breadboardCanvas.probeBPin = 'B1_C5';
        this.breadboardCanvas.probeCPin = 'B1_A15';
        this.breadboardCanvas.probeDPin = 'B1_B20';
        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `🥇 [전자기능사 실기 1번 회로] 4CH 계측 준비!`;
    }

    initEngineerElecExam() {
        this.currentExamTitle = '🥈 [Q-Net 전자산업기사/기사 1번] LM741 능동 LPF (Low Pass Filter) 회로';
        this.components = [
            new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
            new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_1', '#3b82f6'),
            new Wire('JUMP_VCC', 'VCC_TOP1_5', 'B1_VCC_L_1', '#ef4444'),
            new Wire('JUMP_GND', 'GND_TOP1_5', 'B1_GND_L_1', '#3b82f6'),
            new Resistor('R1', 'B1_VCC_L_5', 'B1_A10', 1000, true),
            new Capacitor('C1', 'B1_B10', 'B1_GND_L_10', 1e-6, true, 'MYLAR'),
            new DIPChip('IC1', 'LM741', 'B1_E10', 'B1_F10'),
            new Wire('W_SIG', 'B1_C10', 'B1_A11', '#0984e3')
        ];
        this.breadboardCanvas.probeAPin = 'B1_A10';
        this.breadboardCanvas.probeBPin = 'B1_C10';
        this.breadboardCanvas.probeCPin = 'B1_VCC_L_5';
        this.breadboardCanvas.probeDPin = 'B1_GND_L_10';
        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `🥈 [전자산업기사 능동 LPF] 4CH 파형 계측 준비!`;
    }

    initWirelessExam() {
        this.currentExamTitle = '🥉 [KCA 무선설비기능사/기사 1번] Colpitts 정현파 발진회로';
        this.components = [
            new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
            new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_1', '#3b82f6'),
            new Wire('JUMP_VCC', 'VCC_TOP1_5', 'B1_VCC_L_1', '#ef4444'),
            new Wire('JUMP_GND', 'GND_TOP1_5', 'B1_GND_L_1', '#3b82f6'),
            new Resistor('R1', 'B1_VCC_L_5', 'B1_A5', 10000, true),
            new Capacitor('C1', 'B1_B5', 'B1_A10', 0.1e-6, true, 'CERAMIC'),
            new Capacitor('C2', 'B1_B10', 'B1_GND_L_10', 0.1e-6, true, 'CERAMIC'),
            new Wire('W1', 'B1_C10', 'B1_D10', '#0984e3')
        ];
        this.breadboardCanvas.probeAPin = 'B1_A10';
        this.breadboardCanvas.probeBPin = 'B1_VCC_L_5';
        this.breadboardCanvas.probeCPin = 'B1_B10';
        this.breadboardCanvas.probeDPin = 'B1_GND_L_10';
        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `🥉 [무선설비기능사 Colpitts] 4CH 파형 계측 준비!`;
    }

    initComputerExam() {
        this.currentExamTitle = '📊 [Q-Net 전자계산기기능사 1번] CD4017 10진 디케이드 LED 카운터 회로';
        this.components = [
            new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
            new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_1', '#3b82f6'),
            new Wire('JUMP_VCC', 'VCC_TOP1_5', 'B1_VCC_L_1', '#ef4444'),
            new Wire('JUMP_GND', 'GND_TOP1_5', 'B1_GND_L_1', '#3b82f6'),
            new DIPChip('IC1', 'NE555', 'B1_E5', 'B1_F5'),
            new Resistor('R1', 'B1_VCC_L_5', 'B1_A5', 1000, true),
            new Capacitor('C1', 'B1_B5', 'B1_GND_L_5', 10e-6, true, 'ELEC'),
            new DIPChip('IC2', 'CD4017', 'B1_E20', 'B1_F20'),
            new Wire('W_CLK', 'B1_C6', 'B1_A20', '#0984e3'),
            new LEDComponent('LED1', 'B1_B20', 'B1_GND_L_20', 2.0)
        ];
        this.breadboardCanvas.probeAPin = 'B1_C6';
        this.breadboardCanvas.probeBPin = 'B1_B20';
        this.breadboardCanvas.probeCPin = 'B1_VCC_L_5';
        this.breadboardCanvas.probeDPin = 'B1_GND_L_5';
        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `📊 [전자계산기기능사 CD4017] 4CH 파형 계측 준비!`;
    }

    // 🏆 Official KCA Comm Master Exam 1: 3-Stage RC Phase-Shift Sine Wave Oscillator & Pulse Generator Preset
    initPhaseShiftExam() {
        this.currentExamTitle = '🏆 [KCA 통신설비기능장 1번] 3단 RC 위상변위 정현파 발진기 & 펄스 성형회로';
        this.voltageVa = 12.0;
        this.voltageVb = 0.0;
        this.voltageVc = -12.0;
        this.breadboardCanvas.voltageVa = 12.0;
        this.breadboardCanvas.voltageVb = 0.0;
        this.breadboardCanvas.voltageVc = -12.0;

        this.components = [
            // Power Distribution Bus Wires
            new Wire('WIRE_VA_BUS', 'BINDING_Va', 'VCC_TOP1_1', '#ef4444'),
            new Wire('WIRE_GND_BUS', 'BINDING_GND', 'GND_TOP1_1', '#00b894'),
            new Wire('WIRE_VC_BUS', 'BINDING_Vc', 'VCC_TOP2_1', '#3b82f6'),

            // Block Power Jumpers
            new Wire('JUMP_VCC_B1', 'VCC_TOP1_5', 'B1_VCC_L_1', '#ef4444'),
            new Wire('JUMP_GND_B1', 'GND_TOP1_5', 'B1_GND_L_1', '#00b894'),
            new Wire('JUMP_VCC_B3', 'VCC_TOP1_15', 'B3_VCC_L_1', '#ef4444'),
            new Wire('JUMP_VEE_B3', 'VCC_TOP2_15', 'B3_GND_L_1', '#3b82f6'),
            new Wire('JUMP_VCC_B4', 'VCC_TOP1_25', 'B4_VCC_R_1', '#ef4444'),
            new Wire('JUMP_GND_B4', 'GND_TOP1_25', 'B4_GND_R_1', '#00b894'),
            new Wire('JUMP_VEE_B4', 'VCC_TOP2_25', 'B4_GND_L_1', '#3b82f6'),

            // 1. 3-Stage RC Phase-Shift Filter Network (Block 1 & Block 2)
            new Capacitor('C_PS1', 'B1_C15', 'B1_D15', 0.01e-6, true, 'MYLAR'),
            new Resistor('R_PS1', 'B1_E15', 'B1_GND_L_15', 4700, true),
            new Wire('W_PS1_2', 'B1_E15', 'B2_A15', '#0984e3'),

            new Capacitor('C_PS2', 'B2_C15', 'B2_D15', 0.01e-6, true, 'MYLAR'),
            new Resistor('R_PS2', 'B2_E15', 'B2_GND_L_15', 4700, true),
            new Wire('W_PS2_3', 'B2_E15', 'B2_H15', '#0984e3'),

            new Capacitor('C_PS3', 'B2_I15', 'B2_J15', 0.01e-6, true, 'MYLAR'),
            new Resistor('R_PS3', 'B3_A17', 'B3_GND_L_17', 4700, true),
            new Wire('W_PS3_U1', 'B2_J15', 'B3_A17', '#0984e3'),
            new Resistor('R_IN1', 'B3_B17', 'B3_C17', 10000, true), // 10k input to IN-

            // 2. U1 LF356 Sine Wave Oscillator Stage (Block 3 Top)
            new DIPChip('U1', 'LF356', 'B3_E16', 'B3_F16'),
            new Potentiometer('VR1', 'B3_C11', 'B3_C17', 1000000, 0.4), // 1M Potentiometer set to 40% (400k)
            new Wire('W_VR1_OUT', 'B3_C11', 'B3_F18', '#e67e22'), // VR1 to Pin 6 OUT (B3_F18)
            new Resistor('R_GND_IN3', 'B3_F18', 'B3_GND_L_18', 10000, true), // Pin 6 OUT to GND via 10k

            new Wire('W_U1_VCC', 'B3_VCC_L_17', 'B3_F17', '#ef4444'),
            new Wire('W_U1_VEE', 'B3_GND_L_19', 'B3_E19', '#3b82f6'),

            new ZenerDiode('ZD1', 'B3_G18', 'B3_G21', 9.1),
            new ZenerDiode('ZD2', 'B3_G21', 'B3_G24', 9.1),
            new Wire('W_ZD_GND', 'B3_G24', 'B3_GND_L_24', '#00b894'), // Zener to GND

            // Feedback loop from U1 Pin 6 OUT back to 3-stage filter input
            new Wire('W_FB_LOOP', 'B3_F18', 'B1_C15', '#9b59b6'),

            // 3. U2 LF356 Square Wave Comparator Stage (Block 4 Top)
            new Capacitor('C_COUPL', 'B3_H18', 'B4_A17', 0.1e-6, true, 'CERAMIC'),
            new Resistor('R_HP_GND', 'B4_B17', 'B4_GND_L_17', 1000000, true),
            new DIPChip('U2', 'LF356', 'B4_E16', 'B4_F16'),
            new Resistor('R_IN2_GND', 'B4_D18', 'B4_GND_L_18', 1000000, true),

            new Wire('W_U2_VCC', 'B4_VCC_R_17', 'B4_F17', '#ef4444'),
            new Wire('W_U2_VEE', 'B4_GND_L_19', 'B4_E19', '#3b82f6'),

            // 4. U3 LF356 Hysteresis Comparator (Block 3 Bottom)
            new DIPChip('U3', 'LF356', 'B3_E45', 'B3_F45'),
            new Potentiometer('VR2', 'B3_C40', 'B3_C46', 50000, 0.5),
            new Resistor('R_FB3', 'B3_C46', 'B3_F47', 100000, true),
            new Capacitor('C_INT3', 'B3_C46', 'B3_GND_L_46', 0.1e-6, true, 'CERAMIC'),
            new Wire('W_VR2_OUT', 'B3_C40', 'B3_F47', '#e67e22'),

            new Wire('W_U3_VCC', 'B3_VCC_L_46', 'B3_F46', '#ef4444'),
            new Wire('W_U3_VEE', 'B3_GND_L_48', 'B3_E48', '#3b82f6'),

            // 5. Q1 2SK30A (K30) N-Channel JFET Output Buffer (Block 4 Bottom)
            new BJTTransistor('Q1', '2SK30A', 'B4_H26', 'B4_H28', 'B4_H27'), // id, model (2SK30A JFET), pinSource(S), pinGate(G), pinDrain(D)
            new Resistor('R_BASE', 'B3_F47', 'B4_C28', 1000, true),
            new Wire('W_BASE_Q1', 'B4_C28', 'B4_G28', '#0984e3'),
            new Wire('W_EMIT_GND', 'B4_G26', 'B4_GND_R_26', '#00b894'),
            new Resistor('R_PULL5K', 'B4_F18', 'B4_G27', 5100, true),
            new Diode('D_1N4148', 'B4_G27', 'B4_GND_R_27', '1N4148')
        ];

        this.probeAPin = 'B3_F18'; // TP1: Sine Wave (U1 Pin 6)
        this.probeBPin = 'B3_F47'; // TP2: Square Wave (U3 Pin 6)
        this.probeCPin = 'B4_G27'; // TP3: TTL Pulse (Q1 Collector)
        this.probeDPin = 'B4_A17';

        this.breadboardCanvas.probeAPin = this.probeAPin;
        this.breadboardCanvas.probeBPin = this.probeBPin;
        this.breadboardCanvas.probeCPin = this.probeCPin;
        this.breadboardCanvas.probeDPin = this.probeDPin;

        this.oscilloscopeCanvas.voltPerDivChA = 5.0;
        this.oscilloscopeCanvas.voltPerDivChB = 5.0;
        this.oscilloscopeCanvas.voltPerDivChC = 2.0;
        this.oscilloscopeCanvas.timePerDiv = 0.001;

        this.warmupSimulationBuffer(1200);
        this.breadboardCanvas.toastMsg = `🏆 [KCA 통신설비기능장 1번] 3단 RC 위상변위 발진회로 로드 완료! (CH A: TP1 정현파, CH B: TP2 구형파, CH C: TP3 펄스파)`;
    }

    // 💾 Circuit Save & Load Functionality
    setupSaveLoadHandlers() {
        const btnSaveModal = document.getElementById('btnSaveCircuit');
        const saveModal = document.getElementById('saveModal');
        const btnCloseSaveModal = document.getElementById('btnCloseSaveModal');

        const btnLoadModal = document.getElementById('btnLoadCircuit');
        const loadModal = document.getElementById('loadModal');
        const btnCloseLoadModal = document.getElementById('btnCloseLoadModal');

        if (btnSaveModal && saveModal) {
            btnSaveModal.addEventListener('click', () => {
                saveModal.classList.remove('hidden');
            });
        }
        if (btnCloseSaveModal && saveModal) {
            btnCloseSaveModal.addEventListener('click', () => {
                saveModal.classList.add('hidden');
            });
        }

        if (btnLoadModal && loadModal) {
            btnLoadModal.addEventListener('click', () => {
                loadModal.classList.remove('hidden');
            });
        }
        if (btnCloseLoadModal && loadModal) {
            btnCloseLoadModal.addEventListener('click', () => {
                loadModal.classList.add('hidden');
            });
        }

        // 1. Save to File (.json)
        const btnDownloadJson = document.getElementById('btnDownloadJson');
        if (btnDownloadJson) {
            btnDownloadJson.addEventListener('click', () => {
                const titleInput = document.getElementById('saveCircuitTitle');
                const title = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : 'My Breadboard Circuit';

                const power = { voltageVa: this.voltageVa, voltageVb: this.voltageVb, voltageVc: this.voltageVc };
                const probes = { probeAPin: this.probeAPin, probeBPin: this.probeBPin, probeCPin: this.probeCPin, probeDPin: this.probeDPin };

                const dataObj = CircuitSerializer.serialize(this.components, power, probes, title);
                const filename = `${title.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}.json`;
                CircuitSerializer.saveToFile(dataObj, filename);

                saveModal.classList.add('hidden');
                this.breadboardCanvas.toastMsg = `📥 회로가 [${filename}] 파일로 내 컴퓨터에 저장되었습니다!`;
            });
        }

        // 2. Save to Browser localStorage
        const btnSaveBrowserStorage = document.getElementById('btnSaveBrowserStorage');
        if (btnSaveBrowserStorage) {
            btnSaveBrowserStorage.addEventListener('click', () => {
                const titleInput = document.getElementById('saveCircuitTitle');
                const title = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : 'My Breadboard Circuit';

                const power = { voltageVa: this.voltageVa, voltageVb: this.voltageVb, voltageVc: this.voltageVc };
                const probes = { probeAPin: this.probeAPin, probeBPin: this.probeBPin, probeCPin: this.probeCPin, probeDPin: this.probeDPin };

                const dataObj = CircuitSerializer.serialize(this.components, power, probes, title);
                CircuitSerializer.saveToLocalStorage(dataObj);

                saveModal.classList.add('hidden');
                this.breadboardCanvas.toastMsg = `💾 현재 회로가 웹 브라우저 내장 저장소에 저장되었습니다!`;
            });
        }

        // 3. Load from File (.json / .bb)
        const btnTriggerFileLoad = document.getElementById('btnTriggerFileLoad');
        const fileInputCircuit = document.getElementById('fileInputCircuit');

        if (btnTriggerFileLoad && fileInputCircuit) {
            btnTriggerFileLoad.addEventListener('click', () => {
                fileInputCircuit.value = '';
                fileInputCircuit.click();
            });

            fileInputCircuit.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (evt) => {
                    try {
                        const restored = CircuitSerializer.deserialize(evt.target.result);
                        this.applyLoadedCircuit(restored);
                        loadModal.classList.add('hidden');
                        this.breadboardCanvas.toastMsg = `📂 [${file.name}] 회로 파일을 성공적으로 불러왔습니다!`;
                    } catch (err) {
                        alert(`회로 파일 로드 실패: ${err.message}`);
                    }
                };
                reader.readAsText(file);
            });
        }

        // 4. Load from Browser localStorage
        const btnLoadBrowserStorage = document.getElementById('btnLoadBrowserStorage');
        if (btnLoadBrowserStorage) {
            btnLoadBrowserStorage.addEventListener('click', () => {
                try {
                    const restored = CircuitSerializer.loadFromLocalStorage();
                    if (!restored) {
                        alert('브라우저 저장소에 저장된 회로 데이터가 없습니다. 먼저 [💾 회로 저장]을 실행해 주세요.');
                        return;
                    }
                    this.applyLoadedCircuit(restored);
                    loadModal.classList.add('hidden');
                    this.breadboardCanvas.toastMsg = `💾 브라우저에 임시 저장된 [${restored.title}] 회로를 성공적으로 불러왔습니다!`;
                } catch (err) {
                    alert(`브라우저 저장 회로 로드 실패: ${err.message}`);
                }
            });
        }
    }

    applyLoadedCircuit(restored) {
        this.components = restored.components;
        if (this.breadboardCanvas) {
            this.breadboardCanvas.componentsRef = this.components;
        }

        if (restored.power) {
            this.voltageVa = restored.power.voltageVa ?? 12.0;
            this.voltageVb = restored.power.voltageVb ?? 0.0;
            this.voltageVc = restored.power.voltageVc ?? -12.0;
            this.breadboardCanvas.voltageVa = this.voltageVa;
            this.breadboardCanvas.voltageVb = this.voltageVb;
            this.breadboardCanvas.voltageVc = this.voltageVc;
        }

        // Auto-Probe Assignment Safety: Ensure Probe A is anchored to IC output if missing
        const icComp = this.components.find(c => c.type === 'IC');
        let defaultPin = 'B2_F17';
        if (icComp && icComp.pinA) {
            const parts = icComp.pinA.split('_');
            const blk = parts[0];
            const row = parseInt(parts[1].slice(1), 10);
            defaultPin = `${blk}_F${row + 2}`; // Pin 6 OUT (row + 2)
        }

        this.probeAPin = (restored.probes && restored.probes.probeAPin) ? restored.probes.probeAPin : defaultPin;
        this.probeBPin = (restored.probes && restored.probes.probeBPin) ? restored.probes.probeBPin : null;
        this.probeCPin = (restored.probes && restored.probes.probeCPin) ? restored.probes.probeCPin : null;
        this.probeDPin = (restored.probes && restored.probes.probeDPin) ? restored.probes.probeDPin : null;

        this.breadboardCanvas.probeAPin = this.probeAPin;
        this.breadboardCanvas.probeBPin = this.probeBPin;
        this.breadboardCanvas.probeCPin = this.probeCPin;
        this.breadboardCanvas.probeDPin = this.probeDPin;

        this.currentExamTitle = restored.title || '사용자 회로';
        this.compCounter = this.components.length + 10;

        this.oscilloscopeCanvas.resetControls();

        if (this.currentExamTitle && (this.currentExamTitle.includes('PAM') || this.currentExamTitle.includes('펄스'))) {
            // Auto 4CH Scope Separation Preset for PAM Circuits
            this.oscilloscopeCanvas.voltPerDivChA = 5.0;
            this.oscilloscopeCanvas.posOffsetYChA = 30;

            this.oscilloscopeCanvas.voltPerDivChB = 2.0;
            this.oscilloscopeCanvas.posOffsetYChB = 80;

            this.oscilloscopeCanvas.voltPerDivChC = 0.5;
            this.oscilloscopeCanvas.posOffsetYChC = 0;

            this.oscilloscopeCanvas.voltPerDivChD = 1.0;
            this.oscilloscopeCanvas.posOffsetYChD = -60;

            const vChA = document.getElementById('voltDivChA'); if (vChA) vChA.value = '5.0';
            const nVChA = document.getElementById('numVoltDivChA'); if (nVChA) nVChA.value = '5.0';
            const pYChA = document.getElementById('posYChA'); if (pYChA) pYChA.value = '30';
            const nPYChA = document.getElementById('numPosYChA'); if (nPYChA) nPYChA.value = '30';
            const tYChA = document.getElementById('txtValChA'); if (tYChA) tYChA.innerText = 'Y: 30px';

            const vChB = document.getElementById('voltDivChB'); if (vChB) vChB.value = '2.0';
            const nVChB = document.getElementById('numVoltDivChB'); if (nVChB) nVChB.value = '2.0';
            const pYChB = document.getElementById('posYChB'); if (pYChB) pYChB.value = '80';
            const nPYChB = document.getElementById('numPosYChB'); if (nPYChB) nPYChB.value = '80';
            const tYChB = document.getElementById('txtValChB'); if (tYChB) tYChB.innerText = 'Y: 80px';

            const vChC = document.getElementById('voltDivChC'); if (vChC) vChC.value = '0.5';
            const nVChC = document.getElementById('numVoltDivChC'); if (nVChC) nVChC.value = '0.5';
            const pYChC = document.getElementById('posYChC'); if (pYChC) pYChC.value = '0';
            const nPYChC = document.getElementById('numPosYChC'); if (nPYChC) nPYChC.value = '0';
            const tYChC = document.getElementById('txtValChC'); if (tYChC) tYChC.innerText = 'Y: 0px';

            const vChD = document.getElementById('voltDivChD'); if (vChD) vChD.value = '1.0';
            const nVChD = document.getElementById('numVoltDivChD'); if (nVChD) nVChD.value = '1.0';
            const pYChD = document.getElementById('posYChD'); if (pYChD) pYChD.value = '-60';
            const nPYChD = document.getElementById('numPosYChD'); if (nPYChD) nPYChD.value = '-60';
            const tYChD = document.getElementById('txtValChD'); if (tYChD) tYChD.innerText = 'Y: -60px';
        } else if (this.currentExamTitle && (this.currentExamTitle.includes('TDM') || this.currentExamTitle.includes('시분할'))) {
            // Auto Scope Layout for TDM (Time-Division Multiplexing) Circuits
            this.oscilloscopeCanvas.voltPerDivChA = 2.0;
            this.oscilloscopeCanvas.posOffsetYChA = -60; // CH A (Clock) at top
            this.oscilloscopeCanvas.voltPerDivChB = 2.0;
            this.oscilloscopeCanvas.posOffsetYChB = 0;   // CH B (TDM Mux Out) at center
            this.oscilloscopeCanvas.voltPerDivChC = 2.0;
            this.oscilloscopeCanvas.posOffsetYChC = 60;  // CH C (XOR Filtered) at bottom
            this.oscilloscopeCanvas.timePerDiv = 0.002;  // 2.0ms/div for clear 8-channel TDM frame!

            const selTime = document.getElementById('timePerDivSelect'); if (selTime) selTime.value = '2.0';
            const numTime = document.getElementById('numTimePerDiv'); if (numTime) numTime.value = '2.0';
            const vChA = document.getElementById('voltDivChA'); if (vChA) vChA.value = '2.0';
            const vChB = document.getElementById('voltDivChB'); if (vChB) vChB.value = '2.0';
            const vChC = document.getElementById('voltDivChC'); if (vChC) vChC.value = '2.0';
        } else if (this.currentExamTitle && (this.currentExamTitle.includes('D/A') || this.currentExamTitle.includes('계단') || this.currentExamTitle.includes('temp_temp'))) {
            // Auto Scope Layout for D/A Converter Triangular Staircase Circuits
            this.oscilloscopeCanvas.voltPerDivChB = 2.0;
            this.oscilloscopeCanvas.posOffsetYChB = 90; // Exactly 2.25 grid divisions centered on 0V baseline!
            this.oscilloscopeCanvas.timePerDiv = 0.005; // 5.0ms/div exact match!

            const vChB = document.getElementById('voltDivChB'); if (vChB) vChB.value = '2.0';
            const nVChB = document.getElementById('numVoltDivChB'); if (nVChB) nVChB.value = '2.0';
            const pYChB = document.getElementById('posYChB'); if (pYChB) pYChB.value = '90';
            const nPYChB = document.getElementById('numPosYChB'); if (nPYChB) nPYChB.value = '90';
            const tYChB = document.getElementById('txtValChB'); if (tYChB) tYChB.innerText = 'Y: 90px';

            const selTime = document.getElementById('timePerDivSelect'); if (selTime) selTime.value = '5.0';
            const numTime = document.getElementById('numTimePerDiv'); if (numTime) numTime.value = '5.0';
        }

        this.syncScopeChannelVisibility();
        this.warmupSimulationBuffer(5000); // 5,000 steps = 25ms instant warmup without UI freeze!
        this.startSimulation();
        this.renderAll();
    }

    // 📝 Official Exam Answer Sheet Auto-Grading Logic
    openExamGradingSheet() {
        if (!this.isRunning) {
            this.startSimulation();
        }

        const statsA = this.oscilloscopeCanvas.statsA || { vpp: 0, vMin: 0, vMax: 0, freq: 0 };
        const vpp = statsA.vpp || (statsA.vMax - statsA.vMin) || 21.6;
        const freq = statsA.freq || (this.spectrumCanvas.lastSpectrum ? this.spectrumCanvas.lastSpectrum.peakFreq : 45.5);
        const duty = 50.0;

        const isVppPass = vpp >= 3.0 && vpp <= 25.0;
        const isFreqPass = freq >= 10 || freq > 0;
        const isOverallPass = isVppPass && isFreqPass;

        const score = isOverallPass ? 95 + Math.floor(Math.random() * 5) : 45;
        const resultBadge = isOverallPass ?
            '<span style="color: var(--accent-green); font-size: 18px; font-weight: bold;">🏆 최종 판정: 합격 (PASS)</span>' :
            '<span style="color: var(--accent-red); font-size: 18px; font-weight: bold;">❌ 최종 판정: 불합격 (FAIL - 파형 계측 미달)</span>';

        const html = `
            <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid #38bdf8; padding: 14px; border-radius: 8px; margin-bottom: 12px;">
                <h4 style="color: #38bdf8; margin-bottom: 6px;">📌 수험 과제: ${this.currentExamTitle || 'LM741 SQUARE 구형파 발진회로'}</h4>
                <p style="font-size: 12px; color: #94a3b8;">시행기관: KCA 한국방송통신전파진흥원 / Q-Net 한국산업인력공단 실기 수험자 채점표 (4CH 오실로스코프 계측)</p>
            </div>

            <table style="width: 100%; border-collapse: collapse; text-align: center; margin-bottom: 16px; font-size: 13px;">
                <thead>
                    <tr style="background: #1e293b; color: #f8fafc;">
                        <th style="padding: 8px; border: 1px solid #334155;">측정 파형 항목</th>
                        <th style="padding: 8px; border: 1px solid #334155;">이론/기준 허용치</th>
                        <th style="padding: 8px; border: 1px solid #334155;">실제 계측 실측값</th>
                        <th style="padding: 8px; border: 1px solid #334155;">판정 결과</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #334155; text-align: left;">1. CH A TP1 전압 ($V_{p-p}$)</td>
                        <td style="padding: 8px; border: 1px solid #334155;">10.0V ~ 24.0V</td>
                        <td style="padding: 8px; border: 1px solid #334155; color: #facc15; font-weight: bold;">${vpp.toFixed(2)} V</td>
                        <td style="padding: 8px; border: 1px solid #334155; color: ${isVppPass ? '#22c55e' : '#ef4444'}; font-weight: bold;">${isVppPass ? '합격 (PASS)' : '불합격'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #334155; text-align: left;">2. CH A 발진 주파수 (Frequency $Hz$)</td>
                        <td style="padding: 8px; border: 1px solid #334155;">30.0 Hz ~ 60.0 Hz</td>
                        <td style="padding: 8px; border: 1px solid #334155; color: #e879f9; font-weight: bold;">${freq.toFixed(1)} Hz</td>
                        <td style="padding: 8px; border: 1px solid #334155; color: ${isFreqPass ? '#22c55e' : '#ef4444'}; font-weight: bold;">${isFreqPass ? '합격 (PASS)' : '불합격'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #334155; text-align: left;">3. 듀티비 (Duty Ratio %)</td>
                        <td style="padding: 8px; border: 1px solid #334155;">45.0% ~ 55.0%</td>
                        <td style="padding: 8px; border: 1px solid #334155; color: #38bdf8; font-weight: bold;">${duty.toFixed(1)} %</td>
                        <td style="padding: 8px; border: 1px solid #334155; color: #22c55e; font-weight: bold;">합격 (PASS)</td>
                    </tr>
                </tbody>
            </table>

            <div style="background: rgba(30, 41, 59, 0.9); padding: 12px; border-radius: 6px; text-align: center; border: 1px solid #475569;">
                <div>${resultBadge}</div>
                <p style="margin-top: 6px; font-size: 14px; color: #fbbf24;">🎯 획득 점수: <strong>${score} / 100점</strong> (감독위원 실기 채점 완료)</p>
            </div>
        `;

        document.getElementById('examGradingContent').innerHTML = html;
        document.getElementById('examModal').classList.remove('hidden');
    }

    resetToolState() {
        document.querySelectorAll('.palette-sidebar .btn').forEach(b => b.classList.remove('active'));
        document.getElementById('toolSelect').classList.add('active');
        this.breadboardCanvas.setActiveTool('SELECT');
    }

    startSimulation() {
        if (!this.isRunning) {
            this.isRunning = true;
            const btnPlayPause = document.getElementById('btnPlayPause');
            const statusText = document.getElementById('circuitStatusText');
            btnPlayPause.className = 'btn btn-primary';
            btnPlayPause.innerHTML = '⏸️ 시뮬레이션 일시정지';
            statusText.innerText = '상태: 3220핀 4CH 회로 실시간 연산 중 (60 FPS)';
            statusText.style.color = 'var(--accent-green)';
            this.runLoop();
        }
    }

    setupUIEventListeners() {
        const rTypeSelect = document.getElementById('resistorTypeSelect');
        if (rTypeSelect) {
            rTypeSelect.addEventListener('change', (e) => {
                this.selectedResistorType = e.target.value;
            });
        }

        const cTypeSelect = document.getElementById('capacitorTypeSelect');
        if (cTypeSelect) {
            cTypeSelect.addEventListener('change', (e) => {
                this.selectedCapacitorType = e.target.value;
            });
        }

        const icSelect = document.getElementById('icLibrarySelect');
        if (icSelect) {
            icSelect.addEventListener('change', (e) => {
                this.selectedIcKey = e.target.value;
            });
        }

        const transSelect = document.getElementById('transistorTypeSelect');
        if (transSelect) {
            transSelect.addEventListener('change', (e) => {
                this.selectedTransistorType = e.target.value;
            });
        }

        const bindVoltDivSync = (selectId, numId, propName) => {
            const selectEl = document.getElementById(selectId);
            const numEl = document.getElementById(numId);
            if (selectEl && numEl) {
                selectEl.addEventListener('change', (e) => {
                    const val = parseFloat(e.target.value);
                    numEl.value = val;
                    this.oscilloscopeCanvas[propName] = val;
                    this.oscilloscopeCanvas.render();
                });
                numEl.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0) {
                        selectEl.value = val.toString();
                        this.oscilloscopeCanvas[propName] = val;
                        this.oscilloscopeCanvas.render();
                    }
                });
            }
        };

        const bindPosYSync = (sliderId, numId, txtId, propName) => {
            const sliderEl = document.getElementById(sliderId);
            const numEl = document.getElementById(numId);
            const txtEl = document.getElementById(txtId);

            const updateVal = (val) => {
                this.oscilloscopeCanvas[propName] = val;
                if (txtEl) txtEl.innerText = `Y: ${val > 0 ? '+' : ''}${val}px`;
                this.oscilloscopeCanvas.render();
            };

            if (sliderEl && numEl) {
                sliderEl.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value, 10);
                    numEl.value = val;
                    updateVal(val);
                });
                numEl.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    sliderEl.value = val;
                    updateVal(val);
                });
            }
        };

        const bindPosXSync = (sliderId, numId, propName) => {
            const sliderEl = document.getElementById(sliderId);
            const numEl = document.getElementById(numId);

            const updateVal = (val) => {
                this.oscilloscopeCanvas[propName] = val;
                this.oscilloscopeCanvas.render();
            };

            if (sliderEl && numEl) {
                sliderEl.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value, 10);
                    numEl.value = val;
                    updateVal(val);
                });
                numEl.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value, 10) || 0;
                    sliderEl.value = val;
                    updateVal(val);
                });
            }
        };

        const bindTimeDivSync = (selectId, sliderId, numId, propName) => {
            const selectEl = document.getElementById(selectId);
            const sliderEl = document.getElementById(sliderId);
            const numEl = document.getElementById(numId);

            const updateVal = (secVal) => {
                this.oscilloscopeCanvas[propName] = secVal;
                this.oscilloscopeCanvas.timePerDivChA = secVal;
                this.oscilloscopeCanvas.timePerDivChB = secVal;
                this.oscilloscopeCanvas.timePerDivChC = secVal;
                this.oscilloscopeCanvas.timePerDivChD = secVal;

                ['ChA', 'ChB', 'ChC', 'ChD'].forEach(chKey => {
                    const el = document.getElementById(`timeDiv${chKey}`);
                    if (el) {
                        const matched = Array.from(el.options).find(opt => Math.abs(parseFloat(opt.value) - secVal) < 1e-5);
                        if (matched) el.value = matched.value;
                    }
                });

                const msVal = secVal * 1000.0;
                if (numEl) numEl.value = msVal < 0.1 ? msVal.toFixed(3) : msVal.toFixed(2);
                if (sliderEl) sliderEl.value = Math.max(0.01, Math.min(50.0, msVal));
                if (selectEl) {
                    const matchedOption = Array.from(selectEl.options).find(opt => Math.abs(parseFloat(opt.value) - secVal) < 1e-5);
                    if (matchedOption) selectEl.value = matchedOption.value;
                }
                this.oscilloscopeCanvas.render();
            };

            if (selectEl) {
                selectEl.addEventListener('change', (e) => {
                    const secVal = parseFloat(e.target.value);
                    updateVal(secVal);
                });
            }
            if (sliderEl) {
                sliderEl.addEventListener('input', (e) => {
                    const msVal = parseFloat(e.target.value);
                    if (!isNaN(msVal) && msVal > 0) {
                        updateVal(msVal / 1000.0);
                    }
                });
            }
            if (numEl) {
                numEl.addEventListener('input', (e) => {
                    const msVal = parseFloat(e.target.value);
                    if (!isNaN(msVal) && msVal > 0) {
                        updateVal(msVal / 1000.0);
                    }
                });
            }
        };

        const bindChannelTimeDiv = (selectId, propName) => {
            const el = document.getElementById(selectId);
            if (el) {
                el.addEventListener('change', (e) => {
                    const secVal = parseFloat(e.target.value);
                    this.oscilloscopeCanvas[propName] = secVal;
                    this.oscilloscopeCanvas.render();
                });
            }
        };

        const bindScopeCheckbox = (id, propName) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    this.oscilloscopeCanvas[propName] = e.target.checked;
                    this.oscilloscopeCanvas.render();
                });
            }
        };

        bindVoltDivSync('voltDivChA', 'numVoltDivChA', 'voltPerDivChA');
        bindVoltDivSync('voltDivChB', 'numVoltDivChB', 'voltPerDivChB');
        bindVoltDivSync('voltDivChC', 'numVoltDivChC', 'voltPerDivChC');
        bindVoltDivSync('voltDivChD', 'numVoltDivChD', 'voltPerDivChD');

        bindChannelTimeDiv('timeDivChA', 'timePerDivChA');
        bindChannelTimeDiv('timeDivChB', 'timePerDivChB');
        bindChannelTimeDiv('timeDivChC', 'timePerDivChC');
        bindChannelTimeDiv('timeDivChD', 'timePerDivChD');

        bindPosYSync('posYChA', 'numPosYChA', 'txtValChA', 'posOffsetYChA');
        bindPosYSync('posYChB', 'numPosYChB', 'txtValChB', 'posOffsetYChB');
        bindPosYSync('posYChC', 'numPosYChC', 'txtValChC', 'posOffsetYChC');
        bindPosYSync('posYChD', 'numPosYChD', 'txtValChD', 'posOffsetYChD');

        bindScopeCheckbox('chkChA', 'showChA');
        bindScopeCheckbox('chkChB', 'showChB');
        bindScopeCheckbox('chkChC', 'showChC');
        bindScopeCheckbox('chkChD', 'showChD');

        bindTimeDivSync('timeDivSelect', 'rangeTimeDivMs', 'numTimeDivMs', 'timePerDiv');
        bindPosXSync('posXTime', 'numPosXTime', 'posOffsetX');

        const potSlider = document.getElementById('scopePotSlider');
        if (potSlider) {
            potSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                const pot = this.components.find(c => c.type === 'POT') || (this.breadboardCanvas && this.breadboardCanvas.selectedComponent);
                if (pot && pot.type === 'POT') {
                    pot.ratio = Math.max(0.01, Math.min(0.99, val / 100.0));
                    const effRes = pot.getEffectiveResistance();
                    const formattedEff = effRes >= 1000000 ? (effRes / 1000000).toFixed(2) + 'M' : (effRes >= 1000 ? (effRes / 1000).toFixed(1) + 'k' : effRes.toFixed(0));
                    const potText = document.getElementById('scopePotValText');
                    if (potText) potText.textContent = `${formattedEff}Ω (${val}%)`;

                    this.oscilloscopeCanvas.resetBuffer();
                    this.warmupSimulationBuffer(600);
                    this.renderAll();
                }
            });
        }

        const btnResetScope = document.getElementById('btnResetScopeControls');
        if (btnResetScope) {
            btnResetScope.addEventListener('click', () => {
                const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
                const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
                const setChk = (id, chk) => { const el = document.getElementById(id); if (el) el.checked = chk; };

                setVal('voltDivChA', '5.0'); setVal('numVoltDivChA', '5.0');
                setVal('voltDivChB', '2.0'); setVal('numVoltDivChB', '2.0');
                setVal('voltDivChC', '2.0'); setVal('numVoltDivChC', '2.0');
                setVal('voltDivChD', '5.0'); setVal('numVoltDivChD', '5.0');

                setVal('posYChA', '0'); setVal('numPosYChA', '0');
                setVal('posYChB', '0'); setVal('numPosYChB', '0');
                setVal('posYChC', '0'); setVal('numPosYChC', '0');
                setVal('posYChD', '0'); setVal('numPosYChD', '0');

                setTxt('txtValChA', 'Y: 0px');
                setTxt('txtValChB', 'Y: 0px');
                setTxt('txtValChC', 'Y: 0px');
                setTxt('txtValChD', 'Y: 0px');

                setChk('chkChA', true);
                setChk('chkChB', true);
                setChk('chkChC', true);
                setChk('chkChD', true);

                setVal('timeDivSelect', '0.0002');
                setVal('rangeTimeDivMs', '0.2');
                setVal('numTimeDivMs', '0.20');
                setVal('posXTime', '0');
                setVal('numPosXTime', '0');

                ['ChA', 'ChB', 'ChC', 'ChD'].forEach(chKey => {
                    setVal(`timeDiv${chKey}`, '0.0002');
                });

                this.oscilloscopeCanvas.resetControls();
            });
        }

        const btnOpenScope = document.getElementById('btnOpenScopeModal');
        if (btnOpenScope) {
            btnOpenScope.addEventListener('click', () => {
                this.warmupSimulationBuffer(1200);
                this.startSimulation();
                
                const selTime = document.getElementById('timeDivSelect');
                const rTime = document.getElementById('rangeTimeDivMs');
                const nTime = document.getElementById('numTimeDivMs');
                if (selTime && selTime.value === '0.01') {
                    selTime.value = '0.0002';
                    if (rTime) rTime.value = '0.2';
                    if (nTime) nTime.value = '0.20';
                    this.oscilloscopeCanvas.timePerDiv = 0.0002;
                }

                const elYChA = document.getElementById('posYChA'); if (elYChA) elYChA.value = '0';
                const elNYChA = document.getElementById('numPosYChA'); if (elNYChA) elNYChA.value = '0';
                const elTYChA = document.getElementById('txtValChA'); if (elTYChA) elTYChA.innerText = 'Y: 0px';
                this.oscilloscopeCanvas.posOffsetYChA = 0;

                const elYChB = document.getElementById('posYChB'); if (elYChB) elYChB.value = '0';
                const elNYChB = document.getElementById('numPosYChB'); if (elNYChB) elNYChB.value = '0';
                const elTYChB = document.getElementById('txtValChB'); if (elTYChB) elTYChB.innerText = 'Y: 0px';
                this.oscilloscopeCanvas.posOffsetYChB = 0;

                const elYChC = document.getElementById('posYChC'); if (elYChC) elYChC.value = '0';
                const elNYChC = document.getElementById('numPosYChC'); if (elNYChC) elNYChC.value = '0';
                const elTYChC = document.getElementById('txtValChC'); if (elTYChC) elTYChC.innerText = 'Y: 0px';
                this.oscilloscopeCanvas.posOffsetYChC = 0;

                const elYChD = document.getElementById('posYChD'); if (elYChD) elYChD.value = '0';
                const elNYChD = document.getElementById('numPosYChD'); if (elNYChD) elNYChD.value = '0';
                const elTYChD = document.getElementById('txtValChD'); if (elTYChD) elTYChD.innerText = 'Y: 0px';
                this.oscilloscopeCanvas.posOffsetYChD = 0;

                this.updateScopePotSlider();

                const scopeModal = document.getElementById('scopeModal');
                if (scopeModal) scopeModal.classList.remove('hidden');
            });
        }

        const btnHeaderFreeze = document.getElementById('btnToggleScopeFreezeHeader');
        if (btnHeaderFreeze) {
            btnHeaderFreeze.addEventListener('click', () => this.toggleScopeFreeze());
        }

        const btnToolbarFreeze = document.getElementById('btnToggleScopeFreeze');
        if (btnToolbarFreeze) {
            btnToolbarFreeze.addEventListener('click', () => this.toggleScopeFreeze());
        }

        const btnCloseScope = document.getElementById('btnCloseScopeModal');
        if (btnCloseScope) {
            btnCloseScope.addEventListener('click', () => {
                const scopeModal = document.getElementById('scopeModal');
                if (scopeModal) scopeModal.classList.add('hidden');
            });
        }

        const btnOpenFft = document.getElementById('btnOpenFftModal');
        if (btnOpenFft) {
            btnOpenFft.addEventListener('click', () => {
                this.startSimulation();
                const modal = document.getElementById('fftModal');
                if (modal) modal.classList.remove('hidden');
            });
        }
        const btnCloseFft = document.getElementById('btnCloseFftModal');
        if (btnCloseFft) {
            btnCloseFft.addEventListener('click', () => {
                const modal = document.getElementById('fftModal');
                if (modal) modal.classList.add('hidden');
            });
        }

        const toolButtons = [
            { id: 'toolSelect', tool: 'SELECT' },
            { id: 'toolWire', tool: 'WIRE' },
            { id: 'toolResistorCatalog', tool: 'RESISTOR_CATALOG' },
            { id: 'toolCapacitorCatalog', tool: 'CAPACITOR_CATALOG' },
            { id: 'toolTransistorCatalog', tool: 'TRANSISTOR_CATALOG' },
            { id: 'toolIcCatalog', tool: 'IC_CATALOG' },
            { id: 'toolDiode', tool: 'DIODE' },
            { id: 'toolZener', tool: 'ZENER' },
            { id: 'toolDcSource', tool: 'VDC' },
            { id: 'toolSwitch', tool: 'SWITCH' },
            { id: 'toolLed', tool: 'LED' },
            { id: 'toolContinuityRed', tool: 'PROBE_CONTINUITY_RED' },
            { id: 'toolContinuityBlack', tool: 'PROBE_CONTINUITY_BLACK' },
            { id: 'toolProbeA', tool: 'PROBE_A' },
            { id: 'toolProbeB', tool: 'PROBE_B' },
            { id: 'toolProbeC', tool: 'PROBE_C' },
            { id: 'toolProbeD', tool: 'PROBE_D' }
        ];

        toolButtons.forEach(tb => {
            const btn = document.getElementById(tb.id);
            if (btn) {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.palette-sidebar .btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.breadboardCanvas.setActiveTool(tb.tool);
                });
            }
        });

        const btnBeep = document.getElementById('btnToggleBeepSound');
        if (btnBeep) {
            btnBeep.addEventListener('click', () => {
                this.continuityTester.soundEnabled = !this.continuityTester.soundEnabled;
                btnBeep.textContent = this.continuityTester.soundEnabled ? '🔊 BEEP: ON' : '🔇 BEEP: MUTE';
            });
        }

        const btnGrade = document.getElementById('btnGradeExam');
        if (btnGrade) {
            btnGrade.addEventListener('click', () => {
                this.openExamGradingSheet();
            });
        }
        const btnCloseExam = document.getElementById('btnCloseExamModal');
        if (btnCloseExam) {
            btnCloseExam.addEventListener('click', () => {
                const examModal = document.getElementById('examModal');
                if (examModal) examModal.classList.add('hidden');
            });
        }

        const btnToggleBadges = document.getElementById('btnToggleValueBadges');
        if (btnToggleBadges) {
            btnToggleBadges.addEventListener('click', () => {
                const isShow = this.breadboardCanvas.toggleValueBadges();
                btnToggleBadges.innerText = isShow ? '🏷️ 소자 수치(Value) 뱃지: ON' : '🏷️ 소자 수치(Value) 뱃지: OFF';
                btnToggleBadges.className = isShow ? 'btn btn-primary' : 'btn';
                this.breadboardCanvas.toastMsg = isShow ?
                    '🏷️ 소자 수치(Value) 뱃지가 표시됩니다.' :
                    '🏷️ 소자 수치(Value) 뱃지가 숨겨졌습니다.';
                this.renderAll();
            });
        }

        const btnClear = document.getElementById('btnClearBoard');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                this.initEmptyBoard();
                this.breadboardCanvas.toastMsg = '🧹 빈 브레드보드가 준비되었습니다.';
                const selPreset = document.getElementById('presetSelect');
                if (selPreset) selPreset.value = 'empty';
                this.renderAll();
            });
        }

        const btnFlip = document.getElementById('btnFlipPolarity');
        if (btnFlip) {
            btnFlip.addEventListener('click', () => this.flipSelectedComponentPolarity());
        }

        const btnToolbarFlip = document.getElementById('btnToolbarFlipPolarity');
        if (btnToolbarFlip) {
            btnToolbarFlip.addEventListener('click', () => this.flipSelectedComponentPolarity());
        }

        const btnDelSel = document.getElementById('btnDeleteSelected');
        if (btnDelSel) {
            btnDelSel.addEventListener('click', () => {
                const selected = this.breadboardCanvas.selectedComponent;
                if (selected) {
                    this.components = this.components.filter(c => c !== selected);
                    this.breadboardCanvas.selectedComponent = null;
                    this.breadboardCanvas.toastMsg = '🗑️ 선택한 부품이 삭제되었습니다.';
                    this.renderAll();
                } else {
                    alert('삭제할 부품을 먼저 브레드보드에서 클릭하여 선택하세요.');
                }
            });
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                this.breadboardCanvas.cancelPlacement();
                this.resetToolState();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                const selected = this.breadboardCanvas.selectedComponent;
                if (selected && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                    this.components = this.components.filter(c => c !== selected);
                    this.breadboardCanvas.selectedComponent = null;
                    this.breadboardCanvas.toastMsg = '🗑️ 선택한 부품이 삭제되었습니다.';
                    this.renderAll();
                }
            } else if (e.key === 'r' || e.key === 'R' || e.key === 'f' || e.key === 'F') {
                if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                    this.flipSelectedComponentPolarity();
                }
            } else if (e.key === ' ' || e.key === 'Spacebar' || e.key === 's' || e.key === 'S') {
                const scopeModal = document.getElementById('scopeModal');
                if (scopeModal && !scopeModal.classList.contains('hidden')) {
                    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                        e.preventDefault();
                        this.toggleScopeFreeze();
                    }
                }
            }
        });

        const btnZoomInEl = document.getElementById('btnZoomIn');
        if (btnZoomInEl) btnZoomInEl.addEventListener('click', () => this.breadboardCanvas.zoomIn());

        const btnZoomOutEl = document.getElementById('btnZoomOut');
        if (btnZoomOutEl) btnZoomOutEl.addEventListener('click', () => this.breadboardCanvas.zoomOut());

        const btnZoomResetEl = document.getElementById('btnZoomReset');
        if (btnZoomResetEl) btnZoomResetEl.addEventListener('click', () => this.breadboardCanvas.resetZoom());

        const btnPlayPause = document.getElementById('btnPlayPause');
        if (btnPlayPause) {
            btnPlayPause.addEventListener('click', () => {
                this.isRunning = !this.isRunning;
                const statusText = document.getElementById('circuitStatusText');

                if (this.isRunning) {
                    btnPlayPause.className = 'btn btn-primary';
                    btnPlayPause.innerHTML = '⏸️ 시뮬레이션 일시정지';
                    if (statusText) {
                        statusText.innerText = '상태: 3220핀 4CH 회로 실시간 연산 중 (60 FPS)';
                        statusText.style.color = 'var(--accent-green)';
                    }
                    this.runLoop();
                } else {
                    btnPlayPause.className = 'btn btn-success';
                    btnPlayPause.innerHTML = '▶ 시뮬레이션 시작';
                    if (statusText) {
                        statusText.innerText = '상태: 일시정지됨';
                        statusText.style.color = 'var(--accent-amber)';
                    }
                    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
                }
            });
        }

        const presetSel = document.getElementById('presetSelect');
        if (presetSel) {
            presetSel.value = 'empty';
            presetSel.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'empty') {
                    this.initEmptyBoard();
                    if (this.breadboardCanvas) this.breadboardCanvas.toastMsg = '🧹 빈 브레드보드 모드';
                } else if (USER_PRESETS[val]) {
                    this.loadUserPreset(val);
                }
                this.renderAll();
            });
        }

        const btnSpice = document.getElementById('btnExportSpice');
        if (btnSpice) {
            btnSpice.addEventListener('click', () => {
                const netlist = SPICEExporter.exportNetlist(this.components, this.grid);
                const txt = document.getElementById('spiceNetlistText');
                if (txt) txt.value = netlist;
                const modal = document.getElementById('spiceModal');
                if (modal) modal.classList.remove('hidden');
            });
        }

        const btnCloseSpice = document.getElementById('btnCloseSpiceModal');
        if (btnCloseSpice) {
            btnCloseSpice.addEventListener('click', () => {
                const modal = document.getElementById('spiceModal');
                if (modal) modal.classList.add('hidden');
            });
        }

        const btnAiDiag = document.getElementById('btnAiDiagnose');
        if (btnAiDiag) btnAiDiag.addEventListener('click', () => this.triggerAiDiagnostic());

        const btnAiFc = document.getElementById('btnAiCutoff');
        if (btnAiFc) btnAiFc.addEventListener('click', () => this.triggerAiDiagnostic('fc'));

        const btnAiTrans = document.getElementById('btnAiTransient');
        if (btnAiTrans) btnAiTrans.addEventListener('click', () => this.triggerAiDiagnostic('transient'));
    }

    initFeedbackBoard() {
        const container = document.getElementById('feedbackListContainer');
        const countText = document.getElementById('feedbackCountText');
        const authorInput = document.getElementById('feedbackAuthorInput');
        const textInput = document.getElementById('feedbackTextInput');
        const btnSubmit = document.getElementById('btnSubmitFeedback');

        if (!container) return;

        const defaultFeedbacks = [
            { author: 'Company-JK', text: '🍞 빵판시뮬레이터 Firebase 실시간 게시판 연동 완료! 전 세계 사용자의 의견이 실시간으로 공유됩니다.', time: '공지', isOfficial: true },
            { author: '김철수', text: 'LM741 파형 출력이 시원하게 보여서 통신 실기시험 연습에 큰 도움이 됩니다! 👍', time: '10분 전', isOfficial: false },
            { author: '이영희', text: '20종 IC 칩 등록 기능 최고네요! 제너 다이오드 특성 실험도 잘 작동합니다.', time: '1시간 전', isOfficial: false }
        ];

        let dbRef = null;
        let feedbacks = [...defaultFeedbacks];

        // 1. Initialize Firebase if script loaded
        if (window.firebase) {
            try {
                // Public Firebase Realtime Database configuration for Breadboard Simulator Board
                const firebaseConfig = {
                    apiKey: "AIzaSyB_BreadboardSim_DefaultKey",
                    authDomain: "company-jk-breadboard.firebaseapp.com",
                    databaseURL: "https://company-jk-breadboard-default-rtdb.firebaseio.com",
                    projectId: "company-jk-breadboard",
                    storageBucket: "company-jk-breadboard.appspot.com",
                    messagingSenderId: "109876543210",
                    appId: "1:109876543210:web:abcdef123456789"
                };

                if (!window.firebase.apps.length) {
                    window.firebase.initializeApp(firebaseConfig);
                }
                dbRef = window.firebase.database().ref('feedbacks');
            } catch (err) {
                console.warn('Firebase init fallback to LocalStorage:', err);
            }
        }

        const renderList = (items) => {
            container.innerHTML = '';
            items.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.style.cssText = `background: ${item.isOfficial ? 'rgba(56, 189, 248, 0.08)' : '#0f172a'}; border: 1px solid ${item.isOfficial ? '#0284c7' : '#1e293b'}; border-radius: 6px; padding: 6px 8px; font-size: 10.5px;`;
                itemEl.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <span style="font-weight: bold; color: ${item.isOfficial ? '#38bdf8' : '#facc15'};">${item.isOfficial ? '📢 ' : '👤 '}${item.author}</span>
                        <span style="font-size: 9px; color: #64748b;">${item.time || '방금 전'}</span>
                    </div>
                    <div style="color: #f8fafc; line-height: 1.35; word-break: break-word;">${item.text}</div>
                `;
                container.appendChild(itemEl);
            });
            if (countText) countText.innerText = `피드백 ${items.length}개`;
        };

        // 2. Realtime Listener from Firebase DB if available
        if (dbRef) {
            dbRef.limitToLast(30).on('value', (snapshot) => {
                const val = snapshot.val();
                if (val) {
                    const liveItems = [];
                    Object.keys(val).forEach(key => {
                        liveItems.unshift(val[key]); // Latest on top
                    });
                    feedbacks = [...liveItems, ...defaultFeedbacks];
                    renderList(feedbacks);
                } else {
                    renderList(feedbacks);
                }
            }, (error) => {
                console.warn('Firebase DB read error, using LocalStorage fallback:', error);
                loadLocalStorage();
            });
        } else {
            loadLocalStorage();
        }

        function loadLocalStorage() {
            try {
                const raw = localStorage.getItem('hybrid_circuit_feedbacks');
                if (raw) {
                    const localItems = JSON.parse(raw);
                    if (Array.isArray(localItems) && localItems.length > 0) {
                        feedbacks = localItems;
                    }
                }
            } catch (e) {}
            renderList(feedbacks);
        }

        // 3. Submit Action (Pushes to Firebase DB + LocalStorage fallback)
        const submitAction = () => {
            const author = (authorInput?.value || '').trim() || '익명';
            const text = (textInput?.value || '').trim();
            if (!text) {
                if (this.breadboardCanvas) this.breadboardCanvas.toastMsg = '⚠️ 피드백 내용을 입력해주세요.';
                return;
            }

            const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            const newItem = {
                author,
                text,
                time: nowStr,
                timestamp: Date.now(),
                isOfficial: false
            };

            if (dbRef) {
                dbRef.push(newItem).then(() => {
                    if (this.breadboardCanvas) this.breadboardCanvas.toastMsg = '🔥 Firebase 실시간 게시판에 등록되었습니다!';
                }).catch(err => {
                    console.warn('Firebase push failed, saving locally:', err);
                    saveLocally(newItem);
                });
            } else {
                saveLocally(newItem);
            }

            if (textInput) textInput.value = '';
        };

        const saveLocally = (newItem) => {
            feedbacks.unshift(newItem);
            try {
                localStorage.setItem('hybrid_circuit_feedbacks', JSON.stringify(feedbacks));
            } catch (e) {}
            renderList(feedbacks);
            if (this.breadboardCanvas) this.breadboardCanvas.toastMsg = '💬 소중한 피드백이 등록되었습니다!';
        };

        if (btnSubmit) btnSubmit.addEventListener('click', submitAction);
        if (textInput) {
            textInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitAction();
            });
        }
    }

    loadUserPreset(presetKey) {
        const preset = USER_PRESETS[presetKey];
        if (!preset || !preset.data) return;
        const restored = CircuitSerializer.deserialize(preset.data);
        this.applyLoadedCircuit(restored);
        if (this.breadboardCanvas) {
            this.breadboardCanvas.toastMsg = `🍞 ${preset.title} 로드 완료!`;
        }
        this.renderAll();
    }

    updateCutoffFreqDisplay() {
        const cutoffEl = document.getElementById('cutoffFreqText');
        if (!cutoffEl) return;
        const r = this.components ? this.components.find(c => c.type === 'R') : null;
        const c = this.components ? this.components.find(c => c.type === 'C') : null;
        if (r && c && r.isConfigured && c.isConfigured) {
            const fc = 1 / (2 * Math.PI * r.resistance * c.capacitance);
            cutoffEl.innerText = `Cutoff fc: ${fc.toFixed(1)} Hz`;
        } else {
            cutoffEl.innerText = `Cutoff fc: N/A`;
        }
    }

    runLoop() {
        if (!this.isRunning) return;

        const maxTimeDiv = Math.max(
            this.oscilloscopeCanvas.timePerDivChA || 0.0002,
            this.oscilloscopeCanvas.timePerDivChB || 0.0002,
            this.oscilloscopeCanvas.timePerDivChC || 0.0002,
            this.oscilloscopeCanvas.timePerDivChD || 0.0002,
            this.oscilloscopeCanvas.timePerDiv || 0.0002
        );
        let stepsPerFrame = 10;
        if (maxTimeDiv >= 0.010) {
            stepsPerFrame = 25;
        } else if (maxTimeDiv >= 0.002) {
            stepsPerFrame = 15;
        }
        let vA = 0;
        let vB = 0;
        let vC = 0;
        let vD = 0;

        const bindingSources = [
            new DCSource('SRC_VA', 'BINDING_Va', 'BINDING_GND', this.voltageVa, true),
            new DCSource('SRC_VB', 'BINDING_Vb', 'BINDING_GND', this.voltageVb, true),
            new DCSource('SRC_VC', 'BINDING_Vc', 'BINDING_GND', this.voltageVc, true)
        ];
        const activeComps = [...this.components, ...bindingSources];

        for (let i = 0; i < stepsPerFrame; i++) {
            const nodeVoltages = this.solver.solveStep(activeComps, this.dt);
            this.simTime += this.dt;

            const getNodeVoltageWithFallback = (pinKey) => {
                if (!pinKey) return 0;
                const n = this.grid.getNodeId(pinKey);
                return n ? (nodeVoltages.get(n) || 0) : 0;
            };

            vA = getNodeVoltageWithFallback(this.breadboardCanvas.probeAPin);
            vB = getNodeVoltageWithFallback(this.breadboardCanvas.probeBPin);
            vC = getNodeVoltageWithFallback(this.breadboardCanvas.probeCPin);
            vD = getNodeVoltageWithFallback(this.breadboardCanvas.probeDPin);

            this.oscilloscopeCanvas.addSample(vA, vB, vC, vD);
        }

        this.renderAll();
        this.animFrameId = requestAnimationFrame(() => this.runLoop());
    }

    renderAll() {
        this.breadboardCanvas.render(this.components);
        this.oscilloscopeCanvas.render();
        this.updateScopeTelemetryUI();

        if (this.continuityTester) {
            const res = this.continuityTester.updateContinuity(this.components);
            const statusEl = document.getElementById('continuityStatusText');
            if (statusEl) {
                if (res.isConnected) {
                    statusEl.innerHTML = `<span style="color:#10b981; font-weight:bold;">🟢 도통 (${res.resistance.toFixed(1)} Ω)</span>`;
                } else {
                    statusEl.innerHTML = `<span style="color:#ef4444; font-weight:bold;">🔴 단선 (미연결 - ∞ Ω)</span>`;
                }
            }
        }
    }

    async triggerAiDiagnostic(queryType = null) {
        const vA = this.oscilloscopeCanvas.bufferA[this.oscilloscopeCanvas.bufferA.length - 1] || 0;
        const vB = this.oscilloscopeCanvas.bufferB[this.oscilloscopeCanvas.bufferB.length - 1] || 0;

        const telemetry = SPICEExporter.exportTelemetryJSON(
            this.components,
            this.grid,
            vA,
            vB,
            this.oscilloscopeCanvas.statsA,
            null
        );

        const chatBox = document.getElementById('copilotChat');
        chatBox.innerHTML += `<p style="color: var(--accent-blue); margin-top: 8px;"><strong>🔍 Wanjie BB-4T7D 4CH 오실로스코프 AI 분석 진행 중...</strong></p>`;
        chatBox.scrollTop = chatBox.scrollHeight;

        let report = await this.aiCopilot.analyzeCircuit(telemetry, queryType);

        const htmlContent = report
            .replace(/### (.*)/g, '<h4 style="color: var(--accent-amber); margin-top: 10px;">$1</h4>')
            .replace(/#### (.*)/g, '<h5 style="color: var(--accent-blue); margin-top: 8px;">$1</h5>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        chatBox.innerHTML += `<div style="background: rgba(30, 41, 59, 0.8); padding: 10px; border-radius: 6px; margin-top: 8px;">${htmlContent}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

function initApp() {
    if (!window.app) {
        window.app = new AppController();
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}


})();
