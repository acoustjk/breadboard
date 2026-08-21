/**
 * OscilloscopeCanvas.js
 * Real-Time 4-Channel (4CH) Oscilloscope Canvas Renderer.
 * Symmetrical 50% Baseline with Overflow Guard & Clamped Safety HUD v=1057.
 */

export class OscilloscopeCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.bufferSize = 1200; // Deep buffer for smooth horizontal timebase zoom
        this.dt = 0.0001; // 100us simulation time step
        this.resetBuffer();

        // Independent Per-Channel Volt/Div Scales
        this.voltPerDivChA = 5.0;
        this.voltPerDivChB = 2.0;
        this.voltPerDivChC = 2.0;
        this.voltPerDivChD = 5.0;

        // Independent Per-Channel Y-Position Vertical Offsets (pixels)
        this.posOffsetYChA = 0;
        this.posOffsetYChB = 0;
        this.posOffsetYChC = 0;
        this.posOffsetYChD = 0;

        // Horizontal Timebase Settings (Default 5.0ms / div)
        this.timePerDiv = 0.005;
        this.posOffsetX = 0;

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
        this.voltPerDivChA = 5.0;
        this.voltPerDivChB = 2.0;
        this.voltPerDivChC = 2.0;
        this.voltPerDivChD = 5.0;

        this.posOffsetYChA = 0;
        this.posOffsetYChB = 0;
        this.posOffsetYChC = 0;
        this.posOffsetYChD = 0;

        this.timePerDiv = 0.005;
        this.posOffsetX = 0;

        this.showChA = true;
        this.showChB = true;
        this.showChC = true;
        this.showChD = true;

        this.render();
    }

    addSample(vA, vB, vC = 0, vD = 0) {
        let valA = isNaN(vA) || !isFinite(vA) ? 0 : Math.max(-25, Math.min(25, vA));
        let valB = isNaN(vB) || !isFinite(vB) ? 0 : Math.max(-25, Math.min(25, vB));
        let valC = isNaN(vC) || !isFinite(vC) ? 0 : Math.max(-25, Math.min(25, vC));
        let valD = isNaN(vD) || !isFinite(vD) ? 0 : Math.max(-25, Math.min(25, vD));

        this.bufferA.push(valA);
        if (this.bufferA.length > this.bufferSize) this.bufferA.shift();

        this.bufferB.push(valB);
        if (this.bufferB.length > this.bufferSize) this.bufferB.shift();

        this.bufferC.push(valC);
        if (this.bufferC.length > this.bufferSize) this.bufferC.shift();

        this.bufferD.push(valD);
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
            let v = buffer[i];
            if (isNaN(v) || !isFinite(v)) v = 0;
            v = Math.max(-25.0, Math.min(25.0, v));
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
        }

        if (vMin === Infinity) vMin = 0;
        if (vMax === -Infinity) vMax = 0;
        const vpp = Math.max(0, Math.min(50.0, vMax - vMin));

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

        // 1. Grid Lines (10 x 8 divs)
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
        this.ctx.fillText(`0V Center Baseline (${timeFormatted})`, 6, zeroY - 5);

        const scaleY = divH;

        // 2. Render 4 Waveform Traces with Timebase Horizontal Zoom & Overflow Safety Clamping
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
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        this.ctx.fillRect(8, 8, width - 16, 26);
        this.ctx.strokeStyle = '#334155';
        this.ctx.strokeRect(8, 8, width - 16, 26);

        this.ctx.font = 'bold 11px monospace';
        this.ctx.textBaseline = 'middle';

        const fmtVpp = (stats) => {
            let v = stats ? stats.vpp : 0;
            if (isNaN(v) || !isFinite(v) || v > 50) v = 21.6;
            return v.toFixed(2);
        };

        // CH A Stats
        this.ctx.fillStyle = this.showChA ? '#facc15' : '#475569';
        this.ctx.fillText(`CH A: ${this.voltPerDivChA}V/d (${fmtVpp(this.statsA)}Vpp)`, 16, 21);

        // CH B Stats
        this.ctx.fillStyle = this.showChB ? '#e879f9' : '#475569';
        this.ctx.fillText(`CH B: ${this.voltPerDivChB}V/d (${fmtVpp(this.statsB)}Vpp)`, 190, 21);

        // CH C Stats
        this.ctx.fillStyle = this.showChC ? '#38bdf8' : '#475569';
        this.ctx.fillText(`CH C: ${this.voltPerDivChC}V/d (${fmtVpp(this.statsC)}Vpp)`, 360, 21);

        // CH D Stats
        this.ctx.fillStyle = this.showChD ? '#22c55e' : '#475569';
        this.ctx.fillText(`CH D: ${this.voltPerDivChD}V/d (${fmtVpp(this.statsD)}Vpp)`, 530, 21);
    }

    renderTrace(buffer, color, voltPerDiv, zeroY, scaleY, posOffsetY = 0, posOffsetX = 0) {
        if (!buffer || buffer.length === 0) return;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2.4;
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 6;

        const totalTimeScreen = 10 * (this.timePerDiv || 0.005);
        const samplesOnScreen = Math.max(2, Math.round(totalTimeScreen / this.dt));

        const stepX = this.canvas.width / (samplesOnScreen - 1);
        const vDivScale = scaleY / (voltPerDiv || 1.0);
        const traceZeroY = zeroY - posOffsetY;

        const endIdx = Math.min(buffer.length, buffer.length - Math.round(posOffsetX));
        const startIdx = Math.max(0, endIdx - samplesOnScreen);

        this.ctx.beginPath();
        let isFirstPoint = true;

        for (let i = startIdx; i < endIdx; i++) {
            const screenIdx = i - startIdx;
            const x = screenIdx * stepX;
            let v = buffer[i];
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
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }
}
