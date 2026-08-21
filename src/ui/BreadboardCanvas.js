/**
 * BreadboardCanvas.js
 * Interactive HTML5 Canvas Workbench Renderer for Wanjie BB-4T7D Breadboard.
 * DIP IC Chip Silver Metallic Legs & Crisp Pin Numbers (1..8/14/16) v=1060.
 */

import { getResistorColorBands } from '../components/ComponentModels.js?v=1060';

export class BreadboardCanvas {
    constructor(canvas, grid) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.grid = grid;

        this.zoomLevel = 1.0;
        this.panOffsetX = 0;
        this.panOffsetY = 0;

        this.showValueBadges = true;

        this.selectedComponent = null;
        this.placementMode = null; // 'WIRE', 'R', 'C', 'VDC', 'SWITCH', 'LED', 'DIODE', 'ZENER', 'POT', 'IC', 'PROBE_A', 'PROBE_B', 'PROBE_C', 'PROBE_D'
        this.placementPinA = null;
        this.hoveredPin = null;
        this.mouseWorldPos = { x: 0, y: 0 };
        this.toastMsg = null;
        this.toastTimer = null;

        this.probeAPin = 'B2_F17';
        this.probeBPin = 'B1_F16';
        this.probeCPin = 'BINDING_Va';
        this.probeDPin = 'BINDING_Vc';

