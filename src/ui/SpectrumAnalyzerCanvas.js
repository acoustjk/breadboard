/**
 * SpectrumAnalyzerCanvas.js
 * Frequency-Domain Spectrum Analyzer Canvas Renderer using FFT results.
 */

export class SpectrumAnalyzerCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.lastSpectrum = null;
    }

    render(spectrumData, cutoffFreq = null) {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        // 1. Dark CRT Spectrum Analyzer Background
        this.ctx.fillStyle = '#090d16';
        this.ctx.fillRect(0, 0, width, height);

        // 2. Frequency Grid
        const numDivsX = 8;
        const numDivsY = 6;
        const divW = width / numDivsX;
        const divH = height / numDivsY;

        this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
        this.ctx.lineWidth = 1;

        for (let i = 0; i <= numDivsX; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * divW, 0);
            this.ctx.lineTo(i * divW, height);
            this.ctx.stroke();
        }

        for (let j = 0; j <= numDivsY; j++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, j * divH);
            this.ctx.lineTo(width, j * divH);
            this.ctx.stroke();
        }

        if (!spectrumData || !spectrumData.freqs || spectrumData.freqs.length === 0) {
            this.renderNoDataMessage(width, height);
            return;
        }

        this.lastSpectrum = spectrumData;
        const { freqs, magnitudes, dbValues, peakFreq, maxMagnitude } = spectrumData;
        const numBins = freqs.length;
        const maxFreq = freqs[numBins - 1] || 1000;

        // 3. Render FFT Spectrum Bar & Area Fill
        const barWidth = width / numBins;
        const maxDb = 10;   // Top limit in dB
        const minDb = -60;  // Floor limit in dB
        const dbRange = maxDb - minDb;

        this.ctx.save();

        // Area Gradient Fill
        const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.6)');
        gradient.addColorStop(1, 'rgba(56, 189, 248, 0.05)');

        this.ctx.beginPath();
        this.ctx.moveTo(0, height);

        for (let i = 0; i < numBins; i++) {
            const x = i * barWidth;
            const db = dbValues[i];
            const clampedDb = Math.max(minDb, Math.min(maxDb, db));
            const y = height - ((clampedDb - minDb) / dbRange) * height;

            if (i === 0) {
                this.ctx.lineTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }

        this.ctx.lineTo(width, height);
        this.ctx.closePath();
        this.ctx.fillStyle = gradient;
        this.ctx.fill();

        // Spectrum Line Outline
        this.ctx.strokeStyle = '#38bdf8';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // 4. Draw Peak Frequency Marker Line
        if (peakFreq > 0) {
            const peakX = (peakFreq / maxFreq) * width;
            this.ctx.strokeStyle = '#ef4444';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(peakX, 0);
            this.ctx.lineTo(peakX, height);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // Label
            this.ctx.fillStyle = '#ef4444';
            this.ctx.font = 'bold 10px monospace';
            this.ctx.fillText(`Peak: ${peakFreq.toFixed(1)} Hz`, Math.min(width - 90, peakX + 5), 20);
        }

        // 5. Draw RC Cutoff Frequency (-3dB point) Marker Line if specified
        if (cutoffFreq && cutoffFreq <= maxFreq) {
            const cutoffX = (cutoffFreq / maxFreq) * width;
            this.ctx.strokeStyle = '#f59e0b';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([2, 2]);
            this.ctx.beginPath();
            this.ctx.moveTo(cutoffX, 0);
            this.ctx.lineTo(cutoffX, height);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            this.ctx.fillStyle = '#f59e0b';
            this.ctx.font = 'bold 10px monospace';
            this.ctx.fillText(`fc: ${cutoffFreq.toFixed(1)} Hz`, Math.min(width - 90, cutoffX + 5), 35);
        }

        // 6. Footer Scale Info
        this.ctx.fillStyle = '#94a3b8';
        this.ctx.font = '10px monospace';
        this.ctx.fillText(`0 Hz`, 8, height - 8);
        this.ctx.fillText(`${(maxFreq / 2).toFixed(0)} Hz`, width / 2 - 15, height - 8);
        this.ctx.fillText(`${maxFreq.toFixed(0)} Hz`, width - 50, height - 8);

        this.ctx.restore();
    }

    renderNoDataMessage(width, height) {
        this.ctx.fillStyle = '#64748b';
        this.ctx.font = '12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Awaiting Oscilloscope Waveform Data for FFT...', width / 2, height / 2);
    }
}
