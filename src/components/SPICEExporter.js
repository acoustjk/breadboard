/**
 * SPICEExporter.js
 * Exports circuit state to standard SPICE Netlist format and JSON payload for AI telemetry.
 */

export class SPICEExporter {
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