        this.numBlocks = 4;
        this.pinCoords = new Map();
        this.initPinCoordinates();
    }

    showToast(msg) {
        this.toastMsg = msg;
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.toastMsg = null;
            this.render([]);
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

        // Binding Posts
        setCoord('BINDING_Va', 70, 50);
        setCoord('BINDING_Vb', 180, 50);
        setCoord('BINDING_Vc', 290, 50);
        setCoord('BINDING_GND', 400, 50);

        for (let blk = 1; blk <= this.numBlocks; blk++) {
            const bX = startX + (blk - 1) * (blockWidth + blockGap);
            const prefix = `B${blk}_`;

            // Top Power Rails
            for (let c = 1; c <= 50; c++) {
                const x = bX + 31 + (c - 1) * 2.8;
                setCoord(`${prefix}VCC_TOP1_${c}`, x, startY - 24);
                setCoord(`${prefix}VCC_TOP2_${c}`, x, startY - 18);
                setCoord(`${prefix}GND_TOP1_${c}`, x, startY - 12);
                setCoord(`${prefix}GND_TOP2_${c}`, x, startY - 6);
            }

            // Dual Vertical Power Rails
            for (let r = 1; r <= 60; r++) {
                const y = startY + (r - 1) * pitchY;
                setCoord(`${prefix}VCC_L_${r}`, bX + 10, y);
                setCoord(`${prefix}GND_L_${r}`, bX + 22, y);
                setCoord(`${prefix}VCC_R_${r}`, bX + 164, y);
                setCoord(`${prefix}GND_R_${r}`, bX + 176, y);
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
        return this.pinCoords.get(pinKey) || { x: 0, y: 0 };
    }

    getNearestPin(worldX, worldY, maxDist = 12.0) {
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
        this.ctx.fillText('WANJIE BB-4T7D INTERACTIVE BREADBOARD WORKBENCH', 30, 36);

        this.ctx.fillStyle = '#94a3b8';
        this.ctx.font = '12px sans-serif';
        this.ctx.fillText('3220 Tie-Points | 4-Block Terminal Matrix | Quad Bus Rails | 4CH Oscilloscope Engine', 30, 56);

        // 3. 4 Heavy Metal Binding Posts
        const bindingPosts = [
            { id: 'BINDING_Va', label: 'Va (+12V)', color: '#ef4444', x: 70, valText: '+12.0V' },
            { id: 'BINDING_Vb', label: 'Vb (0V/GND)', color: '#10b981', x: 180, valText: '0.0V' },
            { id: 'BINDING_Vc', label: 'Vc (-12V)', color: '#0284c7', x: 290, valText: '-12.0V' },
            { id: 'BINDING_GND', label: 'GND', color: '#64748b', x: 400, valText: 'GND' }
        ];

        bindingPosts.forEach(bp => {
            this.ctx.fillStyle = bp.color;
            this.ctx.beginPath();
            this.ctx.arc(bp.x, 72, 14, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = '#f8fafc';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            this.ctx.fillStyle = '#f8fafc';
            this.ctx.font = 'bold 11px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(bp.label, bp.x, 34);

            this.ctx.fillStyle = '#facc15';
            this.ctx.font = 'bold 10px monospace';
            this.ctx.fillText(bp.valText, bp.x, 86);
        });

        // 4. Render Top 4 Horizontal Bus Lines
        this.ctx.fillStyle = '#f8fafc';
        this.ctx.beginPath();
        this.ctx.roundRect(35, 106, 755, 72, 4);
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

        // 6. Render All Metallic Pin Holes
        let activeHoverNode = this.hoveredPin ? this.grid.getNodeId(this.hoveredPin) : null;

        for (const [pinKey, pos] of this.pinCoords.entries()) {
            if (pinKey.startsWith('BINDING_')) continue;

            const pinNode = this.grid.getNodeId(pinKey);
            const isHovered = (this.hoveredPin === pinKey);
            const isPlacementStart = (this.placementPinA === pinKey);
            const isSameNodeHovered = activeHoverNode && (pinNode === activeHoverNode);

            this.ctx.beginPath();

            if (isPlacementStart) {
                this.ctx.arc(pos.x, pos.y, 4.0, 0, Math.PI * 2);
                this.ctx.fillStyle = '#38bdf8';
            } else if (isHovered) {
                this.ctx.arc(pos.x, pos.y, 3.5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#d63031';
            } else if (isSameNodeHovered) {
                this.ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#fdcb6e';
            } else {
                this.ctx.arc(pos.x, pos.y, 1.8, 0, Math.PI * 2);
                this.ctx.fillStyle = '#2d3436';
            }
            this.ctx.fill();
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
        const pA = this.getPinPos(comp.pinA);
        const pB = this.getPinPos(comp.pinB);

        this.ctx.save();

        if (isSelected) {
            this.ctx.shadowColor = '#00cec9';
            this.ctx.shadowBlur = 10;
        }

        if (comp.type === 'WIRE') {
            this.ctx.strokeStyle = comp.color || '#0984e3';
            this.ctx.lineWidth = isSelected ? 5.0 : 3.0;

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2 - 12;

            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.quadraticCurveTo(midX, midY, pB.x, pB.y);
            this.ctx.stroke();

            // Terminal Pin Heads
            this.ctx.fillStyle = '#2d3436';
            this.ctx.beginPath();
            this.ctx.arc(pA.x, pA.y, 3.5, 0, Math.PI * 2);
            this.ctx.arc(pB.x, pB.y, 3.5, 0, Math.PI * 2);
            this.ctx.fill();

        } else if (comp.type === 'R') {
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

            this.ctx.fillStyle = '#f5f6fa';
            this.ctx.beginPath();
            this.ctx.roundRect(-14, -5, 28, 10, 3);
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#00cec9' : '#2d3436';
            this.ctx.lineWidth = isSelected ? 2 : 1;
            this.ctx.stroke();

            // 4 Resistor Color Bands
            const bands = getResistorColorBands(comp.resistance);
            const bandOffsets = [-9, -4, 1, 7];
            bands.forEach((bandColor, idx) => {
                this.ctx.fillStyle = bandColor;
                this.ctx.fillRect(bandOffsets[idx], -5, idx === 3 ? 2.5 : 2, 10);
            });

            if (this.showValueBadges && comp.isConfigured) {
                const formatted = comp.resistance >= 1000 ? (comp.resistance / 1000) + 'k' : comp.resistance;
                this.ctx.fillStyle = '#0284c7';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${formatted}Ω`, 0, -8);
            }

            this.ctx.restore();

        } else if (comp.type === 'POT') {
            this.ctx.strokeStyle = '#636e72';
            this.ctx.lineWidth = 2.0;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            this.ctx.fillStyle = '#0284c7';
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, 14, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#00cec9' : '#0f172a';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Knob Arrow Indicator
            const knobAngle = (comp.ratio - 0.5) * Math.PI * 1.5;
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(midX, midY);
            this.ctx.lineTo(midX + Math.cos(knobAngle) * 10, midY + Math.sin(knobAngle) * 10);
            this.ctx.stroke();

            if (this.showValueBadges) {
                const effRes = comp.getEffectiveResistance();
                const formatted = effRes >= 1000 ? (effRes / 1000) + 'k' : effRes.toFixed(0);
                this.ctx.fillStyle = '#facc15';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${formatted}Ω (${(comp.ratio * 100).toFixed(0)}%)`, midX, midY - 17);
            }

        } else if (comp.type === 'C') {
            this.ctx.strokeStyle = '#636e72';
            this.ctx.lineWidth = 1.8;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            const isElec = comp.capType === 'ELEC';
            const isCeramic = comp.capType === 'CERAMIC';

            this.ctx.fillStyle = isElec ? '#0984e3' : (isCeramic ? '#f1c40f' : '#2ec4b6');
            this.ctx.beginPath();

            if (isElec) {
                this.ctx.arc(midX, midY, 9, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.fillRect(midX - 7, midY - 2, 14, 4);
            } else {
                this.ctx.roundRect(midX - 7, midY - 8, 14, 16, 2);
                this.ctx.fill();
            }

            this.ctx.strokeStyle = isSelected ? '#00cec9' : '#2d3436';
            this.ctx.lineWidth = isSelected ? 2 : 1;
            this.ctx.stroke();

            if (this.showValueBadges && comp.isConfigured) {
                const microVal = comp.capacitance * 1e6;
                this.ctx.fillStyle = '#e879f9';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${microVal < 0.1 ? (comp.capacitance * 1e9).toFixed(0) + 'n' : microVal.toFixed(1) + 'µ'}F`, midX, midY - 11);
            }

        } else if (comp.type === 'IC') {
            const midX = (pA.x + pB.x) / 2;
            const numPinsTotal = comp.pins || 8;
            const pinsPerSide = numPinsTotal / 2;
            const pitchY = 11.2;
            const chipWidth = Math.abs(pB.x - pA.x) + 32;
            const chipHeight = (pinsPerSide - 1) * pitchY + 32;
            const topY = pA.y - 16;

            // DIP Chip Body
            this.ctx.fillStyle = '#1e272e';
            this.ctx.beginPath();
            this.ctx.roundRect(midX - chipWidth / 2, topY, chipWidth, chipHeight, 4);
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#00cec9' : '#485460';
            this.ctx.lineWidth = isSelected ? 2.5 : 1.5;
            this.ctx.stroke();

            // Pin 1 Notch & Dot Indicator
            this.ctx.fillStyle = '#0f172a';
            this.ctx.beginPath();
            this.ctx.arc(midX, topY, 6, 0, Math.PI);
            this.ctx.fill();

            this.ctx.fillStyle = '#38bdf8'; // Cyan Pin 1 dot
            this.ctx.beginPath();
            this.ctx.arc(midX - chipWidth / 2 + 8, topY + 10, 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Printed IC Name Text
            this.ctx.fillStyle = '#f5f6fa';
            this.ctx.font = 'bold 11px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(comp.icType || 'LF356', midX, topY + chipHeight / 2 + 3);

            // Render Metallic Pins & Yellow Pin Numbers (1..8 / 1..14 / 1..16)
            this.ctx.font = 'bold 9px sans-serif';
            this.ctx.textBaseline = 'middle';

            for (let i = 0; i < pinsPerSide; i++) {
                const legY = pA.y + i * pitchY;

                // Left Pin Leg (Pin 1..N/2)
                const leftPinNum = i + 1;
                const leftLegX = midX - chipWidth / 2;

                // Silver Metallic Lead/Leg
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillRect(leftLegX - 5, legY - 2, 6, 4);

                // Bright Yellow Pin Number Label
                this.ctx.fillStyle = '#facc15';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${leftPinNum}`, leftLegX + 8, legY);

                // Right Pin Leg (Pin N..N/2+1)
                const rightPinNum = numPinsTotal - i;
                const rightLegX = midX + chipWidth / 2;

                // Silver Metallic Lead/Leg
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillRect(rightLegX - 1, legY - 2, 6, 4);

                // Bright Yellow Pin Number Label
                this.ctx.fillStyle = '#facc15';
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
                this.ctx.fillText(comp.type === 'ZENER' ? `${comp.vZener || 5.1}V Zener` : '1N4007', 0, -8);
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
            this.ctx.strokeStyle = '#636e72';
            this.ctx.lineWidth = 2.0;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            this.ctx.fillStyle = comp.isOpen ? '#ef4444' : '#22c55e';
            this.ctx.beginPath();
            this.ctx.roundRect(midX - 10, midY - 6, 20, 12, 3);
            this.ctx.fill();

            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 8px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(comp.isOpen ? 'OFF' : 'ON', midX, midY + 3);

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
