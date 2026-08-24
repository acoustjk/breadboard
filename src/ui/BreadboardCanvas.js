/**
 * BreadboardCanvas.js
 * Interactive HTML5 Canvas Workbench Renderer for Wanjie BB-4T7D Breadboard.
 * TO-92 BJT Transistor 3-Pin Renderer & Placement Engine v=1070.
 */

import { getResistorColorBands } from '../components/ComponentModels.js?v=1070';

export class BreadboardCanvas {
    constructor(canvas, grid) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;
        this.grid = grid;

        this.zoomLevel = 1.0;
        this.panOffsetX = 0;
        this.panOffsetY = 0;

        this.showValueBadges = true;

        this.voltageVa = 12.0;
        this.voltageVb = 0.0;
        this.voltageVc = -12.0;

        this.selectedComponent = null;
        this.placementMode = 'SELECT'; // 'SELECT', 'WIRE', 'R', 'C', 'VDC', 'SWITCH', 'LED', 'DIODE', 'ZENER', 'POT', 'IC', 'TRANSISTOR_CATALOG', 'PROBE_A', 'PROBE_B', 'PROBE_C', 'PROBE_D'
        this.placementPinA = null;
        this.hoveredPin = null;
        this.mouseWorldPos = { x: 0, y: 0 };
        this.toastMsg = null;
        this.toastTimer = null;

        // Probes: CH A & CH B active by default; CH C & CH D null by default
        this.probeAPin = 'B2_F17';
        this.probeBPin = 'B1_F16';
        this.probeCPin = null;
        this.probeDPin = null;

        this.componentsRef = [];

