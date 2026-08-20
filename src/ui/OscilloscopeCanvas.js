/**
 * OscilloscopeCanvas.js
 * Real-Time 4-Channel (4CH) Oscilloscope Canvas Renderer.
 * Independent Per-Channel Controls:
 * - Volt/Div Scale (Ch A, B, C, D)
 * - Y-Position Vertical Shift Offset (Ch A, B, C, D)
 * - X-Position Horizontal Timebase Shift Offset
 * - Channel ON/OFF Visibility Toggles
 * Colors: CH A (Yellow #facc15), CH B (Magenta #e879f9), CH C (Cyan #38bdf8), CH D (Green #22c55e)
 */

export class OscilloscopeCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.bufferSize = 300;
        this.resetBuffer();

        // Independent Per-Channel Volt/Div Scales
        this.voltPerDivChA = 2.0;
        this.voltPerDivChB = 2.0;
        this.voltPerDivChC = 2.0;
        this.voltPerDivChD = 5.0;

        // Independent Per-Channel Y-Position Vertical Offsets (pixels)
        this.posOffsetYChA = 0;
        this.posOffsetYChB = 0;
        this.posOffsetYChC = 0;
        this.posOffsetYChD = 0;

        // Horizontal Timebase Settings
        this.timePerDiv = 0.002; // 2.0 ms
        this.posOffsetX = 0; // Horizontal shift

        // Channel ON/OFF Visibility Toggles
        this.showChA = true;
        this.showChB = true;
        this.showChC = true;
        this.showChD = true;

        this.statsA = { vMin: 0, vMax: 0, vpp: 0, freq: 0 };
        this.statsB = { vMin: 0, vMax: 0, vpp: 0, freq: 0 };
        this.statsC = { vMin: 0, vMax: 0, vpp: 0, freq: 0 };
        this.statsD = { vMin: 0, vMax: 0, vpp: 0, freq: 0 };
    }

    resetBuffer() {
        this.bufferA = new Array(this.bufferSize).fill(0);
        this.bufferB = new Array(this.bufferSize).fill(0);
        this.bufferC = new Array(this.bufferSize).fill(0);
        this.bufferD = new Array(this.bufferSize).fill(0);
    }

    resetControls() {
        this.voltPerDivChA = 2.0;
        this.voltPerDivChB = 2.0;
        this.voltPerDivChC = 2.0;
        this.voltPerDivChD = 5.0;

        this.posOffsetYChA = 0;
        this.posOffsetYChB = 0;
        this.posOffsetYChC = 0;
        this.posOffsetYChD = 0;

        this.timePerDiv = 0.002;
        this.posOffsetX = 0;

        this.showChA = true;
        this.showChB = true;
        this.showChC = true;
        this.showChD = true;

        this.render();
    }

    addSample(vA, vB, vC = 0, vD = 0) {
        this.bufferA.push(vA);
        if (this.bufferA.length > this.bufferSize) this.bufferA.shift();

        this.bufferB.push(vB);
        if (this.bufferB.length > this.bufferSize) this.bufferB.shift();

        this.bufferC.push(vC);
        if (this.bufferC.length > this.bufferSize) this.bufferC.shift();

        this.bufferD.push(vD);
        if (this.bufferD.length > this.bufferSize) this.bufferD.shift();

        this.calculateStats();
    }

    calculateStats() {
        this.statsA = this.computeStatsForBuffer(this.bufferA);
        this.statsB = this.computeStatsForBuffer(this.bufferB);
        this.statsC = this.computeStatsForBuffer(this.bufferC);
        this.statsD = this.computeStatsForBuffer(this.bufferD);
    }

    computeStatsForBuffer(buffer) {
        if (!buffer || buffer.length === 0) return { vMin: 0, vMax: 0, vpp: 0, freq: 0 };

        let vMin = Infinity;
        let vMax = -Infinity;
        for (let i = 0; i < buffer.length; i++) {
            const v = buffer[i];
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
        }

        if (vMin === Infinity) vMin = 0;
        if (vMax === -Infinity) vMax = 0;
        const vpp = Math.max(0, vMax - vMin);

        let crossings = 0;
        const mid = (vMin + vMax) / 2;
        for (let i = 1; i < buffer.length; i++) {
            if ((buffer[i - 1] < mid && buffer[i] >= mid) || (buffer[i - 1] >= mid && buffer[i] < mid)) {
                crossings++;
            }
        }
        const freq = (crossings > 1 && vpp > 0.5) ? (crossings / 2) * 50.0 : 0;

        return { vMin, vMax, vpp, freq };
    }

    render() {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        // CRT Dark Background
        this.ctx.fillStyle = '#090d16';
        this.ctx.fillRect(0, 0, width, height);

        // 1. Oscilloscope Grid Lines (10 x 8 divs)
        this.ctx.strokeStyle = '#1e293b';
        this.ctx.lineWidth = 1;
        const numDivsX = 10;
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

        // 0V Baseline Reference Line (75% height)
        const zeroY = height * 0.75;

        this.ctx.strokeStyle = '#334155';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(width / 2, 0);
        this.ctx.lineTo(width / 2, height);
        this.ctx.moveTo(0, zeroY);
        this.ctx.lineTo(width, zeroY);
        this.ctx.stroke();

        this.ctx.fillStyle = '#64748b';
        this.ctx.font = 'bold 9px monospace';
        this.ctx.fillText('0V GND Baseline', 5, zeroY - 4);

        const scaleY = divH;

        // 2. Render 4 Waveform Traces with Independent Per-Channel Controls
        if (this.showChA) {
            this.renderTrace(this.bufferA, '#facc15', this.voltPerDivChA, zeroY, scaleY, this.posOffsetYChA, this.posOffsetX);
        }
        if (this.showChB) {
            this.renderTrace(this.bufferB, '#e879f9', this.voltPerDivChB, zeroY, scaleY, this.posOffsetYChB, this.posOffsetX);
        }
        if (this.showChC) {
            this.renderTrace(this.bufferC, '#38bdf8', this.voltPerDivChC, zeroY, scaleY, this.posOffsetYChC, this.posOffsetX);
        }
        if (this.showChD) {
            this.renderTrace(this.bufferD, '#22c55e', this.voltPerDivChD, zeroY, scaleY, this.posOffsetYChD, this.posOffsetX);
        }

        // 3. Channel Telemetry HUD Overlay
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        this.ctx.fillRect(8, 8, width - 16, 26);
        this.ctx.strokeStyle = '#334155';
        this.ctx.strokeRect(8, 8, width - 16, 26);

        this.ctx.font = 'bold 11px monospace';
        this.ctx.textBaseline = 'middle';

        // CH A Stats
        this.ctx.fillStyle = this.showChA ? '#facc15' : '#475569';
        this.ctx.fillText(`CH A: ${this.voltPerDivChA}V/d (${this.statsA.vpp.toFixed(2)}Vpp)`, 16, 21);

        // CH B Stats
        this.ctx.fillStyle = this.showChB ? '#e879f9' : '#475569';
        this.ctx.fillText(`CH B: ${this.voltPerDivChB}V/d (${this.statsB.vpp.toFixed(2)}Vpp)`, 190, 21);

        // CH C Stats
        this.ctx.fillStyle = this.showChC ? '#38bdf8' : '#475569';
        this.ctx.fillText(`CH C: ${this.voltPerDivChC}V/d (${this.statsC.vpp.toFixed(2)}Vpp)`, 360, 21);

        // CH D Stats
        this.ctx.fillStyle = this.showChD ? '#22c55e' : '#475569';
        this.ctx.fillText(`CH D: ${this.voltPerDivChD}V/d (${this.statsD.vpp.toFixed(2)}Vpp)`, 530, 21);
    }

    renderTrace(buffer, color, voltPerDiv, zeroY, scaleY, posOffsetY = 0, posOffsetX = 0) {
        if (!buffer || buffer.length === 0) return;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2.0;
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 6;

        const stepX = this.canvas.width / (buffer.length - 1);
        const vDivScale = scaleY / (voltPerDiv || 1.0);
        const traceZeroY = zeroY - posOffsetY;

        this.ctx.beginPath();
        let isFirstPoint = true;

        for (let i = 0; i < buffer.length; i++) {
            const bufIdx = i + Math.round(posOffsetX);
            if (bufIdx < 0 || bufIdx >= buffer.length) continue;

            const x = i * stepX;
            const y = traceZeroY - (buffer[bufIdx] * vDivScale);

            if (isFirstPoint) {
                this.ctx.moveTo(x, y);
                isFirstPoint = false;
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }
}
