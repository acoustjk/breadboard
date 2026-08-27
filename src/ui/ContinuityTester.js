/**
 * ContinuityTester.js
 * Breadboard Node Continuity & BEEP Sound Tester v=1170.
 */

export class ContinuityTester {
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