        this.numBlocks = 4;
        this.pinCoords = new Map();
        this.initPinCoordinates();
        if (canvas) {
            this.initEvents();
        }
    }

    setActiveTool(tool) {
        this.placementMode = tool;
        this.placementPinA = null;
        if (tool === 'SELECT') {
            this.showToast('👆 선택 모드: 부품 클릭 시 선택/이동/삭제/속성 조절');
        } else if (tool.startsWith('PROBE_')) {
            const ch = tool.split('_')[1];
            this.showToast(`📍 [CH ${ch} 프로브] 모드: 꽂을 핀 구멍을 클릭하세요.`);
        } else if (tool === 'TRANSISTOR_CATALOG') {
            this.showToast('🔺 [트랜지스터 TO-92] 모드: Emitter(E)를 꽂을 핀 구멍을 마우스로 클릭하세요.');
        } else {
            this.showToast(`📌 [${tool}] 배치 모드: 첫 번째 핀 구멍을 마우스로 클릭하세요.`);
        }
        if (this.onNeedsRender) this.onNeedsRender();
    }

    cancelPlacement() {
        this.placementMode = 'SELECT';
        this.placementPinA = null;
        if (this.onPlacementCancelled) this.onPlacementCancelled();
        if (this.onNeedsRender) this.onNeedsRender();
    }

    toggleValueBadges() {
        this.showValueBadges = !this.showValueBadges;
        if (this.onNeedsRender) this.onNeedsRender();
        return this.showValueBadges;
    }

    zoomIn() {
        this.zoomLevel = Math.min(3.5, this.zoomLevel * 1.2);
        if (this.onNeedsRender) this.onNeedsRender();
    }

    zoomOut() {
        this.zoomLevel = Math.max(0.4, this.zoomLevel * 0.8);
        if (this.onNeedsRender) this.onNeedsRender();
    }

    resetZoom() {
        this.zoomLevel = 1.0;
        this.panOffsetX = 0;
        this.panOffsetY = 0;
        if (this.onNeedsRender) this.onNeedsRender();
    }

    getMouseWorldPos(e) {
        if (!this.canvas) return { worldX: 0, worldY: 0 };
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width > 0 ? (this.canvas.width / rect.width) : 1.0;
        const scaleY = rect.height > 0 ? (this.canvas.height / rect.height) : 1.0;

        const clientX = (e.clientX - rect.left) * scaleX;
        const clientY = (e.clientY - rect.top) * scaleY;

        const worldX = (clientX - this.panOffsetX) / this.zoomLevel;
        const worldY = (clientY - this.panOffsetY) / this.zoomLevel;
        return { worldX, worldY };
    }

    initEvents() {
        if (!this.canvas) return;

        let isPanning = false;
        let startPanX = 0;
        let startPanY = 0;

        // 1. Mouse Down: Middle Click (button 1) or Right Click (button 2) initiates Pan
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || e.button === 2) {
                isPanning = true;
                startPanX = e.clientX - this.panOffsetX;
                startPanY = e.clientY - this.panOffsetY;
                this.canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        // 2. Window Mouse Move: Drag updates panOffsetX and panOffsetY in real time
        window.addEventListener('mousemove', (e) => {
            if (isPanning) {
                this.panOffsetX = e.clientX - startPanX;
                this.panOffsetY = e.clientY - startPanY;
                if (this.onNeedsRender) this.onNeedsRender();
            }
        });

        // 3. Window Mouse Up: End Pan
        window.addEventListener('mouseup', (e) => {
            if (isPanning) {
                isPanning = false;
                this.canvas.style.cursor = 'default';
            }
        });

        // Prevent default context menu on right click pan
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // 4. Canvas Mouse Move: Update hoveredPin and mouseWorldPos
        this.canvas.addEventListener('mousemove', (e) => {
            if (isPanning) return;
            const { worldX, worldY } = this.getMouseWorldPos(e);
            this.mouseWorldPos = { x: worldX, y: worldY };

            const nearest = this.getNearestPin(worldX, worldY, 24.0);
            if (nearest !== this.hoveredPin) {
                this.hoveredPin = nearest;
                if (this.onNeedsRender) this.onNeedsRender();
            } else if (this.placementPinA) {
                if (this.onNeedsRender) this.onNeedsRender();
            }
        });

        // 5. Canvas Click: Component placement, probe placement, component selection
        this.canvas.addEventListener('click', (e) => {
            if (e.button !== 0) return; // Left click only
            const { worldX, worldY } = this.getMouseWorldPos(e);
            const clickedPin = this.getNearestPin(worldX, worldY, 24.0);

            // Handle 4CH Oscilloscope Probes Placement
            if (this.placementMode && this.placementMode.startsWith('PROBE_')) {
                const ch = this.placementMode.split('_')[1];
                if (clickedPin) {
                    if (ch === 'A') this.probeAPin = clickedPin;
                    else if (ch === 'B') this.probeBPin = clickedPin;
                    else if (ch === 'C') this.probeCPin = clickedPin;
                    else if (ch === 'D') this.probeDPin = clickedPin;

                    if (this.onProbePlaced) {
                        this.onProbePlaced(ch, clickedPin);
                    }
                    this.showToast(`📍 CH ${ch} 프로브가 [${clickedPin}] 핀에 꽂혔습니다!`);
                } else {
                    this.showToast('⚠️ 프로브를 꽂을 핀 구멍을 클릭하세요.');
                }
                this.cancelPlacement();
                return;
            }

            // Handle Component Placement Mode (All components including Transistors & ICs use 2-click placement)
            if (this.placementMode && this.placementMode !== 'SELECT') {
                if (!clickedPin) {
                    this.showToast('⚠️ 핀 구멍 근처를 가볍게 마우스로 클릭해주세요.');
                    return;
                }

                if (!this.placementPinA) {
                    // First pin selected
                    this.placementPinA = clickedPin;
                    this.showToast(`📍 1번 핀 [${clickedPin}] 선택 완료! 2번 핀 구멍을 클릭하세요.`);
                    if (this.onNeedsRender) this.onNeedsRender();
                } else {
                    // Second pin selected
                    const pinA = this.placementPinA;
                    const pinB = clickedPin;
                    if (pinA === pinB) {
                        this.showToast('⚠️ 서로 다른 2개의 핀 구멍을 선택하세요.');
                        return;
                    }

                    const tool = this.placementMode;
                    this.placementMode = 'SELECT';
                    this.placementPinA = null;

                    if (this.onComponentPlaced) {
                        this.onComponentPlaced(tool, pinA, pinB);
                    }
                }
                return;
            }

            // Handle Selection Mode: Check if clicked component
            let foundComp = null;
            if (this.componentsRef) {
                for (const comp of this.componentsRef) {
                    const pA = this.getPinPos(comp.pinA || comp.pinEmitter);
                    const pB = this.getPinPos(comp.pinB || comp.pinCollector);
                    const distA = Math.hypot(pA.x - worldX, pA.y - worldY);
                    const distB = Math.hypot(pB.x - worldX, pB.y - worldY);
                    const midX = (pA.x + pB.x) / 2;
                    const midY = (pA.y + pB.y) / 2;
                    const distMid = Math.hypot(midX - worldX, midY - worldY);

                    if (distA < 20 || distB < 20 || distMid < 24) {
                        foundComp = comp;
                        break;
                    }
                }
            }

            this.selectedComponent = foundComp;
            if (foundComp) {
                this.showToast(`🔍 선택됨: [${foundComp.type}] ${foundComp.id}`);
            }
            if (this.onNeedsRender) this.onNeedsRender();
        });

        // 6. Canvas Double Click: Open property inspector or binding post prompt
        this.canvas.addEventListener('dblclick', (e) => {
            const { worldX, worldY } = this.getMouseWorldPos(e);

            // Check Binding Posts (Radius 30px tolerance at y = 72)
            const bindingPosts = ['BINDING_Va', 'BINDING_Vb', 'BINDING_Vc', 'BINDING_GND'];
            for (const bpKey of bindingPosts) {
                const pos = this.getPinPos(bpKey);
                if (Math.hypot(pos.x - worldX, pos.y - worldY) < 30) {
                    if (this.onBindingPostDblClicked) this.onBindingPostDblClicked(bpKey);
                    return;
                }
            }

            // Check Component Double Click
            if (this.selectedComponent && this.onComponentDblClicked) {
                this.onComponentDblClicked(this.selectedComponent);
            }
        });

        // 7. Smooth Independent Mouse Wheel Canvas Zoom (prevents entire browser page zoom!)
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = rect.width > 0 ? (this.canvas.width / rect.width) : 1.0;
            const scaleY = rect.height > 0 ? (this.canvas.height / rect.height) : 1.0;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const mouseY = (e.clientY - rect.top) * scaleY;

            const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
            const newZoom = Math.max(0.4, Math.min(3.5, this.zoomLevel * zoomFactor));

            this.panOffsetX = mouseX - (mouseX - this.panOffsetX) * (newZoom / this.zoomLevel);
            this.panOffsetY = mouseY - (mouseY - this.panOffsetY) * (newZoom / this.zoomLevel);
            this.zoomLevel = newZoom;

            if (this.onNeedsRender) this.onNeedsRender();
        }, { passive: false });
    }

    showToast(msg) {
        this.toastMsg = msg;
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.toastMsg = null;
            if (this.onNeedsRender) this.onNeedsRender();
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

        // 1. Binding Posts (Centered exactly at y = 72 matching render())
        setCoord('BINDING_Va', 70, 72);
        setCoord('BINDING_Vb', 180, 72);
        setCoord('BINDING_Vc', 290, 72);
        setCoord('BINDING_GND', 400, 72);

        // 2. Top Horizontal Bus Rails (50 Columns evenly spaced across x = 45..780 inside top white power strip at y = 106..178)
        for (let c = 1; c <= 50; c++) {
            const x = 45 + (c - 1) * 15.0;

            const yVcc1 = 114; // Red Line +12V
            const yGnd1 = 138; // Blue Line 0V/GND
            const yVcc2 = 146; // Red Line +12V
            const yGnd2 = 168; // Blue Line -12V

            // Map without block prefix (e.g. VCC_TOP1_15)
            setCoord(`VCC_TOP1_${c}`, x, yVcc1);
            setCoord(`GND_TOP1_${c}`, x, yGnd1);
            setCoord(`VCC_TOP2_${c}`, x, yVcc2);
            setCoord(`GND_TOP2_${c}`, x, yGnd2);

            // Map with block prefixes B1_, B2_, B3_, B4_ for complete compatibility
            for (let blk = 1; blk <= this.numBlocks; blk++) {
                setCoord(`B${blk}_VCC_TOP1_${c}`, x, yVcc1);
                setCoord(`B${blk}_GND_TOP1_${c}`, x, yGnd1);
                setCoord(`B${blk}_VCC_TOP2_${c}`, x, yVcc2);
                setCoord(`B${blk}_GND_TOP2_${c}`, x, yGnd2);
            }
        }

        // 3. Main Breadboard Blocks (1..4)
        for (let blk = 1; blk <= this.numBlocks; blk++) {
            const bX = startX + (blk - 1) * (blockWidth + blockGap);
            const prefix = `B${blk}_`;

            // Dual Vertical Power Rails
            for (let r = 1; r <= 60; r++) {
                const y = startY + (r - 1) * pitchY;
                setCoord(`${prefix}VCC_L_${r}`, bX + 10, y);
                setCoord(`${prefix}GND_L_${r}`, bX + 22, y);
                setCoord(`${prefix}VCC_R_${r}`, bX + 164, y);
                setCoord(`${prefix}GND_R_${r}`, bX + 176, y);

                if (blk === 1) {
                    setCoord(`VCC_L_${r}`, bX + 10, y);
                    setCoord(`GND_L_${r}`, bX + 22, y);
                    setCoord(`VCC_R_${r}`, bX + 164, y);
                    setCoord(`GND_R_${r}`, bX + 176, y);
                }
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
        if (this.pinCoords.has(pinKey)) return this.pinCoords.get(pinKey);
        if (this.pinCoords.has(`B1_${pinKey}`)) return this.pinCoords.get(`B1_${pinKey}`);
        if (this.pinCoords.has(`B2_${pinKey}`)) return this.pinCoords.get(`B2_${pinKey}`);

        // Safe Clamped Fallback for Power Rails out of bounds (e.g. GND_TOP1_51 -> GND_TOP1_50)
        if (pinKey.includes('_TOP')) {
            const parts = pinKey.split('_');
            if (parts.length >= 3) {
                const railPrefix = `${parts[0]}_${parts[1]}`;
                let colNum = parseInt(parts[2], 10);
                if (!isNaN(colNum)) {
                    colNum = Math.max(1, Math.min(50, colNum));
                    const clampedKey = `${railPrefix}_${colNum}`;
                    if (this.pinCoords.has(clampedKey)) return this.pinCoords.get(clampedKey);
                }
            }
            const railType = `${parts[0]}_${parts[1]}`;
            if (this.pinCoords.has(`${railType}_15`)) return this.pinCoords.get(`${railType}_15`);
        }

        return { x: 0, y: 0 };
    }

    getNearestPin(worldX, worldY, maxDist = 24.0) {
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
        this.componentsRef = components;
        if (!this.ctx) return;
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

        // 3. 4 Heavy Metal Binding Posts with Dynamic Voltage Values
        const bindingPosts = [
            { id: 'BINDING_Va', label: 'Va', color: '#ef4444', x: 70, y: 72, valText: `${(this.voltageVa || 12.0) > 0 ? '+' : ''}${(this.voltageVa || 12.0).toFixed(1)}V` },
            { id: 'BINDING_Vb', label: 'Vb', color: '#10b981', x: 180, y: 72, valText: `${(this.voltageVb || 0.0) > 0 ? '+' : ''}${(this.voltageVb || 0.0).toFixed(1)}V` },
            { id: 'BINDING_Vc', label: 'Vc', color: '#0284c7', x: 290, y: 72, valText: `${(this.voltageVc || -12.0) > 0 ? '+' : ''}${(this.voltageVc || -12.0).toFixed(1)}V` },
            { id: 'BINDING_GND', label: 'GND', color: '#64748b', x: 400, y: 72, valText: 'GND' }
        ];

        bindingPosts.forEach(bp => {
            this.ctx.fillStyle = bp.color;
            this.ctx.beginPath();
            this.ctx.arc(bp.x, bp.y, 14, 0, Math.PI * 2);
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
            this.ctx.fillText(bp.valText, bp.x, 92);
        });

        // 4. Render Top 4 Horizontal Bus Lines Panel
        this.ctx.fillStyle = '#f8fafc';
        this.ctx.beginPath();
        this.ctx.roundRect(35, 106, 745, 72, 4);
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

        // 6. Render All Metallic Pin Holes with Glowing Hover Targets
        let activeHoverNode = this.hoveredPin ? this.grid.getNodeId(this.hoveredPin) : null;

        for (const [pinKey, pos] of this.pinCoords.entries()) {
            if (pinKey.startsWith('BINDING_')) continue;

            const pinNode = this.grid.getNodeId(pinKey);
            const isHovered = (this.hoveredPin === pinKey);
            const isPlacementStart = (this.placementPinA === pinKey);
            const isSameNodeHovered = activeHoverNode && (pinNode === activeHoverNode);

            this.ctx.beginPath();

            if (isPlacementStart) {
                this.ctx.arc(pos.x, pos.y, 6.0, 0, Math.PI * 2);
                this.ctx.fillStyle = '#38bdf8';
                this.ctx.fill();
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            } else if (isHovered) {
                this.ctx.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ef4444';
                this.ctx.fill();
                this.ctx.strokeStyle = '#facc15';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            } else if (isSameNodeHovered) {
                this.ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#fdcb6e';
                this.ctx.fill();
            } else {
                this.ctx.arc(pos.x, pos.y, 1.8, 0, Math.PI * 2);
                this.ctx.fillStyle = '#2d3436';
                this.ctx.fill();
            }
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
        const pA = this.getPinPos(comp.pinA || comp.pinEmitter);
        const pB = this.getPinPos(comp.pinB || comp.pinCollector);

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

        } else if (comp.type === 'BJT') {
            const pE = this.getPinPos(comp.pinEmitter || comp.pinA);
            const pBase = this.getPinPos(comp.pinBase);
            const pC = this.getPinPos(comp.pinCollector || comp.pinB);

            const isVertical = (Math.abs(pE.x - pC.x) < 5);
            const midX = (pE.x + pBase.x + pC.x) / 3;
            const midY = (pE.y + pBase.y + pC.y) / 3;

            // Body offset so TO-92 package does not obscure hole labels
            const bodyX = isVertical ? midX - 25 : midX;
            const bodyY = isVertical ? midY : midY - 20;

            // Draw 3 Silver Metallic Lead Lines from Pin Holes to Package Body
            this.ctx.strokeStyle = '#cbd5e1';
            this.ctx.lineWidth = 1.8;
            this.ctx.beginPath();
            this.ctx.moveTo(pE.x, pE.y);
            this.ctx.lineTo(bodyX, bodyY);
            this.ctx.moveTo(pBase.x, pBase.y);
            this.ctx.lineTo(bodyX, bodyY);
            this.ctx.moveTo(pC.x, pC.y);
            this.ctx.lineTo(bodyX, bodyY);
            this.ctx.stroke();

            // TO-92 Black Plastic D-Shape Package Body
            this.ctx.fillStyle = '#1e272e';
            this.ctx.beginPath();
            this.ctx.arc(bodyX, bodyY, 13, Math.PI, 0);
            this.ctx.lineTo(bodyX + 13, bodyY + 8);
            this.ctx.lineTo(bodyX - 13, bodyY + 8);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#00cec9' : '#485460';
            this.ctx.lineWidth = isSelected ? 2.2 : 1.2;
            this.ctx.stroke();

            // Transistor Part Name (2N3904 / C1815)
            this.ctx.fillStyle = '#f8fafc';
            this.ctx.font = 'bold 8px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(comp.transType || '2N3904', bodyX, bodyY + 3);

            // Bold Clear E, C, B Pin Labels Right Next To Pin Holes (Matching User's Red Diagram)
            this.ctx.font = 'bold 11px sans-serif';
            this.ctx.textBaseline = 'middle';

            const tagOffsetX = isVertical ? 12 : 0;
            const tagOffsetY = isVertical ? 0 : -10;

            // Emitter Label (E) - Bright Red
            this.ctx.fillStyle = '#ef4444';
            this.ctx.textAlign = isVertical ? 'left' : 'center';
            this.ctx.fillText('E', pE.x + tagOffsetX, pE.y + tagOffsetY);

            // Collector Label (C) - Bright Yellow
            this.ctx.fillStyle = '#facc15';
            this.ctx.textAlign = isVertical ? 'left' : 'center';
            this.ctx.fillText('C', pC.x + tagOffsetX, pC.y + tagOffsetY);

            // Base Label (B) - Bright Cyan
            this.ctx.fillStyle = '#38bdf8';
            this.ctx.textAlign = isVertical ? 'left' : 'center';
            this.ctx.fillText('B', pBase.x + tagOffsetX, pBase.y + tagOffsetY);

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
                // Electrolytic Cylinder Body
                this.ctx.arc(midX, midY, 10, 0, Math.PI * 2);
                this.ctx.fill();

                // Minus (-) Silver Stripe on pinB (Cathode) side
                const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
                const stripeX = midX + Math.cos(angle) * 5;
                const stripeY = midY + Math.sin(angle) * 5;

                this.ctx.fillStyle = '#f1f2f6';
                this.ctx.beginPath();
                this.ctx.arc(stripeX, stripeY, 5, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = '#2d3436';
                this.ctx.font = 'bold 9px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('-', stripeX, stripeY);

                // Bright Polarity Badges on Lead Holes: pinA = (+ Red), pinB = (- Blue)
                this.ctx.fillStyle = '#ef4444';
                this.ctx.beginPath();
                this.ctx.arc(pA.x, pA.y, 6, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 10px monospace';
                this.ctx.fillText('+', pA.x, pA.y + 1);

                this.ctx.fillStyle = '#3b82f6';
                this.ctx.beginPath();
                this.ctx.arc(pB.x, pB.y, 6, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 10px monospace';
                this.ctx.fillText('-', pB.x, pB.y + 1);

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
            const chipWidth = Math.abs(pB.x - pA.x) + 26;
            const chipHeight = (pinsPerSide - 1) * pitchY + 28;
            const topY = pA.y - 14;

            // DIP Chip Body (Clean Professional Dark Slate)
            this.ctx.fillStyle = '#1e272e';
            this.ctx.beginPath();
            this.ctx.roundRect(midX - chipWidth / 2, topY, chipWidth, chipHeight, 4);
            this.ctx.fill();
            this.ctx.strokeStyle = isSelected ? '#00cec9' : '#485460';
            this.ctx.lineWidth = isSelected ? 2.5 : 1.5;
            this.ctx.stroke();

            // Pin 1 Notch
            this.ctx.fillStyle = '#0f172a';
            this.ctx.beginPath();
            this.ctx.arc(midX, topY, 5, 0, Math.PI);
            this.ctx.fill();

            // Pin 1 Cyan Dot Indicator
            this.ctx.fillStyle = '#38bdf8';
            this.ctx.beginPath();
            this.ctx.arc(midX - chipWidth / 2 + 6, topY + 8, 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Printed IC Name Text (White)
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 11px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(comp.icType || 'LF356', midX, topY + chipHeight / 2 + 3);

            // Clean Metallic Silver Pins & Subtle Yellow Pin Numbers
            this.ctx.font = 'bold 9px monospace';
            this.ctx.textBaseline = 'middle';

            for (let i = 0; i < pinsPerSide; i++) {
                const legY = pA.y + i * pitchY;

                // Left Pin Leg (Pin 1..N/2)
                const leftPinNum = i + 1;
                const leftLegX = midX - chipWidth / 2;

                // Silver Metallic Lead
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillRect(leftLegX - 4, legY - 2, 5, 4);

                // Subtle Yellow Text
                this.ctx.fillStyle = (leftPinNum === 1) ? '#38bdf8' : '#facc15';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${leftPinNum}`, leftLegX + 7, legY);

                // Right Pin Leg (Pin N..N/2+1)
                const rightPinNum = numPinsTotal - i;
                const rightLegX = midX + chipWidth / 2;

                // Silver Metallic Lead
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillRect(rightLegX - 1, legY - 2, 5, 4);

                // Subtle Yellow Text
                this.ctx.fillStyle = '#facc15';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(`${rightPinNum}`, rightLegX - 7, legY);
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
                this.ctx.fillText(comp.type === 'ZENER' ? `${comp.vZener || 5.1}V Zener` : (comp.model || '1N4148'), 0, -8);
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
