/**
 * BreadboardCanvas.js
 * Visual 2D Canvas Renderer for Wanjie BB-4T7D 3220-Pin Laboratory Breadboard.
 * Drag & Drop Pin Repositioning Handle Engine v=1051.
 */

import { getResistorColorBands } from '../components/ComponentModels.js?v=1051';

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

        // Pin Reposition Dragging Handle State
        this.draggingPinHandle = null;

        this.pinCoords = new Map();
        this.computePinCoordinates();

        // Interactive Placement & Toggle State
        this.activeTool = 'SELECT';
        this.placementPinA = null;
        this.hoveredPin = null;
        this.selectedComponent = null;
        this.showValueBadges = true;

        // Power Supply Binding Post Voltages
        this.voltageVa = 12.0;
        this.voltageVb = 0.0;
        this.voltageVc = -12.0;

        // 4CH Oscilloscope Probes
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
        this.onPlacementCancelled = null;

        this.setupEventListeners();
    }

    cancelPlacement() {
        if (this.placementPinA || this.activeTool !== 'SELECT') {
            this.placementPinA = null;
            this.activeTool = 'SELECT';
            this.toastMsg = '❌ 소자 배치 / 배선 작업이 취소되었습니다.';
            this.render();
            if (this.onPlacementCancelled) {
                this.onPlacementCancelled();
            }
        }
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

            const railLeftVccX = Math.round(bX + 10);
            const railLeftGndX = Math.round(bX + 22);
            const railRightVccX = Math.round(bX + 164);
            const railRightGndX = Math.round(bX + 176);

            for (let r = 1; r <= this.rowsPerBlock; r++) {
                const y = Math.round(startY + (r - 1) * pitchY);

                // Left Dual Vertical Rails (RED +, BLUE -)
                this.pinCoords.set(`B${blk}_VCC_${r}`, { x: railLeftVccX, y });
                this.pinCoords.set(`B${blk}_VCC_L_${r}`, { x: railLeftVccX, y });
                this.pinCoords.set(`B${blk}_GND_${r}`, { x: railLeftGndX, y });
                this.pinCoords.set(`B${blk}_GND_L_${r}`, { x: railLeftGndX, y });

                // Right Dual Vertical Rails (RED +, BLUE -)
                this.pinCoords.set(`B${blk}_VCC_R_${r}`, { x: railRightVccX, y });
                this.pinCoords.set(`B${blk}_GND_R_${r}`, { x: railRightGndX, y });
            }

            const leftStartX = bX + 41;
            const rightStartX = bX + 105;
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
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                this.cancelPlacement();
            }
        });

        this.canvas.addEventListener('click', (e) => {
            if (this.draggingPinHandle) return;

            const rect = this.canvas.getBoundingClientRect();
            const canvasMouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const canvasMouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);

            const worldX = (canvasMouseX - this.offsetX) / this.scale;
            const worldY = (canvasMouseY - this.offsetY) / this.scale;

            const bindingKeys = ['BINDING_Va', 'BINDING_Vb', 'BINDING_Vc', 'BINDING_GND'];
            for (const key of bindingKeys) {
                const pos = this.pinCoords.get(key);
                if (pos && Math.hypot(pos.x - worldX, pos.y - worldY) < 18) {
                    if (this.onBindingPostDblClicked) {
                        this.onBindingPostDblClicked(key);
                    }
                    return;
                }
            }

            // 🎯 Priority 1: If in SELECT mode, test component hit FIRST!
            if (this.activeTool === 'SELECT') {
                const clickedComp = this.findComponentAt({ x: worldX, y: worldY });
                if (clickedComp) {
                    this.selectComponent(clickedComp);
                } else {
                    this.selectComponent(null);
                }
                return;
            }

            // 🎯 Priority 2: Placement Tools (WIRE, R, C, IC, PROBE, etc.)
            if (this.hoveredPin) {
                this.handlePinClick(this.hoveredPin);
            }
        });

        this.canvas.addEventListener('dblclick', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasMouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const canvasMouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);

            const worldX = (canvasMouseX - this.offsetX) / this.scale;
            const worldY = (canvasMouseY - this.offsetY) / this.scale;

            const clickedComp = this.findComponentAt({ x: worldX, y: worldY });
            if (clickedComp && this.onComponentDblClicked) {
                this.onComponentDblClicked(clickedComp);
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasMouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const canvasMouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);

            const worldX = (canvasMouseX - this.offsetX) / this.scale;
            const worldY = (canvasMouseY - this.offsetY) / this.scale;

            if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                this.isDragging = true;
                this.dragStartX = e.clientX - this.offsetX;
                this.dragStartY = e.clientY - this.offsetY;
                this.canvas.style.cursor = 'grabbing';
                return;
            }

            // 📍 Drag Pin Handle Repositioning in SELECT Mode
            if (this.activeTool === 'SELECT' && this.selectedComponent) {
                const pA = this.getPinPos(this.selectedComponent.pinA);
                const pB = this.getPinPos(this.selectedComponent.pinB);

                if (Math.hypot(pA.x - worldX, pA.y - worldY) < 18) {
                    this.draggingPinHandle = { comp: this.selectedComponent, pinTarget: 'pinA' };
                    this.canvas.style.cursor = 'grabbing';
                    return;
                } else if (Math.hypot(pB.x - worldX, pB.y - worldY) < 18) {
                    this.draggingPinHandle = { comp: this.selectedComponent, pinTarget: 'pinB' };
                    this.canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.draggingPinHandle) {
                if (this.hoveredPin) {
                    const comp = this.draggingPinHandle.comp;
                    const target = this.draggingPinHandle.pinTarget;
                    const oldPin = comp[target];
                    comp[target] = this.hoveredPin;
                    this.toastMsg = `📍 [${comp.type}] 핀 위치가 [${oldPin}] ➔ [${this.hoveredPin}] 구멍으로 변경되었습니다!`;
                }
                this.draggingPinHandle = null;
                this.render();
            }
            this.isDragging = false;
            this.canvas.style.cursor = 'default';
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasMouseX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const canvasMouseY = (e.clientY - rect.top) * (this.canvas.height / rect.height);

            const worldX = (canvasMouseX - this.offsetX) / this.scale;
            const worldY = (canvasMouseY - this.offsetY) / this.scale;
            this.mouseWorldPos = { x: worldX, y: worldY };

            if (this.isDragging) {
                this.offsetX = e.clientX - this.dragStartX;
                this.offsetY = e.clientY - this.dragStartY;
                this.render();
                return;
            }

            if (this.draggingPinHandle) {
                let closestPin = null;
                let minDist = 25 / this.scale;

                for (const [pinKey, pos] of this.pinCoords.entries()) {
                    const dist = Math.hypot(pos.x - worldX, pos.y - worldY);
                    if (dist < minDist) {
                        minDist = dist;
                        closestPin = pinKey;
                    }
                }
                this.hoveredPin = closestPin;
                this.render();
                return;
            }

            // Change cursor style & hover state
            if (this.activeTool === 'SELECT') {
                const hoveredComp = this.findComponentAt({ x: worldX, y: worldY });
                let isHoveringHandle = false;

                if (this.selectedComponent) {
                    const pA = this.getPinPos(this.selectedComponent.pinA);
                    const pB = this.getPinPos(this.selectedComponent.pinB);
                    if (Math.hypot(pA.x - worldX, pA.y - worldY) < 18 || Math.hypot(pB.x - worldX, pB.y - worldY) < 18) {
                        isHoveringHandle = true;
                    }
                }

                this.canvas.style.cursor = isHoveringHandle ? 'grab' : (hoveredComp ? 'pointer' : 'default');
                this.hoveredPin = null;
            } else {
                this.canvas.style.cursor = 'crosshair';
                let closestPin = null;
                let minDist = 22 / this.scale;

                for (const [pinKey, pos] of this.pinCoords.entries()) {
                    const dist = Math.hypot(pos.x - worldX, pos.y - worldY);
                    if (dist < minDist) {
                        minDist = dist;
                        closestPin = pinKey;
                    }
                }
                this.hoveredPin = closestPin;
            }

            this.render();
        });
    }

    pointToSegmentDist(px, py, ax, ay, bx, by) {
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
        if (l2 === 0) return Math.hypot(px - ax, py - ay);
        let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projX = ax + t * (bx - ax);
        const projY = ay + t * (by - ay);
        return Math.hypot(px - projX, py - projY);
    }

    findComponentAt(mousePos) {
        if (!this.lastComponents || this.lastComponents.length === 0) return null;
        let selected = null;
        let minHitDist = 25;

        for (const comp of this.lastComponents) {
            const pA = this.getPinPos(comp.pinA);
            const pB = this.getPinPos(comp.pinB);

            if (comp.type === 'IC') {
                const midX = (pA.x + pB.x) / 2;
                const numPinsPerSide = (comp.pins || 8) / 2;
                const pitchY = 11.2;
                const chipWidth = Math.abs(pB.x - pA.x) + 32;
                const chipHeight = (numPinsPerSide - 1) * pitchY + 32;
                const topY = pA.y - 16;

                if (mousePos.x >= midX - chipWidth / 2 && mousePos.x <= midX + chipWidth / 2 &&
                    mousePos.y >= topY && mousePos.y <= topY + chipHeight) {
                    return comp;
                }
            } else if (comp.type === 'WIRE') {
                const midX = (pA.x + pB.x) / 2;
                const midY = (pA.y + pB.y) / 2 - 12;

                const curvePts = [];
                for (let t = 0; t <= 1.0; t += 0.2) {
                    const cx = (1 - t) ** 2 * pA.x + 2 * (1 - t) * t * midX + t ** 2 * pB.x;
                    const cy = (1 - t) ** 2 * pA.y + 2 * (1 - t) * t * midY + t ** 2 * pB.y;
                    curvePts.push({ x: cx, y: cy });
                }

                for (let k = 0; k < curvePts.length - 1; k++) {
                    const dist = this.pointToSegmentDist(mousePos.x, mousePos.y, curvePts[k].x, curvePts[k].y, curvePts[k + 1].x, curvePts[k + 1].y);
                    if (dist < minHitDist) {
                        minHitDist = dist;
                        selected = comp;
                    }
                }
            } else {
                const dist = this.pointToSegmentDist(mousePos.x, mousePos.y, pA.x, pA.y, pB.x, pB.y);
                if (dist < minHitDist) {
                    minHitDist = dist;
                    selected = comp;
                }
            }
        }
        return selected;
    }

    handlePinClick(pinKey) {
        if (this.activeTool === 'PROBE_A') {
            this.probeAPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('A', pinKey);
            this.activeTool = 'SELECT';
            return;
        } else if (this.activeTool === 'PROBE_B') {
            this.probeBPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('B', pinKey);
            this.activeTool = 'SELECT';
            return;
        } else if (this.activeTool === 'PROBE_C') {
            this.probeCPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('C', pinKey);
            this.activeTool = 'SELECT';
            return;
        } else if (this.activeTool === 'PROBE_D') {
            this.probeDPin = pinKey;
            if (this.onProbePlaced) this.onProbePlaced('D', pinKey);
            this.activeTool = 'SELECT';
            return;
        }

        if (this.activeTool === 'SELECT') {
            return;
        }

        if (!this.placementPinA) {
            this.placementPinA = pinKey;
            this.toastMsg = `📍 1번 핀 [${pinKey}] 선택됨. 연결할 2번 핀을 클릭하세요 (ESC 키로 취소).`;
            this.render();
        } else {
            const pinB = pinKey;
            if (pinB !== this.placementPinA) {
                if (this.onComponentPlaced) {
                    this.onComponentPlaced(this.activeTool, this.placementPinA, pinB);
                }
            }
            this.placementPinA = null;
        }
    }

    selectComponent(comp) {
        this.selectedComponent = comp;
        if (this.onComponentSelected) this.onComponentSelected(comp);
        if (comp) {
            this.toastMsg = `🎯 [${comp.type === 'IC' ? comp.icType : comp.type}] 부품 선택됨! 핀(A/B)을 드래그하여 다른 구멍으로 이동하거나, Delete키로 삭제 가능합니다.`;
        }
        this.render();
    }

    render(components = null) {
        if (components !== null) {
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

        // 9. Render Official EIC-108 TP1, TP2, TP3 Flag Tags (matching media_1787274279103.jpg!)
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
            const numPinsPerSide = (comp.pins || 8) / 2;
            const pitchY = 11.2;
            const chipWidth = Math.abs(pB.x - pA.x) + 32;
            const chipHeight = (numPinsPerSide - 1) * pitchY + 32;
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

            this.ctx.fillStyle = '#ffffff';
            this.ctx.beginPath();
            this.ctx.arc(midX - chipWidth / 2 + 8, topY + 10, 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Printed IC Name Text
            this.ctx.fillStyle = '#f5f6fa';
            this.ctx.font = 'bold 11px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(comp.icType || 'LF356', midX, topY + chipHeight / 2 + 3);

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
