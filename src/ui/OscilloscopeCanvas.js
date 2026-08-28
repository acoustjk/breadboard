export class RingBuffer {
    constructor(capacity = 5000) {
        this.capacity = capacity;
        this.data = new Float64Array(capacity);
        this.head = 0;
        this.length = capacity; // Pre-filled to full capacity to prevent initial waveform stretching / zoom lag
    }

    reset() {
        this.data.fill(0);
        this.head = 0;
        this.length = this.capacity;
    }

    push(val) {
        this.data[this.head] = val;
        this.head = (this.head + 1) % this.capacity;
        this.length = this.capacity;
    }

    get(i) {
        if (i < 0 || i >= this.capacity) return 0;
        let idx = (this.head - this.capacity + i) % this.capacity;
        if (idx < 0) idx += this.capacity;
        return this.data[idx];
    }
}

export class OscilloscopeCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.bufferSize = 10000; // 10,000 Float64Array RingBuffer
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

        // Horizontal Timebase Settings (Default 0.2ms / div for 100% clear 2~3 cycle Sine Waves)
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

        this.timePerDiv = 0.005;
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
        const len = Math.min(512, this.ringA.length);
        this.bufferA = [];
        for (let i = this.ringA.length - len; i < this.ringA.length; i++) {
            this.bufferA.push(this.ringA.get(i));
        }
    }

    computeStatsForRing(ring) {
        if (!ring || ring.length === 0) return { vMin: 0, vMax: 0, vpp: 0, vrms: 0, freq: 0, period: 0 };

        let vMin = Infinity;
        let vMax = -Infinity;
        let sumSq = 0;
        const total = ring.length;

        // Inspect last 2000 samples for real-time telemetry readout
        const inspectLen = Math.min(total, 2000);
        const startIdx = total - inspectLen;
        let count = 0;

        for (let i = startIdx; i < total; i++) {
            let v = ring.get(i);
            if (isNaN(v) || !isFinite(v)) v = 0;
            v = Math.max(-25.0, Math.min(25.0, v));
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
            sumSq += v * v;
            count++;
        }

        if (vMin === Infinity) vMin = 0;
        if (vMax === -Infinity) vMax = 0;
        const vpp = Math.max(0, Math.min(50.0, vMax - vMin));
        const vrms = count > 0 ? Math.sqrt(sumSq / count) : 0;

        let crossings = 0;
        const mid = (vMin + vMax) / 2;
        let prevVal = ring.get(startIdx);
        for (let i = startIdx + 1; i < total; i++) {
            const currVal = ring.get(i);
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

        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

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
            let effOffsetY = this.posOffsetYChB;
            // Auto-center inverted DAC waveforms (-4.5V to 0V) so they sit centered on the 0V baseline like official exam answer sheets!
            if (this.statsB && this.statsB.vMin < -1.0 && this.statsB.vMax <= 0.8) {
                const centerShift = (this.statsB.vMin + this.statsB.vMax) * 0.5; // e.g. -2.25V
                effOffsetY = this.posOffsetYChB - (centerShift * (scaleY / (this.voltPerDivChB || 1.0)));
            }
            this.renderTrace(this.ringB, '#e879f9', this.voltPerDivChB, zeroY, scaleY, effOffsetY, this.posOffsetX);
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
            // Peak-Detect DSO Envelope Rendering (Eliminates sub-pixel decimation notches & square wave aliasing)
            const samplesPerPixel = numSamples / width;
            let isFirst = true;

            for (let px = 0; px < width; px++) {
                const sStart = Math.floor(startIdx + px * samplesPerPixel);
                const sEnd = Math.floor(startIdx + (px + 1) * samplesPerPixel);
                let pMin = Infinity;
                let pMax = -Infinity;

                for (let s = sStart; s < sEnd && s < endIdx; s++) {
                    let v = ringBuffer.get(s);
                    if (isNaN(v) || !isFinite(v)) v = 0;
                    v = Math.max(-25.0, Math.min(25.0, v));
                    if (v < pMin) pMin = v;
                    if (v > pMax) pMax = v;
                }

                if (pMin === Infinity) continue;
                const yAvg = traceZeroY - ((pMin + pMax) * 0.5) * vDivScale;

                if (isFirst) {
                    this.ctx.moveTo(px, yAvg);
                    isFirst = false;
                } else {
                    this.ctx.lineTo(px, yAvg);
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
