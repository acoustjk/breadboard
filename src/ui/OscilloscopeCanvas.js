/**
 * OscilloscopeCanvas.js
 * 60fps Real-Time Oscilloscope Waveform Renderer (Time-Domain).
 */

export class OscilloscopeCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Oscilloscope Controls & Parameters
        this.voltPerDivChA = 1.0; // Volts per major division
        this.voltPerDivChB = 1.0;
        this.timePerDiv = 0.002;  // 2ms per division (Total 10 divs = 20ms)

        this.isRunning = true;
        this.triggerLevel = 2.5; // Trigger voltage level in Volts

        // Waveform Sample Buffer
        this.bufferA = [];
        this.bufferB = [];
        this.maxBufferLength = 1000;

        // Statistics
        this.statsA = { vpp: 0, vavg: 0, vmax: 0, vmin: 0, freq: 0 };
    }

    addSample(vA, vB = 0) {
        if (!this.isRunning) return;

        this.bufferA.push(vA);
        this.bufferB.push(vB);

        if (this.bufferA.length > this.maxBufferLength) {
            this.bufferA.shift();
            this.bufferB.shift();
        }
    }

    resetBuffer() {
        this.bufferA = [];
        this.bufferB = [];
    }

    render() {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        // 1. CRT Instrument Dark Screen Background
        this.ctx.fillStyle = '#06101e';
        this.ctx.fillRect(0, 0, width, height);

        // 2. Grid lines (10 Horizontal divisions, 8 Vertical divisions)
        const numDivsX = 10;
        const numDivsY = 8;
        const divWidth = width / numDivsX;
        const divHeight = height / numDivsY;

        this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.15)'; // CRT phosphor green grid
        this.ctx.lineWidth = 1;

        // Draw Vertical grid lines
        for (let i = 0; i <= numDivsX; i++) {
            const x = i * divWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();
        }

        // Draw Horizontal grid lines
        for (let j = 0; j <= numDivsY; j++) {
            const y = j * divHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(width, y);
            this.ctx.stroke();
        }

        // Center Axis Lines (Brighter green)
        const centerX = width / 2;
        const centerY = height / 2;
        this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
        this.ctx.beginPath();
        this.ctx.moveTo(centerX, 0);
        this.ctx.lineTo(centerX, height);
        this.ctx.moveTo(0, centerY);
        this.ctx.lineTo(width, centerY);
        this.ctx.stroke();

        // 3. Render Channel A Waveform (Yellow/Cyan phosphor glow)
        if (this.bufferA.length > 1) {
            this.renderWaveform(this.bufferA, '#facc15', '#fde047', this.voltPerDivChA, divHeight, centerY);
            this.computeStats(this.bufferA);
        }

        // 4. Render Channel B Waveform (Magenta glow)
        if (this.bufferB.length > 1) {
            this.renderWaveform(this.bufferB, '#e879f9', '#f0abfc', this.voltPerDivChB, divHeight, centerY);
        }

        // 5. Draw On-Screen Readouts
        this.renderReadoutBox(width, height);
    }

    renderWaveform(buffer, strokeColor, glowColor, voltPerDiv, divHeight, zeroY) {
        const { width } = this.canvas;
        const stepX = width / (buffer.length - 1);

        this.ctx.save();
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2.5;
        this.ctx.shadowColor = glowColor;
        this.ctx.shadowBlur = 8;
        this.ctx.beginPath();

        for (let i = 0; i < buffer.length; i++) {
            const val = buffer[i];
            const x = i * stepX;
            // 0V is at center zeroY; positive voltage moves UP
            const y = zeroY - (val / voltPerDiv) * divHeight;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.stroke();
        this.ctx.restore();
    }

    computeStats(buffer) {
        if (buffer.length === 0) return;

        let maxV = -Infinity;
        let minV = Infinity;
        let sum = 0;

        for (let i = 0; i < buffer.length; i++) {
            const v = buffer[i];
            if (v > maxV) maxV = v;
            if (v < minV) minV = v;
            sum += v;
        }

        this.statsA.vmax = maxV;
        this.statsA.vmin = minV;
        this.statsA.vpp = Math.max(0, maxV - minV);
        this.statsA.vavg = sum / buffer.length;
    }

    renderReadoutBox(width, height) {
        this.ctx.save();

        // Top info bar
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        this.ctx.fillRect(8, 8, 280, 56);
        this.ctx.strokeStyle = '#334155';
        this.ctx.strokeRect(8, 8, 280, 56);

        this.ctx.fillStyle = '#facc15';
        this.ctx.font = 'bold 11px monospace';
        this.ctx.fillText(`CH A: ${this.voltPerDivChA.toFixed(1)}V/div  TIME: ${(this.timePerDiv * 1000).toFixed(1)}ms/div`, 16, 24);

        this.ctx.fillStyle = '#4ade80';
        this.ctx.fillText(`Vpp: ${this.statsA.vpp.toFixed(2)}V  Vmax: ${this.statsA.vmax.toFixed(2)}V`, 16, 40);

        this.ctx.fillStyle = '#38bdf8';
        this.ctx.fillText(`Vavg: ${this.statsA.vavg.toFixed(2)}V  Status: ${this.isRunning ? 'RUNNING' : 'STOPPED'}`, 16, 56);

        this.ctx.restore();
    }
}
