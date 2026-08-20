/**
 * BreadboardCanvas.js
 * Visual 2D Canvas Renderer for Wanjie BB-4T7D 3220-Pin Laboratory Breadboard.
 * Supports Interactive Va, Vb, Vc, GND Power Supply Binding Posts with Voltage Badges & Wire Bridging.
 */

import { getResistorColorBands } from '../components/ComponentModels.js?v=1029';

export class BreadboardCanvas {
    constructor(canvas, grid) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.grid = grid;

        this.numBlocks = 4;
        this.rowsPerBlock = 63;

        // Camera Parameters
        this.scale = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.minScale = 0.5;
        this.maxScale = 3.0;

        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        this.pinCoords = new Map();
        this.computePinCoordinates();

        // Interactive Placement & Toggle State
        this.activeTool = 'SELECT';
        this.placementPinA = null;
        this.hoveredPin = null;
        this.selectedComponent = null;
        this.showValueBadges = true;

        // Binding Post Voltage Values
        this.voltageVa = 12.0;
        this.voltageVb = -12.0;
        this.voltageVc = 5.0;

        // 4CH Oscilloscope Probes (Start null for clean empty board)
        this.probeAPin = null;
        this.probeBPin = null;
        this.probeCPin = null;
        this.probeDPin = null;

        this.toastMsg = null;

        // Callbacks
        this.onComponentPlaced = null;
        this.onComponentSelected = null;
        this.onComponentDblClicked = null;
        this.onProbePlaced = null;
        this.onBindingPostDblClicked = null;

