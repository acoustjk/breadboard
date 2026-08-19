/**
 * FFT.js
 * Cooley-Tukey Fast Fourier Transform (Radix-2) and Spectral Analysis Module.
 */

export class FFT {
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
