/**
 * CircuitSerializer.js
 * Serializes and deserializes the breadboard circuit state to/from JSON.
 * Auto-normalizes DIP IC height & auto-sanitizes shorted wires v=1056.
 */

import { Resistor, Capacitor, DCSource, SwitchComponent, LEDComponent, Wire, Diode, ZenerDiode, Potentiometer, DIPChip, IC_CATALOG } from './ComponentModels.js?v=1056';

export class CircuitSerializer {
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