        this.setupEventListeners();
    }

    toggleValueBadges() {
        this.showValueBadges = !this.showValueBadges;
        this.render();
        return this.showValueBadges;
    }

    setActiveTool(tool) {
        this.activeTool = tool;
        this.placementPinA = null;
        this.render();
    }

    zoomIn() {
        this.scale = Math.min(this.maxScale, this.scale * 1.15);
        this.render();
    }

    zoomOut() {
        this.scale = Math.max(this.minScale, this.scale / 1.15);
        this.render();
    }

    resetZoom() {
        this.scale = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.render();
    }

    computePinCoordinates() {
        // 1. Binding Posts (Va, Vb, Vc, GND)
        this.pinCoords.set('BINDING_Va', { x: 440, y: 44 });
        this.pinCoords.set('BINDING_Vb', { x: 500, y: 44 });
        this.pinCoords.set('BINDING_Vc', { x: 560, y: 44 });
        this.pinCoords.set('BINDING_GND', { x: 620, y: 44 });

        // 2. Top Horizontal Bus Rails
        for (let i = 1; i <= 60; i++) {
            const x = Math.round(45 + i * 11.5);
            this.pinCoords.set(`VCC_TOP1_${i}`, { x, y: 120 });
            this.pinCoords.set(`GND_TOP1_${i}`, { x, y: 134 });
            this.pinCoords.set(`VCC_TOP_${i}`, { x, y: 120 });
            this.pinCoords.set(`GND_TOP_${i}`, { x, y: 134 });
            this.pinCoords.set(`VCC_TOP2_${i}`, { x, y: 150 });
            this.pinCoords.set(`GND_TOP2_${i}`, { x, y: 164 });
        }

        // 3. 4 Vertical Terminal Strip Blocks (Block 1~4)
        const blockWidth = 186;
        const blockGap = 12;
        const startX = 25;
        const startY = 210;
        const pitchY = 11.2;

        const leftCols = ['A', 'B', 'C', 'D', 'E'];
        const rightCols = ['F', 'G', 'H', 'I', 'J'];

        for (let blk = 1; blk <= this.numBlocks; blk++) {
            const bX = startX + (blk - 1) * (blockWidth + blockGap);

            const railLeftX = Math.round(bX + 12);
            const railRightX = Math.round(bX + 174);

            for (let r = 1; r <= this.rowsPerBlock; r++) {
                const y = Math.round(startY + (r - 1) * pitchY);
                this.pinCoords.set(`B${blk}_VCC_${r}`, { x: railLeftX, y });
                this.pinCoords.set(`B${blk}_GND_${r}`, { x: railRightX, y });
            }

            const leftStartX = bX + 40;
            const rightStartX = bX + 106;
            const colPitchX = 11;

            for (let r = 1; r <= this.rowsPerBlock; r++) {
                const y = Math.round(startY + (r - 1) * pitchY);

                leftCols.forEach((col, cIdx) => {
                    const x = Math.round(leftStartX + cIdx * colPitchX);
                    this.pinCoords.set(`B${blk}_${col}${r}`, { x, y });
                    if (blk === 1) this.pinCoords.set(`${col}${r}`, { x, y });
                });

                rightCols.forEach((col, cIdx) => {
                    const x = Math.round(rightStartX + cIdx * colPitchX);
                    this.pinCoords.set(`B${blk}_${col}${r}`, { x, y });
                    if (blk === 1) this.pinCoords.set(`${col}${r}`, { x, y });
                });
            }
        }
    }

    getPinPos(pinKey) {
        if (this.pinCoords.has(pinKey)) {
            return this.pinCoords.get(pinKey);
        }
        if (pinKey === 'GND' || pinKey.startsWith('GND')) {
            return this.pinCoords.get('GND_TOP1_1') || { x: 56, y: 134 };
        }
        return { x: 100, y: 100 };
    }

    setupEventListeners() {
        this.canvas.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();

            const zoomDelta = -e.deltaY * 0.001;
            const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * (1 + zoomDelta)));

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const mouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);

            this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
            this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
            this.scale = newScale;

            this.render();
        }, { passive: false });

        this.canvas.addEventListener('click', (e) => {
            if (this.isDragging) return;

            const rect = this.canvas.getBoundingClientRect();
            const canvasMouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const canvasMouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
            const worldX = (canvasMouseX - this.offsetX) / this.scale;
            const worldY = (canvasMouseY - this.offsetY) / this.scale;

            let clickedPin = null;
            let minDist = 22 / this.scale;

            for (const [pinKey, pos] of this.pinCoords.entries()) {
                const dist = Math.hypot(pos.x - worldX, pos.y - worldY);
                if (dist < minDist) {
                    minDist = dist;
                    clickedPin = pinKey;
                }
            }

            if (clickedPin) {
                this.handlePinClick(clickedPin);
            } else if (this.activeTool === 'SELECT') {
                this.handleComponentClick({ x: worldX, y: worldY });
            }
        });

        this.canvas.addEventListener('dblclick', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasMouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const canvasMouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
            const worldX = (canvasMouseX - this.offsetX) / this.scale;
            const worldY = (canvasMouseY - this.offsetY) / this.scale;

            // Check Binding Posts Double Click
            const bpKeys = ['BINDING_Va', 'BINDING_Vb', 'BINDING_Vc'];
            for (const key of bpKeys) {
                const pos = this.pinCoords.get(key);
                if (pos && Math.hypot(pos.x - worldX, pos.y - worldY) < 22) {
                    if (this.onBindingPostDblClicked) {
                        this.onBindingPostDblClicked(key);
                    }
                    return;
                }
            }

            const clickedComp = this.findComponentAt({ x: worldX, y: worldY });
            if (clickedComp && this.onComponentDblClicked) {
                this.onComponentDblClicked(clickedComp);
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                this.isDragging = true;
                this.dragStartX = e.clientX - this.offsetX;
                this.dragStartY = e.clientY - this.offsetY;
                this.canvas.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.canvas.style.cursor = 'default';
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasMouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const canvasMouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);

            if (this.isDragging) {
                this.offsetX = e.clientX - this.dragStartX;
                this.offsetY = e.clientY - this.dragStartY;
                this.render();
                return;
            }

            const worldX = (canvasMouseX - this.offsetX) / this.scale;
            const worldY = (canvasMouseY - this.offsetY) / this.scale;
            this.mouseWorldPos = { x: worldX, y: worldY };

            let closestPin = null;
            let minDist = 22 / this.scale;

            for (const [pinKey, pos] of this.pinCoords.entries()) {
                const dist = Math.hypot(pos.x - worldX, pos.y - worldY);
                if (dist < minDist) {
                    minDist = dist;
                    closestPin = pinKey;
                }
            }

            if (this.hoveredPin !== closestPin) {
                this.hoveredPin = closestPin;
                this.render();
            }
        });
    }

    findComponentAt(mousePos) {
        if (!this.lastComponents) return null;
        let selected = null;
        let minDist = 25;

        this.lastComponents.forEach(comp => {
            const pA = this.getPinPos(comp.pinA);
            const pB = this.getPinPos(comp.pinB);
            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;
            const dist = Math.hypot(midX - mousePos.x, midY - mousePos.y);

            if (dist < minDist) {
                minDist = dist;
                selected = comp;
            }
        });
        return selected;
    }

    handlePinClick(pinKey) {
        if (this.activeTool === 'PROBE_A') {
            this.probeAPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('A', pinKey);
            this.activeTool = 'SELECT';
            this.render();
            return;
        }

        if (this.activeTool === 'PROBE_B') {
            this.probeBPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('B', pinKey);
            this.activeTool = 'SELECT';
            this.render();
            return;
        }

        if (this.activeTool === 'PROBE_C') {
            this.probeCPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('C', pinKey);
            this.activeTool = 'SELECT';
            this.render();
            return;
        }

        if (this.activeTool === 'PROBE_D') {
            this.probeDPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('D', pinKey);
            this.activeTool = 'SELECT';
            this.render();
            return;
        }

        if (this.activeTool !== 'SELECT') {
            if (!this.placementPinA) {
                this.placementPinA = pinKey;
            } else {
                const pinA = this.placementPinA;
                const pinB = pinKey;
                const toolType = this.activeTool;

                if (pinA !== pinB && this.onComponentPlaced) {
                    this.onComponentPlaced(toolType, pinA, pinB);
                }

                this.placementPinA = null;
                this.activeTool = 'SELECT';
            }
            this.render();
        }
    }

    handleComponentClick(mousePos) {
        const selected = this.findComponentAt(mousePos);
        this.selectedComponent = selected;
        if (this.onComponentSelected) this.onComponentSelected(selected);
        this.render();
    }

    render(components = []) {
        if (components.length > 0) {
            this.lastComponents = components;
        } else {
            components = this.lastComponents || [];
        }

        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);

        this.ctx.fillStyle = '#070b12';
        this.ctx.fillRect(0, 0, width, height);

        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        // 1. Baseplate
        const baseW = 810;
        const baseH = 950;

        this.ctx.fillStyle = '#12161f';
        this.ctx.beginPath();
        this.ctx.roundRect(10, 10, baseW, baseH, 16);
        this.ctx.fill();

        this.ctx.strokeStyle = '#273142';
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();

        // 2. Printed Header Logo & Branding
        this.ctx.fillStyle = '#e17055';
        this.ctx.font = 'italic bold 22px serif';
        this.ctx.fillText('Bread board', 35, 46);

        this.ctx.fillStyle = '#d63031';
        this.ctx.font = 'bold 14px sans-serif';
        this.ctx.fillText('Wanjie', 35, 66);

        this.ctx.fillStyle = '#b2bec3';
        this.ctx.font = '12px monospace';
        this.ctx.fillText('BB-4T7D / GL-3220 (3220 Tie-Points)', 35, 82);

        // 3. Interactive Binding Posts & Knobs (Va, Vb, Vc, GND)
        const bindingPosts = [
            { key: 'BINDING_Va', label: 'Va', color: '#d63031', valText: `${this.voltageVa > 0 ? '+' : ''}${this.voltageVa}V`, x: 440 },
            { key: 'BINDING_Vb', label: 'Vb', color: '#00b894', valText: `${this.voltageVb > 0 ? '+' : ''}${this.voltageVb}V`, x: 500 },
            { key: 'BINDING_Vc', label: 'Vc', color: '#0984e3', valText: `${this.voltageVc > 0 ? '+' : ''}${this.voltageVc}V`, x: 560 },
            { key: 'BINDING_GND', label: 'GND ⏚', color: '#2d3436', valText: '0V (GND)', x: 620 }
        ];

        bindingPosts.forEach(bp => {
            const isHovered = (this.hoveredPin === bp.key);

            this.ctx.fillStyle = isHovered ? '#fdcb6e' : '#dfe6e9';
            this.ctx.beginPath();
            this.ctx.arc(bp.x, 44, 16, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.fillStyle = bp.color;
            this.ctx.beginPath();
            this.ctx.arc(bp.x, 44, 12, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            // Label & Interactive Voltage Badge
            this.ctx.fillStyle = '#e17055';
            this.ctx.font = 'bold 12px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(bp.label, bp.x, 72);

            this.ctx.fillStyle = '#38bdf8';
            this.ctx.font = 'bold 10px monospace';
            this.ctx.fillText(bp.valText, bp.x, 86);
        });

        for (let k = 0; k < 4; k++) {
            const kX = 685 + (k % 2) * 22;
            const kY = 36 + Math.floor(k / 2) * 22;
            this.ctx.fillStyle = '#2d3436';
            this.ctx.beginPath();
            this.ctx.arc(kX, kY, 8, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = '#636e72';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }

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

        // 5. Render 4 Vertical Terminal Strips
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

            this.ctx.strokeStyle = '#ff7675';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(bX + 12, startY - 5);
            this.ctx.lineTo(bX + 12, startY + bH - 15);
            this.ctx.stroke();

            this.ctx.strokeStyle = '#74b9ff';
            this.ctx.beginPath();
            this.ctx.moveTo(bX + 174, startY - 5);
            this.ctx.lineTo(bX + 174, startY + bH - 15);
            this.ctx.stroke();

            this.ctx.fillStyle = '#475569';
            this.ctx.font = 'bold 9px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            for (let r = 5; r <= 60; r += 5) {
                const rY = Math.round(startY + (r - 1) * pitchY);
                this.ctx.fillText(`${r}`, Math.round(bX + 26), rY);
                this.ctx.fillText(`${r}`, Math.round(bX + 160), rY);
            }

            this.ctx.fillStyle = '#1e293b';
            this.ctx.font = 'bold 9px monospace';
            this.ctx.textBaseline = 'alphabetic';

            ['A', 'B', 'C', 'D', 'E'].forEach((c, idx) => {
                const cX = Math.round(bX + 40 + idx * 11);
                this.ctx.fillText(c, cX, startY - 14);
                this.ctx.fillText(c, cX, startY + bH - 2);
            });

            ['F', 'G', 'H', 'I', 'J'].forEach((c, idx) => {
                const cX = Math.round(bX + 106 + idx * 11);
                this.ctx.fillText(c, cX, startY - 14);
                this.ctx.fillText(c, cX, startY + bH - 2);
            });
        }

        // 6. Render All Metallic Pin Holes
        let activeHoverNode = this.hoveredPin ? this.grid.getNodeId(this.hoveredPin) : null;

        for (const [pinKey, pos] of this.pinCoords.entries()) {
            if (pinKey.startsWith('BINDING_')) continue; // Rendered separately above

            const pinNode = this.grid.getNodeId(pinKey);
            const isHovered = (this.hoveredPin === pinKey);
            const isPlacementStart = (this.placementPinA === pinKey);
            const isSameNodeHovered = activeHoverNode && (pinNode === activeHoverNode);

            this.ctx.beginPath();

            if (isPlacementStart) {
                this.ctx.arc(pos.x, pos.y, 4.0, 0, Math.PI * 2);
                this.ctx.fillStyle = '#38bdf8';
            } else if (isHovered) {
                this.ctx.arc(pos.x, pos.y, 3.0, 0, Math.PI * 2);
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

        // Render 4CH Probes ONLY if pin is attached!
        if (this.probeAPin) this.renderProbe('CH A', this.probeAPin, '#facc15');
        if (this.probeBPin) this.renderProbe('CH B', this.probeBPin, '#e879f9');
        if (this.probeCPin) this.renderProbe('CH C', this.probeCPin, '#38bdf8');
        if (this.probeDPin) this.renderProbe('CH D', this.probeDPin, '#22c55e');

        this.ctx.restore();

        // 9. Canvas Overlay HUD & Toast Message
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);

        if (this.activeTool !== 'SELECT') {
            this.ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
            this.ctx.fillRect(15, 10, 420, 28);
            this.ctx.fillStyle = '#0f172a';
            this.ctx.font = 'bold 12px sans-serif';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';

            const guideMsg = !this.placementPinA ?
                `📍 [${this.activeTool}] 1번째 핀(또는 Va/Vb/Vc/GND 단자)을 클릭하세요` :
                `📍 [${this.activeTool}] 2번째 핀을 클릭하여 배치를 완료하세요`;
            this.ctx.fillText(guideMsg, 25, 24);
        }

        if (this.toastMsg) {
            this.ctx.fillStyle = 'rgba(34, 197, 94, 0.92)';
            this.ctx.fillRect(15, height - 40, 460, 28);
            this.ctx.fillStyle = '#0f172a';
            this.ctx.font = 'bold 12px sans-serif';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(this.toastMsg, 25, height - 26);
        }

        this.ctx.fillStyle = 'rgba(18, 22, 31, 0.85)';
        this.ctx.fillRect(width - 250, 10, 240, 26);
        this.ctx.strokeStyle = '#273142';
        this.ctx.strokeRect(width - 250, 10, 240, 26);

        this.ctx.fillStyle = '#00cec9';
        this.ctx.font = 'bold 11px monospace';
        this.ctx.textAlign = 'right';
        this.ctx.textBaseline = 'alphabetic';
        this.ctx.fillText(`TOOL: ${this.activeTool} | ZOOM: ${(this.scale * 100).toFixed(0)}%`, width - 15, 27);
    }

    renderComponent(comp, isSelected = false) {
        const pA = this.getPinPos(comp.pinA);
        const pB = this.getPinPos(comp.pinB);

        const midX = (pA.x + pB.x) / 2;
        const midY = (pA.y + pB.y) / 2;

        this.ctx.save();

        if (isSelected) {
            this.ctx.shadowColor = '#38bdf8';
            this.ctx.shadowBlur = 10;
        }

        if (comp.type === 'WIRE') {
            this.ctx.strokeStyle = comp.color || '#0984e3';
            this.ctx.lineWidth = isSelected ? 5 : 3.5;
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);

            const isBindingWire = comp.pinA.startsWith('BINDING_') || comp.pinB.startsWith('BINDING_');
            const midWireX = (pA.x + pB.x) / 2 + (isBindingWire ? 30 : 10);
            const midWireY = (pA.y + pB.y) / 2 + (isBindingWire ? -15 : 0);

            this.ctx.quadraticCurveTo(midWireX, midWireY, pB.x, pB.y);
            this.ctx.stroke();

        } else if (comp.type === 'R') {
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#71717a';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);

            this.ctx.translate(midX, midY);
            this.ctx.rotate(angle);

            const bodyColor = comp.isConfigured ? '#e17055' : '#cbd5e1';
            this.ctx.fillStyle = bodyColor;
            this.ctx.beginPath();
            this.ctx.roundRect(-14, -5, 28, 10, 2);
            this.ctx.fill();

            const bands = comp.getBands ? comp.getBands() : getResistorColorBands(comp.resistance, comp.isConfigured);
            bands.forEach((bColor, idx) => {
                this.ctx.fillStyle = bColor;
                this.ctx.fillRect(-10 + idx * 6, -5, 3, 10);
            });

        } else if (comp.type === 'C') {
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#71717a';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
            this.ctx.translate(midX, midY);
            this.ctx.rotate(angle);

            const capKind = comp.capType || 'ELEC';

            if (capKind === 'ELEC') {
                const bodyColor = comp.isConfigured ? '#1d4ed8' : '#64748b';
                this.ctx.fillStyle = bodyColor;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 10, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.strokeStyle = '#0f172a';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();

                this.ctx.fillStyle = '#e2e8f0';
                this.ctx.fillRect(3, -10, 7, 20);

                this.ctx.fillStyle = '#1e293b';
                this.ctx.font = 'bold 10px sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('-', 6.5, -3);
                this.ctx.fillText('-', 6.5, 5);

                this.ctx.fillStyle = '#f8fafc';
                this.ctx.font = 'bold 9px sans-serif';
                this.ctx.fillText('+', -5, 1);

            } else if (capKind === 'CERAMIC') {
                const bodyColor = comp.isConfigured ? '#d97706' : '#94a3b8';
                this.ctx.fillStyle = bodyColor;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 9, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.strokeStyle = '#78350f';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();

                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 8px sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(comp.isConfigured ? '104' : '???', 0, 3);

            } else if (capKind === 'MYLAR') {
                const bodyColor = comp.isConfigured ? '#15803d' : '#94a3b8';
                this.ctx.fillStyle = bodyColor;
                this.ctx.beginPath();
                this.ctx.roundRect(-10, -6, 20, 12, 2);
                this.ctx.fill();
                this.ctx.strokeStyle = '#14532d';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();

                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 8px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(comp.isConfigured ? '104K' : '???', 0, 3);
            }

        } else if (comp.type === 'IC') {
            const numPinsPerSide = (comp.pins || 8) / 2;
            const pitchY = 11.2;

            const chipWidth = Math.abs(pB.x - pA.x) + 22;
            const chipHeight = (numPinsPerSide - 1) * pitchY + 28;

            const topY = pA.y - 12;

            this.ctx.fillStyle = '#1e293b';
            this.ctx.beginPath();
            this.ctx.roundRect(midX - chipWidth / 2, topY, chipWidth, chipHeight, 4);
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#0f172a';
            this.ctx.lineWidth = isSelected ? 2.5 : 1.5;
            this.ctx.stroke();

            this.ctx.fillStyle = '#0f172a';
            this.ctx.beginPath();
            this.ctx.arc(midX, topY, 6, 0, Math.PI);
            this.ctx.fill();

            this.ctx.fillStyle = '#ffffff';
            this.ctx.beginPath();
            this.ctx.arc(midX - chipWidth / 2 + 7, topY + 9, 2.2, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.save();
            this.ctx.translate(midX, topY + chipHeight / 2);
            this.ctx.rotate(-Math.PI / 2);
            this.ctx.fillStyle = '#e2e8f0';
            this.ctx.font = 'bold 10px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(comp.icType || 'LF356', 0, 0);
            this.ctx.restore();

            this.ctx.fillStyle = '#cbd5e1';
            for (let p = 0; p < numPinsPerSide; p++) {
                const pinY = pA.y + p * pitchY;
                this.ctx.fillRect(midX - chipWidth / 2 - 3, pinY - 2, 4, 4);
                this.ctx.fillRect(midX + chipWidth / 2 - 1, pinY - 2, 4, 4);
            }

        } else if (comp.type === 'DIODE') {
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#71717a';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
            this.ctx.translate(midX, midY);
            this.ctx.rotate(angle);

            this.ctx.fillStyle = '#0f172a';
            this.ctx.beginPath();
            this.ctx.roundRect(-13, -5, 26, 10, 2);
            this.ctx.fill();

            this.ctx.fillStyle = '#cbd5e1';
            this.ctx.fillRect(7, -5, 4, 10);

            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 8px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('1N4007', -2, 3);

        } else if (comp.type === 'ZENER') {
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#71717a';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
            this.ctx.translate(midX, midY);
            this.ctx.rotate(angle);

            this.ctx.fillStyle = '#ea580c';
            this.ctx.beginPath();
            this.ctx.roundRect(-13, -5, 26, 10, 2);
            this.ctx.fill();

            this.ctx.fillStyle = '#0f172a';
            this.ctx.fillRect(7, -5, 4, 10);

            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 8px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`${comp.vZener || 5.1}V Z`, -2, 3);

        } else if (comp.type === 'POT') {
            this.ctx.strokeStyle = isSelected ? '#38bdf8' : '#71717a';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(pA.x, pA.y);
            this.ctx.lineTo(pB.x, pB.y);
            this.ctx.stroke();

            const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
            this.ctx.translate(midX, midY);
            this.ctx.rotate(angle);

            this.ctx.fillStyle = '#0284c7';
            this.ctx.beginPath();
            this.ctx.roundRect(-14, -14, 28, 28, 4);
            this.ctx.fill();
            this.ctx.strokeStyle = '#0369a1';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            this.ctx.fillStyle = '#f8fafc';
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 8, 0, Math.PI * 2);
            this.ctx.fill();

            const dialAngle = (comp.ratio || 0.5) * Math.PI * 1.5 - Math.PI * 0.75;
            this.ctx.strokeStyle = '#0f172a';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.lineTo(Math.cos(dialAngle) * 7, Math.sin(dialAngle) * 7);
            this.ctx.stroke();

        } else if (comp.type === 'VDC') {
            const bodyColor = comp.isConfigured ? '#d63031' : '#94a3b8';
            this.ctx.fillStyle = bodyColor;
            this.ctx.fillRect(midX - 14, midY - 7, 28, 14);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 9px sans-serif';
            this.ctx.textAlign = 'center';
            const labelText = comp.isConfigured ? `${comp.voltage}V DC` : '??? V';
            this.ctx.fillText(labelText, midX, midY + 3);

        } else if (comp.type === 'SWITCH') {
            this.ctx.fillStyle = comp.isOpen ? '#b2bec3' : '#00b894';
            this.ctx.fillRect(midX - 12, midY - 7, 24, 14);

            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 8px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(comp.isOpen ? 'OFF' : 'ON', midX, midY + 3);

        } else if (comp.type === 'LED') {
            this.ctx.fillStyle = comp.isOn ? '#00b894' : '#006266';
            if (comp.isOn) {
                this.ctx.shadowColor = '#55efc4';
                this.ctx.shadowBlur = 12;
            }
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, 8, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
        }

        this.ctx.restore();

        if (this.showValueBadges && comp.isConfigured && comp.type !== 'WIRE') {
            this.ctx.save();
            this.ctx.translate(midX + 18, midY - 10);

            let text = '';
            if (comp.type === 'IC') {
                text = `🔲 ${comp.icType || 'LF356'} DIP-${comp.pins || 8}`;
            } else if (comp.type === 'R') {
                text = comp.resistance >= 1000 ? `${(comp.resistance / 1000)}kΩ` : `${comp.resistance}Ω`;
            } else if (comp.type === 'C') {
                text = `${(comp.capacitance * 1e6).toFixed(0)}µF`;
            } else if (comp.type === 'POT') {
                const effRes = comp.getEffectiveResistance ? comp.getEffectiveResistance() : 5000;
                text = `🎛️ ${effRes >= 1000 ? (effRes / 1000) + 'k' : effRes.toFixed(0)}Ω (${(comp.ratio * 100).toFixed(0)}%)`;
            } else if (comp.type === 'ZENER') {
                text = `⚡ ${comp.vZener || 5.1}V Zener`;
            } else if (comp.type === 'DIODE') {
                text = `🔻 1N4007`;
            } else if (comp.type === 'VDC') {
                text = `${comp.voltage}V`;
            }

            if (text) {
                this.ctx.font = 'bold 10px monospace';
                const textWidth = this.ctx.measureText(text).width;
                const padX = 6;
                const rectW = textWidth + padX * 2;
                const rectH = 15;

                this.ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                this.ctx.beginPath();
                this.ctx.roundRect(0, -10, rectW, rectH, 4);
                this.ctx.fill();

                this.ctx.strokeStyle = '#38bdf8';
                this.ctx.lineWidth = 1.2;
                this.ctx.stroke();

                this.ctx.fillStyle = '#38bdf8';
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(text, padX, -2);
            }
            this.ctx.restore();
        }
    }

    renderProbe(label, pinKey, color) {
        if (!pinKey) return;
        const pos = this.getPinPos(pinKey);
        this.ctx.save();

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2.5;
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
        this.ctx.lineTo(pos.x + 14, pos.y - 22);
        this.ctx.stroke();

        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.roundRect(pos.x + 14, pos.y - 32, 54, 15, 3);
        this.ctx.fill();

        this.ctx.fillStyle = '#0f172a';
        this.ctx.font = 'bold 9px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label, pos.x + 41, pos.y - 21);

        this.ctx.restore();
    }
}
